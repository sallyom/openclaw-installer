import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InstanceList from "../InstanceList";

const runningInstance = {
  id: "inst-1",
  mode: "local",
  status: "running",
  config: { prefix: "user", agentName: "lynx", agentDisplayName: "Lynx" },
  startedAt: "2025-01-01T00:00:00Z",
  url: "http://localhost:18789",
  containerId: "abc123",
};

const stoppedInstance = {
  id: "inst-2",
  mode: "local",
  status: "stopped",
  config: { prefix: "user", agentName: "fox", agentDisplayName: "Fox" },
  startedAt: "2025-01-01T00:00:00Z",
};

const deployingK8sInstance = {
  id: "inst-3",
  mode: "kubernetes",
  status: "deploying",
  config: { prefix: "user", agentName: "hawk", agentDisplayName: "Hawk" },
  startedAt: "2025-01-01T00:00:00Z",
  statusDetail: "Waiting for pod to start",
  pods: [{ name: "hawk-pod", phase: "Pending", ready: false, restarts: 0, containerStatus: "waiting", message: "" }],
};

const errorK8sInstance = {
  id: "inst-4",
  mode: "kubernetes",
  status: "error",
  config: { prefix: "user", agentName: "owl", agentDisplayName: "Owl" },
  startedAt: "2025-01-01T00:00:00Z",
  statusDetail: "CrashLoopBackOff",
  pods: [{ name: "owl-pod", phase: "Running", ready: false, restarts: 5, containerStatus: "waiting", message: "Back-off restarting failed container" }],
};

function mockFetchWith(instances: unknown[]) {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url === "/api/health") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ k8sAvailable: false }) });
    }
    if ((url === "/api/instances" || url === "/api/instances?includeK8s=1") && !opts?.method) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(instances) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("InstanceList", () => {
  it("shows loading state initially", () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof globalThis.fetch;
    render(<InstanceList active />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows empty state when no instances", async () => {
    globalThis.fetch = mockFetchWith([]);
    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByText("No OpenClaw instances found")).toBeInTheDocument();
    });
  });

  it("shows an error state when the instances request fails", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof globalThis.fetch;
    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByText("Could not load instances.")).toBeInTheDocument();
    });
    expect(screen.getByText("network down")).toBeInTheDocument();
  });

  it("renders running local instance with all expected controls", async () => {
    globalThis.fetch = mockFetchWith([runningInstance]);
    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByText("abc123")).toBeInTheDocument();
    });
    expect(screen.getByText(/browser access may require a one-time device pairing/i)).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:18789")).toBeInTheDocument();
    // Running instances show panel and lifecycle buttons
    expect(screen.getByRole("button", { name: /approve pairing/i })).toBeInTheDocument();
    expect(screen.getByText("Connection Info")).toBeInTheDocument();
    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByText("Logs")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    // Running local instance cannot be deleted
    expect(screen.getByRole("button", { name: /delete data/i })).toBeDisabled();
  });

  it("renders stopped instance with Start button and no panel buttons", async () => {
    globalThis.fetch = mockFetchWith([stoppedInstance]);
    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByText("Start")).toBeInTheDocument();
    });
    expect(screen.queryByText("Connection Info")).not.toBeInTheDocument();
    expect(screen.queryByText("Command")).not.toBeInTheDocument();
    expect(screen.queryByText("Logs")).not.toBeInTheDocument();
  });

  it("renders deploying K8s instance with badge, progress, and Re-deploy", async () => {
    globalThis.fetch = mockFetchWith([deployingK8sInstance]);
    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByText("K8s")).toBeInTheDocument();
    });
    expect(screen.getByText("Waiting for pod to start")).toBeInTheDocument();
    expect(screen.getByText("Re-deploy")).toBeInTheDocument();
  });

  it("renders error K8s instance with restart count and error message", async () => {
    globalThis.fetch = mockFetchWith([errorK8sInstance]);
    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByText("CrashLoopBackOff")).toBeInTheDocument();
    });
    expect(screen.getByText("Restarts: 5")).toBeInTheDocument();
    expect(screen.getByText("Back-off restarting failed container")).toBeInTheDocument();
  });

  it("enables Delete Data for running K8s instance", async () => {
    const runningK8s = { ...runningInstance, mode: "kubernetes", id: "k8s-1" };
    globalThis.fetch = mockFetchWith([runningK8s]);
    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete data/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /delete data/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /approve pairing/i })).toBeInTheDocument();
  });

  it("toggles connection info panel on button click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/health") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ k8sAvailable: false }) });
      }
      if (url === "/api/instances" || url === "/api/instances?includeK8s=1") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([runningInstance]) });
      }
      if (url === "/api/instances/inst-1/token") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: "secret-token-123" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /connection info/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /connection info/i }));
    await waitFor(() => {
      // Connection info shows both URL with token and raw token
      expect(screen.getByText("secret-token-123")).toBeInTheDocument();
      expect(
        screen.getByText(/http:\/\/localhost:18789\?session=agent%3Auser_lynx%3Amain#token=secret-token-123/),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^hide$/i })).toBeInTheDocument();
  });

  it("calls start endpoint when Start is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = mockFetchWith([stoppedInstance]);
    globalThis.fetch = fetchMock;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /start/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/instances/inst-2/start", { method: "POST" });
  });

  it("calls stop endpoint when Stop is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = mockFetchWith([runningInstance]);
    globalThis.fetch = fetchMock;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /stop/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/instances/inst-1/stop", { method: "POST" });
  });

  it("calls redeploy endpoint when Re-deploy is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const runningK8s = { ...runningInstance, mode: "kubernetes", id: "k8s-1" };
    const fetchMock = mockFetchWith([runningK8s]);
    globalThis.fetch = fetchMock;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-deploy/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /re-deploy/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/instances/k8s-1/redeploy", { method: "POST" });
  });

  it("calls approve-device endpoint when Approve Pairing is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = mockFetchWith([runningInstance]);
    globalThis.fetch = fetchMock;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve pairing/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /approve pairing/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/instances/inst-1/approve-device", { method: "POST" });
  });

  it("shows a success message after pairing approval succeeds", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    globalThis.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/health") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ k8sAvailable: false }) });
      }
      if ((url === "/api/instances" || url === "/api/instances?includeK8s=1") && !opts?.method) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([runningInstance]) });
      }
      if (url === "/api/instances/inst-1/approve-device") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "approved" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve pairing/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /approve pairing/i }));
    await waitFor(() => {
      expect(screen.getByText(/approved the latest pending pairing request/i)).toBeInTheDocument();
    });
  });

  it("shows a no-pending message when there is nothing to approve", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    globalThis.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/health") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ k8sAvailable: false }) });
      }
      if ((url === "/api/instances" || url === "/api/instances?includeK8s=1") && !opts?.method) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([runningInstance]) });
      }
      if (url === "/api/instances/inst-1/approve-device") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: "noop", error: "No pending device pairing requests" }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /approve pairing/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /approve pairing/i }));
    await waitFor(() => {
      expect(screen.getByText(/no pending device pairing requests/i)).toBeInTheDocument();
    });
  });

  it("opens URL with token via handleOpenWithToken", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);

    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/health") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ k8sAvailable: false }) });
      }
      if (url === "/api/instances" || url === "/api/instances?includeK8s=1") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([runningInstance]) });
      }
      if (url === "/api/instances/inst-1/token") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: "my-token" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByText("http://localhost:18789")).toBeInTheDocument();
    });

    await user.click(screen.getByText("http://localhost:18789"));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "http://localhost:18789?session=agent%3Auser_lynx%3Amain#token=my-token",
        "_blank",
        "noopener",
      );
    });
  });

  it("opens cluster URLs with the saved gateway token", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);

    const runningK8s = {
      ...runningInstance,
      id: "k8s-1",
      mode: "openshift",
      url: "https://sam-openclaw.apps.example.com",
    };

    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/health") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ k8sAvailable: true }) });
      }
      if (url === "/api/instances" || url === "/api/instances?includeK8s=1") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([runningK8s]) });
      }
      if (url === "/api/instances/k8s-1/token") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: "cluster-token" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByText("https://sam-openclaw.apps.example.com")).toBeInTheDocument();
    });

    await user.click(screen.getByText("https://sam-openclaw.apps.example.com"));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://sam-openclaw.apps.example.com?session=agent%3Auser_lynx%3Amain#token=cluster-token",
        "_blank",
        "noopener",
      );
    });
  });

  it("calls DELETE endpoint on confirmed delete", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const fetchMock = mockFetchWith([stoppedInstance]);
    globalThis.fetch = fetchMock;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete data/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /delete data/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/instances/inst-2", { method: "DELETE" });
  });

  it("does not call DELETE when confirm is cancelled", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchMock = mockFetchWith([stoppedInstance]);
    globalThis.fetch = fetchMock;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete data/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /delete data/i }));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/instances/inst-2", { method: "DELETE" });
  });

  // Regression test for #5: stale status when switching tabs
  it("fetches instances immediately when active prop transitions to true", async () => {
    const fetchMock = mockFetchWith([stoppedInstance]);
    globalThis.fetch = fetchMock;

    const { rerender } = render(<InstanceList active={false} />);
    await waitFor(() => {
      // Initial mount fetch still fires
      expect(fetchMock).toHaveBeenCalledWith("/api/instances");
    });

    const callCountBeforeActivation = fetchMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "/api/instances",
    ).length;

    // Simulate tab switch: active transitions from false to true
    rerender(<InstanceList active />);

    await waitFor(() => {
      const callCountAfterActivation = fetchMock.mock.calls.filter(
        (c: unknown[]) => c[0] === "/api/instances",
      ).length;
      expect(callCountAfterActivation).toBeGreaterThan(callCountBeforeActivation);
    });
  });

  it("does not fetch again when active remains true (no duplicate fetches)", async () => {
    const fetchMock = mockFetchWith([runningInstance]);
    globalThis.fetch = fetchMock;

    const { rerender } = render(<InstanceList active />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/instances");
    });

    const callCountBefore = fetchMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "/api/instances",
    ).length;

    // Re-render with same active=true — should NOT trigger extra fetch
    rerender(<InstanceList active />);

    // Give it a tick to ensure no extra fetch fires
    await new Promise((r) => setTimeout(r, 50));
    const callCountAfter = fetchMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "/api/instances",
    ).length;
    expect(callCountAfter).toBe(callCountBefore);
  });

  it("renders gracefully when fetch rejects", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network error"))) as unknown as typeof globalThis.fetch;
    render(<InstanceList active />);
    // Should not crash — component catches the error and finishes loading
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  it("auto-includes cluster instances when k8s is available (fix for #61)", async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/health") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ k8sAvailable: true }) });
      }
      if ((url === "/api/instances" || url === "/api/instances?includeK8s=1") && !opts?.method) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchMock;

    render(<InstanceList active />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/instances?includeK8s=1");
    });
    // Toggle button should no longer exist
    expect(screen.queryByRole("button", { name: /include k8s/i })).not.toBeInTheDocument();
  });
});
