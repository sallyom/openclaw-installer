import { describe, expect, it } from "vitest";
import {
  buildOpenClawConfig,
  deriveModel,
  namespaceName,
  normalizeModelRef,
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
      "endpoint/mistral-small-24b-w8a8": { alias: "Mistral Small 24B" },
    });
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

  it("adds installer-provided provider models to the OpenClaw picker allowlist", () => {
    const config = makeConfig({
      inferenceProvider: "anthropic",
      agentModel: "claude-sonnet-4-6",
      anthropicModel: "claude-opus-4-6",
      openaiModel: "gpt-5",
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
      "endpoint/llama-4-scout-17b-16e-w4a16": { alias: "Llama 4 Scout 17B" },
      "endpoint/llama-4-maverick-17b": { alias: "Llama 4 Maverick 17B" },
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
