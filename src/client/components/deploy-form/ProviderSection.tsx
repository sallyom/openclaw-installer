import React from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  MODEL_DEFAULTS,
  MODEL_HINTS,
  PROVIDER_OPTIONS,
  PROXY_MODEL_HINTS,
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
  isVertex: boolean;
  loadingModelEndpointOptions: boolean;
  mode: string;
  modelEndpointOptions: ModelEndpointOption[];
  modelEndpointOptionsError: string | null;
  setConfig: Dispatch<SetStateAction<DeployFormConfig>>;
  setInferenceProvider: Dispatch<SetStateAction<InferenceProvider>>;
  update: (field: string, value: string) => void;
}

export function ProviderSection({
  config,
  defaults,
  fetchModelEndpointOptions,
  gcpDefaults,
  inferenceProvider,
  isVertex,
  loadingModelEndpointOptions,
  mode,
  modelEndpointOptions,
  modelEndpointOptionsError,
  setConfig,
  setInferenceProvider,
  update,
}: ProviderSectionProps) {
  return (
    <>
      <h3 style={{ marginTop: "1.5rem" }}>Inference Provider</h3>

      <div className="form-group">
        <label>Primary Provider</label>
        <select
          value={inferenceProvider}
          onChange={(e) => {
            setInferenceProvider(e.target.value as InferenceProvider);
            update("agentModel", "");
          }}
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <div className="hint">
          {PROVIDER_OPTIONS.find((p) => p.id === inferenceProvider)?.desc}. This controls the default primary route for the deployment.
        </div>
      </div>

      <div className="form-group" style={{ marginTop: "0.75rem" }}>
        <label>Primary Model</label>
        <input
          type="text"
          placeholder={
            isVertex && config.litellmProxy
              ? (inferenceProvider === "vertex-anthropic" ? "claude-sonnet-4-6" : "gemini-2.5-pro")
              : (MODEL_DEFAULTS[inferenceProvider] || "model-id")
          }
          value={config.agentModel}
          onChange={(e) => update("agentModel", e.target.value)}
        />
        <div className="hint">
          {config.agentModel
            ? "Custom primary model override"
            : isVertex && config.litellmProxy
              ? `Leave blank for default (routed through LiteLLM proxy). ${PROXY_MODEL_HINTS[inferenceProvider] || MODEL_HINTS[inferenceProvider]}`
              : `Leave blank for default${MODEL_DEFAULTS[inferenceProvider] ? ` (${MODEL_DEFAULTS[inferenceProvider]})` : ""}. ${MODEL_HINTS[inferenceProvider]}`}
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

      <details style={{ marginTop: "0.75rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Additional Providers & Fallbacks
          <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
            {" "}Additional credentials and endpoint settings
          </span>
        </summary>

        <div className="card" style={{ marginTop: "0.75rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            The selected primary provider and model above control the default route. The settings below are saved independently so Anthropic, OpenAI, and OpenAI-compatible endpoints can also be used for fallbacks.
          </div>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Configure these independently when you want one deployment to have:
            {" "}Anthropic (<code>ANTHROPIC_API_KEY</code>),
            {" "}OpenAI (<code>OPENAI_API_KEY</code>), and
            {" "}an OpenAI-compatible endpoint with its own token (<code>MODEL_ENDPOINT</code> + <code>MODEL_ENDPOINT_API_KEY</code>).
          </div>
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
          </div>
          <div className="form-group">
            <label>Anthropic Model</label>
            <input
              type="text"
              placeholder="e.g., claude-sonnet-4-6"
              value={config.anthropicModel}
              onChange={(e) => update("anthropicModel", e.target.value)}
            />
            <div className="hint">
              Adds this Anthropic model to the OpenClaw model picker as <code>anthropic/&lt;model&gt;</code>.
            </div>
          </div>

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
          </div>
          <div className="form-group">
            <label>OpenAI Model</label>
            <input
              type="text"
              placeholder="e.g., gpt-5"
              value={config.openaiModel}
              onChange={(e) => update("openaiModel", e.target.value)}
            />
            <div className="hint">
              Adds this OpenAI model to the OpenClaw model picker as <code>openai/&lt;model&gt;</code>.
            </div>
          </div>

          {isVertex && (
            <>
              {inferenceProvider === "vertex-google"
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
                    placeholder={inferenceProvider === "vertex-anthropic" ? "us-east5 (default)" : "us-central1 (default)"}
                    value={config.googleCloudLocation}
                    onChange={(e) => update("googleCloudLocation", e.target.value)}
                  />
                  {gcpDefaults?.sources.location && config.googleCloudLocation === gcpDefaults.location ? (
                    <div className="hint">from {gcpDefaults.sources.location}</div>
                  ) : !config.googleCloudLocation && (
                    <div className="hint">
                      Defaults to {inferenceProvider === "vertex-anthropic" ? "us-east5" : "us-central1"} if not set
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
          )}

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
              Separate from <code>OPENAI_API_KEY</code>. Use this when your OpenAI-compatible endpoint requires its own token.
            </div>
          </div>

        </div>
      </details>
    </>
  );
}
