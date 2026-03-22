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

import { appsApi } from "../../services/k8s.js";
import { ensureK8sPortForward } from "../../services/k8s-port-forward.js";
import { KubernetesDeployer } from "../kubernetes.js";

describe("KubernetesDeployer.status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns a localhost URL for a ready deployment by starting a port-forward", async () => {
    vi.mocked(appsApi).mockReturnValue({
      readNamespacedDeployment: vi.fn().mockResolvedValue({
        spec: { replicas: 1 },
        status: { readyReplicas: 1 },
      }),
    } as any);
    vi.mocked(ensureK8sPortForward).mockResolvedValue({
      localPort: 40123,
      url: "http://localhost:40123",
    });

    const deployer = new KubernetesDeployer();
    const result = await deployer.status({
      id: "kind-test",
      mode: "kubernetes",
      status: "unknown",
      config: {
        mode: "kubernetes",
        prefix: "user",
        agentName: "lynx",
        agentDisplayName: "Lynx",
        namespace: "user-lynx-openclaw",
      },
      startedAt: "",
      containerId: "user-lynx-openclaw",
    });

    expect(ensureK8sPortForward).toHaveBeenCalledWith("user-lynx-openclaw");
    expect(result.status).toBe("running");
    expect(result.url).toBe("http://localhost:40123");
  });

  it("still reports running when the deployment is ready but port-forwarding fails", async () => {
    vi.mocked(appsApi).mockReturnValue({
      readNamespacedDeployment: vi.fn().mockResolvedValue({
        spec: { replicas: 1 },
        status: { readyReplicas: 1 },
      }),
    } as any);
    vi.mocked(ensureK8sPortForward).mockRejectedValue(new Error("kubectl unavailable"));

    const deployer = new KubernetesDeployer();
    const result = await deployer.status({
      id: "kind-test",
      mode: "kubernetes",
      status: "unknown",
      config: {
        mode: "kubernetes",
        prefix: "user",
        agentName: "lynx",
        agentDisplayName: "Lynx",
        namespace: "user-lynx-openclaw",
      },
      startedAt: "",
      containerId: "user-lynx-openclaw",
    });

    expect(result.status).toBe("running");
    expect(result.url).toBeUndefined();
  });
});
