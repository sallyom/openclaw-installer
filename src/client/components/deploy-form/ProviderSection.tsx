import React, { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  MODEL_DEFAULTS,
  PROVIDER_OPTIONS,
} from "./constants.js";
import type {
  DeployFormConfig,
  GcpDefaults,
  InferenceProvider,
  ModelEndpointOption,
  ServerDefaults,
} from "./types.js";

interface ProviderSectionProps {
  config: DeployFormConfig;
  defaults: ServerDefaults | null;
  fetchModelEndpointOptions: () => Promise<void>;
  gcpDefaults: GcpDefaults | null;
  inferenceProvider: InferenceProvider;
  loadingModelEndpointOptions: boolean;
  mode: string;
  modelEndpointOptions: ModelEndpointOption[];
  modelEndpointOptionsError: string | null;
  loadingAnthropicModels: boolean;
  loadingOpenaiModels: boolean;
  anthropicModelOptions: Array<{ id: string; name: string }>;
  openaiModelOptions: Array<{ id: string; name: string }>;
  anthropicModelsError: string | null;
  openaiModelsError: string | null;
  loadingVertexAnthropicModels: boolean;
  vertexAnthropicModelOptions: Array<{ id: string; name: string }>;
  vertexAnthropicModelsError: string | null;
  vertexAnthropicModelsWarning: string | null;
  loadingVertexGoogleModels: boolean;
  vertexGoogleModelOptions: Array<{ id: string; name: string }>;
  vertexGoogleModelsError: string | null;
  vertexGoogleModelsWarning: string | null;
  setConfig: Dispatch<SetStateAction<DeployFormConfig>>;
  setInferenceProvider: Dispatch<SetStateAction<InferenceProvider>>;
  update: (field: string, value: string) => void;
}

interface AdditionalProvider {
  id: number;
  provider: InferenceProvider | "";
}

type ProviderModelOption = { id: string; name: string };

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.5rem",
};

function secretInputPreferenceHint(mode: string): string {
  if (mode === "local") {
    return "Prefer Podman secret mappings and SecretRefs for local deploys. Leave this blank when the key is injected via Podman secrets.";
  }
  return "Optional. If provided here, the installer stores it in the managed Kubernetes Secret. Leave this blank when using an external SecretRef provider.";
}

const CURATED_MODEL_OPTIONS: Partial<Record<InferenceProvider, Array<{ id: string; name: string }>>> = {
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
  ],
  google: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
};

function formatModelOptionLabel(option: ProviderModelOption): string {
  return option.name === option.id ? option.id : `${option.name} (${option.id})`;
}

function getModelSelectValue(model: string, options: ProviderModelOption[]): string {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    return "";
  }
  return options.some((option) => option.id === trimmedModel) ? trimmedModel : "__custom__";
}

function getCustomModelOptionLabel(model: string, options: ProviderModelOption[]): string {
  const trimmedModel = model.trim();
  if (trimmedModel && !options.some((option) => option.id === trimmedModel)) {
    return `Custom: ${trimmedModel}`;
  }
  return "Custom model ID...";
}

function applyProviderDefaultModel(
  prev: DeployFormConfig,
  provider: InferenceProvider,
): DeployFormConfig {
  switch (provider) {
    case "anthropic":
      return prev.anthropicModel.trim() ? prev : { ...prev, anthropicModel: MODEL_DEFAULTS.anthropic };
    case "openai":
      return prev.openaiModel.trim() ? prev : { ...prev, openaiModel: MODEL_DEFAULTS.openai.replace(/^openai\//, "") };
    case "google":
      return prev.googleModel.trim() ? prev : { ...prev, googleModel: MODEL_DEFAULTS.google.replace(/^google\//, "") };
    case "openrouter":
      return prev.openrouterModel.trim() ? prev : { ...prev, openrouterModel: MODEL_DEFAULTS.openrouter };
    case "vertex-anthropic":
      return prev.vertexAnthropicModel.trim() ? prev : { ...prev, vertexAnthropicModel: "claude-sonnet-4-6" };
    case "vertex-google":
      return prev.vertexGoogleModel.trim() ? prev : { ...prev, vertexGoogleModel: "gemini-2.5-pro" };
    default:
      return prev;
  }
}

export function ProviderSection({
  config,
  defaults,
  fetchModelEndpointOptions,
  gcpDefaults,
  inferenceProvider,
  loadingModelEndpointOptions,
  mode,
  modelEndpointOptions,
  modelEndpointOptionsError,
  loadingAnthropicModels,
  loadingOpenaiModels,
  anthropicModelOptions,
  openaiModelOptions,
  anthropicModelsError,
  openaiModelsError,
  loadingVertexAnthropicModels,
  vertexAnthropicModelOptions,
  vertexAnthropicModelsError,
  vertexAnthropicModelsWarning,
  loadingVertexGoogleModels,
  vertexGoogleModelOptions,
  vertexGoogleModelsError,
  vertexGoogleModelsWarning,
  setConfig,
  setInferenceProvider,
  update,
}: ProviderSectionProps) {
  const [additionalProviders, setAdditionalProviders] = useState<AdditionalProvider[]>([]);
  const nextId = useRef(0);

  const selectedAdditionalProviders = additionalProviders
    .map((ap) => ap.provider)
    .filter((p): p is InferenceProvider => p !== "");

  const allUsedProviders = [inferenceProvider, ...selectedAdditionalProviders];

  const allAdded = additionalProviders.length >= PROVIDER_OPTIONS.length - 1;

  function addProvider() {
    setAdditionalProviders((prev) => [
      ...prev,
      { id: nextId.current++, provider: "" },
    ]);
  }

  function removeProvider(id: number) {
    setAdditionalProviders((prev) => prev.filter((ap) => ap.id !== id));
  }

  function setProviderValue(id: number, provider: InferenceProvider | "") {
    setAdditionalProviders((prev) =>
      prev.map((ap) => (ap.id === id ? { ...ap, provider } : ap)),
    );
    if (!provider) {
      return;
    }
    setConfig((prev) => applyProviderDefaultModel(prev, provider));
  }

  function renderProviderFields(provider: InferenceProvider | "") {
    if (!provider) return null;

    switch (provider) {
      case "anthropic": {
        const visibleAnthropicOptions = anthropicModelOptions.length > 0
          ? anthropicModelOptions
          : CURATED_MODEL_OPTIONS.anthropic || [];
        const additionalAnthropicOptions = visibleAnthropicOptions.filter(
          (option) => option.id !== config.anthropicModel,
        );
        return (
          <>
            <div className="form-group">
              <label>Anthropic API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={defaults?.hasAnthropicKey ? "(using key from environment)" : "sk-ant-..."}
                value={config.anthropicApiKey}
                onChange={(e) => update("anthropicApiKey", e.target.value)}
              />
              <div className="hint">
                {defaults?.hasAnthropicKey
                  ? "Detected ANTHROPIC_API_KEY from server environment — leave blank to use it"
                  : "Saved for Anthropic primary or fallback usage."}
              </div>
              <div className="hint" style={{ marginTop: "0.35rem" }}>
                {secretInputPreferenceHint(mode)}
              </div>
            </div>
            <div className="form-group">
              <label>Anthropic Model</label>
              {loadingAnthropicModels && (
                <div className="hint">Loading models...</div>
              )}
              {anthropicModelsError && (
                <div className="hint" style={{ color: "#e74c3c" }}>{anthropicModelsError}</div>
              )}
              {visibleAnthropicOptions.length > 0 && (
                <select
                  value={getModelSelectValue(config.anthropicModel, visibleAnthropicOptions)}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      if (visibleAnthropicOptions.some((option) => option.id === config.anthropicModel)) {
                        update("anthropicModel", "");
                      }
                      return;
                    }
                    update("anthropicModel", e.target.value);
                  }}
                >
                  <option value="">Select a model...</option>
                  {visibleAnthropicOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {formatModelOptionLabel(option)}
                    </option>
                  ))}
                  <option value="__custom__">
                    {getCustomModelOptionLabel(config.anthropicModel, visibleAnthropicOptions)}
                  </option>
                </select>
              )}
              {anthropicModelOptions.length === 0 && (
                <div className="hint" style={{ marginBottom: "0.5rem" }}>
                  Showing curated Anthropic models. Enter an API key in the form or expose one in server env for a live model list.
                </div>
              )}
              <input
                type="text"
                placeholder="e.g., claude-sonnet-4-6"
                value={config.anthropicModel}
                onChange={(e) => update("anthropicModel", e.target.value)}
              />
              <div className="hint">
                Use the dropdown or enter a custom Anthropic model ID. The primary model is used as <code>anthropic/&lt;model&gt;</code>.
              </div>
            </div>
            <div className="form-group">
              <label>Additional Models</label>
              {additionalAnthropicOptions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.5rem", maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.5rem" }}>
                  {additionalAnthropicOptions.map((option) => (
                    <label key={option.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={config.anthropicModels.includes(option.id)}
                        onChange={() => {
                          setConfig((prev) => ({
                            ...prev,
                            anthropicModels: prev.anthropicModels.includes(option.id)
                              ? prev.anthropicModels.filter((model) => model !== option.id)
                              : [...prev.anthropicModels, option.id],
                          }));
                        }}
                        style={{ width: "auto" }}
                      />
                      <code>{option.id}</code>
                      {option.name !== option.id && <span style={{ color: "var(--text-secondary)" }}>({option.name})</span>}
                    </label>
                  ))}
                </div>
              )}
              {config.anthropicModels.map((modelId, index) => (
                <div key={index} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                  <input
                    type="text"
                    placeholder="e.g., claude-opus-4-6"
                    value={modelId}
                    onChange={(e) => {
                      setConfig((prev) => ({
                        ...prev,
                        anthropicModels: prev.anthropicModels.map((m, i) => i === index ? e.target.value : m),
                      }));
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "0.25rem 0.5rem" }}
                    onClick={() => {
                      setConfig((prev) => ({
                        ...prev,
                        anthropicModels: prev.anthropicModels.filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem" }}
                disabled={!config.anthropicModel.trim()}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    anthropicModels: [...prev.anthropicModels, ""],
                  }));
                }}
              >
                + Add Model
              </button>
              <div className="hint">
                Additional models appear in the OpenClaw model picker as <code>anthropic/&lt;model&gt;</code>.
              </div>
            </div>
          </>
        );
      }

      case "openai": {
        const visibleOpenaiOptions = openaiModelOptions.length > 0
          ? openaiModelOptions
          : CURATED_MODEL_OPTIONS.openai || [];
        const additionalOpenaiOptions = visibleOpenaiOptions.filter(
          (option) => option.id !== config.openaiModel,
        );
        return (
          <>
            <div className="form-group">
              <label>OpenAI API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={defaults?.hasOpenaiKey ? "(using key from environment)" : "sk-..."}
                value={config.openaiApiKey}
                onChange={(e) => update("openaiApiKey", e.target.value)}
              />
              <div className="hint">
                {defaults?.hasOpenaiKey
                  ? "Detected OPENAI_API_KEY from server environment — leave blank to use it"
                  : "Saved for OpenAI primary or fallback usage only."}
              </div>
              <div className="hint" style={{ marginTop: "0.35rem" }}>
                {secretInputPreferenceHint(mode)}
              </div>
            </div>
            <div className="form-group">
              <label>OpenAI Model</label>
              {loadingOpenaiModels && (
                <div className="hint">Loading models...</div>
              )}
              {openaiModelsError && (
                <div className="hint" style={{ color: "#e74c3c" }}>{openaiModelsError}</div>
              )}
              {visibleOpenaiOptions.length > 0 && (
                <select
                  value={getModelSelectValue(config.openaiModel, visibleOpenaiOptions)}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      if (visibleOpenaiOptions.some((option) => option.id === config.openaiModel)) {
                        update("openaiModel", "");
                      }
                      return;
                    }
                    update("openaiModel", e.target.value);
                  }}
                >
                  <option value="">Select a model...</option>
                  {visibleOpenaiOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {formatModelOptionLabel(option)}
                    </option>
                  ))}
                  <option value="__custom__">
                    {getCustomModelOptionLabel(config.openaiModel, visibleOpenaiOptions)}
                  </option>
                </select>
              )}
              {openaiModelOptions.length === 0 && (
                <div className="hint" style={{ marginBottom: "0.5rem" }}>
                  Showing curated OpenAI models. Enter an API key in the form or expose one in server env for a live model list.
                </div>
              )}
              <input
                type="text"
                placeholder="e.g., gpt-5"
                value={config.openaiModel}
                onChange={(e) => update("openaiModel", e.target.value)}
              />
              <div className="hint">
                Use the dropdown or enter a custom OpenAI model ID. The primary model is used as <code>openai/&lt;model&gt;</code>.
              </div>
            </div>
            <div className="form-group">
              <label>Additional Models</label>
              {additionalOpenaiOptions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.5rem", maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.5rem" }}>
                  {additionalOpenaiOptions.map((option) => (
                    <label key={option.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={config.openaiModels.includes(option.id)}
                        onChange={() => {
                          setConfig((prev) => ({
                            ...prev,
                            openaiModels: prev.openaiModels.includes(option.id)
                              ? prev.openaiModels.filter((model) => model !== option.id)
                              : [...prev.openaiModels, option.id],
                          }));
                        }}
                        style={{ width: "auto" }}
                      />
                      <code>{option.id}</code>
                    </label>
                  ))}
                </div>
              )}
              {config.openaiModels.map((modelId, index) => (
                <div key={index} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                  <input
                    type="text"
                    placeholder="e.g., gpt-5.3"
                    value={modelId}
                    onChange={(e) => {
                      setConfig((prev) => ({
                        ...prev,
                        openaiModels: prev.openaiModels.map((m, i) => i === index ? e.target.value : m),
                      }));
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "0.25rem 0.5rem" }}
                    onClick={() => {
                      setConfig((prev) => ({
                        ...prev,
                        openaiModels: prev.openaiModels.filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem" }}
                disabled={!config.openaiModel.trim()}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    openaiModels: [...prev.openaiModels, ""],
                  }));
                }}
              >
                + Add Model
              </button>
              <div className="hint">
                Additional models appear in the OpenClaw model picker as <code>openai/&lt;model&gt;</code>.
              </div>
            </div>
          </>
        );
      }

      case "google": {
        const visibleGoogleOptions = CURATED_MODEL_OPTIONS.google || [];
        const additionalGoogleOptions = visibleGoogleOptions.filter(
          (option) => option.id !== config.googleModel,
        );
        return (
          <>
            <div className="form-group">
              <label>Google API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={defaults?.hasGoogleKey ? "(using key from environment)" : "AIza..."}
                value={config.googleApiKey}
                onChange={(e) => update("googleApiKey", e.target.value)}
              />
              <div className="hint">
                {defaults?.hasGoogleKey
                  ? "Detected GEMINI_API_KEY or GOOGLE_API_KEY from server environment — leave blank to use it"
                  : "Direct Gemini access via Google AI Studio or the Gemini Developer API."}
              </div>
              <div className="hint" style={{ marginTop: "0.35rem" }}>
                {secretInputPreferenceHint(mode)}
              </div>
            </div>
            <div className="form-group">
              <label>Google Model</label>
              {visibleGoogleOptions.length > 0 && (
                <select
                  value={getModelSelectValue(config.googleModel, visibleGoogleOptions)}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      if (visibleGoogleOptions.some((option) => option.id === config.googleModel)) {
                        update("googleModel", "");
                      }
                      return;
                    }
                    update("googleModel", e.target.value);
                  }}
                >
                  <option value="">Select a model...</option>
                  {visibleGoogleOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {formatModelOptionLabel(option)}
                    </option>
                  ))}
                  <option value="__custom__">
                    {getCustomModelOptionLabel(config.googleModel, visibleGoogleOptions)}
                  </option>
                </select>
              )}
              <div className="hint" style={{ marginBottom: "0.5rem" }}>
                Showing curated Gemini models.
              </div>
              <input
                type="text"
                placeholder="e.g., gemini-3.1-pro-preview"
                value={config.googleModel}
                onChange={(e) => update("googleModel", e.target.value)}
              />
              <div className="hint">
                Use the dropdown or enter a custom Gemini model ID. The primary model is used as <code>google/&lt;model&gt;</code>.
              </div>
            </div>
            <div className="form-group">
              <label>Additional Models</label>
              {additionalGoogleOptions.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.5rem", maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.5rem" }}>
                  {additionalGoogleOptions.map((option) => (
                    <label key={option.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={config.googleModels.includes(option.id)}
                        onChange={() => {
                          setConfig((prev) => ({
                            ...prev,
                            googleModels: prev.googleModels.includes(option.id)
                              ? prev.googleModels.filter((model) => model !== option.id)
                              : [...prev.googleModels, option.id],
                          }));
                        }}
                        style={{ width: "auto" }}
                      />
                      <code>{option.id}</code>
                      {option.name !== option.id && <span style={{ color: "var(--text-secondary)" }}>({option.name})</span>}
                    </label>
                  ))}
                </div>
              )}
              {config.googleModels.map((modelId, index) => (
                <div key={index} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                  <input
                    type="text"
                    placeholder="e.g., gemini-2.5-flash"
                    value={modelId}
                    onChange={(e) => {
                      setConfig((prev) => ({
                        ...prev,
                        googleModels: prev.googleModels.map((m, i) => i === index ? e.target.value : m),
                      }));
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "0.25rem 0.5rem" }}
                    onClick={() => {
                      setConfig((prev) => ({
                        ...prev,
                        googleModels: prev.googleModels.filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem" }}
                disabled={!config.googleModel.trim()}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    googleModels: [...prev.googleModels, ""],
                  }));
                }}
              >
                + Add Model
              </button>
              <div className="hint">
                Additional models appear in the OpenClaw model picker as <code>google/&lt;model&gt;</code>.
              </div>
            </div>
          </>
        );
      }

      case "openrouter":
        return (
          <>
            <div className="form-group">
              <label>OpenRouter API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={defaults?.hasOpenrouterKey ? "(using key from environment)" : "sk-or-..."}
                value={config.openrouterApiKey}
                onChange={(e) => update("openrouterApiKey", e.target.value)}
              />
              <div className="hint">
                {defaults?.hasOpenrouterKey
                  ? "Detected OPENROUTER_API_KEY from server environment — leave blank to use it"
                  : "Use a single OpenRouter key to route to many upstream providers."}
              </div>
              <div className="hint" style={{ marginTop: "0.35rem" }}>
                {secretInputPreferenceHint(mode)}
              </div>
            </div>
            <div className="form-group">
              <label>OpenRouter Model</label>
              <input
                type="text"
                placeholder="e.g., openrouter/auto"
                value={config.openrouterModel}
                onChange={(e) => update("openrouterModel", e.target.value)}
              />
              <div className="hint">
                Primary model used as the default in the OpenClaw model picker as <code>openrouter/&lt;route&gt;</code>.
              </div>
            </div>
            <div className="form-group">
              <label>Additional Models</label>
              {config.openrouterModels.map((modelId, index) => (
                <div key={index} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                  <input
                    type="text"
                    placeholder="e.g., openrouter/anthropic/claude-sonnet-4-6"
                    value={modelId}
                    onChange={(e) => {
                      setConfig((prev) => ({
                        ...prev,
                        openrouterModels: prev.openrouterModels.map((m, i) => i === index ? e.target.value : m),
                      }));
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "0.25rem 0.5rem" }}
                    onClick={() => {
                      setConfig((prev) => ({
                        ...prev,
                        openrouterModels: prev.openrouterModels.filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem" }}
                disabled={!config.openrouterModel.trim()}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    openrouterModels: [...prev.openrouterModels, ""],
                  }));
                }}
              >
                + Add Model
              </button>
              <div className="hint">
                Additional models appear in the OpenClaw model picker as <code>openrouter/&lt;route&gt;</code>.
              </div>
            </div>
          </>
        );

      case "vertex-anthropic":
      case "vertex-google":
        return (
          <>
            {provider === "vertex-google"
              && gcpDefaults?.credentialType === "authorized_user"
              && !config.gcpServiceAccountJson && (
              <div style={{
                marginBottom: "1rem",
                padding: "0.5rem 0.75rem",
                background: "rgba(231, 76, 60, 0.1)",
                border: "1px solid rgba(231, 76, 60, 0.3)",
                borderRadius: "6px",
                fontSize: "0.85rem",
                color: "#e74c3c",
              }}>
                Your environment credentials are Application Default Credentials (from <code>gcloud auth</code>),
                which are not supported by Gemini on Vertex. Either upload a Service Account JSON below,
                or switch to Google Vertex AI (Claude) which works with Application Default Credentials.
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>GCP Project ID</label>
                <input
                  type="text"
                  placeholder="my-gcp-project"
                  value={config.googleCloudProject}
                  onChange={(e) => update("googleCloudProject", e.target.value)}
                />
                {gcpDefaults?.sources.projectId && config.googleCloudProject === gcpDefaults.projectId ? (
                  <div className="hint">from {gcpDefaults.sources.projectId}</div>
                ) : !config.googleCloudProject && (
                  <div className="hint">Auto-extracted from credentials JSON if not set</div>
                )}
              </div>
              <div className="form-group">
                <label>GCP Region</label>
                <input
                  type="text"
                  placeholder={provider === "vertex-anthropic" ? "us-east5 (default)" : "us-central1 (default)"}
                  value={config.googleCloudLocation}
                  onChange={(e) => update("googleCloudLocation", e.target.value)}
                />
                {gcpDefaults?.sources.location && config.googleCloudLocation === gcpDefaults.location ? (
                  <div className="hint">from {gcpDefaults.sources.location}</div>
                ) : !config.googleCloudLocation && (
                  <div className="hint">
                    Defaults to {provider === "vertex-anthropic" ? "us-east5" : "us-central1"} if not set
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Google Cloud Credentials (JSON)</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {config.gcpServiceAccountJson ? (
                  <div
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontFamily: "monospace",
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {(() => {
                      try {
                        const parsed = JSON.parse(config.gcpServiceAccountJson);
                        return `${parsed.client_email || "service account"} (${parsed.project_id || "unknown project"})`;
                      } catch {
                        return "credentials loaded";
                      }
                    })()}
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder={
                      gcpDefaults?.hasServiceAccountJson
                        ? `Using credentials from ${gcpDefaults.sources.credentials}`
                        : "/path/to/service-account.json"
                    }
                    value={config.gcpServiceAccountPath}
                    onChange={(e) => update("gcpServiceAccountPath", e.target.value)}
                    style={{ flex: 1 }}
                  />
                )}
                <label
                  className="btn btn-ghost"
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {config.gcpServiceAccountJson ? "Change" : "Browse"}
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const text = reader.result as string;
                        update("gcpServiceAccountJson", text);
                        update("gcpServiceAccountPath", "");
                        if (!config.googleCloudProject) {
                          try {
                            const parsed = JSON.parse(text);
                            if (parsed.project_id) {
                              update("googleCloudProject", parsed.project_id);
                            }
                          } catch {
                            // Ignore invalid JSON uploads here; validation happens later.
                          }
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
                {config.gcpServiceAccountJson && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => update("gcpServiceAccountJson", "")}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="hint">
                Type a path to a credentials JSON file, or use Browse to upload one.
                {gcpDefaults?.hasServiceAccountJson && !config.gcpServiceAccountJson && !config.gcpServiceAccountPath
                  && " Leave blank to use credentials detected from environment."}
              </div>
            </div>

            {(() => {
              const isVertexAnthropic = provider === "vertex-anthropic";
              const modelField = isVertexAnthropic ? "vertexAnthropicModel" : "vertexGoogleModel";
              const modelsField = isVertexAnthropic ? "vertexAnthropicModels" : "vertexGoogleModels";
              const modelValue = isVertexAnthropic ? config.vertexAnthropicModel : config.vertexGoogleModel;
              const modelsValue = isVertexAnthropic ? config.vertexAnthropicModels : config.vertexGoogleModels;
              const placeholder = isVertexAnthropic ? "claude-sonnet-4-6" : "gemini-2.5-pro";
              const addPlaceholder = isVertexAnthropic ? "e.g., claude-opus-4-6" : "e.g., gemini-2.5-flash";
              const loading = isVertexAnthropic ? loadingVertexAnthropicModels : loadingVertexGoogleModels;
              const options = isVertexAnthropic ? vertexAnthropicModelOptions : vertexGoogleModelOptions;
              const additionalOptions = options.filter((option) => option.id !== modelValue);
              const error = isVertexAnthropic ? vertexAnthropicModelsError : vertexGoogleModelsError;
              const warning = isVertexAnthropic ? vertexAnthropicModelsWarning : vertexGoogleModelsWarning;
              return (
                <>
                  <div className="form-group">
                    <label>Model</label>
                    {loading && (
                      <div className="hint">Loading models...</div>
                    )}
                    {error && (
                      <div className="hint" style={{ color: "#e74c3c" }}>{error}</div>
                    )}
                    {warning && !error && (
                      <div className="hint">{warning}</div>
                    )}
                    {options.length > 0 && (
                      <select
                        value={getModelSelectValue(modelValue, options)}
                        onChange={(e) => {
                          if (e.target.value === "__custom__") {
                            if (options.some((option) => option.id === modelValue)) {
                              update(modelField, "");
                            }
                            return;
                          }
                          update(modelField, e.target.value);
                        }}
                      >
                        <option value="">Select a model...</option>
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {formatModelOptionLabel(option)}
                          </option>
                        ))}
                        <option value="__custom__">
                          {getCustomModelOptionLabel(modelValue, options)}
                        </option>
                      </select>
                    )}
                    <input
                      type="text"
                      placeholder={placeholder}
                      value={modelValue}
                      onChange={(e) => update(modelField, e.target.value)}
                    />
                    <div className="hint">
                      Use the dropdown or enter a custom model ID. The primary model is used as the default in the OpenClaw model picker.
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Additional Models</label>
                    {additionalOptions.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.5rem", maxHeight: "150px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.5rem" }}>
                        {additionalOptions.map((option) => (
                          <label key={option.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={modelsValue.includes(option.id)}
                              onChange={() => {
                                setConfig((prev) => {
                                  const prevModels = prev[modelsField] as string[];
                                  return {
                                    ...prev,
                                    [modelsField]: prevModels.includes(option.id)
                                      ? prevModels.filter((model) => model !== option.id)
                                      : [...prevModels, option.id],
                                  };
                                });
                              }}
                              style={{ width: "auto" }}
                            />
                            <code>{option.id}</code>
                            {option.name !== option.id && <span style={{ color: "var(--text-secondary)" }}>({option.name})</span>}
                          </label>
                        ))}
                      </div>
                    )}
                    {modelsValue.map((modelId, index) => (
                      <div key={index} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.25rem" }}>
                        <input
                          type="text"
                          placeholder={addPlaceholder}
                          value={modelId}
                          onChange={(e) => {
                            setConfig((prev) => ({
                              ...prev,
                              [modelsField]: (prev[modelsField] as string[]).map((m, i) => i === index ? e.target.value : m),
                            }));
                          }}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: "0.25rem 0.5rem" }}
                          onClick={() => {
                            setConfig((prev) => ({
                              ...prev,
                              [modelsField]: (prev[modelsField] as string[]).filter((_, i) => i !== index),
                            }));
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem" }}
                      disabled={!modelValue.trim()}
                      onClick={() => {
                        setConfig((prev) => ({
                          ...prev,
                          [modelsField]: [...(prev[modelsField] as string[]), ""],
                        }));
                      }}
                    >
                      + Add Model
                    </button>
                    <div className="hint">
                      Additional models appear in the OpenClaw model picker.
                    </div>
                  </div>
                </>
              );
            })()}

            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={config.litellmProxy}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, litellmProxy: e.target.checked }))
                  }
                  style={{ width: "auto" }}
                />
                Use LiteLLM proxy (recommended)
              </label>
              <div className="hint">
                Runs a LiteLLM sidecar that handles Vertex AI authentication.
                GCP credentials stay in the proxy container and are never exposed to the agent.
                {!config.litellmProxy && (
                  <span style={{ color: "#e67e22" }}>
                    {" "}Disabled: credentials will be passed directly to the agent container.
                  </span>
                )}
              </div>
              {config.litellmProxy && (
                <div style={{
                  marginTop: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  background: "rgba(52, 152, 219, 0.1)",
                  border: "1px solid rgba(52, 152, 219, 0.3)",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                }}>
                  The first deployment will pull both the OpenClaw image and the LiteLLM proxy
                  image (<code>ghcr.io/berriai/litellm:v1.82.3-stable.patch.2</code>, ~1.5 GB).
                  This may take several minutes. You can pre-pull
                  with: <code>{mode === "kubernetes" ? "crictl pull" : "podman pull"} ghcr.io/berriai/litellm:v1.82.3-stable.patch.2</code>
                </div>
              )}
            </div>
          </>
        );

      case "custom-endpoint":
        return (
          <>
            <div className="form-group">
              <label>OpenAI-Compatible Model Endpoint</label>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="http://vllm.openclaw-llms.svc.cluster.local/v1"
                  value={config.modelEndpoint}
                  onChange={(e) => update("modelEndpoint", e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={fetchModelEndpointOptions}
                  disabled={loadingModelEndpointOptions}
                >
                  {loadingModelEndpointOptions ? "Fetching..." : "Fetch Models"}
                </button>
              </div>
              <div className="hint">
                Optional. Save a local or open-source OpenAI-compatible endpoint here for primary use or fallback routing.
              </div>
              <div className="hint" style={{ marginTop: "0.35rem" }}>
                If you paste just the service URL, the installer will normalize it to a <code>/v1</code> API base for runtime requests.
              </div>
              {modelEndpointOptionsError && (
                <div className="hint" style={{ color: "#e74c3c", marginTop: "0.35rem" }}>
                  {modelEndpointOptionsError}
                </div>
              )}
            </div>
            <div className="form-group">
              <label>OpenAI-Compatible Model Name</label>
              {modelEndpointOptions.length > 0 ? (
                <select
                  value={config.modelEndpointModel}
                  onChange={(e) => {
                    const selected = modelEndpointOptions.find((option) => option.id === e.target.value);
                    setConfig((prev) => ({
                      ...prev,
                      modelEndpointModel: e.target.value,
                      modelEndpointModelLabel: selected?.name || e.target.value,
                    }));
                  }}
                >
                  {modelEndpointOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name === option.id ? option.id : `${option.name} (${option.id})`}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="e.g., mistral-small-24b-w8a8"
                  value={config.modelEndpointModel}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      modelEndpointModel: e.target.value,
                      modelEndpointModelLabel: e.target.value,
                    }))
                  }
                />
              )}
              <div className="hint">
                The model ID served by that endpoint. Use the exact name the endpoint expects, such as <code>mistral-small-24b-w8a8</code>.
              </div>
            </div>
            <div className="form-group">
              <label>OpenAI-Compatible Endpoint API Key (`MODEL_ENDPOINT_API_KEY`)</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="API key for the OpenAI-compatible endpoint"
                value={config.modelEndpointApiKey}
                onChange={(e) => update("modelEndpointApiKey", e.target.value)}
              />
              <div className="hint">
                Separate from <code>OPENAI_API_KEY</code>. Leave blank for local endpoints that do not require auth.
              </div>
              <div className="hint" style={{ marginTop: "0.35rem" }}>
                {secretInputPreferenceHint(mode)}
              </div>
            </div>
          </>
        );

      default:
        return null;
    }
  }

  return (
    <>
      <h3 style={{ marginTop: "1.5rem" }}>Inference Providers</h3>

      {/* Primary Provider Card */}
      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div style={LABEL_STYLE}>Primary</div>

        <div className="form-group">
          <label>Primary Provider</label>
          <select
            value={inferenceProvider}
            onChange={(e) => {
              const nextProvider = e.target.value as InferenceProvider;
              setInferenceProvider(nextProvider);
              setConfig((prev) => ({ ...prev, agentModel: "" }));
            }}
          >
            {PROVIDER_OPTIONS.filter(
              (p) => p.id === inferenceProvider || !selectedAdditionalProviders.includes(p.id),
            ).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <div className="hint">
            {PROVIDER_OPTIONS.find((p) => p.id === inferenceProvider)?.desc}. This controls the default primary route for the deployment.
          </div>
        </div>

        <div className="form-group" style={{ marginTop: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.openaiCompatibleEndpointsEnabled}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, openaiCompatibleEndpointsEnabled: e.target.checked }))
              }
              style={{ width: "auto" }}
            />
            Enable OpenAI-compatible API endpoints
          </label>
          <div className="hint">
            Exposes <code>/v1/chat/completions</code>, <code>/v1/responses</code>, and <code>/v1/models</code> for OpenAI-compatible clients. Disable this to remove those endpoints from the gateway.
          </div>
        </div>

        {renderProviderFields(inferenceProvider)}
      </div>

      {/* Additional Provider Cards */}
      {additionalProviders.map((ap) => {
        const availableOptions = PROVIDER_OPTIONS.filter(
          (p) => p.id === ap.provider || !allUsedProviders.includes(p.id),
        );

        return (
          <div className="card" style={{ marginTop: "0.75rem" }} key={ap.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={LABEL_STYLE}>Additional Provider</div>
              <button
                className="btn btn-ghost"
                onClick={() => removeProvider(ap.id)}
                style={{ marginTop: "-0.25rem" }}
              >
                Remove
              </button>
            </div>

            <div className="form-group">
              <label>Provider</label>
              <select
                value={ap.provider}
                onChange={(e) => setProviderValue(ap.id, e.target.value as InferenceProvider | "")}
              >
                <option value="">Select a provider...</option>
                {availableOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            {renderProviderFields(ap.provider)}
          </div>
        );
      })}

      {/* Add Provider Button */}
      <div style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={addProvider}
          disabled={allAdded}
        >
          + Add Provider
        </button>
        {allAdded && (
          <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            All available providers have been added
          </span>
        )}
      </div>
    </>
  );
}
