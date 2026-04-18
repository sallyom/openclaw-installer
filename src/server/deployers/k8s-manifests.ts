import * as k8s from "@kubernetes/client-node";
import {
  defaultImage,
  agentId,
  tryParseProjectId,
  buildOpenClawConfig,
  buildManagedAgentAuthProfiles,
  buildManagedAgentAuthProfilesSecretJson,
  resolveEnvSecretRefId,
} from "./k8s-helpers.js";
import type { DeployConfig } from "./types.js";
import { shouldUseLitellmProxy, LITELLM_IMAGE, LITELLM_PORT } from "./litellm.js";
import { shouldUseOtel, OTEL_COLLECTOR_IMAGE, OTEL_GRPC_PORT, OTEL_HTTP_PORT, otelAgentEnv } from "./otel.js";
import { shouldUseChromiumSidecar, CHROMIUM_IMAGE, CHROMIUM_CDP_PORT, chromiumAgentEnv } from "./chromium.js";
import type { TreeEntry } from "../state-tree.js";
import { loadAgentSourceBundle, mainWorkspaceShellCondition } from "./agent-source.js";
import {
  buildManagedVaultHelperScript,
  OPENCLAW_SERVICE_ACCOUNT_NAME,
} from "./vault-helper.js";
import { CODEX_AUTH_PROFILES_SECRET_KEY } from "./codex-oauth.js";

export function namespaceManifest(ns: string): k8s.V1Namespace {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: ns, labels: { "app.kubernetes.io/managed-by": "openclaw-installer" } },
  };
}

export function pvcManifest(ns: string): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: "openclaw-home-pvc",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: "10Gi" } },
    },
  };
}

export function serviceAccountManifest(ns: string): k8s.V1ServiceAccount {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: OPENCLAW_SERVICE_ACCOUNT_NAME,
      namespace: ns,
      labels: { app: "openclaw" },
    },
  };
}

export function configMapManifest(ns: string, config: DeployConfig, gatewayToken: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "openclaw-config",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: {
      "openclaw.json": JSON.stringify(buildOpenClawConfig(config, gatewayToken)),
    },
  };
}

export function agentConfigMapManifest(ns: string, config: DeployConfig, workspaceFiles: Record<string, string>): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "openclaw-agent",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: workspaceFiles,
  };
}

export function fileTreeConfigMapManifest(ns: string, name: string, entries: TreeEntry[]): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: Object.fromEntries(entries.map((entry) => [entry.key, entry.content])),
  };
}

export function fileConfigMapManifest(ns: string, name: string, filename: string, content?: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: content !== undefined ? { [filename]: content } : {},
  };
}

export function gcpSaSecretManifest(ns: string, saJson: string): k8s.V1Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "gcp-sa",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    stringData: { "sa.json": saJson },
  };
}

export function litellmConfigMapManifest(ns: string, configYaml: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "litellm-config",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: { "config.yaml": configYaml },
  };
}

export function otelConfigMapManifest(ns: string, configYaml: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "otel-collector-config",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: { "config.yaml": configYaml },
  };
}

export function secretManifest(ns: string, config: DeployConfig, gatewayToken: string, litellmMasterKey?: string): k8s.V1Secret {
  const data: Record<string, string> = {
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
  };
  const anthropicEnvRefId = resolveEnvSecretRefId(config.anthropicApiKeyRef, "ANTHROPIC_API_KEY");
  if (config.anthropicApiKey && anthropicEnvRefId) {
    data[anthropicEnvRefId] = config.anthropicApiKey;
  }
  const openaiEnvRefId = resolveEnvSecretRefId(config.openaiApiKeyRef, "OPENAI_API_KEY");
  if (config.openaiApiKey && openaiEnvRefId) {
    data[openaiEnvRefId] = config.openaiApiKey;
  }
  const googleEnvRefId = resolveEnvSecretRefId(config.googleApiKeyRef, "GEMINI_API_KEY");
  if (config.googleApiKey && googleEnvRefId) {
    data[googleEnvRefId] = config.googleApiKey;
  }
  const openrouterEnvRefId = resolveEnvSecretRefId(config.openrouterApiKeyRef, "OPENROUTER_API_KEY");
  if (config.openrouterApiKey && openrouterEnvRefId) {
    data[openrouterEnvRefId] = config.openrouterApiKey;
  }
  if (config.modelEndpoint) data.MODEL_ENDPOINT = config.modelEndpoint;
  if (config.modelEndpointApiKey) data.MODEL_ENDPOINT_API_KEY = config.modelEndpointApiKey;
  const authProfilesJson = buildManagedAgentAuthProfilesSecretJson(config);
  if (authProfilesJson) data[CODEX_AUTH_PROFILES_SECRET_KEY] = authProfilesJson;
  const telegramEnvRefId = resolveEnvSecretRefId(config.telegramBotTokenRef, "TELEGRAM_BOT_TOKEN");
  if (config.telegramBotToken && telegramEnvRefId) {
    data[telegramEnvRefId] = config.telegramBotToken;
  }

  // Resolve project ID from config or from the SA JSON
  const projectId = config.googleCloudProject
    || (config.gcpServiceAccountJson ? tryParseProjectId(config.gcpServiceAccountJson) : "");
  if (projectId) data.GOOGLE_CLOUD_PROJECT = projectId;
  if (config.googleCloudLocation) data.GOOGLE_CLOUD_LOCATION = config.googleCloudLocation;
  if (litellmMasterKey) data.LITELLM_MASTER_KEY = litellmMasterKey;
  if (config.sandboxEnabled) {
    if (config.sandboxSshIdentity) data.SSH_IDENTITY = config.sandboxSshIdentity;
    if (config.sandboxSshCertificate) data.SSH_CERTIFICATE = config.sandboxSshCertificate;
    if (config.sandboxSshKnownHosts) data.SSH_KNOWN_HOSTS = config.sandboxSshKnownHosts;
  }

  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "openclaw-secrets",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    stringData: data,
  };
}

export function serviceManifest(ns: string, config: DeployConfig): k8s.V1Service {
  const withA2a = Boolean(config.withA2a);
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: "openclaw",
      namespace: ns,
      labels: {
        app: "openclaw",
        ...(withA2a
          ? {
              "kagenti.io/type": "agent",
              "kagenti.io/protocol": "a2a",
              "app.kubernetes.io/name": "openclaw",
            }
          : {}),
      },
      annotations: {
        ...(withA2a ? { "kagenti.io/description": "OpenClaw AI Agent Gateway" } : {}),
      },
    },
    spec: {
      type: "ClusterIP",
      selector: { app: "openclaw" },
      ports: [
        ...(withA2a
          ? [
              { name: "a2a", port: 8080, targetPort: "a2a" as unknown as k8s.IntOrString, protocol: "TCP" as const },
            ]
          : []),
        { name: "gateway", port: 18789, targetPort: 18789 as unknown as k8s.IntOrString, protocol: "TCP" },
        ...(withA2a
          ? [
              { name: "bridge", port: 18790, targetPort: 18790 as unknown as k8s.IntOrString, protocol: "TCP" as const },
            ]
          : []),
      ],
    },
  };
}

export function buildInitScript(config: DeployConfig): string {
  const id = agentId(config);
  const bundle = loadAgentSourceBundle(config);
  const agentFiles = ["AGENTS.md", "agent.json", "SOUL.md", "IDENTITY.md", "TOOLS.md", "USER.md", "HEARTBEAT.md", "MEMORY.md"];
  const copyLines = agentFiles
    .map((f) => `  cp /agents/${f} /home/node/.openclaw/workspace-${id}/${f} 2>/dev/null || true`)
    .join("\n");

  const mainWorkspaceDest = `/home/node/.openclaw/workspace-${id}`;
  const workspaceRouting = mainWorkspaceShellCondition(mainWorkspaceDest, bundle);
  const vaultHelperScript = buildManagedVaultHelperScript();
  const authProfiles = buildManagedAgentAuthProfiles(config);
  const authProfilesSecretJson = buildManagedAgentAuthProfilesSecretJson(config);
  const authManagedAgentIds = Array.from(new Set([id, ...((bundle?.agents || []).map((entry) => entry.id).filter(Boolean))]));
  const authProfileLines = authProfilesSecretJson
    ? authManagedAgentIds
      .map((agentId) => [
        `mkdir -p /home/node/.openclaw/agents/${agentId}/agent`,
        `if [ -f /openclaw-secrets/${CODEX_AUTH_PROFILES_SECRET_KEY} ]; then cp /openclaw-secrets/${CODEX_AUTH_PROFILES_SECRET_KEY} /home/node/.openclaw/agents/${agentId}/agent/auth-profiles.json; fi`,
        `chmod 600 /home/node/.openclaw/agents/${agentId}/agent/auth-profiles.json 2>/dev/null || true`,
      ].join("\n"))
      .join("\n")
    : authProfiles
      ? authManagedAgentIds
      .map((agentId) => [
        `mkdir -p /home/node/.openclaw/agents/${agentId}/agent`,
        `cat > /home/node/.openclaw/agents/${agentId}/agent/auth-profiles.json <<'EOF_AUTH_PROFILES'`,
        JSON.stringify(authProfiles, null, 2),
        "EOF_AUTH_PROFILES",
        `chmod 600 /home/node/.openclaw/agents/${agentId}/agent/auth-profiles.json`,
      ].join("\n"))
      .join("\n")
      : "";

  return `
cp /config/openclaw.json /home/node/.openclaw/openclaw.json
chmod 600 /home/node/.openclaw/openclaw.json
mkdir -p /home/node/.openclaw/bin
mkdir -p /home/node/.openclaw/workspace
mkdir -p /home/node/.openclaw/skills
mkdir -p /home/node/.openclaw/cron
mkdir -p /home/node/.openclaw/workspace-${id}
cat > /home/node/.openclaw/bin/openclaw-vault <<'EOF_VAULT_HELPER'
${vaultHelperScript}
EOF_VAULT_HELPER
chmod 0755 /home/node/.openclaw/bin/openclaw-vault
${copyLines}
for dir in /agents-tree/workspace-*; do
  [ -d "$dir" ] || continue
  base="$(basename "$dir")"
  ${workspaceRouting}
  mkdir -p "$dest"
  cp -r "$dir"/. "$dest"/ 2>/dev/null || true
done
cp -r /skills-src/. /home/node/.openclaw/skills/ 2>/dev/null || true
cp /cron-src/jobs.json /home/node/.openclaw/cron/jobs.json 2>/dev/null || true
cp /exec-approvals-src/exec-approvals.json /home/node/.openclaw/exec-approvals.json 2>/dev/null || true
${authProfileLines}
chown -R 1000:0 /home/node/.openclaw 2>/dev/null || true
chmod -R g=u /home/node/.openclaw 2>/dev/null || true
chmod -R o-rwx /home/node/.openclaw 2>/dev/null || true
chmod 0755 /home/node/.openclaw/bin/openclaw-vault 2>/dev/null || true
echo "Config initialized"
`.trim();
}

export function deploymentManifest(
  ns: string,
  config: DeployConfig,
  otelViaOperator = false,
  skillEntries: TreeEntry[] = [],
  agentTreeEntries: TreeEntry[] = [],
  cronJobsContent?: string,
  _execApprovalsContent?: string,
): k8s.V1Deployment {
  const image = defaultImage(config);

  const envVars: k8s.V1EnvVar[] = [
    { name: "HOME", value: "/home/node" },
    { name: "NODE_ENV", value: "production" },
    { name: "OPENCLAW_CONFIG_DIR", value: "/home/node/.openclaw" },
    { name: "OPENCLAW_STATE_DIR", value: "/home/node/.openclaw" },
    {
      name: "OPENCLAW_GATEWAY_TOKEN",
      valueFrom: { secretKeyRef: { name: "openclaw-secrets", key: "OPENCLAW_GATEWAY_TOKEN" } },
    },
  ];

  const useProxy = shouldUseLitellmProxy(config);
  const useOtel = shouldUseOtel(config);
  const withA2a = Boolean(config.withA2a);
  // Direct sidecar only when OTEL is enabled and operator is NOT handling it
  const useOtelDirect = useOtel && !otelViaOperator;
  const useChromium = shouldUseChromiumSidecar(config);

  const optionalKeys = [
    // Gateway always gets provider API keys so it can route to OpenAI/Anthropic
    // natively. LiteLLM only handles Vertex models.
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "MODEL_ENDPOINT",
    "MODEL_ENDPOINT_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    // In proxy mode LiteLLM gets project/location from its config.yaml;
    // the gateway doesn't need them.
    ...(!useProxy ? ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"] : []),
    "SSH_IDENTITY",
    "SSH_CERTIFICATE",
    "SSH_KNOWN_HOSTS",
  ];
  for (const key of optionalKeys) {
    envVars.push({
      name: key,
      valueFrom: { secretKeyRef: { name: "openclaw-secrets", key, optional: true } },
    });
  }

  // OTEL collector env vars (tell the agent where to send traces)
  if (useOtel) {
    for (const [key, val] of Object.entries(otelAgentEnv())) {
      envVars.push({ name: key, value: val });
    }
  }

  // Chromium CDP env var (tell the agent where to connect to the browser)
  if (useChromium) {
    for (const [key, val] of Object.entries(chromiumAgentEnv())) {
      envVars.push({ name: key, value: val });
    }
  }

  if (config.vertexEnabled && useProxy) {
    // LiteLLM proxy mode: provider config in openclaw.json points to the sidecar,
    // just need the API key for authentication
    envVars.push({
      name: "LITELLM_API_KEY",
      valueFrom: { secretKeyRef: { name: "openclaw-secrets", key: "LITELLM_MASTER_KEY", optional: true } },
    });
  } else if (config.vertexEnabled) {
    // Direct Vertex mode (legacy): gateway gets GCP creds directly
    envVars.push({ name: "VERTEX_ENABLED", value: "true" });
    envVars.push({ name: "VERTEX_PROVIDER", value: config.vertexProvider || "anthropic" });
    if (config.gcpServiceAccountJson) {
      envVars.push({ name: "GOOGLE_APPLICATION_CREDENTIALS", value: "/home/node/gcp/sa.json" });
    }
  }

  const initScript = buildInitScript(config);

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "openclaw",
      namespace: ns,
      labels: {
        app: "openclaw",
        "app.kubernetes.io/managed-by": "openclaw-installer",
        "openclaw.prefix": (config.prefix || "openclaw").toLowerCase(),
        "openclaw.agent": config.agentName.toLowerCase(),
        ...(withA2a
          ? {
              "kagenti.io/type": "agent",
              "kagenti.io/protocol": "a2a",
              "kagenti.io/framework": "OpenClaw",
              "app.kubernetes.io/name": "openclaw",
              "app.kubernetes.io/component": "agent",
            }
          : {}),
      },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "openclaw" } },
      strategy: { type: "Recreate" },
      template: {
        metadata: {
          labels: {
            app: "openclaw",
            ...(withA2a
              ? {
                  "kagenti.io/type": "agent",
                  "kagenti.io/protocol": "a2a",
                  "kagenti.io/inject": "enabled",
                }
              : {}),
          },
          annotations: {
            "openclaw.io/restart-at": new Date().toISOString(),
            // When OTel Operator is available, it injects the collector sidecar
            ...(otelViaOperator ? { "sidecar.opentelemetry.io/inject": "openclaw-sidecar" } : {}),
            ...(withA2a
              ? {
                  "kagenti.io/description": "OpenClaw AI Agent Gateway",
                  "kagenti.io/outbound-ports-exclude": "443,4317,4318,18789",
                  "kagenti.io/inbound-ports-exclude": "8080,8443,18789,18790",
                }
              : {}),
          },
        },
        spec: {
          serviceAccountName: withA2a ? "openclaw-oauth-proxy" : OPENCLAW_SERVICE_ACCOUNT_NAME,
          initContainers: [
            {
              name: "init-config",
              image: "registry.access.redhat.com/ubi9-minimal:latest",
              imagePullPolicy: "IfNotPresent",
              command: ["sh", "-c", initScript],
              resources: {
                requests: { memory: "64Mi", cpu: "50m" },
                limits: { memory: "128Mi", cpu: "200m" },
              },
              volumeMounts: [
                { name: "openclaw-home", mountPath: "/home/node/.openclaw" },
                { name: "config-template", mountPath: "/config" },
                { name: "openclaw-secrets", mountPath: "/openclaw-secrets", readOnly: true },
                { name: "agent-config", mountPath: "/agents" },
                { name: "agent-tree-config", mountPath: "/agents-tree", readOnly: true },
                { name: "skills-config", mountPath: "/skills-src", readOnly: true },
                { name: "cron-config", mountPath: "/cron-src", readOnly: true },
                { name: "exec-approvals-config", mountPath: "/exec-approvals-src", readOnly: true },
              ],
            },
          ],
          containers: [
            {
              name: "gateway",
              image,
              imagePullPolicy: "IfNotPresent",
              command: [
                "sh", "-c",
                "umask 007 && exec node dist/index.js gateway run --bind lan --port 18789",
              ],
              ports: [
                { name: "gateway", containerPort: 18789, protocol: "TCP" },
                ...(withA2a ? [{ name: "bridge", containerPort: 18790, protocol: "TCP" as const }] : []),
              ],
              env: envVars,
              resources: {
                requests: { memory: "1Gi", cpu: "250m" },
                limits: { memory: "4Gi", cpu: "1000m" },
              },
              livenessProbe: {
                exec: {
                  command: [
                    "node", "-e",
                    "require('http').get('http://127.0.0.1:18789/',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))",
                  ],
                },
                initialDelaySeconds: 60,
                periodSeconds: 30,
                timeoutSeconds: 10,
                failureThreshold: 3,
              },
              readinessProbe: {
                exec: {
                  command: [
                    "node", "-e",
                    "require('http').get('http://127.0.0.1:18789/',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))",
                  ],
                },
                initialDelaySeconds: 30,
                periodSeconds: 10,
                timeoutSeconds: 5,
                failureThreshold: 2,
              },
              volumeMounts: [
                { name: "openclaw-home", mountPath: "/home/node/.openclaw" },
                { name: "tmp-volume", mountPath: "/tmp" },
                // Only mount GCP creds on gateway in direct (non-proxy) mode
                ...(!useProxy && config.gcpServiceAccountJson
                  ? [{ name: "gcp-sa", mountPath: "/home/node/gcp", readOnly: true }]
                  : []),
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
            },
            // LiteLLM proxy sidecar: holds GCP creds, exposes OpenAI-compatible API.
            // Only handles Vertex models — secondary providers (OpenAI, Anthropic)
            // are routed directly by the gateway using their native API keys.
            ...(useProxy ? [{
              name: "litellm",
              image: config.litellmImage || LITELLM_IMAGE,
              args: ["--config", "/etc/litellm/config.yaml", "--port", String(LITELLM_PORT)],
              ports: [{ name: "litellm", containerPort: LITELLM_PORT, protocol: "TCP" as const }],
              env: [
                ...(config.gcpServiceAccountJson
                  ? [{ name: "GOOGLE_APPLICATION_CREDENTIALS", value: "/home/node/gcp/sa.json" }]
                  : []),
              ],
              volumeMounts: [
                { name: "litellm-config", mountPath: "/etc/litellm", readOnly: true },
                { name: "litellm-tmp", mountPath: "/tmp" },
                ...(config.gcpServiceAccountJson
                  ? [{ name: "gcp-sa", mountPath: "/home/node/gcp", readOnly: true }]
                  : []),
              ],
              resources: {
                requests: { memory: "512Mi", cpu: "100m" },
                limits: { memory: "1Gi", cpu: "500m" },
              },
              readinessProbe: {
                httpGet: { path: "/health/readiness", port: LITELLM_PORT as unknown as k8s.IntOrString },
                initialDelaySeconds: 10,
                periodSeconds: 10,
                timeoutSeconds: 5,
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
            }] : []),
            // OTEL collector sidecar: receives OTLP traces and exports to configured backend
            ...(useOtelDirect ? [{
              name: "otel-collector",
              image: config.otelImage || OTEL_COLLECTOR_IMAGE,
              imagePullPolicy: "IfNotPresent" as const,
              args: ["--config", "/etc/otel/config.yaml"],
              ports: [
                { name: "otlp-grpc", containerPort: OTEL_GRPC_PORT, protocol: "TCP" as const },
                { name: "otlp-http", containerPort: OTEL_HTTP_PORT, protocol: "TCP" as const },
              ],
              volumeMounts: [
                { name: "otel-config", mountPath: "/etc/otel", readOnly: true },
              ],
              resources: {
                requests: { memory: "128Mi", cpu: "100m" },
                limits: { memory: "256Mi", cpu: "200m" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
            }] : []),
            // Chromium browser sidecar: headless browser for web browsing via CDP
            ...(useChromium ? [{
              name: "chromium",
              image: config.chromiumImage || CHROMIUM_IMAGE,
              imagePullPolicy: "IfNotPresent" as const,
              ports: [
                { name: "cdp", containerPort: CHROMIUM_CDP_PORT, protocol: "TCP" as const },
              ],
              volumeMounts: [
                { name: "chromium-shm", mountPath: "/dev/shm" },
                { name: "chromium-tmp", mountPath: "/tmp" },
              ],
              resources: {
                requests: { memory: "512Mi", cpu: "100m" },
                limits: { memory: "1Gi", cpu: "500m" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                runAsNonRoot: true,
                capabilities: { drop: ["ALL"] },
              },
              readinessProbe: {
                httpGet: { path: "/json/version", port: CHROMIUM_CDP_PORT as unknown as k8s.IntOrString },
                initialDelaySeconds: 5,
                periodSeconds: 10,
                timeoutSeconds: 5,
              },
            }] : []),
            ...(withA2a ? [{
              name: "agent-card",
              image: "registry.redhat.io/ubi9:latest",
              command: ["python3", "-u", "/scripts/a2a-bridge.py"],
              ports: [{ name: "a2a", containerPort: 8080, protocol: "TCP" as const }],
              env: [
                {
                  name: "GATEWAY_TOKEN",
                  valueFrom: { secretKeyRef: { name: "openclaw-secrets", key: "OPENCLAW_GATEWAY_TOKEN" } },
                },
                { name: "GATEWAY_URL", value: "http://localhost:18789" },
                { name: "AGENT_ID", value: "" },
              ],
              volumeMounts: [
                { name: "agent-card-data", mountPath: "/srv/.well-known", readOnly: true },
                { name: "a2a-bridge-script", mountPath: "/scripts", readOnly: true },
              ],
              resources: {
                requests: { memory: "32Mi", cpu: "10m" },
                limits: { memory: "64Mi", cpu: "50m" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
            }] : []),
          ],
          volumes: [
            { name: "openclaw-home", persistentVolumeClaim: { claimName: "openclaw-home-pvc" } },
            { name: "openclaw-secrets", secret: { secretName: "openclaw-secrets" } },
            { name: "config-template", configMap: { name: "openclaw-config" } },
            { name: "agent-config", configMap: { name: "openclaw-agent" } },
            {
              name: "skills-config",
              configMap: {
                name: "openclaw-skills",
                ...(skillEntries.length > 0
                  ? { items: skillEntries.map((entry) => ({ key: entry.key, path: entry.path })) }
                  : {}),
              },
            },
            {
              name: "cron-config",
              configMap: {
                name: "openclaw-cron",
                ...(cronJobsContent !== undefined
                  ? { items: [{ key: "jobs.json", path: "jobs.json" }] }
                  : {}),
              },
            },
            {
              name: "exec-approvals-config",
              configMap: {
                name: "openclaw-exec-approvals",
                optional: true,
              },
            },
            {
              name: "agent-tree-config",
              configMap: {
                name: "openclaw-agent-tree",
                ...(agentTreeEntries.length > 0
                  ? { items: agentTreeEntries.map((entry) => ({ key: entry.key, path: entry.path })) }
                  : {}),
              },
            },
            { name: "tmp-volume", emptyDir: {} },
            ...(config.gcpServiceAccountJson
              ? [{ name: "gcp-sa", secret: { secretName: "gcp-sa" } }]
              : []),
            ...(useProxy
              ? [
                  { name: "litellm-config", configMap: { name: "litellm-config" } },
                  { name: "litellm-tmp", emptyDir: {} },
                ]
              : []),
            ...(useOtelDirect
              ? [{ name: "otel-config", configMap: { name: "otel-collector-config" } }]
              : []),
            ...(useChromium
              ? [
                  { name: "chromium-shm", emptyDir: { medium: "Memory", sizeLimit: "256Mi" } },
                  { name: "chromium-tmp", emptyDir: {} },
                ]
              : []),
            ...(withA2a
              ? [
                  { name: "agent-card-data", configMap: { name: "openclaw-agent-card" } },
                  { name: "a2a-bridge-script", configMap: { name: "a2a-bridge" } },
                ]
              : []),
          ],
        },
      },
    },
  };
}
