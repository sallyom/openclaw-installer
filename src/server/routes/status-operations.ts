import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  discoverContainers,
  detectRuntime,
  type ContainerRuntime,
  type DiscoveredContainer,
} from "../services/container.js";
import { coreApi, execInPod } from "../services/k8s.js";
import { parseContainerRunArgs } from "../deployers/local.js";
import type { DeployResult } from "../deployers/types.js";
import type { PodmanSecretMapping } from "../../shared/podman-secrets.js";
import { decodeSavedJson, readSavedConfig, readSavedGatewayToken } from "./status-instances.js";

const execFileAsync = promisify(execFile);

async function findRunningLocalContainer(name: string): Promise<{
  runtime: ContainerRuntime;
  container: DiscoveredContainer;
} | null> {
  const runtime = await detectRuntime();
  if (!runtime) {
    return null;
  }

  const containers = await discoverContainers(runtime);
  const container = containers.find((entry) => entry.name === name);
  if (!container || container.status !== "running") {
    return null;
  }

  return { runtime, container };
}

async function getOpenClawPodName(namespace: string): Promise<string | null> {
  const core = coreApi();
  const podList = await core.listNamespacedPod({
    namespace,
    labelSelector: "app=openclaw",
  });
  return podList.items[0]?.metadata?.name || null;
}

export async function approveLatestDevicePairing(instance: DeployResult): Promise<{
  status: "approved" | "noop";
  output?: string;
  error?: string;
}> {
  try {
    let stdout = "";
    let stderr = "";

    if (instance.mode === "local") {
      const running = await findRunningLocalContainer(instance.id);
      if (!running) {
        throw new Error("Instance must be running to approve pairing");
      }

      const result = await execFileAsync(running.runtime, [
        "exec",
        instance.id,
        "openclaw",
        "devices",
        "approve",
        "--latest",
      ]);
      stdout = result.stdout.trim();
      stderr = result.stderr.trim();
    } else {
      const namespace = instance.config.namespace || instance.containerId || "";
      const podName = await getOpenClawPodName(namespace);
      if (!podName) {
        throw new Error("No running pod found to approve pairing");
      }

      const result = await execInPod(
        namespace,
        podName,
        "gateway",
        ["openclaw", "devices", "approve", "--latest"],
      );
      stdout = result.stdout;
      stderr = result.stderr;
    }

    return {
      status: "approved",
      output: [stdout, stderr].filter(Boolean).join("").trim(),
    };
  } catch (err) {
    const execError = err as Error & { stdout?: string; stderr?: string };
    const details = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join("\n").trim();
    if (/\b(no|none|not)\b.*\b(pending|request|approval)\b/i.test(details)) {
      return {
        status: "noop",
        error: "No pending device pairing requests",
      };
    }
    throw new Error(details || "Failed to approve device pairing", { cause: err });
  }
}

export async function getGatewayToken(instance: DeployResult | null, id: string): Promise<string> {
  if (instance && instance.mode !== "local") {
    const namespace = instance.config.namespace || instance.containerId || "";
    const secret = await coreApi().readNamespacedSecret({ name: "openclaw-secrets", namespace });
    const tokenB64 = secret.data?.["OPENCLAW_GATEWAY_TOKEN"] || "";
    const token = Buffer.from(tokenB64, "base64").toString("utf8").trim();
    if (!token) {
      throw new Error("No token found in secret");
    }
    return token;
  }

  const savedToken = await readSavedGatewayToken(id);
  if (savedToken) {
    return savedToken;
  }

  const running = await findRunningLocalContainer(id);
  if (!running) {
    throw new Error("Instance must be running to read token");
  }

  const { stdout } = await execFileAsync(running.runtime, [
    "exec",
    id,
    "node",
    "-e",
    "const c=JSON.parse(require('fs').readFileSync('/home/node/.openclaw/openclaw.json','utf8'));console.log(c.gateway?.auth?.token||'')",
  ]);
  const token = stdout.trim();
  if (!token) {
    throw new Error("No token found in config");
  }
  return token;
}

export async function buildInstanceCommand(instance: DeployResult | null, id: string): Promise<string> {
  if (instance && instance.mode !== "local") {
    const namespace = instance.config.namespace || instance.containerId || "";

    let hasLitellm = false;
    try {
      const podName = await getOpenClawPodName(namespace);
      if (podName) {
        const podList = await coreApi().listNamespacedPod({ namespace, labelSelector: "app=openclaw" });
        const pod = podList.items[0];
        hasLitellm = pod?.spec?.containers?.some((container) => container.name === "litellm") ?? false;
      }
    } catch {
      // ignore
    }

    return [
      `# Port-forward to access the gateway locally`,
      `kubectl port-forward svc/openclaw 18789:18789 -n ${namespace}`,
      ``,
      `# View pod status`,
      `kubectl get pods -n ${namespace}`,
      ``,
      `# View gateway logs`,
      `kubectl logs deployment/openclaw -n ${namespace} -c gateway -f`,
      ``,
      ...(hasLitellm ? [
        `# View LiteLLM proxy logs`,
        `kubectl logs deployment/openclaw -n ${namespace} -c litellm -f`,
        ``,
      ] : []),
      `# View init container logs`,
      `kubectl logs deployment/openclaw -n ${namespace} -c init-config`,
      ``,
      `# Get gateway token`,
      `kubectl get secret openclaw-secrets -n ${namespace} -o jsonpath='{.data.OPENCLAW_GATEWAY_TOKEN}' | base64 -d`,
      ``,
      `# Scale deployment`,
      `kubectl scale deployment/openclaw --replicas=0 -n ${namespace}  # stop`,
      `kubectl scale deployment/openclaw --replicas=1 -n ${namespace}  # start`,
      ``,
      `# Delete everything`,
      `kubectl delete namespace ${namespace}`,
    ].join("\n");
  }

  const running = await findRunningLocalContainer(id);
  if (!running) {
    throw new Error("Instance must be running");
  }

  const containerName = id;
  const runtime = running.runtime;
  const litellmName = `${containerName}-litellm`;
  const pod = `${containerName}-pod`;
  const savedVars = await readSavedConfig(containerName);
  const savedRunArgs = parseContainerRunArgs(savedVars.OPENCLAW_CONTAINER_RUN_ARGS);
  const savedPodmanSecretMappings =
    decodeSavedJson<PodmanSecretMapping[]>(savedVars.PODMAN_SECRET_MAPPINGS_B64) || [];

  let hasLitellm = false;
  let hasPod = false;
  try {
    await execFileAsync(runtime, ["inspect", litellmName]);
    hasLitellm = true;
  } catch {
    // no sidecar
  }
  if (runtime === "podman") {
    try {
      await execFileAsync(runtime, ["pod", "inspect", pod]);
      hasPod = true;
    } catch {
      // no pod
    }
  }

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

  const { stdout } = await execFileAsync(runtime, ["inspect", "--format", "json", containerName]);
  const info = JSON.parse(stdout)[0] || JSON.parse(stdout);
  const config = info.Config || {};
  const hostConfig = info.HostConfig || {};

  const parts = [runtime, "run", "-d", "--restart=unless-stopped"];
  parts.push("--name", containerName);

  if (hostConfig.NetworkMode === "host") {
    parts.push("--network", "host");
  } else {
    const portBindings = hostConfig.PortBindings || {};
    for (const [containerPort, bindings] of Object.entries(portBindings)) {
      if (Array.isArray(bindings)) {
        for (const binding of bindings as Array<{ HostPort?: string }>) {
          const hostPort = binding.HostPort || "";
          const port = containerPort.replace("/tcp", "");
          parts.push("-p", `${hostPort}:${port}`);
        }
      }
    }
  }

  const envList: string[] = config.Env || [];
  const savedSecretNames = new Set(savedPodmanSecretMappings.map((entry) => entry.secretName));
  const savedSecretTargets = new Set(savedPodmanSecretMappings.map((entry) => entry.targetEnv));
  const redactedEnvKeys = new Set([
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "MODEL_ENDPOINT_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "SSH_IDENTITY",
    "SSH_CERTIFICATE",
    "SSH_KNOWN_HOSTS",
  ]);
  for (const envValue of envList) {
    if (envValue.startsWith("PATH=") || envValue.startsWith("HOSTNAME=") || envValue.startsWith("container=")) continue;
    const [key] = envValue.split("=", 1);
    if (savedSecretNames.has(key) || savedSecretTargets.has(key)) continue;
    if (redactedEnvKeys.has(key) || key.endsWith("_TOKEN") || key.endsWith("_API_KEY")) {
      parts.push("-e", `${key}=***`);
    } else {
      parts.push("-e", `"${envValue}"`);
    }
  }

  for (const mapping of savedPodmanSecretMappings) {
    parts.push("--secret", `${mapping.secretName},type=env,target=${mapping.targetEnv}`);
  }

  const mounts = info.Mounts || [];
  for (const mount of mounts) {
    if (mount.Type === "volume") {
      parts.push("-v", `${mount.Name}:${mount.Destination}`);
    } else if (mount.Type === "bind") {
      parts.push("-v", `${mount.Source}:${mount.Destination}`);
    }
  }

  const labels: Record<string, string> = config.Labels || {};
  for (const [key, value] of Object.entries(labels)) {
    if (key.startsWith("openclaw.")) {
      parts.push("--label", `${key}=${value}`);
    }
  }

  parts.push(...savedRunArgs);
  parts.push(config.Image || running.container.image);
  const cmd: string[] = config.Cmd || [];
  if (cmd.length > 0) {
    parts.push(...cmd);
  }

  lines.push(`# Full run command (gateway)`);
  lines.push(parts.join(" \\\n  "));

  return lines.join("\n");
}

export async function getInstanceLogs(instance: DeployResult | null, id: string): Promise<string> {
  if (instance && instance.mode !== "local") {
    const namespace = instance.config.namespace || instance.containerId || "";
    const podName = await getOpenClawPodName(namespace);
    if (!podName) {
      throw new Error("No pods found");
    }

    const logs = await coreApi().readNamespacedPodLog({
      name: podName,
      namespace,
      container: "gateway",
      tailLines: 100,
    });
    return typeof logs === "string" ? logs : String(logs);
  }

  const running = await findRunningLocalContainer(id);
  if (!running) {
    throw new Error("Instance must be running to read logs");
  }

  const { stdout, stderr } = await execFileAsync(running.runtime, [
    "logs", "--tail", "50", id,
  ]);
  return (stdout + stderr).trim();
}
