<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api.js';
  import type { ProviderConfig, CodexAuthStatus, GcpDefaults } from 'openclaw-podman-shared';

  let { provider = $bindable() } = $props();

  const providerTypes = [
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'gemini', label: 'Google / Gemini' },
    { value: 'codex', label: 'OpenAI Codex' },
    { value: 'vertex', label: 'Vertex AI' },
    { value: 'custom', label: 'Custom Endpoint' },
    { value: 'openrouter', label: 'OpenRouter' },
  ] as const;

  let selectedType: ProviderConfig['type'] = $state(provider.type);
  let apiKey = $state('apiKey' in provider ? provider.apiKey : '');
  let baseUrl = $state(provider.type === 'custom' ? provider.baseUrl : '');
  let model = $state(provider.type === 'custom' ? provider.model : '');
  let saJsonPath = $state(provider.type === 'vertex' ? provider.saJsonPath : '');
  let region = $state(provider.type === 'vertex' ? provider.region : 'us-east5');
  let project = $state(provider.type === 'vertex' ? provider.project : '');
  let vertexProvider: 'anthropic' | 'google' = $state(provider.type === 'vertex' ? provider.vertexProvider : 'anthropic');
  let codexAuth: CodexAuthStatus | null = $state(null);
  let gcpDefaults: GcpDefaults | null = $state(null);
  let gcpAutoDetected = $state(false);

  onMount(async () => {
    codexAuth = await api.checkCodexAuth();
    gcpDefaults = await api.detectGcpDefaults();
  });

  function syncProvider() {
    switch (selectedType) {
      case 'anthropic': provider = { type: 'anthropic', apiKey }; break;
      case 'openai': provider = { type: 'openai', apiKey }; break;
      case 'gemini': provider = { type: 'gemini', apiKey }; break;
      case 'codex': provider = { type: 'codex' }; break;
      case 'vertex': provider = { type: 'vertex', saJsonPath, region, project, vertexProvider }; break;
      case 'custom': provider = { type: 'custom', baseUrl, apiKey, model }; break;
      case 'openrouter': provider = { type: 'openrouter', apiKey }; break;
    }
  }

  $effect(() => {
    // Re-sync provider config whenever any field changes
    void [selectedType, apiKey, baseUrl, model, saJsonPath, region, project, vertexProvider];
    syncProvider();
  });

  function handleTypeChange(e: Event) {
    selectedType = (e.target as HTMLSelectElement).value as ProviderConfig['type'];
    apiKey = '';
    if (selectedType === 'vertex' && gcpDefaults && !gcpAutoDetected) {
      applyGcpDefaults();
    }
  }

  function applyGcpDefaults() {
    if (!gcpDefaults) return;
    if (gcpDefaults.serviceAccountJsonPath && !saJsonPath) {
      saJsonPath = gcpDefaults.serviceAccountJsonPath;
    }
    if (gcpDefaults.projectId && !project) {
      project = gcpDefaults.projectId;
    }
    if (gcpDefaults.location && region === 'us-east5') {
      region = gcpDefaults.location;
    }
    gcpAutoDetected = true;
  }
</script>

<section class="space-y-3">
  <h2 class="text-sm font-semibold uppercase tracking-wide text-[var(--pd-content-text,#999)]">Model Provider</h2>

  <label class="block">
    <span class="pd-label">Provider</span>
    <select value={selectedType} onchange={handleTypeChange} class="mt-1 pd-select">
      {#each providerTypes as pt}
        <option value={pt.value}>{pt.label}</option>
      {/each}
    </select>
  </label>

  {#if selectedType === 'anthropic' || selectedType === 'openai' || selectedType === 'gemini' || selectedType === 'openrouter'}
    <label class="block">
      <span class="pd-label">API Key</span>
      <input type="password" bind:value={apiKey} class="mt-1 pd-input" />
    </label>
  {:else if selectedType === 'codex'}
    <div class="text-sm p-3 rounded bg-[var(--pd-content-card-bg,#252525)]">
      {#if codexAuth?.exists}
        <span class="text-green-400">Codex auth found at {codexAuth.path}</span>
      {:else}
        <span class="text-yellow-400">No Codex auth found. Run `codex auth` first.</span>
      {/if}
    </div>
  {:else if selectedType === 'vertex'}
    <div class="space-y-3">
      {#if gcpDefaults?.serviceAccountJsonPath}
        <div class="text-sm p-3 rounded bg-[var(--pd-content-card-bg,#252525)] space-y-1">
          <div class="text-green-400">GCP credentials detected</div>
          {#if gcpDefaults.credentialType}
            <div class="pd-label">Type: {gcpDefaults.credentialType}</div>
          {/if}
          {#if gcpDefaults.sources.credentials}
            <div class="pd-label">Source: {gcpDefaults.sources.credentials}</div>
          {/if}
        </div>
      {/if}
      <label class="block">
        <span class="pd-label">Vertex Provider</span>
        <select bind:value={vertexProvider} class="mt-1 pd-select">
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="google">Google (Gemini)</option>
        </select>
      </label>
      <label class="block">
        <span class="pd-label">GCP Credentials File</span>
        <input type="text" bind:value={saJsonPath} placeholder="~/.config/gcloud/application_default_credentials.json"
          class="mt-1 pd-input font-mono" />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="pd-label">GCP Project</span>
          <input type="text" bind:value={project} class="mt-1 pd-input" />
        </label>
        <label class="block">
          <span class="pd-label">GCP Region</span>
          <input type="text" bind:value={region} class="mt-1 pd-input" />
        </label>
      </div>
    </div>
  {:else if selectedType === 'custom'}
    <div class="space-y-3">
      <label class="block">
        <span class="pd-label">Base URL</span>
        <input type="text" bind:value={baseUrl} placeholder="https://api.example.com/v1" class="mt-1 pd-input" />
      </label>
      <label class="block">
        <span class="pd-label">API Key</span>
        <input type="password" bind:value={apiKey} class="mt-1 pd-input" />
      </label>
      <label class="block">
        <span class="pd-label">Model Name</span>
        <input type="text" bind:value={model} class="mt-1 pd-input" />
      </label>
    </div>
  {/if}
</section>
