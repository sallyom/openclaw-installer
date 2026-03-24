import React, { useCallback, useEffect, useMemo, useState } from "react";
import { validateAgentName } from "../../shared/validate-agent-name.js";

type InferenceProvider = "anthropic" | "openai" | "vertex-anthropic" | "vertex-google" | "custom-endpoint";
type SecretRefSource = "env" | "file" | "exec";

interface SecretRefValue {
  source: SecretRefSource;
  provider: string;
  id: string;
}

interface DeployerInfo {
  mode: string;
  title: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
  priority: number;
  builtIn: boolean;
  enabled: boolean;
}

interface Props {
  onDeployStarted: (deployId: string) => void;
}

interface ServerDefaults {
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
  hasTelegramToken: boolean;
  telegramAllowFrom: string;
  modelEndpoint: string;
  prefix: string;
  image: string;
  k8sAvailable?: boolean;
  k8sContext?: string;
  k8sNamespace?: string;
  isOpenShift?: boolean;
}

interface GcpDefaults {
  projectId: string | null;
  location: string | null;
  hasServiceAccountJson: boolean;
  credentialType: string | null;
  sources: {
    projectId?: string;
    location?: string;
    credentials?: string;
  };
}

interface SavedConfig {
  name: string;
  type: "local" | "k8s";
  vars: Record<string, unknown>;
}

const MODE_ICONS: Record<string, string> = {
  local: "💻",
  kubernetes: "☸️",
  openshift: "☸️",
  ssh: "🖥️",
};

const PROVIDER_OPTIONS: Array<{ id: InferenceProvider; label: string; desc: string }> = [
  { id: "anthropic", label: "Anthropic", desc: "Claude models via Anthropic API" },
  { id: "openai", label: "OpenAI", desc: "GPT models via OpenAI API" },
  { id: "vertex-anthropic", label: "Google Vertex AI (Claude)", desc: "Claude models via Google Cloud" },
  { id: "vertex-google", label: "Google Vertex AI (Gemini)", desc: "Gemini models via Google Cloud" },
  { id: "custom-endpoint", label: "Model Endpoint", desc: "OpenAI-compatible self-hosted model server" },
];

const MODEL_DEFAULTS: Record<InferenceProvider, string> = {
  "anthropic": "claude-sonnet-4-6",
  "openai": "openai/gpt-5",
  "vertex-anthropic": "anthropic-vertex/claude-sonnet-4-6",
  "vertex-google": "google-vertex/gemini-2.5-pro",
  "custom-endpoint": "",
};

const MODEL_HINTS: Record<InferenceProvider, string> = {
  "anthropic": "Examples: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5",
  "openai": "Examples: openai/gpt-5, openai/gpt-5.3",
  "vertex-anthropic": "Examples: anthropic-vertex/claude-sonnet-4-6, anthropic-vertex/claude-opus-4-6",
  "vertex-google": "Examples: google-vertex/gemini-2.5-pro, google-vertex/gemini-2.5-flash",
  "custom-endpoint": "Specify the model ID served by your endpoint",
};

const PROXY_MODEL_HINTS: Record<string, string> = {
  "vertex-anthropic": "Examples: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5",
  "vertex-google": "Examples: gemini-2.5-pro, gemini-2.5-flash",
};

function defaultImageForProvider(provider: InferenceProvider): string {
  return provider === "vertex-anthropic"
    ? "ghcr.io/openclaw/openclaw:latest"
    : "ghcr.io/openclaw/openclaw:latest";
}

function decodeBase64(value: string | undefined): string {
  if (!value) return "";
  try {
    return window.atob(value);
  } catch {
    return "";
  }
}

function encodeBase64(value: string): string {
  return window.btoa(value);
}

function decodeJsonBase64<T>(value: string | undefined): T | undefined {
  const decoded = decodeBase64(value);
  if (!decoded) return undefined;
  try {
    return JSON.parse(decoded) as T;
  } catch {
    return undefined;
  }
}

function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function buildSecretRef(source: string, provider: string, id: string): SecretRefValue | undefined {
  const trimmedProvider = provider.trim();
  const trimmedId = id.trim();
  if (!source && !trimmedProvider && !trimmedId) return undefined;
  if ((source !== "env" && source !== "file" && source !== "exec") || !trimmedProvider || !trimmedId) {
    return undefined;
  }
  return {
    source,
    provider: trimmedProvider,
    id: trimmedId,
  } as SecretRefValue;
}

function inferAgentNameFromPath(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  const base = parts[parts.length - 1] || "";
  return base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferDisplayNameFromAgentName(value: string): string {
  return value
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeNamespacePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveNamespace(prefix: string, agentName: string): string {
  const cleanPrefix = sanitizeNamespacePart(prefix) || "user";
  const cleanAgent = sanitizeNamespacePart(agentName) || "agent";
  return `${cleanPrefix}-${cleanAgent}-openclaw`;
}

const LAST_AGENT_SOURCE_DIR_KEY = "openclaw:last-agent-source-dir";

export default function DeployForm({ onDeployStarted }: Props) {
  const [mode, setMode] = useState("local");
  const [deploying, setDeploying] = useState(false);
  const [defaults, setDefaults] = useState<ServerDefaults | null>(null);
  const [deployers, setDeployers] = useState<DeployerInfo[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [loadedConfigLabel, setLoadedConfigLabel] = useState<string | null>(null);
  const [autoLoadedEnvDir, setAutoLoadedEnvDir] = useState<string | null>(null);
  const [inferenceProvider, setInferenceProvider] = useState<InferenceProvider>("anthropic");
  const [config, setConfig] = useState({
    prefix: "",
    agentName: "",
    agentDisplayName: "",
    image: "",
    secretsProvidersJson: "",
    anthropicApiKeyRefSource: "env",
    anthropicApiKeyRefProvider: "default",
    anthropicApiKeyRefId: "",
    openaiApiKeyRefSource: "env",
    openaiApiKeyRefProvider: "default",
    openaiApiKeyRefId: "",
    telegramBotTokenRefSource: "env",
    telegramBotTokenRefProvider: "default",
    telegramBotTokenRefId: "",
    sandboxEnabled: false,
    sandboxMode: "all",
    sandboxScope: "session",
    sandboxWorkspaceAccess: "rw",
    sandboxToolPolicyEnabled: false,
    sandboxToolAllowFiles: true,
    sandboxToolAllowSessions: true,
    sandboxToolAllowMemory: true,
    sandboxToolAllowRuntime: false,
    sandboxToolAllowBrowser: false,
    sandboxToolAllowAutomation: false,
    sandboxToolAllowMessaging: false,
    sandboxSshTarget: "",
    sandboxSshWorkspaceRoot: "/tmp/openclaw-sandboxes",
    sandboxSshStrictHostKeyChecking: true,
    sandboxSshUpdateHostKeys: true,
    sandboxSshIdentityPath: "",
    sandboxSshCertificate: "",
    sandboxSshCertificatePath: "",
    sandboxSshKnownHosts: "",
    sandboxSshKnownHostsPath: "",
    anthropicApiKey: "",
    openaiApiKey: "",
    agentModel: "",
    openaiCompatibleEndpointsEnabled: true,
    modelEndpoint: "",
    modelEndpointApiKey: "",
    port: "18789",
    // Vertex AI / GCP
    googleCloudProject: "",
    googleCloudLocation: "",
    gcpServiceAccountJson: "",
    gcpServiceAccountPath: "",
    // SSH fields
    sshHost: "",
    sshUser: "",
    // Agent provisioning
    agentSourceDir: "",
    // Telegram
    telegramEnabled: false,
    telegramBotToken: "",
    telegramAllowFrom: "",
    // Agent security
    cronEnabled: false,
    subagentPolicy: "none" as "none" | "self" | "unrestricted",
    // Kubernetes
    namespace: "",
    // LiteLLM proxy
    litellmProxy: true,
    // OTEL tracing
    otelEnabled: false,
    otelJaeger: false,
    otelEndpoint: "",
    otelExperimentId: "",
  });

  const [gcpDefaults, setGcpDefaults] = useState<GcpDefaults | null>(null);
  const [gcpDefaultsFetched, setGcpDefaultsFetched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  const applyVars = (vars: Record<string, unknown>) => {
    // Support both local .env keys (OPENCLAW_PREFIX) and K8s JSON keys (prefix)
    const v = (envKey: string, jsonKey: string) => {
      const value = vars[envKey] ?? vars[jsonKey];
      return typeof value === "string" ? value : "";
    };
    const anthropicApiKeyRef =
      decodeJsonBase64<SecretRefValue>(vars.ANTHROPIC_API_KEY_REF_B64)
      || (typeof (vars as Record<string, unknown>).anthropicApiKeyRef === "object"
        ? (vars as unknown as { anthropicApiKeyRef?: SecretRefValue }).anthropicApiKeyRef
        : undefined);
    const openaiApiKeyRef =
      decodeJsonBase64<SecretRefValue>(vars.OPENAI_API_KEY_REF_B64)
      || (typeof (vars as Record<string, unknown>).openaiApiKeyRef === "object"
        ? (vars as unknown as { openaiApiKeyRef?: SecretRefValue }).openaiApiKeyRef
        : undefined);
    const telegramBotTokenRef =
      decodeJsonBase64<SecretRefValue>(vars.TELEGRAM_BOT_TOKEN_REF_B64)
      || (typeof (vars as Record<string, unknown>).telegramBotTokenRef === "object"
        ? (vars as unknown as { telegramBotTokenRef?: SecretRefValue }).telegramBotTokenRef
        : undefined);
    const savedProvidersJson =
      decodeBase64(vars.SECRETS_PROVIDERS_JSON_B64)
      || (typeof (vars as Record<string, unknown>).secretsProvidersJson === "string"
        ? (vars as unknown as { secretsProvidersJson?: string }).secretsProvidersJson
        : "");
    const explicitNamespace = v("K8S_NAMESPACE", "namespace");

    const savedInferenceProvider = v("INFERENCE_PROVIDER", "inferenceProvider");
    if (
      savedInferenceProvider === "anthropic"
      || savedInferenceProvider === "openai"
      || savedInferenceProvider === "vertex-anthropic"
      || savedInferenceProvider === "vertex-google"
      || savedInferenceProvider === "custom-endpoint"
    ) {
      setInferenceProvider(savedInferenceProvider);
    } else {
      const vertexEnabled = vars.VERTEX_ENABLED === "true" || vars.vertexEnabled === "true";
      if (vertexEnabled) {
        const vp = vars.VERTEX_PROVIDER || vars.vertexProvider || "anthropic";
        setInferenceProvider(vp === "google" ? "vertex-google" : "vertex-anthropic");
      } else if (v("MODEL_ENDPOINT", "modelEndpoint") || openaiApiKeyRef) {
        setInferenceProvider("custom-endpoint");
      } else if (v("ANTHROPIC_API_KEY", "anthropicApiKey") || anthropicApiKeyRef) {
        setInferenceProvider("anthropic");
      } else if (v("OPENAI_API_KEY", "openaiApiKey") || openaiApiKeyRef) {
        setInferenceProvider("openai");
      }
    }

    setNamespaceManuallyEdited(Boolean(explicitNamespace));

    setConfig((prev) => ({
      ...prev,
      prefix: v("OPENCLAW_PREFIX", "prefix") || prev.prefix,
      agentName: v("OPENCLAW_AGENT_NAME", "agentName") || prev.agentName,
      agentDisplayName: v("OPENCLAW_DISPLAY_NAME", "agentDisplayName") || prev.agentDisplayName,
      image: v("OPENCLAW_IMAGE", "image") || prev.image,
      secretsProvidersJson: savedProvidersJson || prev.secretsProvidersJson,
      anthropicApiKeyRefSource: anthropicApiKeyRef?.source || prev.anthropicApiKeyRefSource,
      anthropicApiKeyRefProvider: anthropicApiKeyRef?.provider || prev.anthropicApiKeyRefProvider,
      anthropicApiKeyRefId: anthropicApiKeyRef?.id || prev.anthropicApiKeyRefId,
      openaiApiKeyRefSource: openaiApiKeyRef?.source || prev.openaiApiKeyRefSource,
      openaiApiKeyRefProvider: openaiApiKeyRef?.provider || prev.openaiApiKeyRefProvider,
      openaiApiKeyRefId: openaiApiKeyRef?.id || prev.openaiApiKeyRefId,
      telegramBotTokenRefSource: telegramBotTokenRef?.source || prev.telegramBotTokenRefSource,
      telegramBotTokenRefProvider: telegramBotTokenRef?.provider || prev.telegramBotTokenRefProvider,
      telegramBotTokenRefId: telegramBotTokenRef?.id || prev.telegramBotTokenRefId,
      sandboxEnabled:
        vars.SANDBOX_ENABLED === "true" || vars.sandboxEnabled === "true" || prev.sandboxEnabled,
      sandboxMode: v("SANDBOX_MODE", "sandboxMode") || prev.sandboxMode,
      sandboxScope: v("SANDBOX_SCOPE", "sandboxScope") || prev.sandboxScope,
      sandboxToolPolicyEnabled:
        vars.SANDBOX_TOOL_POLICY_ENABLED === "true"
          || vars.sandboxToolPolicyEnabled === "true"
          || prev.sandboxToolPolicyEnabled,
      sandboxToolAllowFiles:
        vars.SANDBOX_TOOL_ALLOW_FILES === "false"
          ? false
          : vars.sandboxToolAllowFiles === "false"
            ? false
            : prev.sandboxToolAllowFiles,
      sandboxToolAllowSessions:
        vars.SANDBOX_TOOL_ALLOW_SESSIONS === "false"
          ? false
          : vars.sandboxToolAllowSessions === "false"
            ? false
            : prev.sandboxToolAllowSessions,
      sandboxToolAllowMemory:
        vars.SANDBOX_TOOL_ALLOW_MEMORY === "false"
          ? false
          : vars.sandboxToolAllowMemory === "false"
            ? false
            : prev.sandboxToolAllowMemory,
      sandboxToolAllowRuntime:
        vars.SANDBOX_TOOL_ALLOW_RUNTIME === "true"
          || vars.sandboxToolAllowRuntime === "true"
          || prev.sandboxToolAllowRuntime,
      sandboxToolAllowBrowser:
        vars.SANDBOX_TOOL_ALLOW_BROWSER === "true"
          || vars.sandboxToolAllowBrowser === "true"
          || prev.sandboxToolAllowBrowser,
      sandboxToolAllowAutomation:
        vars.SANDBOX_TOOL_ALLOW_AUTOMATION === "true"
          || vars.sandboxToolAllowAutomation === "true"
          || prev.sandboxToolAllowAutomation,
      sandboxToolAllowMessaging:
        vars.SANDBOX_TOOL_ALLOW_MESSAGING === "true"
          || vars.sandboxToolAllowMessaging === "true"
          || prev.sandboxToolAllowMessaging,
      sandboxWorkspaceAccess:
        v("SANDBOX_WORKSPACE_ACCESS", "sandboxWorkspaceAccess") || prev.sandboxWorkspaceAccess,
      sandboxSshTarget:
        v("SANDBOX_SSH_TARGET", "sandboxSshTarget") || prev.sandboxSshTarget,
      sandboxSshWorkspaceRoot:
        v("SANDBOX_SSH_WORKSPACE_ROOT", "sandboxSshWorkspaceRoot") ||
        prev.sandboxSshWorkspaceRoot,
      sandboxSshIdentityPath:
        v("SANDBOX_SSH_IDENTITY_PATH", "sandboxSshIdentityPath") || prev.sandboxSshIdentityPath,
      sandboxSshCertificatePath:
        v("SANDBOX_SSH_CERTIFICATE_PATH", "sandboxSshCertificatePath") ||
        prev.sandboxSshCertificatePath,
      sandboxSshKnownHostsPath:
        v("SANDBOX_SSH_KNOWN_HOSTS_PATH", "sandboxSshKnownHostsPath") ||
        prev.sandboxSshKnownHostsPath,
      sandboxSshStrictHostKeyChecking:
        vars.SANDBOX_SSH_STRICT_HOST_KEY_CHECKING === "false"
          ? false
          : vars.sandboxSshStrictHostKeyChecking === "false"
            ? false
            : prev.sandboxSshStrictHostKeyChecking,
      sandboxSshUpdateHostKeys:
        vars.SANDBOX_SSH_UPDATE_HOST_KEYS === "false"
          ? false
          : vars.sandboxSshUpdateHostKeys === "false"
            ? false
            : prev.sandboxSshUpdateHostKeys,
      sandboxSshCertificate:
        decodeBase64(vars.SANDBOX_SSH_CERTIFICATE_B64) ||
        v("sandboxSshCertificate", "sandboxSshCertificate") ||
        prev.sandboxSshCertificate,
      sandboxSshKnownHosts:
        decodeBase64(vars.SANDBOX_SSH_KNOWN_HOSTS_B64) ||
        v("sandboxSshKnownHosts", "sandboxSshKnownHosts") ||
        prev.sandboxSshKnownHosts,
      port: v("OPENCLAW_PORT", "port") || prev.port,
      agentModel: v("AGENT_MODEL", "agentModel") || prev.agentModel,
      openaiCompatibleEndpointsEnabled:
        vars.OPENAI_COMPATIBLE_ENDPOINTS_ENABLED === "false"
          ? false
          : vars.openaiCompatibleEndpointsEnabled === false
            ? false
            : prev.openaiCompatibleEndpointsEnabled,
      modelEndpoint: v("MODEL_ENDPOINT", "modelEndpoint") || prev.modelEndpoint,
      modelEndpointApiKey: v("MODEL_ENDPOINT_API_KEY", "modelEndpointApiKey") || prev.modelEndpointApiKey,
      googleCloudProject: v("GOOGLE_CLOUD_PROJECT", "googleCloudProject") || prev.googleCloudProject,
      googleCloudLocation: v("GOOGLE_CLOUD_LOCATION", "googleCloudLocation") || prev.googleCloudLocation,
      agentSourceDir: v("AGENT_SOURCE_DIR", "agentSourceDir") || prev.agentSourceDir,
      telegramBotToken: v("TELEGRAM_BOT_TOKEN", "telegramBotToken") || prev.telegramBotToken,
      telegramAllowFrom: v("TELEGRAM_ALLOW_FROM", "telegramAllowFrom") || prev.telegramAllowFrom,
      namespace: explicitNamespace || prev.namespace,
      litellmProxy: vars.litellmProxy === "false" ? false : prev.litellmProxy,
      otelEnabled: vars.OTEL_ENABLED === "true" || vars.otelEnabled === "true" || prev.otelEnabled,
      otelJaeger: vars.OTEL_JAEGER === "true" || vars.otelJaeger === "true" || prev.otelJaeger,
      otelEndpoint: v("OTEL_ENDPOINT", "otelEndpoint") || prev.otelEndpoint,
      otelExperimentId: v("OTEL_EXPERIMENT_ID", "otelExperimentId") || prev.otelExperimentId,
      otelImage: v("OTEL_IMAGE", "otelImage") || prev.otelImage,
      cronEnabled: vars.cronEnabled === "true" ? true : prev.cronEnabled,
      subagentPolicy: (vars.subagentPolicy as "none" | "self" | "unrestricted") || prev.subagentPolicy,
    }));
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

  const handleDeploy = async () => {
    if (!isValid) {
      return;
    }
    setDeploying(true);
    try {
      const vertexEnabled = isVertex;
      const vertexProvider = inferenceProvider === "vertex-google" ? "google" : "anthropic";

      const body = {
        mode,
        inferenceProvider,
        prefix: config.prefix,
        agentName: config.agentName,
        agentDisplayName: config.agentDisplayName || config.agentName,
        image: trimToUndefined(config.image),
        secretsProvidersJson: trimToUndefined(config.secretsProvidersJson),
        anthropicApiKeyRef,
        openaiApiKeyRef,
        telegramBotTokenRef:
          config.telegramEnabled ? telegramBotTokenRef : undefined,
        sandboxEnabled: config.sandboxEnabled || undefined,
        sandboxBackend: config.sandboxEnabled ? "ssh" : undefined,
        sandboxMode: config.sandboxEnabled ? config.sandboxMode : undefined,
        sandboxScope: config.sandboxEnabled ? config.sandboxScope : undefined,
        sandboxToolPolicyEnabled:
          config.sandboxEnabled ? config.sandboxToolPolicyEnabled || undefined : undefined,
        sandboxToolAllowFiles:
          config.sandboxEnabled ? config.sandboxToolAllowFiles : undefined,
        sandboxToolAllowSessions:
          config.sandboxEnabled ? config.sandboxToolAllowSessions : undefined,
        sandboxToolAllowMemory:
          config.sandboxEnabled ? config.sandboxToolAllowMemory : undefined,
        sandboxToolAllowRuntime:
          config.sandboxEnabled ? config.sandboxToolAllowRuntime : undefined,
        sandboxToolAllowBrowser:
          config.sandboxEnabled ? config.sandboxToolAllowBrowser : undefined,
        sandboxToolAllowAutomation:
          config.sandboxEnabled ? config.sandboxToolAllowAutomation : undefined,
        sandboxToolAllowMessaging:
          config.sandboxEnabled ? config.sandboxToolAllowMessaging : undefined,
        sandboxWorkspaceAccess: config.sandboxEnabled ? config.sandboxWorkspaceAccess : undefined,
        sandboxSshTarget: config.sandboxEnabled ? config.sandboxSshTarget || undefined : undefined,
        sandboxSshWorkspaceRoot:
          config.sandboxEnabled ? config.sandboxSshWorkspaceRoot || undefined : undefined,
        sandboxSshIdentityPath:
          config.sandboxEnabled ? config.sandboxSshIdentityPath || undefined : undefined,
        sandboxSshCertificatePath:
          config.sandboxEnabled ? config.sandboxSshCertificatePath || undefined : undefined,
        sandboxSshKnownHostsPath:
          config.sandboxEnabled ? config.sandboxSshKnownHostsPath || undefined : undefined,
        sandboxSshStrictHostKeyChecking:
          config.sandboxEnabled ? config.sandboxSshStrictHostKeyChecking : undefined,
        sandboxSshUpdateHostKeys:
          config.sandboxEnabled ? config.sandboxSshUpdateHostKeys : undefined,
        sandboxSshCertificate:
          config.sandboxEnabled ? config.sandboxSshCertificate || undefined : undefined,
        sandboxSshKnownHosts:
          config.sandboxEnabled ? config.sandboxSshKnownHosts || undefined : undefined,
        anthropicApiKey: !anthropicApiKeyRef ? trimToUndefined(config.anthropicApiKey) : undefined,
        openaiApiKey: !openaiApiKeyRef ? trimToUndefined(config.openaiApiKey) : undefined,
        agentModel: config.agentModel || undefined,
        openaiCompatibleEndpointsEnabled: config.openaiCompatibleEndpointsEnabled,
        modelEndpoint: trimToUndefined(config.modelEndpoint),
        modelEndpointApiKey: trimToUndefined(config.modelEndpointApiKey),
        port: parseInt(config.port, 10) || 18789,
        vertexEnabled: vertexEnabled || undefined,
        vertexProvider: vertexEnabled ? vertexProvider : undefined,
        googleCloudProject: vertexEnabled ? trimToUndefined(config.googleCloudProject) : undefined,
        googleCloudLocation: vertexEnabled ? trimToUndefined(config.googleCloudLocation) : undefined,
        gcpServiceAccountJson: vertexEnabled ? trimToUndefined(config.gcpServiceAccountJson) : undefined,
        gcpServiceAccountPath: vertexEnabled ? trimToUndefined(config.gcpServiceAccountPath) : undefined,
        litellmProxy: vertexEnabled ? config.litellmProxy : undefined,
        namespace: trimToUndefined(config.namespace) || suggestedNamespace || undefined,
        sshHost: trimToUndefined(config.sshHost),
        sshUser: trimToUndefined(config.sshUser),
        agentSourceDir: trimToUndefined(config.agentSourceDir),
        telegramEnabled: config.telegramEnabled || undefined,
        telegramBotToken:
          config.telegramEnabled && !telegramBotTokenRef ? trimToUndefined(config.telegramBotToken) : undefined,
        telegramAllowFrom: config.telegramEnabled ? trimToUndefined(config.telegramAllowFrom) : undefined,
        otelEnabled: config.otelEnabled || undefined,
        otelJaeger: config.otelEnabled ? config.otelJaeger || undefined : undefined,
        otelEndpoint: config.otelEnabled ? trimToUndefined(config.otelEndpoint) : undefined,
        otelExperimentId: config.otelEnabled ? trimToUndefined(config.otelExperimentId) : undefined,
        cronEnabled: config.cronEnabled || undefined,
        subagentPolicy: config.subagentPolicy !== "none" ? config.subagentPolicy : undefined,
      };

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
    const lines = [
      "# OpenClaw installer config",
      `OPENCLAW_PREFIX=${config.prefix}`,
      `OPENCLAW_AGENT_NAME=${config.agentName}`,
      `OPENCLAW_DISPLAY_NAME=${config.agentDisplayName}`,
      `OPENCLAW_IMAGE=${config.image}`,
      `OPENCLAW_PORT=${config.port}`,
      `AGENT_SOURCE_DIR=${config.agentSourceDir}`,
      "",
      `INFERENCE_PROVIDER=${inferenceProvider}`,
      `ANTHROPIC_API_KEY=${anthropicApiKeyRef ? "" : config.anthropicApiKey}`,
      `OPENAI_API_KEY=${openaiApiKeyRef ? "" : config.openaiApiKey}`,
      `OPENAI_COMPATIBLE_ENDPOINTS_ENABLED=${config.openaiCompatibleEndpointsEnabled}`,
      `MODEL_ENDPOINT=${config.modelEndpoint}`,
      `MODEL_ENDPOINT_API_KEY=${config.modelEndpointApiKey}`,
      `AGENT_MODEL=${config.agentModel}`,
      "",
      `VERTEX_ENABLED=${isVertex}`,
      `VERTEX_PROVIDER=${inferenceProvider === "vertex-google" ? "google" : "anthropic"}`,
      `GOOGLE_CLOUD_PROJECT=${config.googleCloudProject}`,
      `GOOGLE_CLOUD_LOCATION=${config.googleCloudLocation}`,
      `GCP_SERVICE_ACCOUNT_PATH=${config.gcpServiceAccountPath}`,
      `LITELLM_PROXY=${config.litellmProxy}`,
      "",
      `SANDBOX_ENABLED=${config.sandboxEnabled}`,
      "SANDBOX_BACKEND=ssh",
      `SANDBOX_MODE=${config.sandboxMode}`,
      `SANDBOX_SCOPE=${config.sandboxScope}`,
      `SANDBOX_WORKSPACE_ACCESS=${config.sandboxWorkspaceAccess}`,
      `SANDBOX_SSH_TARGET=${config.sandboxSshTarget}`,
      `SANDBOX_SSH_WORKSPACE_ROOT=${config.sandboxSshWorkspaceRoot}`,
      `SANDBOX_SSH_IDENTITY_PATH=${config.sandboxSshIdentityPath}`,
      `SANDBOX_SSH_CERTIFICATE_PATH=${config.sandboxSshCertificatePath}`,
      `SANDBOX_SSH_KNOWN_HOSTS_PATH=${config.sandboxSshKnownHostsPath}`,
      `SANDBOX_SSH_STRICT_HOST_KEY_CHECKING=${config.sandboxSshStrictHostKeyChecking}`,
      `SANDBOX_SSH_UPDATE_HOST_KEYS=${config.sandboxSshUpdateHostKeys}`,
      `SANDBOX_TOOL_POLICY_ENABLED=${config.sandboxToolPolicyEnabled}`,
      `SANDBOX_TOOL_ALLOW_FILES=${config.sandboxToolAllowFiles}`,
      `SANDBOX_TOOL_ALLOW_SESSIONS=${config.sandboxToolAllowSessions}`,
      `SANDBOX_TOOL_ALLOW_MEMORY=${config.sandboxToolAllowMemory}`,
      `SANDBOX_TOOL_ALLOW_RUNTIME=${config.sandboxToolAllowRuntime}`,
      `SANDBOX_TOOL_ALLOW_BROWSER=${config.sandboxToolAllowBrowser}`,
      `SANDBOX_TOOL_ALLOW_AUTOMATION=${config.sandboxToolAllowAutomation}`,
      `SANDBOX_TOOL_ALLOW_MESSAGING=${config.sandboxToolAllowMessaging}`,
      "",
      `TELEGRAM_ENABLED=${config.telegramEnabled}`,
      `TELEGRAM_BOT_TOKEN=${telegramBotTokenRef ? "" : config.telegramBotToken}`,
      `TELEGRAM_ALLOW_FROM=${config.telegramAllowFrom}`,
      `OTEL_ENABLED=${config.otelEnabled}`,
      `OTEL_JAEGER=${config.otelJaeger}`,
      `OTEL_ENDPOINT=${config.otelEndpoint}`,
      `OTEL_EXPERIMENT_ID=${config.otelExperimentId}`,
      "",
      `K8S_NAMESPACE=${config.namespace || suggestedNamespace}`,
    ];

    if (config.sandboxSshCertificate && !config.sandboxSshCertificatePath) {
      lines.push(`SANDBOX_SSH_CERTIFICATE_B64=${encodeBase64(config.sandboxSshCertificate)}`);
    }
    if (config.sandboxSshKnownHosts && !config.sandboxSshKnownHostsPath) {
      lines.push(`SANDBOX_SSH_KNOWN_HOSTS_B64=${encodeBase64(config.sandboxSshKnownHosts)}`);
    }
    if (config.secretsProvidersJson.trim()) {
      lines.push(`SECRETS_PROVIDERS_JSON_B64=${encodeBase64(config.secretsProvidersJson)}`);
    }
    if (anthropicApiKeyRef) {
      lines.push(`ANTHROPIC_API_KEY_REF_B64=${encodeBase64(JSON.stringify(anthropicApiKeyRef))}`);
    }
    if (openaiApiKeyRef) {
      lines.push(`OPENAI_API_KEY_REF_B64=${encodeBase64(JSON.stringify(openaiApiKeyRef))}`);
    }
    if (telegramBotTokenRef) {
      lines.push(`TELEGRAM_BOT_TOKEN_REF_B64=${encodeBase64(JSON.stringify(telegramBotTokenRef))}`);
    }

    const text = lines.join("\n") + "\n";
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

        <h3 style={{ marginTop: "1.5rem" }}>Inference Provider</h3>

        <div className="form-group">
          <label>Primary Provider</label>
          <select
            value={inferenceProvider}
            onChange={(e) => {
              setInferenceProvider(e.target.value as InferenceProvider);
              update("agentModel", ""); // Fix for #23: clear provider-specific model on switch
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
              <label>OpenAI / Compatible API Key</label>
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
                  : "Saved for OpenAI primary or fallback usage, and used for OpenAI-compatible endpoints when needed."}
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
                              } catch { /* ignore */ }
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
              <input
                type="text"
                placeholder="http://vllm.openclaw-llms.svc.cluster.local/v1"
                value={config.modelEndpoint}
                onChange={(e) => update("modelEndpoint", e.target.value)}
              />
              <div className="hint">
                Optional. Save a local or open-source OpenAI-compatible endpoint here for primary use or fallback routing.
              </div>
            </div>
            {config.modelEndpoint && (
              <div className="form-group">
                <label>Endpoint API Token (`MODEL_ENDPOINT_API_KEY`)</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Optional bearer token for the endpoint"
                  value={config.modelEndpointApiKey}
                  onChange={(e) => update("modelEndpointApiKey", e.target.value)}
                />
                <div className="hint">
                  Optional. Use this when the OpenAI-compatible endpoint requires a different token than your general OpenAI credential. This maps to <code>MODEL_ENDPOINT_API_KEY</code>.
                </div>
              </div>
            )}

          </div>
        </details>

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

        <h3 style={{ marginTop: "1.5rem" }}>Sandbox</h3>

        <div className="form-group">
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={config.sandboxEnabled}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, sandboxEnabled: e.target.checked }))
              }
            />
            Enable SSH sandbox backend
          </label>
          <div className="hint">
            Recommended path for this installer on both local containers and Kubernetes.
          </div>
        </div>

        {config.sandboxEnabled && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label>Sandbox Mode</label>
                <select
                  value={config.sandboxMode}
                  onChange={(e) => update("sandboxMode", e.target.value)}
                >
                  <option value="all">all</option>
                  <option value="non-main">non-main</option>
                  <option value="off">off</option>
                </select>
              </div>
              <div className="form-group">
                <label>Sandbox Scope</label>
                <select
                  value={config.sandboxScope}
                  onChange={(e) => update("sandboxScope", e.target.value)}
                >
                  <option value="session">session</option>
                  <option value="agent">agent</option>
                  <option value="shared">shared</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Workspace Access</label>
                <select
                  value={config.sandboxWorkspaceAccess}
                  onChange={(e) => update("sandboxWorkspaceAccess", e.target.value)}
                >
                  <option value="rw">rw</option>
                  <option value="ro">ro</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div className="form-group">
                <label>Remote Workspace Root</label>
                <input
                  type="text"
                  placeholder="/tmp/openclaw-sandboxes"
                  value={config.sandboxSshWorkspaceRoot}
                  onChange={(e) => update("sandboxSshWorkspaceRoot", e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolPolicyEnabled}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolPolicyEnabled: e.target.checked }))
                  }
                />
                Customize sandbox tool baseline
              </label>
              <div className="hint">
                Optional persistent baseline for sandboxed tools. This is intentionally much smaller than the full gateway UI.
              </div>
            </div>

            {config.sandboxToolPolicyEnabled && (
              <div className="form-row" style={{ flexWrap: "wrap", gap: "1rem 1.5rem", marginBottom: "1rem" }}>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxToolAllowFiles}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sandboxToolAllowFiles: e.target.checked }))
                    }
                  />
                  File tools
                </label>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxToolAllowSessions}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sandboxToolAllowSessions: e.target.checked }))
                    }
                  />
                  Session tools
                </label>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxToolAllowMemory}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sandboxToolAllowMemory: e.target.checked }))
                    }
                  />
                  Memory tools
                </label>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxToolAllowRuntime}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sandboxToolAllowRuntime: e.target.checked }))
                    }
                  />
                  Runtime tools (`exec`, `bash`, `process`)
                </label>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxToolAllowBrowser}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sandboxToolAllowBrowser: e.target.checked }))
                    }
                  />
                  Browser and canvas
                </label>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxToolAllowAutomation}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sandboxToolAllowAutomation: e.target.checked }))
                    }
                  />
                  Automation tools
                </label>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxToolAllowMessaging}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, sandboxToolAllowMessaging: e.target.checked }))
                    }
                  />
                  Messaging tools
                </label>
              </div>
            )}

            <div className="form-group">
              <label>SSH Target</label>
              <input
                type="text"
                placeholder="user@gateway-host:22"
                value={config.sandboxSshTarget}
                onChange={(e) => update("sandboxSshTarget", e.target.value)}
              />
              <div className="hint">
                Required. OpenClaw will run sandboxed tools on this remote host.
              </div>
            </div>

            <div className="form-row">
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxSshStrictHostKeyChecking}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      sandboxSshStrictHostKeyChecking: e.target.checked,
                    }))}
                />
                Strict host key checking
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxSshUpdateHostKeys}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      sandboxSshUpdateHostKeys: e.target.checked,
                    }))}
                />
                Update host keys
              </label>
            </div>

            <div className="form-group">
              <label>SSH Private Key</label>
              <input
                type="text"
                placeholder="/path/to/id_ed25519"
                value={config.sandboxSshIdentityPath}
                onChange={(e) => update("sandboxSshIdentityPath", e.target.value)}
              />
              <div className="hint">Path on the installer host to the private key file.</div>
            </div>

            <div className="form-group">
              <label>
                SSH Certificate
                <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
                  {" "}(optional)
                </span>
              </label>
              <input
                type="text"
                placeholder="/path/to/id_ed25519-cert.pub"
                value={config.sandboxSshCertificatePath}
                onChange={(e) => update("sandboxSshCertificatePath", e.target.value)}
                style={{ marginBottom: "0.5rem" }}
              />
              <textarea
                rows={4}
                placeholder="ssh-ed25519-cert-v01@openssh.com ..."
                value={config.sandboxSshCertificate}
                onChange={(e) => update("sandboxSshCertificate", e.target.value)}
              />
              <div className="hint">Type a path on the installer host, or paste the certificate directly.</div>
            </div>

            <div className="form-group">
              <label>
                Known Hosts
                <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
                  {" "}(optional)
                </span>
              </label>
              <input
                type="text"
                placeholder="/path/to/known_hosts"
                value={config.sandboxSshKnownHostsPath}
                onChange={(e) => update("sandboxSshKnownHostsPath", e.target.value)}
                style={{ marginBottom: "0.5rem" }}
              />
              <textarea
                rows={4}
                placeholder="gateway-host ssh-ed25519 AAAA..."
                value={config.sandboxSshKnownHosts}
                onChange={(e) => update("sandboxSshKnownHosts", e.target.value)}
              />
              <div className="hint">Type a path on the installer host, or paste known_hosts entries directly.</div>
            </div>
          </>
        )}

        <details style={{ marginTop: "1.5rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Advanced: Experimental External Secret Providers</summary>
          <div className="card" style={{ marginTop: "0.75rem" }}>
            <div className="hint" style={{ marginBottom: "0.75rem" }}>
              Only use this if your secrets come from an external provider such as Vault, a mounted file,
              or a custom command. Most users should leave this closed and just enter credentials in the normal fields above.
            </div>
            <div className="form-group">
              <label>Secret Providers JSON (optional)</label>
              <textarea
                rows={6}
                placeholder={`{\n  "default": { "source": "env" },\n  "vault_openai": {\n    "source": "exec",\n    "command": "/usr/local/bin/vault",\n    "args": ["kv", "get", "-field=OPENAI_API_KEY", "secret/openclaw"],\n    "passEnv": ["VAULT_ADDR", "VAULT_TOKEN"]\n  }\n}`}
                value={config.secretsProvidersJson}
                onChange={(e) => update("secretsProvidersJson", e.target.value)}
              />
              <div className="hint">
                Optional <code>secrets.providers</code> object. Runtime prerequisites still need to exist
                inside the OpenClaw environment.
              </div>
            </div>

            <div className="card" style={{ marginBottom: "1rem" }}>
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
                <div className="hint">
                  Optional override. Leave blank to use the installer-managed env-backed SecretRef automatically.
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: "1rem" }}>
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
                <div className="hint">
                  Optional override. Leave blank to use the installer-managed env-backed SecretRef automatically.
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="form-row">
                <div className="form-group">
                  <label>Telegram SecretRef Source</label>
                  <select
                    value={config.telegramBotTokenRefSource}
                    onChange={(e) => update("telegramBotTokenRefSource", e.target.value)}
                  >
                    <option value="env">env</option>
                    <option value="file">file</option>
                    <option value="exec">exec</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Telegram SecretRef Provider</label>
                  <input
                    type="text"
                    placeholder="default"
                    value={config.telegramBotTokenRefProvider}
                    onChange={(e) => update("telegramBotTokenRefProvider", e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Telegram SecretRef ID</label>
                <input
                  type="text"
                  placeholder="TELEGRAM_BOT_TOKEN or /channels/telegram/botToken or channels/telegram/botToken"
                  value={config.telegramBotTokenRefId}
                  onChange={(e) => update("telegramBotTokenRefId", e.target.value)}
                />
                <div className="hint">
                  Optional override. Leave blank to use the installer-managed env-backed SecretRef automatically.
                </div>
              </div>
            </div>
          </div>
        </details>

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
