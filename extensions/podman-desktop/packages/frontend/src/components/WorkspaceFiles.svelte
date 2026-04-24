<script lang="ts">
  import { api } from '../api.js';
  import type { WorkspaceFiles as WF } from 'openclaw-podman-shared';

  let { workspace = $bindable(), agentSourceDir = $bindable() } = $props();
  let open = $state(false);
  let loaded = $state(false);

  async function loadDefaults() {
    if (loaded) return;
    const defaults = await api.getDefaultWorkspaceFiles();
    workspace = { ...defaults, ...workspace };
    loaded = true;
  }

  function handleToggle() {
    open = !open;
    if (open && !loaded) loadDefaults();
  }

  const files = [
    { key: 'agents' as const, label: 'AGENTS.md' },
    { key: 'soul' as const, label: 'SOUL.md' },
    { key: 'identity' as const, label: 'IDENTITY.md' },
    { key: 'tools' as const, label: 'TOOLS.md' },
    { key: 'user' as const, label: 'USER.md' },
    { key: 'heartbeat' as const, label: 'HEARTBEAT.md' },
    { key: 'memory' as const, label: 'MEMORY.md' },
  ];
</script>

<div class="border border-[var(--pd-content-divider,#333)] rounded">
  <button onclick={handleToggle}
    class="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-[var(--pd-content-text,#ccc)] hover:bg-[var(--pd-content-card-bg,#252525)]">
    <span>Workspace Files</span>
    <span class="text-xs">{open ? '▼' : '▶'}</span>
  </button>
  {#if open}
    <div class="px-4 pb-4 space-y-3">
      {#each files as f}
        <label class="block">
          <span class="pd-label">{f.label}</span>
          <textarea bind:value={workspace[f.key]} rows="3" class="mt-1 pd-textarea"></textarea>
        </label>
      {/each}
      <label class="block">
        <span class="pd-label">Agent Source Directory (optional, mounted read-only)</span>
        <input type="text" bind:value={agentSourceDir} placeholder="/path/to/agent-source" class="mt-1 pd-input" />
      </label>
    </div>
  {/if}
</div>
