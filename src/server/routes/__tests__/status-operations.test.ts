import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeployResult } from "../../deployers/types.js";

const {
  mockExecInPod,
  mockListNamespacedPod,
} = vi.hoisted(() => ({
  mockExecInPod: vi.fn(),
  mockListNamespacedPod: vi.fn(),
}));

vi.mock("../../services/k8s.js", () => ({
  coreApi: () => ({
    listNamespacedPod: mockListNamespacedPod,
  }),
  execInPod: mockExecInPod,
}));

vi.mock("../../services/container.js", () => ({
  detectRuntime: vi.fn(),
  discoverContainers: vi.fn(),
}));

vi.mock("../status-instances.js", () => ({
  decodeSavedJson: vi.fn(),
  readSavedConfig: vi.fn(),
  readSavedGatewayToken: vi.fn(),
}));

const { approveLatestDevicePairing, selectLatestPendingDeviceRequestId } =
  await import("../status-operations.js");

const clusterInstance: DeployResult = {
  id: "ns-1",
  mode: "openshift",
  status: "running",
  config: { mode: "openshift", agentName: "kat", namespace: "ns-1" },
  startedAt: "2026-04-16T00:00:00.000Z",
  containerId: "ns-1",
};

describe("selectLatestPendingDeviceRequestId", () => {
  it("selects the newest pending request by timestamp", () => {
    expect(selectLatestPendingDeviceRequestId({
      pending: [
        { requestId: "req-old", ts: 1000 },
        { requestId: "req-new", ts: 3000 },
        { requestId: "req-mid", ts: 2000 },
      ],
    })).toBe("req-new");
  });

  it("returns null when there is no pending request id", () => {
    expect(selectLatestPendingDeviceRequestId({ pending: [] })).toBeNull();
    expect(selectLatestPendingDeviceRequestId({ pending: [{ ts: 1000 }] })).toBeNull();
  });
});

describe("approveLatestDevicePairing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListNamespacedPod.mockResolvedValue({
      items: [{ metadata: { name: "openclaw-pod" } }],
    });
  });

  it("lists pending requests and approves the selected request explicitly", async () => {
    mockExecInPod
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          pending: [
            { requestId: "req-old", ts: 1000 },
            { requestId: "req-new", ts: 2000 },
          ],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ requestId: "req-new" }),
        stderr: "",
      });

    await expect(approveLatestDevicePairing(clusterInstance)).resolves.toEqual({
      status: "approved",
      output: JSON.stringify({ requestId: "req-new" }),
    });

    expect(mockExecInPod).toHaveBeenNthCalledWith(
      1,
      "ns-1",
      "openclaw-pod",
      "gateway",
      ["openclaw", "devices", "list", "--json"],
    );
    expect(mockExecInPod).toHaveBeenNthCalledWith(
      2,
      "ns-1",
      "openclaw-pod",
      "gateway",
      ["openclaw", "devices", "approve", "req-new", "--json"],
    );
  });

  it("returns noop without running approve when no pending request exists", async () => {
    mockExecInPod.mockResolvedValueOnce({
      stdout: JSON.stringify({ pending: [], paired: [] }),
      stderr: "",
    });

    await expect(approveLatestDevicePairing(clusterInstance)).resolves.toEqual({
      status: "noop",
      error: "No pending device pairing requests",
    });

    expect(mockExecInPod).toHaveBeenCalledTimes(1);
  });
});
