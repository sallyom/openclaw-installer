import { describe, expect, it } from "vitest";
import { buildSavedInstanceEnvContent } from "../../deployers/local.js";
import type { DeployConfig } from "../../deployers/types.js";
import { parseSavedLocalInstanceConfig } from "../status.js";

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "local",
    agentName: "demo",
    agentDisplayName: "Demo",
    prefix: "openclaw",
    ...overrides,
  };
}

function parseEnvFile(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) {
      continue;
    }
    vars[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return vars;
}

describe("parseSavedLocalInstanceConfig", () => {
  it("restores saved SecretRefs and Podman secret mappings", () => {
    const config = makeConfig({
      inferenceProvider: "google",
      googleApiKeyRef: { source: "env", provider: "default", id: "GEMINI_API_KEY" },
      googleModel: "gemini-3.1-pro-preview",
      googleModels: ["gemini-2.5-flash"],
      openrouterApiKeyRef: { source: "env", provider: "default", id: "OPENROUTER_API_KEY" },
      modelEndpointApiKeyRef: { source: "file", provider: "vault", id: "/providers/model-endpoint/apiKey" },
      podmanSecretMappings: [
        { secretName: "gemini_api_key", targetEnv: "GEMINI_API_KEY" },
        { secretName: "openrouter_api_key", targetEnv: "OPENROUTER_API_KEY" },
      ],
    });

    const savedVars = parseEnvFile(buildSavedInstanceEnvContent(config, "openclaw-demo"));
    const parsed = parseSavedLocalInstanceConfig(savedVars);

    expect(parsed.googleApiKeyRef).toEqual({
      source: "env",
      provider: "default",
      id: "GEMINI_API_KEY",
    });
    expect(parsed.googleModel).toBe("gemini-3.1-pro-preview");
    expect(parsed.googleModels).toEqual(["gemini-2.5-flash"]);
    expect(parsed.openrouterApiKeyRef).toEqual({
      source: "env",
      provider: "default",
      id: "OPENROUTER_API_KEY",
    });
    expect(parsed.modelEndpointApiKeyRef).toEqual({
      source: "file",
      provider: "vault",
      id: "/providers/model-endpoint/apiKey",
    });
    expect(parsed.podmanSecretMappings).toEqual([
      { secretName: "gemini_api_key", targetEnv: "GEMINI_API_KEY" },
      { secretName: "openrouter_api_key", targetEnv: "OPENROUTER_API_KEY" },
    ]);
  });
});
