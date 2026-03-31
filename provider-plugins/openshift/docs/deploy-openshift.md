# Deploying OpenClaw on OpenShift

This plugin extends openclaw-installer with OpenShift support. When installed, it automatically detects OpenShift clusters and adds an OAuth proxy sidecar so your instance is protected by OpenShift SSO -- no cluster-admin required.

For plain Kubernetes deployments (without OAuth proxy, Route, and ServiceAccount), the base openclaw-installer handles everything.

## Prerequisites

- An OpenShift cluster: either permission to create namespaces/projects, or a pre-created project where you have admin (or equivalent). If you only have namespace-scoped access, set the Project / Namespace field in the deploy form to that existing project.
- `oc` CLI authenticated (`oc login`) on the machine running the installer
- An API key or GCP service account for at least one model provider

**Storage:** OpenClaw uses SQLite, which requires POSIX file locking. Block storage classes (gp3-csi, managed-csi, thin-csi) work. Avoid NFS.

## Install the Plugin

The OpenShift plugin is included in the `provider-plugins/openshift/` directory and is loaded automatically by the installer's plugin loader. No separate installation is needed.

## Deploy

Start the installer on a machine where `oc login` (or `kubectl`) is authenticated to your cluster.

```bash
npm run dev
```

Open `http://localhost:3000`. If the cluster is OpenShift, the plugin auto-detects it and deploys with OAuth proxy support.

If you only have access to an existing project, enter that exact project name in the Project / Namespace field. The installer skips cluster-level namespace creation when the API returns `Forbidden` on namespace checks.

For a deeper architectural walkthrough, see [installing-openclaw-on-openshift.md](installing-openclaw-on-openshift.md).

For SSH sandbox setup on cluster deployments, see [SANDBOX.md](/Users/somalley/git/ambient-code/openclaw-installer/docs/SANDBOX.md).

### Deploy form

| Field | Example | Notes |
|-------|---------|-------|
| **Agent name** | `myagent` | ID for your default agent |
| **Project / Namespace** | `my-team-openclaw` | Use your existing OpenShift project if you cannot create namespaces cluster-wide |
| **Owner prefix** | *(optional)* | Defaults to OS username; used in generated namespace names |
| **Display name** | `My Agent` | Shown in the UI |
| **Image** | `ghcr.io/openclaw/openclaw:latest` | Container image |
| **Enable SSH sandbox backend** | checked | Recommended for cluster deploys |
| **SSH Target** | `sandbox@gateway-host:22` | Remote sandbox runtime host |
| **API key / Vertex credentials** | *(provider-specific)* | Same provider flow as generic Kubernetes deploys |

## What Gets Created

The OpenShift deployer adds OAuth proxy, Route, and ServiceAccount resources on top of the base Kubernetes deployment flow.

For the full resource breakdown, pod architecture, and OAuth model, see [installing-openclaw-on-openshift.md](installing-openclaw-on-openshift.md).

## Access Your Instance

The Route URL is printed in the deploy log:

```
https://openclaw-alice-myagent-openclaw.apps.your-cluster.example.com
```

OpenShift OAuth handles browser authentication in front of the gateway, but Control UI device pairing still remains enabled. On first browser connect you may need to approve the pending pairing request from the **Instances** tab with **Approve Pairing**.

Use the **Open** action from the **Instances** tab to open the Route with the saved **Gateway Token** automatically. The token is also saved to:

```
~/.openclaw/installer/k8s/alice-myagent-openclaw/gateway-token
```

## Updating Your Agent

After the initial deploy, your agent files live in `~/.openclaw/workspace-<prefix>_<name>/` on the host.

To push changes to a running deployment:

1. Edit the local files such as `AGENTS.md` or `SOUL.md`
2. Go to the **Instances** tab
3. Click **Re-deploy**

Re-deploy updates the ConfigMap from your host files and restarts the pod.

Stop and Start only scale replicas. They do not sync local file changes back into the deployment.

## Full Re-deploy

To change deploy-level configuration such as image, provider, API keys, or sandbox settings, deploy again to the same namespace from the form.

The installer uses create-or-replace behavior for managed resources, and forces a rollout through the deployment restart annotation.

The saved deploy config lives at:

```
~/.openclaw/installer/k8s/<namespace>/deploy-config.json
```

## Instance Management

From the **Instances** tab, an OpenShift deployment supports:

- status and pod health inspection
- Route URL display
- **Re-deploy** to sync local agent files and restart
- **Stop** to scale replicas to `0`
- **Start** to scale back to `1`
- **Delete** to tear down the deployment and namespace

## Teardown

The plugin deletes all OpenShift-specific resources (Route, OAuth secrets, ServiceAccount) before delegating to the base K8s deployer for remaining cleanup.

Note: This plugin fixes a bug from the original claw-installer where Route deletion was missing from teardown.
