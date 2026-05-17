<script lang="ts">
  let { endpoint = $bindable(), experimentId = $bindable(), jaeger = $bindable() } = $props();
</script>

<p class="pd-label">
  Adds OpenTelemetry collector sidecar for traces and metrics.
</p>
<label class="block">
  <span class="pd-label">OTEL Endpoint (optional)</span>
  <input type="text" bind:value={endpoint} placeholder="http://your-collector:4318" class="mt-1 pd-input" />
</label>
<label class="block">
  <span class="pd-label">Experiment ID (optional)</span>
  <input type="text" bind:value={experimentId} class="mt-1 pd-input" />
</label>
<label class="flex items-center gap-2">
  <input type="checkbox" bind:checked={jaeger} class="rounded" />
  <span class="text-sm text-[var(--pd-content-text,#ccc)]">Enable Jaeger UI (port 16686)</span>
</label>
