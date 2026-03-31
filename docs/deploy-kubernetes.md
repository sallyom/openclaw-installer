# Deploying OpenClaw on Kubernetes

This installer deploys OpenClaw to a standard Kubernetes cluster using the Kubernetes API. It creates a namespace, PVC, ConfigMaps, Secrets, Service, and Deployment, then opens the gateway locally through a managed `kubectl port-forward` from the Instances tab.

## Prerequisites

- a working Kubernetes cluster
- `kubectl` configured against that cluster
- permission to create a namespace and standard namespaced resources

## Quick Start

```bash
curl -fsSLo run.sh https://raw.githubusercontent.com/sallyom/openclaw-installer/main/run.sh
chmod +x run.sh
./run.sh
```

Or from source:

```bash
git clone https://github.com/sallyom/openclaw-installer.git
cd openclaw-installer
npm install
npm run dev
```

Open `http://localhost:3000`, choose `Kubernetes`, fill in the deploy form, and click `Deploy`.

## Secret Handling

For Kubernetes deploys, the installer now uses the safer upstream-compatible secret path by default:

- secrets you enter in the form are written to the installer-managed `openclaw-secrets` Kubernetes Secret
- the pod receives them through `secretKeyRef`
- generated `openclaw.json` references them with env-backed OpenClaw SecretRefs instead of embedding raw secret values

You can still provide optional `secrets.providers` JSON and explicit SecretRef overrides when you want `file` or `exec`-based providers such as Vault.

## Access

After deploy, the simplest path is:

1. Open the `Instances` tab
2. Click `Open`

The installer will:

- start or reuse a managed `kubectl port-forward`
- choose a free local port automatically
- fetch the gateway token
- open the UI with the saved gateway token

Control UI device pairing remains enabled by default for the base Kubernetes deployer, so first browser connect may require approving the pending pairing request from the **Instances** tab with **Approve Pairing**.

Manual access is still available if you prefer:

```bash
kubectl port-forward svc/openclaw 18789:18789 -n <namespace>
```

Then visit `http://localhost:18789`.

## SSH Sandbox

For Kubernetes deployments, the installer stores SSH sandbox material in the generated `openclaw-secrets` Secret and passes it to the gateway container.

See [SANDBOX.md](SANDBOX.md) for the recommended form values, secret handling, and troubleshooting.

For upstream sandbox behavior, see the [OpenClaw sandboxing docs](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md).

## Notes

- Kubernetes access in this repo is plain K8s only. Platform-specific ingress and auth proxy flows are intentionally out of scope here.
- Re-deploy updates ConfigMaps from your local agent files and restarts the pod.
- Manual `kubectl port-forward` still works, but the `Open` action is now the recommended path for local access.
