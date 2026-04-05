# Managing Credentials with Podman Secrets

> **Note:** This space is evolving fast. Here are some current solutions that
> work well for local setup — expect more options and tighter integrations over time.

The goal: no secrets at rest inside the container or data volume.

## Why Not Just Use `.env`?

Placing secrets directly in the data volume works but has a significant downside:
the volume backup (`podman volume export`) captures those secrets too. The options
below keep secrets out of the volume entirely.

---

## Option 1: Podman Secrets

Podman has a built-in secrets manager. Secrets are stored outside the container
and injected at runtime as environment variables — they never touch the volume.

### Create a secret

```bash
echo "ghp_yourtoken" | podman secret create gh_token -
```

### Inject at container start

Add `--secret` to the `podman run` command:

```bash
podman run \
  --secret gh_token,type=env,target=GH_TOKEN \
  ... # rest of your openclaw run flags
```

The secret is available inside the container as `$GH_TOKEN`. It is not written to disk.

In the openclaw-installer UI, use **Podman secret mappings** instead of typing the raw
`--secret` syntax yourself. Enter one mapping per line:

```text
gh_token=GH_TOKEN
anthropic_api_key=ANTHROPIC_API_KEY
```

The installer appends the matching `--secret <name>,type=env,target=<ENV>` flags automatically
and preserves them across Stop/Start cycles.

If you also use explicit OpenClaw `env/default/...` SecretRefs, make sure the SecretRef ID matches
the target environment variable name from the mapping.

### Manage secrets

```bash
podman secret ls                                       # list registered secrets
podman secret rm gh_token                              # delete a secret
echo "new_token" | podman secret create gh_token -     # rotate
```

### Portability note

Podman secrets are local to the machine — they do not travel with volume exports
or backups. When moving to a new host, recreate secrets before starting the container.

---

## Option 2: 1Password CLI exec Provider

For setups already using 1Password, the OpenClaw exec secrets provider can fetch
credentials live from the 1Password vault. Nothing is stored on disk.

### Prerequisites

- 1Password desktop app installed and unlocked on the host
- 1Password CLI installed: `brew install 1password-cli`
- Desktop app integration enabled: Settings → Developer → Enable CLI integration

### Store the credential in 1Password

Create an item in your vault (e.g. "OpenClaw GitHub PAT") with a field named
`credential` containing the token.

### Mount the 1Password socket into the container

```bash
-v /run/user/$(id -u)/1password/agent.sock:/run/1password/agent.sock \
-e OP_AGENT_SOCK=/run/1password/agent.sock
```

### Configure the OpenClaw exec provider

```bash
openclaw config set secrets.providers.onepassword \
  --provider-source exec \
  --provider-command op \
  --provider-arg "op://Personal/OpenClaw GitHub PAT/credential" \
  --provider-timeout-ms 5000
```

OpenClaw calls `op read` at session start. The resolved value is injected into the
process environment and never written to disk. To rotate: update the item in 1Password.

---

## Option 3: HashiCorp Vault exec Provider

For setups using HashiCorp Vault, the same OpenClaw exec provider pattern applies.

### Prerequisites

- Vault CLI installed and authenticated (`vault login`)
- Vault server accessible from the container

### Mount Vault token into the container

```bash
-e VAULT_ADDR=https://vault.example.com \
-e VAULT_TOKEN=<your-token>
```

Or mount a token file:

```bash
-v ~/.vault-token:/home/node/.vault-token:ro
```

### Configure the OpenClaw exec provider

```bash
openclaw config set secrets.providers.vault \
  --provider-source exec \
  --provider-command vault \
  --provider-arg kv \
  --provider-arg get \
  --provider-arg -field=value \
  --provider-arg secret/openclaw/gh-token \
  --provider-timeout-ms 5000
```

---

## Naming Conventions

Use consistent secret names so scripts and docs are predictable:

| Purpose | Podman secret name | Env var in container |
|---|---|---|
| GitHub PAT | `gh_token` | `GH_TOKEN` |
| Anthropic API key | `anthropic_api_key` | `ANTHROPIC_API_KEY` |
| OpenAI API key | `openai_api_key` | `OPENAI_API_KEY` |
| Telegram bot token | `telegram_bot_token` | `TELEGRAM_BOT_TOKEN` |
| OpenClaw gateway token | `openclaw_gateway_token` | `OPENCLAW_GATEWAY_TOKEN` |

---

## Summary

| Approach | Secret at rest? | Travels with volume backup? |
|---|---|---|
| Podman secrets | No (Podman store) | No |
| 1Password exec provider | No (fetched live) | No |
| HashiCorp Vault exec provider | No (fetched live) | No |
