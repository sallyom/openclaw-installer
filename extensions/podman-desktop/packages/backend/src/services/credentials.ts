import * as crypto from 'node:crypto';
import type { LaunchConfig, ProviderConfig } from 'openclaw-podman-shared';

export function generateGatewayToken(): string {
  return crypto.randomBytes(32).toString('base64');
}

export function generateLitellmMasterKey(): string {
  return 'sk-litellm-' + crypto.randomBytes(24).toString('hex');
}

export function buildProviderEnvVars(provider: ProviderConfig, litellmMasterKey?: string): Record<string, string> {
  const env: Record<string, string> = {};

  switch (provider.type) {
    case 'anthropic':
      env.ANTHROPIC_API_KEY = provider.apiKey;
      break;
    case 'openai':
      env.OPENAI_API_KEY = provider.apiKey;
      break;
    case 'gemini':
      env.GEMINI_API_KEY = provider.apiKey;
      break;
    case 'codex':
      break;
    case 'vertex':
      if (litellmMasterKey) {
        env.LITELLM_API_KEY = litellmMasterKey;
      }
      env.GOOGLE_APPLICATION_CREDENTIALS = '/home/node/.openclaw/gcp/sa.json';
      break;
    case 'custom':
      env.MODEL_ENDPOINT = provider.baseUrl;
      env.MODEL_ENDPOINT_API_KEY = provider.apiKey;
      break;
    case 'openrouter':
      env.OPENROUTER_API_KEY = provider.apiKey;
      break;
  }

  return env;
}

export function buildGatewayEnvVars(config: LaunchConfig, litellmMasterKey?: string): Record<string, string> {
  const env: Record<string, string> = {
    HOME: '/home/node',
    NODE_ENV: 'production',
    ...buildProviderEnvVars(config.provider, litellmMasterKey),
  };

  if (config.telegram?.enabled && config.telegram.botToken) {
    env.TELEGRAM_BOT_TOKEN = config.telegram.botToken;
  }

  if (config.observability?.enabled) {
    env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf';
  }

  if (config.chromium?.enabled) {
    env.CHROME_CDP_URL = 'http://localhost:9222';
  }

  if (config.sandbox?.enabled) {
    env.SANDBOX_ENABLED = 'true';
    env.SANDBOX_BACKEND = 'ssh';
    env.SANDBOX_MODE = config.sandbox.mode;
    env.SANDBOX_SCOPE = config.sandbox.scope;
    env.SANDBOX_WORKSPACE_ACCESS = config.sandbox.workspaceAccess;
    env.SANDBOX_SSH_TARGET = config.sandbox.sshTarget;
    if (config.sandbox.workspaceRoot) {
      env.SANDBOX_SSH_WORKSPACE_ROOT = config.sandbox.workspaceRoot;
    }
    env.SANDBOX_SSH_IDENTITY_PATH = '/home/node/.openclaw/sandbox-ssh/identity';
    if (config.sandbox.certificate) {
      env.SANDBOX_SSH_CERTIFICATE_PATH = '/home/node/.openclaw/sandbox-ssh/certificate.pub';
    }
    if (config.sandbox.knownHosts) {
      env.SANDBOX_SSH_KNOWN_HOSTS_PATH = '/home/node/.openclaw/sandbox-ssh/known_hosts';
    }
  }

  return env;
}
