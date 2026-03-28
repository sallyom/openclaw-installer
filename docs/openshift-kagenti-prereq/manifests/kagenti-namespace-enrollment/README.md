# Kagenti Namespace Enrollment

This folder contains a manual namespace enrollment template for OpenShift clusters running Kagenti.

It is intended for cluster-admin use or an elevated controller. It prepares an application namespace to join the Kagenti A2A network.

## What it creates

- `kagenti-enabled=true` namespace label
- `ConfigMap/environments`
- `ConfigMap/authbridge-config`
- `ConfigMap/envoy-config`
- `ConfigMap/spiffe-helper-config`
- `RoleBinding/agent-authbridge-scc`
- `RoleBinding/pipeline-privileged-scc`

## What it does not do automatically

It does **not** patch the cluster-scoped SCC object. A cluster-admin still needs to ensure:

- `SecurityContextConstraints/kagenti-authbridge`
- includes `system:serviceaccounts:<namespace>`

Example:

```bash
export NAMESPACE=my-agent-ns

oc get scc kagenti-authbridge -o json \
  | jq '.groups = ((.groups // []) + ["system:serviceaccounts:'"${NAMESPACE}"'"] | unique)' \
  | oc apply -f -
```

## Usage

```bash
export NAMESPACE=my-agent-ns
export KC_NAMESPACE=keycloak
export KC_REALM=lobster
export KC_PUBLIC_URL=https://keycloak-keycloak.apps.example.com
export KC_ADMIN_USER=temp-admin
export KC_ADMIN_PASS=changeme

envsubst < manifests/kagenti-namespace-enrollment/kagenti-namespace-enrollment.yaml.envsubst | oc apply -f -
```

