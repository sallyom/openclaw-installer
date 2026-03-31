import { Router } from "express";
import { readFile } from "node:fs/promises";
import { installerLocalInstanceDir } from "../paths.js";
import { installerDataDir } from "../paths.js";
import { join } from "node:path";
import {
  discoverContainers,
  discoverVolumes,
  detectRuntime,
  type DiscoveredContainer,
} from "../services/container.js";
import { discoverK8sInstances } from "../deployers/kubernetes.js";
import { isClusterReachable } from "../services/k8s.js";
import { registry } from "../deployers/registry.js";
import { parseContainerRunArgs } from "../deployers/local.js";
import { createLogCallback, sendStatus } from "../ws.js";
import type { DeployResult, DeploySecretRef } from "../deployers/types.js";

const router = Router();

function containerToInstance(c: DiscoveredContainer): DeployResult {
  const prefix = c.labels["openclaw.prefix"] || "";
  const agent = c.labels["openclaw.agent"] || "";

  let port = 18789;
  const portsStr = String(c.ports);
  // Docker format: "8080->18789/tcp"
  const portMatch = portsStr.match(/(\d+)->18789/);
  if (portMatch) {
    port = parseInt(portMatch[1], 10);
  } else {
    // Podman JSON format: [{"host_port":8080,"container_port":18789,...}]
    // Match specifically on container_port 18789 to avoid picking up sidecar ports
    const gatewayPortMatch = portsStr.match(/"host_port"\s*:\s*(\d+)[^}]*"container_port"\s*:\s*18789/);
    const reverseMatch = portsStr.match(/"container_port"\s*:\s*18789[^}]*"host_port"\s*:\s*(\d+)/);
    const hostPortMatch = gatewayPortMatch || reverseMatch;
    if (hostPortMatch) port = parseInt(hostPortMatch[1], 10);
  }

  return {
    id: c.name,
    mode: "local",
    status: c.status,
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

function decodeSavedJson<T>(value?: string): T | undefined {
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

// List all instances: running containers + stopped volumes (no container due to --rm) + K8s
router.get("/", async (req, res) => {
  const instances: DeployResult[] = [];
  const includeK8s = req.query.includeK8s === "1";

  try {
    // Local instances
    const runtime = await detectRuntime();
    if (runtime) {
      const containers = await discoverContainers(runtime);
      const volumes = await discoverVolumes(runtime);
      instances.push(...containers.map(containerToInstance));

      const runningContainerNames = new Set(instances.map((i) => i.containerId));

      for (const vol of volumes) {
        if (runningContainerNames.has(vol.containerName)) continue;

        try {
          const savedVars = await readSavedConfig(vol.containerName);
          const agentName = savedVars.OPENCLAW_AGENT_NAME || vol.containerName;
          const displayName = savedVars.OPENCLAW_DISPLAY_NAME || agentName;
          const prefix = savedVars.OPENCLAW_PREFIX || vol.containerName.replace(/^openclaw-/, "");

          instances.push({
            id: vol.containerName,
            mode: "local",
            status: "stopped",
            volumeName: vol.name,
            config: {
              mode: "local",
              prefix,
              agentName,
              agentDisplayName: displayName.charAt(0).toUpperCase() + displayName.slice(1),
              image: savedVars.OPENCLAW_IMAGE || undefined,
              port: savedVars.OPENCLAW_PORT ? parseInt(savedVars.OPENCLAW_PORT, 10) : undefined,
              inferenceProvider: savedVars.INFERENCE_PROVIDER as
                | "anthropic"
                | "openai"
                | "vertex-anthropic"
                | "vertex-google"
                | "custom-endpoint"
                | undefined,
              agentSecurityMode:
                (savedVars.AGENT_SECURITY_MODE as "basic" | "secretrefs") || undefined,
              secretsProvidersJson: decodeSavedBase64(savedVars.SECRETS_PROVIDERS_JSON_B64),
              anthropicApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.ANTHROPIC_API_KEY_REF_B64),
              openaiApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.OPENAI_API_KEY_REF_B64),
              telegramBotTokenRef: decodeSavedJson<DeploySecretRef>(savedVars.TELEGRAM_BOT_TOKEN_REF_B64),
              anthropicApiKey: savedVars.ANTHROPIC_API_KEY || undefined,
              openaiApiKey: savedVars.OPENAI_API_KEY || undefined,
              anthropicModel: savedVars.ANTHROPIC_MODEL || undefined,
              openaiModel: savedVars.OPENAI_MODEL || undefined,
              modelFallbacks: decodeSavedJson(savedVars.MODEL_FALLBACKS_B64),
              openaiCompatibleEndpointsEnabled:
                savedVars.OPENAI_COMPATIBLE_ENDPOINTS_ENABLED === "false" ? false : undefined,
              modelEndpointApiKey: savedVars.MODEL_ENDPOINT_API_KEY || undefined,
              modelEndpointModel: savedVars.MODEL_ENDPOINT_MODEL || undefined,
              modelEndpointModelLabel: savedVars.MODEL_ENDPOINT_MODEL_LABEL || undefined,
              modelEndpointModels: decodeSavedJson(savedVars.MODEL_ENDPOINT_MODELS_B64),
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
            },
            startedAt: "",
            containerId: vol.containerName,
          });
        } catch {
          // Skip one broken saved instance instead of failing the whole list.
        }
      }
    }

    // K8s instances
    if (includeK8s && await isClusterReachable()) {
      try {
        const k8sInstances = await discoverK8sInstances();
        for (const ki of k8sInstances) {
          const mode = await savedDeployMode(ki.namespace);
          let instance: DeployResult = {
            id: ki.namespace,
            mode,
            status: ki.status,
            config: {
              mode,
              prefix: ki.prefix,
              agentName: ki.agentName,
              agentDisplayName: ki.agentName
                ? ki.agentName.charAt(0).toUpperCase() + ki.agentName.slice(1)
                : ki.namespace,
              namespace: ki.namespace,
              image: ki.image,
            },
            startedAt: "",
            url: ki.url || undefined,
            containerId: ki.namespace,
            statusDetail: ki.statusDetail,
            pods: ki.pods,
          };

          // Let the deployer enrich with platform-specific info (e.g. Route URL)
          const deployer = registry.get(mode);
          if (deployer && typeof deployer.status === "function") {
            try {
              instance = await deployer.status(instance);
            } catch {
              // Use base instance if status enrichment fails
            }
          }

          instances.push(instance);
        }
      } catch {
        // Keep local instances visible even if cluster discovery fails.
      }
    }

    res.json(instances);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get single instance by container name
router.get("/:id", async (req, res) => {
  const runtime = await detectRuntime();
  if (!runtime) {
    res.status(404).json({ error: "No container runtime" });
    return;
  }

  const containers = await discoverContainers(runtime);
  const c = containers.find((c) => c.name === req.params.id);
  if (!c) {
    // Check if there's a volume for it (stopped instance)
    const instance = await findInstance(req.params.id);
    if (instance) {
      res.json(instance);
      return;
    }
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  res.json(containerToInstance(c));
});

// Start instance (re-creates container with --rm, volume has the state)
router.post("/:id/start", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = registry.get(instance.mode);
  if (!deployer) {
    res.status(400).json({ error: `No deployer registered for mode: ${instance.mode}` });
    return;
  }
  const log = createLogCallback(instance.id);
  try {
    await deployer.start(instance, log);
    sendStatus(instance.id, "running");
    res.json({ status: "running" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    res.status(500).json({ error: message });
  }
});

// Stop instance (--rm auto-removes container, volume stays)
router.post("/:id/stop", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = registry.get(instance.mode);
  if (!deployer) {
    res.status(400).json({ error: `No deployer registered for mode: ${instance.mode}` });
    return;
  }
  const log = createLogCallback(instance.id);
  await deployer.stop(instance, log);
  sendStatus(instance.id, "stopped");
  res.json({ status: "stopped" });
});

// Re-deploy: update agent files and restart (K8s: update ConfigMap + restart pod, Local: copy files + restart container)
router.post("/:id/redeploy", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = registry.get(instance.mode);
  if (!deployer) {
    res.status(400).json({ error: `No deployer registered for mode: ${instance.mode}` });
    return;
  }

  if (!("redeploy" in deployer) || typeof (deployer as unknown as Record<string, unknown>).redeploy !== "function") {
    res.status(400).json({ error: "Use Stop/Start for this deployer — redeploy is not supported" });
    return;
  }

  const log = createLogCallback(instance.id);
  try {
    await ((deployer as unknown as Record<string, unknown> & { redeploy: (r: DeployResult, l: typeof log) => Promise<void> }).redeploy(instance, log));
    sendStatus(instance.id, "running");
    res.json({ status: "redeploying" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    res.status(500).json({ error: message });
  }
});

// Approve the latest pending device pairing request for a running local instance.
router.post("/:id/approve-device", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  try {
    let stdout = "";
    let stderr = "";

    if (instance.mode === "local") {
      const runtime = await detectRuntime();
      if (!runtime) {
        res.status(500).json({ error: "No container runtime" });
        return;
      }

      const containers = await discoverContainers(runtime);
      const c = containers.find((container) => container.name === req.params.id);
      if (!c || c.status !== "running") {
        res.status(400).json({ error: "Instance must be running to approve pairing" });
        return;
      }

      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const result = await execFileAsync(runtime, [
        "exec",
        req.params.id,
        "openclaw",
        "devices",
        "approve",
        "--latest",
      ]);
      stdout = result.stdout.trim();
      stderr = result.stderr.trim();
    } else {
      const ns = instance.config.namespace || instance.containerId || "";
      const { coreApi, execInPod } = await import("../services/k8s.js");
      const core = coreApi();
      const podList = await core.listNamespacedPod({
        namespace: ns,
        labelSelector: "app=openclaw",
      });
      const pod = podList.items[0];
      const podName = pod?.metadata?.name;
      if (!podName) {
        res.status(400).json({ error: "No running pod found to approve pairing" });
        return;
      }

      const result = await execInPod(
        ns,
        podName,
        "gateway",
        ["openclaw", "devices", "approve", "--latest"],
      );
      stdout = result.stdout;
      stderr = result.stderr;
    }

    res.json({
      status: "approved",
      output: [stdout, stderr].filter(Boolean).join("").trim(),
    });
  } catch (err) {
    const execError = err as Error & { stdout?: string; stderr?: string };
    const details = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join("\n").trim();
    if (/\b(no|none|not)\b.*\b(pending|request|approval)\b/i.test(details)) {
      res.json({
        status: "noop",
        error: "No pending device pairing requests",
      });
      return;
    }
    res.status(500).json({ error: details || "Failed to approve device pairing" });
  }
});

// Get gateway token from running container or K8s secret
router.get("/:id/token", async (req, res) => {
  // Check if this is a K8s instance
  const instance = await findInstance(req.params.id);
  if (instance && instance.mode !== "local") {
    try {
      const core = (await import("../services/k8s.js")).coreApi();
      const ns = instance.config.namespace || instance.containerId || "";
      const secret = await core.readNamespacedSecret({ name: "openclaw-secrets", namespace: ns });
      const tokenB64 = secret.data?.["OPENCLAW_GATEWAY_TOKEN"] || "";
      const token = Buffer.from(tokenB64, "base64").toString("utf8");
      if (token) {
        res.json({ token });
      } else {
        res.status(404).json({ error: "No token found in secret" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
    return;
  }

  const savedToken = await readSavedGatewayToken(req.params.id);
  if (savedToken) {
    res.json({ token: savedToken });
    return;
  }

  const runtime = await detectRuntime();
  if (!runtime) {
    res.status(500).json({ error: "No container runtime" });
    return;
  }

  const containers = await discoverContainers(runtime);
  const c = containers.find((c) => c.name === req.params.id);
  if (!c || c.status !== "running") {
    res.status(400).json({ error: "Instance must be running to read token" });
    return;
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(runtime, [
      "exec",
      req.params.id,
      "node",
      "-e",
      "const c=JSON.parse(require('fs').readFileSync('/home/node/.openclaw/openclaw.json','utf8'));console.log(c.gateway?.auth?.token||'')",
    ]);
    const token = stdout.trim();
    if (token) {
      res.json({ token });
    } else {
      res.status(404).json({ error: "No token found in config" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get the run command (podman/docker for local, kubectl for K8s)
router.get("/:id/command", async (req, res) => {
  const instance = await findInstance(req.params.id);

  // Cluster instance — return useful kubectl/oc commands
  if (instance && instance.mode !== "local") {
    const ns = instance.config.namespace || instance.containerId || "";

    // Detect if LiteLLM sidecar is running
    let hasLitellm = false;
    try {
      const core = (await import("../services/k8s.js")).coreApi();
      const podList = await core.listNamespacedPod({ namespace: ns, labelSelector: "app=openclaw" });
      const pod = podList.items[0];
      hasLitellm = pod?.spec?.containers?.some((c) => c.name === "litellm") ?? false;
    } catch { /* ignore */ }

    const lines = [
      `# Port-forward to access the gateway locally`,
      `kubectl port-forward svc/openclaw 18789:18789 -n ${ns}`,
      ``,
      `# View pod status`,
      `kubectl get pods -n ${ns}`,
      ``,
      `# View gateway logs`,
      `kubectl logs deployment/openclaw -n ${ns} -c gateway -f`,
      ``,
      ...(hasLitellm ? [
        `# View LiteLLM proxy logs`,
        `kubectl logs deployment/openclaw -n ${ns} -c litellm -f`,
        ``,
      ] : []),
      `# View init container logs`,
      `kubectl logs deployment/openclaw -n ${ns} -c init-config`,
      ``,
      `# Get gateway token`,
      `kubectl get secret openclaw-secrets -n ${ns} -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 -d`,
      ``,
      `# Scale deployment`,
      `kubectl scale deployment/openclaw --replicas=0 -n ${ns}  # stop`,
      `kubectl scale deployment/openclaw --replicas=1 -n ${ns}  # start`,
      ``,
      `# Delete everything`,
      `kubectl delete namespace ${ns}`,
    ];
    res.json({ command: lines.join("\n") });
    return;
  }

  const runtime = await detectRuntime();
  if (!runtime) {
    res.status(500).json({ error: "No container runtime" });
    return;
  }

  const containers = await discoverContainers(runtime);
  const c = containers.find((c) => c.name === req.params.id);
  if (!c || c.status !== "running") {
    res.status(400).json({ error: "Instance must be running" });
    return;
  }

  try {
    const { execFile: ef } = await import("node:child_process");
    const { promisify: p } = await import("node:util");
    const exec = p(ef);

    const containerName = req.params.id;
    const litellmName = `${containerName}-litellm`;
    const pod = `${containerName}-pod`;
    const savedVars = await readSavedConfig(containerName);
    const savedRunArgs = parseContainerRunArgs(savedVars.OPENCLAW_CONTAINER_RUN_ARGS);

    // Detect if LiteLLM sidecar is running
    let hasLitellm = false;
    let hasPod = false;
    try {
      await exec(runtime, ["inspect", litellmName]);
      hasLitellm = true;
    } catch { /* no sidecar */ }
    if (runtime === "podman") {
      try {
        await exec(runtime, ["pod", "inspect", pod]);
        hasPod = true;
      } catch { /* no pod */ }
    }

    // Build useful commands section
    const lines: string[] = [];
    lines.push(`# Container info`);
    if (hasPod) {
      lines.push(`${runtime} pod ps              # list pods`);
      lines.push(`${runtime} pod inspect ${pod}   # pod details`);
      lines.push(``);
    }
    lines.push(`# Gateway logs`);
    lines.push(`${runtime} logs -f ${containerName}`);
    lines.push(``);
    if (hasLitellm) {
      lines.push(`# LiteLLM proxy logs`);
      lines.push(`${runtime} logs -f ${litellmName}`);
      lines.push(``);
    }
    lines.push(`# Stop`);
    lines.push(`${runtime} stop ${containerName}`);
    if (hasLitellm) {
      lines.push(`${runtime} stop ${litellmName}`);
    }
    if (hasPod) {
      lines.push(`${runtime} pod rm -f ${pod}`);
    }
    lines.push(``);

    // Also include the reconstructed run command
    const { stdout } = await exec(runtime, ["inspect", "--format", "json", containerName]);
    const info = JSON.parse(stdout)[0] || JSON.parse(stdout);
    const config = info.Config || {};
    const hostConfig = info.HostConfig || {};

    const parts = [runtime, "run", "-d", "--rm"];
    parts.push("--name", containerName);

    if (hostConfig.NetworkMode === "host") {
      parts.push("--network", "host");
    } else {
      const portBindings = hostConfig.PortBindings || {};
      for (const [containerPort, bindings] of Object.entries(portBindings)) {
        if (Array.isArray(bindings)) {
          for (const b of bindings as Array<{ HostPort?: string }>) {
            const hostPort = b.HostPort || "";
            const cp = containerPort.replace("/tcp", "");
            parts.push("-p", `${hostPort}:${cp}`);
          }
        }
      }
    }

    const envList: string[] = config.Env || [];
    const redactedEnvKeys = new Set([
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "TELEGRAM_BOT_TOKEN",
      "SSH_IDENTITY",
      "SSH_CERTIFICATE",
      "SSH_KNOWN_HOSTS",
    ]);
    for (const e of envList) {
      if (e.startsWith("PATH=") || e.startsWith("HOSTNAME=") || e.startsWith("container=")) continue;
      const [key] = e.split("=", 1);
      if (redactedEnvKeys.has(key) || key.endsWith("_TOKEN") || key.endsWith("_API_KEY")) {
        parts.push("-e", `${key}=***`);
      } else {
        parts.push("-e", `"${e}"`);
      }
    }

    const mounts = info.Mounts || [];
    for (const m of mounts) {
      if (m.Type === "volume") {
        parts.push("-v", `${m.Name}:${m.Destination}`);
      } else if (m.Type === "bind") {
        parts.push("-v", `${m.Source}:${m.Destination}`);
      }
    }

    const labels: Record<string, string> = config.Labels || {};
    for (const [k, v] of Object.entries(labels)) {
      if (k.startsWith("openclaw.")) {
        parts.push("--label", `${k}=${v}`);
      }
    }

    parts.push(...savedRunArgs);
    parts.push(config.Image || c.image);
    const cmd: string[] = config.Cmd || [];
    if (cmd.length > 0) {
      parts.push(...cmd);
    }

    lines.push(`# Full run command (gateway)`);
    lines.push(parts.join(" \\\n  "));

    res.json({ command: lines.join("\n") });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get container/pod logs (last 50 lines)
router.get("/:id/logs", async (req, res) => {
  const instance = await findInstance(req.params.id);

  // Cluster instance — read pod logs via K8s API
  if (instance && instance.mode !== "local") {
    const ns = instance.config.namespace || instance.containerId || "";
    try {
      const core = (await import("../services/k8s.js")).coreApi();
      const podList = await core.listNamespacedPod({
        namespace: ns,
        labelSelector: "app=openclaw",
      });
      const pod = podList.items[0];
      if (!pod?.metadata?.name) {
        res.status(400).json({ error: "No pods found" });
        return;
      }
      const logs = await core.readNamespacedPodLog({
        name: pod.metadata.name,
        namespace: ns,
        container: "gateway",
        tailLines: 100,
      });
      res.json({ logs: typeof logs === "string" ? logs : String(logs) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
    return;
  }

  const runtime = await detectRuntime();
  if (!runtime) {
    res.status(500).json({ error: "No container runtime" });
    return;
  }

  const containers = await discoverContainers(runtime);
  const c = containers.find((c) => c.name === req.params.id);
  if (!c || c.status !== "running") {
    res.status(400).json({ error: "Instance must be running to read logs" });
    return;
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout, stderr } = await execFileAsync(runtime, [
      "logs", "--tail", "50", req.params.id,
    ]);
    res.json({ logs: (stdout + stderr).trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Delete data (remove volume or namespace — the nuclear option)
router.delete("/:id", async (req, res) => {
  const instance = await findInstance(req.params.id);
  if (!instance) {
    res.status(404).json({ error: "Instance not found" });
    return;
  }

  const deployer = registry.get(instance.mode);
  if (!deployer) {
    res.status(400).json({ error: `No deployer registered for mode: ${instance.mode}` });
    return;
  }
  const log = createLogCallback(instance.id);
  await deployer.teardown(instance, log);
  res.json({ status: "deleted" });
});

/**
 * Read saved .env file from ~/.openclaw/installer/local/<dir>/.env
 * to reconstruct deploy config for stopped instances.
 */
async function readSavedConfig(containerName: string): Promise<Record<string, string>> {
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

async function readSavedGatewayToken(containerName: string): Promise<string | undefined> {
  try {
    const tokenPath = join(installerLocalInstanceDir(containerName), "gateway-token");
    const token = (await readFile(tokenPath, "utf8")).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}


/**
 * Read the saved deploy-config.json for a K8s namespace to get the actual deploy mode.
 * Returns "kubernetes" as fallback if no saved config exists.
 */
async function savedDeployMode(namespace: string): Promise<string> {
  try {
    const configPath = join(installerDataDir(), "k8s", namespace, "deploy-config.json");
    const content = await readFile(configPath, "utf8");
    const config = JSON.parse(content);
    return config.mode || "kubernetes";
  } catch {
    return "kubernetes";
  }
}

// Helper: find instance by container name, volume, or K8s namespace
async function findInstance(name: string): Promise<DeployResult | null> {
  // Check local containers and volumes
  const runtime = await detectRuntime();
  if (runtime) {
    const containers = await discoverContainers(runtime);
    const c = containers.find((c) => c.name === name);
    if (c) return containerToInstance(c);

    const volumes = await discoverVolumes(runtime);
    const vol = volumes.find((v) => v.containerName === name);
    if (vol) {
      const savedVars = await readSavedConfig(name);
      const prefix = savedVars.OPENCLAW_PREFIX || name.replace(/^openclaw-/, "");
      const agentName = savedVars.OPENCLAW_AGENT_NAME || prefix;

      return {
        id: name,
        mode: "local",
        status: "stopped",
        volumeName: vol.name,
        config: {
          mode: "local",
          prefix,
          agentName,
          agentDisplayName: savedVars.OPENCLAW_DISPLAY_NAME || agentName,
          containerRuntime: runtime,
          image: savedVars.OPENCLAW_IMAGE || undefined,
          port: savedVars.OPENCLAW_PORT ? parseInt(savedVars.OPENCLAW_PORT, 10) : undefined,
          containerRunArgs: savedVars.OPENCLAW_CONTAINER_RUN_ARGS || undefined,
          inferenceProvider: savedVars.INFERENCE_PROVIDER as
            | "anthropic"
            | "openai"
            | "vertex-anthropic"
            | "vertex-google"
            | "custom-endpoint"
            | undefined,
          agentSecurityMode:
            (savedVars.AGENT_SECURITY_MODE as "basic" | "secretrefs") || undefined,
          secretsProvidersJson: decodeSavedBase64(savedVars.SECRETS_PROVIDERS_JSON_B64),
          anthropicApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.ANTHROPIC_API_KEY_REF_B64),
          openaiApiKeyRef: decodeSavedJson<DeploySecretRef>(savedVars.OPENAI_API_KEY_REF_B64),
          telegramBotTokenRef: decodeSavedJson<DeploySecretRef>(savedVars.TELEGRAM_BOT_TOKEN_REF_B64),
          anthropicApiKey: savedVars.ANTHROPIC_API_KEY || undefined,
          openaiApiKey: savedVars.OPENAI_API_KEY || undefined,
          anthropicModel: savedVars.ANTHROPIC_MODEL || undefined,
          openaiModel: savedVars.OPENAI_MODEL || undefined,
          modelFallbacks: decodeSavedJson(savedVars.MODEL_FALLBACKS_B64),
          openaiCompatibleEndpointsEnabled:
            savedVars.OPENAI_COMPATIBLE_ENDPOINTS_ENABLED === "false" ? false : undefined,
          modelEndpointApiKey: savedVars.MODEL_ENDPOINT_API_KEY || undefined,
          modelEndpointModel: savedVars.MODEL_ENDPOINT_MODEL || undefined,
          modelEndpointModelLabel: savedVars.MODEL_ENDPOINT_MODEL_LABEL || undefined,
          modelEndpointModels: decodeSavedJson(savedVars.MODEL_ENDPOINT_MODELS_B64),
          agentModel: savedVars.AGENT_MODEL || undefined,
          modelEndpoint: savedVars.MODEL_ENDPOINT || undefined,
          agentSourceDir: savedVars.AGENT_SOURCE_DIR || undefined,
          vertexEnabled: savedVars.VERTEX_ENABLED === "true" || undefined,
          vertexProvider: (savedVars.VERTEX_PROVIDER as "google" | "anthropic") || undefined,
          googleCloudProject: savedVars.GOOGLE_CLOUD_PROJECT || undefined,
          googleCloudLocation: savedVars.GOOGLE_CLOUD_LOCATION || undefined,
          // SA JSON is on the volume — set a sentinel so buildRunArgs sets GOOGLE_APPLICATION_CREDENTIALS
          gcpServiceAccountJson: savedVars.GOOGLE_APPLICATION_CREDENTIALS ? "(on-volume)" : undefined,
          litellmProxy: savedVars.LITELLM_PROXY === "true" || undefined,
          otelEnabled: savedVars.OTEL_ENABLED === "true" || undefined,
          otelJaeger: savedVars.OTEL_JAEGER === "true" || undefined,
          otelEndpoint: savedVars.OTEL_ENDPOINT || undefined,
          otelExperimentId: savedVars.OTEL_EXPERIMENT_ID || undefined,
          otelImage: savedVars.OTEL_IMAGE || undefined,
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
        },
        startedAt: "",
        containerId: name,
      };
    }
  }

  // Check K8s namespaces
  const k8sInstances = await discoverK8sInstances({ namespaces: [name] });
  const ki = k8sInstances.find((i) => i.namespace === name);
  if (ki) {
    const mode = await savedDeployMode(ki.namespace);
    let instance: DeployResult = {
      id: ki.namespace,
      mode,
      status: ki.status,
      config: {
        mode,
        prefix: ki.prefix,
        agentName: ki.agentName,
        agentDisplayName: ki.agentName
          ? ki.agentName.charAt(0).toUpperCase() + ki.agentName.slice(1)
          : ki.namespace,
        namespace: ki.namespace,
        image: ki.image,
      },
      startedAt: "",
      url: ki.url || undefined,
      containerId: ki.namespace,
      statusDetail: ki.statusDetail,
      pods: ki.pods,
    };

    const deployer = registry.get(mode);
    if (deployer && typeof deployer.status === "function") {
      try {
        instance = await deployer.status(instance);
      } catch {
        // Use base instance if status enrichment fails
      }
    }

    return instance;
  }

  return null;
}

export default router;
