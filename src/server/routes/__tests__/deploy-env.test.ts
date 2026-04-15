import { describe, expect, it } from "vitest";
import type { DeployConfig } from "../../deployers/types.js";
import { applyServerEnvFallbacks } from "../deploy.js";

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "local",
    agentName: "demo",
    agentDisplayName: "Demo",
    inferenceProvider: "anthropic",
    ...overrides,
  };
}

describe("applyServerEnvFallbacks", () => {
  it("hydrates secondary provider credentials from server env", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
    });

    applyServerEnvFallbacks(config, {
      OPENAI_API_KEY: "sk-openai-env",
      ANTHROPIC_API_KEY: "sk-ant-env",
    });

    expect(config.anthropicApiKey).toBe("sk-ant-env");
    expect(config.openaiApiKey).toBe("sk-openai-env");
  });

  it("hydrates OpenRouter credentials from server env", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
    });

    applyServerEnvFallbacks(config, {
      OPENROUTER_API_KEY: "sk-or-env",
    });

    expect(config.openrouterApiKey).toBe("sk-or-env");
  });

  it("hydrates Google credentials from either GEMINI_API_KEY or GOOGLE_API_KEY", () => {
    const geminiConfig = makeConfig({
      inferenceProvider: "anthropic",
    });
    applyServerEnvFallbacks(geminiConfig, {
      GEMINI_API_KEY: "gemini-env",
    });
    expect(geminiConfig.googleApiKey).toBe("gemini-env");

    const googleConfig = makeConfig({
      inferenceProvider: "anthropic",
    });
    applyServerEnvFallbacks(googleConfig, {
      GOOGLE_API_KEY: "google-env",
    });
    expect(googleConfig.googleApiKey).toBe("google-env");
  });

  it("hydrates provider credentials from server env even when Podman secret defaults are present", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      podmanSecretMappings: [
        { secretName: "anthropic_api_key", targetEnv: "ANTHROPIC_API_KEY" },
        { secretName: "openai_api_key", targetEnv: "OPENAI_API_KEY" },
        { secretName: "gemini_api_key", targetEnv: "GEMINI_API_KEY" },
        { secretName: "openrouter_api_key", targetEnv: "OPENROUTER_API_KEY" },
        { secretName: "model_endpoint_api_key", targetEnv: "MODEL_ENDPOINT_API_KEY" },
      ],
    });

    applyServerEnvFallbacks(config, {
      ANTHROPIC_API_KEY: "sk-ant-env",
      OPENAI_API_KEY: "sk-openai-env",
      GEMINI_API_KEY: "gemini-env",
      OPENROUTER_API_KEY: "sk-or-env",
    });

    expect(config.anthropicApiKey).toBe("sk-ant-env");
    expect(config.openaiApiKey).toBe("sk-openai-env");
    expect(config.googleApiKey).toBe("gemini-env");
    expect(config.openrouterApiKey).toBe("sk-or-env");
  });

  it("hydrates endpoint token independently from the OpenAI API key", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      modelEndpoint: "http://localhost:8000/v1",
    });

    applyServerEnvFallbacks(config, {
      OPENAI_API_KEY: "sk-openai-env",
      MODEL_ENDPOINT_API_KEY: "endpoint-token",
    });

    expect(config.openaiApiKey).toBe("sk-openai-env");
    expect(config.modelEndpointApiKey).toBe("endpoint-token");
  });

  it("skips env fallbacks for providers not in selectedProviders", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
    });

    applyServerEnvFallbacks(config, {
      ANTHROPIC_API_KEY: "sk-ant-env",
      GEMINI_API_KEY: "gemini-env",
      OPENAI_API_KEY: "sk-openai-env",
    }, ["vertex-anthropic"]);

    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.googleApiKey).toBeUndefined();
    expect(config.openaiApiKey).toBeUndefined();
  });

  it("hydrates env fallbacks only for selected providers", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
    });

    applyServerEnvFallbacks(config, {
      ANTHROPIC_API_KEY: "sk-ant-env",
      OPENAI_API_KEY: "sk-openai-env",
      GEMINI_API_KEY: "gemini-env",
    }, ["anthropic", "openai"]);

    expect(config.anthropicApiKey).toBe("sk-ant-env");
    expect(config.openaiApiKey).toBe("sk-openai-env");
    expect(config.googleApiKey).toBeUndefined();
  });
});
