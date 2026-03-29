import { describe, it, expect } from "vitest";
import { buildConfiguredAgentModelCatalog } from "../k8s-helpers.js";
import type { DeployConfig } from "../types.js";

function minimalConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "local",
    agentName: "test",
    agentDisplayName: "Test",
    ...overrides,
  };
}

describe("buildConfiguredAgentModelCatalog with multi-model arrays", () => {
  it("includes models from anthropicModels array", () => {
    const config = minimalConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "sk-test",
      anthropicModels: ["claude-opus-4-6", "claude-haiku-4-5"],
    });
    const catalog = buildConfiguredAgentModelCatalog(config, "anthropic/claude-sonnet-4-6");
    expect(catalog["anthropic/claude-opus-4-6"]).toEqual({ alias: "claude-opus-4-6" });
    expect(catalog["anthropic/claude-haiku-4-5"]).toEqual({ alias: "claude-haiku-4-5" });
  });

  it("includes models from openaiModels array", () => {
    const config = minimalConfig({
      inferenceProvider: "openai",
      openaiApiKey: "sk-test",
      openaiModels: ["gpt-5", "gpt-5.3"],
    });
    const catalog = buildConfiguredAgentModelCatalog(config, "openai/gpt-5");
    expect(catalog["openai/gpt-5.3"]).toEqual({ alias: "gpt-5.3" });
  });

  it("handles models with provider prefix already included", () => {
    const config = minimalConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "sk-test",
      anthropicModels: ["anthropic/claude-opus-4-6"],
    });
    const catalog = buildConfiguredAgentModelCatalog(config, "anthropic/claude-sonnet-4-6");
    expect(catalog["anthropic/claude-opus-4-6"]).toEqual({ alias: "anthropic/claude-opus-4-6" });
  });

  it("skips empty model IDs in arrays", () => {
    const config = minimalConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "sk-test",
      anthropicModels: ["claude-opus-4-6", "", "  "],
    });
    const catalog = buildConfiguredAgentModelCatalog(config, "anthropic/claude-sonnet-4-6");
    expect(catalog["anthropic/claude-opus-4-6"]).toBeDefined();
    // Verify no malformed keys like "anthropic/" or "anthropic/  "
    const keys = Object.keys(catalog).filter((k) => k.endsWith("/") || k.includes("/ "));
    expect(keys).toHaveLength(0);
  });

  it("works with empty arrays (backward compat)", () => {
    const config = minimalConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "sk-test",
      anthropicModels: [],
      openaiModels: [],
    });
    const catalog = buildConfiguredAgentModelCatalog(config, "anthropic/claude-sonnet-4-6");
    expect(catalog["anthropic/claude-sonnet-4-6"]).toBeDefined();
  });

  it("works with undefined arrays (backward compat)", () => {
    const config = minimalConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "sk-test",
    });
    const catalog = buildConfiguredAgentModelCatalog(config, "anthropic/claude-sonnet-4-6");
    expect(catalog["anthropic/claude-sonnet-4-6"]).toBeDefined();
  });
});
