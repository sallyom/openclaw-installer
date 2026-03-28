import process from "node:process";
import { randomBytes } from "node:crypto";
import type { DeployConfig, DeployModelOption, DeploySecretRef } from "./types.js";
import { shouldUseLitellmProxy, litellmModelName, LITELLM_PORT } from "./litellm.js";
import { shouldUseOtel, OTEL_HTTP_PORT } from "./otel.js";
import { buildSandboxConfig } from "./sandbox.js";
import { buildSandboxToolPolicy } from "./tool-policy.js";
import { loadAgentSourceBundle } from "./agent-source.js";

export const DEFAULT_IMAGE = process.env.OPENCLAW_IMAGE || "ghcr.io/openclaw/openclaw:latest";
export const DEFAULT_VERTEX_IMAGE = process.env.OPENCLAW_VERTEX_IMAGE || DEFAULT_IMAGE;
export const CUSTOM_ENDPOINT_PROVIDER = "endpoint";

export function defaultImage(config: DeployConfig): string {
  if (config.image) return config.image;
  return config.vertexEnabled ? DEFAULT_VERTEX_IMAGE : DEFAULT_IMAGE;
}

export function tryParseProjectId(saJson: string): string {
  try {
    const parsed = JSON.parse(saJson);
    return typeof parsed.project_id === "string" ? parsed.project_id : "";
  } catch {
    return "";
  }
}

export function sanitizeForRfc1123(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function namespaceName(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  const explicitNamespace = config.namespace?.trim().toLowerCase();
  if (explicitNamespace && explicitNamespace !== "default") return explicitNamespace;
  const sanitizedAgent = sanitizeForRfc1123(config.agentName) || "agent";
  const sanitizedPrefix = sanitizeForRfc1123(prefix);
  return `${sanitizedPrefix}-${sanitizedAgent}-openclaw`;
}

export function agentId(config: DeployConfig): string {
  const prefix = config.prefix || "openclaw";
  return `${prefix}_${config.agentName}`;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64");
}

export function usesDefaultEnvSecretRef(ref?: DeploySecretRef): ref is DeploySecretRef {
  return Boolean(ref?.source === "env" && ref.provider.trim() === "default" && ref.id.trim());
}

export function normalizeModelRef(config: DeployConfig, modelRef: string): string {
  const trimmed = modelRef.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("/")) return trimmed;

  if (config.inferenceProvider === "anthropic") return `anthropic/${trimmed}`;
  if (config.inferenceProvider === "openai") {
    return `openai/${trimmed}`;
  }
  if (config.inferenceProvider === "custom-endpoint") {
    return `${CUSTOM_ENDPOINT_PROVIDER}/${trimmed}`;
  }
  // Fix for #1: check litellm proxy before falling back to direct vertex providers
  if (config.inferenceProvider === "vertex-anthropic") {
    return shouldUseLitellmProxy(config) ? `litellm/${trimmed}` : `anthropic-vertex/${trimmed}`;
  }
  if (config.inferenceProvider === "vertex-google") {
    return shouldUseLitellmProxy(config) ? `litellm/${trimmed}` : `google-vertex/${trimmed}`;
  }
  if (config.vertexEnabled && shouldUseLitellmProxy(config)) return `litellm/${trimmed}`;
  if (config.vertexEnabled) {
    return `${config.vertexProvider === "anthropic" ? "anthropic-vertex" : "google-vertex"}/${trimmed}`;
  }
  if (config.openaiApiKey || config.modelEndpoint) return `openai/${trimmed}`;
  return `anthropic/${trimmed}`;
}

export function buildDefaultAgentModelCatalog(modelRef: string): Record<string, { alias: string }> {
  const alias = modelRef.split("/").pop() || modelRef;
  return {
    [modelRef]: { alias },
  };
}

function normalizeProviderModelRef(provider: string, modelRef?: string): string | undefined {
  const trimmed = modelRef?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.includes("/") ? trimmed : `${provider}/${trimmed}`;
}

export function buildConfiguredAgentModelCatalog(
  config: DeployConfig,
  primaryModelRef: string,
): Record<string, { alias: string }> {
  const catalog = buildDefaultAgentModelCatalog(primaryModelRef);
  const configuredModels = [
    {
      ref: normalizeProviderModelRef(
        "anthropic",
        config.anthropicModel || ((config.anthropicApiKey || config.anthropicApiKeyRef) ? "claude-sonnet-4-6" : undefined),
      ),
      alias: config.anthropicModel?.trim() || "claude-sonnet-4-6",
    },
    {
      ref: normalizeProviderModelRef(
        "openai",
        config.openaiModel || ((config.openaiApiKey || config.openaiApiKeyRef) ? "gpt-5.4" : undefined),
      ),
      alias: config.openaiModel?.trim() || "gpt-5.4",
    },
    {
      ref: normalizeProviderModelRef(CUSTOM_ENDPOINT_PROVIDER, config.modelEndpointModel),
      alias: config.modelEndpointModelLabel?.trim() || config.modelEndpointModel?.trim() || undefined,
    },
  ];
  for (const { ref, alias } of configuredModels) {
    const modelRef = ref;
    if (!modelRef) {
      continue;
    }
    catalog[modelRef] = { alias: alias || modelRef.split("/").pop() || modelRef };
  }
  for (const option of config.modelEndpointModels || []) {
    const id = String(option.id || "").trim();
    if (!id) {
      continue;
    }
    const ref = `${CUSTOM_ENDPOINT_PROVIDER}/${id}`;
    const alias = String(option.name || "").trim() || id;
    catalog[ref] = { alias };
  }
  return catalog;
}

function buildAgentModelConfig(config: DeployConfig, primaryModelRef: string): { primary: string; fallbacks?: string[] } {
  const fallbacks = (config.modelFallbacks || [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== primaryModelRef);
  return fallbacks.length > 0
    ? { primary: primaryModelRef, fallbacks }
    : { primary: primaryModelRef };
}

export function deriveModel(config: DeployConfig): string {
  if (config.agentModel) return normalizeModelRef(config, config.agentModel);
  if (config.inferenceProvider === "anthropic") return "anthropic/claude-sonnet-4-6";
  if (config.inferenceProvider === "openai") return "openai/gpt-5.4";
  if (config.inferenceProvider === "custom-endpoint") {
    return config.modelEndpointModel?.trim()
      ? normalizeModelRef(config, config.modelEndpointModel)
      : `${CUSTOM_ENDPOINT_PROVIDER}/default`;
  }
  if (config.inferenceProvider === "vertex-anthropic") {
    return config.litellmProxy ? `litellm/${litellmModelName(config)}` : "anthropic-vertex/claude-sonnet-4-6";
  }
  if (config.inferenceProvider === "vertex-google") {
    return config.litellmProxy ? `litellm/${litellmModelName(config)}` : "google-vertex/gemini-2.5-pro";
  }
  if (config.vertexEnabled && shouldUseLitellmProxy(config)) {
    return `litellm/${litellmModelName(config)}`;
  }
  if (config.vertexEnabled) {
    return config.vertexProvider === "anthropic"
      ? "anthropic-vertex/claude-sonnet-4-6"
      : "google-vertex/gemini-2.5-pro";
  }
  if (config.openaiApiKey || config.openaiApiKeyRef) return "openai/gpt-5.4";
  if (config.modelEndpoint) {
    return config.modelEndpointModel?.trim()
      ? normalizeProviderModelRef(CUSTOM_ENDPOINT_PROVIDER, config.modelEndpointModel) || `${CUSTOM_ENDPOINT_PROVIDER}/default`
      : `${CUSTOM_ENDPOINT_PROVIDER}/default`;
  }
  if (config.anthropicApiKey || config.anthropicApiKeyRef) return "anthropic/claude-sonnet-4-6";
  return "anthropic/claude-sonnet-4-6";
}

function subagentConfig(policy?: string): { allowAgents: string[] } {
  switch (policy) {
    case "self": return { allowAgents: ["self"] };
    case "unrestricted": return { allowAgents: ["*"] };
    default: return { allowAgents: [] };
  }
}

function cloneSecretRef(ref: DeploySecretRef): Record<string, string> {
  return {
    source: ref.source,
    provider: ref.provider,
    id: ref.id,
  };
}

function hasSecretRef(ref?: DeploySecretRef): ref is DeploySecretRef {
  return Boolean(ref?.source && ref.provider.trim() && ref.id.trim());
}

function parseSecretProvidersJson(raw?: string): Record<string, unknown> | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Validation happens in the route; config generation just ignores invalid input.
  }
  return undefined;
}

function shouldAutoEnvRef(config: DeployConfig, explicitRef: DeploySecretRef | undefined, value: string | undefined): boolean {
  return config.mode !== "local" && !hasSecretRef(explicitRef) && Boolean(value?.trim());
}

function envSecretRef(id: string): DeploySecretRef {
  return {
    source: "env",
    provider: "default",
    id,
  };
}

function attachSecretHandlingConfig(ocConfig: Record<string, unknown>, config: DeployConfig): void {
  const providers = parseSecretProvidersJson(config.secretsProvidersJson) || {};
  let shouldDefineDefaultEnvProvider = false;

  const models = (ocConfig.models as Record<string, unknown> | undefined) || {};
  const providersMap = (models.providers as Record<string, unknown> | undefined) || {};

  const openaiApiKeyRef = hasSecretRef(config.openaiApiKeyRef)
    ? config.openaiApiKeyRef
    : shouldAutoEnvRef(config, config.openaiApiKeyRef, config.openaiApiKey)
      ? envSecretRef("OPENAI_API_KEY")
      : undefined;
  const modelEndpointApiKeyRef = config.modelEndpointApiKey ? envSecretRef("MODEL_ENDPOINT_API_KEY") : undefined;
  if (openaiApiKeyRef) {
    if (openaiApiKeyRef.source === "env" && openaiApiKeyRef.provider === "default") {
      shouldDefineDefaultEnvProvider = true;
    }
  }
  if (modelEndpointApiKeyRef) {
    shouldDefineDefaultEnvProvider = true;
  }
  if (config.modelEndpoint?.trim()) {
    const providerApiKeyRef = modelEndpointApiKeyRef || openaiApiKeyRef;
    const endpointProvider: Record<string, unknown> = {
      ...((providersMap[CUSTOM_ENDPOINT_PROVIDER] as Record<string, unknown> | undefined) || {}),
      baseUrl: config.modelEndpoint.trim(),
      api: "openai-completions",
      models: Array.isArray((providersMap[CUSTOM_ENDPOINT_PROVIDER] as Record<string, unknown> | undefined)?.models)
        ? (providersMap[CUSTOM_ENDPOINT_PROVIDER] as Record<string, unknown>).models
        : [],
    };
    if (providerApiKeyRef) {
      endpointProvider.apiKey = cloneSecretRef(providerApiKeyRef);
    }
    if (config.modelEndpointModel?.trim()) {
      const modelId = config.modelEndpointModel.trim();
      endpointProvider.models = [{ id: modelId, name: config.modelEndpointModelLabel?.trim() || modelId }];
    }
    const extraModels = (config.modelEndpointModels || [])
      .map((option) => ({
        id: String(option.id || "").trim(),
        name: String(option.name || "").trim() || String(option.id || "").trim(),
      }))
      .filter((option) => option.id.length > 0);
    if (extraModels.length > 0) {
      const merged = new Map<string, DeployModelOption>();
      for (const option of Array.isArray(endpointProvider.models) ? endpointProvider.models as DeployModelOption[] : []) {
        const id = String(option.id || "").trim();
        if (id) {
          merged.set(id, { id, name: String(option.name || "").trim() || id });
        }
      }
      for (const option of extraModels) {
        merged.set(option.id, option);
      }
      endpointProvider.models = Array.from(merged.values());
    }
    providersMap[CUSTOM_ENDPOINT_PROVIDER] = endpointProvider;
  }

  if (Object.keys(providersMap).length > 0) {
    models.providers = providersMap;
    ocConfig.models = models;
  }

  const telegramBotTokenRef = hasSecretRef(config.telegramBotTokenRef)
    ? config.telegramBotTokenRef
    : shouldAutoEnvRef(config, config.telegramBotTokenRef, config.telegramBotToken)
      ? envSecretRef("TELEGRAM_BOT_TOKEN")
      : undefined;
  if (telegramBotTokenRef) {
    if (telegramBotTokenRef.source === "env" && telegramBotTokenRef.provider === "default") {
      shouldDefineDefaultEnvProvider = true;
    }
    const channels = (ocConfig.channels as Record<string, unknown> | undefined) || {};
    const telegram = (channels.telegram as Record<string, unknown> | undefined) || {};
    telegram.botToken = cloneSecretRef(telegramBotTokenRef);
    channels.telegram = telegram;
    ocConfig.channels = channels;
  }

  if (shouldDefineDefaultEnvProvider && !("default" in providers)) {
    providers.default = { source: "env" };
  }
  if (Object.keys(providers).length > 0) {
    ocConfig.secrets = { providers };
  }
}

export function buildOpenClawConfig(config: DeployConfig, gatewayToken: string): object {
  const id = agentId(config);
  const model = deriveModel(config);
  const openaiCompatibleEndpointsEnabled = config.openaiCompatibleEndpointsEnabled !== false;
  const sourceBundle = loadAgentSourceBundle(config);
  const controlUi: Record<string, unknown> = {
    enabled: true,
  };
  controlUi.allowedOrigins = ["http://localhost:18789"];
  const useOtel = shouldUseOtel(config);
  const ocConfig: Record<string, unknown> = {
    // Enable diagnostics-otel plugin so the gateway emits OTLP traces
    ...(useOtel ? {
      plugins: {
        allow: ["diagnostics-otel"],
        entries: { "diagnostics-otel": { enabled: true } },
      },
      diagnostics: {
        enabled: true,
        otel: {
          enabled: true,
          endpoint: `http://localhost:${OTEL_HTTP_PORT}`,
          traces: true,
          metrics: true,
          logs: false,
        },
      },
    } : {}),
    gateway: {
      mode: "local",
      auth: { mode: "token", token: gatewayToken },
      http: {
        endpoints: {
          chatCompletions: { enabled: openaiCompatibleEndpointsEnabled },
          responses: { enabled: openaiCompatibleEndpointsEnabled },
        },
      },
      controlUi,
    },
    agents: {
      defaults: {
        workspace: "~/.openclaw/workspace",
        model: buildAgentModelConfig(config, model),
        models: buildConfiguredAgentModelCatalog(config, model),
        ...(buildSandboxConfig(config) ? { sandbox: buildSandboxConfig(config) } : {}),
      },
      list: [
        {
          id,
          name: config.agentDisplayName || config.agentName,
          identity: { name: config.agentDisplayName || config.agentName },
          workspace: `~/.openclaw/workspace-${id}`,
          model: buildAgentModelConfig(config, model),
          subagents: sourceBundle?.mainAgent?.subagents || subagentConfig(config.subagentPolicy),
          ...(sourceBundle?.mainAgent?.tools ? { tools: sourceBundle.mainAgent.tools } : {}),
        },
        ...((sourceBundle?.agents || []).map((entry) => ({
          id: entry.id,
          name: entry.name || entry.id,
          ...(entry.name ? { identity: { name: entry.name } } : {}),
          workspace: `~/.openclaw/workspace-${entry.id}`,
          model: entry.model || { primary: model },
          ...(entry.subagents ? { subagents: entry.subagents } : {}),
          ...(entry.tools ? { tools: entry.tools } : {}),
        }))),
      ],
    },
    ...(shouldUseLitellmProxy(config) ? {
      models: {
        providers: {
          litellm: {
            baseUrl: `http://localhost:${LITELLM_PORT}/v1`,
            api: "openai-completions",
            models: [
              { id: litellmModelName(config), name: litellmModelName(config) },
            ],
          },
        },
      },
    } : {}),
    skills: {
      load: { extraDirs: ["~/.openclaw/skills"], watch: true, watchDebounceMs: 1000 },
    },
    cron: { enabled: !!config.cronEnabled },
  };

  const sandboxToolPolicy = buildSandboxToolPolicy(config);
  if (sandboxToolPolicy) {
    ocConfig.tools = sandboxToolPolicy;
  }

  if ((config.telegramBotToken || config.telegramBotTokenRef) && config.telegramAllowFrom) {
    const allowFrom = config.telegramAllowFrom
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    ocConfig.channels = { telegram: { dmPolicy: "allowlist", allowFrom } };
  }

  attachSecretHandlingConfig(ocConfig, config);

  return ocConfig;
}
