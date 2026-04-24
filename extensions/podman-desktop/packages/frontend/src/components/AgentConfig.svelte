<script lang="ts">
  let { name = $bindable(), prefix = $bindable(), port = $bindable(), image = $bindable() } = $props();
</script>

<section class="space-y-3">
  <h2 class="text-sm font-semibold uppercase tracking-wide text-[var(--pd-content-text,#999)]">Agent Configuration</h2>
  <div class="grid grid-cols-2 gap-3">
    <label class="block">
      <span class="pd-label">Agent Name</span>
      <input type="text" bind:value={name} class="mt-1 pd-input" />
    </label>
    <label class="block">
      <span class="pd-label">Prefix</span>
      <input type="text" bind:value={prefix} class="mt-1 pd-input" />
    </label>
    <label class="block">
      <span class="pd-label">Gateway Port</span>
      <input type="number" bind:value={port} class="mt-1 pd-input" />
    </label>
    <label class="block">
      <span class="pd-label">OpenClaw Image</span>
      <input type="text" bind:value={image} class="mt-1 pd-input" />
    </label>
  </div>
</section>
