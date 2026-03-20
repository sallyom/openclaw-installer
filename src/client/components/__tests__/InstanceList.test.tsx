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
    render(<InstanceList />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows empty state when no instances", async () => {
    globalThis.fetch = mockFetchWith([]);
    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByText("No OpenClaw instances found")).toBeInTheDocument();
    });
  });

  it("shows an error state when the instances request fails", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof globalThis.fetch;
    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByText("Could not load instances.")).toBeInTheDocument();
    });
    expect(screen.getByText("network down")).toBeInTheDocument();
  });

  it("renders running local instance with all expected controls", async () => {
    globalThis.fetch = mockFetchWith([runningInstance]);
    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByText("abc123")).toBeInTheDocument();
    });
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:18789")).toBeInTheDocument();
    // Running instances show panel and lifecycle buttons
    expect(screen.getByText("Token")).toBeInTheDocument();
    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByText("Logs")).toBeInTheDocument();
    expect(screen.getByText("Stop")).toBeInTheDocument();
    // Running local instance cannot be deleted
    expect(screen.getByRole("button", { name: /delete data/i })).toBeDisabled();
  });

  it("renders stopped instance with Start button and no panel buttons", async () => {
    globalThis.fetch = mockFetchWith([stoppedInstance]);
    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByText("Start")).toBeInTheDocument();
    });
    expect(screen.queryByText("Token")).not.toBeInTheDocument();
    expect(screen.queryByText("Command")).not.toBeInTheDocument();
    expect(screen.queryByText("Logs")).not.toBeInTheDocument();
  });

  it("renders deploying K8s instance with badge, progress, and Re-deploy", async () => {
    globalThis.fetch = mockFetchWith([deployingK8sInstance]);
    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByText("K8s")).toBeInTheDocument();
    });
    expect(screen.getByText("Waiting for pod to start")).toBeInTheDocument();
    expect(screen.getByText("Re-deploy")).toBeInTheDocument();
  });

  it("renders error K8s instance with restart count and error message", async () => {
    globalThis.fetch = mockFetchWith([errorK8sInstance]);
    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByText("CrashLoopBackOff")).toBeInTheDocument();
    });
    expect(screen.getByText("Restarts: 5")).toBeInTheDocument();
    expect(screen.getByText("Back-off restarting failed container")).toBeInTheDocument();
  });

  it("enables Delete Data for running K8s instance", async () => {
    const runningK8s = { ...runningInstance, mode: "kubernetes", id: "k8s-1" };
    globalThis.fetch = mockFetchWith([runningK8s]);
    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete data/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /delete data/i })).not.toBeDisabled();
  });

  it("toggles token panel on button click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/instances" || url === "/api/instances?includeK8s=1") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([runningInstance]) });
      }
      if (url === "/api/instances/inst-1/token") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: "secret-token-123" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;

    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /token/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /token/i }));
    await waitFor(() => {
      expect(screen.getByText("secret-token-123")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^hide$/i })).toBeInTheDocument();
  });

  it("calls start endpoint when Start is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = mockFetchWith([stoppedInstance]);
    globalThis.fetch = fetchMock;

    render(<InstanceList />);
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

    render(<InstanceList />);
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

    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-deploy/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /re-deploy/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/instances/k8s-1/redeploy", { method: "POST" });
  });

  it("opens URL with token via handleOpenWithToken", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);

    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/instances" || url === "/api/instances?includeK8s=1") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([runningInstance]) });
      }
      if (url === "/api/instances/inst-1/token") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: "my-token" }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }) as unknown as typeof globalThis.fetch;

    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByText("http://localhost:18789")).toBeInTheDocument();
    });

    await user.click(screen.getByText("http://localhost:18789"));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "http://localhost:18789?session=main#token=my-token",
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

    render(<InstanceList />);
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

    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete data/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /delete data/i }));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/instances/inst-2", { method: "DELETE" });
  });

  it("renders gracefully when fetch rejects", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network error"))) as unknown as typeof globalThis.fetch;
    render(<InstanceList />);
    // Should not crash — component catches the error and finishes loading
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  it("includes cluster instances by default and allows hiding them", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = mockFetchWith([]);
    globalThis.fetch = fetchMock;

    render(<InstanceList />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hide cluster/i })).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/instances?includeK8s=1");

    await user.click(screen.getByRole("button", { name: /hide cluster/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/instances");
    });
  });
});
