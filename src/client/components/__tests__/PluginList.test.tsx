import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PluginList from "../PluginList";

const pluginsResponse = {
  plugins: [
    { mode: "local", title: "This Machine", description: "Run locally", source: "built-in", enabled: true, available: true, builtIn: true, priority: 0 },
    { mode: "kubernetes", title: "Kubernetes", description: "Deploy to K8s", source: "built-in", enabled: true, available: false, builtIn: true, priority: 0 },
    { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", source: "provider-plugin", enabled: true, available: true, builtIn: false, priority: 10 },
  ],
  errors: [],
};

function mockFetch(response = pluginsResponse) {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url === "/api/plugins" && !opts?.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(response) });
    }
    if (url.startsWith("/api/plugins/") && opts?.method === "POST") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as unknown as typeof globalThis.fetch;
}

describe("PluginList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders all plugins grouped by source", async () => {
    global.fetch = mockFetch();
    render(<PluginList />);

    await screen.findByText("This Machine");
    expect(screen.getByText("Kubernetes")).toBeTruthy();
    expect(screen.getByText("OpenShift")).toBeTruthy();
    expect(screen.getAllByText("Built-in").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Plugins")).toBeTruthy();
  });

  it("shows Active badge for available enabled plugins", async () => {
    global.fetch = mockFetch();
    render(<PluginList />);

    await screen.findByText("This Machine");
    const badges = screen.getAllByText("Active");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Unavailable badge for enabled but not detected plugins", async () => {
    global.fetch = mockFetch();
    render(<PluginList />);

    await screen.findByText("Kubernetes");
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });

  it("shows Disabled badge for disabled plugins", async () => {
    const response = {
      plugins: [
        { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", source: "provider-plugin", enabled: false, available: true, builtIn: false, priority: 10 },
      ],
      errors: [],
    };
    global.fetch = mockFetch(response);
    render(<PluginList />);

    await screen.findByText("OpenShift");
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  it("does not show Enable/Disable button for built-in deployers", async () => {
    global.fetch = mockFetch();
    render(<PluginList />);

    await screen.findByText("This Machine");
    expect(screen.queryByRole("button", { name: /disable this machine/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /enable this machine/i })).toBeNull();
  });

  it("shows Disable button for non-built-in enabled plugins", async () => {
    global.fetch = mockFetch();
    render(<PluginList />);

    await screen.findByText("OpenShift");
    const btn = screen.getByRole("button", { name: /disable openshift/i });
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe("Disable");
  });

  it("shows Enable button for disabled plugins", async () => {
    const response = {
      plugins: [
        { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", source: "provider-plugin", enabled: false, available: true, builtIn: false, priority: 10 },
      ],
      errors: [],
    };
    global.fetch = mockFetch(response);
    render(<PluginList />);

    await screen.findByText("OpenShift");
    const btn = screen.getByRole("button", { name: /enable openshift/i });
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe("Enable");
  });

  it("calls disable API and re-fetches on Disable click", async () => {
    const fetchMock = mockFetch();
    global.fetch = fetchMock;
    render(<PluginList />);

    await screen.findByText("OpenShift");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /disable openshift/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const disableCall = calls.find(
        ([url, opts]: [string, RequestInit?]) =>
          url === "/api/plugins/openshift/disable" && opts?.method === "POST",
      );
      expect(disableCall).toBeTruthy();
    });
  });

  it("shows load errors section when errors exist", async () => {
    const response = {
      plugins: [],
      errors: [
        { pluginId: "openclaw-installer-broken", error: "Module not found" },
      ],
    };
    global.fetch = mockFetch(response);
    render(<PluginList />);

    await screen.findByText(/1 plugin failed to load/);
  });

  it("toggles error details visibility", async () => {
    const response = {
      plugins: [],
      errors: [
        { pluginId: "openclaw-installer-broken", error: "Module not found" },
      ],
    };
    global.fetch = mockFetch(response);
    render(<PluginList />);

    const toggle = await screen.findByText(/1 plugin failed to load/);
    expect(screen.queryByText("openclaw-installer-broken")).toBeNull();

    const user = userEvent.setup();
    await user.click(toggle);
    expect(screen.getByText("openclaw-installer-broken")).toBeTruthy();
    expect(screen.getByText("Module not found")).toBeTruthy();
  });

  it("shows empty state when no plugins", async () => {
    global.fetch = mockFetch({ plugins: [], errors: [] });
    render(<PluginList />);

    await screen.findByText("No deployers registered");
  });

  it("shows source badges", async () => {
    global.fetch = mockFetch();
    render(<PluginList />);

    await screen.findByText("This Machine");
    expect(screen.getAllByText("Built-in").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Installer Provider Plugin")).toBeTruthy();
  });

  it("shows Superseded badge when plugin has supersededBy field", async () => {
    const response = {
      plugins: [
        { mode: "kubernetes", title: "Kubernetes", description: "Deploy to K8s", source: "built-in", enabled: true, available: true, builtIn: true, priority: 0, supersededBy: "openshift" },
        { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", source: "provider-plugin", enabled: true, available: true, builtIn: false, priority: 10 },
      ],
      errors: [],
    };
    global.fetch = mockFetch(response);
    render(<PluginList />);

    await screen.findByText("Kubernetes");
    expect(screen.getByText("Superseded")).toBeTruthy();
    expect(screen.getByText(/Superseded by openshift/)).toBeTruthy();
  });

  it("does not show Superseded when plugin has no supersededBy field", async () => {
    const response = {
      plugins: [
        { mode: "kubernetes", title: "Kubernetes", description: "Deploy to K8s", source: "built-in", enabled: true, available: true, builtIn: true, priority: 0 },
      ],
      errors: [],
    };
    global.fetch = mockFetch(response);
    render(<PluginList />);

    await screen.findByText("Kubernetes");
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Superseded")).toBeNull();
  });

  it("does not show Superseded when plugin is disabled even with supersededBy", async () => {
    const response = {
      plugins: [
        { mode: "kubernetes", title: "Kubernetes", description: "Deploy to K8s", source: "built-in", enabled: false, available: true, builtIn: true, priority: 0, supersededBy: "openshift" },
      ],
      errors: [],
    };
    global.fetch = mockFetch(response);
    render(<PluginList />);

    await screen.findByText("Kubernetes");
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.queryByText("Superseded")).toBeNull();
  });
});
