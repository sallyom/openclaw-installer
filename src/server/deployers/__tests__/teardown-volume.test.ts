import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process to capture volume-rm calls
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
  spawn: vi.fn(),
}));

// Track calls to removeContainer and removeVolume
const mockRemoveContainer = vi.fn().mockResolvedValue(undefined);
const mockRemoveVolume = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/container.js", () => ({
  detectRuntime: vi.fn().mockResolvedValue("podman"),
  removeContainer: mockRemoveContainer,
  removeVolume: mockRemoveVolume,
  OPENCLAW_LABELS: {
    managed: "openclaw.managed=true",
    prefix: (v: string) => `openclaw.prefix=${v}`,
    agent: (v: string) => `openclaw.agent=${v}`,
  },
}));

import type { DeployResult } from "../types.js";

describe("LocalDeployer.teardown — volume name resolution (issue #24)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: make execFileAsync calls resolve (for pod rm etc.)
    mockExecFile.mockImplementation((_file: string, _args: string[], cb?: (...args: unknown[]) => void) => {
      if (cb) {
        cb(null, { stdout: "", stderr: "" });
      }
      return { stdout: "", stderr: "" };
    });
  });

  async function getTeardown() {
    const { LocalDeployer } = await import("../local.js");
    return new LocalDeployer();
  }

  it("uses result.volumeName when set, instead of recomputing from config", async () => {
    const deployer = await getTeardown();

    // Simulate a stopped instance without saved config:
    // prefix and agentName are wrong (conflated from container name),
    // but volumeName carries the actual discovered volume name.
    const result: DeployResult = {
      id: "openclaw-sally-lynx",
      mode: "local",
      status: "stopped",
      volumeName: "openclaw-sally-lynx-data", // actual volume from discovery
      config: {
        mode: "local",
        // These are wrong — the bug: both set to the full suffix
        prefix: "sally-lynx",
        agentName: "sally-lynx",
        containerRuntime: "podman",
      },
      containerId: "openclaw-sally-lynx",
      startedAt: "",
    };

    await deployer.teardown(result, () => {});

    // The fix should use the actual volume name, not the recomputed one
    expect(mockRemoveVolume).toHaveBeenCalledWith(
      "podman",
      "openclaw-sally-lynx-data",
    );
    // NOT "openclaw-sally-lynx-sally-lynx-data" (the double-prefixed bug)
  });

  it("falls back to computed volumeName when result.volumeName is not set", async () => {
    const deployer = await getTeardown();

    // Running instance with correct config — no volumeName field
    const result: DeployResult = {
      id: "openclaw-sally-lynx",
      mode: "local",
      status: "running",
      config: {
        mode: "local",
        prefix: "sally",
        agentName: "lynx",
        containerRuntime: "podman",
      },
      containerId: "openclaw-sally-lynx",
      startedAt: "",
    };

    await deployer.teardown(result, () => {});

    // Should compute correctly: openclaw-{prefix}-{agentName}-data
    expect(mockRemoveVolume).toHaveBeenCalledWith(
      "podman",
      "openclaw-sally-lynx-data",
    );
  });
});
