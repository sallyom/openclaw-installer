import process from "node:process";
import { randomBytes } from "node:crypto";
import type { DeployConfig, DeployModelOption, DeploySecretRef } from "./types.js";
import { shouldUseLitellmProxy, litellmModelName, litellmRegisteredModelNames, LITELLM_PORT } from "./litellm.js";
import { shouldUseOtel, OTEL_HTTP_PORT } from "./otel.js";
import { shouldUseChromiumSidecar, CHROMIUM_CDP_PORT } from "./chromium.js";
import { buildSandboxConfig } from "./sandbox.js";
import { buildSandboxToolPolicy } from "./tool-policy.js";
import { loadAgentSourceBundle, loadAgentSourceMcpServers } from "./agent-source.js";
import type { AgentSourceBundle } from "./agent-source.js";
import { normalizeManagedVaultProviders } from "./vault-helper.js";
import { hasPodmanSecretTarget } from "../../shared/podman-secrets.js";

export const DEFAULT_IMAGE = process.env.OPENCLAW_IMAGE || "ghcr.io/openclaw/openclaw:latest";
export const DEFAULT_VERTEX_IMAGE = process.env.OPENCLAW_VERTEX_IMAGE || DEFAULT_IMAGE;
export const CUSTOM_ENDPOINT_PROVIDER = "endpoint";
export const GOOGLE_PROVIDER = "google";
export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const OPENROUTER_PROVIDER = "openrouter";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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

export function resolveEnvSecretRefId(ref: DeploySecretRef | undefined, fallbackId: string): string | undefined {
  if (!ref) {
    return fallbackId;
  }
  return usesDefaultEnvSecretRef(ref) ? ref.id.trim() : undefined;
}

export function normalizeModelRef(config: DeployConfig, modelRef: string): string {
  const trimmed = modelRef.trim();
  if (!trimmed) return trimmed;
  if (config.inferenceProvider === OPENROUTER_PROVIDER) {
    return trimmed.startsWith(`${OPENROUTER_PROVIDER}/`) ? trimmed : `${OPENROUTER_PROVIDER}/${trimmed}`;
  }
  if (trimmed.includes("/")) return trimmed;

  if (config.inferenceProvider === "anthropic") return `anthropic/${trimmed}`;
  if (config.inferenceProvider === "openai") {
    return `openai/${trimmed}`;
  }
  if (config.inferenceProvider === GOOGLE_PROVIDER) {
    return `${GOOGLE_PROVIDER}/${trimmed}`;
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
  if (provider === OPENROUTER_PROVIDER) {
    return trimmed.startsWith(`${OPENROUTER_PROVIDER}/`) ? trimmed : `${OPENROUTER_PROVIDER}/${trimmed}`;
  }
  return trimmed.includes("/") ? trimmed : `${provider}/${trimmed}`;
}

function hasLocalProviderSecret(config: DeployConfig, envVar: string): boolean {
  return config.mode === "local" && hasPodmanSecretTarget(config.podmanSecretMappings, envVar);
}

export function buildConfiguredAgentModelCatalog(
  config: DeployConfig,
  primaryModelRef: string,
  sourceBundle?: AgentSourceBundle,
): Record<string, { alias: string }> {
  const catalog = buildDefaultAgentModelCatalog(primaryModelRef);
  const configuredModels = [
    {
      ref: normalizeProviderModelRef(
        "anthropic",
        config.anthropicModel
          || ((config.anthropicApiKey || config.anthropicApiKeyRef || hasLocalProviderSecret(config, "ANTHROPIC_API_KEY"))
            ? "claude-sonnet-4-6"
            : undefined),
      ),
      alias: config.anthropicModel?.trim() || "claude-sonnet-4-6",
    },
    {
      ref: normalizeProviderModelRef(
        "openai",
        config.openaiModel
          || ((config.openaiApiKey || config.openaiApiKeyRef || hasLocalProviderSecret(config, "OPENAI_API_KEY"))
            ? "gpt-5.4"
            : undefined),
      ),
      alias: config.openaiModel?.trim() || "gpt-5.4",
    },
    {
      ref: normalizeProviderModelRef(
        GOOGLE_PROVIDER,
        config.googleModel
          || ((config.googleApiKey || config.googleApiKeyRef || hasLocalProviderSecret(config, "GEMINI_API_KEY") || hasLocalProviderSecret(config, "GOOGLE_API_KEY"))
            ? "gemini-3.1-pro-preview"
            : undefined),
      ),
      alias: config.googleModel?.trim() || "gemini-3.1-pro-preview",
    },
    {
      ref: normalizeProviderModelRef(
        OPENROUTER_PROVIDER,
        config.openrouterModel
          || ((config.openrouterApiKey || config.openrouterApiKeyRef || hasLocalProviderSecret(config, "OPENROUTER_API_KEY"))
            ? "auto"
            : undefined),
      ),
      alias: config.openrouterModel?.trim() || "auto",
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
  for (const modelId of config.anthropicModels || []) {
    const trimmed = modelId.trim();
    if (!trimmed) continue;
    const ref = trimmed.includes("/") ? trimmed : `anthropic/${trimmed}`;
    catalog[ref] = { alias: trimmed };
  }
  for (const modelId of config.openaiModels || []) {
    const trimmed = modelId.trim();
    if (!trimmed) continue;
    const ref = trimmed.includes("/") ? trimmed : `openai/${trimmed}`;
    catalog[ref] = { alias: trimmed };
  }
  for (const modelId of config.googleModels || []) {
    const trimmed = modelId.trim();
    if (!trimmed) continue;
    const ref = trimmed.includes("/") ? trimmed : `${GOOGLE_PROVIDER}/${trimmed}`;
    catalog[ref] = { alias: trimmed };
  }
  for (const modelId of config.openrouterModels || []) {
    const trimmed = modelId.trim();
    if (!trimmed) continue;
    const ref = trimmed.startsWith(`${OPENROUTER_PROVIDER}/`) ? trimmed : `${OPENROUTER_PROVIDER}/${trimmed}`;
    catalog[ref] = { alias: trimmed };
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
  for (const modelId of config.vertexAnthropicModels || []) {
    const trimmed = modelId.trim();
    if (!trimmed) continue;
    const ref = shouldUseLitellmProxy(config) ? `litellm/${trimmed}` : `anthropic-vertex/${trimmed}`;
    catalog[ref] = { alias: trimmed };
  }
  for (const modelId of config.vertexGoogleModels || []) {
    const trimmed = modelId.trim();
    if (!trimmed) continue;
    const ref = shouldUseLitellmProxy(config) ? `litellm/${trimmed}` : `google-vertex/${trimmed}`;
    catalog[ref] = { alias: trimmed };
  }
  const bundleModelRefs = new Set<string>();
  const collectModelRefs = (model?: { primary?: string; fallbacks?: string[] }) => {
    const primary = model?.primary?.trim();
    if (primary) {
      bundleModelRefs.add(primary);
    }
    for (const fallback of model?.fallbacks || []) {
      const trimmed = fallback.trim();
      if (trimmed) {
        bundleModelRefs.add(trimmed);
      }
    }
  };
  collectModelRefs(sourceBundle?.mainAgent?.model);
  for (const entry of sourceBundle?.agents || []) {
    collectModelRefs(entry.model);
  }
  for (const modelRef of bundleModelRefs) {
    if (detectUnavailableProvider(modelRef, config)) {
      continue;
    }
    if (!(modelRef in catalog)) {
      catalog[modelRef] = { alias: modelRef.split("/").pop() || modelRef };
    }
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
  if (config.inferenceProvider === "anthropic") {
    return `anthropic/${config.anthropicModel?.trim() || "claude-sonnet-4-6"}`;
  }
  if (config.inferenceProvider === "openai") {
    return `openai/${config.openaiModel?.trim() || "gpt-5.4"}`;
  }
  if (config.inferenceProvider === GOOGLE_PROVIDER) {
    return `${GOOGLE_PROVIDER}/${config.googleModel?.trim() || "gemini-3.1-pro-preview"}`;
  }
  if (config.inferenceProvider === OPENROUTER_PROVIDER) {
    return normalizeProviderModelRef(OPENROUTER_PROVIDER, config.openrouterModel) || `${OPENROUTER_PROVIDER}/auto`;
  }
  if (config.inferenceProvider === "custom-endpoint") {
    return config.modelEndpointModel?.trim()
      ? normalizeModelRef(config, config.modelEndpointModel)
      : `${CUSTOM_ENDPOINT_PROVIDER}/default`;
  }
  if (config.inferenceProvider === "vertex-anthropic") {
    const model = config.vertexAnthropicModel?.trim() || config.agentModel?.trim() || "claude-sonnet-4-6";
    return config.litellmProxy ? `litellm/${model}` : `anthropic-vertex/${model}`;
  }
  if (config.inferenceProvider === "vertex-google") {
    const model = config.vertexGoogleModel?.trim() || config.agentModel?.trim() || "gemini-2.5-pro";
    return config.litellmProxy ? `litellm/${model}` : `google-vertex/${model}`;
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
  if (config.googleApiKey || config.googleApiKeyRef) return `${GOOGLE_PROVIDER}/gemini-3.1-pro-preview`;
  if (config.openrouterApiKey || config.openrouterApiKeyRef) return `${OPENROUTER_PROVIDER}/auto`;
  if (config.modelEndpoint) {
    return config.modelEndpointModel?.trim()
      ? normalizeProviderModelRef(CUSTOM_ENDPOINT_PROVIDER, config.modelEndpointModel) || `${CUSTOM_ENDPOINT_PROVIDER}/default`
      : `${CUSTOM_ENDPOINT_PROVIDER}/default`;
  }
  if (config.anthropicApiKey || config.anthropicApiKeyRef) return "anthropic/claude-sonnet-4-6";
  return "anthropic/claude-sonnet-4-6";
}

/**
 * Resolve the model config for a bundle subagent.  The bundle's declared model
 * takes precedence, but the deploy-time model is appended as a fallback so
 * there is always a working option even when the bundle's preferred provider
 * isn't configured.  (Fix for #67)
 */
export function resolveSubagentModel(
  entryModel: { primary?: string; fallbacks?: string[] } | undefined,
  deployModel: string,
  config?: DeployConfig,
): { primary: string; fallbacks?: string[] } {
  if (!entryModel?.primary) {
    const fallbacks = [...(entryModel?.fallbacks || [])]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry !== deployModel);
    return fallbacks.length > 0
      ? { primary: deployModel, fallbacks }
      : { primary: deployModel };
  }

  const primary = entryModel.primary.trim();
  const normalizedFallbacks = [...(entryModel.fallbacks || [])]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (config && detectUnavailableProvider(primary, config)) {
    const fallbacks = [primary, ...normalizedFallbacks]
      .filter((entry, index, all) => entry !== deployModel && all.indexOf(entry) === index);
    return fallbacks.length > 0
      ? { primary: deployModel, fallbacks }
      : { primary: deployModel };
  }

  const fallbacks = [...normalizedFallbacks];

  if (primary !== deployModel && !fallbacks.includes(deployModel)) {
    fallbacks.push(deployModel);
  }

  return fallbacks.length > 0
    ? { primary, fallbacks }
    : { primary };
}

/**
 * Check whether a model ref's provider appears to be unavailable given the
 * current deploy config.  Returns true when the provider likely won't work,
 * used to emit deploy-time warnings.  (Fix for #67)
 */
export function detectUnavailableProvider(
  modelRef: string,
  config: DeployConfig,
): boolean {
  const provider = modelRef.split("/")[0];
  if (!provider) return false;

  switch (provider) {
    case "anthropic":
      return !config.anthropicApiKey && !config.anthropicApiKeyRef
        && config.inferenceProvider !== "anthropic";
    case "openai":
      return !config.openaiApiKey && !config.openaiApiKeyRef
        && config.inferenceProvider !== "openai";
    case GOOGLE_PROVIDER:
      return !config.googleApiKey && !config.googleApiKeyRef
        && config.inferenceProvider !== GOOGLE_PROVIDER;
    case OPENROUTER_PROVIDER:
      return !config.openrouterApiKey && !config.openrouterApiKeyRef
        && config.inferenceProvider !== OPENROUTER_PROVIDER;
    case "anthropic-vertex":
      return !config.vertexEnabled
        || (config.vertexProvider !== "anthropic" && config.inferenceProvider !== "vertex-anthropic");
    case "google-vertex":
      return !config.vertexEnabled
        || (config.vertexProvider !== "google" && config.inferenceProvider !== "vertex-google");
    case "endpoint":
      return !config.modelEndpoint?.trim();
    case "litellm":
      return !shouldUseLitellmProxy(config);
    default:
      return false;
  }
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
  return normalizeManagedVaultProviders(raw);
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

export function resolveEffectiveAnthropicApiKeyRef(config: DeployConfig): DeploySecretRef | undefined {
  return hasSecretRef(config.anthropicApiKeyRef)
    ? config.anthropicApiKeyRef
    : shouldAutoEnvRef(config, config.anthropicApiKeyRef, config.anthropicApiKey)
      ? envSecretRef("ANTHROPIC_API_KEY")
      : undefined;
}

export function resolveEffectiveOpenAiApiKeyRef(config: DeployConfig): DeploySecretRef | undefined {
  return hasSecretRef(config.openaiApiKeyRef)
    ? config.openaiApiKeyRef
    : shouldAutoEnvRef(config, config.openaiApiKeyRef, config.openaiApiKey)
      ? envSecretRef("OPENAI_API_KEY")
      : undefined;
}

export function resolveEffectiveGoogleApiKeyRef(config: DeployConfig): DeploySecretRef | undefined {
  return hasSecretRef(config.googleApiKeyRef)
    ? config.googleApiKeyRef
    : shouldAutoEnvRef(config, config.googleApiKeyRef, config.googleApiKey)
      ? envSecretRef("GEMINI_API_KEY")
      : undefined;
}

export function resolveEffectiveOpenRouterApiKeyRef(config: DeployConfig): DeploySecretRef | undefined {
  return hasSecretRef(config.openrouterApiKeyRef)
    ? config.openrouterApiKeyRef
    : shouldAutoEnvRef(config, config.openrouterApiKeyRef, config.openrouterApiKey)
      ? envSecretRef("OPENROUTER_API_KEY")
      : undefined;
}

export function buildManagedAgentAuthProfiles(config: DeployConfig): {
  version: 1;
  profiles: Record<string, Record<string, unknown>>;
} | undefined {
  const profiles: Record<string, Record<string, unknown>> = {};
  const anthropicRef = resolveEffectiveAnthropicApiKeyRef(config);
  const openaiRef = resolveEffectiveOpenAiApiKeyRef(config);
  const googleRef = resolveEffectiveGoogleApiKeyRef(config);
  const openrouterRef = resolveEffectiveOpenRouterApiKeyRef(config);

  if (anthropicRef) {
    profiles["anthropic:default"] = {
      type: "api_key",
      provider: "anthropic",
      keyRef: cloneSecretRef(anthropicRef),
    };
  }
  if (openaiRef) {
    profiles["openai:default"] = {
      type: "api_key",
      provider: "openai",
      keyRef: cloneSecretRef(openaiRef),
    };
  }
  if (googleRef) {
    profiles["google:default"] = {
      type: "api_key",
      provider: GOOGLE_PROVIDER,
      keyRef: cloneSecretRef(googleRef),
    };
  }
  if (openrouterRef) {
    profiles["openrouter:default"] = {
      type: "api_key",
      provider: OPENROUTER_PROVIDER,
      keyRef: cloneSecretRef(openrouterRef),
    };
  }

  return Object.keys(profiles).length > 0
    ? {
        version: 1,
        profiles,
      }
    : undefined;
}

function attachSecretHandlingConfig(ocConfig: Record<string, unknown>, config: DeployConfig): void {
  const providers = parseSecretProvidersJson(config.secretsProvidersJson) || {};
  let shouldDefineDefaultEnvProvider = false;

  const models = (ocConfig.models as Record<string, unknown> | undefined) || {};
  const providersMap = (models.providers as Record<string, unknown> | undefined) || {};

  const openaiApiKeyRef = resolveEffectiveOpenAiApiKeyRef(config);
  const googleApiKeyRef = resolveEffectiveGoogleApiKeyRef(config);
  const openrouterApiKeyRef = resolveEffectiveOpenRouterApiKeyRef(config);
  const modelEndpointApiKeyRef = hasSecretRef(config.modelEndpointApiKeyRef)
    ? config.modelEndpointApiKeyRef
    : config.modelEndpointApiKey
      ? envSecretRef("MODEL_ENDPOINT_API_KEY")
      : undefined;
  if (openaiApiKeyRef) {
    if (openaiApiKeyRef.source === "env" && openaiApiKeyRef.provider === "default") {
      shouldDefineDefaultEnvProvider = true;
    }
  }
  if (googleApiKeyRef) {
    if (googleApiKeyRef.source === "env" && googleApiKeyRef.provider === "default") {
      shouldDefineDefaultEnvProvider = true;
    }
    const googleProvider: Record<string, unknown> = {
      ...((providersMap[GOOGLE_PROVIDER] as Record<string, unknown> | undefined) || {}),
      baseUrl: GOOGLE_BASE_URL,
      api: "google-generative-ai",
      apiKey: cloneSecretRef(googleApiKeyRef),
    };
    const googleModels = new Map<string, DeployModelOption>();
    const addGoogleModel = (modelId?: string) => {
      const trimmed = String(modelId || "").trim();
      if (!trimmed) return;
      const id = trimmed.startsWith(`${GOOGLE_PROVIDER}/`) ? trimmed.slice(`${GOOGLE_PROVIDER}/`.length) : trimmed;
      googleModels.set(id, { id, name: id });
    };
    addGoogleModel(config.googleModel || "gemini-3.1-pro-preview");
    for (const modelId of config.googleModels || []) {
      addGoogleModel(modelId);
    }
    if (googleModels.size > 0) {
      googleProvider.models = Array.from(googleModels.values());
    }
    providersMap[GOOGLE_PROVIDER] = googleProvider;
  }
  if (modelEndpointApiKeyRef) {
    shouldDefineDefaultEnvProvider = true;
  }
  if (openrouterApiKeyRef) {
    if (openrouterApiKeyRef.source === "env" && openrouterApiKeyRef.provider === "default") {
      shouldDefineDefaultEnvProvider = true;
    }
    const openrouterProvider: Record<string, unknown> = {
      ...((providersMap[OPENROUTER_PROVIDER] as Record<string, unknown> | undefined) || {}),
      baseUrl: OPENROUTER_BASE_URL,
      api: "openai-completions",
      apiKey: cloneSecretRef(openrouterApiKeyRef),
    };
    const openrouterModels = new Map<string, DeployModelOption>();
    const addOpenrouterModel = (modelId?: string) => {
      const trimmed = String(modelId || "").trim();
      if (!trimmed) return;
      const id = trimmed.startsWith(`${OPENROUTER_PROVIDER}/`) ? trimmed.slice(`${OPENROUTER_PROVIDER}/`.length) : trimmed;
      openrouterModels.set(id, { id, name: id });
    };
    addOpenrouterModel(config.openrouterModel || "auto");
    for (const modelId of config.openrouterModels || []) {
      addOpenrouterModel(modelId);
    }
    if (openrouterModels.size > 0) {
      openrouterProvider.models = Array.from(openrouterModels.values());
    }
    providersMap[OPENROUTER_PROVIDER] = openrouterProvider;
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
  const pluginAllowlist = Array.from(new Set<string>([
    ...(shouldUseOtel(config) ? ["diagnostics-otel"] : []),
    ...((config.telegramBotToken || config.telegramBotTokenRef) ? ["telegram"] : []),
  ]));
  const controlUi: Record<string, unknown> = {
    enabled: true,
  };
  controlUi.allowedOrigins = ["http://localhost:18789"];
  const useOtel = shouldUseOtel(config);
  const ocConfig: Record<string, unknown> = {
    plugins: {
      ...(pluginAllowlist.length > 0 ? { allow: pluginAllowlist } : {}),
      entries: {
        acpx: { enabled: false },
        ...(useOtel ? { "diagnostics-otel": { enabled: true } } : {}),
      },
    },
    // Enable diagnostics-otel plugin so the gateway emits OTLP traces
    ...(useOtel ? {
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
        models: buildConfiguredAgentModelCatalog(config, model, sourceBundle),
        ...(buildSandboxConfig(config) ? { sandbox: buildSandboxConfig(config) } : {}),
      },
      list: [
        {
          id,
          name: config.agentDisplayName || config.agentName,
          identity: { name: config.agentDisplayName || config.agentName },
          workspace: `~/.openclaw/workspace-${id}`,
          model: sourceBundle?.mainAgent?.model
            ? resolveSubagentModel(sourceBundle.mainAgent.model, model, config)
            : buildAgentModelConfig(config, model),
          subagents: sourceBundle?.mainAgent?.subagents || subagentConfig(config.subagentPolicy),
          ...(sourceBundle?.mainAgent?.tools ? { tools: sourceBundle.mainAgent.tools } : {}),
        },
        // Fix for #67: append deploy-time model as fallback for bundle subagents
        ...((sourceBundle?.agents || []).map((entry) => ({
          id: entry.id,
          name: entry.name || entry.id,
          ...(entry.name ? { identity: { name: entry.name } } : {}),
          workspace: `~/.openclaw/workspace-${entry.id}`,
          model: resolveSubagentModel(entry.model, model, config),
          ...(entry.subagents ? { subagents: entry.subagents } : {}),
          ...(entry.tools ? { tools: entry.tools } : {}),
        }))),
      ],
    },
    // Fix for #78: register all LiteLLM models (primary + secondary providers)
    // in the provider listing.  Exclude the primary model since it is already
    // in agents.defaults.models via buildDefaultAgentModelCatalog, avoiding a
    // duplicate entry in the UI dropdown.
    ...(shouldUseLitellmProxy(config) ? {
      models: {
        providers: {
          litellm: {
            baseUrl: `http://localhost:${LITELLM_PORT}/v1`,
            api: "openai-completions",
            models: litellmRegisteredModelNames(config)
              .filter((name) => name !== litellmModelName(config))
              .map((name) => ({ id: name, name })),
          },
        },
      },
    } : {}),
    skills: {
      load: { extraDirs: ["~/.openclaw/skills"], watch: true, watchDebounceMs: 1000 },
    },
    cron: { enabled: !!config.cronEnabled },
  };

  // Add browser config for Chromium sidecar
  if (shouldUseChromiumSidecar(config)) {
    ocConfig.browser = {
      enabled: true,
      defaultProfile: "openclaw",
      profiles: {
        openclaw: {
          cdpUrl: `http://localhost:${CHROMIUM_CDP_PORT}`,
          attachOnly: true,
          color: "#4285F4",
        },
      },
    };
  }

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

  const mcpServers = loadAgentSourceMcpServers(config.agentSourceDir);
  if (mcpServers) {
    ocConfig.mcp = { servers: mcpServers };
  }

  attachSecretHandlingConfig(ocConfig, config);

  return ocConfig;
}
