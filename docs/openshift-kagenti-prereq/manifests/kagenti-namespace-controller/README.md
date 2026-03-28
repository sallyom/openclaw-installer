# Kagenti Namespace Controller

This folder contains a small reference controller for OpenShift clusters running Kagenti.

Its job is to reconcile Kagenti namespace enrollment for any namespace labeled:

- `kagenti-enabled=true`

## What it reconciles

- `ConfigMap/environments`
- `ConfigMap/authbridge-config`
- `ConfigMap/envoy-config`
- `ConfigMap/spiffe-helper-config`
- `RoleBinding/agent-authbridge-scc`
- `RoleBinding/pipeline-privileged-scc`
- `RoleBinding/openclaw-oauth-proxy-privileged-scc`
- `SecurityContextConstraints/kagenti-authbridge` membership for:
  - `system:serviceaccounts:<namespace>`

## Why this exists

On OpenShift, Kagenti namespace onboarding is not fully self-service today.

The Kagenti webhook/operator does not populate the required namespace ConfigMaps,
and the SCC access needed by injected sidecars is effectively cluster-scoped.

This controller gives cluster-admins a simple bootstrap path:

1. Run `scripts/setup-kagenti.sh`
2. Let teams label a namespace with `kagenti-enabled=true`
3. The controller reconciles the Kagenti/OpenShift glue automatically

## Deployment

`scripts/setup-kagenti.sh` installs this controller automatically after the
Kagenti platform is deployed.

The manifest template is:

- `controller.yaml.envsubst`

It is rendered with:

- `KC_NAMESPACE`
- `KC_REALM`

## Notes

- This is intentionally a minimal polling controller implemented with `oc`.
- It is meant as a practical handoff/reference implementation for the Kagenti team.
- A production upstream implementation would likely be a real controller-runtime reconciler.

## Upstream Ask

The intended ask to the Kagenti team is:

- use this controller as the working OpenShift reconciliation reference
- reimplement the same behavior as a real Go/controller-runtime controller in the Kagenti operator
- remove the current need for `Secret/keycloak-admin-secret` in each tenant namespace

The real controller should watch namespaces labeled `kagenti-enabled=true` and
reconcile the same namespace artifacts and SCC membership described above.
