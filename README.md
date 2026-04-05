# OpenClaw Installer

Deploy [OpenClaw](https://github.com/openclaw) from your browser — to local containers or Kubernetes.

### From source

```bash
git clone https://github.com/sallyom/openclaw-installer.git
cd openclaw-installer
npm install && npm run build && npm run dev
```

Open `http://localhost:3000`, pick your deploy target, fill in the form, and click Deploy.

## Secret Handling

The installer now always uses upstream OpenClaw SecretRefs where it can.

- Local deploys inject secrets as container environment variables and reference them from `openclaw.json`
- Local Podman deploys can optionally derive those env vars from a guided Podman secret mapping list instead of hand-writing `--secret ...` flags
- Kubernetes and OpenShift deploys store secrets in the installer-managed `openclaw-secrets` Secret, inject them with `secretKeyRef`, and reference them from `openclaw.json`
- You can still provide explicit SecretRef overrides and optional `secrets.providers` JSON for `env`, `file`, or `exec`-based setups such as Vault

This keeps raw third-party secrets out of generated `openclaw.json` while staying aligned with upstream OpenClaw secret handling.

For local Podman installs, the recommended path is: create Podman secrets, map them in the installer, and let OpenClaw resolve them through SecretRefs. See [docs/podman-secrets.md](docs/podman-secrets.md).

### With the launcher script

```bash
./run.sh
```

Useful variants:

```bash
./run.sh --build
./run.sh --port 8080
./run.sh --runtime docker
./run.sh --plugin @acme/openclaw-installer-aws
./run.sh --plugins @acme/openclaw-installer-aws,@acme/openclaw-installer-gke
```

`run.sh` now prefers `OPENCLAW_INSTALLER_IMAGE`, while still accepting the older `CLAW_INSTALLER_IMAGE`.

## Deploy Targets

| Target | Guide | What it does |
|--------|-------|-------------|
| **Kubernetes** | [deploy-kubernetes.md](docs/deploy-kubernetes.md) | Creates namespace, PVC, ConfigMaps, Secrets, Service, and Deployment via the Kubernetes API. The Instances tab can start a managed port-forward and open the UI with the gateway token. |
| **OpenShift** | [deploy-openshift.md](provider-plugins/openshift/docs/deploy-openshift.md) | Extends Kubernetes with OAuth proxy sidecar, Route, and ServiceAccount. |
| **Local (podman / docker)** | [deploy-local.md](docs/deploy-local.md) | Pulls the image, provisions your agent, starts a container on localhost. Works on macOS and Linux. |

## Provider Plugins

Provider plugins extend the installer with platform-specific deployers. This repo supports two plugin paths:

1. **In-repo provider plugins** in `provider-plugins/`
2. **External plugins** installed as npm packages and listed in `~/.openclaw/installer/plugins.json`

In-repo provider plugins are loaded automatically at startup -- no extra install steps needed.

| Plugin | Directory | Description |
|--------|-----------|-------------|
| **OpenShift** | [`provider-plugins/openshift/`](provider-plugins/openshift/) | OAuth proxy, Routes, and ServiceAccounts for OpenShift clusters. Auto-detected when logged into an OpenShift cluster (`oc login`). |

To deploy on OpenShift, just log in with `oc login` before starting the installer. The OpenShift option will appear automatically in the deploy form.

### In-repo providers

Anything under `provider-plugins/<name>/src/index.ts` is discovered by the server at startup. That is how the OpenShift plugin is activated in this repo.

This is the preferred model for provider-specific deployers that ship with the main repository.

### External providers

Third-party plugins can also be installed as npm packages. The loader discovers:

- unscoped packages named `openclaw-installer-*`
- scoped packages whose package name starts with `openclaw-installer-`

Examples:

- `openclaw-installer-aws`
- `@acme/openclaw-installer-gke`

You can activate external plugins by writing `~/.openclaw/installer/plugins.json` directly, or by using `run.sh`:

```bash
./run.sh --plugin @acme/openclaw-installer-aws
./run.sh --plugins @acme/openclaw-installer-aws,@acme/openclaw-installer-gke
OPENCLAW_INSTALLER_PLUGINS=@acme/openclaw-installer-aws ./run.sh
```

`run.sh` writes the requested package list to `~/.openclaw/installer/plugins.json`, which is then consumed by the server plugin loader on startup.

### Recommended provider strategy

For this repo, the clean split is:

- ship first-party providers as in-repo plugins under `provider-plugins/`
- use external npm packages for optional or third-party providers

That keeps the installer startup generic. Users start the same installer, and the available deployers come from the loaded plugins.

See [ADR 0001](adr/0001-deployer-plugin-system.md) for the plugin system design.

## Model Providers

| Provider | Default Model | What you need |
|----------|---------------|---------------|
| Anthropic | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-5` | `OPENAI_API_KEY` |
| Vertex AI (Gemini) | `google-vertex/gemini-2.5-pro` | GCP service account JSON |
| Self-hosted (vLLM, etc.) | `openai/default` | `MODEL_ENDPOINT` URL |

For Vertex AI, upload your GCP service account JSON file (or provide an absolute path). The installer extracts the `project_id` automatically.

## SSH Sandbox

The installer supports OpenClaw's `ssh` sandbox backend for local and Kubernetes deployments.

For the installer-specific setup, credential handling, and troubleshooting, see [SANDBOX.md](docs/SANDBOX.md).

For upstream sandbox concepts and backend behavior, see the [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md).

## Demo Bundles

`Agent Source Directory` can now point at a bundled multi-agent demo tree.

Try:

- `demos/openclaw-builder-research-ops`
- `demos/software-qa-mcp`

This demo includes:

- `workspace-main/` for the orchestrator agent
- `workspace-builder/`
- `workspace-research/`
- `workspace-ops/`
- `openclaw-agents.json` to register extra named agents and simple per-agent sandbox tool policies

`workspace-main/` is applied to the computed main agent workspace for the current deploy.
Other `workspace-*` directories are copied through as named agent workspaces and can be
registered as additional agents through `openclaw-agents.json`.

The `software-qa-mcp` demo includes:

- `mcp.json` for the Context7 MCP server
- `exec-approvals.json` for baseline tool approval policy
- `workspace-main/` with a software Q&A agent persona

Environment templates are included too:

- `.env.example` for a generic installer setup
- `demos/openclaw-builder-research-ops/.env.example` for the bundled sandbox demo

## MCP Servers

The installer supports provisioning MCP servers through the Agent Source Directory. Place a `mcp.json` file in your agent source directory:

```json
{
  "mcpServers": {
    "my-server": {
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

The installer merges these into the generated `openclaw.json` at deploy time.

For tool approval policies, add an `exec-approvals.json`:

```json
{
  "version": 1,
  "defaults": {
    "security": "allowlist",
    "ask": "on-miss",
    "askFallback": "deny"
  }
}
```

This file is copied directly to `~/.openclaw/exec-approvals.json` in the deployed instance.

See `demos/software-qa-mcp` for a complete example.

## Agent Workspaces

After the first deploy, agent files live under `~/.openclaw/workspace-*` on the host. Edit those files locally, then:

- for Local deployments, stop and start the instance
- for Kubernetes/OpenShift deployments, use Re-deploy

The installer treats the host files as the source of truth and pushes them into the running instance.

For Local deployments, the default is an isolated container data volume for `/home/node/.openclaw`.
That keeps runtime state, config, pairing data, cron state, and plugin state out of the host
`~/.openclaw` tree while still syncing host workspaces into the instance on start/redeploy.

## API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Runtime detection, version, server defaults |
| `/api/deploy` | POST | Start a deployment (streams logs via WebSocket) |
| `/api/configs` | GET | List saved instance configs |
| `/api/instances` | GET | List all discovered instances |
| `/api/instances/:name/start` | POST | Start a stopped instance |
| `/api/instances/:name/stop` | POST | Stop and remove container (volume preserved) |
| `/api/instances/:name/redeploy` | POST | Update agent ConfigMap and restart pod (K8s only) |
| `/api/instances/:name/token` | GET | Get the gateway auth token |
| `/api/instances/:name/open` | POST | Start or reuse a managed K8s port-forward and return a localhost URL |
| `/api/instances/:name/command` | GET | Get the run command |
| `/api/instances/:name/data` | DELETE | Delete the data volume |
| `/ws` | WebSocket | Subscribe to deploy logs |

## Roadmap

- [x] Local deployer (podman + docker, macOS + Linux)
- [x] Kubernetes deployer
- [x] Vertex AI support (Google Gemini via GCP SA JSON)
- [x] Instance discovery and lifecycle management
- [x] Agent provisioning with full workspace files
- [x] Custom agent/skill provisioning from host directory
- [x] Deploy config persistence for re-deploy
- [x] One-way host-to-instance workspace sync on Local Start / K8s Re-deploy
- [ ] Subagent provisioning
- [ ] Cron job provisioning from JOB.md files
- [ ] Pull running changes back to local files
- [ ] GitOps-backed workspace sync
- [ ] Skill import from git repos
- [ ] SSH deployer (remote host)
