<script lang="ts">
  let { botToken = $bindable() } = $props();
</script>

<label class="block">
  <span class="pd-label">Bot Token</span>
  <input type="password" bind:value={botToken} class="mt-1 pd-input" />
</label>
