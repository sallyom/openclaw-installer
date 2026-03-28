import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateAgentName } from "../../shared/validate-agent-name.js";
import {
  MODE_ICONS,
} from "./deploy-form/constants.js";
import {
  defaultImageForProvider,
  deriveNamespace,
  inferAgentNameFromPath,
  inferDisplayNameFromAgentName,
  buildSecretRef,
} from "./deploy-form/utils.js";
import {
  applySavedVarsToConfig,
  buildDeployRequestBody,
  buildEnvFileContent,
  createInitialDeployFormConfig,
  inferSavedInferenceProvider,
} from "./deploy-form/serialization.js";
import { ProviderSection } from "./deploy-form/ProviderSection.js";
import { SandboxSection } from "./deploy-form/SandboxSection.js";
import { SecretProvidersSection } from "./deploy-form/SecretProvidersSection.js";
import type {
  DeployFormConfig,
  DeployerInfo,
  DeployFormProps,
  GcpDefaults,
  InferenceProvider,
  ModelEndpointOption,
  SavedConfig,
  ServerDefaults,
} from "./deploy-form/types.js";

const LAST_AGENT_SOURCE_DIR_KEY = "openclaw:last-agent-source-dir";

export default function DeployForm({ onDeployStarted }: DeployFormProps) {
  const [mode, setMode] = useState("local");
  const [deploying, setDeploying] = useState(false);
  const [defaults, setDefaults] = useState<ServerDefaults | null>(null);
  const [deployers, setDeployers] = useState<DeployerInfo[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [loadedConfigLabel, setLoadedConfigLabel] = useState<string | null>(null);
  const [autoLoadedEnvDir, setAutoLoadedEnvDir] = useState<string | null>(null);
  const [inferenceProvider, setInferenceProvider] = useState<InferenceProvider>("anthropic");
  const [config, setConfig] = useState<DeployFormConfig>(createInitialDeployFormConfig);

  const [gcpDefaults, setGcpDefaults] = useState<GcpDefaults | null>(null);
  const [gcpDefaultsFetched, setGcpDefaultsFetched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modelEndpointOptions, setModelEndpointOptions] = useState<ModelEndpointOption[]>([]);
  const [loadingModelEndpointOptions, setLoadingModelEndpointOptions] = useState(false);
  const [modelEndpointOptionsError, setModelEndpointOptionsError] = useState<string | null>(null);
  const previousModelEndpointRef = useRef("");

  const isClusterMode = mode === "kubernetes" || mode === "openshift";
  const isVertex = inferenceProvider === "vertex-anthropic" || inferenceProvider === "vertex-google";
  const displayedDeployers = useMemo(
    () => {
      // Hide unavailable plugin deployers (issue #10) — only built-in
      // deployers should appear as disabled; plugin deployers are hidden entirely.
      const visible = deployers.filter((d) =>
        d.enabled !== false && (d.builtIn || d.available),
      );
      // Only hide Kubernetes when OpenShift is both available and enabled,
      // so disabling the OpenShift plugin falls back to the Kubernetes deployer.
      const openshiftActive = visible.some(
        (d) => d.mode === "openshift" && d.available,
      );
      return defaults?.isOpenShift && openshiftActive
        ? visible.filter((d) => d.mode !== "kubernetes")
        : visible;
    },
    [defaults?.isOpenShift, deployers],
  );

  // Fetch GCP defaults when a Vertex provider is first selected
  useEffect(() => {
    if (!isVertex || gcpDefaultsFetched) return;
    setGcpDefaultsFetched(true);
    fetch("/api/configs/gcp-defaults")
      .then((r) => r.json())
      .then((data: GcpDefaults) => {
        setGcpDefaults(data);
        setConfig((prev) => ({
          ...prev,
          googleCloudProject: prev.googleCloudProject || data.projectId || "",
          googleCloudLocation: prev.googleCloudLocation || data.location || "",
        }));
      })
      .catch(() => {});
  }, [isVertex, gcpDefaultsFetched]);

  // Re-detect environment (K8s availability, deployers, env vars).
  // Called on mount, on tab focus, and via the manual Refresh button.
  const refreshEnvironment = useCallback((isInitial = false) => {
    setRefreshing(true);
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => {
        const d = {
          ...(data.defaults || {}),
          k8sAvailable: data.k8sAvailable,
          k8sContext: data.k8sContext,
          k8sNamespace: data.k8sNamespace,
          isOpenShift: data.isOpenShift,
        };
        setDefaults(d);

        if (Array.isArray(data.deployers)) {
          const sorted = [...(data.deployers as DeployerInfo[])].sort((a, b) => {
            if (a.available !== b.available) return a.available ? -1 : 1;
            return (b.priority ?? 0) - (a.priority ?? 0);
          });
          setDeployers(sorted);
          // Only auto-select mode on first load
          if (isInitial && sorted.length > 0 && sorted[0].available) {
            setMode(sorted[0].mode);
          }
        }

        if (isInitial) {
          if (d.prefix) {
            setConfig((prev) => ({ ...prev, prefix: d.prefix }));
          }
          if (d.modelEndpoint) {
            setConfig((prev) => ({ ...prev, modelEndpoint: d.modelEndpoint }));
            setInferenceProvider("custom-endpoint");
          } else if (d.hasOpenaiKey && !d.hasAnthropicKey) {
            setInferenceProvider("openai");
          }
          if (d.image) {
            setConfig((prev) => ({ ...prev, image: d.image }));
          }
        }
      })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  // Initial fetch
  useEffect(() => {
    refreshEnvironment(true);

    // Load saved configs from ~/.openclaw/installer/
    fetch("/api/configs")
      .then((r) => r.json())
      .then((configs: SavedConfig[]) => {
        setSavedConfigs(configs);
      })
      .catch(() => {});
  }, [refreshEnvironment]);

  // Re-detect environment when the browser tab regains focus
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshEnvironment();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshEnvironment]);

  useEffect(() => {
    if (defaults?.isOpenShift && mode === "kubernetes") {
      setMode("openshift");
    }
  }, [defaults?.isOpenShift, mode]);

  useEffect(() => {
    try {
      const lastAgentSourceDir = window.localStorage.getItem(LAST_AGENT_SOURCE_DIR_KEY);
      if (!lastAgentSourceDir) return;
      setConfig((prev) => (
        prev.agentSourceDir
          ? prev
          : {
              ...prev,
              agentSourceDir: lastAgentSourceDir,
            }
      ));
    } catch {
      // Ignore localStorage access failures.
    }
  }, []);

  useEffect(() => {
    try {
      const trimmed = config.agentSourceDir.trim();
      if (trimmed) {
        window.localStorage.setItem(LAST_AGENT_SOURCE_DIR_KEY, trimmed);
      } else {
        window.localStorage.removeItem(LAST_AGENT_SOURCE_DIR_KEY);
      }
    } catch {
      // Ignore localStorage access failures.
    }
  }, [config.agentSourceDir]);

  useEffect(() => {
    const nextEndpoint = config.modelEndpoint.trim();
    const previousEndpoint = previousModelEndpointRef.current;
    previousModelEndpointRef.current = nextEndpoint;
    if (previousEndpoint === nextEndpoint) {
      return;
    }

    setModelEndpointOptions([]);
    setModelEndpointOptionsError(null);

    if (!previousEndpoint) {
      return;
    }

    setConfig((prev) => {
      const knownFetchedIds = new Set(prev.modelEndpointModels.map((option) => option.id.trim()));
      const currentModelId = prev.modelEndpointModel.trim();
      const shouldClearSelectedModel =
        Boolean(prev.modelEndpointModelLabel.trim()) || knownFetchedIds.has(currentModelId);
      return {
        ...prev,
        modelEndpointModels: [],
        modelEndpointModelLabel: "",
        modelEndpointModel: shouldClearSelectedModel ? "" : prev.modelEndpointModel,
      };
    });
  }, [config.modelEndpoint]);

  useEffect(() => {
    setModelEndpointOptionsError(null);
  }, [config.modelEndpointApiKey]);

  useEffect(() => {
    setModelEndpointOptions(config.modelEndpointModels);
  }, [config.modelEndpointModels]);

  const applyVars = (vars: Record<string, unknown>) => {
    const nextInferenceProvider = inferSavedInferenceProvider(vars);
    if (nextInferenceProvider) {
      setInferenceProvider(nextInferenceProvider);
    }
    const applied = applySavedVarsToConfig(vars, config);
    setNamespaceManuallyEdited(applied.namespaceManuallyEdited);
    setConfig(applied.config);
  };

  const [displayNameManuallyEdited, setDisplayNameManuallyEdited] = useState(false);
  const [agentNameManuallyEdited, setAgentNameManuallyEdited] = useState(false);
  const [namespaceManuallyEdited, setNamespaceManuallyEdited] = useState(false);
  const derivedNamespace = deriveNamespace(config.prefix || defaults?.prefix || "", config.agentName);
  const currentClusterNamespace = defaults?.k8sNamespace?.trim() || "";
  const hasNonDefaultCurrentProject = Boolean(
    defaults?.isOpenShift
    && currentClusterNamespace
    && currentClusterNamespace.toLowerCase() !== "default",
  );
  const suggestedNamespace = useMemo(() => {
    if (hasNonDefaultCurrentProject) {
      return currentClusterNamespace;
    }
    return derivedNamespace;
  }, [currentClusterNamespace, derivedNamespace, hasNonDefaultCurrentProject]);

  useEffect(() => {
    if (namespaceManuallyEdited) return;
    setConfig((prev) => {
      if (prev.namespace === suggestedNamespace) return prev;
      return { ...prev, namespace: suggestedNamespace };
    });
  }, [namespaceManuallyEdited, suggestedNamespace]);

  const update = (field: string, value: string) => {
    if (field === "agentName") {
      setAgentNameManuallyEdited(true);
    }
    if (field === "agentDisplayName") {
      setDisplayNameManuallyEdited(true);
    }
    if (field === "namespace") {
      setNamespaceManuallyEdited(true);
    }
    if (field === "agentSourceDir") {
      const inferredAgentName = inferAgentNameFromPath(value);
      setConfig((prev) => ({
        ...prev,
        agentSourceDir: value,
        agentName:
          (!agentNameManuallyEdited || !prev.agentName) && inferredAgentName
            ? inferredAgentName
            : prev.agentName,
        agentDisplayName:
          (!displayNameManuallyEdited || !prev.agentDisplayName) && inferredAgentName
            ? inferDisplayNameFromAgentName(inferredAgentName)
            : prev.agentDisplayName,
      }));
      const trimmed = value.trim();
      if (!trimmed || trimmed === autoLoadedEnvDir) {
        return;
      }
      fetch("/api/configs/source-env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSourceDir: trimmed }),
      })
        .then(async (r) => {
          if (!r.ok) return null;
          return await r.json() as { vars?: Record<string, string> };
        })
        .then((data) => {
          if (!data?.vars) return;
          applyVars(data.vars);
          setLoadedConfigLabel(`${trimmed}/.env`);
          setAutoLoadedEnvDir(trimmed);
        })
        .catch(() => {});
      return;
    }
    if (field === "agentName" && !displayNameManuallyEdited) {
      // Auto-derive display name from agent name
      setConfig((prev) => ({
        ...prev,
        agentName: value,
        agentDisplayName: inferDisplayNameFromAgentName(value),
      }));
    } else {
      setConfig((prev) => ({ ...prev, [field]: value }));
    }
  };

  const fetchModelEndpointOptions = async () => {
    const endpoint = config.modelEndpoint.trim();
    if (!endpoint) {
      setModelEndpointOptions([]);
      setModelEndpointOptionsError("Enter the endpoint URL first.");
      return;
    }

    setLoadingModelEndpointOptions(true);
    setModelEndpointOptionsError(null);
    try {
      const res = await fetch("/api/configs/model-endpoint-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint,
          apiKey: config.modelEndpointApiKey.trim() || undefined,
        }),
      });
      const data = await res.json() as { models?: ModelEndpointOption[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Failed to fetch models (${res.status})`);
      }
      const options = Array.isArray(data.models) ? data.models : [];
      setModelEndpointOptions(options);
      if (options.length > 0) {
        setConfig((prev) => {
          const selected = options.find((option) => option.id === prev.modelEndpointModel) || options[0];
          return {
            ...prev,
            modelEndpointModels: options,
            modelEndpointModel: prev.modelEndpointModel || selected.id,
            modelEndpointModelLabel: selected.name,
          };
        });
      }
    } catch (err) {
      setModelEndpointOptions([]);
      setModelEndpointOptionsError(err instanceof Error ? err.message : "Failed to fetch endpoint models");
    } finally {
      setLoadingModelEndpointOptions(false);
    }
  };

  const handleDeploy = async () => {
    if (!isValid) {
      return;
    }
    setDeploying(true);
    try {
      const body = buildDeployRequestBody({
        mode,
        inferenceProvider,
        config,
        isVertex,
        suggestedNamespace,
        anthropicApiKeyRef,
        openaiApiKeyRef,
        telegramBotTokenRef,
      });

      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.deployId) {
        onDeployStarted(data.deployId);
      }
    } catch (err) {
      console.error("Deploy failed:", err);
    } finally {
      setDeploying(false);
    }
  };

  const handleEnvDownload = () => {
    const text = buildEnvFileContent({
      config,
      inferenceProvider,
      isVertex,
      suggestedNamespace,
      anthropicApiKeyRef,
      openaiApiKeyRef,
      telegramBotTokenRef,
    });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${config.agentName || "openclaw"}.env`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
  };

  const hasSandboxToolSelection = !config.sandboxToolPolicyEnabled
    || config.sandboxToolAllowFiles
    || config.sandboxToolAllowSessions
    || config.sandboxToolAllowMemory
    || config.sandboxToolAllowRuntime
    || config.sandboxToolAllowBrowser
    || config.sandboxToolAllowAutomation
    || config.sandboxToolAllowMessaging;

  const anthropicApiKeyRef = buildSecretRef(
    config.anthropicApiKeyRefSource,
    config.anthropicApiKeyRefProvider,
    config.anthropicApiKeyRefId,
  );
  const openaiApiKeyRef = buildSecretRef(
    config.openaiApiKeyRefSource,
    config.openaiApiKeyRefProvider,
    config.openaiApiKeyRefId,
  );
  const telegramBotTokenRef = buildSecretRef(
    config.telegramBotTokenRefSource,
    config.telegramBotTokenRefProvider,
    config.telegramBotTokenRefId,
  );
  const agentNameError = validateAgentName(config.agentName);
  const validationErrors: string[] = [];
  if (!config.agentName.trim()) {
    validationErrors.push("Agent Name is required.");
  } else if (agentNameError) {
    validationErrors.push(agentNameError);
  }
  if (config.sandboxEnabled && !config.sandboxSshTarget.trim()) {
    validationErrors.push("SSH Target is required when the SSH sandbox backend is enabled.");
  }
  if (config.sandboxEnabled && !config.sandboxSshIdentityPath.trim()) {
    validationErrors.push("SSH Private Key is required when the SSH sandbox backend is enabled.");
  }
  if (config.sandboxEnabled && !hasSandboxToolSelection) {
    validationErrors.push("Select at least one sandbox tool group or disable custom sandbox tool baseline.");
  }
  if (isClusterMode && !defaults?.k8sAvailable) {
    validationErrors.push("No Kubernetes cluster detected.");
  }
  if (config.secretsProvidersJson.trim()) {
    try {
      const parsed = JSON.parse(config.secretsProvidersJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        validationErrors.push("Secret providers JSON must be a JSON object.");
      }
    } catch {
      validationErrors.push("Secret providers JSON is invalid.");
    }
  }
  if (config.anthropicApiKeyRefId.trim() && !anthropicApiKeyRef) {
    validationErrors.push("Anthropic SecretRef requires source, provider, and id.");
  }
  if (config.openaiApiKeyRefId.trim() && !openaiApiKeyRef) {
    validationErrors.push("OpenAI SecretRef requires source, provider, and id.");
  }
  if (config.telegramBotTokenRefId.trim() && !telegramBotTokenRef) {
    validationErrors.push("Telegram SecretRef requires source, provider, and id.");
  }

  const isValid = validationErrors.length === 0;

  return (
    <div>
      {/* Mode selector */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
          disabled={refreshing}
          onClick={() => refreshEnvironment()}
        >
          {refreshing ? "Refreshing\u2026" : "\u21BB Refresh Environment"}
        </button>
      </div>
      <div className="mode-grid">
        {displayedDeployers.map((m) => {
          const isSelected = mode === m.mode;
          return (
            <div
              key={m.mode}
              className={`mode-card ${isSelected ? "selected" : ""} ${!m.available ? "disabled" : ""}`}
              onClick={() => m.available && setMode(m.mode)}
              style={!m.available ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            >
              <div className="mode-radio">
                <span className={`radio-dot ${isSelected ? "checked" : ""}`} />
              </div>
              <div className="mode-icon">{MODE_ICONS[m.mode] || "🔌"}</div>
              <div className="mode-title">{m.title}</div>
              <div className="mode-desc">{m.description}</div>
              {!m.available && m.unavailableReason && (
                <div className="mode-unavailable-reason">{m.unavailableReason}</div>
              )}
              {isSelected && <div className="mode-selected-badge">Selected</div>}
            </div>
          );
        })}
      </div>

      {isClusterMode && (
        <div className="card" style={{ marginBottom: "1rem", padding: "0.75rem 1rem" }}>
          {defaults?.k8sAvailable ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Connected to cluster: <strong>{defaults.k8sContext}</strong>
            </div>
          ) : (
            <div style={{ color: "#e74c3c", fontSize: "0.85rem" }}>
              No Kubernetes cluster detected. Configure kubectl and ensure you are logged in.
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0 }}>Configuration</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {savedConfigs.length > 0 && (
              <select
                className="btn btn-ghost"
                style={{ cursor: "pointer" }}
                onChange={(e) => {
                  const cfg = savedConfigs.find((c) => c.name === e.target.value);
                  if (cfg) {
                    setMode(cfg.type === "k8s"
                      ? (defaults?.isOpenShift ? "openshift" : "kubernetes")
                      : "local");
                    applyVars(cfg.vars);
                    setLoadedConfigLabel(`${cfg.name} (${cfg.type === "k8s"
                      ? (defaults?.isOpenShift ? "OpenShift" : "K8s")
                      : "Local"})`);
                    setAutoLoadedEnvDir(null);
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>Load saved config...</option>
                {savedConfigs.map((c) => (
                  <option key={c.name} value={c.name}>{c.name} ({c.type === "k8s" ? "K8s" : "Local"})</option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleEnvDownload}
            >
              Save .env
            </button>
          </div>
        </div>

        {loadedConfigLabel && (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.75rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "0.75rem",
              background: "var(--bg-secondary)",
              fontSize: "0.9rem",
              color: "var(--text-secondary)",
            }}
          >
            Loaded saved config: <strong style={{ color: "var(--text-primary)" }}>{loadedConfigLabel}</strong>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Agent Name</label>
            <input
              type="text"
              placeholder="e.g., lynx"
              value={config.agentName}
              onChange={(e) => update("agentName", e.target.value)}
              style={agentNameError ? { borderColor: "#e74c3c" } : undefined}
            />
            {agentNameError ? (
              <div className="hint" style={{ color: "#e74c3c" }}>{agentNameError}</div>
            ) : (
              <div className="hint">Lowercase letters, numbers, and hyphens (e.g., my-agent)</div>
            )}
          </div>
          <div className="form-group">
            <label>Owner Prefix <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>(optional)</span></label>
            <input
              type="text"
              placeholder={defaults?.prefix || "username"}
              value={config.prefix}
              onChange={(e) => update("prefix", e.target.value)}
            />
            <div className="hint">
              Defaults to your OS username ({defaults?.prefix || "..."}).
              Used in naming: {mode === "local"
                ? `openclaw-${config.prefix || defaults?.prefix || "user"}-${config.agentName || "agent"}`
                : `${config.prefix || defaults?.prefix || "user"}-${config.agentName || "agent"}-openclaw`}
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Display Name</label>
          <input
            type="text"
            placeholder="e.g., Lynx"
            value={config.agentDisplayName}
            onChange={(e) => update("agentDisplayName", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Container Image</label>
          <input
            type="text"
            placeholder={defaultImageForProvider(inferenceProvider)}
            value={config.image}
            onChange={(e) => update("image", e.target.value)}
          />
          <div className="hint">
            Leave blank for the default image (<code>{defaultImageForProvider(inferenceProvider)}</code>).
          </div>
        </div>

        {isClusterMode && (
          <div className="form-group">
            <label>Project / Namespace</label>
            <input
              type="text"
              aria-label="Project / Namespace"
              autoComplete="off"
              placeholder={suggestedNamespace}
              value={config.namespace || ""}
              onChange={(e) => update("namespace", e.target.value)}
            />
            <div className="hint">
              {hasNonDefaultCurrentProject ? (
                <>
                  Defaults to your current <code>oc</code> project: <code>{currentClusterNamespace}</code>.
                  Generated project name if you create namespaces yourself: <code>{derivedNamespace}</code>.
                </>
              ) : (
                <>
                  Auto-filled from owner prefix and agent name: <code>{derivedNamespace}</code>.
                </>
              )}
            </div>
            {hasNonDefaultCurrentProject ? (
              <div className="hint" style={{ marginTop: "0.35rem" }}>
                Prefer the generated name{" "}
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: "0.15rem 0.5rem", fontSize: "0.85rem" }}
                  onClick={() => {
                    setNamespaceManuallyEdited(true);
                    setConfig((prev) => ({ ...prev, namespace: derivedNamespace }));
                  }}
                >
                  Use <code>{derivedNamespace}</code>
                </button>{" "}
                (only if you can create that project).
              </div>
            ) : null}
          </div>
        )}

        {isClusterMode && (
          <details style={{ marginTop: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              Kagenti A2A
              <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
                {" "}Optional: enable A2A sidecar + Kagenti namespace wiring
              </span>
            </summary>

            <div className="card" style={{ marginTop: "0.75rem" }}>
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={config.withA2a}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, withA2a: e.target.checked }))
                    }
                    style={{ width: "auto" }}
                  />
                  Enable Kagenti A2A
                </label>
                <div className="hint">
                  Assumes a Kagenti stack is already running. On OpenShift, this now assumes the cluster-admin
                  prereq was installed with <code>setup-kagenti.sh</code>; the installer adds the Kagenti label,
                  OpenClaw A2A bridge resources, and the <code>AgentCard</code> resource, while the Kagenti
                  namespace controller handles the Kagenti ConfigMaps, RoleBindings, and SCC wiring.
                </div>
              </div>

              {config.withA2a && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Keycloak Realm</label>
                      <input
                        type="text"
                        placeholder="kagenti"
                        value={config.a2aRealm}
                        onChange={(e) => update("a2aRealm", e.target.value)}
                      />
                      <div className="hint">
                        Set this to your Kagenti Keycloak realm, for example <code>lobster</code>.
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Keycloak Namespace</label>
                      <input
                        type="text"
                        placeholder="keycloak"
                        value={config.a2aKeycloakNamespace}
                        onChange={(e) => update("a2aKeycloakNamespace", e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </details>
        )}

        <details style={{ marginTop: "1.5rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Agent Options
            <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
              {" "}Optional: source directory, cron jobs, subagent spawning
            </span>
          </summary>

          <div className="card" style={{ marginTop: "0.75rem" }}>
            <div className="form-group">
              <label>Agent Source Directory</label>
              <input
                type="text"
                placeholder="/path/to/agents-dir (optional)"
                value={config.agentSourceDir}
                onChange={(e) => update("agentSourceDir", e.target.value)}
              />
              <div className="hint">
                Installer host directory with <code>workspace-*</code>, <code>skills/</code>, and optional <code>cron/jobs.json</code> to provision into the instance.
                Defaults to <code>~/.openclaw/</code> if it exists.
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={config.cronEnabled}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, cronEnabled: e.target.checked }))
                  }
                  style={{ width: "auto" }}
                />
                Enable Cron Jobs
              </label>
              <div className="hint">
                Scheduled jobs are loaded from <code>cron/jobs.json</code> in the Agent Source Directory when present.
              </div>
            </div>

            <div className="form-group">
              <label>Subagent Spawning</label>
              <select
                value={config.subagentPolicy}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    subagentPolicy: e.target.value as "none" | "self" | "unrestricted",
                  }))
                }
              >
                <option value="none">Disabled</option>
                <option value="self">Same agent only (self-delegation)</option>
                <option value="unrestricted">Unrestricted (any agent)</option>
              </select>
              <div className="hint">
                Controls whether the agent can spawn subagents.
              </div>
            </div>
          </div>
        </details>

        {mode === "local" && (
          <>
            <div className="form-group">
              <label>Port</label>
              <input
                type="text"
                placeholder="18789"
                value={config.port}
                onChange={(e) => update("port", e.target.value)}
              />
              <div className="hint">Local port for the gateway UI</div>
            </div>

            <div className="form-group">
              <label>Additional podman/docker run args <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>(optional)</span></label>
              <input
                type="text"
                placeholder="e.g., --userns=keep-id --security-opt label=disable"
                value={config.containerRunArgs}
                onChange={(e) => update("containerRunArgs", e.target.value)}
              />
              <div className="hint">
                Appended to the generated <code>{defaults?.containerRuntime || "podman"}</code> <code>run</code> command before the image name.
                Use this for extra runtime flags such as <code>--userns=keep-id</code>, <code>--device</code>, or additional <code>-v</code> mounts.
              </div>
            </div>
          </>
        )}

        {mode === "ssh" && (
          <div className="form-row">
            <div className="form-group">
              <label>SSH Host</label>
              <input
                type="text"
                placeholder="nuc.local or 192.168.1.100"
                value={config.sshHost}
                onChange={(e) => update("sshHost", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>SSH User</label>
              <input
                type="text"
                placeholder="e.g., core"
                value={config.sshUser}
                onChange={(e) => update("sshUser", e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="form-group">
          <div className="hint">
            Any credentials you enter in this form are handled using OpenClaw&apos;s SecretRef support.
            The installer injects them using the safest built-in path for your target instead of writing them
            directly into <code>openclaw.json</code>.
            {isClusterMode
              ? " For Kubernetes, they are stored in the installer-managed Kubernetes Secret and referenced automatically."
              : " On local installs, they are injected as container environment variables and referenced automatically."}
            {" "}
            <a
              href="https://docs.openclaw.ai/reference/secretref-credential-surface"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </a>.
          </div>
        </div>

        <ProviderSection
          config={config}
          defaults={defaults}
          fetchModelEndpointOptions={fetchModelEndpointOptions}
          gcpDefaults={gcpDefaults}
          inferenceProvider={inferenceProvider}
          isVertex={isVertex}
          loadingModelEndpointOptions={loadingModelEndpointOptions}
          mode={mode}
          modelEndpointOptions={modelEndpointOptions}
          modelEndpointOptionsError={modelEndpointOptionsError}
          setConfig={setConfig}
          setInferenceProvider={setInferenceProvider}
          update={update}
        />

        <h3 style={{ marginTop: "1.5rem" }}>Observability</h3>

        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.otelEnabled}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, otelEnabled: e.target.checked }))
              }
              style={{ width: "auto" }}
            />
            Enable OTEL trace collection
          </label>
          <div className="hint">
            Runs an OpenTelemetry Collector sidecar that exports traces to Jaeger, MLflow, Grafana Tempo, or any OTLP-compatible backend
          </div>
        </div>

        {config.otelEnabled && (
          <>
            {mode === "local" && (
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={config.otelJaeger}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, otelJaeger: e.target.checked }))
                    }
                    style={{ width: "auto" }}
                  />
                  Include Jaeger all-in-one (trace viewer)
                </label>
                <div className="hint">
                  Runs Jaeger as a sidecar — no external setup needed. UI at http://localhost:16686
                </div>
              </div>
            )}
            <div className="form-group">
              <label>OTLP Endpoint {config.otelJaeger && "(optional — defaults to in-pod Jaeger)"}</label>
              <input
                type="text"
                placeholder={config.otelJaeger ? "Leave blank to use Jaeger sidecar" : "http://jaeger-collector:4317 or http://mlflow:5000"}
                value={config.otelEndpoint}
                onChange={(e) => update("otelEndpoint", e.target.value)}
              />
              <div className="hint">
                {config.otelJaeger
                  ? "Override to send traces to an external backend instead of (or in addition to) the local Jaeger"
                  : "OTLP gRPC (port 4317) or HTTP (any other port) endpoint. Use gRPC for Jaeger, HTTP for MLflow / Tempo."}
              </div>
            </div>
            <div className="form-group">
              <label>MLflow Experiment ID (optional)</label>
              <input
                type="text"
                placeholder="0"
                value={config.otelExperimentId}
                onChange={(e) => update("otelExperimentId", e.target.value)}
              />
              <div className="hint">
                Only needed for MLflow endpoints. Sets the x-mlflow-experiment-id header on exported traces.
              </div>
            </div>
          </>
        )}

        <h3 style={{ marginTop: "1.5rem" }}>Channels</h3>

        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={config.telegramEnabled}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, telegramEnabled: e.target.checked }))
              }
              style={{ width: "auto" }}
            />
            Connect Telegram Bot
          </label>
          <div className="hint">
            {defaults?.hasTelegramToken
              ? "Telegram bot token detected from environment"
              : <>Create a bot via <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> on Telegram</>}
          </div>
        </div>

        {config.telegramEnabled && (
          <>
            <div className="form-group">
              <label>Telegram Bot Token</label>
              <input
                type="password"
                placeholder={defaults?.hasTelegramToken ? "(using token from environment)" : "123456:ABC-DEF..."}
                value={config.telegramBotToken}
                onChange={(e) => update("telegramBotToken", e.target.value)}
              />
              <div className="hint">
                {defaults?.hasTelegramToken
                  ? "Leave blank to use token from environment"
                  : "Bot token from @BotFather"}
              </div>
            </div>

            <div className="form-group">
              <label>Allowed Telegram User IDs</label>
              <input
                type="password"
                placeholder={defaults?.telegramAllowFrom ? "(using IDs from environment)" : "123456789, 987654321"}
                value={config.telegramAllowFrom}
                onChange={(e) => update("telegramAllowFrom", e.target.value)}
              />
              <div className="hint">
                {defaults?.telegramAllowFrom
                  ? "Leave blank to use IDs from environment"
                  : <>Comma-separated user IDs. Find yours via <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">@userinfobot</a></>}
              </div>
            </div>

          </>
        )}

        <SandboxSection
          config={config}
          update={update}
          setConfig={setConfig}
        />

        <SecretProvidersSection
          config={config}
          update={update}
        />

        <div style={{ marginTop: "1.5rem" }}>
          {!isValid && (
            <div style={{ color: "#e74c3c", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              {validationErrors.join(" ")}
            </div>
          )}
          <button
            className="btn btn-primary"
            disabled={deploying || !isValid}
            onClick={handleDeploy}
          >
            {deploying ? "Deploying..." : "Deploy OpenClaw"}
          </button>
        </div>
      </div>
    </div>
  );
}
