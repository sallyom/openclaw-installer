import { Router } from "express";
import { v4 as uuid } from "uuid";
import { readFileSync, existsSync } from "node:fs";
import { userInfo } from "node:os";
import type { DeployConfig, DeploySecretRef } from "../deployers/types.js";
import { validateAgentName } from "../../shared/validate-agent-name.js";
import { detectGcpDefaults, defaultVertexLocation } from "../services/gcp.js";
import { normalizeModelEndpointBaseUrl } from "../services/model-endpoint.js";
import { namespaceName } from "../deployers/k8s-helpers.js";
import { registry } from "../deployers/registry.js";
import { k8sApiHttpCode } from "../services/k8s.js";
import { createLogCallback, sendStatus } from "../ws.js";

const router = Router();

function normalizeSshMaterial(value: string): string {
  const withoutBom = value.replace(/^\uFEFF/, "");
  const normalizedNewlines = withoutBom.replace(/\r\n?/g, "\n");
  return normalizedNewlines.endsWith("\n") ? normalizedNewlines : `${normalizedNewlines}\n`;
}

function trimOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSecretRef(ref: DeploySecretRef | undefined): DeploySecretRef | undefined {
  if (!ref) return undefined;
  const source = ref.source;
  const provider = trimOptional(ref.provider);
  const id = trimOptional(ref.id);
  if (!source && !provider && !id) return undefined;
  if ((source !== "env" && source !== "file" && source !== "exec") || !provider || !id) {
    throw new Error("SecretRef requires source, provider, and id");
  }
  return { source, provider, id };
}

function normalizeModelFallbacks(modelFallbacks: string[] | undefined): string[] | undefined {
  if (!Array.isArray(modelFallbacks)) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of modelFallbacks) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = trimOptional(entry);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringArray(arr: string[] | undefined): string[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const normalized = arr
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

export function applyServerEnvFallbacks(config: DeployConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (!config.image && env.OPENCLAW_IMAGE) {
    config.image = env.OPENCLAW_IMAGE;
  }
  if (!config.anthropicApiKey && !config.anthropicApiKeyRef && env.ANTHROPIC_API_KEY) {
    config.anthropicApiKey = env.ANTHROPIC_API_KEY;
  }
  if (!config.openaiApiKey && !config.openaiApiKeyRef && env.OPENAI_API_KEY) {
    config.openaiApiKey = env.OPENAI_API_KEY;
  }
  if (!config.modelEndpoint && config.inferenceProvider === "custom-endpoint" && env.MODEL_ENDPOINT) {
    config.modelEndpoint = env.MODEL_ENDPOINT;
  }
  if (config.modelEndpoint && !config.modelEndpointApiKey && env.MODEL_ENDPOINT_API_KEY) {
    config.modelEndpointApiKey = env.MODEL_ENDPOINT_API_KEY;
  }
  if (config.telegramEnabled) {
    if (!config.telegramBotToken && !config.telegramBotTokenRef && env.TELEGRAM_BOT_TOKEN) {
      config.telegramBotToken = env.TELEGRAM_BOT_TOKEN;
    }
    if (!config.telegramAllowFrom && env.TELEGRAM_ALLOW_FROM) {
      config.telegramAllowFrom = env.TELEGRAM_ALLOW_FROM;
    }
  }
  if (config.vertexEnabled === undefined && env.VERTEX_ENABLED === "true") {
    config.vertexEnabled = true;
    config.vertexProvider = (env.VERTEX_PROVIDER as "google" | "anthropic") || "anthropic";
    config.googleCloudProject = config.googleCloudProject || env.GOOGLE_CLOUD_PROJECT || "";
    config.googleCloudLocation = config.googleCloudLocation || env.GOOGLE_CLOUD_LOCATION || "";
  }
}

router.post("/", async (req, res) => {
  const config = req.body as DeployConfig;

  config.image = trimOptional(config.image);
  config.modelEndpoint = trimOptional(config.modelEndpoint);
  config.modelEndpointApiKey = trimOptional(config.modelEndpointApiKey);
  config.modelEndpointModel = trimOptional(config.modelEndpointModel);
  config.modelEndpointModelLabel = trimOptional(config.modelEndpointModelLabel);
  config.googleCloudProject = trimOptional(config.googleCloudProject);
  config.googleCloudLocation = trimOptional(config.googleCloudLocation);
  config.gcpServiceAccountJson = trimOptional(config.gcpServiceAccountJson);
  config.gcpServiceAccountPath = trimOptional(config.gcpServiceAccountPath);
  config.telegramBotToken = trimOptional(config.telegramBotToken);
  config.telegramAllowFrom = trimOptional(config.telegramAllowFrom);
  config.anthropicModel = trimOptional(config.anthropicModel);
  config.openaiModel = trimOptional(config.openaiModel);
  config.anthropicModels = normalizeStringArray(config.anthropicModels);
  config.openaiModels = normalizeStringArray(config.openaiModels);
  config.namespace = trimOptional(config.namespace);
  config.a2aRealm = trimOptional(config.a2aRealm);
  config.a2aKeycloakNamespace = trimOptional(config.a2aKeycloakNamespace);
  config.sshHost = trimOptional(config.sshHost);
  config.sshUser = trimOptional(config.sshUser);
  config.agentSourceDir = trimOptional(config.agentSourceDir);
  config.containerRunArgs = trimOptional(config.containerRunArgs);
  config.modelFallbacks = normalizeModelFallbacks(config.modelFallbacks);
  config.otelEndpoint = trimOptional(config.otelEndpoint);
  config.otelExperimentId = trimOptional(config.otelExperimentId);
  config.secretsProvidersJson = trimOptional(config.secretsProvidersJson);

  if (config.modelEndpoint) {
    try {
      config.modelEndpoint = normalizeModelEndpointBaseUrl(config.modelEndpoint);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
  }

  try {
    config.anthropicApiKeyRef = normalizeSecretRef(config.anthropicApiKeyRef);
    config.openaiApiKeyRef = normalizeSecretRef(config.openaiApiKeyRef);
    config.telegramBotTokenRef = normalizeSecretRef(config.telegramBotTokenRef);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (config.secretsProvidersJson) {
    try {
      const parsed = JSON.parse(config.secretsProvidersJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("secretsProvidersJson must be a JSON object");
      }
    } catch (err) {
      res.status(400).json({
        error: `Invalid secretsProvidersJson: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
  }

  if (!config.mode || !config.agentName) {
    res.status(400).json({
      error: "Missing required fields: mode, agentName",
    });
    return;
  }
  if (config.sandboxEnabled && config.sandboxBackend === "ssh" && !config.sandboxSshTarget?.trim()) {
    res.status(400).json({
      error: "SSH sandbox requires sandboxSshTarget",
    });
    return;
  }
  if (config.sandboxEnabled && config.sandboxBackend === "ssh" && !config.sandboxSshIdentityPath?.trim()) {
    res.status(400).json({
      error: "SSH sandbox requires sandboxSshIdentityPath",
    });
    return;
  }

  const resolveTextFile = (filePath: string, label: string): string | null => {
    if (!existsSync(filePath)) {
      res.status(400).json({ error: `${label} file not found: ${filePath}` });
      return null;
    }
    return readFileSync(filePath, "utf-8");
  };

  const agentNameError = validateAgentName(config.agentName);
  if (agentNameError) {
    res.status(400).json({ error: `Invalid agent name: ${agentNameError}` });
    return;
  }

  // Default prefix to OS username
  if (!config.prefix) {
    config.prefix = process.env.OPENCLAW_PREFIX || userInfo().username;
  }

  // Fall back to server environment for image and credentials.
  applyServerEnvFallbacks(config);

  if (!config.inferenceProvider) {
    if (config.vertexEnabled) {
      config.inferenceProvider = config.vertexProvider === "google" ? "vertex-google" : "vertex-anthropic";
    } else if (config.modelEndpoint) {
      config.inferenceProvider = "custom-endpoint";
    } else if (config.anthropicApiKey) {
      config.inferenceProvider = "anthropic";
    } else if (config.openaiApiKey) {
      config.inferenceProvider = "openai";
    }
  }

  // Resolve SA JSON from path if provided (and no inline JSON)
  if (!config.gcpServiceAccountJson && config.gcpServiceAccountPath) {
    const saPath = config.gcpServiceAccountPath;
    if (!existsSync(saPath)) {
      res.status(400).json({ error: `GCP SA JSON file not found: ${saPath}` });
      return;
    }
    config.gcpServiceAccountJson = readFileSync(saPath, "utf-8");
  }

  if (config.sandboxEnabled) {
    if (config.sandboxSshIdentityPath) {
      const value = resolveTextFile(config.sandboxSshIdentityPath, "SSH private key");
      if (value === null) return;
      config.sandboxSshIdentity = normalizeSshMaterial(value);
    }
    if (config.sandboxSshCertificatePath) {
      const value = resolveTextFile(config.sandboxSshCertificatePath, "SSH certificate");
      if (value === null) return;
      config.sandboxSshCertificate = normalizeSshMaterial(value);
    }
    if (config.sandboxSshKnownHostsPath) {
      const value = resolveTextFile(config.sandboxSshKnownHostsPath, "Known hosts");
      if (value === null) return;
      config.sandboxSshKnownHosts = normalizeSshMaterial(value);
    }
    if (config.sandboxSshCertificate) {
      config.sandboxSshCertificate = normalizeSshMaterial(config.sandboxSshCertificate);
    }
    if (config.sandboxSshKnownHosts) {
      config.sandboxSshKnownHosts = normalizeSshMaterial(config.sandboxSshKnownHosts);
    }
  }

  // Fall back to GCP environment defaults for Vertex AI
  if (config.vertexEnabled) {
    const gcpDefaults = await detectGcpDefaults();
    if (!config.googleCloudProject && gcpDefaults.projectId) {
      config.googleCloudProject = gcpDefaults.projectId;
    }
    if (!config.googleCloudLocation && gcpDefaults.location) {
      config.googleCloudLocation = gcpDefaults.location;
    }
    if (!config.gcpServiceAccountJson && gcpDefaults.serviceAccountJson) {
      config.gcpServiceAccountJson = gcpDefaults.serviceAccountJson;
    }
    // Default location if still unset — OpenClaw requires it for provider registration
    if (!config.googleCloudLocation) {
      config.googleCloudLocation = defaultVertexLocation(config.vertexProvider || "anthropic");
    }

    // LiteLLM proxy: default on when SA JSON credentials are present
    if (config.litellmProxy === undefined && config.gcpServiceAccountJson) {
      config.litellmProxy = true;
    }
  }

  const deployer = registry.get(config.mode);
  if (!deployer) {
    res.status(400).json({ error: `Unsupported mode: ${config.mode}` });
    return;
  }

  const deployId = uuid();
  const log = createLogCallback(deployId);

  // Return immediately with the deploy ID — logs stream via WebSocket
  res.status(202).json({ deployId });

  // Run deployment in background
  // Container is discoverable via podman labels + image name — no state file needed
  try {
    log("Starting deployment...");
    await deployer.deploy(config, log);
    sendStatus(deployId, "running");
    log("Deployment complete!");
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (config.mode === "kubernetes" && k8sApiHttpCode(err) === 403) {
      const ns = namespaceName(config);
      message += ` If you only have access to a pre-created OpenShift project, set "Project / Namespace" to that exact name. This deploy used namespace "${ns}" (from the form, or <owner prefix>-<agent name>-openclaw when the field is empty).`;
    }
    log(`ERROR: ${message}`);
    sendStatus(deployId, "failed");
  }
});

export default router;
