# Using OpenClaw Commands With Local Installer Instances

For installer-managed local instances, the simplest way to approve first-connect browser pairing is now the **Approve Pairing** button in the **Instances** tab.

This page documents the CLI workflows for cases where you want or need to run the upstream `openclaw` commands manually.

For installer-managed local instances, the most reliable CLI workflow is to run the upstream `openclaw` command inside the running container with `podman exec` or `docker exec`.

Use the host-installed CLI only if you already have it available locally.

## Recommended Workflow

If you are using podman:

```bash
podman exec -it openclaw-myuser-myagent openclaw health
podman exec -it openclaw-myuser-myagent openclaw status --deep
podman exec -it openclaw-myuser-myagent openclaw sandbox explain
```

If you are using docker:

```bash
docker exec -it openclaw-myuser-myagent openclaw health
docker exec -it openclaw-myuser-myagent openclaw status --deep
docker exec -it openclaw-myuser-myagent openclaw sandbox explain
```

If you want to approve first-connect browser device pairing manually instead of using the **Instances** tab button:

```bash
podman exec -it openclaw-myuser-myagent openclaw devices list
podman exec -it openclaw-myuser-myagent openclaw devices approve <requestId>
```

Or with docker:

```bash
docker exec -it openclaw-myuser-myagent openclaw devices list
docker exec -it openclaw-myuser-myagent openclaw devices approve <requestId>
```

## Optional Host CLI Workflow

If you already have the upstream OpenClaw CLI installed on the host, the installer also saves per-instance metadata under:

```text
~/.openclaw/installer/local/openclaw-<prefix>-<name>/.env
```

You can target the running local instance either way:

1. export `OPENCLAW_CONTAINER` directly if you already know the container name
2. source the saved per-instance `.env`, which sets `OPENCLAW_CONTAINER` for you

Examples:

```bash
export OPENCLAW_CONTAINER=openclaw-myuser-myagent
openclaw health
openclaw status --deep
```

```bash
source ~/.openclaw/installer/local/openclaw-myuser-myagent/.env
openclaw devices list
openclaw devices approve <requestId>
```

Because `OPENCLAW_CONTAINER` is set either way, the host CLI will target the running local containerized instance directly.

That same host CLI workflow can also be used for manual browser pairing approval:

```bash
source ~/.openclaw/installer/local/openclaw-myuser-myagent/.env
openclaw devices list
openclaw devices approve <requestId>
```

## Switching Between Local Instances

Use the container name shown in the **Instances** tab.

For container-exec workflows:

```bash
podman exec -it openclaw-myuser-myagent openclaw health
podman exec -it openclaw-myuser-otheragent openclaw status --deep
```

For host CLI workflows:

```bash
export OPENCLAW_CONTAINER=openclaw-myuser-myagent
openclaw health

export OPENCLAW_CONTAINER=openclaw-myuser-otheragent
openclaw status --deep
```

## Notes

- This local workflow does not require editing `openclaw.json`.
- The installer still saves `gateway-token`, which is useful for the Control UI and direct gateway access.
- Changes made inside the running container via the CLI do not currently persist across local container restarts. A sync job is planned to handle that workflow instead of bringing back a read-write file mount.
- For installer-managed local deploys, the live `openclaw.json` lives in the container volume at `/home/node/.openclaw/openclaw.json`, not in host `~/.openclaw/openclaw.json`.
- Kubernetes and OpenShift can be documented separately once their CLI targeting workflow is settled.
