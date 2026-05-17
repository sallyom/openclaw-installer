<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, enabled = $bindable(), children }: { title: string; enabled: boolean; children: Snippet } = $props();
  let open = $state(false);

  function handleToggle() {
    enabled = !enabled;
    if (enabled) open = true;
    if (!enabled) open = false;
  }
</script>

<div class="border border-[var(--pd-content-divider,#333)] rounded">
  <div class="flex items-center justify-between px-4 py-2.5">
    <button onclick={() => { if (enabled) open = !open; }}
      class="flex items-center gap-2 text-sm font-medium text-[var(--pd-content-text,#ccc)]">
      {#if enabled}
        <span class="text-xs">{open ? '▼' : '▶'}</span>
      {/if}
      <span>{title}</span>
    </button>
    <label class="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={enabled} onchange={handleToggle} class="sr-only peer" />
      <div class="w-9 h-5 bg-[var(--pd-input-field-bg,#333)] peer-focus:outline-none rounded-full peer peer-checked:bg-[var(--pd-button-primary-bg,#7c3aed)] after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
    </label>
  </div>
  {#if enabled && open}
    <div class="px-4 pb-4 space-y-3">
      {@render children()}
    </div>
  {/if}
</div>
