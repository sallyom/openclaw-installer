import type { PodmanSecretMapping } from "../../shared/podman-secrets.js";

export type DeployMode = string;
export type BuiltinDeployMode = "local" | "kubernetes" | "ssh" | "fleet";
export type InferenceProvider =
  | "anthropic"
  | "openai"
  | "vertex-anthropic"
  | "vertex-google"
  | "custom-endpoint";
export type SecretRefSource = "env" | "file" | "exec";

export interface DeploySecretRef {
  source: SecretRefSource;
  provider: string;
  id: string;
}

export interface DeployModelOption {
  id: string;
  name?: string;
}

export interface DeployConfig {
  mode: DeployMode;
  // Common
  agentName: string;
  agentDisplayName: string;
  prefix?: string;
  // Agent security / upstream SecretRefs
  agentSecurityMode?: "basic" | "secretrefs";
  secretsProvidersJson?: string;
  anthropicApiKeyRef?: DeploySecretRef;
  openaiApiKeyRef?: DeploySecretRef;
  telegramBotTokenRef?: DeploySecretRef;
  // Sandbox
  sandboxEnabled?: boolean;
  sandboxMode?: "off" | "non-main" | "all";
  sandboxScope?: "session" | "agent" | "shared";
  sandboxWorkspaceAccess?: "none" | "ro" | "rw";
  sandboxBackend?: "ssh";
  sandboxToolPolicyEnabled?: boolean;
  sandboxToolAllowFiles?: boolean;
  sandboxToolAllowSessions?: boolean;
  sandboxToolAllowMemory?: boolean;
  sandboxToolAllowRuntime?: boolean;
  sandboxToolAllowBrowser?: boolean;
  sandboxToolAllowAutomation?: boolean;
  sandboxToolAllowMessaging?: boolean;
  sandboxSshTarget?: string;
  sandboxSshWorkspaceRoot?: string;
  sandboxSshStrictHostKeyChecking?: boolean;
  sandboxSshUpdateHostKeys?: boolean;
  sandboxSshIdentity?: string;
  sandboxSshIdentityPath?: string;
  sandboxSshCertificate?: string;
  sandboxSshCertificatePath?: string;
  sandboxSshKnownHosts?: string;
  sandboxSshKnownHostsPath?: string;
  // Model provider (all optional — without them, agents use in-cluster model)
  anthropicApiKey?: string;
  openaiApiKey?: string;
  anthropicModel?: string;
  openaiModel?: string;
  anthropicModels?: string[];
  openaiModels?: string[];
  inferenceProvider?: InferenceProvider;
  agentModel?: string;
  vertexAnthropicModel?: string;
  vertexAnthropicModels?: string[];
  vertexGoogleModel?: string;
  vertexGoogleModels?: string[];
  modelFallbacks?: string[];
  openaiCompatibleEndpointsEnabled?: boolean;
  modelEndpoint?: string;
  modelEndpointApiKey?: string;
  modelEndpointModel?: string;
  modelEndpointModelLabel?: string;
  modelEndpointModels?: DeployModelOption[];
  // Vertex AI
  vertexEnabled?: boolean;
  vertexProvider?: "google" | "anthropic"; // google = Gemini, anthropic = Claude via Vertex
  googleCloudProject?: string;
  googleCloudLocation?: string;
  gcpServiceAccountJson?: string; // raw JSON content of GCP service account key file
  gcpServiceAccountPath?: string; // absolute path to SA JSON file (server reads it)
  // LiteLLM proxy sidecar (default: true when Vertex + SA JSON)
  litellmProxy?: boolean;
  litellmImage?: string;
  // OTEL collector sidecar (trace export)
  otelEnabled?: boolean;
  otelEndpoint?: string;       // OTLP endpoint (e.g. http://jaeger:4317 or http://mlflow:5000)
  otelExperimentId?: string;   // MLflow experiment ID (optional, for MLflow endpoints)
  otelImage?: string;
  otelJaeger?: boolean;        // Run Jaeger all-in-one as a sidecar (UI on port 16686)
  // Agent security
  cronEnabled?: boolean; // default: false (opt-in)
  subagentPolicy?: "none" | "self" | "unrestricted"; // default: "none"
  // Telegram channel
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramAllowFrom?: string; // comma-separated user IDs
  // Local mode
  containerRuntime?: "podman" | "docker";
  containerRunArgs?: string;
  podmanSecretMappings?: PodmanSecretMapping[];
  image?: string;
  port?: number;
  agentSourceDir?: string; // Host directory with workspace-*, skills/, and cron/jobs.json to provision
  // Kubernetes mode
  namespace?: string;
  withA2a?: boolean;
  a2aRealm?: string;
  a2aKeycloakNamespace?: string;
  // SSH mode
  sshHost?: string;
  sshUser?: string;
  sshKeyPath?: string;
}

export interface DeployResult {
  id: string;
  mode: DeployMode;
  status: "running" | "stopped" | "failed" | "deploying" | "error" | "unknown";
  config: DeployConfig;
  startedAt: string;
  hasLocalState?: boolean;
  url?: string;
  containerId?: string;
  volumeName?: string;
  error?: string;
  // K8s-specific
  statusDetail?: string;
  pods?: Array<{
    name: string;
    phase: string;
    ready: boolean;
    restarts: number;
    containerStatus: string;
    message: string;
  }>;
}

export type LogCallback = (line: string) => void;

export interface Deployer {
  deploy(config: DeployConfig, log: LogCallback): Promise<DeployResult>;
  start(result: DeployResult, log: LogCallback): Promise<DeployResult>;
  status(result: DeployResult): Promise<DeployResult>;
  stop(result: DeployResult, log: LogCallback): Promise<void>;
  teardown(result: DeployResult, log: LogCallback): Promise<void>;
}
