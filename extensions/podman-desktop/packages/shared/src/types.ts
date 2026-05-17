export const DEFAULT_GATEWAY_PORT = 18789;
export const DEFAULT_OPENCLAW_IMAGE = 'ghcr.io/openclaw/openclaw:latest';

export interface LaunchConfig {
  agent: {
    name: string;
    prefix: string;
    port: number;
    image: string;
  };
  provider: ProviderConfig;
  workspace: WorkspaceFiles;
  agentSourceDir?: string;
  observability?: ObservabilityConfig;
  chromium?: { enabled: boolean };
  sandbox?: SandboxConfig;
  telegram?: { enabled: boolean; botToken: string };
}

export type ProviderConfig =
  | { type: 'anthropic'; apiKey: string }
  | { type: 'openai'; apiKey: string }
  | { type: 'gemini'; apiKey: string }
  | { type: 'codex' }
  | { type: 'vertex'; saJsonPath: string; region: string; project: string; vertexProvider: 'anthropic' | 'google' }
  | { type: 'custom'; baseUrl: string; apiKey: string; model: string }
  | { type: 'openrouter'; apiKey: string };

export interface WorkspaceFiles {
  agents?: string;
  soul?: string;
  identity?: string;
  tools?: string;
  user?: string;
  heartbeat?: string;
  memory?: string;
}

export interface ObservabilityConfig {
  enabled: boolean;
  endpoint?: string;
  experimentId?: string;
  jaeger?: boolean;
}

export interface SandboxConfig {
  enabled: boolean;
  mode: 'all' | 'non-main' | 'off';
  scope: 'session' | 'agent' | 'shared';
  sshTarget: string;
  identityKey: string;
  certificate?: string;
  knownHosts?: string;
  workspaceRoot?: string;
  workspaceAccess: 'none' | 'ro' | 'rw';
}

export interface DeployProgress {
  step: string;
  message: string;
  complete: boolean;
  error?: string;
}

export interface LaunchResult {
  gatewayUrl: string;
  gatewayToken: string;
  containerId: string;
  podId?: string;
}

export interface PlatformInfo {
  os: string;
  podmanAvailable: boolean;
}

export interface CodexAuthStatus {
  exists: boolean;
  path: string;
}

export interface GcpDefaults {
  projectId: string | null;
  location: string | null;
  serviceAccountJsonPath: string | null;
  serviceAccountJson: string | null;
  credentialType: string | null;
  sources: {
    projectId?: string;
    location?: string;
    credentials?: string;
  };
}

export interface RpcRequest<T = unknown> {
  id: number;
  method: string;
  params?: T;
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface ProgressMessage extends DeployProgress {
  channel: 'deployProgress';
}
