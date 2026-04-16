import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import DeployForm from "../DeployForm";

type DeployerStub = { mode: string; title: string; description: string; available: boolean; priority: number; builtIn: boolean; enabled?: boolean };

function healthJson(deployers: DeployerStub[], overrides: Record<string, unknown> = {}) {
  return {
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
      hasGoogleKey: false,
      hasOpenrouterKey: false,
      hasTelegramToken: false,
      telegramAllowFrom: "",
      modelEndpoint: "",
      prefix: "testuser",
      image: "",
    },
    ...overrides,
  };
}

// Stub fetch for /api/health to return deployer data
function mockHealthResponse(deployers: DeployerStub[], overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => healthJson(deployers, overrides),
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

  it("hides disabled plugin deployers from mode selector", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true, enabled: true },
      { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", available: true, priority: 10, builtIn: false, enabled: false },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    // Wait for deployers to render
    await waitFor(() => {
      expect(screen.getAllByText("This Machine").length).toBeGreaterThan(0);
    });

    // Disabled plugin deployer should be hidden
    expect(screen.queryByText("OpenShift")).toBeNull();
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
    const secretProvidersTextarea = screen.getAllByRole("textbox").find((element) =>
      (element as HTMLTextAreaElement).placeholder.includes("{"),
    );
    expect(secretProvidersTextarea).toBeTruthy();
    fireEvent.change(secretProvidersTextarea!, {
      target: { value: "{not json" },
    });

    await waitFor(() => {
      expect(screen.getByText("Secret providers JSON is invalid.")).toBeTruthy();
    });
  });

  it("shows Agent Options controls and model secret override targets", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    expect(screen.getAllByText("Agent Options").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Agent Source Directory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enable Cron Jobs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Subagent Spawning").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Advanced: SecretRefs"));

    expect(await screen.findByText("Anthropic SecretRef Source")).toBeTruthy();
    expect(screen.getByText("OpenAI SecretRef Source")).toBeTruthy();
    expect(screen.getByText("Google SecretRef Source")).toBeTruthy();
    expect(screen.getByText("OpenRouter SecretRef Source")).toBeTruthy();
    expect(screen.getByText("OpenAI-Compatible Endpoint SecretRef Source")).toBeTruthy();
  });

  it("shows OpenRouter as an available inference provider", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    const providerSelect = screen.getAllByRole("combobox").find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.value === "openrouter"),
    ) as HTMLSelectElement | undefined;
    expect(providerSelect).toBeTruthy();
    fireEvent.change(providerSelect!, { target: { value: "openrouter" } });

    expect(await screen.findByText("OpenRouter API Key")).toBeTruthy();
    expect(screen.getByText("OpenRouter Model")).toBeTruthy();
  });

  it("shows Google as an available inference provider", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    const providerSelect = screen.getAllByRole("combobox").find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.value === "google"),
    ) as HTMLSelectElement | undefined;
    expect(providerSelect).toBeTruthy();
    fireEvent.change(providerSelect!, { target: { value: "google" } });

    expect(await screen.findByText("Google API Key")).toBeTruthy();
    expect(screen.getByText("Google Model")).toBeTruthy();
  });

  it("shows primary model dropdown options for Anthropic and OpenAI", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    const anthropicModelSelect = screen.getAllByRole("combobox").find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.value === "claude-sonnet-4-6"),
    ) as HTMLSelectElement | undefined;
    expect(anthropicModelSelect).toBeTruthy();
    expect(
      Array.from(anthropicModelSelect!.options).some((option) => option.value === "claude-sonnet-4-6"),
    ).toBe(true);

    const primaryProviderSelect = screen.getAllByRole("combobox").find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.value === "openai"),
    ) as HTMLSelectElement | undefined;
    expect(primaryProviderSelect).toBeTruthy();
    fireEvent.change(primaryProviderSelect!, { target: { value: "openai" } });

    const openaiModelSelect = await screen.findAllByRole("combobox").then((elements) =>
      elements.find((element) =>
        Array.from((element as HTMLSelectElement).options).some((option) => option.value === "gpt-5"),
      ) as HTMLSelectElement | undefined,
    );
    expect(openaiModelSelect).toBeTruthy();
    expect(
      Array.from(openaiModelSelect!.options).some((option) => option.value === "gpt-5"),
    ).toBe(true);
  });

  it("prefills the default Anthropic model when Anthropic is added as an additional provider", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    const primaryProviderSelect = screen.getAllByRole("combobox").find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.value === "openrouter"),
    ) as HTMLSelectElement | undefined;
    expect(primaryProviderSelect).toBeTruthy();
    fireEvent.change(primaryProviderSelect!, { target: { value: "openrouter" } });

    fireEvent.click(screen.getByRole("button", { name: /\+ add provider/i }));

    const providerSelects = screen.getAllByRole("combobox");
    const additionalProviderSelect = providerSelects.find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.text === "Select a provider..."),
    ) as HTMLSelectElement | undefined;
    expect(additionalProviderSelect).toBeTruthy();

    fireEvent.change(additionalProviderSelect!, { target: { value: "anthropic" } });

    const anthropicModelInput = await screen.findByPlaceholderText("e.g., claude-sonnet-4-6") as HTMLInputElement;
    await waitFor(() => {
      expect(anthropicModelInput.value).toBe("claude-sonnet-4-6");
    });
  });

  it("validates Podman secret mapping syntax", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    fireEvent.change(screen.getAllByPlaceholderText("e.g., lynx")[0], { target: { value: "lynx" } });
    const podmanMappingsInput = screen.getAllByRole("textbox").find((element) =>
      (element as HTMLTextAreaElement).placeholder.includes("anthropic_api_key=ANTHROPIC_API_KEY"),
    );
    expect(podmanMappingsInput).toBeTruthy();
    fireEvent.change(
      podmanMappingsInput!,
      { target: { value: "not valid" } },
    );

    await waitFor(() => {
      expect(screen.getByText('Invalid Podman secret mapping: "not valid". Use secret_name=ENV_VAR_NAME.')).toBeTruthy();
    });
  });

  it("does not retain stale secret providers JSON when loading a saved local config", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health") {
        return {
          ok: true,
          json: async () => healthJson([
            { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
          ]),
        };
      }
      if (url === "/api/configs") {
        return {
          ok: true,
          json: async () => [
            {
              name: "local-saved",
              type: "local",
              vars: {
                OPENCLAW_AGENT_NAME: "lynx",
                MODEL_ENDPOINT: "http://100.76.40.32:8000/v1",
                MODEL_ENDPOINT_MODEL: "google/gemma-4-26B-A4B-it",
              },
            },
          ],
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    fireEvent.click(screen.getByText("Advanced: External Secret Providers"));
    const secretProvidersTextarea = screen.getAllByRole("textbox").find((element) =>
      (element as HTMLTextAreaElement).placeholder.includes("{"),
    ) as HTMLTextAreaElement | undefined;
    expect(secretProvidersTextarea).toBeTruthy();

    fireEvent.change(secretProvidersTextarea!, {
      target: {
        value: JSON.stringify({
          vault: {
            command: "/home/node/.openclaw/bin/openclaw-vault",
          },
        }),
      },
    });

    const savedConfigSelect = screen.getAllByRole("combobox").find((element) =>
      Array.from((element as HTMLSelectElement).options).some((option) => option.text.includes("local-saved")),
    ) as HTMLSelectElement | undefined;
    expect(savedConfigSelect).toBeTruthy();

    fireEvent.change(savedConfigSelect!, { target: { value: "local-saved" } });

    await waitFor(() => {
      expect(secretProvidersTextarea!.value).toBe("");
    });
  });

  it("shows separate OpenAI and OpenAI-compatible endpoint key fields", async () => {
    global.fetch = mockHealthResponse([
      { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
    ]);

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    // Verify the primary card shows anthropic fields by default
    expect(screen.getByText("Anthropic API Key")).toBeTruthy();
    expect(screen.getByText("Anthropic Model")).toBeTruthy();

    // Check that add provider button exists
    const addBtn = screen.getByRole("button", { name: /Add Provider/i });
    expect(addBtn).toBeTruthy();

    // Switch primary to openai to verify provider-specific fields change
    // The primary provider select is the one with value="anthropic"
    const primarySelect = screen.getByDisplayValue("Anthropic");
    fireEvent.change(primarySelect, { target: { value: "openai" } });

    expect(screen.getByText("OpenAI API Key")).toBeTruthy();
    expect(screen.getByText("OpenAI Model")).toBeTruthy();

    // Switch primary to custom-endpoint
    fireEvent.change(primarySelect, { target: { value: "custom-endpoint" } });

    expect(screen.getByText("OpenAI-Compatible Model Endpoint")).toBeTruthy();
    expect(screen.getByText("OpenAI-Compatible Model Name")).toBeTruthy();
    expect(screen.getByText("OpenAI-Compatible Endpoint API Key (`MODEL_ENDPOINT_API_KEY`)")).toBeTruthy();
    expect(screen.queryByText("Primary Model")).toBeNull();
  });

  it("submits Anthropic and OpenAI credentials together while keeping one primary provider", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health") {
        return {
          ok: true,
          json: async () => ({
            status: "ok",
            containerRuntime: "podman",
            k8sAvailable: false,
            k8sContext: "",
            k8sNamespace: "",
            isOpenShift: false,
            version: "0.1.0",
            deployers: [
              { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
            ],
            defaults: {
              hasAnthropicKey: false,
              hasOpenaiKey: false,
              hasTelegramToken: false,
              telegramAllowFrom: "",
              modelEndpoint: "",
              prefix: "testuser",
              image: "",
            },
          }),
        };
      }
      if (url === "/api/deploy") {
        return {
          ok: true,
          json: async () => ({ deployId: "deploy-123" }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    const onDeployStarted = vi.fn();
    render(<DeployForm onDeployStarted={onDeployStarted} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    fireEvent.change(screen.getAllByPlaceholderText("e.g., lynx")[0], { target: { value: "lynx" } });

    // Primary is anthropic — fill its fields
    fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), { target: { value: "sk-ant-demo" } });
    fireEvent.change(
      screen.getByPlaceholderText("e.g., claude-sonnet-4-6"),
      { target: { value: "claude-sonnet-4-6" } },
    );

    // Switch primary to openai, fill its fields, then switch back
    const primarySelect = screen.getByDisplayValue("Anthropic");
    fireEvent.change(primarySelect, { target: { value: "openai" } });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-openai-demo" } });
    fireEvent.change(
      screen.getByPlaceholderText("e.g., gpt-5"),
      { target: { value: "gpt-5" } },
    );

    // Switch primary to custom-endpoint, fill its fields, then switch back
    fireEvent.change(screen.getByDisplayValue("OpenAI"), { target: { value: "custom-endpoint" } });
    fireEvent.change(
      screen.getByPlaceholderText("http://vllm.openclaw-llms.svc.cluster.local/v1"),
      { target: { value: "http://localhost:8000/v1" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("e.g., mistral-small-24b-w8a8"),
      { target: { value: "mistral-small-24b-w8a8" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText("API key for the OpenAI-compatible endpoint"),
      { target: { value: "endpoint-token" } },
    );

    // Switch back to anthropic as primary
    fireEvent.change(screen.getByDisplayValue("Model Endpoint"), { target: { value: "anthropic" } });

    fireEvent.click(screen.getAllByRole("button", { name: /deploy openclaw/i }).at(-1)!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/deploy",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const deployCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/deploy");
    expect(deployCall).toBeTruthy();
    const body = JSON.parse(String((deployCall?.[1] as RequestInit | undefined)?.body || "{}"));

    expect(body.inferenceProvider).toBe("anthropic");
    expect(body.anthropicApiKey).toBe("sk-ant-demo");
    expect(body.openaiApiKey).toBe("sk-openai-demo");
    expect(body.anthropicModel).toBe("claude-sonnet-4-6");
    expect(body.openaiModel).toBe("gpt-5");
    expect(body.modelEndpoint).toBe("http://localhost:8000/v1");
    expect(body.modelEndpointApiKey).toBe("endpoint-token");
    expect(body.modelEndpointModel).toBe("mistral-small-24b-w8a8");
  });

  it("submits the OpenAI-compatible endpoints toggle when disabled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health") {
        return {
          ok: true,
          json: async () => ({
            status: "ok",
            containerRuntime: "podman",
            k8sAvailable: false,
            k8sContext: "",
            k8sNamespace: "",
            isOpenShift: false,
            version: "0.1.0",
            deployers: [
              { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
            ],
            defaults: {
              hasAnthropicKey: false,
              hasOpenaiKey: false,
              hasTelegramToken: false,
              telegramAllowFrom: "",
              modelEndpoint: "",
              prefix: "testuser",
              image: "",
            },
          }),
        };
      }
      if (url === "/api/deploy") {
        return {
          ok: true,
          json: async () => ({ deployId: "deploy-123" }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    fireEvent.change(screen.getAllByPlaceholderText("e.g., lynx")[0], { target: { value: "lynx" } });
    fireEvent.click(screen.getByLabelText("Enable OpenAI-compatible API endpoints"));
    fireEvent.click(screen.getAllByRole("button", { name: /deploy openclaw/i }).at(-1)!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/deploy",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const deployCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/deploy");
    const body = JSON.parse(String((deployCall?.[1] as RequestInit | undefined)?.body || "{}"));
    expect(body.openaiCompatibleEndpointsEnabled).toBe(false);
  });

  it("submits additional local container run args", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health") {
        return {
          ok: true,
          json: async () => ({
            status: "ok",
            containerRuntime: "podman",
            k8sAvailable: false,
            k8sContext: "",
            k8sNamespace: "",
            isOpenShift: false,
            version: "0.1.0",
            deployers: [
              { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
            ],
            defaults: {
              hasAnthropicKey: false,
              hasOpenaiKey: false,
              hasTelegramToken: false,
              telegramAllowFrom: "",
              modelEndpoint: "",
              prefix: "testuser",
              image: "",
              containerRuntime: "podman",
            },
          }),
        };
      }
      if (url === "/api/deploy") {
        return {
          ok: true,
          json: async () => ({ deployId: "deploy-123" }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    fireEvent.change(screen.getAllByPlaceholderText("e.g., lynx")[0], { target: { value: "lynx" } });
    fireEvent.change(
      screen.getByPlaceholderText("e.g., --userns=keep-id --security-opt label=disable"),
      { target: { value: "--userns=keep-id -v '/tmp/my data:/data:Z'" } },
    );
    fireEvent.click(screen.getAllByRole("button", { name: /deploy openclaw/i }).at(-1)!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/deploy",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const deployCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/deploy");
    const body = JSON.parse(String((deployCall?.[1] as RequestInit | undefined)?.body || "{}"));
    expect(body.containerRunArgs).toBe("--userns=keep-id -v '/tmp/my data:/data:Z'");
  });

  it("fetches models from the OpenAI-compatible endpoint and selects the returned label", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health") {
        return {
          ok: true,
          json: async () => ({
            status: "ok",
            containerRuntime: "podman",
            k8sAvailable: false,
            k8sContext: "",
            k8sNamespace: "",
            isOpenShift: false,
            version: "0.1.0",
            deployers: [
              { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
            ],
            defaults: {
              hasAnthropicKey: false,
              hasOpenaiKey: false,
              hasTelegramToken: false,
              telegramAllowFrom: "",
              modelEndpoint: "",
              prefix: "testuser",
              image: "",
            },
          }),
        };
      }
      if (url === "/api/configs/model-endpoint-models") {
        return {
          ok: true,
          json: async () => ({
            models: [
              { id: "llama-4-scout-17b-16e-w4a16", name: "Llama 4 Scout 17B" },
            ],
          }),
        };
      }
      if (url === "/api/deploy") {
        return {
          ok: true,
          json: async () => ({ deployId: "deploy-123" }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    fireEvent.change(screen.getAllByPlaceholderText("e.g., lynx")[0], { target: { value: "lynx" } });

    // Switch primary to custom-endpoint to access endpoint fields
    fireEvent.change(screen.getByDisplayValue("Anthropic"), { target: { value: "custom-endpoint" } });

    fireEvent.change(
      screen.getByPlaceholderText("http://vllm.openclaw-llms.svc.cluster.local/v1"),
      { target: { value: "https://example.com/v1" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Fetch Models" }));

    await screen.findByRole("option", { name: "Llama 4 Scout 17B (llama-4-scout-17b-16e-w4a16)" });

    fireEvent.click(screen.getAllByRole("button", { name: /deploy openclaw/i }).at(-1)!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/deploy",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const deployCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/deploy");
    const body = JSON.parse(String((deployCall?.[1] as RequestInit | undefined)?.body || "{}"));
    expect(body.modelEndpointModel).toBe("llama-4-scout-17b-16e-w4a16");
    expect(body.modelEndpointModelLabel).toBe("Llama 4 Scout 17B");
    expect(body.modelEndpointModels).toEqual([
      { id: "llama-4-scout-17b-16e-w4a16", name: "Llama 4 Scout 17B" },
    ]);
  });

  it("clears fetched endpoint models when the endpoint changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health") {
        return {
          ok: true,
          json: async () => ({
            status: "ok",
            containerRuntime: "podman",
            k8sAvailable: false,
            k8sContext: "",
            k8sNamespace: "",
            isOpenShift: false,
            version: "0.1.0",
            deployers: [
              { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true },
            ],
            defaults: {
              hasAnthropicKey: false,
              hasOpenaiKey: false,
              hasTelegramToken: false,
              telegramAllowFrom: "",
              modelEndpoint: "",
              prefix: "testuser",
              image: "",
            },
          }),
        };
      }
      if (url === "/api/configs/model-endpoint-models") {
        return {
          ok: true,
          json: async () => ({
            models: [
              { id: "llama-4-scout-17b-16e-w4a16", name: "Llama 4 Scout 17B" },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof global.fetch;

    render(<DeployForm onDeployStarted={() => {}} />);

    await screen.findAllByRole("button", { name: /deploy openclaw/i });

    // Switch primary to custom-endpoint to access endpoint fields
    fireEvent.change(screen.getByDisplayValue("Anthropic"), { target: { value: "custom-endpoint" } });

    const endpointInput = screen.getByPlaceholderText("http://vllm.openclaw-llms.svc.cluster.local/v1");
    fireEvent.change(endpointInput, { target: { value: "https://example.com/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch Models" }));

    await screen.findByRole("option", { name: "Llama 4 Scout 17B (llama-4-scout-17b-16e-w4a16)" });

    fireEvent.change(endpointInput, { target: { value: "https://mistral.example.com/v1" } });

    await waitFor(() => {
      expect(
        screen.queryByRole("option", { name: "Llama 4 Scout 17B (llama-4-scout-17b-16e-w4a16)" }),
      ).toBeNull();
    });
  });
});

const LOCAL: DeployerStub = { mode: "local", title: "This Machine", description: "Run locally", available: true, priority: 0, builtIn: true };
const K8S_AVAIL: DeployerStub = { mode: "kubernetes", title: "Kubernetes", description: "Deploy to K8s", available: true, priority: 0, builtIn: true };
const K8S_UNAVAIL: DeployerStub = { mode: "kubernetes", title: "Kubernetes", description: "Deploy to K8s", available: false, priority: 0, builtIn: true };
const OCP_AVAIL: DeployerStub = { mode: "openshift", title: "OpenShift", description: "Deploy to OpenShift", available: true, priority: 10, builtIn: false };

describe("DeployForm auto-switch (issue #38)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("auto-switches when current mode becomes unavailable on refresh", async () => {
    // Initial: local + kubernetes available; kubernetes has higher priority so it's auto-selected
    const k8sHighPri = { ...K8S_AVAIL, priority: 5 };
    const initialData = healthJson([LOCAL, k8sHighPri], { k8sAvailable: true });
    // After refresh: kubernetes unavailable
    const refreshData = healthJson([LOCAL, K8S_UNAVAIL], { k8sAvailable: false });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/configs")) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      callCount++;
      const data = callCount <= 1 ? initialData : refreshData;
      return Promise.resolve({ ok: true, json: async () => data });
    });

    render(<DeployForm onDeployStarted={() => {}} />);

    // Wait for initial render — should show kubernetes as available
    await screen.findByText("This Machine");
    await waitFor(() => {
      expect(screen.getByText("Kubernetes")).toBeTruthy();
    });

    // Simulate tab focus / refresh by triggering visibilitychange
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should show auto-switch notification
    await waitFor(() => {
      expect(screen.queryByText(/is no longer available/)).toBeTruthy();
    });
  });

  it("auto-switches to higher-priority deployer when it becomes available", async () => {
    // Initial: only local available
    const initialData = healthJson([LOCAL, K8S_UNAVAIL]);
    // After refresh: OpenShift becomes available (priority 10)
    const refreshData = healthJson([LOCAL, K8S_AVAIL, OCP_AVAIL], {
      k8sAvailable: true,
      isOpenShift: true,
    });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/configs")) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      callCount++;
      const data = callCount <= 1 ? initialData : refreshData;
      return Promise.resolve({ ok: true, json: async () => data });
    });

    render(<DeployForm onDeployStarted={() => {}} />);

    // Wait for initial render — local should be auto-selected
    await screen.findByText("This Machine");

    // Trigger refresh
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should show auto-switch notification for OpenShift
    await waitFor(() => {
      expect(screen.queryByText(/Switched to OpenShift/)).toBeTruthy();
    });
  });

  it("does not auto-switch when user manually selected a mode", async () => {
    // Initial: local + kubernetes available
    const initialData = healthJson([LOCAL, K8S_AVAIL], { k8sAvailable: true });
    // After refresh: OpenShift becomes available (higher priority)
    const refreshData = healthJson([LOCAL, K8S_AVAIL, OCP_AVAIL], {
      k8sAvailable: true,
      isOpenShift: true,
    });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/configs")) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      callCount++;
      const data = callCount <= 1 ? initialData : refreshData;
      return Promise.resolve({ ok: true, json: async () => data });
    });

    render(<DeployForm onDeployStarted={() => {}} />);

    // Wait for initial render
    const localCard = await screen.findByText("This Machine");

    // Manually click "This Machine" to mark as manually selected
    fireEvent.click(localCard.closest(".mode-card")!);

    // Trigger refresh
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should NOT show auto-switch notification — user manually selected local
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.queryByText(/Switched to/)).toBeNull();
  });

  it("auto-switches even with manual selection when current mode is unavailable", async () => {
    // Initial: local + kubernetes available
    const initialData = healthJson([LOCAL, K8S_AVAIL], { k8sAvailable: true });
    // After refresh: kubernetes unavailable
    const refreshData = healthJson([LOCAL, K8S_UNAVAIL], { k8sAvailable: false });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/configs")) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      callCount++;
      const data = callCount <= 1 ? initialData : refreshData;
      return Promise.resolve({ ok: true, json: async () => data });
    });

    render(<DeployForm onDeployStarted={() => {}} />);

    // Wait for initial render
    const k8sCard = await screen.findByText("Kubernetes");

    // Manually click Kubernetes
    fireEvent.click(k8sCard.closest(".mode-card")!);

    // Trigger refresh — kubernetes becomes unavailable
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should auto-switch to local even though user manually selected kubernetes
    await waitFor(() => {
      expect(screen.queryByText(/is no longer available/)).toBeTruthy();
    });
  });

  it("dismisses auto-switch notification after timeout", async () => {
    const k8sHighPri = { ...K8S_AVAIL, priority: 5 };
    const initialData = healthJson([LOCAL, k8sHighPri], { k8sAvailable: true });
    const refreshData = healthJson([LOCAL, K8S_UNAVAIL], { k8sAvailable: false });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/configs")) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      callCount++;
      const data = callCount <= 1 ? initialData : refreshData;
      return Promise.resolve({ ok: true, json: async () => data });
    });

    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    // Trigger refresh
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(screen.queryByText(/is no longer available/)).toBeTruthy();
    });

    // Advance past the 8-second dismiss timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    await waitFor(() => {
      expect(screen.queryByText(/is no longer available/)).toBeNull();
    });
  });
});
