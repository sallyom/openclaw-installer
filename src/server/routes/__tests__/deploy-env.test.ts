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
});
