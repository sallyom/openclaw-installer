import {
  decodeBase64,
  decodeJsonBase64,
  encodeBase64,
  trimToUndefined,
} from "./utils.js";
import type {
  DeployFormConfig,
  InferenceProvider,
  ModelEndpointOption,
  SecretRefValue,
} from "./types.js";

export function createInitialDeployFormConfig(): DeployFormConfig {
  return {
    prefix: "",
    agentName: "",
    agentDisplayName: "",
    image: "",
    containerRunArgs: "",
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
    anthropicModel: "",
    openaiModel: "",
    agentModel: "",
    openaiCompatibleEndpointsEnabled: true,
    modelEndpoint: "",
    modelEndpointApiKey: "",
    modelEndpointModel: "",
    modelEndpointModelLabel: "",
    modelEndpointModels: [],
    port: "18789",
    googleCloudProject: "",
    googleCloudLocation: "",
    gcpServiceAccountJson: "",
    gcpServiceAccountPath: "",
    sshHost: "",
    sshUser: "",
    agentSourceDir: "",
    telegramEnabled: false,
    telegramBotToken: "",
    telegramAllowFrom: "",
    cronEnabled: false,
    subagentPolicy: "none",
    namespace: "",
    withA2a: false,
    a2aRealm: "",
    a2aKeycloakNamespace: "keycloak",
    litellmProxy: true,
    otelEnabled: false,
    otelJaeger: false,
    otelEndpoint: "",
    otelExperimentId: "",
  };
}

function getStringVar(vars: Record<string, unknown>, envKey: string, jsonKey: string): string {
  const value = vars[envKey] ?? vars[jsonKey];
  return typeof value === "string" ? value : "";
}

function decodeSecretRefVar(
  vars: Record<string, unknown>,
  b64Key: string,
  jsonKey: "anthropicApiKeyRef" | "openaiApiKeyRef" | "telegramBotTokenRef",
): SecretRefValue | undefined {
  const decoded = decodeJsonBase64<SecretRefValue>(vars[b64Key] as string | undefined);
  if (decoded) return decoded;
  const raw = vars[jsonKey];
  return typeof raw === "object" && raw ? (raw as SecretRefValue) : undefined;
}

function decodeEndpointModelsVar(vars: Record<string, unknown>): ModelEndpointOption[] | undefined {
  const decoded = decodeJsonBase64<ModelEndpointOption[]>(vars.MODEL_ENDPOINT_MODELS_B64 as string | undefined);
  if (decoded) return decoded;
  return Array.isArray(vars.modelEndpointModels)
    ? (vars.modelEndpointModels as ModelEndpointOption[])
    : undefined;
}

function decodeSecretsProvidersJson(vars: Record<string, unknown>): string {
  const decoded = decodeBase64(vars.SECRETS_PROVIDERS_JSON_B64 as string | undefined);
  if (decoded) return decoded;
  return typeof vars.secretsProvidersJson === "string" ? vars.secretsProvidersJson : "";
}

export function inferSavedInferenceProvider(vars: Record<string, unknown>): InferenceProvider | undefined {
  const savedInferenceProvider = getStringVar(vars, "INFERENCE_PROVIDER", "inferenceProvider");
  if (
    savedInferenceProvider === "anthropic"
    || savedInferenceProvider === "openai"
    || savedInferenceProvider === "vertex-anthropic"
    || savedInferenceProvider === "vertex-google"
    || savedInferenceProvider === "custom-endpoint"
  ) {
    return savedInferenceProvider;
  }

  const anthropicApiKeyRef = decodeSecretRefVar(vars, "ANTHROPIC_API_KEY_REF_B64", "anthropicApiKeyRef");
  const openaiApiKeyRef = decodeSecretRefVar(vars, "OPENAI_API_KEY_REF_B64", "openaiApiKeyRef");
  const vertexEnabled = vars.VERTEX_ENABLED === "true" || vars.vertexEnabled === "true";
  if (vertexEnabled) {
    const vertexProvider = vars.VERTEX_PROVIDER || vars.vertexProvider || "anthropic";
    return vertexProvider === "google" ? "vertex-google" : "vertex-anthropic";
  }
  if (getStringVar(vars, "MODEL_ENDPOINT", "modelEndpoint") || openaiApiKeyRef) {
    return "custom-endpoint";
  }
  if (getStringVar(vars, "ANTHROPIC_API_KEY", "anthropicApiKey") || anthropicApiKeyRef) {
    return "anthropic";
  }
  if (getStringVar(vars, "OPENAI_API_KEY", "openaiApiKey") || openaiApiKeyRef) {
    return "openai";
  }
  return undefined;
}

export function applySavedVarsToConfig(
  vars: Record<string, unknown>,
  prev: DeployFormConfig,
): { config: DeployFormConfig; namespaceManuallyEdited: boolean } {
  const anthropicApiKeyRef = decodeSecretRefVar(vars, "ANTHROPIC_API_KEY_REF_B64", "anthropicApiKeyRef");
  const openaiApiKeyRef = decodeSecretRefVar(vars, "OPENAI_API_KEY_REF_B64", "openaiApiKeyRef");
  const telegramBotTokenRef = decodeSecretRefVar(vars, "TELEGRAM_BOT_TOKEN_REF_B64", "telegramBotTokenRef");
  const savedProvidersJson = decodeSecretsProvidersJson(vars);
  const explicitNamespace = getStringVar(vars, "K8S_NAMESPACE", "namespace");
  const savedEndpointModels = decodeEndpointModelsVar(vars);

  return {
    namespaceManuallyEdited: Boolean(explicitNamespace),
    config: {
      ...prev,
      prefix: getStringVar(vars, "OPENCLAW_PREFIX", "prefix") || prev.prefix,
      agentName: getStringVar(vars, "OPENCLAW_AGENT_NAME", "agentName") || prev.agentName,
      agentDisplayName: getStringVar(vars, "OPENCLAW_DISPLAY_NAME", "agentDisplayName") || prev.agentDisplayName,
      image: getStringVar(vars, "OPENCLAW_IMAGE", "image") || prev.image,
      containerRunArgs: getStringVar(vars, "OPENCLAW_CONTAINER_RUN_ARGS", "containerRunArgs") || prev.containerRunArgs,
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
      sandboxMode: getStringVar(vars, "SANDBOX_MODE", "sandboxMode") || prev.sandboxMode,
      sandboxScope: getStringVar(vars, "SANDBOX_SCOPE", "sandboxScope") || prev.sandboxScope,
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
        getStringVar(vars, "SANDBOX_WORKSPACE_ACCESS", "sandboxWorkspaceAccess") || prev.sandboxWorkspaceAccess,
      sandboxSshTarget:
        getStringVar(vars, "SANDBOX_SSH_TARGET", "sandboxSshTarget") || prev.sandboxSshTarget,
      sandboxSshWorkspaceRoot:
        getStringVar(vars, "SANDBOX_SSH_WORKSPACE_ROOT", "sandboxSshWorkspaceRoot") || prev.sandboxSshWorkspaceRoot,
      sandboxSshIdentityPath:
        getStringVar(vars, "SANDBOX_SSH_IDENTITY_PATH", "sandboxSshIdentityPath") || prev.sandboxSshIdentityPath,
      sandboxSshCertificatePath:
        getStringVar(vars, "SANDBOX_SSH_CERTIFICATE_PATH", "sandboxSshCertificatePath") || prev.sandboxSshCertificatePath,
      sandboxSshKnownHostsPath:
        getStringVar(vars, "SANDBOX_SSH_KNOWN_HOSTS_PATH", "sandboxSshKnownHostsPath") || prev.sandboxSshKnownHostsPath,
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
        decodeBase64(vars.SANDBOX_SSH_CERTIFICATE_B64 as string | undefined)
        || getStringVar(vars, "sandboxSshCertificate", "sandboxSshCertificate")
        || prev.sandboxSshCertificate,
      sandboxSshKnownHosts:
        decodeBase64(vars.SANDBOX_SSH_KNOWN_HOSTS_B64 as string | undefined)
        || getStringVar(vars, "sandboxSshKnownHosts", "sandboxSshKnownHosts")
        || prev.sandboxSshKnownHosts,
      port: getStringVar(vars, "OPENCLAW_PORT", "port") || prev.port,
      anthropicModel: getStringVar(vars, "ANTHROPIC_MODEL", "anthropicModel") || prev.anthropicModel,
      openaiModel: getStringVar(vars, "OPENAI_MODEL", "openaiModel") || prev.openaiModel,
      agentModel: getStringVar(vars, "AGENT_MODEL", "agentModel") || prev.agentModel,
      openaiCompatibleEndpointsEnabled:
        vars.OPENAI_COMPATIBLE_ENDPOINTS_ENABLED === "false"
          ? false
          : vars.openaiCompatibleEndpointsEnabled === false
            ? false
            : prev.openaiCompatibleEndpointsEnabled,
      modelEndpoint: getStringVar(vars, "MODEL_ENDPOINT", "modelEndpoint") || prev.modelEndpoint,
      modelEndpointApiKey:
        getStringVar(vars, "MODEL_ENDPOINT_API_KEY", "modelEndpointApiKey") || prev.modelEndpointApiKey,
      modelEndpointModel:
        getStringVar(vars, "MODEL_ENDPOINT_MODEL", "modelEndpointModel") || prev.modelEndpointModel,
      modelEndpointModelLabel:
        getStringVar(vars, "MODEL_ENDPOINT_MODEL_LABEL", "modelEndpointModelLabel") || prev.modelEndpointModelLabel,
      modelEndpointModels: savedEndpointModels || prev.modelEndpointModels,
      googleCloudProject:
        getStringVar(vars, "GOOGLE_CLOUD_PROJECT", "googleCloudProject") || prev.googleCloudProject,
      googleCloudLocation:
        getStringVar(vars, "GOOGLE_CLOUD_LOCATION", "googleCloudLocation") || prev.googleCloudLocation,
      agentSourceDir: getStringVar(vars, "AGENT_SOURCE_DIR", "agentSourceDir") || prev.agentSourceDir,
      telegramBotToken:
        getStringVar(vars, "TELEGRAM_BOT_TOKEN", "telegramBotToken") || prev.telegramBotToken,
      telegramAllowFrom:
        getStringVar(vars, "TELEGRAM_ALLOW_FROM", "telegramAllowFrom") || prev.telegramAllowFrom,
      namespace: explicitNamespace || prev.namespace,
      withA2a: vars.WITH_A2A === "true" || vars.withA2a === "true" || prev.withA2a,
      a2aRealm: getStringVar(vars, "A2A_REALM", "a2aRealm") || prev.a2aRealm,
      a2aKeycloakNamespace:
        getStringVar(vars, "A2A_KEYCLOAK_NAMESPACE", "a2aKeycloakNamespace") || prev.a2aKeycloakNamespace,
      litellmProxy: vars.litellmProxy === "false" ? false : prev.litellmProxy,
      otelEnabled: vars.OTEL_ENABLED === "true" || vars.otelEnabled === "true" || prev.otelEnabled,
      otelJaeger: vars.OTEL_JAEGER === "true" || vars.otelJaeger === "true" || prev.otelJaeger,
      otelEndpoint: getStringVar(vars, "OTEL_ENDPOINT", "otelEndpoint") || prev.otelEndpoint,
      otelExperimentId:
        getStringVar(vars, "OTEL_EXPERIMENT_ID", "otelExperimentId") || prev.otelExperimentId,
      otelImage: prev.otelImage,
      cronEnabled: vars.cronEnabled === "true" ? true : prev.cronEnabled,
      subagentPolicy:
        (vars.subagentPolicy as DeployFormConfig["subagentPolicy"]) || prev.subagentPolicy,
    },
  };
}

export function buildDeployRequestBody(params: {
  mode: string;
  inferenceProvider: InferenceProvider;
  config: DeployFormConfig;
  isVertex: boolean;
  suggestedNamespace: string;
  anthropicApiKeyRef?: SecretRefValue;
  openaiApiKeyRef?: SecretRefValue;
  telegramBotTokenRef?: SecretRefValue;
}): Record<string, unknown> {
  const {
    mode,
    inferenceProvider,
    config,
    isVertex,
    suggestedNamespace,
    anthropicApiKeyRef,
    openaiApiKeyRef,
    telegramBotTokenRef,
  } = params;
  const vertexProvider = inferenceProvider === "vertex-google" ? "google" : "anthropic";

  return {
    mode,
    inferenceProvider,
    prefix: config.prefix,
    agentName: config.agentName,
    agentDisplayName: config.agentDisplayName || config.agentName,
    image: trimToUndefined(config.image),
    containerRunArgs: mode === "local" ? trimToUndefined(config.containerRunArgs) : undefined,
    secretsProvidersJson: trimToUndefined(config.secretsProvidersJson),
    anthropicApiKeyRef,
    openaiApiKeyRef,
    telegramBotTokenRef: config.telegramEnabled ? telegramBotTokenRef : undefined,
    sandboxEnabled: config.sandboxEnabled || undefined,
    sandboxBackend: config.sandboxEnabled ? "ssh" : undefined,
    sandboxMode: config.sandboxEnabled ? config.sandboxMode : undefined,
    sandboxScope: config.sandboxEnabled ? config.sandboxScope : undefined,
    sandboxToolPolicyEnabled:
      config.sandboxEnabled ? config.sandboxToolPolicyEnabled || undefined : undefined,
    sandboxToolAllowFiles: config.sandboxEnabled ? config.sandboxToolAllowFiles : undefined,
    sandboxToolAllowSessions: config.sandboxEnabled ? config.sandboxToolAllowSessions : undefined,
    sandboxToolAllowMemory: config.sandboxEnabled ? config.sandboxToolAllowMemory : undefined,
    sandboxToolAllowRuntime: config.sandboxEnabled ? config.sandboxToolAllowRuntime : undefined,
    sandboxToolAllowBrowser: config.sandboxEnabled ? config.sandboxToolAllowBrowser : undefined,
    sandboxToolAllowAutomation: config.sandboxEnabled ? config.sandboxToolAllowAutomation : undefined,
    sandboxToolAllowMessaging: config.sandboxEnabled ? config.sandboxToolAllowMessaging : undefined,
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
    anthropicModel: trimToUndefined(config.anthropicModel),
    openaiModel: trimToUndefined(config.openaiModel),
    agentModel: config.agentModel || undefined,
    openaiCompatibleEndpointsEnabled: config.openaiCompatibleEndpointsEnabled,
    modelEndpoint: trimToUndefined(config.modelEndpoint),
    modelEndpointApiKey: trimToUndefined(config.modelEndpointApiKey),
    modelEndpointModel: trimToUndefined(config.modelEndpointModel),
    modelEndpointModelLabel: trimToUndefined(config.modelEndpointModelLabel),
    modelEndpointModels: config.modelEndpointModels.length > 0 ? config.modelEndpointModels : undefined,
    port: parseInt(config.port, 10) || 18789,
    vertexEnabled: isVertex || undefined,
    vertexProvider: isVertex ? vertexProvider : undefined,
    googleCloudProject: isVertex ? trimToUndefined(config.googleCloudProject) : undefined,
    googleCloudLocation: isVertex ? trimToUndefined(config.googleCloudLocation) : undefined,
    gcpServiceAccountJson: isVertex ? trimToUndefined(config.gcpServiceAccountJson) : undefined,
    gcpServiceAccountPath: isVertex ? trimToUndefined(config.gcpServiceAccountPath) : undefined,
    litellmProxy: isVertex ? config.litellmProxy : undefined,
    namespace: trimToUndefined(config.namespace) || suggestedNamespace || undefined,
    withA2a: config.withA2a || undefined,
    a2aRealm: config.withA2a ? trimToUndefined(config.a2aRealm) : undefined,
    a2aKeycloakNamespace: config.withA2a ? trimToUndefined(config.a2aKeycloakNamespace) : undefined,
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
}

export function buildEnvFileContent(params: {
  config: DeployFormConfig;
  inferenceProvider: InferenceProvider;
  isVertex: boolean;
  suggestedNamespace: string;
  anthropicApiKeyRef?: SecretRefValue;
  openaiApiKeyRef?: SecretRefValue;
  telegramBotTokenRef?: SecretRefValue;
}): string {
  const {
    config,
    inferenceProvider,
    isVertex,
    suggestedNamespace,
    anthropicApiKeyRef,
    openaiApiKeyRef,
    telegramBotTokenRef,
  } = params;

  const lines = [
    "# OpenClaw installer config",
    `OPENCLAW_PREFIX=${config.prefix}`,
    `OPENCLAW_AGENT_NAME=${config.agentName}`,
    `OPENCLAW_DISPLAY_NAME=${config.agentDisplayName}`,
    `OPENCLAW_IMAGE=${config.image}`,
    `OPENCLAW_CONTAINER_RUN_ARGS=${config.containerRunArgs}`,
    `OPENCLAW_PORT=${config.port}`,
    `AGENT_SOURCE_DIR=${config.agentSourceDir}`,
    "",
    `INFERENCE_PROVIDER=${inferenceProvider}`,
    `ANTHROPIC_API_KEY=${anthropicApiKeyRef ? "" : config.anthropicApiKey}`,
    `OPENAI_API_KEY=${openaiApiKeyRef ? "" : config.openaiApiKey}`,
    `ANTHROPIC_MODEL=${config.anthropicModel}`,
    `OPENAI_MODEL=${config.openaiModel}`,
    `OPENAI_COMPATIBLE_ENDPOINTS_ENABLED=${config.openaiCompatibleEndpointsEnabled}`,
    `MODEL_ENDPOINT=${config.modelEndpoint}`,
    `MODEL_ENDPOINT_API_KEY=${config.modelEndpointApiKey}`,
    `MODEL_ENDPOINT_MODEL=${config.modelEndpointModel}`,
    `MODEL_ENDPOINT_MODEL_LABEL=${config.modelEndpointModelLabel}`,
    `MODEL_ENDPOINT_MODELS_B64=${encodeBase64(JSON.stringify(config.modelEndpointModels))}`,
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
    `WITH_A2A=${config.withA2a}`,
    `A2A_REALM=${config.a2aRealm}`,
    `A2A_KEYCLOAK_NAMESPACE=${config.a2aKeycloakNamespace}`,
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

  return lines.join("\n") + "\n";
}
