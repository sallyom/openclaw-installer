# OpenShift Kagenti Prerequisite

Use this when a cluster-admin is preparing a fresh OpenShift cluster for
OpenClaw deployments with Kagenti A2A enabled.

The installer does not run this setup itself.

This prerequisite is OpenShift-specific. On non-OpenShift Kubernetes,
`openclaw-installer` still handles namespace-local A2A wiring directly.

## Prerequisites

- OpenShift 4.19+
- `oc` or `kubectl` logged in as cluster-admin
- `helm` >= 3.18.0
- Python 3

## One-Step Setup

From this directory, run:

```bash
./scripts/setup-kagenti.sh
```

That script installs the Kagenti stack and the OpenShift namespace enrollment
controller needed for OpenClaw A2A deployments.

By default it uses a pinned working Kagenti ref:

- `5a3eab8d1c4267defe3dbfe9e78c5a3917c77366`

Known-good chart versions from that ref:

- `kagenti` chart `0.1.2`
- `kagenti-operator-chart` `0.2.0-alpha.22`
- `kagenti-webhook-chart` `0.4.0-alpha.9`
- `mcp-gateway` chart `0.5.1`

If you intentionally want to track upstream instead of the pinned working ref:

```bash
./scripts/setup-kagenti.sh --kagenti-ref main
```

## What The Script Sets Up

It installs:

- `kagenti-deps`
- `kagenti`
- `mcp-gateway`
- `kagenti-namespace-controller`

The namespace controller watches namespaces labeled:

- `kagenti-enabled=true`

and backfills the Kagenti namespace state needed on OpenShift for A2A
deployments.

## What Success Looks Like

After the script completes, these should exist:

- `deployment/kagenti-controller-manager` in `kagenti-system`
- `deployment/kagenti-webhook-controller-manager` in `kagenti-webhook-system`
- `deployment/kagenti-namespace-controller` in `kagenti-system`
- `deployment/cert-manager-webhook` in `cert-manager`
- a healthy Keycloak in `keycloak`

Quick checks:

```bash
oc get pods -n kagenti-system
oc get pods -n kagenti-webhook-system
oc get pods -n keycloak
oc get deploy -n kagenti-system kagenti-namespace-controller
```

## After This

Once the cluster-admin setup is complete, users deploy OpenClaw from
`openclaw-installer` in OpenShift mode with Kagenti A2A enabled.

The installer will:

- label the namespace with `kagenti-enabled=true`
- create the OpenClaw-specific A2A resources

The Kagenti namespace controller will handle the Kagenti/OpenShift namespace
glue automatically.

## Current Limitation

Today, the namespace controller also creates a copy of the Keycloak admin
credentials in each enrolled agent namespace as:

- `Secret/keycloak-admin-secret`

This is required by the currently injected Kagenti client-registration sidecar,
but it is not a good long-term model for tenant isolation.

This should be remedied upstream so regular users do not need a copy of the
Keycloak admin username/password in their application namespace.

## What Kagenti Must Fix Upstream

For this to become a clean working solution for non-admin OpenShift users,
Kagenti should provide all of the following upstream:

1. A real namespace enrollment controller in the Kagenti operator.
2. Automatic reconciliation for namespaces labeled:
   - `kagenti-enabled=true`
3. Automatic creation of the required namespace artifacts:
   - `environments`
   - `authbridge-config`
   - `envoy-config`
   - `spiffe-helper-config`
   - `RoleBinding/agent-authbridge-scc`
   - any additional OpenShift-specific RoleBindings Kagenti chooses to own
4. Automatic reconciliation of `kagenti-authbridge` SCC membership for:
   - `system:serviceaccounts:<namespace>`
5. Removal of the requirement to copy Keycloak admin credentials into each
   tenant namespace.

The intended non-admin outcome is:

- cluster-admin runs `./scripts/setup-kagenti.sh` once
- a project admin deploys OpenClaw from `openclaw-installer` with Kagenti A2A enabled
- the namespace is labeled `kagenti-enabled=true`
- Kagenti reconciles the rest
- no per-namespace copy of Keycloak admin credentials is needed

## Cleanup

To remove the stack from the cluster:

```bash
./scripts/cleanup-kagenti.sh
```

## Reference

For maintainer and upstream Kagenti details, see:

- [KAGENTI-CLUSTER-ONBOARDING.md](./KAGENTI-CLUSTER-ONBOARDING.md)
