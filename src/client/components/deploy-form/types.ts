export type InferenceProvider =
  | "anthropic"
  | "openai"
  | "vertex-anthropic"
  | "vertex-google"
  | "custom-endpoint";

export type SecretRefSource = "env" | "file" | "exec";

export interface SecretRefValue {
  source: SecretRefSource;
  provider: string;
  id: string;
}

export interface DeployerInfo {
  mode: string;
  title: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
  priority: number;
  builtIn: boolean;
  enabled: boolean;
}

export interface DeployFormProps {
  onDeployStarted: (deployId: string) => void;
}

export interface ServerDefaults {
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
  hasTelegramToken: boolean;
  telegramAllowFrom: string;
  modelEndpoint: string;
  prefix: string;
  image: string;
  containerRuntime?: string;
  k8sAvailable?: boolean;
  k8sContext?: string;
  k8sNamespace?: string;
  isOpenShift?: boolean;
}

export interface GcpDefaults {
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

export interface SavedConfig {
  name: string;
  type: "local" | "k8s";
  vars: Record<string, unknown>;
}

export interface ModelEndpointOption {
  id: string;
  name: string;
}

export type SubagentPolicy = "none" | "self" | "unrestricted";

export interface DeployFormConfig {
  prefix: string;
  agentName: string;
  agentDisplayName: string;
  image: string;
  containerRunArgs: string;
  secretsProvidersJson: string;
  anthropicApiKeyRefSource: SecretRefSource;
  anthropicApiKeyRefProvider: string;
  anthropicApiKeyRefId: string;
  openaiApiKeyRefSource: SecretRefSource;
  openaiApiKeyRefProvider: string;
  openaiApiKeyRefId: string;
  telegramBotTokenRefSource: SecretRefSource;
  telegramBotTokenRefProvider: string;
  telegramBotTokenRefId: string;
  sandboxEnabled: boolean;
  sandboxMode: string;
  sandboxScope: string;
  sandboxWorkspaceAccess: string;
  sandboxToolPolicyEnabled: boolean;
  sandboxToolAllowFiles: boolean;
  sandboxToolAllowSessions: boolean;
  sandboxToolAllowMemory: boolean;
  sandboxToolAllowRuntime: boolean;
  sandboxToolAllowBrowser: boolean;
  sandboxToolAllowAutomation: boolean;
  sandboxToolAllowMessaging: boolean;
  sandboxSshTarget: string;
  sandboxSshWorkspaceRoot: string;
  sandboxSshStrictHostKeyChecking: boolean;
  sandboxSshUpdateHostKeys: boolean;
  sandboxSshIdentityPath: string;
  sandboxSshCertificate: string;
  sandboxSshCertificatePath: string;
  sandboxSshKnownHosts: string;
  sandboxSshKnownHostsPath: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  anthropicModel: string;
  openaiModel: string;
  agentModel: string;
  openaiCompatibleEndpointsEnabled: boolean;
  modelEndpoint: string;
  modelEndpointApiKey: string;
  modelEndpointModel: string;
  modelEndpointModelLabel: string;
  modelEndpointModels: ModelEndpointOption[];
  port: string;
  googleCloudProject: string;
  googleCloudLocation: string;
  gcpServiceAccountJson: string;
  gcpServiceAccountPath: string;
  sshHost: string;
  sshUser: string;
  agentSourceDir: string;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramAllowFrom: string;
  cronEnabled: boolean;
  subagentPolicy: SubagentPolicy;
  namespace: string;
  withA2a: boolean;
  a2aRealm: string;
  a2aKeycloakNamespace: string;
  litellmProxy: boolean;
  otelEnabled: boolean;
  otelJaeger: boolean;
  otelEndpoint: string;
  otelExperimentId: string;
}
