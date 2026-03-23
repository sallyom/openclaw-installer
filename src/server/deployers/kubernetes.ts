import * as k8s from "@kubernetes/client-node";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { coreApi, appsApi, loadKubeConfig, hasOtelOperator, k8sApiHttpCode } from "../services/k8s.js";
import { ensureK8sPortForward } from "../services/k8s-port-forward.js";
import { cronJobsFile, installerK8sInstanceDir, skillsDir } from "../paths.js";
import { loadTextTree, type TreeEntry } from "../state-tree.js";
import type {
  Deployer,
  DeployConfig,
  DeployResult,
  LogCallback,
} from "./types.js";
import { redactConfig } from "./types.js";
import { namespaceName, agentId, generateToken } from "./k8s-helpers.js";
import { loadWorkspaceFiles } from "./k8s-agent.js";
import { loadAgentSourceCronJobs, loadAgentSourceWorkspaceTree } from "./agent-source.js";
import {
  namespaceManifest,
  pvcManifest,
  configMapManifest,
  agentConfigMapManifest,
  fileTreeConfigMapManifest,
  fileConfigMapManifest,
  gcpSaSecretManifest,
  litellmConfigMapManifest,
  otelConfigMapManifest,
  secretManifest,
  serviceManifest,
  deploymentManifest,
} from "./k8s-manifests.js";
import { shouldUseLitellmProxy, generateLitellmMasterKey, generateLitellmConfig } from "./litellm.js";
import { shouldUseOtel, generateOtelConfig, generateOtelConfigObject } from "./otel.js";
import {
  shouldUseTokenizer,
  generateTokenizerOpenKey,
  deriveTokenizerSealKey,
  sealCredential,
  tokenizerAgentEnv,
  tokenizerSecretKeys,
  sanitizeCredName,
  generateTokenizerSkill,
  validateTokenizerCredentials,
  normalizeTokenizerCredentials,
} from "./tokenizer.js";

// Re-export discovery for consumers
export type { K8sPodInfo, K8sInstance } from "./k8s-discovery.js";
export { discoverK8sInstances } from "./k8s-discovery.js";

// ── Helper: apply or update a resource ─────────────────────────────

async function applyNamespace(core: k8s.CoreV1Api, ns: string, log: LogCallback): Promise<void> {
  try {
    await core.readNamespace({ name: ns });
    log(`Namespace ${ns} already exists`);
    return;
  } catch (e: unknown) {
    const status = k8sApiHttpCode(e);
    if (status === 403) {
      log(`Cannot verify Namespace "${ns}" at cluster scope (forbidden) — using it as the deploy target. Ensure the namespace exists and you have admin/edit there.`);
      return;
    }
    if (status !== 404) {
      throw e;
    }
  }

  log(`Creating namespace ${ns}...`);
  try {
    await core.createNamespace({ body: namespaceManifest(ns) });
    log(`Namespace ${ns} created`);
  } catch (e: unknown) {
    if (k8sApiHttpCode(e) === 403) {
      throw new Error(
        `Cannot create namespace "${ns}": forbidden. Create the project/namespace first (e.g. oc new-project ${ns}) and set it in the deploy form, or ask a cluster admin.`,
        { cause: e },
      );
    }
    throw e;
  }
}

async function applyResource<T>(
  readFn: () => Promise<unknown>,
  createFn: () => Promise<T>,
  replaceFn: (() => Promise<T>) | null,
  name: string,
  log: LogCallback,
): Promise<void> {
  let exists = false;
  try {
    await readFn();
    exists = true;
  } catch {
    // does not exist
  }

  if (exists) {
    if (replaceFn) {
      log(`Updating ${name}...`);
      await replaceFn();
    } else {
      log(`${name} already exists (skipping)`);
      return;
    }
  } else {
    log(`Creating ${name}...`);
    await createFn();
  }
  log(`${name} applied`);
}

// ── Deployer implementation ────────────────────────────────────────

export class KubernetesDeployer implements Deployer {
  async deploy(config: DeployConfig, log: LogCallback): Promise<DeployResult> {
    const id = uuid();
    const ns = namespaceName(config);
    const gatewayToken = generateToken();
    const core = coreApi();
    const apps = appsApi();
    log(`Deploying OpenClaw to namespace: ${ns}`);

    // Load workspace files (prefers user-customized from ~/.openclaw/workspace-*)
    const { files: workspaceFiles } = loadWorkspaceFiles(config, log);
    const skillEntries: TreeEntry[] = await loadTextTree(skillsDir()).catch(() => []);
    const agentTreeEntries = await loadAgentSourceWorkspaceTree(config.agentSourceDir).catch(() => []);
    const cronJobsContent = loadAgentSourceCronJobs(config.agentSourceDir)
      ?? await readFile(cronJobsFile(), "utf8").catch(() => undefined);

    // 1. Namespace
    await applyNamespace(core, ns, log);

    // 2. PVC (immutable — skip if exists)
    await applyResource(
      () => core.readNamespacedPersistentVolumeClaim({ name: "openclaw-home-pvc", namespace: ns }),
      () => core.createNamespacedPersistentVolumeClaim({ namespace: ns, body: pvcManifest(ns) }),
      null,
      "PVC openclaw-home-pvc",
      log,
    );

    // 3. ConfigMap (openclaw.json)
    const cm = configMapManifest(ns, config, gatewayToken);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-config", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: cm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-config", namespace: ns, body: cm }),
      "ConfigMap openclaw-config",
      log,
    );

    // 4. ConfigMap (agent workspace files)
    const agentCm = agentConfigMapManifest(ns, config, workspaceFiles);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-agent", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: agentCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-agent", namespace: ns, body: agentCm }),
      "ConfigMap openclaw-agent",
      log,
    );

    const agentTreeCm = fileTreeConfigMapManifest(ns, "openclaw-agent-tree", agentTreeEntries);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-agent-tree", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: agentTreeCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-agent-tree", namespace: ns, body: agentTreeCm }),
      "ConfigMap openclaw-agent-tree",
      log,
    );

    // 4a-tkz. Tokenizer proxy config — process BEFORE the skills ConfigMap so the
    //         tokenizer skill entry is included when the ConfigMap is applied.
    const useTkz = shouldUseTokenizer(config);
    let tokenizerData: { openKey: string; agentEnv: Record<string, string> } | undefined;

    if (useTkz && config.tokenizerCredentials?.length) {
      // Validate and normalize credentials before sealing
      const deployCredError = validateTokenizerCredentials(config.tokenizerCredentials);
      if (deployCredError) {
        throw new Error(`Invalid tokenizer credentials: ${deployCredError}`);
      }
      const normalizedDeployCreds = normalizeTokenizerCredentials(config.tokenizerCredentials) as
        Array<{ name: string; secret: string; allowedHosts: string[]; headerDst?: string; headerFmt?: string }>;

      log("Tokenizer proxy enabled — credentials will be sealed and injected by the proxy sidecar");
      const openKey = generateTokenizerOpenKey();
      const sealKey = deriveTokenizerSealKey(openKey);
      const sealed = normalizedDeployCreds.map((c) => sealCredential(c, sealKey));
      tokenizerData = {
        openKey,
        agentEnv: tokenizerAgentEnv(sealed, sealKey),
      };

      // Add the Tokenizer skill to skillEntries before the ConfigMap is created
      const skillMd = generateTokenizerSkill(sealed);
      skillEntries.push({ key: "tkz-skill", path: "tokenizer/SKILL.md", content: skillMd });
    }

    const skillsCm = fileTreeConfigMapManifest(ns, "openclaw-skills", skillEntries);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-skills", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: skillsCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-skills", namespace: ns, body: skillsCm }),
      "ConfigMap openclaw-skills",
      log,
    );

    const cronCm = fileConfigMapManifest(ns, "openclaw-cron", "jobs.json", cronJobsContent);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-cron", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: cronCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-cron", namespace: ns, body: cronCm }),
      "ConfigMap openclaw-cron",
      log,
    );

    // 4b. LiteLLM proxy config (when using Vertex via proxy)
    const useProxy = shouldUseLitellmProxy(config);
    const litellmMasterKey = useProxy ? generateLitellmMasterKey() : undefined;

    if (useProxy && litellmMasterKey) {
      log("LiteLLM proxy enabled — GCP credentials will stay in the proxy sidecar");
      const litellmYaml = generateLitellmConfig(config, litellmMasterKey);
      const litellmCm = litellmConfigMapManifest(ns, litellmYaml);
      await applyResource(
        () => core.readNamespacedConfigMap({ name: "litellm-config", namespace: ns }),
        () => core.createNamespacedConfigMap({ namespace: ns, body: litellmCm }),
        () => core.replaceNamespacedConfigMap({ name: "litellm-config", namespace: ns, body: litellmCm }),
        "ConfigMap litellm-config",
        log,
      );
    }

    // 4c. OTEL collector config
    let otelViaOperator = false;
    if (shouldUseOtel(config)) {
      const endpoint = config.otelEndpoint || (config.otelJaeger ? "localhost:4317" : "");
      log("OTEL collector enabled — traces will be exported to " + endpoint);

      const operatorAvailable = await hasOtelOperator();
      if (operatorAvailable) {
        // Use the OTel Operator: create an OpenTelemetryCollector CR in sidecar mode.
        // The operator injects the collector container automatically when the pod
        // has the sidecar.opentelemetry.io/inject annotation.
        otelViaOperator = true;
        log("OpenTelemetry Operator detected — using operator-managed sidecar");
        const otelCr = {
          apiVersion: "opentelemetry.io/v1beta1",
          kind: "OpenTelemetryCollector",
          metadata: { name: "openclaw-sidecar", namespace: ns, labels: { app: "openclaw" } },
          spec: {
            mode: "sidecar",
            config: generateOtelConfigObject(config),
            resources: {
              requests: { memory: "128Mi", cpu: "100m" },
              limits: { memory: "256Mi", cpu: "200m" },
            },
          },
        };
        const customApi = loadKubeConfig().makeApiClient(k8s.CustomObjectsApi);
        const crParams = {
          group: "opentelemetry.io",
          version: "v1beta1",
          namespace: ns,
          plural: "opentelemetrycollectors",
        };
        try {
          await customApi.getNamespacedCustomObject({ ...crParams, name: "openclaw-sidecar" });
          log("Updating OpenTelemetryCollector openclaw-sidecar...");
          await customApi.patchNamespacedCustomObject(
            { ...crParams, name: "openclaw-sidecar", body: otelCr },
            k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
          );
        } catch {
          log("Creating OpenTelemetryCollector openclaw-sidecar...");
          await customApi.createNamespacedCustomObject({ ...crParams, body: otelCr });
        }
        log("OpenTelemetryCollector CR applied");
      } else {
        // No operator: use direct sidecar container via ConfigMap
        log("No OTel Operator — deploying collector as a direct sidecar");
        const otelYaml = generateOtelConfig(config);
        const otelCm = otelConfigMapManifest(ns, otelYaml);
        await applyResource(
          () => core.readNamespacedConfigMap({ name: "otel-collector-config", namespace: ns }),
          () => core.createNamespacedConfigMap({ namespace: ns, body: otelCm }),
          () => core.replaceNamespacedConfigMap({ name: "otel-collector-config", namespace: ns, body: otelCm }),
          "ConfigMap otel-collector-config",
          log,
        );
      }
    }

    // 5. Secret
    const secret = secretManifest(ns, config, gatewayToken, litellmMasterKey, tokenizerData);
    await applyResource(
      () => core.readNamespacedSecret({ name: "openclaw-secrets", namespace: ns }),
      () => core.createNamespacedSecret({ namespace: ns, body: secret }),
      () => core.replaceNamespacedSecret({ name: "openclaw-secrets", namespace: ns, body: secret }),
      "Secret openclaw-secrets",
      log,
    );

    // 6b. GCP service account secret (for Vertex AI)
    if (config.gcpServiceAccountJson) {
      const gcpSecret = gcpSaSecretManifest(ns, config.gcpServiceAccountJson);
      await applyResource(
        () => core.readNamespacedSecret({ name: "gcp-sa", namespace: ns }),
        () => core.createNamespacedSecret({ namespace: ns, body: gcpSecret }),
        () => core.replaceNamespacedSecret({ name: "gcp-sa", namespace: ns, body: gcpSecret }),
        "Secret gcp-sa",
        log,
      );
    }

    // 6. Service
    const svc = serviceManifest(ns);
    await applyResource(
      () => core.readNamespacedService({ name: "openclaw", namespace: ns }),
      () => core.createNamespacedService({ namespace: ns, body: svc }),
      () => core.replaceNamespacedService({ name: "openclaw", namespace: ns, body: svc }),
      "Service openclaw",
      log,
    );

    // 7. Deployment
    const dep = deploymentManifest(ns, config, otelViaOperator, skillEntries, agentTreeEntries, cronJobsContent);
    await applyResource(
      () => apps.readNamespacedDeployment({ name: "openclaw", namespace: ns }),
      () => apps.createNamespacedDeployment({ namespace: ns, body: dep }),
      () => apps.replaceNamespacedDeployment({ name: "openclaw", namespace: ns, body: dep }),
      "Deployment openclaw",
      log,
    );

    const url = `(use: kubectl port-forward svc/openclaw 18789:18789 -n ${ns})`;

    log(`OpenClaw deployed to ${ns}`);
    log(`Access via port-forward: kubectl port-forward svc/openclaw 18789:18789 -n ${ns}`);
    // Show URL with token so users can copy-paste after port-forward (fix for #29)
    log(`Gateway URL (after port-forward): http://localhost:18789#token=${encodeURIComponent(gatewayToken)}`);

    // Save deploy config for re-deploy (strip secrets, keep references)
    try {
      const configDir = installerK8sInstanceDir(ns);
      mkdirSync(configDir, { recursive: true });
      const savedConfig = {
        ...config,
        namespace: ns,
        // Strip secret values — they're in the cluster, not needed on disk
        anthropicApiKey: config.anthropicApiKey ? "(set)" : undefined,
        openaiApiKey: config.openaiApiKey ? "(set)" : undefined,
        gcpServiceAccountJson: config.gcpServiceAccountJson ? "(set)" : undefined,
        telegramBotToken: config.telegramBotToken ? "(set)" : undefined,
        secretsProvidersJson: config.secretsProvidersJson,
        anthropicApiKeyRef: config.anthropicApiKeyRef,
        openaiApiKeyRef: config.openaiApiKeyRef,
        telegramBotTokenRef: config.telegramBotTokenRef,
        // Keep tokenizer structure but strip raw secrets
        tokenizerCredentials: config.tokenizerCredentials?.map((c) => ({
          ...c,
          secret: "(set)",
        })),
      };
      writeFileSync(
        join(configDir, "deploy-config.json"),
        JSON.stringify(savedConfig, null, 2),
        { mode: 0o600 },
      );
      writeFileSync(join(configDir, "gateway-token"), gatewayToken + "\n", { mode: 0o600 });
      log(`Deploy config saved to ${configDir}/deploy-config.json`);
    } catch {
      log("Could not save deploy config to host");
    }

    return {
      id,
      mode: "kubernetes",
      status: "running",
      config: redactConfig({ ...config, namespace: ns }),
      startedAt: new Date().toISOString(),
      url,
      containerId: ns,
    };
  }

  async start(result: DeployResult, log: LogCallback): Promise<DeployResult> {
    const ns = result.config.namespace || result.containerId || "";
    const apps = appsApi();
    log(`Scaling deployment to 1 in ${ns}...`);

    const patch = [{ op: "replace", path: "/spec/replicas", value: 1 }];
    await apps.patchNamespacedDeployment(
      { name: "openclaw", namespace: ns, body: patch },
      k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.JsonPatch),
    );

    log("Deployment scaled to 1");
    return { ...result, status: "running" };
  }

  async status(result: DeployResult): Promise<DeployResult> {
    const ns = result.config.namespace || result.containerId || "";
    try {
      const apps = appsApi();
      const dep = await apps.readNamespacedDeployment({ name: "openclaw", namespace: ns });
      const replicas = dep.status?.readyReplicas ?? 0;
      const desired = dep.spec?.replicas ?? 1;
      if (desired === 0) return { ...result, status: "stopped" };
      if (replicas > 0) {
        try {
          const { url } = await ensureK8sPortForward(ns);
          return { ...result, status: "running", url };
        } catch {
          return { ...result, status: "running" };
        }
      }
      return { ...result, status: "unknown" };
    } catch {
      return { ...result, status: "unknown" };
    }
  }

  async stop(result: DeployResult, log: LogCallback): Promise<void> {
    const ns = result.config.namespace || result.containerId || "";
    const apps = appsApi();
    log(`Scaling deployment to 0 in ${ns}...`);

    const patch = [{ op: "replace", path: "/spec/replicas", value: 0 }];
    await apps.patchNamespacedDeployment(
      { name: "openclaw", namespace: ns, body: patch },
      k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.JsonPatch),
    );

    log("Deployment scaled to 0. PVC preserved.");
  }

  /**
   * Lightweight re-deploy: update agent ConfigMap from local files and
   * restart the pod. Secrets and other resources are left untouched.
   */
  async redeploy(result: DeployResult, log: LogCallback): Promise<void> {
    const ns = result.config.namespace || result.containerId || "";
    const core = coreApi();
    const apps = appsApi();

    log(`Re-deploying agent files to ${ns}...`);

    // Load workspace files from ~/.openclaw/workspace-*
    const { files: workspaceFiles, fromHost } = loadWorkspaceFiles(result.config, log);
    const skillEntries: TreeEntry[] = await loadTextTree(skillsDir()).catch(() => []);
    const agentTreeEntries = await loadAgentSourceWorkspaceTree(result.config.agentSourceDir).catch(() => []);
    const cronJobsContent = loadAgentSourceCronJobs(result.config.agentSourceDir)
      ?? await readFile(cronJobsFile(), "utf8").catch(() => undefined);
    if (!fromHost) {
      log("No custom agent files found — using generated defaults");
    }

    // Preserve tokenizer skill entries from the existing ConfigMap (these are
    // generated dynamically and don't exist on the host filesystem).
    try {
      const existingSkillsCm = await core.readNamespacedConfigMap({ name: "openclaw-skills", namespace: ns });
      if (existingSkillsCm.data) {
        for (const [key, content] of Object.entries(existingSkillsCm.data)) {
          if (key.startsWith("tkz-skill")) {
            skillEntries.push({ key, path: "tokenizer/SKILL.md", content });
          }
        }
      }
    } catch {
      // ConfigMap may not exist yet
    }

    // Update the agent ConfigMap
    const agentCm = agentConfigMapManifest(ns, result.config, workspaceFiles);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-agent", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: agentCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-agent", namespace: ns, body: agentCm }),
      "ConfigMap openclaw-agent",
      log,
    );

    const skillsCm = fileTreeConfigMapManifest(ns, "openclaw-skills", skillEntries);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-skills", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: skillsCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-skills", namespace: ns, body: skillsCm }),
      "ConfigMap openclaw-skills",
      log,
    );

    const agentTreeCm = fileTreeConfigMapManifest(ns, "openclaw-agent-tree", agentTreeEntries);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-agent-tree", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: agentTreeCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-agent-tree", namespace: ns, body: agentTreeCm }),
      "ConfigMap openclaw-agent-tree",
      log,
    );

    const cronCm = fileConfigMapManifest(ns, "openclaw-cron", "jobs.json", cronJobsContent);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-cron", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: cronCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-cron", namespace: ns, body: cronCm }),
      "ConfigMap openclaw-cron",
      log,
    );

    // Update the init container script to always copy agent files (removes
    // the "if not exists" guard from older deploys) and restart the pod
    const id = agentId(result.config);
    const agentFiles = ["AGENTS.md", "agent.json", "SOUL.md", "IDENTITY.md", "TOOLS.md", "USER.md", "HEARTBEAT.md", "MEMORY.md"];
    const copyLines = agentFiles
      .map((f) => `cp /agents/${f} /home/node/.openclaw/workspace-${id}/${f} 2>/dev/null || true`)
      .join("\n");

    // Read current Deployment to find volume indices by name and to
    // preserve tokenizer init container env vars (they vary depending on
    // which optional sidecars were enabled at deploy time).
    const currentDeploy = await apps.readNamespacedDeployment({ name: "openclaw", namespace: ns });
    const volumes = currentDeploy.spec?.template?.spec?.volumes ?? [];
    const volIndex = (name: string): number => {
      const idx = volumes.findIndex((v) => v.name === name);
      if (idx === -1) throw new Error(`Volume '${name}' not found in Deployment`);
      return idx;
    };

    // Preserve tokenizer init script lines from the existing init container.
    // The init container writes TOKENIZER_* env vars into the agent's .env
    // file; without these lines the agent loses credential access after redeploy.
    const existingInitContainer = currentDeploy.spec?.template?.spec?.initContainers?.[0];
    const existingInitEnv = existingInitContainer?.env ?? [];
    const tkzEnvKeys = existingInitEnv
      .filter((e) => e.name?.startsWith("TOKENIZER_"))
      .map((e) => e.name!);

    const tokenizerInitLines = tkzEnvKeys.length > 0 ? [
      `if [ -f '/home/node/.openclaw/workspace-${id}/.env' ]; then sed -i '/^TOKENIZER_/d' '/home/node/.openclaw/workspace-${id}/.env'; fi`,
      ...tkzEnvKeys.map((k) =>
        `printf '%s=%s\\n' '${k}' "$${k}" >> /home/node/.openclaw/workspace-${id}/.env`,
      ),
      `chmod 600 /home/node/.openclaw/workspace-${id}/.env`,
    ] : [];

    const initScript = `
cp /config/openclaw.json /home/node/.openclaw/openclaw.json
chmod 644 /home/node/.openclaw/openclaw.json
mkdir -p /home/node/.openclaw/workspace
mkdir -p /home/node/.openclaw/skills
mkdir -p /home/node/.openclaw/cron
mkdir -p /home/node/.openclaw/workspace-${id}
${copyLines}
find /agents-tree -mindepth 1 -type d -name 'workspace-*' -exec sh -c 'base="$(basename "$1")"; if [ "$base" = "workspace-main" ]; then dest="/home/node/.openclaw/workspace-${id}"; else dest="/home/node/.openclaw/$base"; fi; mkdir -p "$dest"; cp -r "$1"/* "$dest"/ 2>/dev/null || true' _ {} \\;
cp -r /skills-src/. /home/node/.openclaw/skills/ 2>/dev/null || true
cp /cron-src/jobs.json /home/node/.openclaw/cron/jobs.json 2>/dev/null || true
${tokenizerInitLines.join("\n")}
chgrp -R 0 /home/node/.openclaw 2>/dev/null || true
chmod -R g=u /home/node/.openclaw 2>/dev/null || true
echo "Config initialized"
`.trim();

    // Use JSON Patch to update the init container command (and env if
    // tokenizer vars are present) and restart annotation.
    const patches: Array<{ op: string; path: string; value: unknown }> = [
      {
        op: "replace",
        path: "/spec/template/spec/initContainers/0/command",
        value: ["sh", "-c", initScript],
      },
      // Preserve the init container's env (tokenizer secretKeyRef entries) so
      // the init script can write TOKENIZER_* vars into the agent's .env.
      ...(existingInitEnv.length > 0 ? [{
        op: "replace",
        path: "/spec/template/spec/initContainers/0/env",
        value: existingInitEnv,
      }] : []),
      {
        op: "replace",
        path: `/spec/template/spec/volumes/${volIndex("skills-config")}/configMap`,
        value: {
          name: "openclaw-skills",
          ...(skillEntries.length > 0
            ? { items: skillEntries.map((entry) => ({ key: entry.key, path: entry.path })) }
            : {}),
        },
      },
      {
        op: "replace",
        path: `/spec/template/spec/volumes/${volIndex("cron-config")}/configMap`,
        value: {
          name: "openclaw-cron",
          ...(cronJobsContent !== undefined
            ? { items: [{ key: "jobs.json", path: "jobs.json" }] }
            : {}),
        },
      },
      {
        op: "replace",
        path: `/spec/template/spec/volumes/${volIndex("agent-tree-config")}/configMap`,
        value: {
          name: "openclaw-agent-tree",
          ...(agentTreeEntries.length > 0
            ? { items: agentTreeEntries.map((entry) => ({ key: entry.key, path: entry.path })) }
            : {}),
        },
      },
      {
        op: "replace",
        path: "/spec/template/metadata/annotations/openclaw.io~1restart-at",
        value: new Date().toISOString(),
      },
    ];
    await apps.patchNamespacedDeployment(
      { name: "openclaw", namespace: ns, body: patches },
      k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.JsonPatch),
    );

    log("Agent files updated and pod restarting");
  }

  /**
   * Update tokenizer credentials on a running K8s instance.
   * Generates fresh keys, seals all credentials, updates Secret + ConfigMap,
   * and triggers a rollout restart.
   */
  async updateTokenizerCredentials(
    result: DeployResult,
    credentials: Array<{ name: string; secret?: string; allowedHosts: string[]; headerDst?: string; headerFmt?: string }>,
    log: LogCallback,
  ): Promise<void> {
    const ns = result.config.namespace || result.containerId || "";
    const core = coreApi();
    const apps = appsApi();

    // Read existing secret so we can preserve unchanged credentials.
    log("Reading existing Secret...");
    const existingSecret = await core.readNamespacedSecret({ name: "openclaw-secrets", namespace: ns });
    const existingData = existingSecret.data || {};

    // For credentials with an empty secret, carry forward the existing sealed
    // token and bearer password so users don't have to re-enter unchanged secrets.
    const newCreds = credentials.filter(
      (c): c is typeof c & { secret: string } => Boolean(c.secret),
    );
    const keptCreds = credentials.filter((c) => !c.secret);
    for (const c of keptCreds) {
      const k = sanitizeCredName(c.name);
      if (!existingData[`TOKENIZER_CRED_${k}`] || !existingData[`TOKENIZER_AUTH_${k}`]) {
        throw new Error(`Credential "${c.name}" has no secret and no existing sealed data to preserve`);
      }
    }

    // Validate only the credentials that carry new secrets
    if (newCreds.length > 0) {
      const credError = validateTokenizerCredentials(newCreds);
      if (credError) {
        throw new Error(`Invalid tokenizer credentials: ${credError}`);
      }
    }
    const normalizedNewCreds = normalizeTokenizerCredentials(newCreds);
    const normalizedKeptCreds = normalizeTokenizerCredentials(keptCreds);

    log("Updating tokenizer credentials...");

    // When preserving existing credentials, reuse the same open key so that
    // the preserved sealed blobs remain decryptable by the tokenizer sidecar.
    // A fresh key is only generated when ALL credentials are new.
    let openKey: string;
    if (normalizedKeptCreds.length > 0 && existingData?.TOKENIZER_OPEN_KEY) {
      // Existing data values are base64-encoded by K8s — decode the open key
      openKey = Buffer.from(existingData.TOKENIZER_OPEN_KEY, "base64").toString();
      log("Reusing existing open key for preserved credentials");
    } else {
      openKey = generateTokenizerOpenKey();
    }
    const sealKey = deriveTokenizerSealKey(openKey);
    const sealed = normalizedNewCreds.map((c) => sealCredential(c, sealKey));
    const agentEnv = tokenizerAgentEnv(sealed, sealKey);

    // Carry forward non-tokenizer data and preserved credentials' sealed data
    const preservedData: Record<string, string> = {};
    if (existingData) {
      for (const [k, v] of Object.entries(existingData)) {
        if (!k.startsWith("TOKENIZER_")) {
          preservedData[k] = v; // keep original base64 encoding
        }
      }
    }
    // Preserve sealed tokens and auth for kept credentials
    for (const c of normalizedKeptCreds) {
      const k = sanitizeCredName(c.name);
      preservedData[`TOKENIZER_CRED_${k}`] = existingData[`TOKENIZER_CRED_${k}`];
      preservedData[`TOKENIZER_AUTH_${k}`] = existingData[`TOKENIZER_AUTH_${k}`];
      if (existingData[`TOKENIZER_HOSTS_${k}`]) {
        preservedData[`TOKENIZER_HOSTS_${k}`] = existingData[`TOKENIZER_HOSTS_${k}`];
      }
    }

    // Add new tokenizer data via stringData (Kubernetes encodes these to base64 on apply)
    const newStringData: Record<string, string> = {
      TOKENIZER_OPEN_KEY: openKey,
      ...agentEnv,
    };

    const updatedSecret: k8s.V1Secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: "openclaw-secrets",
        namespace: ns,
        labels: { app: "openclaw" },
        // Preserve resourceVersion for optimistic concurrency control —
        // without it, Kubernetes may reject the replace or silently overwrite
        // concurrent changes.
        resourceVersion: existingSecret.metadata?.resourceVersion,
      },
      data: preservedData,
      stringData: newStringData,
    };
    await core.replaceNamespacedSecret({ name: "openclaw-secrets", namespace: ns, body: updatedSecret });
    log("Secret updated");

    // Update the tokenizer skill inside the existing openclaw-skills ConfigMap.
    // Include both newly sealed and kept credentials so the generated SKILL.md
    // documents all available credentials, not just newly added ones.
    const allCredsForSkill: import("./tokenizer.js").SealedCredential[] = [
      ...sealed,
      ...normalizedKeptCreds.map((c) => ({
        name: c.name,
        allowedHosts: typeof c.allowedHosts === "string" ? [c.allowedHosts] : c.allowedHosts,
        sealedToken: "",
        bearerPassword: "",
      })),
    ];
    const skillMd = generateTokenizerSkill(allCredsForSkill);
    log("Updating tokenizer skill in openclaw-skills ConfigMap...");
    const skillEntries: TreeEntry[] = await loadTextTree(skillsDir()).catch(() => []);
    // Remove any previous tokenizer skill entries and add the fresh one
    const filtered = skillEntries.filter((e) => !e.key.startsWith("tkz-skill"));
    filtered.push({ key: "tkz-skill", path: "tokenizer/SKILL.md", content: skillMd });

    const skillsCm = fileTreeConfigMapManifest(ns, "openclaw-skills", filtered);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-skills", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: skillsCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-skills", namespace: ns, body: skillsCm }),
      "ConfigMap openclaw-skills",
      log,
    );

    // Read current Deployment to find volume indices by name and update env vars
    log("Restarting deployment...");
    const currentDeploy = await apps.readNamespacedDeployment({ name: "openclaw", namespace: ns });
    const volumes = currentDeploy.spec?.template?.spec?.volumes ?? [];
    const skillsVolIdx = volumes.findIndex((v) => v.name === "skills-config");
    if (skillsVolIdx === -1) throw new Error("Volume 'skills-config' not found in Deployment");

    // Build the updated env var list for the gateway container: keep all
    // non-tokenizer env vars, then append the new tokenizer secret refs.
    const containers = currentDeploy.spec?.template?.spec?.containers ?? [];
    const gwIdx = containers.findIndex((c) => c.name === "gateway");
    const gwEnv = gwIdx !== -1 ? (containers[gwIdx].env ?? []) : [];
    const nonTkzEnv = gwEnv.filter((e) => !e.name.startsWith("TOKENIZER_"));
    const allCreds = [...normalizedNewCreds, ...normalizedKeptCreds];
    const newTkzKeys = ["TOKENIZER_PROXY_URL", "TOKENIZER_SEAL_KEY"];
    for (const c of allCreds) {
      const k = sanitizeCredName(c.name);
      newTkzKeys.push(`TOKENIZER_CRED_${k}`, `TOKENIZER_AUTH_${k}`, `TOKENIZER_HOSTS_${k}`);
    }
    const updatedEnv = [
      ...nonTkzEnv,
      ...newTkzKeys.map((key) => ({
        name: key,
        valueFrom: { secretKeyRef: { name: "openclaw-secrets", key, optional: true } },
      })),
    ];

    // Also update the init container env vars so the .env file is correct on restart
    const initContainers = currentDeploy.spec?.template?.spec?.initContainers ?? [];
    const initIdx = initContainers.findIndex((c) => c.name === "init-config");
    const initEnv = initIdx !== -1 ? (initContainers[initIdx].env ?? []) : [];
    const nonTkzInitEnv = initEnv.filter((e) => !e.name.startsWith("TOKENIZER_"));
    const updatedInitEnv = [
      ...nonTkzInitEnv,
      ...newTkzKeys.map((key) => ({
        name: key,
        valueFrom: { secretKeyRef: { name: "openclaw-secrets", key, optional: true } },
      })),
    ];

    const patches: Array<Record<string, unknown>> = [
      {
        op: "replace",
        path: `/spec/template/spec/volumes/${skillsVolIdx}/configMap`,
        value: {
          name: "openclaw-skills",
          items: filtered.map((entry) => ({ key: entry.key, path: entry.path })),
        },
      },
      {
        op: "replace",
        path: "/spec/template/metadata/annotations/openclaw.io~1restart-at",
        value: new Date().toISOString(),
      },
    ];

    // Patch gateway env vars if the gateway container exists
    if (gwIdx !== -1) {
      patches.push({
        op: "replace",
        path: `/spec/template/spec/containers/${gwIdx}/env`,
        value: updatedEnv,
      });
    }

    // Patch init container env vars if the init container exists
    if (initIdx !== -1) {
      patches.push({
        op: "replace",
        path: `/spec/template/spec/initContainers/${initIdx}/env`,
        value: updatedInitEnv,
      });
    }

    try {
      await apps.patchNamespacedDeployment(
        { name: "openclaw", namespace: ns, body: patches },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.JsonPatch),
      );
    } catch (patchErr) {
      // Deployment patch failed — attempt to restore the original Secret so the
      // cluster doesn't end up with a Secret that doesn't match the running Deployment.
      log("Deployment patch failed; rolling back Secret to previous version...");
      try {
        await core.replaceNamespacedSecret({ name: "openclaw-secrets", namespace: ns, body: existingSecret });
        log("Secret rollback succeeded");
      } catch (rollbackErr) {
        log(`Secret rollback also failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
      }
      throw patchErr;
    }

    // Update the saved deploy config
    try {
      const configDir = installerK8sInstanceDir(ns);
      const configPath = join(configDir, "deploy-config.json");
      const saved = JSON.parse(await readFile(configPath, "utf8"));
      saved.tokenizerEnabled = true;
      saved.tokenizerCredentials = allCreds.map((c: { name: string; allowedHosts: string[]; headerDst?: string; headerFmt?: string }) => ({ ...c, secret: "(set)" }));
      writeFileSync(configPath, JSON.stringify(saved, null, 2), { mode: 0o600 });
    } catch {
      log("Could not update saved deploy config");
    }

    log("Tokenizer credentials updated — pod restarting");
  }

  async teardown(result: DeployResult, log: LogCallback): Promise<void> {
    const ns = result.config.namespace || result.containerId || "";
    const core = coreApi();
    const apps = appsApi();
    log(`Deleting resources in namespace ${ns}...`);

    // Delete resources explicitly before namespace to avoid stuck Terminating state.
    const deletes: Array<{ name: string; fn: () => Promise<unknown> }> = [
      { name: "Deployment", fn: () => apps.deleteNamespacedDeployment({ name: "openclaw", namespace: ns }) },
      { name: "Service", fn: () => core.deleteNamespacedService({ name: "openclaw", namespace: ns }) },
      { name: "Secret openclaw-secrets", fn: () => core.deleteNamespacedSecret({ name: "openclaw-secrets", namespace: ns }) },
      { name: "Secret gcp-sa", fn: () => core.deleteNamespacedSecret({ name: "gcp-sa", namespace: ns }) },
      { name: "ConfigMap openclaw-config", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-config", namespace: ns }) },
      { name: "ConfigMap openclaw-agent", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-agent", namespace: ns }) },
      { name: "ConfigMap openclaw-agent-tree", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-agent-tree", namespace: ns }) },
      { name: "ConfigMap openclaw-skills", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-skills", namespace: ns }) },
      { name: "ConfigMap openclaw-cron", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-cron", namespace: ns }) },
      { name: "ConfigMap litellm-config", fn: () => core.deleteNamespacedConfigMap({ name: "litellm-config", namespace: ns }) },
      { name: "ConfigMap otel-collector-config", fn: () => core.deleteNamespacedConfigMap({ name: "otel-collector-config", namespace: ns }) },

      { name: "OpenTelemetryCollector openclaw-sidecar", fn: async () => {
        const customApi = loadKubeConfig().makeApiClient(k8s.CustomObjectsApi);
        await customApi.deleteNamespacedCustomObject({
          group: "opentelemetry.io", version: "v1beta1", namespace: ns,
          plural: "opentelemetrycollectors", name: "openclaw-sidecar",
        });
      }},
      { name: "PVC", fn: () => core.deleteNamespacedPersistentVolumeClaim({ name: "openclaw-home-pvc", namespace: ns }) },
    ];

    for (const { name, fn } of deletes) {
      try {
        await fn();
        log(`Deleted ${name}`);
      } catch {
        // Resource may not exist — that's fine
      }
    }

    log(`Deleting namespace ${ns}...`);
    try {
      await core.deleteNamespace({ name: ns });
      log(`Namespace ${ns} deleted`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Warning: ${message}`);
    }
  }
}
