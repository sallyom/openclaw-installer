import { Router } from "express";
import { v4 as uuid } from "uuid";
import { readFileSync, existsSync } from "node:fs";
import { userInfo } from "node:os";
import type { DeployConfig } from "../deployers/types.js";
import { detectGcpDefaults, defaultVertexLocation } from "../services/gcp.js";
import { registry } from "../deployers/registry.js";
import { createLogCallback, sendStatus } from "../ws.js";

const router = Router();

function normalizeSshMaterial(value: string): string {
  const withoutBom = value.replace(/^\uFEFF/, "");
  const normalizedNewlines = withoutBom.replace(/\r\n?/g, "\n");
  return normalizedNewlines.endsWith("\n") ? normalizedNewlines : `${normalizedNewlines}\n`;
}

router.post("/", async (req, res) => {
  const config = req.body as DeployConfig;

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

  const resolveTextFile = (filePath: string, label: string): string | null => {
    if (!existsSync(filePath)) {
      res.status(400).json({ error: `${label} file not found: ${filePath}` });
      return null;
    }
    return readFileSync(filePath, "utf-8");
  };

  // Default prefix to OS username
  if (!config.prefix) {
    config.prefix = process.env.OPENCLAW_PREFIX || userInfo().username;
  }

  // Fall back to server environment for image and API keys
  if (!config.image && process.env.OPENCLAW_IMAGE) {
    config.image = process.env.OPENCLAW_IMAGE;
  }
  if (!config.anthropicApiKey && process.env.ANTHROPIC_API_KEY) {
    config.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (!config.openaiApiKey && process.env.OPENAI_API_KEY) {
    config.openaiApiKey = process.env.OPENAI_API_KEY;
  }
  if (!config.modelEndpoint && process.env.MODEL_ENDPOINT) {
    config.modelEndpoint = process.env.MODEL_ENDPOINT;
  }
  if (config.telegramEnabled) {
    if (!config.telegramBotToken && process.env.TELEGRAM_BOT_TOKEN) {
      config.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    }
    if (!config.telegramAllowFrom && process.env.TELEGRAM_ALLOW_FROM) {
      config.telegramAllowFrom = process.env.TELEGRAM_ALLOW_FROM;
    }
  }
  if (config.vertexEnabled === undefined && process.env.VERTEX_ENABLED === "true") {
    config.vertexEnabled = true;
    config.vertexProvider = (process.env.VERTEX_PROVIDER as "google" | "anthropic") || "anthropic";
    config.googleCloudProject = config.googleCloudProject || process.env.GOOGLE_CLOUD_PROJECT || "";
    config.googleCloudLocation = config.googleCloudLocation || process.env.GOOGLE_CLOUD_LOCATION || "";
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
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    sendStatus(deployId, "failed");
  }
});

export default router;
