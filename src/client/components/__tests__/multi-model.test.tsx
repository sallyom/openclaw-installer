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

    it("includes parsed Podman secret mappings for local deploys", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.podmanSecretMappingsText = "anthropic_api_key=ANTHROPIC_API_KEY\nopenai_api_key=OPENAI_API_KEY";
      const body = buildDeployRequestBody({
        mode: "local",
        inferenceProvider: "anthropic",
        config,
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(body.podmanSecretMappings).toEqual([
        { secretName: "anthropic_api_key", targetEnv: "ANTHROPIC_API_KEY" },
        { secretName: "openai_api_key", targetEnv: "OPENAI_API_KEY" },
      ]);
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

    it("encodes Podman secret mappings as base64", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.podmanSecretMappingsText = "joy_token=JOY_TELEGRAM_BOT_TOKEN";
      const env = buildEnvFileContent({
        config,
        inferenceProvider: "anthropic",
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      const match = env.match(/PODMAN_SECRET_MAPPINGS_B64=(.+)/);
      expect(match).toBeTruthy();
      const decoded = JSON.parse(window.atob(match![1]));
      expect(decoded).toEqual([{ secretName: "joy_token", targetEnv: "JOY_TELEGRAM_BOT_TOKEN" }]);
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

    it("loads Podman secret mappings from B64", () => {
      const prev = createInitialDeployFormConfig();
      const mappings = [{ secretName: "anthropic_api_key", targetEnv: "ANTHROPIC_API_KEY" }];
      const vars: Record<string, unknown> = {
        PODMAN_SECRET_MAPPINGS_B64: window.btoa(JSON.stringify(mappings)),
      };
      const { config } = applySavedVarsToConfig(vars, prev);
      expect(config.podmanSecretMappingsText).toBe("anthropic_api_key=ANTHROPIC_API_KEY");
    });

    it("infers env/default SecretRefs from Podman secret mappings for known model providers", () => {
      const prev = createInitialDeployFormConfig();
      const mappings = [
        { secretName: "anthropic_api_key", targetEnv: "ANTHROPIC_API_KEY" },
        { secretName: "openai_api_key", targetEnv: "OPENAI_API_KEY" },
      ];
      const vars: Record<string, unknown> = {
        PODMAN_SECRET_MAPPINGS_B64: window.btoa(JSON.stringify(mappings)),
      };
      const { config } = applySavedVarsToConfig(vars, prev);
      expect(config.anthropicApiKeyRefSource).toBe("env");
      expect(config.anthropicApiKeyRefProvider).toBe("default");
      expect(config.anthropicApiKeyRefId).toBe("ANTHROPIC_API_KEY");
      expect(config.openaiApiKeyRefSource).toBe("env");
      expect(config.openaiApiKeyRefProvider).toBe("default");
      expect(config.openaiApiKeyRefId).toBe("OPENAI_API_KEY");
    });
  });
});
