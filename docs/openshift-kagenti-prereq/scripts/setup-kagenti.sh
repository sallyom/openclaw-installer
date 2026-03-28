#!/usr/bin/env bash
# ============================================================================
# KAGENTI PLATFORM SETUP
# ============================================================================
# Installs the Kagenti stack (SPIRE, cert-manager, Keycloak, operator, webhook,
# MCP Gateway) on an OpenShift cluster. Run this before OpenClaw is deployed from
# openclaw-installer with Kagenti A2A enabled.
# Prometheus/Kiali are disabled. UI/backend installed by default (use --skip-ui to disable).
# MLflow/Shipwright disabled (not needed).
#
# Usage:
#   ./scripts/setup-kagenti.sh                              # Auto-clones pinned kagenti ref to ~/.cache/kagenti
#   ./scripts/setup-kagenti.sh --kagenti-repo /path/to/kagenti  # Use local clone
#   ./scripts/setup-kagenti.sh --kagenti-repo https://github.com/org/kagenti.git  # Clone from URL
#   ./scripts/setup-kagenti.sh --kagenti-ref main          # Track upstream main instead of pinned working ref
#   ./scripts/setup-kagenti.sh --realm nerc                 # Custom Keycloak realm (default: kagenti)
#   ./scripts/setup-kagenti.sh --skip-ovn-patch             # Skip OVN gateway patch
#   ./scripts/setup-kagenti.sh --skip-mcp-gateway           # Skip MCP Gateway install
#
# Prerequisites:
#   - oc / kubectl with cluster-admin
#   - helm >= 3.18.0 < 4
#
# Tested on: OCP 4.19+ (ROSA)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
KAGENTI_REPO="${KAGENTI_REPO:-}"
KAGENTI_CACHE_DIR="${HOME}/.cache/kagenti"
KAGENTI_GITHUB_URL="https://github.com/kagenti/kagenti.git"
KAGENTI_REF="${KAGENTI_REF:-5a3eab8d1c4267defe3dbfe9e78c5a3917c77366}"
KAGENTI_UI_TAG="${KAGENTI_UI_TAG:-}"
KC_REALM="${KEYCLOAK_REALM:-kagenti}"
KC_NAMESPACE="${KEYCLOAK_NAMESPACE:-keycloak}"
CERT_MANAGER_OPERATOR_NAMESPACE="${CERT_MANAGER_OPERATOR_NAMESPACE:-cert-manager-operator}"
CERT_MANAGER_NAMESPACE="${CERT_MANAGER_NAMESPACE:-cert-manager}"
CERT_MANAGER_MODE="${CERT_MANAGER_MODE:-redhat-operator}"
CERT_MANAGER_MANIFESTS_VERSION="${CERT_MANAGER_MANIFESTS_VERSION:-v1.18.4}"
SKIP_OVN_PATCH=false
SKIP_MCP_GATEWAY=false
SKIP_UI=false
MCP_GATEWAY_VERSION="0.5.1"
DRY_RUN=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}→${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --kagenti-repo)       KAGENTI_REPO="$2"; shift 2 ;;
    --kagenti-ref)        KAGENTI_REF="$2"; shift 2 ;;
    --kagenti-ui-tag)     KAGENTI_UI_TAG="$2"; shift 2 ;;
    --realm)              KC_REALM="$2"; shift 2 ;;
    --keycloak-namespace) KC_NAMESPACE="$2"; shift 2 ;;
    --cert-manager-mode)  CERT_MANAGER_MODE="$2"; shift 2 ;;
    --cert-manager-version) CERT_MANAGER_MANIFESTS_VERSION="$2"; shift 2 ;;
    --skip-ovn-patch)     SKIP_OVN_PATCH=true; shift ;;
    --skip-mcp-gateway)   SKIP_MCP_GATEWAY=true; shift ;;
    --skip-ui)            SKIP_UI=true; shift ;;
    --mcp-gateway-version) MCP_GATEWAY_VERSION="$2"; shift 2 ;;
    --dry-run)            DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --kagenti-repo PATH|URL   Local path or GitHub URL to kagenti repo"
      echo "  --kagenti-ref REF        Git ref to checkout when cloning kagenti (default: $KAGENTI_REF)"
      echo "                           Use --kagenti-ref main to track upstream instead of the pinned working ref"
      echo "  --kagenti-ui-tag TAG     Kagenti UI/backend image tag (default: derived from chart appVersion)"
      echo "  --realm REALM             Keycloak realm (default: kagenti, or \$KEYCLOAK_REALM)"
      echo "  --keycloak-namespace NS   Keycloak namespace (default: keycloak, or \$KEYCLOAK_NAMESPACE)"
      echo "  --cert-manager-mode MODE  Cert-manager install mode: redhat-operator|community-operator|manifests"
      echo "                            (default: $CERT_MANAGER_MODE, or \$CERT_MANAGER_MODE)"
      echo "  --cert-manager-version V  Upstream cert-manager version for manifests mode"
      echo "                            (default: $CERT_MANAGER_MANIFESTS_VERSION, or \$CERT_MANAGER_MANIFESTS_VERSION)"
      echo "  --skip-ovn-patch          Skip OVN gateway routing patch"
      echo "  --skip-mcp-gateway        Skip MCP Gateway installation"
      echo "  --skip-ui                 Skip Kagenti UI and backend installation"
      echo "  --mcp-gateway-version VER MCP Gateway chart version (default: $MCP_GATEWAY_VERSION)"
      echo "  --dry-run                 Show commands without executing"
      echo "  -h, --help                Show this help"
      exit 0
      ;;
    *) log_error "Unknown option: $1"; exit 1 ;;
  esac
done

case "$CERT_MANAGER_MODE" in
  redhat-operator|community-operator|manifests) ;;
  *)
    log_error "Invalid --cert-manager-mode: $CERT_MANAGER_MODE"
    exit 1
    ;;
esac

run_cmd() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

_ensure_helm_repo_cache() {
  if $DRY_RUN; then return; fi

  local repo_cache
  repo_cache=$(helm env | sed -n 's/^HELM_REPOSITORY_CACHE="\([^\"]*\)"$/\1/p')
  if [ -z "$repo_cache" ] || [ ! -d "$repo_cache" ]; then
    return
  fi

  local repaired_any=false
  while IFS=$'\t' read -r repo_name _repo_url; do
    [ -n "$repo_name" ] || continue
    if [ ! -f "$repo_cache/${repo_name}-index.yaml" ]; then
      if [ "$repaired_any" = false ]; then
        log_info "Repairing missing Helm repo cache entries..."
        repaired_any=true
      fi
      helm repo update "$repo_name" >/dev/null
    fi
  done < <(helm repo list -o json 2>/dev/null | jq -r '.[] | [.name, .url] | @tsv')

  if [ "$repaired_any" = true ]; then
    log_success "Helm repo cache repaired"
  fi
}

# ============================================================================
# Pre-flight checks
# ============================================================================
START_SECONDS=$SECONDS

echo ""
echo "============================================"
echo "  Kagenti Platform Setup"
echo "============================================"
echo ""

# Check for kubectl/oc
if command -v oc &>/dev/null; then
  KUBECTL=oc
elif command -v kubectl &>/dev/null; then
  KUBECTL=kubectl
else
  log_error "Neither oc nor kubectl found in PATH"
  exit 1
fi

# Check cluster access
if ! $KUBECTL cluster-info &>/dev/null 2>&1; then
  log_error "Cannot connect to cluster. Run 'oc login' first."
  exit 1
fi
log_success "Connected to cluster"

# Check for stale APIServices that block namespace deletion.
# On some clusters (e.g. with removed kubevirt), stale APIServices cause namespace
# finalizers to hang on API discovery failures. Warn so the user can clean them up.
_stale_apis=$($KUBECTL get apiservices -o json 2>/dev/null | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
stale = []
for item in data.get('items', []):
    for cond in item.get('status', {}).get('conditions', []):
        if cond.get('type') == 'Available' and cond.get('status') != 'True':
            stale.append(item['metadata']['name'])
print('\n'.join(stale))
" 2>/dev/null || echo "")
if [ -n "$_stale_apis" ]; then
  log_warn "Stale APIServices detected (can cause namespace deletion hangs):"
  echo "$_stale_apis" | while read -r api; do echo "    $api"; done
  log_warn "Consider removing them: oc delete apiservice <name>"
fi

# Check helm
if ! command -v helm &>/dev/null; then
  log_error "helm not found in PATH. Install helm >= 3.18.0"
  exit 1
fi
log_success "helm found: $(helm version --short)"

# Resolve kagenti repo: local path, GitHub URL, or auto-clone from main
_clone_kagenti() {
  local url="$1" dest="$2" ref="$3"
  log_info "Cloning kagenti from ${url} → ${dest}..."
  if $DRY_RUN; then
    echo "  [dry-run] rm -rf \"$dest\""
    echo "  [dry-run] git clone --depth=1 \"$url\" \"$dest\""
    echo "  [dry-run] git -C \"$dest\" checkout \"$ref\""
    return 0
  fi
  rm -rf "$dest"
  if ! git clone --depth=1 "$url" "$dest" 2>&1; then
    log_error "Failed to clone kagenti from $url"
    exit 1
  fi
  if [ "$ref" != "main" ] && [ "$ref" != "master" ]; then
    if ! git -C "$dest" fetch --depth=1 origin "$ref" 2>&1; then
      log_error "Failed to fetch kagenti ref $ref"
      exit 1
    fi
  fi
  if ! git -C "$dest" checkout "$ref" 2>&1; then
    log_error "Failed to checkout kagenti ref $ref"
    exit 1
  fi
  log_success "Cloned kagenti at ref: $ref"
}

KAGENTI_SOURCE=""
if [ -z "$KAGENTI_REPO" ]; then
  # No --kagenti-repo given: clone fresh from upstream at the pinned working ref
  KAGENTI_SOURCE="$KAGENTI_GITHUB_URL@$KAGENTI_REF"
  _clone_kagenti "$KAGENTI_GITHUB_URL" "$KAGENTI_CACHE_DIR" "$KAGENTI_REF"
  KAGENTI_REPO="$KAGENTI_CACHE_DIR"
elif [[ "$KAGENTI_REPO" == http://* ]] || [[ "$KAGENTI_REPO" == https://* ]] || [[ "$KAGENTI_REPO" == git@* ]]; then
  # GitHub/git URL: clone into cache
  KAGENTI_SOURCE="$KAGENTI_REPO@$KAGENTI_REF"
  _clone_kagenti "$KAGENTI_REPO" "$KAGENTI_CACHE_DIR" "$KAGENTI_REF"
  KAGENTI_REPO="$KAGENTI_CACHE_DIR"
else
  # Local path provided — use as-is
  KAGENTI_SOURCE="$KAGENTI_REPO (local)"
  if [ -n "${KAGENTI_REF:-}" ]; then
    log_info "Using local kagenti repo as-is; --kagenti-ref is ignored for local paths"
  fi
fi

if [ ! -d "$KAGENTI_REPO/charts/kagenti-deps" ] || [ ! -d "$KAGENTI_REPO/charts/kagenti" ]; then
  log_error "Invalid kagenti repo: $KAGENTI_REPO (missing charts/kagenti-deps or charts/kagenti)"
  exit 1
fi
log_success "Kagenti repo: $KAGENTI_SOURCE"
echo ""

# ============================================================================
# Step 1: OVN Gateway Patch
# ============================================================================
log_info "Step 1: OVN Gateway Patch"

if $SKIP_OVN_PATCH; then
  log_info "Skipped (--skip-ovn-patch)"
else
  # Check if this is an OVNKubernetes cluster
  NETWORK_TYPE=$($KUBECTL get network.operator.openshift.io cluster -o jsonpath='{.spec.defaultNetwork.type}' 2>/dev/null || echo "unknown")
  if [ "$NETWORK_TYPE" = "OVNKubernetes" ]; then
    log_info "OVNKubernetes detected — applying routingViaHost patch"
    run_cmd $KUBECTL patch network.operator.openshift.io cluster --type=merge \
      -p '{"spec":{"defaultNetwork":{"ovnKubernetesConfig":{"gatewayConfig":{"routingViaHost":true}}}}}'
    log_success "OVN gateway patch applied"
  else
    log_info "Network type: $NETWORK_TYPE — skipping OVN patch"
  fi
fi
echo ""

# ============================================================================
# Step 2: Detect Trust Domain
# ============================================================================
log_info "Step 2: Detect trust domain"

DOMAIN="apps.$($KUBECTL get dns cluster -o jsonpath='{ .spec.baseDomain }' 2>/dev/null || echo "")"
if [ "$DOMAIN" = "apps." ] || [ -z "$DOMAIN" ]; then
  log_warn "Could not auto-detect cluster domain"
  read -p "  Enter trust domain (e.g. apps.example.com): " DOMAIN
fi
export DOMAIN
log_success "Trust domain: $DOMAIN"
echo ""

# ============================================================================
# Step 3: Install kagenti-deps
# ============================================================================
log_info "Step 3: Install kagenti-deps"

# Pre-flight: ensure enableUserWorkload is set in cluster-monitoring-config.
# The kagenti-deps chart has a kiali-operand hook that tries to REPLACE the entire
# cluster-monitoring-config ConfigMap. On managed clusters this conflicts
# with the endpoint-monitoring-operator which already owns .data.config.yaml.
# We merge enableUserWorkload proactively so the hook failure is non-critical.
_ensure_user_workload_monitoring() {
  if $DRY_RUN; then return; fi
  local existing
  existing=$($KUBECTL get configmap cluster-monitoring-config -n openshift-monitoring \
    -o jsonpath='{.data.config\.yaml}' 2>/dev/null || echo "")
  if [ -z "$existing" ]; then
    # ConfigMap doesn't exist or is empty — the hook can create it from scratch
    return
  fi
  if echo "$existing" | grep -q "enableUserWorkload: true"; then
    log_success "User workload monitoring already enabled"
    return
  fi
  # Merge enableUserWorkload into existing config
  local merged
  merged="enableUserWorkload: true"$'\n'"$existing"
  $KUBECTL patch configmap cluster-monitoring-config -n openshift-monitoring \
    --type=merge -p "{\"data\":{\"config.yaml\":$(echo "$merged" | jq -Rs .)}}" >/dev/null
  log_success "Merged enableUserWorkload: true into cluster-monitoring-config"
}
_ensure_user_workload_monitoring

# Install or upgrade kagenti-deps.
# On managed clusters the kiali-operand post-install/post-upgrade hook
# fails because it tries to delete+recreate cluster-monitoring-config, which is owned
# by the endpoint-monitoring-operator. We handle this two ways:
#   - Upgrade: always skip hooks (operands are already running from the initial install)
#   - Fresh install: attempt with hooks; if the hook fails, recover with --no-hooks
#     and manually apply the safe operand CRs
# Wait for a namespace to finish terminating. If it's Active, that's fine — skip it.
# Only intervenes when the namespace is stuck in Terminating state (force-strips finalizers).
_wait_ns_gone() {
  local ns="$1" tries=0
  local phase
  phase=$($KUBECTL get ns "$ns" -o jsonpath='{.status.phase}' 2>/dev/null || echo "NotFound")
  if [ "$phase" != "Terminating" ]; then
    return 0  # Active or doesn't exist — nothing to wait for
  fi
  log_info "  Waiting for $ns to terminate..."
  while $KUBECTL get ns "$ns" &>/dev/null 2>&1; do
    $KUBECTL get ns "$ns" -o json 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); d['spec']['finalizers']=[]; json.dump(d,sys.stdout)" \
      | $KUBECTL replace --raw "/api/v1/namespaces/$ns/finalize" -f - >/dev/null 2>&1 || true
    tries=$((tries + 1))
    if [ $tries -ge 30 ]; then log_error "  $ns still exists after 30s"; return 1; fi
    sleep 1
  done
  log_success "  $ns terminated"
}

# Wait for the components we need before proceeding to the kagenti chart.
# Skips MLflow (its oauth-secret is created by the kagenti chart's post-install hook).
_wait_kagenti_deps_ready() {
  if $DRY_RUN; then return; fi
  log_info "Waiting for Keycloak..."
  $KUBECTL rollout status deployment/keycloak -n "$KC_NAMESPACE" --timeout=300s 2>/dev/null || \
    log_warn "Keycloak rollout not ready within 5m"
  log_info "Waiting for Istio..."
  $KUBECTL rollout status deployment/istiod -n istio-system --timeout=300s 2>/dev/null || \
    log_warn "istiod rollout not ready within 5m"
}

_cert_manager_subscription_namespace() {
  case "$CERT_MANAGER_MODE" in
    redhat-operator) echo "$CERT_MANAGER_OPERATOR_NAMESPACE" ;;
    community-operator) echo "$CERT_MANAGER_NAMESPACE" ;;
    *) echo "" ;;
  esac
}

_cert_manager_subscription_name() {
  case "$CERT_MANAGER_MODE" in
    redhat-operator) echo "openshift-cert-manager-operator" ;;
    community-operator) echo "cert-manager" ;;
    *) echo "" ;;
  esac
}

_ensure_cert_manager_operator() {
  if $DRY_RUN; then return 0; fi

  log_info "Ensuring Red Hat cert-manager operator subscription exists..."

  $KUBECTL create namespace "$CERT_MANAGER_OPERATOR_NAMESPACE" --dry-run=client -o yaml | $KUBECTL apply -f - >/dev/null

  if ! $KUBECTL get operatorgroup openshift-cert-manager-operatorgroup -n "$CERT_MANAGER_OPERATOR_NAMESPACE" &>/dev/null 2>&1; then
    $KUBECTL apply -f - <<EOF >/dev/null
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: openshift-cert-manager-operatorgroup
  namespace: ${CERT_MANAGER_OPERATOR_NAMESPACE}
spec:
  upgradeStrategy: Default
EOF
  fi

  if ! $KUBECTL get subscription openshift-cert-manager-operator -n "$CERT_MANAGER_OPERATOR_NAMESPACE" &>/dev/null 2>&1; then
    $KUBECTL apply -f - <<EOF >/dev/null
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: openshift-cert-manager-operator
  namespace: ${CERT_MANAGER_OPERATOR_NAMESPACE}
  labels:
    operators.coreos.com/openshift-cert-manager-operator.${CERT_MANAGER_OPERATOR_NAMESPACE}: ""
spec:
  channel: stable-v1
  installPlanApproval: Automatic
  name: openshift-cert-manager-operator
  source: redhat-operators
  sourceNamespace: openshift-marketplace
EOF
    log_success "Created openshift-cert-manager-operator subscription"
  else
    log_success "openshift-cert-manager-operator subscription already exists"
  fi
}

_ensure_community_cert_manager_operator() {
  if $DRY_RUN; then return 0; fi

  log_info "Ensuring community cert-manager operator subscription exists..."

  $KUBECTL create namespace "$CERT_MANAGER_NAMESPACE" --dry-run=client -o yaml | $KUBECTL apply -f - >/dev/null

  if ! $KUBECTL get operatorgroup cert-manager -n "$CERT_MANAGER_NAMESPACE" &>/dev/null 2>&1; then
    $KUBECTL apply -f - <<EOF >/dev/null
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: cert-manager
  namespace: ${CERT_MANAGER_NAMESPACE}
spec: {}
EOF
  fi

  if ! $KUBECTL get subscription cert-manager -n "$CERT_MANAGER_NAMESPACE" &>/dev/null 2>&1; then
    $KUBECTL apply -f - <<EOF >/dev/null
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: cert-manager
  namespace: ${CERT_MANAGER_NAMESPACE}
spec:
  channel: stable
  installPlanApproval: Automatic
  name: cert-manager
  source: community-operators
  sourceNamespace: openshift-marketplace
EOF
    log_success "Created community cert-manager subscription"
  else
    log_success "Community cert-manager subscription already exists"
  fi
}

_ensure_cert_manager_manifests() {
  if $DRY_RUN; then return 0; fi

  log_info "Installing upstream cert-manager manifests ${CERT_MANAGER_MANIFESTS_VERSION}..."
  run_cmd $KUBECTL apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_MANIFESTS_VERSION}/cert-manager.yaml"
}

_bootstrap_cert_manager() {
  case "$CERT_MANAGER_MODE" in
    redhat-operator) _ensure_cert_manager_operator ;;
    community-operator) _ensure_community_cert_manager_operator ;;
    manifests) _ensure_cert_manager_manifests ;;
  esac
}

_check_cert_manager_subscription_health() {
  if $DRY_RUN; then return 0; fi

  if [ "$CERT_MANAGER_MODE" = "manifests" ]; then
    return 0
  fi

  local sub_ns sub_name
  sub_ns="$(_cert_manager_subscription_namespace)"
  sub_name="$(_cert_manager_subscription_name)"
  local unpack_failed_message
  unpack_failed_message=$($KUBECTL get subscription "$sub_name" -n "$sub_ns" \
    -o jsonpath='{range .status.conditions[?(@.type=="BundleUnpackFailed")]}{.status}{"|"}{.reason}{"|"}{.message}{"\n"}{end}' 2>/dev/null || true)

  if echo "$unpack_failed_message" | grep -q '^True|'; then
    log_error "cert-manager operator bundle unpack failed"
    echo "$unpack_failed_message" | while IFS= read -r line; do
      [ -n "$line" ] && log_error "  $line"
    done
    log_error "OpenShift did not create a CSV for openshift-cert-manager-operator. On STS clusters this may require manual operator installation or additional cluster/operator prerequisites."
    return 1
  fi

  return 0
}

_wait_cert_manager_ready() {
  if $DRY_RUN; then return 0; fi

  log_info "Waiting for cert-manager CRDs..."
  local tries=0
  while ! $KUBECTL get crd certificates.cert-manager.io &>/dev/null 2>&1; do
    tries=$((tries + 1))
    if ! _check_cert_manager_subscription_health; then
      return 1
    fi
    if [ $((tries % 6)) -eq 0 ]; then
      if [ "$CERT_MANAGER_MODE" = "manifests" ]; then
        log_info "cert-manager progress: waiting for CRD registration from upstream manifests"
      else
        local sub_state csv_state plan_state sub_ns sub_name
        sub_ns="$(_cert_manager_subscription_namespace)"
        sub_name="$(_cert_manager_subscription_name)"
        sub_state=$($KUBECTL get subscription "$sub_name" -n "$sub_ns" \
          -o jsonpath='{.status.state}' 2>/dev/null || echo "missing")
        csv_state=$($KUBECTL get csv -n "$sub_ns" \
          -o jsonpath='{range .items[*]}{.metadata.name}={.status.phase}{" "}{end}' 2>/dev/null || echo "none")
        plan_state=$($KUBECTL get installplan -n "$sub_ns" \
          -o jsonpath='{range .items[*]}{.metadata.name} approved={.spec.approved} phase={.status.phase}{" "}{end}' 2>/dev/null || echo "none")
        log_info "cert-manager progress: subscription=${sub_state} csv=${csv_state:-none} installplans=${plan_state:-none}"
      fi
    fi
    if [ $tries -ge 60 ]; then
      if [ "$CERT_MANAGER_MODE" != "manifests" ]; then
        $KUBECTL get subscription,csv,installplan -n "$(_cert_manager_subscription_namespace)" 2>/dev/null || true
      fi
      log_error "cert-manager CRDs not found after 5m"
      return 1
    fi
    sleep 5
  done

  log_info "Waiting for cert-manager webhook..."
  tries=0
  while ! $KUBECTL get deployment cert-manager-webhook -n "$CERT_MANAGER_NAMESPACE" &>/dev/null 2>&1; do
    tries=$((tries + 1))
    if ! _check_cert_manager_subscription_health; then
      return 1
    fi
    if [ $tries -ge 60 ]; then
      log_error "cert-manager webhook not found after 5m"
      return 1
    fi
    sleep 5
  done
  $KUBECTL rollout status deployment/cert-manager-webhook -n "$CERT_MANAGER_NAMESPACE" --timeout=180s 2>/dev/null || true

  log_info "Waiting for cert-manager webhook endpoints..."
  tries=0
  while ! $KUBECTL get endpoints cert-manager-webhook -n "$CERT_MANAGER_NAMESPACE" -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null | grep -q .; do
    tries=$((tries + 1))
    if ! _check_cert_manager_subscription_health; then
      return 1
    fi
    if [ $tries -ge 30 ]; then
      log_error "cert-manager webhook endpoints not ready after 2.5m"
      return 1
    fi
    sleep 5
  done

  # The endpoint can exist before the webhook has finished bootstrapping serving certs.
  sleep 10
  log_success "cert-manager is ready"
}

_apply_kagenti_deps_hook_resources() {
  if $DRY_RUN; then return; fi

  # When we install/upgrade with --no-hooks, we still need the safe hook-managed
  # resources, especially the Keycloak CR on OpenShift. Skip only the known
  # problematic hook artifacts.
  log_info "Applying operand CRs..."
  helm get hooks kagenti-deps -n kagenti-system 2>/dev/null | python3 -c "
import sys
content = sys.stdin.read()
docs = content.split('---')
for doc in docs:
    if not doc.strip():
        continue
    if 'pre-install' in doc and 'post-install' not in doc:
        continue
    if 'kind: ConfigMap' in doc and 'cluster-monitoring-config' in doc:
        continue
    if 'kind: Job' in doc:
        continue
    lines = [l for l in doc.strip().split('\n')
             if 'helm.sh/hook' not in l and 'helm.sh/hook-weight' not in l and 'helm.sh/hook-delete-policy' not in l]
    print('---')
    print('\n'.join(lines))
" | $KUBECTL apply -f - 2>/dev/null || true
}

_adopt_for_helm() {
  local kind="$1" name="$2" ns="${3:-}"
  if [ -n "$ns" ]; then
    if $KUBECTL get "$kind" "$name" -n "$ns" &>/dev/null 2>&1; then
      $KUBECTL label "$kind" "$name" -n "$ns" \
        app.kubernetes.io/managed-by=Helm --overwrite 2>/dev/null || true
      $KUBECTL annotate "$kind" "$name" -n "$ns" \
        meta.helm.sh/release-name=kagenti-deps \
        meta.helm.sh/release-namespace=kagenti-system --overwrite 2>/dev/null || true
    fi
  elif $KUBECTL get "$kind" "$name" &>/dev/null 2>&1; then
    $KUBECTL label "$kind" "$name" \
      app.kubernetes.io/managed-by=Helm --overwrite 2>/dev/null || true
    $KUBECTL annotate "$kind" "$name" \
      meta.helm.sh/release-name=kagenti-deps \
      meta.helm.sh/release-namespace=kagenti-system --overwrite 2>/dev/null || true
  fi
}

_adopt_existing_kagenti_deps_namespaces() {
  if $DRY_RUN; then return; fi

  local adopted_any=false
  for _ns in "$CERT_MANAGER_OPERATOR_NAMESPACE" "$CERT_MANAGER_NAMESPACE" istio-cni istio-system istio-ztunnel keycloak zero-trust-workload-identity-manager; do
    if $KUBECTL get namespace "$_ns" &>/dev/null 2>&1; then
      if [ "$adopted_any" = false ]; then
        log_info "Adopting pre-existing namespaces for Helm ownership..."
        adopted_any=true
      fi
      _adopt_for_helm namespace "$_ns"
    fi
  done

  if [ "$adopted_any" = true ]; then
    log_success "Existing kagenti-deps namespaces labeled for Helm adoption"
  fi
}

_adopt_existing_kagenti_deps_resources() {
  if $DRY_RUN; then return; fi

  local adopted_any=false
  local keycloak_ns="${KC_NAMESPACE}"

  # Fresh clusters sometimes come with a partially created Keycloak stack from an
  # earlier failed install or day-0 bootstrap. Adopt the fixed-name resources the
  # chart owns so Helm can proceed instead of erroring on the first collision.
  for item in \
    "route:keycloak:${keycloak_ns}" \
    "keycloak:keycloak:${keycloak_ns}" \
    "configmap:postgres-kc-init-script:${keycloak_ns}" \
    "statefulset:postgres-kc:${keycloak_ns}" \
    "service:postgres-kc:${keycloak_ns}" \
    "secret:keycloak-db-secret:${keycloak_ns}"
  do
    local kind="${item%%:*}"
    local rest="${item#*:}"
    local name="${rest%%:*}"
    local ns="${rest##*:}"
    if $KUBECTL get "$kind" "$name" -n "$ns" &>/dev/null 2>&1; then
      if [ "$adopted_any" = false ]; then
        log_info "Adopting pre-existing keycloak resources for Helm ownership..."
        adopted_any=true
      fi
      _adopt_for_helm "$kind" "$name" "$ns"
    fi
  done

  if [ "$adopted_any" = true ]; then
    log_success "Existing kagenti-deps keycloak resources labeled for Helm adoption"
  fi
}

_adopt_existing_shared_trust_resources() {
  if $DRY_RUN; then return; fi

  local adopted_any=false
  for item in \
    "clusterissuer:istio-mesh-root-selfsigned:" \
    "clusterissuer:istio-mesh-ca:" \
    "certificate:istio-mesh-root-ca:${CERT_MANAGER_NAMESPACE}" \
    "certificate:istio-cacerts-default:istio-system" \
    "certificate:istio-cacerts-openshift-gateway:openshift-ingress"
  do
    local kind="${item%%:*}"
    local rest="${item#*:}"
    local name="${rest%%:*}"
    local ns="${rest##*:}"
    if [ -n "$ns" ]; then
      if $KUBECTL get "$kind" "$name" -n "$ns" &>/dev/null 2>&1; then
        if [ "$adopted_any" = false ]; then
          log_info "Adopting shared trust resources for Helm ownership..."
          adopted_any=true
        fi
        _adopt_for_helm "$kind" "$name" "$ns"
      fi
    elif $KUBECTL get "$kind" "$name" &>/dev/null 2>&1; then
      if [ "$adopted_any" = false ]; then
        log_info "Adopting shared trust resources for Helm ownership..."
        adopted_any=true
      fi
      _adopt_for_helm "$kind" "$name"
    fi
  done

  if [ "$adopted_any" = true ]; then
    log_success "Existing shared trust resources labeled for Helm adoption"
  fi
}

_adopt_for_helm_release() {
  local release="$1" kind="$2" name="$3" ns="${4:-}"
  if [ -n "$ns" ]; then
    if $KUBECTL get "$kind" "$name" -n "$ns" &>/dev/null 2>&1; then
      $KUBECTL label "$kind" "$name" -n "$ns" \
        app.kubernetes.io/managed-by=Helm --overwrite 2>/dev/null || true
      $KUBECTL annotate "$kind" "$name" -n "$ns" \
        meta.helm.sh/release-name="$release" \
        meta.helm.sh/release-namespace=kagenti-system --overwrite 2>/dev/null || true
    fi
  elif $KUBECTL get "$kind" "$name" &>/dev/null 2>&1; then
    $KUBECTL label "$kind" "$name" \
      app.kubernetes.io/managed-by=Helm --overwrite 2>/dev/null || true
    $KUBECTL annotate "$kind" "$name" \
      meta.helm.sh/release-name="$release" \
      meta.helm.sh/release-namespace=kagenti-system --overwrite 2>/dev/null || true
  fi
}

_adopt_existing_kagenti_cluster_resources() {
  if $DRY_RUN; then return; fi

  local adopted_any=false
  for item in \
    "securitycontextconstraints:kagenti-authbridge" \
    "clusterrole:system:openshift:scc:kagenti-authbridge" \
    "clusterrolebinding:system:openshift:scc:kagenti-authbridge"
  do
    local kind="${item%%:*}"
    local name="${item#*:}"
    if $KUBECTL get "$kind" "$name" &>/dev/null 2>&1; then
      if [ "$adopted_any" = false ]; then
        log_info "Adopting pre-existing Kagenti cluster-scoped resources for Helm ownership..."
        adopted_any=true
      fi
      _adopt_for_helm_release kagenti "$kind" "$name"
    fi
  done

  if [ "$adopted_any" = true ]; then
    log_success "Existing Kagenti cluster-scoped resources labeled for Helm adoption"
  fi
}

_prepare_kagenti_cluster_resources_for_helm() {
  if $DRY_RUN; then return; fi

  local cleaned_any=false
  for item in \
    "clusterrole:kagenti-manager-role" \
    "clusterrole:kagenti-backend" \
    "securitycontextconstraints:kagenti-authbridge"
  do
    local kind="${item%%:*}"
    local name="${item#*:}"
    if $KUBECTL get "$kind" "$name" &>/dev/null 2>&1; then
      if [ "$cleaned_any" = false ]; then
        log_info "Deleting stale Kagenti cluster-scoped resources so Helm can recreate them..."
        cleaned_any=true
      fi
      $KUBECTL delete "$kind" "$name" --ignore-not-found >/dev/null 2>&1 || true
    fi
  done

  if [ "$cleaned_any" = true ]; then
    log_success "Stale Kagenti cluster-scoped resources deleted"
  fi
}

_deploy_kagenti_namespace_controller() {
  local template_path="${REPO_ROOT}/manifests/kagenti-namespace-controller/controller.yaml.envsubst"
  if [ ! -f "$template_path" ]; then
    log_error "Kagenti namespace controller manifest not found: $template_path"
    exit 1
  fi

  log_info "Deploying Kagenti namespace controller..."
  if $DRY_RUN; then
    echo "  [dry-run] apply ${template_path} with KC_NAMESPACE=${KC_NAMESPACE} KC_REALM=${KC_REALM}"
    return 0
  fi

  KC_NAMESPACE="$KC_NAMESPACE" KC_REALM="$KC_REALM" TEMPLATE_PATH="$template_path" python3 - <<'PY' | $KUBECTL apply -f -
import os
from string import Template

path = os.environ["TEMPLATE_PATH"]
with open(path, "r", encoding="utf-8") as fh:
    content = fh.read()

rendered = Template(content).safe_substitute(
    KC_NAMESPACE=os.environ["KC_NAMESPACE"],
    KC_REALM=os.environ["KC_REALM"],
)
print(rendered)
PY

  $KUBECTL rollout status deployment/kagenti-namespace-controller -n kagenti-system --timeout=180s >/dev/null 2>&1 || \
    log_warn "kagenti-namespace-controller rollout not ready within 3m"
  log_success "Kagenti namespace controller deployed"
}

_prepare_keycloak_route_for_helm() {
  if $DRY_RUN; then return; fi

  # A reused keycloak namespace can contain a Route/keycloak created by another
  # field manager (commonly OpenAPI-Generator). Helm's server-side apply will
  # then fail on spec field ownership even after metadata adoption. Deleting the
  # route is safe here because the chart recreates it immediately.
  if $KUBECTL get route keycloak -n "$KC_NAMESPACE" &>/dev/null 2>&1; then
    log_info "Deleting pre-existing keycloak route so Helm can recreate it..."
    $KUBECTL delete route keycloak -n "$KC_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
  fi
}

_helm_kagenti_deps() {
  local cert_manager_enabled=true
  if [ "$CERT_MANAGER_MODE" != "redhat-operator" ]; then
    cert_manager_enabled=false
  fi

  # Pre-flight: ensure namespaces managed by this chart are not stuck terminating
  # from a previous failed install/uninstall cycle
  for _ns in keycloak istio-cni istio-system istio-ztunnel; do
    _wait_ns_gone "$_ns"
  done

  # Some clusters already have namespaces from prior attempts or day-0 setup.
  # Helm refuses to create/import them unless ownership metadata matches.
  _adopt_existing_kagenti_deps_namespaces
  _adopt_existing_kagenti_deps_resources
  _adopt_existing_shared_trust_resources
  _prepare_keycloak_route_for_helm

  if helm status kagenti-deps -n kagenti-system &>/dev/null 2>&1; then
    # Upgrade path: skip hooks (operands already exist, and the kiali hook will fail
    # on any cluster where cluster-monitoring-config is managed by another operator)
    log_info "kagenti-deps already installed — upgrading (hooks skipped)"
    run_cmd helm upgrade kagenti-deps "$KAGENTI_REPO/charts/kagenti-deps/" \
      -n kagenti-system \
      --set spire.trustDomain="${DOMAIN}" \
      --set components.kiali.enabled=false \
      --set components.rhoai.enabled=true \
      --set components.mlflow.enabled=false \
      --set components.shipwright.enabled=false \
      --set mlflow.auth.enabled=false \
      --set components.certManager.enabled="${cert_manager_enabled}" \
      --no-hooks
    _apply_kagenti_deps_hook_resources
    _wait_kagenti_deps_ready
    return $?
  fi

  # Fresh install: skip hooks (they commonly timeout or conflict with managed
  # operators like cluster-monitoring-config). Operand CRs are applied manually after.
  log_info "Installing kagenti-deps..."
  _ensure_helm_repo_cache
  run_cmd helm dependency update "$KAGENTI_REPO/charts/kagenti-deps/"
  run_cmd helm install kagenti-deps "$KAGENTI_REPO/charts/kagenti-deps/" \
    -n kagenti-system --create-namespace \
    --set spire.trustDomain="${DOMAIN}" \
    --set components.kiali.enabled=false \
    --set components.rhoai.enabled=true \
    --set components.mlflow.enabled=false \
    --set components.shipwright.enabled=false \
    --set mlflow.auth.enabled=false \
    --set components.certManager.enabled="${cert_manager_enabled}" \
    --no-hooks

  # Apply operand CRs that --no-hooks skipped (excluding the conflicting ConfigMap).
  _apply_kagenti_deps_hook_resources
  # Create otel-ingress-ca ConfigMap (normally done by pre-install hook Job,
  # skipped by --no-hooks). MLflow and OTEL collector need this to verify
  # Keycloak's TLS certificate via the OpenShift ingress CA.
  if ! $KUBECTL get configmap otel-ingress-ca -n kagenti-system &>/dev/null 2>&1; then
    log_info "Creating otel-ingress-ca ConfigMap..."
    INGRESS_CA=$($KUBECTL get configmap default-ingress-cert \
      -n openshift-config-managed -o jsonpath='{.data.ca-bundle\.crt}' 2>/dev/null || echo "")
    ROOT_CA=$($KUBECTL get configmap kube-root-ca.crt \
      -n openshift-config -o jsonpath='{.data.ca\.crt}' 2>/dev/null || echo "")
    if [ -n "$INGRESS_CA" ]; then
      CA_BUNDLE="$INGRESS_CA"
      if [ -n "$ROOT_CA" ]; then
        CA_BUNDLE="${CA_BUNDLE}"$'\n'"${ROOT_CA}"
      fi
      $KUBECTL create configmap otel-ingress-ca \
        --from-literal=ca-bundle.crt="$CA_BUNDLE" \
        -n kagenti-system 2>/dev/null || true
      log_success "otel-ingress-ca ConfigMap created"
    else
      log_warn "Could not fetch ingress CA — otel-ingress-ca ConfigMap not created"
    fi
  fi

  _wait_kagenti_deps_ready
}
_helm_kagenti_deps
log_success "kagenti-deps installed"
echo ""

_bootstrap_cert_manager

# ============================================================================
# Step 3b: Istio multi-mesh shared trust via cert-manager
# ============================================================================
# Ported from kagenti Ansible installer (05_install_rhoai.yaml).
#
# When RHOAI is installed alongside Kagenti, two Istio control planes exist
# (default + openshift-gateway) with different self-signed CAs. We create a
# shared root CA via cert-manager so both istiods trust each other's workload
# certificates. Without this, ztunnel fails with BadSignature errors and
# pod-to-pod mTLS in ambient mode is broken.

_wait_secret_ready() {
  local secret="$1" ns="$2" tries=0
  while ! $KUBECTL get secret "$secret" -n "$ns" -o jsonpath='{.data.tls\.crt}' 2>/dev/null | grep -q .; do
    tries=$((tries + 1))
    if [ $tries -ge 30 ]; then log_warn "$ns/$secret not ready after 5m"; return 1; fi
    sleep 10
  done
  return 0
}

_ensure_rhoai_shared_trust() {
  if $DRY_RUN; then return; fi

  # --- Wait for cert-manager ---
  if ! _wait_cert_manager_ready; then
    log_warn "Skipping shared trust reconciliation because cert-manager is not ready"
    return 0
  fi

  # --- Create shared trust resources (fallback if Helm lookup skipped them) ---
  log_info "Creating shared trust cert-manager resources..."
  $KUBECTL apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: istio-mesh-root-selfsigned
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: istio-mesh-root-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: istio-mesh-root-ca
  duration: 87600h
  renewBefore: 720h
  secretName: istio-mesh-root-ca-secret
  privateKey:
    algorithm: RSA
    size: 4096
  issuerRef:
    name: istio-mesh-root-selfsigned
    kind: ClusterIssuer
EOF

  log_info "Waiting for root CA secret..."
  if ! _wait_secret_ready istio-mesh-root-ca-secret "$CERT_MANAGER_NAMESPACE"; then return 0; fi
  log_success "Root CA secret ready"

  $KUBECTL apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: istio-mesh-ca
spec:
  ca:
    secretName: istio-mesh-root-ca-secret
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: istio-cacerts-default
  namespace: istio-system
spec:
  isCA: true
  commonName: istio-ca-default
  duration: 8760h
  renewBefore: 720h
  secretName: istio-cacerts-default-cert
  privateKey:
    algorithm: RSA
    size: 2048
  issuerRef:
    name: istio-mesh-ca
    kind: ClusterIssuer
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: istio-cacerts-openshift-gateway
  namespace: openshift-ingress
spec:
  isCA: true
  commonName: istio-ca-openshift-gateway
  duration: 8760h
  renewBefore: 720h
  secretName: istio-cacerts-og-cert
  privateKey:
    algorithm: RSA
    size: 2048
  issuerRef:
    name: istio-mesh-ca
    kind: ClusterIssuer
EOF

  log_info "Waiting for intermediate CA secrets..."
  _wait_secret_ready istio-cacerts-default-cert istio-system
  _wait_secret_ready istio-cacerts-og-cert openshift-ingress
  log_success "Intermediate CA secrets ready"

  # --- Detect stale intermediate CAs (root CA regenerated but intermediates not re-signed) ---
  log_info "Checking intermediate CA consistency..."
  local ROOT_FP CHANGED=false
  ROOT_FP=$($KUBECTL get secret istio-mesh-root-ca-secret -n "$CERT_MANAGER_NAMESPACE" \
    -o jsonpath='{.data.tls\.crt}' | base64 -d | \
    openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')

  for item in "istio-cacerts-default-cert:istio-system" "istio-cacerts-og-cert:openshift-ingress"; do
    local secret="${item%%:*}" ns="${item##*:}"
    local INTER_FP
    INTER_FP=$($KUBECTL get secret "$secret" -n "$ns" \
      -o jsonpath='{.data.ca\.crt}' | base64 -d | \
      openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')
    if [ "$ROOT_FP" != "$INTER_FP" ]; then
      log_warn "Root CA mismatch in $ns/$secret — forcing re-issuance"
      $KUBECTL delete secret "$secret" -n "$ns"
      CHANGED=true
    fi
  done

  if $CHANGED; then
    log_info "Waiting for re-issued intermediate CAs..."
    _wait_secret_ready istio-cacerts-default-cert istio-system
    _wait_secret_ready istio-cacerts-og-cert openshift-ingress
    log_success "Intermediate CAs re-issued"
  else
    log_success "Intermediate CAs consistent with root"
  fi

  # --- Transform cert-manager secrets into Istio cacerts format ---
  log_info "Creating Istio cacerts secrets..."
  for item in "istio-cacerts-default-cert:istio-system" "istio-cacerts-og-cert:openshift-ingress"; do
    local secret="${item%%:*}" ns="${item##*:}"
    local CA_CERT CA_KEY ROOT_CERT CERT_CHAIN
    CA_CERT=$($KUBECTL get secret "$secret" -n "$ns" -o jsonpath='{.data.tls\.crt}' | base64 -d)
    CA_KEY=$($KUBECTL get secret "$secret" -n "$ns" -o jsonpath='{.data.tls\.key}' | base64 -d)
    ROOT_CERT=$($KUBECTL get secret "$secret" -n "$ns" -o jsonpath='{.data.ca\.crt}' | base64 -d)
    CERT_CHAIN="${CA_CERT}
${ROOT_CERT}"
    $KUBECTL create secret generic cacerts -n "$ns" \
      --from-literal=ca-cert.pem="${CA_CERT}" \
      --from-literal=ca-key.pem="${CA_KEY}" \
      --from-literal=root-cert.pem="${ROOT_CERT}" \
      --from-literal=cert-chain.pem="${CERT_CHAIN}" \
      --dry-run=client -o yaml | $KUBECTL apply -f -
  done
  log_success "Istio cacerts secrets created"

  # --- Restart istiods to pick up shared CA ---
  log_info "Restarting istiods..."
  if $KUBECTL get deployment/istiod -n istio-system &>/dev/null 2>&1; then
    $KUBECTL rollout restart deployment/istiod -n istio-system
    $KUBECTL rollout status deployment/istiod -n istio-system --timeout=300s 2>/dev/null || true
  else
    log_warn "deployment/istiod not found in istio-system — check kagenti-deps hooks"
  fi
  $KUBECTL rollout restart deployment/istiod-openshift-gateway -n openshift-ingress 2>/dev/null || true
  $KUBECTL rollout status deployment/istiod-openshift-gateway -n openshift-ingress --timeout=300s 2>/dev/null || true

  # --- Delete stale istio-ca-root-cert ConfigMaps and restart ztunnel ---
  log_info "Cleaning up stale CA ConfigMaps and restarting ztunnel..."
  for ns in kagenti-system gateway-system keycloak mcp-system istio-system istio-ztunnel; do
    $KUBECTL delete configmap istio-ca-root-cert -n "$ns" --ignore-not-found 2>/dev/null || true
  done

  $KUBECTL rollout restart daemonset/ztunnel -n istio-ztunnel 2>/dev/null || true
  $KUBECTL rollout status daemonset/ztunnel -n istio-ztunnel --timeout=300s 2>/dev/null || true
  log_success "Shared trust reconciliation complete"
}
_ensure_rhoai_shared_trust
echo ""

# ============================================================================
# Step 4: Install Kagenti (Keycloak + operator + webhook + UI)
# ============================================================================
log_info "Step 4: Install Kagenti (Keycloak + operator + webhook + UI)"

# Secrets file
SECRETS_FILE="$KAGENTI_REPO/charts/kagenti/.secrets.yaml"
SECRETS_TEMPLATE="$KAGENTI_REPO/charts/kagenti/.secrets_template.yaml"
if [ ! -f "$SECRETS_FILE" ]; then
  if [ -f "$SECRETS_TEMPLATE" ]; then
    log_info "Creating .secrets.yaml from template"
    cp "$SECRETS_TEMPLATE" "$SECRETS_FILE"
    log_warn "Edit $SECRETS_FILE if you need custom secrets (e.g. Keycloak admin password)"
  else
    log_error "No .secrets_template.yaml found at $SECRETS_TEMPLATE"
    exit 1
  fi
fi

# Build UI helm flags
KAGENTI_UI_FLAGS=()
if $SKIP_UI; then
  log_info "Kagenti UI: skipped (--skip-ui)"
  KAGENTI_UI_FLAGS+=(--set components.ui.enabled=false)
else
  if [ -z "$KAGENTI_UI_TAG" ]; then
    KAGENTI_UI_TAG=$(sed -n 's/^appVersion: "\(.*\)"/\1/p' "$KAGENTI_REPO/charts/kagenti/Chart.yaml" | head -1)
    if [ -z "$KAGENTI_UI_TAG" ]; then
      log_warn "Could not detect chart appVersion — using 'latest' for UI/backend images"
      KAGENTI_UI_TAG="latest"
    fi
  fi
  log_success "Using UI/backend tag: v${KAGENTI_UI_TAG}"
  KAGENTI_UI_FLAGS+=(--set "ui.frontend.tag=v${KAGENTI_UI_TAG}")
  KAGENTI_UI_FLAGS+=(--set "ui.backend.tag=v${KAGENTI_UI_TAG}")
fi

_ensure_helm_repo_cache
run_cmd helm dependency update "$KAGENTI_REPO/charts/kagenti/"

# Detect Keycloak public URL from route (for OIDC redirects in the browser).
# The internal URL (keycloak-service.KC_NAMESPACE:8080) is NOT reachable from outside the cluster.
KC_ROUTE=$($KUBECTL get route keycloak -n "$KC_NAMESPACE" -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
if [ -n "$KC_ROUTE" ]; then
  KEYCLOAK_PUBLIC_URL="https://${KC_ROUTE}"
  log_success "Keycloak public URL: $KEYCLOAK_PUBLIC_URL"
else
  # Fallback: construct from cluster domain
  KEYCLOAK_PUBLIC_URL="https://keycloak-${KC_NAMESPACE}.${DOMAIN}"
  log_warn "Keycloak route not found — using constructed URL: $KEYCLOAK_PUBLIC_URL"
fi

log_info "Keycloak: realm=$KC_REALM namespace=$KC_NAMESPACE"

run_cmd $KUBECTL create namespace mcp-system --dry-run=client -o yaml | $KUBECTL apply -f -

_cleanup_kagenti_oauth_jobs() {
  if $DRY_RUN; then return; fi

  for job in kagenti-agent-oauth-secret-job kagenti-ui-oauth-secret-job; do
    if $KUBECTL get job "$job" -n kagenti-system &>/dev/null 2>&1; then
      log_info "Deleting stale job $job before helm upgrade..."
      $KUBECTL delete job "$job" -n kagenti-system --ignore-not-found >/dev/null 2>&1 || true
    fi
  done
}

_cleanup_kagenti_oauth_jobs

# Do not inherit upstream demo defaults like team1/team2. We bootstrap agent
# namespaces later through the namespace controller once the real namespaces exist.
_adopt_existing_kagenti_cluster_resources

if ! _wait_cert_manager_ready; then
  log_error "Cannot install kagenti until cert-manager CRDs are available"
  exit 1
fi

_prepare_kagenti_cluster_resources_for_helm

run_cmd helm upgrade --install kagenti "$KAGENTI_REPO/charts/kagenti/" \
  -n kagenti-system --create-namespace \
  -f "$SECRETS_FILE" \
  "${KAGENTI_UI_FLAGS[@]}" \
  --set-json 'agentNamespaces=[]' \
  --set "agentOAuthSecret.spiffePrefix=spiffe://${DOMAIN}/sa" \
  --set uiOAuthSecret.useServiceAccountCA=false \
  --set agentOAuthSecret.useServiceAccountCA=false \
  --set mlflowOAuthSecret.useServiceAccountCA=false \
  --set mlflow.auth.enabled=false \
  --set "keycloak.publicUrl=${KEYCLOAK_PUBLIC_URL}" \
  --set "keycloak.realm=${KC_REALM}"

log_success "Kagenti installed"
echo ""

# ============================================================================
# Step 5: Deploy Kagenti namespace controller
# ============================================================================
log_info "Step 5: Deploy Kagenti namespace controller"

_deploy_kagenti_namespace_controller
echo ""

# ============================================================================
# Step 6: Install MCP Gateway
# ============================================================================
log_info "Step 6: Install MCP Gateway"

if $SKIP_MCP_GATEWAY; then
  log_info "Skipped (--skip-mcp-gateway)"
elif helm status mcp-gateway -n mcp-system &>/dev/null 2>&1; then
  log_info "MCP Gateway already installed — skipping"
else
  log_info "Installing MCP Gateway v${MCP_GATEWAY_VERSION}..."
  run_cmd helm install mcp-gateway oci://ghcr.io/kuadrant/charts/mcp-gateway \
    --create-namespace --namespace mcp-system --version "$MCP_GATEWAY_VERSION"
  log_success "MCP Gateway installed"
fi
echo ""

# ============================================================================
# Step 7: Verify Helm releases
# ============================================================================
log_info "Step 7: Verify Helm releases"
echo ""

VERIFY_FAILED=false

_verify_release() {
  local release="$1" ns="$2"
  log_info "helm history $release -n $ns:"
  if ! helm history "$release" -n "$ns" --max 3 2>/dev/null; then
    log_error "$release: no release found in $ns"
    VERIFY_FAILED=true
    return
  fi
  local status
  status=$(helm status "$release" -n "$ns" -o json 2>/dev/null | jq -r '.info.status // empty')
  if [ "$status" != "deployed" ]; then
    log_error "$release: status is '$status' (expected 'deployed')"
    VERIFY_FAILED=true
  else
    log_success "$release: deployed"
  fi
  echo ""
}

_verify_release kagenti-deps kagenti-system
if ! $SKIP_MCP_GATEWAY; then
  _verify_release mcp-gateway mcp-system
fi
_verify_release kagenti kagenti-system

if $VERIFY_FAILED; then
  log_error "One or more Helm releases failed verification — check output above"
  exit 1
fi

# ============================================================================
# Step 7: Show access info
# ============================================================================
log_info "Step 7: Access info"
echo ""

log_info "Kagenti pods:"
$KUBECTL get pods -n kagenti-system 2>/dev/null || log_warn "No pods in kagenti-system"
echo ""

# Kagenti UI URL
if ! $SKIP_UI; then
  UI_HOST=$($KUBECTL get route kagenti-ui -n kagenti-system -o jsonpath='{.status.ingress[0].host}' 2>/dev/null || echo "")
  if [ -n "$UI_HOST" ]; then
    log_success "Kagenti UI: https://$UI_HOST"
  fi
fi

# Keycloak admin credentials (master realm — for admin console only)
KC_SECRET=$($KUBECTL get secret keycloak-initial-admin -n "$KC_NAMESPACE" -o go-template='Username: {{.data.username | base64decode}}  Password: {{.data.password | base64decode}}' 2>/dev/null || echo "")
if [ -n "$KC_SECRET" ]; then
  log_success "Keycloak admin (master realm): $KC_SECRET"
fi

ELAPSED=$(( SECONDS - START_SECONDS ))
MINS=$(( ELAPSED / 60 ))
SECS=$(( ELAPSED % 60 ))

echo ""
echo "============================================"
echo "  Kagenti platform is ready!  (Time elapsed:${MINS}m ${SECS}s)"
echo ""
echo "  Namespace registration:"
echo "    Kagenti namespace controller is installed."
echo "    Namespaces self-register for webhook injection via label:"
echo "      kubectl label namespace <ns> kagenti-enabled=true"
echo "    The controller reconciles Kagenti ConfigMaps, RoleBindings, and SCC membership."
echo "    openclaw-installer does this automatically when Kagenti A2A is enabled."
echo ""
echo "  Next: deploy OpenClaw with A2A:"
echo "    cd $REPO_ROOT"
echo "    Use openclaw-installer in OpenShift mode with Kagenti A2A enabled"
echo "============================================"
echo ""
