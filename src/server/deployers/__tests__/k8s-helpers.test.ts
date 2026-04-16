import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildManagedAgentAuthProfiles,
  buildOpenClawConfig,
  deriveModel,
  detectUnavailableProvider,
  namespaceName,
  normalizeModelRef,
  resolveEnvSecretRefId,
  resolveSubagentModel,
  sanitizeForRfc1123,
  usesDefaultEnvSecretRef,
} from "../k8s-helpers.js";
import type { DeployConfig } from "../types.js";

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return {
    mode: "kubernetes",
    agentName: "demo",
    agentDisplayName: "Demo",
    ...overrides,
  };
}

describe("model config generation", () => {
  it("detects runtime-backed default env SecretRefs", () => {
    expect(usesDefaultEnvSecretRef({ source: "env", provider: "default", id: "OPENAI_API_KEY" })).toBe(true);
    expect(usesDefaultEnvSecretRef({ source: "env", provider: "vault", id: "OPENAI_API_KEY" })).toBe(false);
    expect(usesDefaultEnvSecretRef({ source: "exec", provider: "default", id: "OPENAI_API_KEY" })).toBe(false);
  });

  it("resolves the injected env var name for custom env/default SecretRefs", () => {
    expect(resolveEnvSecretRefId(undefined, "OPENAI_API_KEY")).toBe("OPENAI_API_KEY");
    expect(resolveEnvSecretRefId(
      { source: "env", provider: "default", id: "JOY_TELEGRAM_BOT_TOKEN" },
      "TELEGRAM_BOT_TOKEN",
    )).toBe("JOY_TELEGRAM_BOT_TOKEN");
    expect(resolveEnvSecretRefId(
      { source: "exec", provider: "vault", id: "providers/openai/apiKey" },
      "OPENAI_API_KEY",
    )).toBeUndefined();
  });

  it("never deploys into the default namespace implicitly", () => {
    const config = makeConfig({
      prefix: "alice",
      agentName: "lynx",
      namespace: "default",
    });

    expect(namespaceName(config)).toBe("alice-lynx-openclaw");
  });

  it("uses an explicit namespace when it is not default", () => {
    const config = makeConfig({
      prefix: "alice",
      agentName: "lynx",
      namespace: "team-space",
    });

    expect(namespaceName(config)).toBe("team-space");
  });

  it("normalizes bare Anthropic model ids to provider/model refs", () => {
    const config = makeConfig({
      anthropicApiKey: "test-key",
      agentModel: "claude-sonnet-4-6",
    });

    expect(normalizeModelRef(config, "claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
    expect(deriveModel(config)).toBe("anthropic/claude-sonnet-4-6");
  });

  it("normalizes OpenRouter model ids whether or not they already include the provider prefix", () => {
    const config = makeConfig({
      inferenceProvider: "openrouter",
      openrouterApiKey: "test-key",
      openrouterModel: "google/gemma-4-26b-a4b-it",
    });

    expect(normalizeModelRef(config, "google/gemma-4-26b-a4b-it")).toBe("openrouter/google/gemma-4-26b-a4b-it");
    expect(normalizeModelRef(config, "openrouter/google/gemma-4-26b-a4b-it")).toBe("openrouter/google/gemma-4-26b-a4b-it");
    expect(deriveModel(config)).toBe("openrouter/google/gemma-4-26b-a4b-it");
  });

  it("normalizes Google model ids whether or not they already include the provider prefix", () => {
    const config = makeConfig({
      inferenceProvider: "google",
      googleApiKey: "google-key",
      googleModel: "gemini-3.1-pro-preview",
    });

    expect(normalizeModelRef(config, "gemini-3.1-pro-preview")).toBe("google/gemini-3.1-pro-preview");
    expect(normalizeModelRef(config, "google/gemini-3.1-pro-preview")).toBe("google/gemini-3.1-pro-preview");
    expect(deriveModel(config)).toBe("google/gemini-3.1-pro-preview");
  });

  it("uses the endpoint model as primary for custom endpoints even when agentModel is present", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      agentModel: "claude-sonnet-4-6",
      modelEndpoint: "http://localhost:8080/v1",
      modelEndpointModel: "local-model",
    });

    expect(deriveModel(config)).toBe("endpoint/local-model");
  });

  it("normalizes slash-containing endpoint model ids under the endpoint provider", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      modelEndpoint: "http://localhost:8080/v1",
      modelEndpointModel: "google/gemma-4-E2B-it",
    });

    expect(normalizeModelRef(config, "google/gemma-4-E2B-it")).toBe("endpoint/google/gemma-4-E2B-it");
    expect(normalizeModelRef(config, "endpoint/google/gemma-4-E2B-it")).toBe("endpoint/google/gemma-4-E2B-it");
    expect(deriveModel(config)).toBe("endpoint/google/gemma-4-E2B-it");
  });

  it("publishes slash-containing endpoint model ids as endpoint provider refs", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      modelEndpoint: "http://localhost:8080/v1",
      modelEndpointModel: "google/gemma-4-E2B-it",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      agents?: {
        defaults?: {
          model?: { primary?: string };
        };
      };
    };

    expect(rendered.agents?.defaults?.model?.primary).toBe("endpoint/google/gemma-4-E2B-it");
  });

  it("publishes only the configured default model in the agent catalog", () => {
    const config = makeConfig({
      anthropicApiKey: "test-key",
      agentModel: "claude-sonnet-4-6",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      agents?: {
        defaults?: {
          model?: { primary?: string };
          models?: Record<string, { alias?: string }>;
        };
      };
    };

    expect(rendered.agents?.defaults?.model?.primary).toBe("anthropic/claude-sonnet-4-6");
    expect(rendered.agents?.defaults?.models).toEqual({
      "anthropic/claude-sonnet-4-6": { alias: "claude-sonnet-4-6" },
    });
  });

  it("publishes default provider entries for additional configured credentials", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      anthropicApiKey: "anthropic-key",
      openaiApiKey: "openai-key",
      openrouterApiKey: "openrouter-key",
      openrouterModel: "openrouter/auto",
      modelEndpoint: "https://example.com/v1",
      modelEndpointModel: "mistral-small-24b-w8a8",
      modelEndpointModelLabel: "Mistral Small 24B",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      agents?: {
        defaults?: {
          models?: Record<string, { alias?: string }>;
        };
      };
    };

    expect(rendered.agents?.defaults?.models).toMatchObject({
      "anthropic/claude-sonnet-4-6": { alias: "claude-sonnet-4-6" },
      "openai/gpt-5.4": { alias: "gpt-5.4" },
      "openrouter/auto": { alias: "openrouter/auto" },
      "endpoint/mistral-small-24b-w8a8": { alias: "Mistral Small 24B" },
    });
  });

  it("applies mainAgent bundle fallbacks even when the bundle does not override primary", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-main-agent-bundle-"));
    writeFileSync(
      join(dir, "openclaw-agents.json"),
      JSON.stringify({
        mainAgent: {
          model: {
            fallbacks: ["endpoint/google/gemma-4-26B-A4B-it"],
          },
        },
      }),
      "utf8",
    );

    const config = makeConfig({
      mode: "local",
      inferenceProvider: "anthropic",
      anthropicApiKey: "test-key",
      modelEndpoint: "http://100.76.40.32:8000/v1",
      modelEndpointModel: "google/gemma-4-26B-A4B-it",
      modelEndpointModelLabel: "Gemma 4 26B",
      agentSourceDir: dir,
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      agents?: {
        defaults?: {
          models?: Record<string, { alias?: string }>;
        };
        list?: Array<{
          model?: { primary?: string; fallbacks?: string[] };
        }>;
      };
    };

    expect(rendered.agents?.list?.[0]?.model).toEqual({
      primary: "anthropic/claude-sonnet-4-6",
      fallbacks: ["endpoint/google/gemma-4-26B-A4B-it"],
    });
    expect(rendered.agents?.defaults?.models).toMatchObject({
      "endpoint/google/gemma-4-26B-A4B-it": { alias: "gemma-4-26B-A4B-it" },
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("emits an empty endpoint provider model list when no endpoint model is set yet", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      modelEndpoint: "https://example.com/v1",
      modelEndpointApiKey: "endpoint-key",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      models?: {
        providers?: Record<string, { models?: Array<{ id?: string; name?: string }> }>;
      };
    };

    expect(rendered.models?.providers?.endpoint?.models).toEqual([]);
  });

  it("keeps device auth enabled in the Control UI config", () => {
    const config = makeConfig();
    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      gateway?: {
        controlUi?: {
          dangerouslyDisableDeviceAuth?: boolean;
          enabled?: boolean;
        };
      };
    };

    expect(rendered.gateway?.controlUi?.enabled).toBe(true);
    expect(rendered.gateway?.controlUi?.dangerouslyDisableDeviceAuth).toBeUndefined();
  });

  it("can disable OpenAI-compatible gateway endpoints in generated config", () => {
    const config = makeConfig({
      openaiCompatibleEndpointsEnabled: false,
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      gateway?: {
        http?: {
          endpoints?: {
            chatCompletions?: { enabled?: boolean };
            responses?: { enabled?: boolean };
          };
        };
      };
    };

    expect(rendered.gateway?.http?.endpoints?.chatCompletions?.enabled).toBe(false);
    expect(rendered.gateway?.http?.endpoints?.responses?.enabled).toBe(false);
  });

  it("disables the bundled acpx plugin by default in generated config", () => {
    const rendered = buildOpenClawConfig(makeConfig(), "gateway-token") as {
      plugins?: {
        entries?: Record<string, { enabled?: boolean }>;
      };
    };

    expect(rendered.plugins?.entries?.acpx?.enabled).toBe(false);
  });

  it("writes the display name into the default agent identity", () => {
    const config = makeConfig({
      agentName: "joe",
      agentDisplayName: "Joe",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      agents?: {
        list?: Array<{
          id?: string;
          identity?: { name?: string };
        }>;
      };
    };

    expect(rendered.agents?.list?.[0]).toMatchObject({
      id: "openclaw_joe",
      identity: { name: "Joe" },
    });
  });

  it("prefers the selected Anthropic provider even when an OpenAI key is also present", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "anthropic-key",
      openaiApiKey: "openai-key",
    });

    expect(deriveModel(config)).toBe("anthropic/claude-sonnet-4-6");
  });

  // Regression tests for #1: normalizeModelRef must use litellm/ prefix when proxy is active
  it("normalizes vertex-anthropic custom model to litellm/ when proxy is enabled", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      agentModel: "claude-opus-4-6",
    });

    expect(normalizeModelRef(config, "claude-opus-4-6")).toBe("litellm/claude-opus-4-6");
    expect(deriveModel(config)).toBe("litellm/claude-opus-4-6");
  });

  it("normalizes vertex-google custom model to litellm/ when proxy is enabled", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-google",
      litellmProxy: true,
      agentModel: "gemini-2.5-pro",
    });

    expect(normalizeModelRef(config, "gemini-2.5-pro")).toBe("litellm/gemini-2.5-pro");
    expect(deriveModel(config)).toBe("litellm/gemini-2.5-pro");
  });

  it("normalizes vertex-anthropic custom model to anthropic-vertex/ when proxy is disabled", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: false,
      agentModel: "claude-opus-4-6",
    });

    expect(normalizeModelRef(config, "claude-opus-4-6")).toBe("anthropic-vertex/claude-opus-4-6");
    expect(deriveModel(config)).toBe("anthropic-vertex/claude-opus-4-6");
  });

  it("passes through model refs that already contain a provider prefix", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
    });

    expect(normalizeModelRef(config, "litellm/my-model")).toBe("litellm/my-model");
    expect(normalizeModelRef(config, "anthropic-vertex/my-model")).toBe("anthropic-vertex/my-model");
  });

  it("writes external secret provider config without emitting an invalid plain OpenAI provider stub", () => {
    const config = makeConfig({
      inferenceProvider: "openai",
      secretsProvidersJson: JSON.stringify({
        default: { source: "env" },
        vault_openai: {
          source: "exec",
          command: "/usr/local/bin/vault",
          args: ["kv", "get", "-field=OPENAI_API_KEY", "secret/openclaw"],
        },
      }),
      openaiApiKeyRef: {
        source: "exec",
        provider: "vault_openai",
        id: "value",
      },
      telegramBotTokenRef: {
        source: "env",
        provider: "default",
        id: "TELEGRAM_BOT_TOKEN",
      },
      telegramAllowFrom: "12345",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      secrets?: { providers?: Record<string, unknown> };
      models?: { providers?: Record<string, { apiKey?: unknown }> };
      channels?: { telegram?: { botToken?: unknown; allowFrom?: number[] } };
    };

    expect(rendered.secrets?.providers).toMatchObject({
      default: { source: "env" },
      vault_openai: {
        source: "exec",
        command: "/usr/local/bin/vault",
      },
    });
    expect(rendered.models?.providers?.openai).toBeUndefined();
    expect(rendered.channels?.telegram?.botToken).toEqual({
      source: "env",
      provider: "default",
      id: "TELEGRAM_BOT_TOKEN",
    });
    expect(rendered.channels?.telegram?.allowFrom).toEqual([12345]);
  });

  it("rewrites managed vault helper commands onto the writable OpenClaw home volume", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      secretsProvidersJson: JSON.stringify({
        vault: {
          source: "exec",
          command: "/home/node/bin/openclaw-vault",
          args: ["kv", "get", "-format=json", "-field=data", "secret/openclaw"],
          passEnv: ["VAULT_ADDR", "VAULT_TOKEN"],
          jsonOnly: true,
        },
      }),
      anthropicApiKeyRef: {
        source: "exec",
        provider: "vault",
        id: "providers/anthropic/apiKey",
      },
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      secrets?: {
        providers?: Record<string, {
          command?: string;
          timeoutMs?: number;
          noOutputTimeoutMs?: number;
        }>;
      };
    };

    expect(rendered.secrets?.providers?.vault?.command).toBe("/home/node/.openclaw/bin/openclaw-vault");
    expect(rendered.secrets?.providers?.vault?.timeoutMs).toBe(15000);
    expect(rendered.secrets?.providers?.vault?.noOutputTimeoutMs).toBe(15000);
  });

  it("builds SecretRef-backed auth profiles for managed Anthropic, OpenAI, and Google credentials", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      anthropicApiKeyRef: {
        source: "exec",
        provider: "vault",
        id: "providers/anthropic/apiKey",
      },
      openaiApiKey: "sk-openai-runtime",
      googleApiKey: "google-runtime-key",
    });

    expect(buildManagedAgentAuthProfiles(config)).toEqual({
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          keyRef: {
            source: "exec",
            provider: "vault",
            id: "providers/anthropic/apiKey",
          },
        },
        "openai:default": {
          type: "api_key",
          provider: "openai",
          keyRef: {
            source: "env",
            provider: "default",
            id: "OPENAI_API_KEY",
          },
        },
        "google:default": {
          type: "api_key",
          provider: "google",
          keyRef: {
            source: "env",
            provider: "default",
            id: "GEMINI_API_KEY",
          },
        },
      },
    });
  });

  it("uses a dedicated endpoint token when a model endpoint is configured", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      anthropicApiKey: "anthropic-key",
      openaiApiKey: "openai-key",
      modelEndpoint: "http://localhost:8000/v1",
      modelEndpointApiKey: "endpoint-token",
      modelEndpointModel: "llama-4-scout-17b-16e-w4a16",
      modelEndpointModels: [
        { id: "llama-4-scout-17b-16e-w4a16", name: "Llama 4 Scout 17B" },
        { id: "llama-4-maverick-17b", name: "Llama 4 Maverick 17B" },
      ],
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      models?: {
        providers?: Record<string, {
          apiKey?: unknown;
          baseUrl?: string;
          api?: string;
          models?: Array<{ id?: string; name?: string }>;
        }>;
      };
      secrets?: { providers?: Record<string, unknown> };
    };

    expect(rendered.models?.providers?.endpoint?.baseUrl).toBe("http://localhost:8000/v1");
    expect(rendered.models?.providers?.endpoint?.api).toBe("openai-completions");
    expect(rendered.models?.providers?.endpoint?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "MODEL_ENDPOINT_API_KEY",
    });
    expect(rendered.models?.providers?.endpoint?.models).toEqual([
      { id: "llama-4-scout-17b-16e-w4a16", name: "Llama 4 Scout 17B" },
      { id: "llama-4-maverick-17b", name: "Llama 4 Maverick 17B" },
    ]);
    expect(rendered.secrets?.providers).toMatchObject({
      default: { source: "env" },
    });
  });

  it("uses the local no-auth marker for unauthenticated model endpoints", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      openaiApiKey: "openai-key",
      modelEndpoint: "http://localhost:8080/v1",
      modelEndpointModel: "local-model",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      models?: {
        providers?: Record<string, {
          apiKey?: unknown;
          baseUrl?: string;
          api?: string;
        }>;
      };
    };

    expect(rendered.models?.providers?.endpoint?.baseUrl).toBe("http://localhost:8080/v1");
    expect(rendered.models?.providers?.endpoint?.api).toBe("openai-completions");
    expect(rendered.models?.providers?.endpoint?.apiKey).toBeUndefined();
  });

  it("adds installer-provided provider models to the OpenClaw picker allowlist", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      agentModel: "claude-sonnet-4-6",
      anthropicModel: "claude-opus-4-6",
      openaiModel: "gpt-5",
      openrouterModel: "auto",
      openrouterModels: ["google/gemma-4-26b-a4b-it", "openrouter/anthropic/claude-sonnet-4-6"],
      modelEndpoint: "http://localhost:8000/v1",
      modelEndpointModel: "llama-4-scout-17b-16e-w4a16",
      modelEndpointModels: [
        { id: "llama-4-scout-17b-16e-w4a16", name: "Llama 4 Scout 17B" },
        { id: "llama-4-maverick-17b", name: "Llama 4 Maverick 17B" },
      ],
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      agents?: {
        defaults?: {
          models?: Record<string, { alias?: string }>;
        };
      };
    };

    expect(rendered.agents?.defaults?.models).toMatchObject({
      "anthropic/claude-sonnet-4-6": { alias: "claude-sonnet-4-6" },
      "anthropic/claude-opus-4-6": { alias: "claude-opus-4-6" },
      "openai/gpt-5": { alias: "gpt-5" },
      "openrouter/auto": { alias: "auto" },
      "openrouter/google/gemma-4-26b-a4b-it": { alias: "google/gemma-4-26b-a4b-it" },
      "openrouter/anthropic/claude-sonnet-4-6": { alias: "openrouter/anthropic/claude-sonnet-4-6" },
      "endpoint/llama-4-scout-17b-16e-w4a16": { alias: "Llama 4 Scout 17B" },
      "endpoint/llama-4-maverick-17b": { alias: "Llama 4 Maverick 17B" },
    });
  });

  it("configures OpenRouter provider auth and published models", () => {
    const config = makeConfig({
      inferenceProvider: "openrouter",
      openrouterApiKey: "sk-or-test",
      openrouterModel: "openrouter/auto",
      openrouterModels: ["openrouter/anthropic/claude-sonnet-4-6"],
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      models?: {
        providers?: Record<string, {
          baseUrl?: string;
          api?: string;
          apiKey?: unknown;
          models?: Array<{ id?: string; name?: string }>;
        }>;
      };
      secrets?: { providers?: Record<string, unknown> };
    };

    expect(rendered.models?.providers?.openrouter?.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(rendered.models?.providers?.openrouter?.api).toBe("openai-completions");
    expect(rendered.models?.providers?.openrouter?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "OPENROUTER_API_KEY",
    });
    expect(rendered.models?.providers?.openrouter?.models).toEqual([
      { id: "auto", name: "auto" },
      { id: "anthropic/claude-sonnet-4-6", name: "anthropic/claude-sonnet-4-6" },
    ]);
    expect(rendered.secrets?.providers).toMatchObject({
      default: { source: "env" },
    });
  });

  it("configures Google provider auth and published models", () => {
    const config = makeConfig({
      inferenceProvider: "google",
      googleApiKey: "google-key",
      googleModel: "gemini-3.1-pro-preview",
      googleModels: ["gemini-2.5-flash"],
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      models?: {
        providers?: Record<string, {
          baseUrl?: string;
          api?: string;
          apiKey?: unknown;
          models?: Array<{ id?: string; name?: string }>;
        }>;
      };
      secrets?: { providers?: Record<string, unknown> };
    };

    expect(rendered.models?.providers?.google?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(rendered.models?.providers?.google?.api).toBe("google-generative-ai");
    expect(rendered.models?.providers?.google?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "GEMINI_API_KEY",
    });
    expect(rendered.models?.providers?.google?.models).toEqual([
      { id: "gemini-3.1-pro-preview", name: "gemini-3.1-pro-preview" },
      { id: "gemini-2.5-flash", name: "gemini-2.5-flash" },
    ]);
    expect(rendered.secrets?.providers).toMatchObject({
      default: { source: "env" },
    });
  });

  it("writes ordered model fallbacks into the OpenClaw config", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      agentModel: "claude-sonnet-4-6",
      modelFallbacks: [
        "openai/gpt-5",
        "endpoint/llama-4-scout-17b-16e-w4a16",
      ],
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      agents?: {
        defaults?: {
          model?: { primary?: string; fallbacks?: string[] };
        };
        list?: Array<{
          model?: { primary?: string; fallbacks?: string[] };
        }>;
      };
    };

    expect(rendered.agents?.defaults?.model).toEqual({
      primary: "anthropic/claude-sonnet-4-6",
      fallbacks: [
        "openai/gpt-5",
        "endpoint/llama-4-scout-17b-16e-w4a16",
      ],
    });
    expect(rendered.agents?.list?.[0]?.model).toEqual({
      primary: "anthropic/claude-sonnet-4-6",
      fallbacks: [
        "openai/gpt-5",
        "endpoint/llama-4-scout-17b-16e-w4a16",
      ],
    });
  });

  it("auto-generates env SecretRefs for supported cluster secrets without an invalid plain OpenAI provider stub", () => {
    const config = makeConfig({
      mode: "kubernetes",
      inferenceProvider: "openai",
      openaiApiKey: "sk-openai-test",
      telegramEnabled: true,
      telegramBotToken: "123:abc",
      telegramAllowFrom: "12345",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      secrets?: { providers?: Record<string, unknown> };
      models?: { providers?: Record<string, { apiKey?: unknown }> };
      channels?: { telegram?: { botToken?: unknown } };
    };

    expect(rendered.secrets?.providers).toMatchObject({
      default: { source: "env" },
    });
    expect(rendered.models?.providers?.openai).toBeUndefined();
    expect(rendered.channels?.telegram?.botToken).toEqual({
      source: "env",
      provider: "default",
      id: "TELEGRAM_BOT_TOKEN",
    });
  });

  it("does not auto-generate env SecretRefs for local deploys", () => {
    const config = makeConfig({
      mode: "local",
      inferenceProvider: "anthropic",
      agentSecurityMode: "secretrefs",
      anthropicApiKey: "sk-ant-test",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      secrets?: { providers?: Record<string, unknown> };
      models?: { providers?: Record<string, { apiKey?: unknown }> };
    };

    expect(rendered.secrets?.providers).toBeUndefined();
    expect(rendered.models?.providers?.anthropic?.apiKey).toBeUndefined();
  });

  it("does not emit an invalid anthropic provider stub when Anthropic auth is configured", () => {
    const config = makeConfig({
      mode: "local",
      inferenceProvider: "anthropic",
      anthropicApiKey: "sk-ant-test",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      models?: { providers?: Record<string, { apiKey?: unknown }> };
    };

    expect(rendered.models?.providers?.anthropic).toBeUndefined();
  });
});

// LiteLLM model catalog only lists Vertex models, not secondary providers
describe("litellm model catalog in proxy mode", () => {
  it("does not list secondary OpenAI model in litellm provider", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      gcpServiceAccountJson: '{"project_id":"test"}',
      openaiApiKey: "sk-oai-test",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      models?: { providers?: { litellm?: { models?: Array<{ id: string; name: string }> } } };
    };

    const litellmModels = rendered.models?.providers?.litellm?.models ?? [];
    const modelIds = litellmModels.map((m) => m.id);
    // OpenAI models go direct via gateway, not through LiteLLM
    expect(modelIds).not.toContain("gpt-5.4");
  });

  it("does not duplicate the primary model in models.providers.litellm", () => {
    const config = makeConfig({
      inferenceProvider: "vertex-anthropic",
      litellmProxy: true,
      gcpServiceAccountJson: '{"project_id":"test"}',
      openaiApiKey: "sk-oai-test",
    });

    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      models?: { providers?: { litellm?: { models?: Array<{ id: string; name: string }> } } };
    };

    const litellmModels = rendered.models?.providers?.litellm?.models ?? [];
    const modelIds = litellmModels.map((m) => m.id);
    // Primary model (claude-sonnet-4-6) should NOT be in the provider listing
    // because it is already in agents.defaults.models via buildDefaultAgentModelCatalog
    expect(modelIds).not.toContain("claude-sonnet-4-6");
  });
});

// Regression tests for #7: agent names with underscores must produce valid namespaces
describe("sanitizeForRfc1123", () => {
  it("replaces underscores with hyphens", () => {
    expect(sanitizeForRfc1123("a_0")).toBe("a-0");
  });

  it("collapses consecutive hyphens", () => {
    expect(sanitizeForRfc1123("a__b")).toBe("a-b");
  });

  it("removes leading and trailing hyphens", () => {
    expect(sanitizeForRfc1123("_hello_")).toBe("hello");
  });

  it("lowercases input", () => {
    expect(sanitizeForRfc1123("MyAgent")).toBe("myagent");
  });

  it("passes through already-valid names", () => {
    expect(sanitizeForRfc1123("my-agent-01")).toBe("my-agent-01");
  });
});

describe("namespaceName", () => {
  it("sanitizes agent names with underscores (issue #7)", () => {
    const config = makeConfig({ agentName: "a_0", prefix: "bmurdock" });
    expect(namespaceName(config)).toBe("bmurdock-a-0-openclaw");
  });

  it("produces RFC 1123-valid namespaces for normal names", () => {
    const config = makeConfig({ agentName: "demo", prefix: "user" });
    expect(namespaceName(config)).toBe("user-demo-openclaw");
  });

  it("uses explicit namespace when provided", () => {
    const config = makeConfig({ agentName: "demo", namespace: "Custom-NS" });
    expect(namespaceName(config)).toBe("custom-ns");
  });

  it("falls back to 'agent' when agent name sanitizes to empty", () => {
    const config = makeConfig({ agentName: "___", prefix: "user" });
    expect(namespaceName(config)).toBe("user-agent-openclaw");
  });
});

// Regression tests for #67: subagent model fallback
describe("resolveSubagentModel", () => {
  it("uses deploy-time model when bundle entry has no model", () => {
    expect(resolveSubagentModel(undefined, "anthropic/claude-sonnet-4-6")).toEqual({
      primary: "anthropic/claude-sonnet-4-6",
    });
  });

  it("uses deploy-time model when bundle entry has empty model", () => {
    expect(resolveSubagentModel({}, "anthropic/claude-sonnet-4-6")).toEqual({
      primary: "anthropic/claude-sonnet-4-6",
    });
  });

  it("appends deploy-time model as fallback when bundle declares a different model", () => {
    expect(resolveSubagentModel(
      { primary: "openai/gpt-5.4" },
      "anthropic/claude-sonnet-4-6",
    )).toEqual({
      primary: "openai/gpt-5.4",
      fallbacks: ["anthropic/claude-sonnet-4-6"],
    });
  });

  it("appends deploy-time model after existing bundle fallbacks", () => {
    expect(resolveSubagentModel(
      { primary: "openai/gpt-5.4", fallbacks: ["openai/gpt-5.4-mini"] },
      "anthropic-vertex/claude-sonnet-4-6",
    )).toEqual({
      primary: "openai/gpt-5.4",
      fallbacks: ["openai/gpt-5.4-mini", "anthropic-vertex/claude-sonnet-4-6"],
    });
  });

  it("does not duplicate deploy-time model when it matches the primary", () => {
    expect(resolveSubagentModel(
      { primary: "anthropic/claude-sonnet-4-6" },
      "anthropic/claude-sonnet-4-6",
    )).toEqual({
      primary: "anthropic/claude-sonnet-4-6",
    });
  });

  it("does not duplicate deploy-time model when it is already a fallback", () => {
    expect(resolveSubagentModel(
      { primary: "anthropic/claude-sonnet-4-6", fallbacks: ["openai/gpt-5.4"] },
      "openai/gpt-5.4",
    )).toEqual({
      primary: "anthropic/claude-sonnet-4-6",
      fallbacks: ["openai/gpt-5.4"],
    });
  });

  it("promotes the deploy-time model when the bundle primary provider is unavailable", () => {
    const config = makeConfig({
      inferenceProvider: "custom-endpoint",
      modelEndpoint: "http://100.76.40.32:8000/v1",
      modelEndpointModel: "google/gemma-4-26B-A4B-it",
    });

    expect(resolveSubagentModel(
      { primary: "anthropic/claude-sonnet-4-6", fallbacks: ["openai/gpt-5.4"] },
      "endpoint/google/gemma-4-26B-A4B-it",
      config,
    )).toEqual({
      primary: "endpoint/google/gemma-4-26B-A4B-it",
      fallbacks: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4"],
    });
  });
});

describe("detectUnavailableProvider", () => {
  it("detects missing OpenAI provider", () => {
    const config = makeConfig({ inferenceProvider: "anthropic", anthropicApiKey: "sk-ant" });
    expect(detectUnavailableProvider("openai/gpt-5.4", config)).toBe(true);
  });

  it("detects missing Google provider", () => {
    const config = makeConfig({ inferenceProvider: "anthropic", anthropicApiKey: "sk-ant" });
    expect(detectUnavailableProvider("google/gemini-3.1-pro-preview", config)).toBe(true);
  });

  it("detects missing Anthropic provider", () => {
    const config = makeConfig({ inferenceProvider: "openai", openaiApiKey: "sk-oai" });
    expect(detectUnavailableProvider("anthropic/claude-sonnet-4-6", config)).toBe(true);
  });

  it("returns false when OpenAI key is configured", () => {
    const config = makeConfig({ openaiApiKey: "sk-oai" });
    expect(detectUnavailableProvider("openai/gpt-5.4", config)).toBe(false);
  });

  it("returns false when Anthropic key is configured", () => {
    const config = makeConfig({ anthropicApiKey: "sk-ant" });
    expect(detectUnavailableProvider("anthropic/claude-sonnet-4-6", config)).toBe(false);
  });

  it("returns false when inference provider matches", () => {
    const config = makeConfig({ inferenceProvider: "openai" });
    expect(detectUnavailableProvider("openai/gpt-5.4", config)).toBe(false);
  });

  it("detects missing vertex-anthropic provider", () => {
    const config = makeConfig({ inferenceProvider: "openai" });
    expect(detectUnavailableProvider("anthropic-vertex/claude-sonnet-4-6", config)).toBe(true);
  });

  it("returns false when vertex-anthropic is configured", () => {
    const config = makeConfig({ vertexEnabled: true, vertexProvider: "anthropic" });
    expect(detectUnavailableProvider("anthropic-vertex/claude-sonnet-4-6", config)).toBe(false);
  });

  it("returns false for unknown provider prefixes and detects missing litellm", () => {
    const config = makeConfig({});
    expect(detectUnavailableProvider("litellm/my-model", config)).toBe(true);
    expect(detectUnavailableProvider("custom/model", config)).toBe(false);
  });
});

describe("MCP servers from agent source", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures in tests.
      }
    }
  });

  it("includes mcp.servers when mcp.json exists in agent source dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-k8s-mcp-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({ mcpServers: { myserver: { url: "https://mcp.example.com" } } }),
      "utf8",
    );

    const config = makeConfig({ agentSourceDir: dir });
    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      mcp?: { servers?: Record<string, unknown> };
    };

    expect(rendered.mcp?.servers).toEqual({
      myserver: { url: "https://mcp.example.com" },
    });
  });

  it("omits mcp when no mcp.json in agent source dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-k8s-mcp-"));
    tempDirs.push(dir);

    const config = makeConfig({ agentSourceDir: dir });
    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      mcp?: { servers?: Record<string, unknown> };
    };

    expect(rendered.mcp).toBeUndefined();
  });

  it("omits mcp when agentSourceDir is not set", () => {
    const config = makeConfig();
    const rendered = buildOpenClawConfig(config, "gateway-token") as {
      mcp?: { servers?: Record<string, unknown> };
    };

    expect(rendered.mcp).toBeUndefined();
  });
});
