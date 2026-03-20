import React, { useEffect, useState } from "react";

type InferenceProvider = "anthropic" | "openai" | "vertex-anthropic" | "vertex-google" | "custom-endpoint";

interface DeployerInfo {
  mode: string;
  title: string;
  description: string;
  available: boolean;
  priority: number;
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
  vars: Record<string, string>;
}

const MODE_ICONS: Record<string, string> = {
  local: "💻",
  kubernetes: "☸️",
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
    modelEndpoint: "",
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

  const isVertex = inferenceProvider === "vertex-anthropic" || inferenceProvider === "vertex-google";

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

  // Fetch server defaults (detected env vars + K8s availability)
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => {
        const d = {
          ...(data.defaults || {}),
          k8sAvailable: data.k8sAvailable,
          k8sContext: data.k8sContext,
        };
        setDefaults(d);

        if (Array.isArray(data.deployers)) {
          const sorted = [...(data.deployers as DeployerInfo[])].sort((a, b) => {
            if (a.available !== b.available) return a.available ? -1 : 1;
            return (b.priority ?? 0) - (a.priority ?? 0);
          });
          setDeployers(sorted);
          if (sorted.length > 0 && sorted[0].available) {
            setMode(sorted[0].mode);
          }
        }

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
      })
      .catch(() => {});

    // Load saved configs from ~/.openclaw/installer/
    fetch("/api/configs")
      .then((r) => r.json())
      .then((configs: SavedConfig[]) => {
        setSavedConfigs(configs);
      })
      .catch(() => {});
  }, []);

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

  const applyVars = (vars: Record<string, string>) => {
    // Support both local .env keys (OPENCLAW_PREFIX) and K8s JSON keys (prefix)
    const v = (envKey: string, jsonKey: string) => vars[envKey] || vars[jsonKey] || "";

    // Map VERTEX_ENABLED / VERTEX_PROVIDER to inferenceProvider (both key formats)
    const vertexEnabled = vars.VERTEX_ENABLED === "true" || vars.vertexEnabled === "true";
    if (vertexEnabled) {
      const vp = vars.VERTEX_PROVIDER || vars.vertexProvider || "anthropic";
      setInferenceProvider(vp === "google" ? "vertex-google" : "vertex-anthropic");
    } else if (v("MODEL_ENDPOINT", "modelEndpoint")) {
      setInferenceProvider("custom-endpoint");
    } else if (v("OPENAI_API_KEY", "openaiApiKey")) {
      setInferenceProvider("openai");
    } else if (v("ANTHROPIC_API_KEY", "anthropicApiKey")) {
      setInferenceProvider("anthropic");
    }

    setConfig((prev) => ({
      ...prev,
      prefix: v("OPENCLAW_PREFIX", "prefix") || prev.prefix,
      agentName: v("OPENCLAW_AGENT_NAME", "agentName") || prev.agentName,
      agentDisplayName: v("OPENCLAW_DISPLAY_NAME", "agentDisplayName") || prev.agentDisplayName,
      image: v("OPENCLAW_IMAGE", "image") || prev.image,
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
      modelEndpoint: v("MODEL_ENDPOINT", "modelEndpoint") || prev.modelEndpoint,
      googleCloudProject: v("GOOGLE_CLOUD_PROJECT", "googleCloudProject") || prev.googleCloudProject,
      googleCloudLocation: v("GOOGLE_CLOUD_LOCATION", "googleCloudLocation") || prev.googleCloudLocation,
      agentSourceDir: v("AGENT_SOURCE_DIR", "agentSourceDir") || prev.agentSourceDir,
      telegramBotToken: v("TELEGRAM_BOT_TOKEN", "telegramBotToken") || prev.telegramBotToken,
      telegramAllowFrom: v("TELEGRAM_ALLOW_FROM", "telegramAllowFrom") || prev.telegramAllowFrom,
      litellmProxy: vars.litellmProxy === "false" ? false : prev.litellmProxy,
      otelEnabled: vars.OTEL_ENABLED === "true" || vars.otelEnabled === "true" || prev.otelEnabled,
      otelJaeger: vars.OTEL_JAEGER === "true" || vars.otelJaeger === "true" || prev.otelJaeger,
      otelEndpoint: v("OTEL_ENDPOINT", "otelEndpoint") || prev.otelEndpoint,
      otelExperimentId: v("OTEL_EXPERIMENT_ID", "otelExperimentId") || prev.otelExperimentId,
      otelImage: v("OTEL_IMAGE", "otelImage") || prev.otelImage,
    }));
  };

  const [displayNameManuallyEdited, setDisplayNameManuallyEdited] = useState(false);
  const [agentNameManuallyEdited, setAgentNameManuallyEdited] = useState(false);

  const update = (field: string, value: string) => {
    if (field === "agentName") {
      setAgentNameManuallyEdited(true);
    }
    if (field === "agentDisplayName") {
      setDisplayNameManuallyEdited(true);
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
        prefix: config.prefix,
        agentName: config.agentName,
        agentDisplayName: config.agentDisplayName || config.agentName,
        image: config.image || undefined,
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
        anthropicApiKey: inferenceProvider === "anthropic" ? config.anthropicApiKey || undefined : undefined,
        openaiApiKey: (inferenceProvider === "openai" || inferenceProvider === "custom-endpoint") ? config.openaiApiKey || undefined : undefined,
        agentModel: config.agentModel || undefined,
        modelEndpoint: inferenceProvider === "custom-endpoint" ? config.modelEndpoint || undefined : undefined,
        port: parseInt(config.port, 10) || 18789,
        vertexEnabled: vertexEnabled || undefined,
        vertexProvider: vertexEnabled ? vertexProvider : undefined,
        googleCloudProject: vertexEnabled ? config.googleCloudProject : undefined,
        googleCloudLocation: vertexEnabled ? config.googleCloudLocation : undefined,
        gcpServiceAccountJson: vertexEnabled ? config.gcpServiceAccountJson || undefined : undefined,
        gcpServiceAccountPath: vertexEnabled ? config.gcpServiceAccountPath || undefined : undefined,
        litellmProxy: vertexEnabled ? config.litellmProxy : undefined,
        namespace: config.namespace || undefined,
        sshHost: config.sshHost || undefined,
        sshUser: config.sshUser || undefined,
        agentSourceDir: config.agentSourceDir || undefined,
        telegramEnabled: config.telegramEnabled || undefined,
        telegramBotToken: config.telegramEnabled ? config.telegramBotToken || undefined : undefined,
        telegramAllowFrom: config.telegramEnabled ? config.telegramAllowFrom || undefined : undefined,
        otelEnabled: config.otelEnabled || undefined,
        otelJaeger: config.otelEnabled ? config.otelJaeger || undefined : undefined,
        otelEndpoint: config.otelEnabled ? config.otelEndpoint || undefined : undefined,
        otelExperimentId: config.otelEnabled ? config.otelExperimentId || undefined : undefined,
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
      `ANTHROPIC_API_KEY=${config.anthropicApiKey}`,
      `OPENAI_API_KEY=${config.openaiApiKey}`,
      `MODEL_ENDPOINT=${config.modelEndpoint}`,
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
      `TELEGRAM_BOT_TOKEN=${config.telegramBotToken}`,
      `TELEGRAM_ALLOW_FROM=${config.telegramAllowFrom}`,
      `OTEL_ENABLED=${config.otelEnabled}`,
      `OTEL_JAEGER=${config.otelJaeger}`,
      `OTEL_ENDPOINT=${config.otelEndpoint}`,
      `OTEL_EXPERIMENT_ID=${config.otelExperimentId}`,
      "",
      `K8S_NAMESPACE=${config.namespace}`,
    ];

    if (config.sandboxSshCertificate && !config.sandboxSshCertificatePath) {
      lines.push(`SANDBOX_SSH_CERTIFICATE_B64=${encodeBase64(config.sandboxSshCertificate)}`);
    }
    if (config.sandboxSshKnownHosts && !config.sandboxSshKnownHostsPath) {
      lines.push(`SANDBOX_SSH_KNOWN_HOSTS_B64=${encodeBase64(config.sandboxSshKnownHosts)}`);
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

  const validationErrors: string[] = [];
  if (!config.agentName.trim()) {
    validationErrors.push("Agent Name is required.");
  }
  if (config.sandboxEnabled && !config.sandboxSshTarget.trim()) {
    validationErrors.push("SSH Target is required when the SSH sandbox backend is enabled.");
  }
  if (config.sandboxEnabled && !hasSandboxToolSelection) {
    validationErrors.push("Select at least one sandbox tool group or disable custom sandbox tool baseline.");
  }
  if (mode === "kubernetes" && !defaults?.k8sAvailable) {
    validationErrors.push("No Kubernetes cluster detected.");
  }

  const isValid = validationErrors.length === 0;

  return (
    <div>
      {/* Mode selector */}
      <div className="mode-grid">
        {deployers.map((m) => {
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
              {isSelected && <div className="mode-selected-badge">Selected</div>}
            </div>
          );
        })}
      </div>

      {mode === "kubernetes" && (
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
                    setMode(cfg.type === "k8s" ? "kubernetes" : "local");
                    applyVars(cfg.vars);
                    setLoadedConfigLabel(`${cfg.name} (${cfg.type === "k8s" ? "K8s" : "Local"})`);
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
            />
            <div className="hint">Your agent's identity</div>
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

        {mode === "local" && (
          <div className="form-group">
            <label>Agent Source Directory</label>
            <input
              type="text"
              placeholder="/path/to/agents-dir (optional)"
              value={config.agentSourceDir}
              onChange={(e) => update("agentSourceDir", e.target.value)}
            />
            <div className="hint">
              Host directory with <code>workspace-*</code>, <code>skills/</code>, and <code>cron/jobs.json</code> to provision into the instance.
              Defaults to <code>~/.openclaw/</code> if it exists.
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Container Image</label>
          <input
            type="text"
            placeholder="ghcr.io/openclaw/openclaw:latest"
            value={config.image}
            onChange={(e) => update("image", e.target.value)}
          />
          <div className="hint">
            Leave blank for the default image (ghcr.io/openclaw/openclaw:latest).
          </div>
        </div>

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
              <label>
                SSH Private Key
                <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
                  {" "}(optional)
                </span>
              </label>
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

        {mode === "kubernetes" && (
          <div className="form-group">
            <label>Namespace</label>
            <input
              type="text"
              autoComplete="off"
              placeholder={`${config.prefix || defaults?.prefix || "user"}-${config.agentName || "agent"}-openclaw`}
              value={config.namespace || ""}
              onChange={(e) => setConfig((prev) => ({ ...prev, namespace: e.target.value }))}
            />
            <div className="hint">
              Leave blank to auto-generate (e.g., <code>{config.prefix || defaults?.prefix || "user"}-{config.agentName || "agent"}-openclaw</code>)
            </div>
          </div>
        )}

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

        <h3 style={{ marginTop: "1.5rem" }}>Inference Provider</h3>

        <div className="form-group">
          <label>Provider</label>
          <select
            value={inferenceProvider}
            onChange={(e) => setInferenceProvider(e.target.value as InferenceProvider)}
          >
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <div className="hint">
            {PROVIDER_OPTIONS.find((p) => p.id === inferenceProvider)?.desc}
          </div>
        </div>

        {inferenceProvider === "anthropic" && (
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
                : "Your Anthropic API key"}
            </div>
          </div>
        )}

        {inferenceProvider === "openai" && (
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
                : "Your OpenAI API key"}
            </div>
          </div>
        )}

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
                        // Auto-fill project ID if empty
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
                  image (<code>ghcr.io/berriai/litellm:main-latest</code>, ~1.5 GB).
                  This may take several minutes. You can pre-pull
                  with: <code>{mode === "kubernetes" ? "crictl pull" : "podman pull"} ghcr.io/berriai/litellm:main-latest</code>
                </div>
              )}
            </div>
          </>
        )}

        {inferenceProvider === "custom-endpoint" && (
          <>
            <div className="form-group">
              <label>Endpoint URL</label>
              <input
                type="text"
                placeholder="http://vllm.openclaw-llms.svc.cluster.local/v1"
                value={config.modelEndpoint}
                onChange={(e) => update("modelEndpoint", e.target.value)}
              />
              <div className="hint">
                OpenAI-compatible endpoint URL for your self-hosted model server
              </div>
            </div>
            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={defaults?.hasOpenaiKey ? "(using key from environment)" : "Optional — if your endpoint requires auth"}
                value={config.openaiApiKey}
                onChange={(e) => update("openaiApiKey", e.target.value)}
              />
              <div className="hint">
                {defaults?.hasOpenaiKey
                  ? "Detected OPENAI_API_KEY from server environment — leave blank to use it"
                  : "Sent as the Bearer token to your endpoint (leave blank if not required)"}
              </div>
            </div>
          </>
        )}

        <div className="form-group">
          <label>Model</label>
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
              ? "Custom model override"
              : isVertex && config.litellmProxy
                ? `Leave blank for default (routed through LiteLLM proxy). ${PROXY_MODEL_HINTS[inferenceProvider] || MODEL_HINTS[inferenceProvider]}`
                : `Leave blank for default${MODEL_DEFAULTS[inferenceProvider] ? ` (${MODEL_DEFAULTS[inferenceProvider]})` : ""}. ${MODEL_HINTS[inferenceProvider]}`}
          </div>
        </div>

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

        <div style={{ marginTop: "1.5rem" }}>
          {!isValid && (
            <div style={{ color: "#e74c3c", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              {validationErrors.join(" ")}
            </div>
          )}
          <button
            className="btn btn-primary"
            disabled={deploying}
            onClick={handleDeploy}
          >
            {deploying ? "Deploying..." : "Deploy OpenClaw"}
          </button>
        </div>
      </div>
    </div>
  );
}
