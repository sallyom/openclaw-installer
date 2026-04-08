import { describe, it, expect } from "vitest";
import {
  createInitialDeployFormConfig,
  applySavedVarsToConfig,
  buildDeployRequestBody,
  buildEnvFileContent,
} from "../deploy-form/serialization.js";

describe("Multi-model per provider", () => {
  describe("createInitialDeployFormConfig", () => {
    it("initializes provider model arrays as empty arrays", () => {
      const config = createInitialDeployFormConfig();
      expect(config.anthropicModels).toEqual([]);
      expect(config.openaiModels).toEqual([]);
      expect(config.googleModels).toEqual([]);
      expect(config.openrouterModels).toEqual([]);
      expect(config.podmanSecretMappingsText).toBe(
        [
          "anthropic_api_key=ANTHROPIC_API_KEY",
          "openai_api_key=OPENAI_API_KEY",
          "gemini_api_key=GEMINI_API_KEY",
          "openrouter_api_key=OPENROUTER_API_KEY",
          "model_endpoint_api_key=MODEL_ENDPOINT_API_KEY",
        ].join("\n"),
      );
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

    it("includes openrouterModels when non-empty", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.openrouterModels = ["openrouter/auto", "openrouter/anthropic/claude-sonnet-4-6"];
      const body = buildDeployRequestBody({
        mode: "local",
        inferenceProvider: "openrouter",
        config,
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(body.openrouterModels).toEqual(["openrouter/auto", "openrouter/anthropic/claude-sonnet-4-6"]);
    });

    it("includes googleModels when non-empty", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.googleModels = ["gemini-2.5-flash", "google/gemini-3.1-pro-preview"];
      const body = buildDeployRequestBody({
        mode: "local",
        inferenceProvider: "google",
        config,
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(body.googleModels).toEqual(["gemini-2.5-flash", "google/gemini-3.1-pro-preview"]);
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

    it("encodes OpenRouter settings into the exported env file", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.openrouterApiKey = "sk-or-test";
      config.openrouterModel = "openrouter/auto";
      config.openrouterModels = ["openrouter/anthropic/claude-sonnet-4-6"];
      const env = buildEnvFileContent({
        config,
        inferenceProvider: "openrouter",
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(env).toContain("OPENROUTER_API_KEY=sk-or-test");
      expect(env).toContain("OPENROUTER_MODEL=openrouter/auto");
      expect(env).toContain("OPENROUTER_MODELS_B64=");
    });

    it("encodes Google settings into the exported env file", () => {
      const config = createInitialDeployFormConfig();
      config.agentName = "test";
      config.googleApiKey = "google-key";
      config.googleModel = "gemini-3.1-pro-preview";
      config.googleModels = ["gemini-2.5-flash"];
      const env = buildEnvFileContent({
        config,
        inferenceProvider: "google",
        isVertex: false,
        suggestedNamespace: "test-ns",
      });
      expect(env).toContain("GEMINI_API_KEY=google-key");
      expect(env).toContain("GOOGLE_MODEL=gemini-3.1-pro-preview");
      expect(env).toContain("GOOGLE_MODELS_B64=");
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

    it("infers env/default OpenRouter SecretRefs from Podman secret mappings", () => {
      const prev = createInitialDeployFormConfig();
      const mappings = [
        { secretName: "openrouter_api_key", targetEnv: "OPENROUTER_API_KEY" },
      ];
      const vars: Record<string, unknown> = {
        PODMAN_SECRET_MAPPINGS_B64: window.btoa(JSON.stringify(mappings)),
      };
      const { config } = applySavedVarsToConfig(vars, prev);
      expect(config.openrouterApiKeyRefSource).toBe("env");
      expect(config.openrouterApiKeyRefProvider).toBe("default");
      expect(config.openrouterApiKeyRefId).toBe("OPENROUTER_API_KEY");
    });

    it("infers env/default Google SecretRefs from Podman secret mappings", () => {
      const prev = createInitialDeployFormConfig();
      const mappings = [
        { secretName: "gemini_api_key", targetEnv: "GOOGLE_API_KEY" },
      ];
      const vars: Record<string, unknown> = {
        PODMAN_SECRET_MAPPINGS_B64: window.btoa(JSON.stringify(mappings)),
      };
      const { config } = applySavedVarsToConfig(vars, prev);
      expect(config.googleApiKeyRefSource).toBe("env");
      expect(config.googleApiKeyRefProvider).toBe("default");
      expect(config.googleApiKeyRefId).toBe("GOOGLE_API_KEY");
    });
  });
});
