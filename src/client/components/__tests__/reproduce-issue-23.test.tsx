/**
 * Regression tests for issue #23:
 * "Custom model override carries over across providers"
 *
 * Verifies that switching inference providers clears the agentModel field
 * (used by Vertex/custom-endpoint). Provider-specific fields (anthropicModel,
 * openaiModel) persist across switches since they may be used as secondary
 * providers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import DeployForm from "../DeployForm";

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/configs/gcp-defaults")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          projectId: null,
          location: null,
          hasServiceAccountJson: false,
          credentialType: null,
          sources: {},
        }),
      });
    }
    // Default: /api/health
    return Promise.resolve({
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
          hasAnthropicKey: true,
          hasOpenaiKey: false,
          hasTelegramToken: false,
          telegramAllowFrom: "",
          modelEndpoint: "",
          prefix: "testuser",
          image: "",
        },
      }),
    });
  });
}

function getProviderSelect() {
  return screen.getByText("Primary Provider").closest(".form-group")!.querySelector("select")! as HTMLSelectElement;
}

function getModelInput(label: string) {
  return screen.getByText(label).closest(".form-group")!.querySelector("input[type='text']")! as HTMLInputElement;
}

describe("Issue #23: Custom model override carries over across providers", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("clears agentModel when switching from Vertex to another provider", async () => {
    global.fetch = mockFetch();
    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    const providerSelect = getProviderSelect();

    // Switch to Vertex and set a custom model via the Vertex Model field
    fireEvent.change(providerSelect, { target: { value: "vertex-anthropic" } });
    const vertexInput = screen.getByPlaceholderText("claude-sonnet-4-6") as HTMLInputElement;
    fireEvent.change(vertexInput, { target: { value: "claude-opus-4-6" } });
    expect(vertexInput.value).toBe("claude-opus-4-6");

    // Switch to OpenAI — agentModel should be cleared, OpenAI model field starts empty
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    await waitFor(() => {
      const openaiInput = getModelInput("OpenAI Model");
      expect(openaiInput.value).toBe("");
    });
  });

  it("clears agentModel when switching between Vertex providers", async () => {
    global.fetch = mockFetch();
    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    const providerSelect = getProviderSelect();

    // Switch to Vertex Google and set a model
    fireEvent.change(providerSelect, { target: { value: "vertex-google" } });
    const vertexInput = screen.getByPlaceholderText("gemini-2.5-pro") as HTMLInputElement;
    fireEvent.change(vertexInput, { target: { value: "gemini-2.5-flash" } });
    expect(vertexInput.value).toBe("gemini-2.5-flash");

    // Switch to Vertex Anthropic — agentModel should be cleared
    fireEvent.change(providerSelect, { target: { value: "vertex-anthropic" } });
    await waitFor(() => {
      const newVertexInput = screen.getByPlaceholderText("claude-sonnet-4-6") as HTMLInputElement;
      expect(newVertexInput.value).toBe("");
    });
  });

  it("OpenAI model field starts empty on first visit", async () => {
    global.fetch = mockFetch();
    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    const providerSelect = getProviderSelect();

    // Switch to OpenAI — model field should be empty
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    await waitFor(() => {
      const openaiInput = getModelInput("OpenAI Model");
      expect(openaiInput.value).toBe("");
    });
  });

  it("does not interfere when model field is already empty", async () => {
    global.fetch = mockFetch();
    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    const providerSelect = getProviderSelect();
    const modelInput = getModelInput("Anthropic Model");

    // Switch without setting a model — should remain empty
    expect(modelInput.value).toBe("");
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    await waitFor(() => {
      const openaiInput = getModelInput("OpenAI Model");
      expect(openaiInput.value).toBe("");
    });
  });
});
