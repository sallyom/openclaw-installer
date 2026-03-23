import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeployConfig, LogCallback } from "../types.js";
import { TOKENIZER_IMAGE, TOKENIZER_PORT } from "../tokenizer.js";

// ── Mocks ───────────────────────────────────────────────────────────

// Mock child_process.execFile (used by stopTokenizerContainer for inspect)
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock container.removeContainer (used by startTokenizerContainer docker path)
// Must also re-export OPENCLAW_LABELS since local-tokenizer.ts imports it.
vi.mock("../../services/container.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/container.js")>();
  return {
    ...actual,
    removeContainer: vi.fn(async () => {}),
  };
});

// Import after mocks are set up
import {
  tokenizerContainerName,
  startTokenizerContainer,
  stopTokenizerContainer,
  TOKENIZER_OPEN_KEY_PATH,
  type StartTokenizerOpts,
} from "../local-tokenizer.js";

import { execFile } from "node:child_process";
import { removeContainer } from "../../services/container.js";

// ── Helpers ─────────────────────────────────────────────────────────

function minimalConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "local",
    agentName: "test",
    agentDisplayName: "Test",
    ...overrides,
  };
}

function mockLog(): { log: LogCallback; lines: string[] } {
  const lines: string[] = [];
  return { log: (line: string) => lines.push(line), lines };
}

function mockRunCommand(code = 0) {
  return vi.fn(async () => ({ code }));
}

// Make execFile call back with success or error
function mockExecFileSuccess() {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], cb?: (err: Error | null, result: { stdout: string }) => void) => {
      if (cb) cb(null, { stdout: "{}" });
      return { stdout: "{}", stderr: "" };
    },
  );
}

function mockExecFileFailure() {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], cb?: (err: Error | null) => void) => {
      const err = new Error("not found");
      if (cb) cb(err);
      return { stdout: "", stderr: "" };
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Speed up the readiness-check retry loop in startTokenizerContainer
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

import { afterEach } from "vitest";
afterEach(() => {
  vi.useRealTimers();
});

// ── tokenizerContainerName ──────────────────────────────────────────

describe("tokenizerContainerName", () => {
  it("appends -tokenizer to the container name", () => {
    expect(tokenizerContainerName("openclaw-myagent")).toBe("openclaw-myagent-tokenizer");
  });

  it("works with arbitrary names", () => {
    expect(tokenizerContainerName("foo")).toBe("foo-tokenizer");
  });
});

// ── startTokenizerContainer ─────────────────────────────────────────

describe("startTokenizerContainer", () => {
  // Ensure the readiness check (execFileAsync inspect) succeeds by default
  beforeEach(() => {
    mockExecFileSuccess();
  });

  function baseOpts(overrides: Partial<StartTokenizerOpts> = {}): StartTokenizerOpts {
    const { log } = mockLog();
    return {
      config: minimalConfig(),
      runtime: "podman",
      tkzName: "test-tokenizer",
      vol: "test-volume",
      port: 18789,
      podName: "test-pod",
      log,
      runCommand: mockRunCommand(0),
      ...overrides,
    };
  }

  it("podman: removes existing container then inserts --pod flag after --name", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({ runtime: "podman", runCommand: run });

    await startTokenizerContainer(opts);

    // Should remove any existing container before creating
    expect(removeContainer).toHaveBeenCalledWith("podman", "test-tokenizer");

    expect(run).toHaveBeenCalledOnce();
    const [cmd, args] = run.mock.calls[0];
    expect(cmd).toBe("podman");
    // --pod should appear after --name <tkzName>
    const nameIdx = args.indexOf("--name");
    expect(args[nameIdx + 1]).toBe("test-tokenizer");
    expect(args[nameIdx + 2]).toBe("--pod");
    expect(args[nameIdx + 3]).toBe("test-pod");
  });

  it("podman: uses default image when tokenizerImage not set", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({ runtime: "podman", runCommand: run });

    await startTokenizerContainer(opts);

    const args: string[] = run.mock.calls[0][1];
    expect(args).toContain(TOKENIZER_IMAGE);
  });

  it("podman: uses custom image when tokenizerImage is set", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({
      runtime: "podman",
      config: minimalConfig({ tokenizerImage: "my-registry/tokenizer:v1" }),
      runCommand: run,
    });

    await startTokenizerContainer(opts);

    const args: string[] = run.mock.calls[0][1];
    expect(args).toContain("my-registry/tokenizer:v1");
    expect(args).not.toContain(TOKENIZER_IMAGE);
  });

  it("podman: sets LISTEN_ADDRESS and OPEN_KEY_FILE env vars", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({ runtime: "podman", runCommand: run });

    await startTokenizerContainer(opts);

    const args: string[] = run.mock.calls[0][1];
    const listenIdx = args.indexOf(`LISTEN_ADDRESS=0.0.0.0:${TOKENIZER_PORT}`);
    expect(listenIdx).toBeGreaterThan(0);
    expect(args[listenIdx - 1]).toBe("-e");
    expect(args).toContain(`OPEN_KEY_FILE=${TOKENIZER_OPEN_KEY_PATH}`);
  });

  it("podman: mounts volume read-only", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({ runtime: "podman", runCommand: run });

    await startTokenizerContainer(opts);

    const args: string[] = run.mock.calls[0][1];
    expect(args).toContain("test-volume:/home/node/.openclaw:ro");
  });

  it("podman: throws when run command fails", async () => {
    const run = mockRunCommand(1);
    const opts = baseOpts({ runtime: "podman", runCommand: run });

    await expect(startTokenizerContainer(opts)).rejects.toThrow("Failed to start Tokenizer sidecar");
  });

  it("docker: calls removeContainer before starting", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({ runtime: "docker", runCommand: run });

    await startTokenizerContainer(opts);

    expect(removeContainer).toHaveBeenCalledWith("docker", "test-tokenizer");
  });

  it("docker: shares network namespace when networkContainer is set", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({
      runtime: "docker",
      networkContainer: "litellm-sidecar",
      runCommand: run,
    });

    await startTokenizerContainer(opts);

    const args: string[] = run.mock.calls[0][1];
    const networkIdx = args.indexOf("--network");
    expect(networkIdx).toBeGreaterThan(0);
    expect(args[networkIdx + 1]).toBe("container:litellm-sidecar");
  });

  it("docker: publishes port when no networkContainer", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({
      runtime: "docker",
      networkContainer: undefined,
      port: 9999,
      runCommand: run,
    });

    await startTokenizerContainer(opts);

    const args: string[] = run.mock.calls[0][1];
    const pIdx = args.indexOf("-p");
    expect(pIdx).toBeGreaterThan(0);
    expect(args[pIdx + 1]).toBe("9999:18789");
  });

  it("docker: throws when run command fails", async () => {
    const run = mockRunCommand(1);
    const opts = baseOpts({ runtime: "docker", runCommand: run });

    await expect(startTokenizerContainer(opts)).rejects.toThrow("Failed to start Tokenizer sidecar");
  });

  it("logs startup messages", async () => {
    const { log, lines } = mockLog();
    const opts = baseOpts({ runtime: "podman", log });

    await startTokenizerContainer(opts);

    expect(lines).toContain("Waiting for Tokenizer proxy to start...");
    expect(lines).toContain("Tokenizer proxy started");
  });

  it("throws on readiness check timeout", async () => {
    // Make the TCP health check always fail but container appears running
    const isHealthCheck = (args: string[]) => args.includes("exec") && args.includes("nc");
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, args: string[], cb?: (err: Error | null, result?: { stdout: string }) => void) => {
        if (isHealthCheck(args)) {
          if (cb) cb(new Error("health check failed"));
          return { stdout: "", stderr: "" };
        } else if (args.includes("inspect")) {
          if (cb) cb(null, { stdout: "true" });
          return { stdout: "true", stderr: "" };
        }
        if (cb) cb(null, { stdout: "" });
        return { stdout: "", stderr: "" };
      },
    );
    const run = mockRunCommand(0);
    const opts = baseOpts({ runtime: "podman", runCommand: run });
    await expect(startTokenizerContainer(opts)).rejects.toThrow("timed out");
  }, 30_000);

  it("throws early when container exits during readiness check", async () => {
    // Make the TCP health check fail and inspect shows container stopped
    const isHealthCheck = (args: string[]) => args.includes("exec") && args.includes("nc");
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, args: string[], cb?: (err: Error | null, result?: { stdout: string }) => void) => {
        if (isHealthCheck(args)) {
          if (cb) cb(new Error("health check failed"));
          return { stdout: "", stderr: "" };
        } else if (args.includes("inspect")) {
          if (cb) cb(null, { stdout: "false" });
          return { stdout: "false", stderr: "" };
        }
        if (cb) cb(null, { stdout: "" });
        return { stdout: "", stderr: "" };
      },
    );
    const run = mockRunCommand(0);
    const opts = baseOpts({ runtime: "podman", runCommand: run });
    await expect(startTokenizerContainer(opts)).rejects.toThrow("exited unexpectedly");
  }, 30_000);

  it("uses OPEN_KEY_FILE env var instead of sh -c entrypoint", async () => {
    const run = mockRunCommand(0);
    const opts = baseOpts({ runtime: "podman", runCommand: run });

    await startTokenizerContainer(opts);

    const args: string[] = run.mock.calls[0][1];
    // The fork reads the key via OPEN_KEY_FILE env var pointing to the
    // volume-mounted file, so neither sh -c nor OPEN_KEY env var are needed.
    const envVars = args.filter((a, i) => i > 0 && args[i - 1] === "-e");
    expect(envVars).toContain(`OPEN_KEY_FILE=${TOKENIZER_OPEN_KEY_PATH}`);
    // OPEN_KEY should NOT appear as a -e env var
    expect(envVars.every((v) => !v.startsWith("OPEN_KEY="))).toBe(true);
    // No sh -c entrypoint
    expect(args).not.toContain("sh");
  });
});

// ── stopTokenizerContainer ──────────────────────────────────────────

describe("stopTokenizerContainer", () => {
  it("stops and removes the container when it exists", async () => {
    mockExecFileSuccess();
    const run = mockRunCommand(0);
    const { log, lines } = mockLog();

    await stopTokenizerContainer("podman", "test-tokenizer", log, run);

    expect(lines).toContain("Stopping Tokenizer sidecar: test-tokenizer");
    expect(run).toHaveBeenCalledWith("podman", ["stop", "test-tokenizer"], log);
    // Should also remove the stopped container
    expect(removeContainer).toHaveBeenCalledWith("podman", "test-tokenizer");
  });

  it("does nothing when container does not exist", async () => {
    mockExecFileFailure();
    const run = mockRunCommand(0);
    const { log, lines } = mockLog();

    await stopTokenizerContainer("podman", "nonexistent", log, run);

    expect(lines).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
    expect(removeContainer).not.toHaveBeenCalled();
  });

  it("uses the provided runtime for both stop and remove", async () => {
    mockExecFileSuccess();
    const run = mockRunCommand(0);
    const { log } = mockLog();

    await stopTokenizerContainer("docker", "my-tkz", log, run);

    expect(run).toHaveBeenCalledWith("docker", ["stop", "my-tkz"], log);
    expect(removeContainer).toHaveBeenCalledWith("docker", "my-tkz");
  });
});
