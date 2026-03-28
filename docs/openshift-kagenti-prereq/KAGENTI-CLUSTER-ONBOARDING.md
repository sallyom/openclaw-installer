# Kagenti A2A Cluster Onboarding

This document separates the OpenShift work that must be done once by a cluster-admin from the namespace-scoped work required for a team to join the Kagenti A2A network.

The goal is:

- cluster-admin installs and exposes the Kagenti platform safely
- non-cluster-admin users can add an agent namespace without needing cluster-wide privileges

## Summary

### Cluster-admin responsibilities

These are one-time or cluster-scoped tasks:

1. Install the Kagenti platform:
   - cert-manager
   - Keycloak / RHBK
   - Kagenti operator
   - Kagenti webhook
   - SPIRE / ZTWIM

2. Verify these cluster-scoped OpenShift objects exist:
   - `SecurityContextConstraints/kagenti-authbridge`
   - `ClusterRole/system:openshift:scc:kagenti-authbridge`

3. For each namespace that should participate in Kagenti A2A, grant that namespace access to the custom SCC:
   - add `system:serviceaccounts:<namespace>` to `kagenti-authbridge.users` or `kagenti-authbridge.groups`
   - or run a controller that reconciles that SCC membership automatically

4. Optionally bootstrap namespace-scoped RoleBindings if your tenant users do not manage them directly.

### Namespace owner responsibilities

These are namespace-scoped tasks:

1. Label the namespace:
   - `kagenti-enabled=true`

2. Create the Kagenti runtime ConfigMaps:
   - `environments`
   - `authbridge-config`
   - `envoy-config`
   - `spiffe-helper-config`

3. Create the namespace RoleBinding:
   - `RoleBinding/agent-authbridge-scc`

4. Deploy the workload with Kagenti labels and annotations:
   - `kagenti.io/type=agent`
   - `kagenti.io/protocol=a2a`
   - `kagenti.io/inject=enabled`

## Important OpenShift Note

The namespace RoleBinding alone is not always enough on OpenShift.

Upstream Kagenti’s chart currently puts namespace service-account groups directly on the SCC object:

- `SecurityContextConstraints/kagenti-authbridge`
- group: `system:serviceaccounts:<namespace>`

That means a fully self-service non-admin flow is not guaranteed unless a cluster-admin or elevated controller also patches the SCC for each participating namespace.

Relevant upstream templates:

- `charts/kagenti/templates/kagenti-authbridge-scc.yaml`
- `charts/kagenti/templates/agent-namespaces.yaml`

## Recommended Model

The cleanest production model is:

1. Cluster-admin installs Kagenti once.
2. Cluster-admin installs a small controller that watches namespaces labeled `kagenti-enabled=true`.
3. That controller reconciles:
   - `ConfigMap/environments`
   - `ConfigMap/authbridge-config`
   - `ConfigMap/envoy-config`
   - `ConfigMap/spiffe-helper-config`
   - `RoleBinding/agent-authbridge-scc`
   - SCC membership for `system:serviceaccounts:<namespace>`

In this bundle, `scripts/setup-kagenti.sh` now installs a small reference
controller that implements that namespace enrollment flow.

This keeps tenant onboarding simple:

- tenant labels namespace
- tenant deploys agent
- controller handles the Kagenti/OpenShift glue

## Current Security Limitation

The current OpenShift workaround also copies the Keycloak admin credentials into
each enrolled namespace as:

- `Secret/keycloak-admin-secret`

That is only to satisfy the currently injected Kagenti client-registration
sidecar. It is not the desired long-term model.

The expected upstream fix is to remove the need for per-namespace copies of the
Keycloak admin username/password in tenant namespaces.

## Upstream Implementation Target

This repo's namespace controller is intentionally a small reference implementation.

The recommended upstream outcome for the Kagenti team is to replace it with a
real Go/controller-runtime reconciler in the Kagenti operator.

Suggested contract:

1. Watch `Namespace` objects labeled:
   - `kagenti-enabled=true`
2. Reconcile per matching namespace:
   - `ConfigMap/environments`
   - `ConfigMap/authbridge-config`
   - `ConfigMap/envoy-config`
   - `ConfigMap/spiffe-helper-config`
   - `RoleBinding/agent-authbridge-scc`
   - any additional OpenShift-specific RoleBindings Kagenti wants to own
3. Reconcile `SecurityContextConstraints/kagenti-authbridge` membership for:
   - `system:serviceaccounts:<namespace>`
4. Report status and retry using normal controller-runtime patterns instead of polling.

The files to use as the working behavioral reference are:

- `manifests/kagenti-namespace-controller/controller.yaml.envsubst`
- `README.md`
- `KAGENTI-CLUSTER-ONBOARDING.md`

If the Kagenti team wants a cleaner API later, the same reconciliation behavior
could move from a namespace label trigger to a dedicated CRD such as
`KagentiNamespaceEnrollment`.

## Acceptance Criteria For A Real Non-Admin Solution

These are the conditions that should be true once Kagenti implements the real
OpenShift solution upstream:

1. A cluster-admin installs Kagenti once for the cluster.
2. A project admin can deploy an OpenClaw namespace from `openclaw-installer`
   with Kagenti A2A enabled.
3. Labeling the namespace with `kagenti-enabled=true` is sufficient to trigger
   Kagenti namespace enrollment.
4. Kagenti creates the required namespace ConfigMaps and RoleBindings without
   any extra manual admin action.
5. Kagenti reconciles `kagenti-authbridge` SCC membership for the namespace's
   service accounts.
6. The injected client-registration/auth components no longer require
   `Secret/keycloak-admin-secret` in the tenant namespace.
7. No Keycloak admin credentials are copied into application namespaces.
8. The OpenClaw pod reaches `Running` with all injected Kagenti sidecars healthy
   under a project-admin deployment flow.

## Minimal Manual Process

If you do not have a controller yet, use the manifest template in:

- `manifests/kagenti-namespace-enrollment/kagenti-namespace-enrollment.yaml.envsubst`

Workflow:

1. Cluster-admin sets environment variables:
   - `NAMESPACE`
   - `KC_NAMESPACE`
   - `KC_REALM`
   - `KC_PUBLIC_URL`
   - `KC_ADMIN_USER`
   - `KC_ADMIN_PASS`

2. Cluster-admin applies the manifest with `envsubst`.

3. Cluster-admin patches `SecurityContextConstraints/kagenti-authbridge` to include:
   - `system:serviceaccounts:${NAMESPACE}`

4. Tenant deploys OpenClaw from `openclaw-installer` with Kagenti A2A enabled.

## Non-admin Reality Today

A normal namespace-scoped user is usually able to:

- create ConfigMaps in their namespace
- label their own namespace if delegated
- create workload resources in their namespace

But they usually cannot safely guarantee the SCC side is complete because:

- SCCs are cluster-scoped
- binding to SCC-related ClusterRoles may be RBAC-restricted
- Kagenti’s SCC model may require direct SCC membership, not just RoleBinding

So the safe answer today is:

- cluster-admin setup is still required for Kagenti A2A onboarding on OpenShift
