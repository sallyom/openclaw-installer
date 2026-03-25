import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

describe("checkPortAvailable", () => {
  let blockingServer: Server | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (blockingServer) {
      await new Promise<void>((resolve) => blockingServer!.close(() => resolve()));
      blockingServer = null;
    }
  });

  it("resolves when port is free", async () => {
    const { checkPortAvailable } = await import("../container.js");
    // Use a random high port that is very unlikely to be in use
    await expect(checkPortAvailable(0, "podman")).resolves.toBeUndefined();
  });

  it("throws when port is in use, including container name from runtime", async () => {
    // Bind a port to simulate an occupied port
    blockingServer = createServer();
    const boundPort = await new Promise<number>((resolve) => {
      blockingServer!.listen(0, "0.0.0.0", () => {
        const addr = blockingServer!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    // Mock the runtime ps command to return a container using this port
    mockExecFile.mockImplementation((_file: string, _args: string[], cb: Function) => {
      cb(null, {
        stdout: `openclaw-bob-agent\t0.0.0.0:${boundPort}->18789/tcp`,
        stderr: "",
      });
    });

    const { checkPortAvailable } = await import("../container.js");
    await expect(checkPortAvailable(boundPort, "podman")).rejects.toThrow(
      `Port ${boundPort} is already in use by container openclaw-bob-agent`,
    );
  });

  it("throws with generic message when runtime query fails", async () => {
    blockingServer = createServer();
    const boundPort = await new Promise<number>((resolve) => {
      blockingServer!.listen(0, "0.0.0.0", () => {
        const addr = blockingServer!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    // Mock the runtime ps command to fail
    mockExecFile.mockImplementation((_file: string, _args: string[], cb: Function) => {
      cb(new Error("podman not found"), { stdout: "", stderr: "" });
    });

    const { checkPortAvailable } = await import("../container.js");
    await expect(checkPortAvailable(boundPort, "podman")).rejects.toThrow(
      `Port ${boundPort} is already in use. Stop the existing instance first or choose a different port.`,
    );
  });

  it("throws with generic message when no container matches the port", async () => {
    blockingServer = createServer();
    const boundPort = await new Promise<number>((resolve) => {
      blockingServer!.listen(0, "0.0.0.0", () => {
        const addr = blockingServer!.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    // Mock: runtime returns containers but none match this port
    mockExecFile.mockImplementation((_file: string, _args: string[], cb: Function) => {
      cb(null, {
        stdout: "some-container\t0.0.0.0:9999->80/tcp",
        stderr: "",
      });
    });

    const { checkPortAvailable } = await import("../container.js");
    await expect(checkPortAvailable(boundPort, "podman")).rejects.toThrow(
      `Port ${boundPort} is already in use. Stop the existing instance first or choose a different port.`,
    );
  });
});
