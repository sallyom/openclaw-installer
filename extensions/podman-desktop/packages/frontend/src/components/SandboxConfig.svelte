<script lang="ts">
  let {
    mode = $bindable(), scope = $bindable(),
    sshTarget = $bindable(), identityKey = $bindable(),
    certificate = $bindable(), knownHosts = $bindable(),
    workspaceRoot = $bindable(), workspaceAccess = $bindable(),
  } = $props();
</script>

<div class="space-y-3">
  <div class="grid grid-cols-2 gap-3">
    <label class="block">
      <span class="pd-label">Sandbox Mode</span>
      <select bind:value={mode} class="mt-1 pd-select">
        <option value="all">All</option>
        <option value="non-main">Non-main only</option>
        <option value="off">Off</option>
      </select>
    </label>
    <label class="block">
      <span class="pd-label">Scope</span>
      <select bind:value={scope} class="mt-1 pd-select">
        <option value="session">Session</option>
        <option value="agent">Agent</option>
        <option value="shared">Shared</option>
      </select>
    </label>
  </div>
  <label class="block">
    <span class="pd-label">SSH Target</span>
    <input type="text" bind:value={sshTarget} placeholder="user@host:22" class="mt-1 pd-input" />
  </label>
  <label class="block">
    <span class="pd-label">SSH Identity Key</span>
    <textarea bind:value={identityKey} rows="3" placeholder="Paste private key..." class="mt-1 pd-textarea"></textarea>
  </label>
  <label class="block">
    <span class="pd-label">SSH Certificate (optional)</span>
    <textarea bind:value={certificate} rows="2" class="mt-1 pd-textarea"></textarea>
  </label>
  <label class="block">
    <span class="pd-label">Known Hosts (optional)</span>
    <textarea bind:value={knownHosts} rows="2" class="mt-1 pd-textarea"></textarea>
  </label>
  <div class="grid grid-cols-2 gap-3">
    <label class="block">
      <span class="pd-label">Workspace Root</span>
      <input type="text" bind:value={workspaceRoot} placeholder="/tmp/openclaw-sandboxes" class="mt-1 pd-input" />
    </label>
    <label class="block">
      <span class="pd-label">Workspace Access</span>
      <select bind:value={workspaceAccess} class="mt-1 pd-select">
        <option value="rw">Read/Write</option>
        <option value="ro">Read Only</option>
        <option value="none">None</option>
      </select>
    </label>
  </div>
</div>
