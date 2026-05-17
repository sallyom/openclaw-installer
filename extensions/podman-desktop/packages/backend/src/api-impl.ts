import type { RpcServer } from './rpc/setup.js';
import { RPC_METHODS } from 'openclaw-podman-shared';
import type { PlatformInfo, CodexAuthStatus, GcpDefaults, WorkspaceFiles, LaunchConfig, LaunchResult } from 'openclaw-podman-shared';
import { deploy } from './services/deployer.js';
import * as podmanDesktopAPI from '@podman-desktop/api';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export function registerAllHandlers(rpcServer: RpcServer): void {
  rpcServer.registerMethod(RPC_METHODS.getPlatformInfo, async (): Promise<PlatformInfo> => {
    const connections = podmanDesktopAPI.provider.getContainerConnections();
    const hasPodman = connections.some(c => c.connection.type === 'podman');
    return {
      os: process.platform,
      podmanAvailable: hasPodman,
    };
  });

  rpcServer.registerMethod(RPC_METHODS.checkCodexAuth, async (): Promise<CodexAuthStatus> => {
    const codexPath = path.join(os.homedir(), '.codex', 'auth.json');
    return {
      exists: fs.existsSync(codexPath),
      path: codexPath,
    };
  });

  rpcServer.registerMethod(RPC_METHODS.detectGcpDefaults, async (): Promise<GcpDefaults> => {
    const PROJECT_ID_VARS = [
      'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'ANTHROPIC_VERTEX_PROJECT_ID',
      'CLOUD_SDK_PROJECT', 'GOOGLE_VERTEX_PROJECT',
    ];
    const LOCATION_VARS = ['GOOGLE_CLOUD_LOCATION', 'GOOGLE_VERTEX_LOCATION'];

    const result: GcpDefaults = {
      projectId: null, location: null,
      serviceAccountJsonPath: null, serviceAccountJson: null,
      credentialType: null, sources: {},
    };

    for (const v of PROJECT_ID_VARS) {
      if (process.env[v]) { result.projectId = process.env[v]!; result.sources.projectId = v; break; }
    }
    for (const v of LOCATION_VARS) {
      if (process.env[v]) { result.location = process.env[v]!; result.sources.location = v; break; }
    }

    const credPaths = [
      ...(process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? [{ path: process.env.GOOGLE_APPLICATION_CREDENTIALS, source: `GOOGLE_APPLICATION_CREDENTIALS` }]
        : []),
      { path: path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'), source: 'gcloud ADC' },
    ];

    for (const { path: p, source } of credPaths) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf-8');
          const parsed = JSON.parse(content);
          result.serviceAccountJsonPath = p;
          result.serviceAccountJson = content;
          result.credentialType = typeof parsed.type === 'string' ? parsed.type : null;
          result.sources.credentials = source;
          if (!result.projectId && typeof parsed.project_id === 'string' && parsed.project_id) {
            result.projectId = parsed.project_id;
            result.sources.projectId = `${source} (project_id)`;
          }
          if (!result.projectId && typeof parsed.quota_project_id === 'string' && parsed.quota_project_id) {
            result.projectId = parsed.quota_project_id;
            result.sources.projectId = `${source} (quota_project_id)`;
          }
          break;
        } catch { /* invalid JSON, skip */ }
      }
    }

    if (!result.projectId) {
      const gcloudConfigPath = path.join(os.homedir(), '.config', 'gcloud', 'configurations', 'config_default');
      if (fs.existsSync(gcloudConfigPath)) {
        try {
          const content = fs.readFileSync(gcloudConfigPath, 'utf-8');
          const match = content.match(/^project\s*=\s*(.+)$/m);
          if (match) {
            result.projectId = match[1].trim();
            result.sources.projectId = 'gcloud config_default';
          }
        } catch { /* skip */ }
      }
    }

    return result;
  });

  rpcServer.registerMethod(RPC_METHODS.getDefaultWorkspaceFiles, async (): Promise<WorkspaceFiles> => {
    return {
      agents: '# Agent Instructions\n\nYou are a helpful AI assistant.',
      soul: '# Soul\n\nBe helpful, harmless, and honest.',
      identity: '# Identity\n\nAI Assistant',
      tools: '# Tools\n\nUse available tools to help the user.',
      user: '# User\n\nThe user is a developer.',
      heartbeat: '# Heartbeat\n\nCheck in periodically.',
      memory: '# Memory\n\nRemember important context.',
    };
  });

  rpcServer.registerMethod(RPC_METHODS.copyToClipboard, async (params: unknown): Promise<void> => {
    const { text } = params as { text: string };
    await podmanDesktopAPI.env.clipboard.writeText(text);
  });

  rpcServer.registerMethod(RPC_METHODS.launch, async (params: unknown): Promise<LaunchResult> => {
    if (!params || typeof params !== 'object') throw new Error('Invalid launch config');
    const p = params as Record<string, unknown>;
    if (!p.agent || typeof p.agent !== 'object') throw new Error('Missing agent configuration');
    if (!p.provider || typeof p.provider !== 'object') throw new Error('Missing provider configuration');
    const config = params as LaunchConfig;
    return deploy(config, rpcServer);
  });
}
