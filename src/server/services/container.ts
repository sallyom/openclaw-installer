import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ContainerRuntime = "podman" | "docker";

export async function detectRuntime(): Promise<ContainerRuntime | null> {
  for (const rt of ["podman", "docker"] as const) {
    try {
      await execFileAsync(rt, ["--version"]);
      return rt;
    } catch {
      // not found, try next
    }
  }
  return null;
}

export async function isContainerRunning(
  runtime: ContainerRuntime,
  name: string,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(runtime, [
      "inspect",
      "--format",
      "{{.State.Running}}",
      name,
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function getContainerStatus(
  runtime: ContainerRuntime,
  name: string,
): Promise<"running" | "stopped" | "unknown"> {
  try {
    const { stdout } = await execFileAsync(runtime, [
      "inspect",
      "--format",
      "{{.State.Status}}",
      name,
    ]);
    const status = stdout.trim();
    if (status === "running") return "running";
    return "stopped";
  } catch {
    return "unknown";
  }
}

export async function removeContainer(
  runtime: ContainerRuntime,
  name: string,
): Promise<void> {
  try {
    await execFileAsync(runtime, ["rm", "-f", name]);
  } catch {
    // ignore if not found
  }
}

export async function removeVolume(
  runtime: ContainerRuntime,
  name: string,
): Promise<void> {
  try {
    await execFileAsync(runtime, ["volume", "rm", name]);
  } catch {
    // ignore if not found
  }
}

export interface DiscoveredVolume {
  name: string;
  /** The container name this volume belongs to (openclaw-<prefix>-<agent>) */
  containerName: string;
}

/**
 * Discover openclaw data volumes (openclaw-*-data pattern).
 * These represent instances that can be started even if no container exists.
 */
export async function discoverVolumes(
  runtime: ContainerRuntime,
): Promise<DiscoveredVolume[]> {
  try {
    const { stdout } = await execFileAsync(runtime, [
      "volume",
      "ls",
      "--format",
      "{{.Name}}",
    ]);
    return stdout
      .trim()
      .split("\n")
      .filter((name) => name.match(/^openclaw-.+-data$/))
      .map((name) => ({
        name,
        // openclaw-sally-lynx-data -> openclaw-sally-lynx
        containerName: name.replace(/-data$/, ""),
      }));
  } catch {
    return [];
  }
}

// Labels used by the installer to tag containers it creates
export const OPENCLAW_LABELS = {
  managed: "openclaw.managed=true",
  prefix: (v: string) => `openclaw.prefix=${v}`,
  agent: (v: string) => `openclaw.agent=${v}`,
};

export interface DiscoveredContainer {
  name: string;
  status: "running" | "stopped" | "unknown";
  image: string;
  ports: string;
  labels: Record<string, string>;
  createdAt: string;
}

function isOpenClawRuntimeImage(image: string): boolean {
  const normalized = image.trim().toLowerCase();
  if (!normalized) return false;

  const withoutDigest = normalized.split("@")[0];
  const lastSegment = withoutDigest.split("/").pop() || withoutDigest;
  const repoName = lastSegment.split(":")[0];

  return repoName === "openclaw";
}

/**
 * Check whether a host port is available for binding.
 * If the port is already in use, tries to identify the container using it
 * and throws an error with a helpful message.
 */
export async function checkPortAvailable(
  port: number,
  runtime: ContainerRuntime,
): Promise<void> {
  const portFree = await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve(true));
    });
  });

  if (portFree) return;

  // Port is in use — try to find which container is using it
  let occupant = "";
  try {
    const { stdout } = await execFileAsync(runtime, [
      "ps",
      "--format",
      "{{.Names}}\t{{.Ports}}",
    ]);
    for (const line of stdout.trim().split("\n")) {
      if (!line.trim()) continue;
      if (line.includes(`:${port}->`)) {
        const name = line.split("\t")[0];
        if (name) {
          occupant = ` by container ${name.trim()}`;
          break;
        }
      }
    }
  } catch {
    // Container runtime query failed — still report the port conflict
  }

  throw new Error(
    `Port ${port} is already in use${occupant}. Stop the existing instance first or choose a different port.`,
  );
}

/**
 * Discover all OpenClaw containers — both installer-managed (by label)
 * and manually launched runtime containers (by image repo name "openclaw").
 */
export async function discoverContainers(
  runtime: ContainerRuntime,
): Promise<DiscoveredContainer[]> {
  try {
    // Get ALL containers (running + stopped) as JSON
    const { stdout } = await execFileAsync(runtime, [
      "ps",
      "-a",
      "--format",
      "json",
    ]);

    if (!stdout.trim()) return [];

    // podman outputs one JSON object per line; docker outputs a JSON array
    let containers: Array<Record<string, unknown>>;
    const trimmed = stdout.trim();
    if (trimmed.startsWith("[")) {
      containers = JSON.parse(trimmed);
    } else {
      // podman: one JSON object per line
      containers = trimmed
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    }

    const results: DiscoveredContainer[] = [];

    for (const c of containers) {
      // Normalize field names (podman uses PascalCase, docker uses lowercase)
      const image = String(c.Image || c.image || "");
      const names = c.Names || c.names;
      const name = Array.isArray(names)
        ? names[0]
        : String(names || "").replace(/^\//, "");
      const state = String(c.State || c.state || "");
      const labels: Record<string, string> =
        (c.Labels as Record<string, string>) || {};
      const created = String(c.CreatedAt || c.Created || c.created || "");
      const ports = c.Ports || c.ports || "";
      const portsStr = Array.isArray(ports) ? JSON.stringify(ports) : String(ports);

      // Match by installer label OR by the OpenClaw runtime image name.
      // Exclude installer images like openclaw-installer from local instances.
      const hasLabel = labels["openclaw.managed"] === "true";
      const hasImage = isOpenClawRuntimeImage(image);

      if (!hasLabel && !hasImage) continue;

      let status: "running" | "stopped" | "unknown" = "unknown";
      const stateLower = state.toLowerCase();
      if (stateLower === "running") status = "running";
      else if (
        stateLower === "exited" ||
        stateLower === "stopped" ||
        stateLower === "created"
      )
        status = "stopped";

      results.push({
        name,
        status,
        image,
        ports: portsStr,
        labels,
        createdAt: created,
      });
    }

    return results;
  } catch {
    return [];
  }
}
