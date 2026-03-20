import express from "express";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { setupWebSocket } from "./ws.js";
import deployRoutes from "./routes/deploy.js";
import statusRoutes from "./routes/status.js";
import agentsRoutes from "./routes/agents.js";
import { detectRuntime } from "./services/container.js";
import { isClusterReachable, currentContext } from "./services/k8s.js";
import { stopAllK8sPortForwards } from "./services/k8s-port-forward.js";
import { detectGcpDefaults } from "./services/gcp.js";
import { readdir, readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { installerDataDir } from "./paths.js";
import { registry } from "./deployers/registry.js";
import { LocalDeployer } from "./deployers/local.js";
import { KubernetesDeployer } from "./deployers/kubernetes.js";
import { loadPlugins } from "./plugins/loader.js";

// Register built-in deployers
registry.register({
  mode: "local",
  title: "This Machine",
  description: "Run OpenClaw locally with podman/docker",
  deployer: new LocalDeployer(),
  detect: async () => !!(await detectRuntime()),
  priority: 0,
});
registry.register({
  mode: "kubernetes",
  title: "Kubernetes",
  description: "Deploy to a Kubernetes cluster",
  deployer: new KubernetesDeployer(),
  detect: async () => isClusterReachable(),
  priority: 0,
});

// Load external plugins
console.log("Loading plugins...");
await loadPlugins(registry);
console.log(`Plugins loaded. Registered deployers: ${registry.list().map(r => r.mode).join(", ")}`);

const app = express();
const server = createServer(app);
const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.use(express.json());

// API routes
app.use("/api/deploy", deployRoutes);
app.use("/api/instances", statusRoutes);
app.use("/api/agents", agentsRoutes);

// Health check + environment defaults for the frontend
app.get("/api/health", async (_req, res) => {
  const runtime = await detectRuntime();
  const k8sReachable = await isClusterReachable();
  const detected = await registry.detect();

  res.json({
    status: "ok",
    containerRuntime: runtime,
    k8sAvailable: k8sReachable,
    k8sContext: k8sReachable ? currentContext() : "",
    version: "0.1.0",
    deployers: registry.list().map((reg) => ({
      mode: reg.mode,
      title: reg.title,
      description: reg.description,
      available: detected.some((d) => d.mode === reg.mode),
      priority: reg.priority ?? 0,
    })),
    defaults: {
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasOpenaiKey: !!process.env.OPENAI_API_KEY,
      hasTelegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
      telegramAllowFrom: process.env.TELEGRAM_ALLOW_FROM || "",
      modelEndpoint: process.env.MODEL_ENDPOINT || "",
      prefix: process.env.OPENCLAW_PREFIX || userInfo().username,
      image: process.env.OPENCLAW_IMAGE || "",
    },
  });
});

// GCP environment defaults for the Vertex AI form
app.get("/api/configs/gcp-defaults", async (_req, res) => {
  const defaults = await detectGcpDefaults();
  res.json({
    projectId: defaults.projectId,
    location: defaults.location,
    hasServiceAccountJson: !!defaults.serviceAccountJson,
    credentialType: defaults.credentialType,
    sources: defaults.sources,
  });
});

// List saved instance configs from ~/.openclaw/installer/local/*/.env
// and ~/.openclaw/installer/k8s/*/deploy-config.json
app.get("/api/configs", async (_req, res) => {
  const baseDir = installerDataDir();
  const configs: Array<{ name: string; type: string; vars: Record<string, string> }> = [];

  // Local instances (.env files)
  try {
    const localDir = join(baseDir, "local");
    const entries = await readdir(localDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const envContent = await readFile(join(localDir, entry.name, ".env"), "utf8");
        const vars: Record<string, string> = {};
        for (const line of envContent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx < 0) continue;
          vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
        }
        configs.push({ name: entry.name, type: "local", vars });
      } catch {
        // No .env in this directory, skip
      }
    }
  } catch {
    // local/ dir may not exist yet
  }

  // K8s instances (deploy-config.json files)
  try {
    const k8sDir = join(baseDir, "k8s");
    const entries = await readdir(k8sDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const configContent = await readFile(join(k8sDir, entry.name, "deploy-config.json"), "utf8");
        const vars = JSON.parse(configContent);
        configs.push({ name: entry.name, type: "k8s", vars });
      } catch {
        // No deploy-config.json in this directory, skip
      }
    }
  } catch {
    // k8s/ dir may not exist yet
  }

  res.json(configs);
});

app.post("/api/configs/source-env", async (req, res) => {
  const agentSourceDir = String(req.body?.agentSourceDir || "").trim();
  if (!agentSourceDir) {
    res.status(400).json({ error: "agentSourceDir is required" });
    return;
  }

  const envPath = join(agentSourceDir, ".env");
  try {
    const envContent = await readFile(envPath, "utf8");
    const vars: Record<string, string> = {};
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
    res.json({ vars });
  } catch {
    res.status(404).json({ error: `No .env found at ${envPath}` });
  }
});

// Serve frontend — check both dev (vite build output) and production (Dockerfile) paths
const clientCandidates = [
  resolve(import.meta.dirname, "..", "..", "dist", "client"), // from src/server/ after vite build
  join(import.meta.dirname, "..", "client"),                   // from dist/server/ in container
];
const clientDir = clientCandidates.find((dir) =>
  existsSync(join(dir, "index.html")),
);
if (clientDir) {
  app.use(
    express.static(clientDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".js")) res.setHeader("Content-Type", "application/javascript");
        else if (filePath.endsWith(".css")) res.setHeader("Content-Type", "text/css");
      },
    }),
  );
  app.get("*", (_req, res) => {
    res.sendFile(join(clientDir, "index.html"));
  });
}

// WebSocket
setupWebSocket(server);

process.once("exit", () => {
  stopAllK8sPortForwards();
});
process.once("SIGINT", () => {
  stopAllK8sPortForwards();
  process.exit(0);
});
process.once("SIGTERM", () => {
  stopAllK8sPortForwards();
  process.exit(0);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenClaw Installer running at http://0.0.0.0:${PORT}`);
});
