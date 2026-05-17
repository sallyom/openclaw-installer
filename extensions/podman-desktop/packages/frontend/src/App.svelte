<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from './api.js';
  import type { PlatformInfo, LaunchConfig, LaunchResult, DeployProgress } from 'openclaw-podman-shared';
  import { DEFAULT_GATEWAY_PORT, DEFAULT_OPENCLAW_IMAGE } from 'openclaw-podman-shared';
  import AgentConfig from './components/AgentConfig.svelte';
  import ProviderSelect from './components/ProviderSelect.svelte';
  import WorkspaceFiles from './components/WorkspaceFiles.svelte';
  import SidecarSection from './components/SidecarSection.svelte';
  import ObservabilityConfig from './components/ObservabilityConfig.svelte';
  import BrowserConfig from './components/BrowserConfig.svelte';
  import SandboxConfig from './components/SandboxConfig.svelte';
  import TelegramConfig from './components/TelegramConfig.svelte';
  import LaunchFooter from './components/LaunchFooter.svelte';

  let platform: PlatformInfo | null = $state(null);
  let launching = $state(false);
  let progressSteps: DeployProgress[] = $state([]);
  let result: LaunchResult | null = $state(null);
  let error: string | null = $state(null);

  let agentName = $state('myagent');
  let agentPrefix = $state('default');
  let agentPort = $state(DEFAULT_GATEWAY_PORT);
  let agentImage = $state(DEFAULT_OPENCLAW_IMAGE);

  let provider: import('openclaw-podman-shared').ProviderConfig = $state({ type: 'anthropic', apiKey: '' });

  let workspace: import('openclaw-podman-shared').WorkspaceFiles = $state({});
  let agentSourceDir = $state('');

  let otelEnabled = $state(false);
  let otelEndpoint = $state('');
  let otelExperimentId = $state('');
  let otelJaeger = $state(false);

  let chromiumEnabled = $state(false);

  let sandboxEnabled = $state(false);
  let sandboxMode: 'all' | 'non-main' | 'off' = $state('all');
  let sandboxScope: 'session' | 'agent' | 'shared' = $state('session');
  let sandboxSshTarget = $state('');
  let sandboxIdentityKey = $state('');
  let sandboxCertificate = $state('');
  let sandboxKnownHosts = $state('');
  let sandboxWorkspaceRoot = $state('');
  let sandboxWorkspaceAccess: 'none' | 'ro' | 'rw' = $state('rw');

  let telegramEnabled = $state(false);
  let telegramBotToken = $state('');

  onMount(() => {
    api.getPlatformInfo().then(p => platform = p);

    const unsubProgress = api.onProgress((msg) => {
      progressSteps = [...progressSteps, {
        step: msg.step,
        message: msg.message,
        complete: msg.complete,
        error: msg.error,
      }];
    });

    return () => { unsubProgress(); };
  });

  function buildConfig(): LaunchConfig {
    const config: LaunchConfig = {
      agent: {
        name: agentName,
        prefix: agentPrefix,
        port: agentPort,
        image: agentImage,
      },
      provider: $state.snapshot(provider),
      workspace: $state.snapshot(workspace),
    };

    if (agentSourceDir) config.agentSourceDir = agentSourceDir;

    if (otelEnabled) {
      config.observability = {
        enabled: true,
        endpoint: otelEndpoint || undefined,
        experimentId: otelExperimentId || undefined,
        jaeger: otelJaeger,
      };
    }

    if (chromiumEnabled) {
      config.chromium = { enabled: true };
    }

    if (sandboxEnabled) {
      config.sandbox = {
        enabled: true,
        mode: sandboxMode,
        scope: sandboxScope,
        sshTarget: sandboxSshTarget,
        identityKey: sandboxIdentityKey,
        certificate: sandboxCertificate || undefined,
        knownHosts: sandboxKnownHosts || undefined,
        workspaceRoot: sandboxWorkspaceRoot || undefined,
        workspaceAccess: sandboxWorkspaceAccess,
      };
    }

    if (telegramEnabled) {
      config.telegram = { enabled: true, botToken: telegramBotToken };
    }

    return config;
  }

  async function handleLaunch() {
    launching = true;
    progressSteps = [];
    result = null;
    error = null;

    try {
      result = await api.launch(buildConfig());
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      launching = false;
    }
  }
</script>

<div class="flex flex-col h-screen bg-[var(--pd-content-bg,#1e1e1e)] text-[var(--pd-content-text,#cccccc)]">
  <header class="relative overflow-hidden border-b border-[var(--pd-content-divider,#333)]">
    <div class="absolute inset-0 bg-gradient-to-b from-[#0a0e1a] via-[#111827] to-[var(--pd-content-bg,#1e1e1e)]"></div>
    <div class="absolute inset-0" style="background: radial-gradient(ellipse at 50% 30%, rgba(255,77,77,0.12) 0%, transparent 60%);"></div>
    <div class="relative flex flex-col items-center py-6 gap-2">
      <div class="w-16 h-16 drop-shadow-[0_0_20px_rgba(255,77,77,0.4)]">
        <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lobster-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ff4d4d"/>
              <stop offset="100%" stop-color="#991b1b"/>
            </linearGradient>
          </defs>
          <path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z" fill="url(#lobster-gradient)"/>
          <path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" fill="url(#lobster-gradient)"/>
          <path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" fill="url(#lobster-gradient)"/>
          <path d="M45 15 Q35 5 30 8" stroke="#ff4d4d" stroke-width="3" stroke-linecap="round"/>
          <path d="M75 15 Q85 5 90 8" stroke="#ff4d4d" stroke-width="3" stroke-linecap="round"/>
          <circle cx="45" cy="35" r="6" fill="#050810"/>
          <circle cx="75" cy="35" r="6" fill="#050810"/>
          <circle cx="46" cy="34" r="2.5" fill="#00e5cc"/>
          <circle cx="76" cy="34" r="2.5" fill="#00e5cc"/>
        </svg>
      </div>
      <h1 class="text-3xl font-bold tracking-tight bg-gradient-to-r from-[#ffb3b3] via-[#ff8080] to-[#ff4d4d] bg-clip-text text-transparent">
        OpenClaw
      </h1>
      {#if platform}
        <span class="text-xs text-[var(--pd-content-text,#666)] bg-white/5 px-2 py-0.5 rounded">
          {platform.os === 'darwin' ? 'macOS' : 'Linux'}
        </span>
      {/if}
    </div>
  </header>

  <main class="flex-1 overflow-auto px-6 py-4 pb-24">
    <div class="max-w-2xl mx-auto space-y-6">
      <AgentConfig bind:name={agentName} bind:prefix={agentPrefix} bind:port={agentPort} bind:image={agentImage} />

      <ProviderSelect bind:provider />

      <WorkspaceFiles bind:workspace bind:agentSourceDir />

      <SidecarSection title="Observability" bind:enabled={otelEnabled}>
        {#snippet children()}
          <ObservabilityConfig bind:endpoint={otelEndpoint} bind:experimentId={otelExperimentId} bind:jaeger={otelJaeger} />
        {/snippet}
      </SidecarSection>

      <SidecarSection title="Browser Automation" bind:enabled={chromiumEnabled}>
        {#snippet children()}
          <BrowserConfig />
        {/snippet}
      </SidecarSection>

      <SidecarSection title="SSH Sandbox" bind:enabled={sandboxEnabled}>
        {#snippet children()}
          <SandboxConfig
            bind:mode={sandboxMode} bind:scope={sandboxScope}
            bind:sshTarget={sandboxSshTarget} bind:identityKey={sandboxIdentityKey}
            bind:certificate={sandboxCertificate} bind:knownHosts={sandboxKnownHosts}
            bind:workspaceRoot={sandboxWorkspaceRoot} bind:workspaceAccess={sandboxWorkspaceAccess}
          />
        {/snippet}
      </SidecarSection>

      <SidecarSection title="Telegram" bind:enabled={telegramEnabled}>
        {#snippet children()}
          <TelegramConfig bind:botToken={telegramBotToken} />
        {/snippet}
      </SidecarSection>
    </div>
  </main>

  <LaunchFooter {launching} {progressSteps} {result} {error} onLaunch={handleLaunch} />
</div>
