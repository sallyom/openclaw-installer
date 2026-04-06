import * as k8s from "@kubernetes/client-node";
import http from "node:http";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { coreApi, appsApi, loadKubeConfig, hasOtelOperator, k8sApiHttpCode } from "../services/k8s.js";
import { ensureK8sPortForward } from "../services/k8s-port-forward.js";
import { deriveInstanceStatus, derivePodInfo } from "./k8s-discovery.js";
import { cronJobsFile, installerK8sInstanceDir, skillsDir } from "../paths.js";
import { loadTextTree } from "../state-tree.js";
import type {
  Deployer,
  DeployConfig,
  DeployResult,
  LogCallback,
} from "./types.js";
import { namespaceName, agentId, deriveModel, detectUnavailableProvider, generateToken, usesDefaultEnvSecretRef } from "./k8s-helpers.js";
import { loadWorkspaceFiles } from "./k8s-agent.js";
import { loadAgentSourceBundle, loadAgentSourceCronJobs, loadAgentSourceExecApprovals, loadAgentSourceWorkspaceTree, mainWorkspaceShellCondition } from "./agent-source.js";
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
import {
  a2aBridgeConfigMapManifest,
  a2aKeycloakNamespace,
  a2aNamespacePatch,
  a2aRealm,
  a2aServiceAccountManifest,
  agentCardDataConfigMapManifest,
  agentCardManifest,
  authbridgeConfigMapManifest,
  builtInA2aSkillEntries,
  envoyConfigMapManifest,
  environmentsConfigMapManifest,
  spiffeHelperConfigMapManifest,
} from "./k8s-a2a.js";
import { shouldUseLitellmProxy, generateLitellmMasterKey, generateLitellmConfig } from "./litellm.js";
import { shouldUseOtel, generateOtelConfig, generateOtelConfigObject } from "./otel.js";

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

// ── Gateway readiness check ──────────────────────────────────────

function checkGatewayReady(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const req = http.get(url, { timeout: 1000 }, (res) => {
      if (settled) return;
      settled = true;
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => {
      if (settled) return;
      settled = true;
      resolve(false);
    });
    req.on("timeout", () => req.destroy());
  });
}

// ── Deployer implementation ────────────────────────────────────────

export class KubernetesDeployer implements Deployer {
  /** Tracks namespaces whose gateway has been confirmed healthy. */
  private gatewayHealthy = new Map<string, { readyReplicas: number }>();

  async deploy(config: DeployConfig, log: LogCallback): Promise<DeployResult> {
    const id = uuid();
    const ns = namespaceName(config);
    const gatewayToken = generateToken();
    const core = coreApi();
    const apps = appsApi();
    log(`Deploying OpenClaw to namespace: ${ns}`);

    // Load workspace files (prefers user-customized from ~/.openclaw/workspace-*)
    const { files: workspaceFiles } = loadWorkspaceFiles(config, log);
    const skillEntries = await loadTextTree(skillsDir()).catch(() => []);
    const effectiveSkillEntries = config.withA2a ? builtInA2aSkillEntries(skillEntries) : skillEntries;
    const agentTreeEntries = await loadAgentSourceWorkspaceTree(config.agentSourceDir).catch(() => []);
    const cronJobsContent = loadAgentSourceCronJobs(config.agentSourceDir)
      ?? await readFile(cronJobsFile(), "utf8").catch(() => undefined);
    const execApprovalsContent = loadAgentSourceExecApprovals(config.agentSourceDir);

    // 1. Namespace
    await applyNamespace(core, ns, log);
    if (config.withA2a) {
      log(`Labeling namespace ${ns} for Kagenti injection...`);
      await core.patchNamespace(
        { name: ns, body: a2aNamespacePatch(ns) },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      );
      log(`Namespace ${ns} labeled for Kagenti`);
    }

    if (config.withA2a) {
      if (config.mode === "openshift") {
        log("OpenShift A2A: leaving ServiceAccount openclaw-oauth-proxy to the OpenShift plugin so OAuth redirect annotations are preserved");
      } else {
        const sa = a2aServiceAccountManifest(ns);
        await applyResource(
          () => core.readNamespacedServiceAccount({ name: "openclaw-oauth-proxy", namespace: ns }),
          () => core.createNamespacedServiceAccount({ namespace: ns, body: sa }),
          () => core.replaceNamespacedServiceAccount({ name: "openclaw-oauth-proxy", namespace: ns, body: sa }),
          "ServiceAccount openclaw-oauth-proxy",
          log,
        );
      }
    }

    if (config.withA2a) {
      const a2aConfigMaps: Array<{ name: string; body: k8s.V1ConfigMap }> = [];

      if (config.mode === "openshift") {
        log("OpenShift A2A assumes setup-kagenti.sh is already installed; relying on the Kagenti namespace controller for SCC and Kagenti namespace ConfigMaps");
      } else {
        const realm = a2aRealm(config);
        const kcNs = a2aKeycloakNamespace(config);
        const internalKeycloakUrl = `http://keycloak-service.${kcNs}.svc.cluster.local:8080`;
        const issuerBaseUrl = internalKeycloakUrl;
        let adminUsername = "admin";
        let adminPassword = "admin";

        try {
          const secret = await core.readNamespacedSecret({ name: "keycloak-initial-admin", namespace: kcNs });
          const data = secret.data || {};
          if (data.username) adminUsername = Buffer.from(data.username, "base64").toString("utf8");
          if (data.password) adminPassword = Buffer.from(data.password, "base64").toString("utf8");
        } catch {
          log("Keycloak admin secret not found; falling back to default admin credentials in A2A config");
        }

        a2aConfigMaps.push(
          {
            name: "ConfigMap environments",
            body: environmentsConfigMapManifest(ns, realm, kcNs, adminUsername, adminPassword),
          },
          {
            name: "ConfigMap authbridge-config",
            body: authbridgeConfigMapManifest(ns, realm, issuerBaseUrl, kcNs),
          },
          { name: "ConfigMap envoy-config", body: envoyConfigMapManifest(ns) },
          { name: "ConfigMap spiffe-helper-config", body: spiffeHelperConfigMapManifest(ns) },
        );
      }

      a2aConfigMaps.push(
        { name: "ConfigMap openclaw-agent-card", body: agentCardDataConfigMapManifest(ns) },
        { name: "ConfigMap a2a-bridge", body: a2aBridgeConfigMapManifest(ns) },
      );

      for (const { name, body } of a2aConfigMaps) {
        await applyResource(
          () => core.readNamespacedConfigMap({ name: body.metadata!.name!, namespace: ns }),
          () => core.createNamespacedConfigMap({ namespace: ns, body }),
          () => core.replaceNamespacedConfigMap({ name: body.metadata!.name!, namespace: ns, body }),
          name,
          log,
        );
      }
    }

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

    // Fix for #67: warn when bundle subagent models reference unavailable providers
    const sourceBundle = loadAgentSourceBundle(config);
    if (sourceBundle?.agents) {
      const deployModel = deriveModel(config);
      for (const entry of sourceBundle.agents) {
        if (entry.model?.primary && detectUnavailableProvider(entry.model.primary, config)) {
          log(`WARNING: Subagent "${entry.id}" prefers model "${entry.model.primary}" but that provider does not appear to be configured. The deploy-time model "${deployModel}" has been added as a fallback.`);
        }
      }
    }

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

    const skillsCm = fileTreeConfigMapManifest(ns, "openclaw-skills", effectiveSkillEntries);
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

    const execApprovalsCm = fileConfigMapManifest(ns, "openclaw-exec-approvals", "exec-approvals.json", execApprovalsContent);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-exec-approvals", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: execApprovalsCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-exec-approvals", namespace: ns, body: execApprovalsCm }),
      "ConfigMap openclaw-exec-approvals",
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
    const secret = secretManifest(ns, config, gatewayToken, litellmMasterKey);
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
    const svc = serviceManifest(ns, config);
    await applyResource(
      () => core.readNamespacedService({ name: "openclaw", namespace: ns }),
      () => core.createNamespacedService({ namespace: ns, body: svc }),
      () => core.replaceNamespacedService({ name: "openclaw", namespace: ns, body: svc }),
      "Service openclaw",
      log,
    );

    // 7. Deployment
    const dep = deploymentManifest(ns, config, otelViaOperator, effectiveSkillEntries, agentTreeEntries, cronJobsContent, execApprovalsContent);
    await applyResource(
      () => apps.readNamespacedDeployment({ name: "openclaw", namespace: ns }),
      () => apps.createNamespacedDeployment({ namespace: ns, body: dep }),
      () => apps.replaceNamespacedDeployment({ name: "openclaw", namespace: ns, body: dep }),
      "Deployment openclaw",
      log,
    );

    if (config.withA2a) {
      const agentCard = agentCardManifest(ns);
      const customApi = loadKubeConfig().makeApiClient(k8s.CustomObjectsApi);
      const agentCardParams = {
        group: "agent.kagenti.dev",
        version: "v1alpha1",
        namespace: ns,
        plural: "agentcards",
      };
      try {
        await customApi.getNamespacedCustomObject({ ...agentCardParams, name: "openclaw-agent-card" });
        log("Updating AgentCard openclaw-agent-card...");
        await customApi.replaceNamespacedCustomObject({
          ...agentCardParams,
          name: "openclaw-agent-card",
          body: agentCard,
        });
      } catch {
        log("Creating AgentCard openclaw-agent-card...");
        await customApi.createNamespacedCustomObject({ ...agentCardParams, body: agentCard });
      }
      log("AgentCard openclaw-agent-card applied");
    }

    const url = `(use: kubectl port-forward svc/openclaw 18789:18789 -n ${ns})`;

    log(`OpenClaw deployed to ${ns}`);
    log(`Access via port-forward: kubectl port-forward svc/openclaw 18789:18789 -n ${ns}`);
    log("Use the Open action from the Instances page to open with the saved token");

    // Save deploy config for re-deploy (strip secrets, keep references)
    try {
      const configDir = installerK8sInstanceDir(ns);
      mkdirSync(configDir, { recursive: true });
      const savedConfig = {
        ...config,
        namespace: ns,
        // Strip secret values — they're in the cluster, not needed on disk
        anthropicApiKey:
          config.anthropicApiKey && (!config.anthropicApiKeyRef || usesDefaultEnvSecretRef(config.anthropicApiKeyRef))
            ? config.anthropicApiKey
            : (config.anthropicApiKey ? "(set)" : undefined),
        openaiApiKey:
          config.openaiApiKey && (!config.openaiApiKeyRef || usesDefaultEnvSecretRef(config.openaiApiKeyRef))
            ? config.openaiApiKey
            : (config.openaiApiKey ? "(set)" : undefined),
        modelEndpointApiKey: config.modelEndpointApiKey || undefined,
        gcpServiceAccountJson: config.gcpServiceAccountJson ? "(set)" : undefined,
        telegramBotToken:
          config.telegramBotToken && (!config.telegramBotTokenRef || usesDefaultEnvSecretRef(config.telegramBotTokenRef))
            ? config.telegramBotToken
            : (config.telegramBotToken ? "(set)" : undefined),
        secretsProvidersJson: config.secretsProvidersJson,
        anthropicApiKeyRef: config.anthropicApiKeyRef,
        openaiApiKeyRef: config.openaiApiKeyRef,
        telegramBotTokenRef: config.telegramBotTokenRef,
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
      config: { ...config, namespace: ns },
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
      const core = coreApi();
      const dep = await apps.readNamespacedDeployment({ name: "openclaw", namespace: ns });
      const replicas = dep.spec?.replicas ?? 1;
      const readyReplicas = dep.status?.readyReplicas ?? 0;

      if (replicas === 0) {
        this.gatewayHealthy.delete(ns);
        return { ...result, status: "stopped" };
      }

      // Fetch pods for accurate status derivation
      const podList = await core.listNamespacedPod({
        namespace: ns,
        labelSelector: "app=openclaw",
      });
      const pods = podList.items.map(derivePodInfo);
      const { status, statusDetail } = deriveInstanceStatus(replicas, readyReplicas, pods);

      if (status !== "running") {
        this.gatewayHealthy.delete(ns);
        return { ...result, status, statusDetail, url: undefined, pods };
      }

      try {
        const { url } = await ensureK8sPortForward(ns);

        // Skip the HTTP probe if gateway was already confirmed healthy
        // and readyReplicas hasn't dropped (e.g. pod restart).
        const cached = this.gatewayHealthy.get(ns);
        if (cached && readyReplicas >= cached.readyReplicas) {
          return { ...result, status: "running", url, statusDetail, pods };
        }

        const ready = await checkGatewayReady(url);
        if (ready) {
          this.gatewayHealthy.set(ns, { readyReplicas });
          return { ...result, status: "running", url, statusDetail, pods };
        }
        return { ...result, status: "deploying", statusDetail: "Gateway starting...", url: undefined, pods };
      } catch {
        return { ...result, status: "running", statusDetail: "Running (port-forward unavailable)", pods };
      }
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
    const skillEntries = await loadTextTree(skillsDir()).catch(() => []);
    const effectiveSkillEntries = result.config.withA2a ? builtInA2aSkillEntries(skillEntries) : skillEntries;
    const agentTreeEntries = await loadAgentSourceWorkspaceTree(result.config.agentSourceDir).catch(() => []);
    const cronJobsContent = loadAgentSourceCronJobs(result.config.agentSourceDir)
      ?? await readFile(cronJobsFile(), "utf8").catch(() => undefined);
    const execApprovalsContent = loadAgentSourceExecApprovals(result.config.agentSourceDir);
    if (!fromHost) {
      log("No custom agent files found — using generated defaults");
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

    const skillsCm = fileTreeConfigMapManifest(ns, "openclaw-skills", effectiveSkillEntries);
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

    const execApprovalsCm = fileConfigMapManifest(ns, "openclaw-exec-approvals", "exec-approvals.json", execApprovalsContent);
    await applyResource(
      () => core.readNamespacedConfigMap({ name: "openclaw-exec-approvals", namespace: ns }),
      () => core.createNamespacedConfigMap({ namespace: ns, body: execApprovalsCm }),
      () => core.replaceNamespacedConfigMap({ name: "openclaw-exec-approvals", namespace: ns, body: execApprovalsCm }),
      "ConfigMap openclaw-exec-approvals",
      log,
    );

    // Update the init container script to always copy agent files (removes
    // the "if not exists" guard from older deploys) and restart the pod
    const id = agentId(result.config);
    const agentFiles = ["AGENTS.md", "agent.json", "SOUL.md", "IDENTITY.md", "TOOLS.md", "USER.md", "HEARTBEAT.md", "MEMORY.md"];
    const copyLines = agentFiles
      .map((f) => `cp /agents/${f} /home/node/.openclaw/workspace-${id}/${f} 2>/dev/null || true`)
      .join("\n");

    // Fix for #62: use bundle-aware routing so persona-named workspaces map to the main agent
    const mainWorkspaceDest = `/home/node/.openclaw/workspace-${id}`;
    const workspaceRouting = mainWorkspaceShellCondition(mainWorkspaceDest, loadAgentSourceBundle(result.config));

    const initScript = `
cp /config/openclaw.json /home/node/.openclaw/openclaw.json
chmod 644 /home/node/.openclaw/openclaw.json
mkdir -p /home/node/.openclaw/workspace
mkdir -p /home/node/.openclaw/skills
mkdir -p /home/node/.openclaw/cron
mkdir -p /home/node/.openclaw/workspace-${id}
${copyLines}
find -L /agents-tree -mindepth 1 -type d -name 'workspace-*' -exec sh -c 'base="$(basename "$1")"; ${workspaceRouting}; mkdir -p "$dest"; cp -r "$1"/* "$dest"/ 2>/dev/null || true' _ {} \\;
cp -r /skills-src/. /home/node/.openclaw/skills/ 2>/dev/null || true
cp /cron-src/jobs.json /home/node/.openclaw/cron/jobs.json 2>/dev/null || true
chgrp -R 0 /home/node/.openclaw 2>/dev/null || true
chmod -R g=u /home/node/.openclaw 2>/dev/null || true
echo "Config initialized"
`.trim();

    // Use JSON Patch to update the init container command and restart annotation
    const patches = [
      {
        op: "replace",
        path: "/spec/template/spec/initContainers/0/command",
        value: ["sh", "-c", initScript],
      },
      {
        op: "replace",
        path: "/spec/template/spec/volumes/3/configMap",
        value: {
          name: "openclaw-skills",
          ...(effectiveSkillEntries.length > 0
            ? { items: effectiveSkillEntries.map((entry) => ({ key: entry.key, path: entry.path })) }
            : {}),
        },
      },
      {
        op: "replace",
        path: "/spec/template/spec/volumes/4/configMap",
        value: {
          name: "openclaw-cron",
          ...(cronJobsContent !== undefined
            ? { items: [{ key: "jobs.json", path: "jobs.json" }] }
            : {}),
        },
      },
      {
        op: "replace",
        path: "/spec/template/spec/volumes/6/configMap",
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

  async teardown(result: DeployResult, log: LogCallback): Promise<void> {
    const ns = result.config.namespace || result.containerId || "";
    const core = coreApi();
    const apps = appsApi();
    log(`Deleting resources in namespace ${ns}...`);

    // Delete resources explicitly before namespace to avoid stuck Terminating state.
    const deletes: Array<{ name: string; fn: () => Promise<unknown> }> = [
      { name: "Deployment", fn: () => apps.deleteNamespacedDeployment({ name: "openclaw", namespace: ns }) },
      { name: "Service", fn: () => core.deleteNamespacedService({ name: "openclaw", namespace: ns }) },
      { name: "ServiceAccount openclaw-oauth-proxy", fn: () => core.deleteNamespacedServiceAccount({ name: "openclaw-oauth-proxy", namespace: ns }) },
      { name: "Secret openclaw-secrets", fn: () => core.deleteNamespacedSecret({ name: "openclaw-secrets", namespace: ns }) },
      { name: "Secret gcp-sa", fn: () => core.deleteNamespacedSecret({ name: "gcp-sa", namespace: ns }) },
      { name: "ConfigMap openclaw-config", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-config", namespace: ns }) },
      { name: "ConfigMap openclaw-agent", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-agent", namespace: ns }) },
      { name: "ConfigMap openclaw-agent-tree", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-agent-tree", namespace: ns }) },
      { name: "ConfigMap openclaw-skills", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-skills", namespace: ns }) },
      { name: "ConfigMap openclaw-cron", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-cron", namespace: ns }) },
      { name: "ConfigMap openclaw-exec-approvals", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-exec-approvals", namespace: ns }) },
      { name: "ConfigMap environments", fn: () => core.deleteNamespacedConfigMap({ name: "environments", namespace: ns }) },
      { name: "ConfigMap authbridge-config", fn: () => core.deleteNamespacedConfigMap({ name: "authbridge-config", namespace: ns }) },
      { name: "ConfigMap envoy-config", fn: () => core.deleteNamespacedConfigMap({ name: "envoy-config", namespace: ns }) },
      { name: "ConfigMap spiffe-helper-config", fn: () => core.deleteNamespacedConfigMap({ name: "spiffe-helper-config", namespace: ns }) },
      { name: "ConfigMap openclaw-agent-card", fn: () => core.deleteNamespacedConfigMap({ name: "openclaw-agent-card", namespace: ns }) },
      { name: "ConfigMap a2a-bridge", fn: () => core.deleteNamespacedConfigMap({ name: "a2a-bridge", namespace: ns }) },
      { name: "ConfigMap litellm-config", fn: () => core.deleteNamespacedConfigMap({ name: "litellm-config", namespace: ns }) },
      { name: "ConfigMap otel-collector-config", fn: () => core.deleteNamespacedConfigMap({ name: "otel-collector-config", namespace: ns }) },
      { name: "AgentCard openclaw-agent-card", fn: async () => {
        const customApi = loadKubeConfig().makeApiClient(k8s.CustomObjectsApi);
        await customApi.deleteNamespacedCustomObject({
          group: "agent.kagenti.dev", version: "v1alpha1", namespace: ns,
          plural: "agentcards", name: "openclaw-agent-card",
        });
      }},
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
