import * as crypto from 'node:crypto';
import type { LaunchConfig, ProviderConfig } from 'openclaw-podman-shared';

const GCP_SA_PATH = '/home/node/.openclaw/gcp/sa.json';
const LITELLM_CONFIG_PATH = '/home/node/.openclaw/litellm/config.yaml';
const LITELLM_KEY_PATH = '/home/node/.openclaw/litellm/master-key';
const SANDBOX_SSH_DIR = '/home/node/.openclaw/sandbox-ssh';

function esc(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export function agentId(config: LaunchConfig): string {
  return `${config.agent.prefix}_${config.agent.name}`;
}

export function containerName(config: LaunchConfig): string {
  return `openclaw-${config.agent.prefix}-${config.agent.name}`.toLowerCase();
}

export function volumeName(config: LaunchConfig): string {
  return `openclaw-${config.agent.prefix}-${config.agent.name}-data`.toLowerCase();
}

export function podName(config: LaunchConfig): string {
  return `openclaw-${config.agent.prefix}-${config.agent.name}-pod`.toLowerCase();
}

function deriveModelId(provider: ProviderConfig): string {
  switch (provider.type) {
    case 'anthropic': return 'claude-sonnet-4-6';
    case 'openai': return 'gpt-4o';
    case 'gemini': return 'gemini-2.5-pro';
    case 'codex': return 'codex';
    case 'vertex':
      return provider.vertexProvider === 'google' ? 'gemini-2.5-pro' : 'litellm/claude-sonnet-4-6';
    case 'custom': return provider.model;
    case 'openrouter': return 'openrouter/auto';
  }
}

function buildOpenClawJson(config: LaunchConfig, gatewayToken: string, litellmMasterKey?: string): string {
  const id = agentId(config);
  const port = config.agent.port;
  const modelId = deriveModelId(config.provider);
  const isVertex = config.provider.type === 'vertex';

  const obj: Record<string, unknown> = {
    plugins: {
      entries: {
        acpx: { enabled: false },
        ...(isVertex ? { litellm: { enabled: true } } : {}),
        ...(config.observability?.enabled ? { 'diagnostics-otel': { enabled: true } } : {}),
      },
    },
    gateway: {
      mode: 'local',
      auth: { mode: 'token', token: gatewayToken },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
          responses: { enabled: true },
        },
      },
      controlUi: {
        enabled: true,
        allowedOrigins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
      },
    },
    agents: {
      defaults: {
        workspace: '~/.openclaw/workspace',
        model: { primary: modelId },
      },
      list: [
        {
          id,
          name: config.agent.name,
          identity: { name: config.agent.name },
          workspace: `~/.openclaw/workspace-${id}`,
          model: { primary: modelId },
          subagents: { allowAgents: [] },
        },
      ],
    },
    skills: {
      load: {
        extraDirs: ['~/.openclaw/skills'],
        watch: true,
        watchDebounceMs: 1000,
      },
    },
    cron: { enabled: false },
  };

  if (isVertex && litellmMasterKey) {
    const vertexConfig = config.provider as { type: 'vertex'; vertexProvider: 'anthropic' | 'google' };
    const models = vertexConfig.vertexProvider === 'google'
      ? [{ id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' }, { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' }]
      : [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' }];

    (obj as Record<string, unknown>).models = {
      providers: {
        litellm: {
          baseUrl: 'http://localhost:4000/v1',
          api: 'openai-completions',
          models,
        },
      },
    };
  }

  if (config.chromium?.enabled) {
    (obj as Record<string, unknown>).browser = {
      enabled: true,
      defaultProfile: 'openclaw',
      profiles: {
        openclaw: {
          cdpUrl: 'http://localhost:9222',
          attachOnly: true,
        },
      },
    };
  }

  return JSON.stringify(obj, null, 2);
}

export function generateLitellmConfigYaml(config: LaunchConfig, masterKey: string): string {
  if (config.provider.type !== 'vertex') return '';
  const { region, project, vertexProvider } = config.provider;

  const models = vertexProvider === 'google'
    ? ['gemini-2.5-pro', 'gemini-2.5-flash']
    : ['claude-sonnet-4-6', 'claude-haiku-4-5'];

  const modelList = models.map(m =>
    `  - model_name: ${m}\n    litellm_params:\n      model: vertex_ai/${m}\n      vertex_project: "${project}"\n      vertex_location: "${region}"`
  ).join('\n');

  return `model_list:\n${modelList}\n\ngeneral_settings:\n  master_key: "${masterKey}"\n`;
}

export function buildInitScript(config: LaunchConfig, gatewayToken: string, litellmMasterKey?: string, saJsonContent?: string): string {
  const id = agentId(config);
  const workspaceDir = `/home/node/.openclaw/workspace-${id}`;
  const ocConfig = buildOpenClawJson(config, gatewayToken, litellmMasterKey);
  const heredocDelim = `EOF_${crypto.randomBytes(8).toString('hex')}`;

  const lines: string[] = [
    '#!/bin/sh',
    'set -e',
    '',
    `echo '${esc(ocConfig)}' > /home/node/.openclaw/openclaw.json`,
    '',
    `mkdir -p '${workspaceDir}'`,
    `touch '${workspaceDir}/.env'`,
    'mkdir -p /home/node/.openclaw/skills',
    '',
  ];

  const ws = config.workspace;
  const writeFile = (name: string, content: string | undefined, alwaysOverwrite: boolean) => {
    if (!content) return;
    if (alwaysOverwrite) {
      lines.push(`cat > '${workspaceDir}/${name}' << '${heredocDelim}'`);
      lines.push(content);
      lines.push(heredocDelim);
    } else {
      lines.push(`test -f '${workspaceDir}/${name}' || cat > '${workspaceDir}/${name}' << '${heredocDelim}'`);
      lines.push(content);
      lines.push(heredocDelim);
    }
  };

  writeFile('AGENTS.md', ws.agents || '# Agent Instructions\n\nYou are a helpful AI assistant.', true);
  writeFile('SOUL.md', ws.soul || '# Soul\n\nBe helpful, harmless, and honest.', false);
  writeFile('IDENTITY.md', ws.identity || `# Identity\n\n${config.agent.name}`, false);
  writeFile('TOOLS.md', ws.tools || '# Tools\n\nUse available tools to help the user.', false);
  writeFile('USER.md', ws.user || '# User\n\nThe user is a developer.', false);
  writeFile('HEARTBEAT.md', ws.heartbeat || '# Heartbeat\n\nCheck in periodically.', false);
  writeFile('MEMORY.md', ws.memory || '# Memory\n\nRemember important context.', false);

  const agentJson = JSON.stringify({
    name: `${config.agent.prefix}_${config.agent.name}`,
    display_name: config.agent.name,
    description: 'AI assistant on this OpenClaw instance',
    color: '#3498DB',
    capabilities: ['chat', 'help', 'general-knowledge'],
    tags: ['assistant', 'general'],
    version: '1.0.0',
  }, null, 2);
  lines.push(`cat > '${workspaceDir}/agent.json' << '${heredocDelim}'`);
  lines.push(agentJson);
  lines.push(heredocDelim);

  if (config.provider.type === 'vertex' && saJsonContent) {
    lines.push('');
    lines.push("mkdir -p '/home/node/.openclaw/gcp'");
    lines.push(`cat > '${GCP_SA_PATH}' << '${heredocDelim}'`);
    lines.push(saJsonContent);
    lines.push(heredocDelim);
    lines.push(`chmod 600 '${GCP_SA_PATH}'`);

    if (litellmMasterKey) {
      const litellmYaml = generateLitellmConfigYaml(config, litellmMasterKey);
      lines.push('');
      lines.push("mkdir -p '/home/node/.openclaw/litellm'");
      lines.push(`cat > '${LITELLM_CONFIG_PATH}' << '${heredocDelim}'`);
      lines.push(litellmYaml);
      lines.push(heredocDelim);
      lines.push(`echo -n '${esc(litellmMasterKey)}' > '${LITELLM_KEY_PATH}'`);
      lines.push(`chmod 600 '${LITELLM_CONFIG_PATH}' '${LITELLM_KEY_PATH}'`);
    }
  }

  if (config.sandbox?.enabled) {
    lines.push('');
    lines.push(`mkdir -p '${SANDBOX_SSH_DIR}'`);
    lines.push(`cat > '${SANDBOX_SSH_DIR}/identity' << '${heredocDelim}'`);
    lines.push(config.sandbox.identityKey);
    lines.push(heredocDelim);
    lines.push(`chmod 600 '${SANDBOX_SSH_DIR}/identity'`);
    if (config.sandbox.certificate) {
      lines.push(`cat > '${SANDBOX_SSH_DIR}/certificate.pub' << '${heredocDelim}'`);
      lines.push(config.sandbox.certificate);
      lines.push(heredocDelim);
      lines.push(`chmod 600 '${SANDBOX_SSH_DIR}/certificate.pub'`);
    }
    if (config.sandbox.knownHosts) {
      lines.push(`cat > '${SANDBOX_SSH_DIR}/known_hosts' << '${heredocDelim}'`);
      lines.push(config.sandbox.knownHosts);
      lines.push(heredocDelim);
      lines.push(`chmod 600 '${SANDBOX_SSH_DIR}/known_hosts'`);
    }
  }

  lines.push('');
  lines.push('chown -R node:node /home/node/.openclaw 2>/dev/null || true');
  lines.push('chmod -R o-rwx /home/node/.openclaw 2>/dev/null || true');

  return lines.join('\n');
}
