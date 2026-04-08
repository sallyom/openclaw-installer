import React from "react";
import type { DeployFormConfig, SecretRefValue } from "./types.js";

interface SecretRefsSectionProps {
  config: DeployFormConfig;
  update: (field: string, value: string) => void;
  mode: string;
  effectiveAnthropicApiKeyRef?: SecretRefValue;
  effectiveOpenaiApiKeyRef?: SecretRefValue;
  effectiveGoogleApiKeyRef?: SecretRefValue;
  effectiveOpenrouterApiKeyRef?: SecretRefValue;
  effectiveModelEndpointApiKeyRef?: SecretRefValue;
  anthropicApiKeyRefIsInferred?: boolean;
  openaiApiKeyRefIsInferred?: boolean;
  googleApiKeyRefIsInferred?: boolean;
  openrouterApiKeyRefIsInferred?: boolean;
  modelEndpointApiKeyRefIsInferred?: boolean;
}

function formatSecretRef(ref?: SecretRefValue): string {
  return ref ? `${ref.source}/${ref.provider}/${ref.id}` : "None";
}

export function SecretRefsSection({
  config,
  update,
  mode,
  effectiveAnthropicApiKeyRef,
  effectiveOpenaiApiKeyRef,
  effectiveGoogleApiKeyRef,
  effectiveOpenrouterApiKeyRef,
  effectiveModelEndpointApiKeyRef,
  anthropicApiKeyRefIsInferred = false,
  openaiApiKeyRefIsInferred = false,
  googleApiKeyRefIsInferred = false,
  openrouterApiKeyRefIsInferred = false,
  modelEndpointApiKeyRefIsInferred = false,
}: SecretRefsSectionProps) {
  const isLocal = mode === "local";
  const isCluster = mode === "kubernetes" || mode === "openshift";

  const anthropicHint = anthropicApiKeyRefIsInferred
    ? isLocal
      ? "Currently inferred from local Podman secret mappings or the local API key field."
      : isCluster
        ? "Currently inferred from the installer-managed openclaw-secrets Secret."
        : "Currently inferred from the deploy form."
    : "Optional override. Leave blank to use the installer-managed SecretRef automatically.";

  const openaiHint = openaiApiKeyRefIsInferred
    ? isLocal
      ? "Currently inferred from local Podman secret mappings or the local API key field."
      : isCluster
        ? "Currently inferred from the installer-managed openclaw-secrets Secret."
        : "Currently inferred from the deploy form."
    : "Optional override. Leave blank to use the installer-managed SecretRef automatically.";

  const googleHint = googleApiKeyRefIsInferred
    ? isLocal
      ? "Currently inferred from local Podman secret mappings or the local API key field."
      : isCluster
        ? "Currently inferred from the installer-managed openclaw-secrets Secret."
        : "Currently inferred from the deploy form."
    : "Optional override. Leave blank to use the installer-managed SecretRef automatically.";

  const openrouterHint = openrouterApiKeyRefIsInferred
    ? isLocal
      ? "Currently inferred from local Podman secret mappings or the local API key field."
      : isCluster
        ? "Currently inferred from the installer-managed openclaw-secrets Secret."
        : "Currently inferred from the deploy form."
    : "Optional override. Leave blank to use the installer-managed SecretRef automatically.";

  const modelEndpointHint = modelEndpointApiKeyRefIsInferred
    ? isLocal
      ? "Currently inferred from local Podman secret mappings or the local endpoint API key field."
      : isCluster
        ? "Currently inferred from the installer-managed openclaw-secrets Secret."
        : "Currently inferred from the deploy form."
    : "Optional override. Leave blank to use the installer-managed SecretRef automatically.";

  return (
    <details style={{ marginTop: "1.5rem" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced: SecretRefs</summary>
      <div className="card" style={{ marginTop: "0.75rem" }}>
        <div className="hint" style={{ marginBottom: "0.75rem" }}>
          These control how generated OpenClaw config references provider credentials. The installer can infer the
          built-in Anthropic, OpenAI, Google, OpenRouter, and OpenAI-compatible endpoint SecretRefs automatically from your local Podman secret mappings or the managed
          Kubernetes <code>openclaw-secrets</code> Secret. Override them here only when you need a different source,
          provider, or id.
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Effective Anthropic SecretRef: <code>{formatSecretRef(effectiveAnthropicApiKeyRef)}</code>
            {anthropicApiKeyRefIsInferred ? " (inferred)" : ""}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Anthropic SecretRef Source</label>
              <select
                value={config.anthropicApiKeyRefSource}
                onChange={(e) => update("anthropicApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>Anthropic SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.anthropicApiKeyRefProvider}
                onChange={(e) => update("anthropicApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Anthropic SecretRef ID</label>
            <input
              type="text"
              placeholder="ANTHROPIC_API_KEY or /providers/anthropic/apiKey or providers/anthropic/apiKey"
              value={config.anthropicApiKeyRefId}
              onChange={(e) => update("anthropicApiKeyRefId", e.target.value)}
            />
            <div className="hint">{anthropicHint}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Effective OpenAI SecretRef: <code>{formatSecretRef(effectiveOpenaiApiKeyRef)}</code>
            {openaiApiKeyRefIsInferred ? " (inferred)" : ""}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>OpenAI SecretRef Source</label>
              <select
                value={config.openaiApiKeyRefSource}
                onChange={(e) => update("openaiApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>OpenAI SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.openaiApiKeyRefProvider}
                onChange={(e) => update("openaiApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>OpenAI SecretRef ID</label>
            <input
              type="text"
              placeholder="OPENAI_API_KEY or /providers/openai/apiKey or providers/openai/apiKey"
              value={config.openaiApiKeyRefId}
              onChange={(e) => update("openaiApiKeyRefId", e.target.value)}
            />
            <div className="hint">{openaiHint}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Effective Google SecretRef: <code>{formatSecretRef(effectiveGoogleApiKeyRef)}</code>
            {googleApiKeyRefIsInferred ? " (inferred)" : ""}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Google SecretRef Source</label>
              <select
                value={config.googleApiKeyRefSource}
                onChange={(e) => update("googleApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>Google SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.googleApiKeyRefProvider}
                onChange={(e) => update("googleApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Google SecretRef ID</label>
            <input
              type="text"
              placeholder="GEMINI_API_KEY or GOOGLE_API_KEY or /providers/google/apiKey"
              value={config.googleApiKeyRefId}
              onChange={(e) => update("googleApiKeyRefId", e.target.value)}
            />
            <div className="hint">{googleHint}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Effective OpenRouter SecretRef: <code>{formatSecretRef(effectiveOpenrouterApiKeyRef)}</code>
            {openrouterApiKeyRefIsInferred ? " (inferred)" : ""}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>OpenRouter SecretRef Source</label>
              <select
                value={config.openrouterApiKeyRefSource}
                onChange={(e) => update("openrouterApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>OpenRouter SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.openrouterApiKeyRefProvider}
                onChange={(e) => update("openrouterApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>OpenRouter SecretRef ID</label>
            <input
              type="text"
              placeholder="OPENROUTER_API_KEY or /providers/openrouter/apiKey or providers/openrouter/apiKey"
              value={config.openrouterApiKeyRefId}
              onChange={(e) => update("openrouterApiKeyRefId", e.target.value)}
            />
            <div className="hint">{openrouterHint}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="hint" style={{ marginBottom: "0.75rem" }}>
            Effective OpenAI-Compatible Endpoint SecretRef: <code>{formatSecretRef(effectiveModelEndpointApiKeyRef)}</code>
            {modelEndpointApiKeyRefIsInferred ? " (inferred)" : ""}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>OpenAI-Compatible Endpoint SecretRef Source</label>
              <select
                value={config.modelEndpointApiKeyRefSource}
                onChange={(e) => update("modelEndpointApiKeyRefSource", e.target.value)}
              >
                <option value="env">env</option>
                <option value="file">file</option>
                <option value="exec">exec</option>
              </select>
            </div>
            <div className="form-group">
              <label>OpenAI-Compatible Endpoint SecretRef Provider</label>
              <input
                type="text"
                placeholder="default"
                value={config.modelEndpointApiKeyRefProvider}
                onChange={(e) => update("modelEndpointApiKeyRefProvider", e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>OpenAI-Compatible Endpoint SecretRef ID</label>
            <input
              type="text"
              placeholder="MODEL_ENDPOINT_API_KEY or /providers/model-endpoint/apiKey or providers/model-endpoint/apiKey"
              value={config.modelEndpointApiKeyRefId}
              onChange={(e) => update("modelEndpointApiKeyRefId", e.target.value)}
            />
            <div className="hint">{modelEndpointHint}</div>
          </div>
        </div>

        <div className="hint">
          The installer currently auto-manages SecretRefs for the built-in model provider credentials. Arbitrary new
          SecretRefs are not exposed here yet unless there is a deploy form field that consumes them.
        </div>
      </div>
    </details>
  );
}
