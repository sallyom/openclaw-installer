import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/k8s.js", () => ({
  appsApi: vi.fn(),
  coreApi: vi.fn(),
  loadKubeConfig: vi.fn(),
  hasOtelOperator: vi.fn(),
  k8sApiHttpCode: vi.fn(),
}));

vi.mock("../../services/k8s-port-forward.js", () => ({
  ensureK8sPortForward: vi.fn(),
}));

vi.mock("node:http", () => ({
  default: {
    get: vi.fn(),
  },
}));

import http from "node:http";
import { appsApi, coreApi } from "../../services/k8s.js";
import { ensureK8sPortForward } from "../../services/k8s-port-forward.js";
import { KubernetesDeployer } from "../kubernetes.js";

const baseResult = {
  id: "kind-test",
  mode: "kubernetes" as const,
  status: "unknown" as const,
  config: {
    mode: "kubernetes" as const,
    prefix: "user",
    agentName: "lynx",
    agentDisplayName: "Lynx",
    namespace: "user-lynx-openclaw",
  },
  startedAt: "",
  containerId: "user-lynx-openclaw",
};

function mockDeployment(replicas: number, readyReplicas: number) {
  vi.mocked(appsApi).mockReturnValue({
    readNamespacedDeployment: vi.fn().mockResolvedValue({
      spec: { replicas },
      status: { readyReplicas },
    }),
  } as any);
}

function mockPods(pods: Array<{
  name?: string;
  phase: string;
  ready: boolean;
  restartCount?: number;
  state: Record<string, any>;
}>) {
  vi.mocked(coreApi).mockReturnValue({
    listNamespacedPod: vi.fn().mockResolvedValue({
      items: pods.map((p) => ({
        metadata: { name: p.name || "openclaw-abc123" },
        status: {
          phase: p.phase,
          containerStatuses: [{
            ready: p.ready,
            restartCount: p.restartCount ?? 0,
            state: p.state,
          }],
        },
      })),
    }),
  } as any);
}

function mockGatewayReady(statusCode: number) {
  const res = { statusCode, resume: vi.fn() };
  vi.mocked(http.get).mockImplementation((_url: any, _opts: any, cb: any) => {
    cb(res);
    const req = {
      on: vi.fn(() => req),
    };
    return req as any;
  });
}

function mockGatewayError() {
  vi.mocked(http.get).mockImplementation((_url: any, _opts: any, _cb: any) => {
    const req = {
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "error") handler();
        return req;
      }),
      destroy: vi.fn(),
    };
    return req as any;
  });
}

describe("KubernetesDeployer.status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns running with URL when pods are ready and gateway responds", async () => {
    mockDeployment(1, 1);
    mockPods([{ phase: "Running", ready: true, state: { running: {} } }]);
    vi.mocked(ensureK8sPortForward).mockResolvedValue({
      localPort: 40123,
      url: "http://localhost:40123",
    });
    mockGatewayReady(200);

    const deployer = new KubernetesDeployer();
    const result = await deployer.status(baseResult);

    expect(ensureK8sPortForward).toHaveBeenCalledWith("user-lynx-openclaw");
    expect(result.status).toBe("running");
    expect(result.url).toBe("http://localhost:40123");
  });

  it("returns deploying when pods are ready but gateway is not responding", async () => {
    mockDeployment(1, 1);
    mockPods([{ phase: "Running", ready: true, state: { running: {} } }]);
    vi.mocked(ensureK8sPortForward).mockResolvedValue({
      localPort: 40123,
      url: "http://localhost:40123",
    });
    mockGatewayError();

    const deployer = new KubernetesDeployer();
    const result = await deployer.status(baseResult);

    expect(result.status).toBe("deploying");
    expect(result.statusDetail).toBe("Gateway starting...");
    expect(result.url).toBeUndefined();
  });

  it("clears stale URL when gateway is not responding", async () => {
    mockDeployment(1, 1);
    mockPods([{ phase: "Running", ready: true, state: { running: {} } }]);
    vi.mocked(ensureK8sPortForward).mockResolvedValue({
      localPort: 40123,
      url: "http://localhost:40123",
    });
    mockGatewayError();

    const deployer = new KubernetesDeployer();
    const result = await deployer.status({ ...baseResult, url: "http://localhost:40123" });

    expect(result.status).toBe("deploying");
    expect(result.url).toBeUndefined();
  });

  it("returns deploying when pods are ready but gateway returns 500", async () => {
    mockDeployment(1, 1);
    mockPods([{ phase: "Running", ready: true, state: { running: {} } }]);
    vi.mocked(ensureK8sPortForward).mockResolvedValue({
      localPort: 40123,
      url: "http://localhost:40123",
    });
    mockGatewayReady(500);

    const deployer = new KubernetesDeployer();
    const result = await deployer.status(baseResult);

    expect(result.status).toBe("deploying");
    expect(result.statusDetail).toBe("Gateway starting...");
  });

  it("still reports running with descriptive detail when port-forwarding fails", async () => {
    mockDeployment(1, 1);
    mockPods([{ phase: "Running", ready: true, state: { running: {} } }]);
    vi.mocked(ensureK8sPortForward).mockRejectedValue(new Error("kubectl unavailable"));

    const deployer = new KubernetesDeployer();
    const result = await deployer.status(baseResult);

    expect(result.status).toBe("running");
    expect(result.statusDetail).toBe("Running (port-forward unavailable)");
    expect(result.url).toBeUndefined();
  });

  it("returns deploying when pod is in ContainerCreating state", async () => {
    mockDeployment(1, 0);
    mockPods([{
      phase: "Pending", ready: false,
      state: { waiting: { reason: "ContainerCreating" } },
    }]);

    const deployer = new KubernetesDeployer();
    const result = await deployer.status(baseResult);

    expect(result.status).toBe("deploying");
    expect(result.statusDetail).toBe("Creating container...");
    expect(result.url).toBeUndefined();
  });

  it("returns deploying when no pods exist yet", async () => {
    mockDeployment(1, 0);
    mockPods([]);

    const deployer = new KubernetesDeployer();
    const result = await deployer.status(baseResult);

    expect(result.status).toBe("deploying");
    expect(result.statusDetail).toBe("Waiting for pod...");
  });

  it("returns error when pod is in CrashLoopBackOff", async () => {
    mockDeployment(1, 0);
    mockPods([{
      phase: "Running", ready: false,
      state: { waiting: { reason: "CrashLoopBackOff", message: "back-off restarting" } },
    }]);

    const deployer = new KubernetesDeployer();
    const result = await deployer.status(baseResult);

    expect(result.status).toBe("error");
    expect(result.statusDetail).toContain("CrashLoopBackOff");
  });

  it("returns stopped when scaled to zero", async () => {
    mockDeployment(0, 0);
    mockPods([]);

    const deployer = new KubernetesDeployer();
    const result = await deployer.status(baseResult);

    expect(result.status).toBe("stopped");
  });

  it("skips gateway health check on second poll after confirmed healthy", async () => {
    const deployer = new KubernetesDeployer();
    const runningPod = [{ phase: "Running" as const, ready: true, state: { running: {} } }];

    // First poll: gateway check runs and succeeds
    mockDeployment(1, 1);
    mockPods(runningPod);
    vi.mocked(ensureK8sPortForward).mockResolvedValue({
      localPort: 40123,
      url: "http://localhost:40123",
    });
    mockGatewayReady(200);

    await deployer.status(baseResult);
    expect(http.get).toHaveBeenCalledTimes(1);

    // Second poll: should skip the HTTP check entirely
    mockDeployment(1, 1);
    mockPods(runningPod);
    vi.mocked(http.get).mockClear();

    const result = await deployer.status(baseResult);
    expect(http.get).not.toHaveBeenCalled();
    expect(result.status).toBe("running");
    expect(result.url).toBe("http://localhost:40123");
  });

  it("re-checks gateway when readyReplicas drops (pod restart)", async () => {
    const deployer = new KubernetesDeployer();
    const runningPod = [{ phase: "Running" as const, ready: true, state: { running: {} } }];

    // First poll: confirm healthy with readyReplicas=2
    mockDeployment(2, 2);
    mockPods(runningPod);
    vi.mocked(ensureK8sPortForward).mockResolvedValue({
      localPort: 40123,
      url: "http://localhost:40123",
    });
    mockGatewayReady(200);

    await deployer.status(baseResult);

    // Second poll: readyReplicas dropped to 1 — must re-check
    mockDeployment(2, 1);
    mockPods(runningPod);
    vi.mocked(http.get).mockClear();
    mockGatewayReady(200);

    const result = await deployer.status(baseResult);
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("running");
  });
});
