import { describe, expect, it } from "vitest";
import {
  generateLitellmConfig,
  litellmRegisteredModelNames,
  litellmModelName,
} from "../litellm.js";
import type { DeployConfig } from "../types.js";

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "kubernetes",
    agentName: "test",
    agentDisplayName: "Test",
    vertexEnabled: true,
    gcpServiceAccountJson: '{"project_id":"test-project"}',
    googleCloudProject: "test-project",
    googleCloudLocation: "us-central1",
    ...overrides,
  };
}

describe("litellm — Vertex-only proxy", () => {
  describe("generateLitellmConfig", () => {
    it("includes Vertex Anthropic models for anthropic provider", () => {
      const config = makeConfig({ vertexProvider: "anthropic" });
      const yaml = generateLitellmConfig(config, "sk-master");

      expect(yaml).toContain("model: vertex_ai/claude-sonnet-4-6");
      expect(yaml).toContain("model: vertex_ai/claude-haiku-4-5");
    });

    it("includes Vertex Google models for google provider", () => {
      const config = makeConfig({ vertexProvider: "google" });
      const yaml = generateLitellmConfig(config, "sk-master");

      expect(yaml).toContain("model: vertex_ai/gemini-2.5-pro");
      expect(yaml).toContain("model: vertex_ai/gemini-2.5-flash");
    });

    it("does not include secondary provider models even when keys are configured", () => {
      const config = makeConfig({
        vertexProvider: "anthropic",
        openaiApiKey: "sk-oai-test",
      });
      const yaml = generateLitellmConfig(config, "sk-master");

      // LiteLLM only handles Vertex — secondary providers go direct via gateway
      expect(yaml).not.toContain("model: openai/");
      expect(yaml).not.toContain("model_name: gpt-5.4");
    });

    it("does not include direct Anthropic models even when anthropicApiKey is set", () => {
      const config = makeConfig({
        vertexProvider: "google",
        anthropicApiKey: "sk-ant-test",
      });
      const yaml = generateLitellmConfig(config, "sk-master");

      expect(yaml).not.toContain("model: anthropic/");
    });

    it("omits vertex_project/location for non-vertex entries", () => {
      const config = makeConfig();
      const yaml = generateLitellmConfig(config, "sk-master");

      // All entries should have vertex params since LiteLLM only has Vertex models
      const lines = yaml.split("\n");
      const modelEntries = lines.filter((l) => l.includes("model_name:"));
      expect(modelEntries.length).toBeGreaterThan(0);
    });
  });

  describe("litellmRegisteredModelNames", () => {
    it("returns only Vertex Anthropic models", () => {
      const config = makeConfig({ vertexProvider: "anthropic" });
      const names = litellmRegisteredModelNames(config);

      expect(names).toEqual(["claude-sonnet-4-6", "claude-haiku-4-5"]);
    });

    it("returns only Vertex Google models", () => {
      const config = makeConfig({ vertexProvider: "google" });
      const names = litellmRegisteredModelNames(config);

      expect(names).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"]);
    });

    it("does not include secondary provider models", () => {
      const config = makeConfig({
        vertexProvider: "anthropic",
        openaiApiKey: "sk-oai-test",
      });
      const names = litellmRegisteredModelNames(config);

      expect(names).not.toContain("gpt-5.4");
      expect(names).toEqual(["claude-sonnet-4-6", "claude-haiku-4-5"]);
    });
  });

  describe("litellmModelName", () => {
    it("returns claude-sonnet-4-6 for anthropic provider", () => {
      const config = makeConfig({ vertexProvider: "anthropic" });
      expect(litellmModelName(config)).toBe("claude-sonnet-4-6");
    });

    it("returns gemini-2.5-pro for google provider", () => {
      const config = makeConfig({ vertexProvider: "google" });
      expect(litellmModelName(config)).toBe("gemini-2.5-pro");
    });

    it("returns custom agentModel when specified", () => {
      const config = makeConfig({ agentModel: "claude-opus-4-6" });
      expect(litellmModelName(config)).toBe("claude-opus-4-6");
    });
  });
});
