/**
 * Tokenizer sidecar container management for the local (podman/docker) deployer.
 *
 * Extracted to keep local.ts manageable — same pattern as the LiteLLM sidecar.
 */
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  removeContainer,
  OPENCLAW_LABELS,
  type ContainerRuntime,
} from "../services/container.js";
import {
  TOKENIZER_IMAGE,
  TOKENIZER_PORT,
} from "./tokenizer.js";
import type { DeployConfig, LogCallback } from "./types.js";

const execFileAsync = promisify(execFile);

export const TOKENIZER_OPEN_KEY_PATH = "/home/node/.openclaw/tokenizer/open-key";
/** The gateway port inside the container (same as DEFAULT_PORT in local.ts). */
const GATEWAY_INTERNAL_PORT = 18789;

/** Container name for the tokenizer sidecar. */
export function tokenizerContainerName(containerName: string): string {
  return `${containerName}-tokenizer`;
}

/**
 * Common run args for the tokenizer sidecar.
 *
 * The upstream tokenizer binary reads OPEN_KEY from the environment.
 * We read it from a file on the shared volume at startup via the
 * entrypoint command so the key never leaks via `podman inspect` or
 * `docker inspect` (since it's not passed via -e). It is present in the
 * process environment at runtime but is isolated to the container's PID
 * namespace.
 */
function tokenizerRunArgs(
  config: DeployConfig,
  tkzName: string,
  vol: string,
): string[] {
  const tkzImage = config.tokenizerImage || TOKENIZER_IMAGE;
  return [
    "run", "-d",
    "--name", tkzName,
    "--label", OPENCLAW_LABELS.managed,
    "-v", `${vol}:/home/node/.openclaw:ro`,
    "-e", `LISTEN_ADDRESS=0.0.0.0:${TOKENIZER_PORT}`,
    "-e", `OPEN_KEY_FILE=${TOKENIZER_OPEN_KEY_PATH}`,
    tkzImage,
  ];
}

export interface StartTokenizerOpts {
  config: DeployConfig;
  runtime: ContainerRuntime;
  tkzName: string;
  vol: string;
  port: number;
  podName: string;
  /** Name of a container whose network namespace to share (docker only). */
  networkContainer?: string;
  log: LogCallback;
  runCommand: (cmd: string, args: string[], log: LogCallback) => Promise<{ code: number }>;
}

/**
 * Start the tokenizer sidecar container.
 *
 * Podman:  adds the container to the given pod.
 * Docker:  if `networkContainer` is set, shares its network namespace;
 *          otherwise publishes the gateway port itself.
 */
export async function startTokenizerContainer(opts: StartTokenizerOpts): Promise<void> {
  const { config, runtime, tkzName, vol, port, podName: pod, networkContainer, log, runCommand: run } = opts;
  const isPodman = runtime === "podman";
  const baseArgs = tokenizerRunArgs(config, tkzName, vol);

  if (isPodman) {
    // Remove any existing stopped container with the same name before creating
    await removeContainer(runtime, tkzName);
    // Insert --pod right after --name
    const args = [...baseArgs];
    const nameIdx = args.indexOf("--name");
    args.splice(nameIdx + 2, 0, "--pod", pod);
    const result = await run(runtime, args, log);
    if (result.code !== 0) {
      throw new Error("Failed to start Tokenizer sidecar");
    }
  } else {
    await removeContainer(runtime, tkzName);
    const args = [...baseArgs];
    const nameIdx = args.indexOf("--name");
    if (networkContainer) {
      args.splice(nameIdx + 2, 0, "--network", `container:${networkContainer}`);
    } else {
      // Publish the gateway port, not the tokenizer port — the gateway
      // container will join this container's network namespace via
      // --network container:<tkz> and listen on the gateway port inside the shared namespace.
      // Use a restart policy so transient tokenizer crashes don't permanently
      // take down the gateway's port mapping (the network namespace is owned
      // by this container in Docker mode).
      args.splice(nameIdx + 2, 0, "-p", `${port}:${GATEWAY_INTERNAL_PORT}`, "--restart", "on-failure:5");
    }
    const result = await run(runtime, args, log);
    if (result.code !== 0) {
      throw new Error("Failed to start Tokenizer sidecar");
    }
  }

  log("Waiting for Tokenizer proxy to start...");
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      // Verify the container is running and the tokenizer port is open.
      // The tokenizer returns 400 on bare requests (no proxy headers), so
      // just check that the TCP port is accepting connections.
      // Use nc -z which is available in alpine (busybox) — /dev/tcp is
      // a bash-ism not supported by busybox sh in alpine-based images.
      await execFileAsync(runtime, [
        "exec", tkzName, "nc", "-z", "localhost", String(TOKENIZER_PORT),
      ]);
      log("Tokenizer proxy started");
      return;
    } catch {
      // Check if the container still exists and is running — exit early if it crashed
      try {
        const { stdout } = await execFileAsync(runtime, [
          "inspect", "--format", "{{.State.Running}}", tkzName,
        ]);
        if (stdout.trim() !== "true") {
          throw new Error("Tokenizer container exited unexpectedly — check logs with: " +
            `${runtime} logs ${tkzName}`);
        }
      } catch (inspectErr) {
        // Container doesn't exist at all (--rm already cleaned it up)
        if (inspectErr instanceof Error && inspectErr.message.includes("Tokenizer container exited")) {
          throw inspectErr;
        }
        throw new Error("Tokenizer container disappeared — it may have crashed on startup. " +
          "Check the image and configuration.", { cause: inspectErr });
      }
      if (i === maxAttempts - 1) {
        throw new Error("Tokenizer readiness check timed out after " + maxAttempts + " seconds");
      }
    }
  }
}

/** Stop and remove the tokenizer sidecar (best-effort). */
export async function stopTokenizerContainer(
  runtime: string,
  containerName: string,
  log: LogCallback,
  runCommand: (cmd: string, args: string[], log: LogCallback) => Promise<{ code: number }>,
): Promise<void> {
  try {
    await execFileAsync(runtime, ["inspect", containerName]);
  } catch {
    // Container doesn't exist — nothing to stop
    return;
  }
  log(`Stopping Tokenizer sidecar: ${containerName}`);
  try {
    await runCommand(runtime, ["stop", containerName], log);
  } catch (err) {
    log(`WARNING: Failed to stop Tokenizer sidecar: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Remove the stopped container so a fresh one can be created with the same name
  await removeContainer(runtime as ContainerRuntime, containerName);
}
