/**
 * Regression tests for issue #23:
 * "Custom model override carries over across providers"
 *
 * Verifies that switching inference providers clears the custom model field.
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

function getModelInput() {
  return screen.getByText("Primary Model").closest(".form-group")!.querySelector("input")! as HTMLInputElement;
}

describe("Issue #23: Custom model override carries over across providers", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("clears agentModel when switching from Anthropic to OpenAI", async () => {
    global.fetch = mockFetch();
    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    const providerSelect = getProviderSelect();
    const modelInput = getModelInput();

    // Set a custom model for Anthropic
    fireEvent.change(modelInput, { target: { value: "claude-opus-4-6" } });
    expect(modelInput.value).toBe("claude-opus-4-6");

    // Switch to OpenAI — model should be cleared
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    await waitFor(() => {
      expect(modelInput.value).toBe("");
    });
  });

  it("clears agentModel when switching from OpenAI to Vertex", async () => {
    global.fetch = mockFetch();
    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    const providerSelect = getProviderSelect();
    const modelInput = getModelInput();

    // Switch to OpenAI and set a custom model
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    fireEvent.change(modelInput, { target: { value: "openai/gpt-5" } });
    expect(modelInput.value).toBe("openai/gpt-5");

    // Switch to Vertex Anthropic — model should be cleared
    fireEvent.change(providerSelect, { target: { value: "vertex-anthropic" } });
    await waitFor(() => {
      expect(modelInput.value).toBe("");
    });
  });

  it("clears agentModel on every consecutive provider switch", async () => {
    global.fetch = mockFetch();
    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    const providerSelect = getProviderSelect();
    const modelInput = getModelInput();

    // Set model, switch, verify cleared — repeat for multiple providers
    fireEvent.change(modelInput, { target: { value: "model-a" } });
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    await waitFor(() => expect(modelInput.value).toBe(""));

    fireEvent.change(modelInput, { target: { value: "model-b" } });
    fireEvent.change(providerSelect, { target: { value: "vertex-google" } });
    await waitFor(() => expect(modelInput.value).toBe(""));

    fireEvent.change(modelInput, { target: { value: "model-c" } });
    fireEvent.change(providerSelect, { target: { value: "anthropic" } });
    await waitFor(() => expect(modelInput.value).toBe(""));
  });

  it("does not interfere when model field is already empty", async () => {
    global.fetch = mockFetch();
    render(<DeployForm onDeployStarted={() => {}} />);
    await screen.findByText("This Machine");

    const providerSelect = getProviderSelect();
    const modelInput = getModelInput();

    // Switch without setting a model — should remain empty
    expect(modelInput.value).toBe("");
    fireEvent.change(providerSelect, { target: { value: "openai" } });
    await waitFor(() => {
      expect(modelInput.value).toBe("");
    });
  });
});
