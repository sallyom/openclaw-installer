import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installerDataDir, installerLocalInstanceDir } from "../paths.js";
import {
  discoverContainers,
  discoverVolumes,
  detectRuntime,
  type DiscoveredContainer,
} from "../services/container.js";
import { discoverK8sInstances } from "../deployers/kubernetes.js";
import { isClusterReachable } from "../services/k8s.js";
import { registry } from "../deployers/registry.js";
import type { DeployResult, DeploySecretRef } from "../deployers/types.js";
import type { PodmanSecretMapping } from "../../shared/podman-secrets.js";

function decodeSavedBase64(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

export function decodeSavedJson<T>(value?: string): T | undefined {
  const decoded = decodeSavedBase64(value);
  if (!decoded) {
    return undefined;
  }
  try {
    return JSON.parse(decoded) as T;
  } catch {
    return undefined;
  }
}

function decodeSavedBase64UnlessPath(savedValue?: string, savedPath?: string): string | undefined {
  if (savedPath?.trim()) {
    return undefined;
  }
  return decodeSavedBase64(savedValue);
}

export function containerToInstance(c: DiscoveredContainer): DeployResult {
  const prefix = c.labels["openclaw.prefix"] || "";
  const agent = c.labels["openclaw.agent"] || "";

  let port = 18789;
  const portsStr = String(c.ports);
  const portMatch = portsStr.match(/(\d+)->18789/);
  if (portMatch) {
    port = parseInt(portMatch[1], 10);
  } else {
    const gatewayPortMatch = portsStr.match(/"host_port"\s*:\s*(\d+)[^}]*"container_port"\s*:\s*18789/);
    const reverseMatch = portsStr.match(/"container_port"\s*:\s*18789[^}]*"host_port"\s*:\s*(\d+)/);
    const hostPortMatch = gatewayPortMatch || reverseMatch;
    if (hostPortMatch) port = parseInt(hostPortMatch[1], 10);
  }

  return {
    id: c.name,
    mode: "local",
    status: c.status,
    hasLocalState: true,
    config: {
      mode: "local",
      prefix: prefix || c.name.replace(/^openclaw-/, "").replace(/-[^-]+$/, ""),
      agentName: agent || c.name.split("-").pop() || c.name,
      agentDisplayName: agent
        ? agent.charAt(0).toUpperCase() + agent.slice(1)
        : c.name,
    },
    startedAt: c.createdAt,
    url: c.status === "running" ? `http://localhost:${port}` : undefined,
    containerId: c.name,
  };
}

export function parseSavedLocalInstanceConfig(savedVars: Record<string, string>): Partial<DeployResult["config"]> {
  return {
    image: savedVars.OPENCLAW_IMAGE || undefined,
    port: savedVars.OPENCLAW_PORT ? parseInt(savedVars.OPENCLAW_PORT, 10) : undefined,
    containerRunArgs: savedVars.OPENCLAW_CONTAINER_RUN_ARGS || undefined,
    podmanSecretMappings: decodeSavedJson<PodmanSecretMapping[]>(savedVars.PODMAN_SECRET_MAPPINGS_B64),
    inferenceProvider: savedVars.INFERENCE_PROVIDER as
      | "anthropic"
      | "openai"
      | "google"
      | "openrouter"
      | "vertex-anthropic"
      | "vertex-google"
      | "custom-endpoint"
      | undefined,
    agentSecurityMode:
      (savedVars.AGENT_SECURITY_MODE as "basic" | "secretrefs") || undefined,
    secretsProvidersJson: decodeSavedBase64(savedVars.SECRETS_PROVIDERS_JSON_B64),
    anthropicApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.ANTHROPIC_API_KEY_REF_B64),
    openaiApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.OPENAI_API_KEY_REF_B64),
    googleApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.GOOGLE_API_KEY_REF_B64),
    openrouterApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.OPENROUTER_API_KEY_REF_B64),
    modelEndpointApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.MODEL_ENDPOINT_API_KEY_REF_B64),
    telegramBotTokenRef: decodeSavedJson<DeploySecretRef>(savedVars.TELEGRAM_BOT_TOKEN_REF_B64),
    anthropicApiKey: savedVars.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: savedVars.OPENAI_API_KEY || undefined,
    googleApiKey: savedVars.GEMINI_API_KEY || savedVars.GOOGLE_API_KEY || undefined,
    openrouterApiKey: savedVars.OPENROUTER_API_KEY || undefined,
    anthropicModel: savedVars.ANTHROPIC_MODEL || undefined,
    openaiModel: savedVars.OPENAI_MODEL || undefined,
    googleModel: savedVars.GOOGLE_MODEL || undefined,
    openrouterModel: savedVars.OPENROUTER_MODEL || undefined,
    modelFallbacks: decodeSavedJson(savedVars.MODEL_FALLBACKS_B64),
    openaiCompatibleEndpointsEnabled:
      savedVars.OPENAI_COMPATIBLE_ENDPOINTS_ENABLED === "false" ? false : undefined,
    modelEndpoint: savedVars.MODEL_ENDPOINT || undefined,
    modelEndpointApiKey: savedVars.MODEL_ENDPOINT_API_KEY || undefined,
    modelEndpointModel: savedVars.MODEL_ENDPOINT_MODEL || undefined,
    modelEndpointModelLabel: savedVars.MODEL_ENDPOINT_MODEL_LABEL || undefined,
    modelEndpointModels: decodeSavedJson(savedVars.MODEL_ENDPOINT_MODELS_B64),
    googleModels: decodeSavedJson(savedVars.GOOGLE_MODELS_B64),
    openrouterModels: decodeSavedJson(savedVars.OPENROUTER_MODELS_B64),
    agentModel: savedVars.AGENT_MODEL || undefined,
    agentSourceDir: savedVars.AGENT_SOURCE_DIR || undefined,
    vertexEnabled: savedVars.VERTEX_ENABLED === "true" || undefined,
    vertexProvider: (savedVars.VERTEX_PROVIDER as "google" | "anthropic") || undefined,
    gcpServiceAccountJson: savedVars.GOOGLE_APPLICATION_CREDENTIALS ? "(on-volume)" : undefined,
    googleCloudProject: savedVars.GOOGLE_CLOUD_PROJECT || undefined,
    googleCloudLocation: savedVars.GOOGLE_CLOUD_LOCATION || undefined,
    litellmProxy: savedVars.LITELLM_PROXY === "true" || undefined,
    otelEnabled: savedVars.OTEL_ENABLED === "true" || undefined,
    otelJaeger: savedVars.OTEL_JAEGER === "true" || undefined,
    otelEndpoint: savedVars.OTEL_ENDPOINT || undefined,
    otelExperimentId: savedVars.OTEL_EXPERIMENT_ID || undefined,
    otelImage: savedVars.OTEL_IMAGE || undefined,
    chromiumSidecar: savedVars.CHROMIUM_SIDECAR === "true" || undefined,
    chromiumImage: savedVars.CHROMIUM_IMAGE || undefined,
    telegramBotToken: savedVars.TELEGRAM_BOT_TOKEN || undefined,
    telegramAllowFrom: savedVars.TELEGRAM_ALLOW_FROM || undefined,
    sandboxEnabled: savedVars.SANDBOX_ENABLED === "true" || undefined,
    sandboxBackend: (savedVars.SANDBOX_BACKEND as "ssh") || undefined,
    sandboxMode:
      (savedVars.SANDBOX_MODE as "off" | "non-main" | "all") || undefined,
    sandboxScope:
      (savedVars.SANDBOX_SCOPE as "session" | "agent" | "shared") || undefined,
    sandboxToolPolicyEnabled:
      savedVars.SANDBOX_TOOL_POLICY_ENABLED === "true" || undefined,
    sandboxToolAllowFiles:
      savedVars.SANDBOX_TOOL_ALLOW_FILES === "false" ? false : undefined,
    sandboxToolAllowSessions:
      savedVars.SANDBOX_TOOL_ALLOW_SESSIONS === "false" ? false : undefined,
    sandboxToolAllowMemory:
      savedVars.SANDBOX_TOOL_ALLOW_MEMORY === "false" ? false : undefined,
    sandboxToolAllowRuntime:
      savedVars.SANDBOX_TOOL_ALLOW_RUNTIME === "true" || undefined,
    sandboxToolAllowBrowser:
      savedVars.SANDBOX_TOOL_ALLOW_BROWSER === "true" || undefined,
    sandboxToolAllowAutomation:
      savedVars.SANDBOX_TOOL_ALLOW_AUTOMATION === "true" || undefined,
    sandboxToolAllowMessaging:
      savedVars.SANDBOX_TOOL_ALLOW_MESSAGING === "true" || undefined,
    sandboxWorkspaceAccess:
      (savedVars.SANDBOX_WORKSPACE_ACCESS as "none" | "ro" | "rw") || undefined,
    sandboxSshTarget: savedVars.SANDBOX_SSH_TARGET || undefined,
    sandboxSshWorkspaceRoot: savedVars.SANDBOX_SSH_WORKSPACE_ROOT || undefined,
    sandboxSshIdentityPath: savedVars.SANDBOX_SSH_IDENTITY_PATH || undefined,
    sandboxSshCertificatePath: savedVars.SANDBOX_SSH_CERTIFICATE_PATH || undefined,
    sandboxSshKnownHostsPath: savedVars.SANDBOX_SSH_KNOWN_HOSTS_PATH || undefined,
    sandboxSshStrictHostKeyChecking:
      savedVars.SANDBOX_SSH_STRICT_HOST_KEY_CHECKING === "false" ? false : undefined,
    sandboxSshUpdateHostKeys:
      savedVars.SANDBOX_SSH_UPDATE_HOST_KEYS === "false" ? false : undefined,
    sandboxSshCertificate: decodeSavedBase64UnlessPath(
      savedVars.SANDBOX_SSH_CERTIFICATE_B64,
      savedVars.SANDBOX_SSH_CERTIFICATE_PATH,
    ),
    sandboxSshKnownHosts: decodeSavedBase64UnlessPath(
      savedVars.SANDBOX_SSH_KNOWN_HOSTS_B64,
      savedVars.SANDBOX_SSH_KNOWN_HOSTS_PATH,
    ),
  };
}

export async function readSavedConfig(containerName: string): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  try {
    const envPath = join(installerLocalInstanceDir(containerName), ".env");
    const content = await readFile(envPath, "utf8");
    for (const line of content.split("\n")) {
      if (line.startsWith("#") || !line.includes("=")) continue;
      const [key, ...rest] = line.split("=");
      vars[key.trim()] = rest.join("=").trim();
    }
  } catch {
    // no saved config
  }
  return vars;
}

export async function readSavedGatewayToken(containerName: string): Promise<string | undefined> {
  try {
    const tokenPath = join(installerLocalInstanceDir(containerName), "gateway-token");
    const token = (await readFile(tokenPath, "utf8")).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

async function readSavedK8sState(namespace: string): Promise<{ hasLocalState: boolean; mode: string }> {
  try {
    const configPath = join(installerDataDir(), "k8s", namespace, "deploy-config.json");
    const content = await readFile(configPath, "utf8");
    const config = JSON.parse(content) as { mode?: string };
    return {
      hasLocalState: true,
      mode: config.mode || "kubernetes",
    };
  } catch {
    return {
      hasLocalState: false,
      mode: "kubernetes",
    };
  }
}

async function buildStoppedLocalInstance(containerName: string, volumeName: string, runtime: "podman" | "docker"): Promise<DeployResult> {
  const savedVars = await readSavedConfig(containerName);
  const agentName = savedVars.OPENCLAW_AGENT_NAME || containerName;
  const displayName = savedVars.OPENCLAW_DISPLAY_NAME || agentName;
  const prefix = savedVars.OPENCLAW_PREFIX || containerName.replace(/^openclaw-/, "");

  return {
    id: containerName,
    mode: "local",
    status: "stopped",
    hasLocalState: true,
    volumeName,
    config: {
      mode: "local",
      prefix,
      agentName,
      agentDisplayName: displayName.charAt(0).toUpperCase() + displayName.slice(1),
      containerRuntime: runtime,
      ...parseSavedLocalInstanceConfig(savedVars),
    },
    startedAt: "",
    containerId: containerName,
  };
}

async function buildK8sInstance(namespace: string): Promise<DeployResult | null> {
  const k8sInstances = await discoverK8sInstances({ namespaces: [namespace] });
  const discovered = k8sInstances.find((instance) => instance.namespace === namespace);
  if (!discovered) {
    return null;
  }

  const savedState = await readSavedK8sState(discovered.namespace);
  const mode = savedState.mode;
  let instance: DeployResult = {
    id: discovered.namespace,
    mode,
    status: discovered.status,
    hasLocalState: savedState.hasLocalState,
    config: {
      mode,
      prefix: discovered.prefix,
      agentName: discovered.agentName,
      agentDisplayName: discovered.agentName
        ? discovered.agentName.charAt(0).toUpperCase() + discovered.agentName.slice(1)
        : discovered.namespace,
      namespace: discovered.namespace,
      image: discovered.image,
    },
    startedAt: "",
    url: discovered.url || undefined,
    containerId: discovered.namespace,
    statusDetail: discovered.statusDetail,
    pods: discovered.pods,
  };

  const deployer = savedState.hasLocalState ? registry.get(mode) : undefined;
  if (deployer && typeof deployer.status === "function") {
    try {
      instance = await deployer.status(instance);
    } catch {
      // Use base instance if status enrichment fails
    }
  }

  return instance;
}

export async function listInstances(includeK8s: boolean): Promise<DeployResult[]> {
  const instances: DeployResult[] = [];

  const runtime = await detectRuntime();
  if (runtime) {
    const containers = await discoverContainers(runtime);
    const volumes = await discoverVolumes(runtime);
    instances.push(...containers.map(containerToInstance));

    const runningContainerNames = new Set(instances.map((instance) => instance.containerId));
    for (const volume of volumes) {
      if (runningContainerNames.has(volume.containerName)) continue;

      try {
        instances.push(await buildStoppedLocalInstance(volume.containerName, volume.name, runtime));
      } catch {
        // Skip one broken saved instance instead of failing the whole list.
      }
    }
  }

  if (includeK8s && await isClusterReachable()) {
    try {
      const k8sInstances = await discoverK8sInstances();
      for (const discovered of k8sInstances) {
        const instance = await buildK8sInstance(discovered.namespace);
        if (instance) {
          instances.push(instance);
        }
      }
    } catch {
      // Keep local instances visible even if cluster discovery fails.
    }
  }

  return instances;
}

export async function findInstance(name: string): Promise<DeployResult | null> {
  const runtime = await detectRuntime();
  if (runtime) {
    const containers = await discoverContainers(runtime);
    const running = containers.find((container) => container.name === name);
    if (running) {
      return containerToInstance(running);
    }

    const volumes = await discoverVolumes(runtime);
    const volume = volumes.find((entry) => entry.containerName === name);
    if (volume) {
      return await buildStoppedLocalInstance(name, volume.name, runtime);
    }
  }

  return await buildK8sInstance(name);
}
