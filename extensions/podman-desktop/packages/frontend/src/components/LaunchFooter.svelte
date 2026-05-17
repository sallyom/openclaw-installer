<script lang="ts">
  import type { DeployProgress, LaunchResult } from 'openclaw-podman-shared';
  import { api } from '../api.js';

  let { launching, progressSteps, result, error, onLaunch }:
    { launching: boolean; progressSteps: DeployProgress[]; result: LaunchResult | null; error: string | null; onLaunch: () => void } = $props();

  let tokenVisible = $state(false);

  function copyToken() {
    if (result?.gatewayToken) {
      api.copyToClipboard(result.gatewayToken);
    }
  }

  function copyUrl() {
    if (result?.gatewayUrl) {
      api.copyToClipboard(result.gatewayUrl);
    }
  }
</script>

<footer class="fixed bottom-0 left-0 right-0 bg-[var(--pd-content-bg,#1e1e1e)] border-t border-[var(--pd-content-divider,#333)] px-6 py-3">
  {#if result}
    <div class="max-w-2xl mx-auto space-y-2">
      <div class="flex items-center gap-2 text-green-400 text-sm font-medium">
        <span>OpenClaw is running</span>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-[var(--pd-content-text,#999)]">Gateway:</span>
        <code class="text-[var(--pd-content-text,#ccc)]">{result.gatewayUrl}</code>
        <button onclick={copyUrl}
          class="text-xs px-1.5 py-0.5 rounded bg-[var(--pd-content-card-bg,#252525)] hover:bg-[var(--pd-input-field-bg,#333)] text-[var(--pd-content-text,#999)]">
          Copy
        </button>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <span class="text-[var(--pd-content-text,#999)]">Token:</span>
        <code class="text-[var(--pd-content-text,#ccc)]">{tokenVisible ? result.gatewayToken : '••••••••'}</code>
        <button onclick={() => tokenVisible = !tokenVisible}
          class="text-xs px-1.5 py-0.5 rounded bg-[var(--pd-content-card-bg,#252525)] hover:bg-[var(--pd-input-field-bg,#333)] text-[var(--pd-content-text,#999)]">
          {tokenVisible ? 'Hide' : 'Show'}
        </button>
        <button onclick={copyToken}
          class="text-xs px-1.5 py-0.5 rounded bg-[var(--pd-content-card-bg,#252525)] hover:bg-[var(--pd-input-field-bg,#333)] text-[var(--pd-content-text,#999)]">
          Copy
        </button>
      </div>
    </div>
  {:else if error}
    <div class="max-w-2xl mx-auto space-y-2">
      <div class="text-red-400 text-sm">{error}</div>
      <button onclick={onLaunch}
        class="px-4 py-2 rounded text-sm font-medium bg-[var(--pd-button-primary-bg,#7c3aed)] text-white hover:opacity-90">
        Retry
      </button>
    </div>
  {:else if launching}
    <div class="max-w-2xl mx-auto space-y-1">
      {#each progressSteps as step}
        <div class="text-xs text-[var(--pd-content-text,#999)] flex items-center gap-2">
          {#if step.complete}
            <span class="text-green-400">done</span>
          {:else if step.error}
            <span class="text-red-400">error</span>
          {:else}
            <span class="animate-pulse">...</span>
          {/if}
          <span>{step.message}</span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="max-w-2xl mx-auto">
      <button onclick={onLaunch}
        class="w-full px-4 py-2.5 rounded text-sm font-medium bg-[var(--pd-button-primary-bg,#7c3aed)] text-white hover:opacity-90 transition-opacity">
        Launch OpenClaw
      </button>
    </div>
  {/if}
</footer>
