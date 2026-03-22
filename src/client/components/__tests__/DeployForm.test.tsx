import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import DeployForm from "../DeployForm";

// Stub fetch for /api/health to return deployer data
function mockHealthResponse(deployers: Array<{ mode: string; title: string; description: string; available: boolean; priority: number; builtIn: boolean }>, overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      status: "ok",
      containerRuntime: "podman",
      k8sAvailable: false,
      k8sContext: "",
      k8sNamespace: "",
      isOpenShift: false,
      version: "0.1.0",
      deployers,
      defaults: {
        hasAnthropicKey: true,
        hasOpenaiKey: false,
        hasTelegramToken: false,
        telegramAllowFrom: "",
        modelEndpoint: "",
        prefix: "testuser",
        image: "",
      },
      ...overrides,
    }),
  });
}

describe("DeployForm deployer visibility (issue #10)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("hides unavailable plugin deployers", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
      { mode: "kubernetes", title: "Kubernetes", description: "Deploy to K8s", available: false, priority: 0, builtIn: true },
      { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", available: false, priority: 10, builtIn: false },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    // Wait for the health fetch to resolve and deployers to render
    const localCard = await screen.findByText("This Machine");
    expect(localCard).toBeTruthy();

    // Built-in kubernetes should still appear even though unavailable
    expect(screen.getByText("Kubernetes")).toBeTruthy();

    // Plugin deployer (openshift) should be hidden when unavailable
    expect(screen.queryByText("OpenShift")).toBeNull();
  });

  it("shows available plugin deployers", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
      { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", available: true, priority: 10, builtIn: false },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    const localCard = await screen.findByText("This Machine");
    expect(localCard).toBeTruthy();

    // Available plugin deployer should be visible
    expect(screen.getByText("OpenShift")).toBeTruthy();
  });

  it("does not auto-fill the default cluster namespace into the form", async () => {
    global.fetch = mockHealthResponse(
      [
        { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
        { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", available: true, priority: 10, builtIn: false },
      ],
      {
        k8sAvailable: true,
        k8sNamespace: "default",
        isOpenShift: true,
      },
    );

    render(<DeployForm onDeployStarted={() => {}} />);

    const input = await screen.findByLabelText("Project / Namespace") as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).not.toBe("default");
    });
  });
});

describe("DeployForm agent name validation (issue #7)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("disables deploy button when agent name is empty", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    const buttons = await screen.findAllByRole("button", { name: /deploy openclaw/i });
    const deployButton = buttons[buttons.length - 1];
    expect(deployButton.disabled).toBe(true);
  });

  it("disables deploy button when agent name contains underscores", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    const buttons = await screen.findAllByRole("button", { name: /deploy openclaw/i });
    const deployButton = buttons[buttons.length - 1];

    const agentInput = screen.getAllByPlaceholderText("e.g., lynx")[0];
    fireEvent.change(agentInput, { target: { value: "a_0" } });

    expect(deployButton.disabled).toBe(true);
  });

  it("shows validation error when agent name contains underscores", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    const agentInput = screen.getAllByPlaceholderText("e.g., lynx")[0];
    fireEvent.change(agentInput, { target: { value: "a_0" } });

    await waitFor(() => {
      expect(screen.getAllByText("Agent name can only contain lowercase letters, numbers, and hyphens").length).toBeGreaterThan(0);
    });
  });

  it("validates secret providers JSON when SecretRef mode is enabled", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    fireEvent.change(screen.getAllByPlaceholderText("e.g., lynx")[0], { target: { value: "lynx" } });
    fireEvent.change(screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement, {
      target: { value: "{not json" },
    });

    await waitFor(() => {
      expect(screen.getByText("Secret providers JSON is invalid.")).toBeTruthy();
    });
  });

  it("shows Agent Options controls and all advanced secret override targets", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    expect(screen.getAllByText("Agent Options").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Agent Source Directory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enable Cron Jobs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Subagent Spawning").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Advanced: Experimental External Secret Providers"));

    expect(await screen.findByText("Anthropic SecretRef Source")).toBeTruthy();
    expect(screen.getByText("OpenAI SecretRef Source")).toBeTruthy();
    expect(screen.getByText("Telegram SecretRef Source")).toBeTruthy();
  });
});
