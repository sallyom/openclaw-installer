import { describe, it, expect } from "vitest";
import {
  createInitialDeployFormConfig,
  applySavedVarsToConfig,
  buildDeployRequestBody,
  buildEnvFileContent,
} from "../deploy-form/serialization.js";

describe("Multi-model per provider", () => {
  describe("createInitialDeployFormConfig", () => {
    it("initializes anthropicModels and openaiModels as empty arrays", () => {
      const config = createInitialDeployFormConfig();
      expect(config.anthropicModels).toEqual([]);
      expect(config.openaiModels).toEqual([]);
    });
  });

  describe("buildDeployRequestBody", () => {
    it("includes anthropicModels when non-empty", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.anthropicModels = ["claude-opus-4-6", "claude-haiku-4-5"];
      const body = buildDeployRequestBody({
        mode: "local",
        inferenceProvider: "anthropic",
        config,
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(body.anthropicModels).toEqual(["claude-opus-4-6", "claude-haiku-4-5"]);
    });

    it("excludes anthropicModels when empty", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      const body = buildDeployRequestBody({
        mode: "local",
        inferenceProvider: "anthropic",
        config,
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(body.anthropicModels).toBeUndefined();
    });

    it("includes openaiModels when non-empty", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.openaiModels = ["gpt-5", "gpt-5.3"];
      const body = buildDeployRequestBody({
        mode: "local",
        inferenceProvider: "openai",
        config,
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(body.openaiModels).toEqual(["gpt-5", "gpt-5.3"]);
    });

    it("excludes openaiModels when empty", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      const body = buildDeployRequestBody({
        mode: "local",
        inferenceProvider: "openai",
        config,
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(body.openaiModels).toBeUndefined();
    });
  });

  describe("buildEnvFileContent", () => {
    it("encodes anthropicModels and openaiModels as base64", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.anthropicModels = ["claude-opus-4-6"];
      config.openaiModels = ["gpt-5"];
      const env = buildEnvFileContent({
        config,
        inferenceProvider: "anthropic",
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(env).toContain("ANTHROPIC_MODELS_B64=");
      expect(env).toContain("OPENAI_MODELS_B64=");
      // Verify the B64 decodes to the expected JSON
      const anthropicMatch = env.match(/ANTHROPIC_MODELS_B64=(.+)/);
      expect(anthropicMatch).toBeTruthy();
      const decoded = JSON.parse(window.atob(anthropicMatch![1]));
      expect(decoded).toEqual(["claude-opus-4-6"]);
    });
  });

  describe("applySavedVarsToConfig (backward compat)", () => {
    it("loads single-model config without anthropicModels/openaiModels", () => {
      const prev = createInitialDeployFormConfig();
      const vars: Record<string, unknown> = {
        ANTHROPIC_MODEL: "claude-sonnet-4-6",
        OPENAI_MODEL: "gpt-5",
      };
      const { config } = applySavedVarsToConfig(vars, prev);
      expect(config.anthropicModel).toBe("claude-sonnet-4-6");
      expect(config.openaiModel).toBe("gpt-5");
      expect(config.anthropicModels).toEqual([]);
      expect(config.openaiModels).toEqual([]);
    });

    it("loads anthropicModels from B64-encoded var", () => {
      const prev = createInitialDeployFormConfig();
      const models = ["claude-opus-4-6", "claude-haiku-4-5"];
      const vars: Record<string, unknown> = {
        ANTHROPIC_MODELS_B64: window.btoa(JSON.stringify(models)),
      };
      const { config } = applySavedVarsToConfig(vars, prev);
      expect(config.anthropicModels).toEqual(models);
    });

    it("loads openaiModels from JSON key", () => {
      const prev = createInitialDeployFormConfig();
      const models = ["gpt-5", "gpt-5.3"];
      const vars: Record<string, unknown> = {
        openaiModels: models,
      };
      const { config } = applySavedVarsToConfig(vars, prev);
      expect(config.openaiModels).toEqual(models);
    });
  });
});
