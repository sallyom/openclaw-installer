#!/usr/bin/env bash
# E2E test: tokenizer credential management for local (podman) and k8s modes.
#
# Prerequisites:
#   - The installer dev server running on localhost:3000
#   - podman available (for local tests)
#   - kind cluster named "kind" with tokenizer image loaded (for k8s tests)
#
# Usage:
#   ./e2e/tokenizer.sh          # run all tests
#   ./e2e/tokenizer.sh local    # run only local tests
#   ./e2e/tokenizer.sh k8s      # run only k8s tests

set -uo pipefail

API="http://localhost:3000"
LOCAL_PORT=19701  # avoid colliding with any running instance
PASS=0
FAIL=0
ERRORS=""

# ── Helpers ──────────────────────────────────────────────────────────

log()  { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }
pass() { PASS=$((PASS + 1)); printf "  \033[32m✓ %s\033[0m\n" "$*"; }
fail() { FAIL=$((FAIL + 1)); ERRORS="${ERRORS}\n  ✗ $*"; printf "  \033[31m✗ %s\033[0m\n" "$*"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$label"
  else
    fail "$label (expected '$expected', got '$actual')"
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    pass "$label"
  else
    fail "$label (expected to contain '$needle')"
  fi
}

assert_no_secrets() {
  local label="$1" response="$2"
  local has_secret
  has_secret=$(echo "$response" | python3 -c "
import sys,json
data = json.load(sys.stdin)
creds = data.get('credentials', [])
print(any(c.get('secret','') != '' for c in creds))
" 2>/dev/null || echo "Error")
  if [ "$has_secret" = "False" ]; then
    pass "$label"
  else
    fail "$label (secrets found in response)"
  fi
}

# ── Container / volume inspection helpers ────────────────────────────

# Read the .env file from the gateway container's volume.
# Usage: read_env <container-name> <workspace-id>
read_env() {
  local container="$1" wsid="$2"
  podman exec "$container" cat "/home/node/.openclaw/workspace-${wsid}/.env" 2>/dev/null
}

# Read the open key file from the volume.
read_open_key() {
  local container="$1"
  podman exec "$container" cat /home/node/.openclaw/tokenizer/open-key 2>/dev/null
}

# Assert that a TOKENIZER_CRED_<NAME> env var line exists in .env.
assert_env_has_cred() {
  local label="$1" env_content="$2" cred_name="$3"
  if echo "$env_content" | grep -q "^TOKENIZER_CRED_${cred_name}="; then
    pass "$label"
  else
    fail "$label (TOKENIZER_CRED_${cred_name} not found in .env)"
  fi
}

# Assert that a TOKENIZER_CRED_<NAME> env var line does NOT exist in .env.
assert_env_no_cred() {
  local label="$1" env_content="$2" cred_name="$3"
  if echo "$env_content" | grep -q "^TOKENIZER_CRED_${cred_name}="; then
    fail "$label (TOKENIZER_CRED_${cred_name} still in .env)"
  else
    pass "$label"
  fi
}

# Assert that a TOKENIZER_AUTH_<NAME> line exists and is a 64-char hex string.
assert_auth_format() {
  local label="$1" env_content="$2" cred_name="$3"
  local val
  val=$(echo "$env_content" | grep "^TOKENIZER_AUTH_${cred_name}=" | head -1 | cut -d= -f2-)
  if [ -z "$val" ]; then
    fail "$label (TOKENIZER_AUTH_${cred_name} not found)"
    return
  fi
  if echo "$val" | grep -qE '^[0-9a-f]{64}$'; then
    pass "$label"
  else
    fail "$label (TOKENIZER_AUTH_${cred_name} not 64-char hex: '$val')"
  fi
}

# Assert that a TOKENIZER_HOSTS_<NAME> line exists and contains the expected host.
assert_hosts_contains() {
  local label="$1" env_content="$2" cred_name="$3" expected_host="$4"
  local val
  val=$(echo "$env_content" | grep "^TOKENIZER_HOSTS_${cred_name}=" | head -1 | cut -d= -f2-)
  if [ -z "$val" ]; then
    fail "$label (TOKENIZER_HOSTS_${cred_name} not found)"
    return
  fi
  if echo "$val" | grep -q "$expected_host"; then
    pass "$label"
  else
    fail "$label (TOKENIZER_HOSTS_${cred_name}='$val' missing '$expected_host')"
  fi
}

# Assert that a TOKENIZER_CRED_<NAME> value is valid base64 and non-empty.
assert_cred_sealed_format() {
  local label="$1" env_content="$2" cred_name="$3"
  local val decoded_len
  val=$(echo "$env_content" | grep "^TOKENIZER_CRED_${cred_name}=" | head -1 | cut -d= -f2-)
  if [ -z "$val" ]; then
    fail "$label (TOKENIZER_CRED_${cred_name} not found)"
    return
  fi
  # NaCl sealed box: 32 bytes ephemeral pk + 16 bytes MAC + plaintext ≥ 48 bytes raw ≥ 64 base64 chars
  decoded_len=$(echo "$val" | base64 -d 2>/dev/null | wc -c)
  if [ "$decoded_len" -ge 48 ]; then
    pass "$label"
  else
    fail "$label (TOKENIZER_CRED_${cred_name} decoded to $decoded_len bytes, expected ≥48)"
  fi
}

# Assert that two env var values are identical (for key preservation check).
assert_env_value_eq() {
  local label="$1" env1="$2" env2="$3" key="$4"
  local v1 v2
  v1=$(echo "$env1" | grep "^${key}=" | head -1 | cut -d= -f2-)
  v2=$(echo "$env2" | grep "^${key}=" | head -1 | cut -d= -f2-)
  if [ -z "$v1" ] || [ -z "$v2" ]; then
    fail "$label (key '$key' missing in one of the snapshots)"
    return
  fi
  if [ "$v1" = "$v2" ]; then
    pass "$label"
  else
    fail "$label ($key changed: '${v1:0:16}...' vs '${v2:0:16}...')"
  fi
}

# Read a single key from the K8s openclaw-secrets Secret (base64-decoded).
read_k8s_secret_key() {
  local ns="$1" key="$2"
  kubectl get secret openclaw-secrets -n "$ns" -o jsonpath="{.data.${key}}" 2>/dev/null | base64 -d 2>/dev/null
}

# List all TOKENIZER_* keys present in the K8s Secret.
list_k8s_tokenizer_keys() {
  local ns="$1"
  kubectl get secret openclaw-secrets -n "$ns" -o json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); [print(k) for k in sorted(d) if k.startswith('TOKENIZER_')]" 2>/dev/null
}

# Assert a K8s secret key exists and is a 64-char hex string.
assert_k8s_auth_format() {
  local label="$1" ns="$2" key="$3"
  local val
  val=$(read_k8s_secret_key "$ns" "$key")
  if [ -z "$val" ]; then
    fail "$label ($key not found in Secret)"
    return
  fi
  if echo "$val" | grep -qE '^[0-9a-f]{64}$'; then
    pass "$label"
  else
    fail "$label ($key not 64-char hex)"
  fi
}

# Assert a K8s secret key holds a valid NaCl sealed box (base64, >=48 bytes).
assert_k8s_sealed_format() {
  local label="$1" ns="$2" key="$3"
  local val decoded_len
  val=$(read_k8s_secret_key "$ns" "$key")
  if [ -z "$val" ]; then
    fail "$label ($key not found in Secret)"
    return
  fi
  decoded_len=$(echo "$val" | base64 -d 2>/dev/null | wc -c)
  if [ "$decoded_len" -ge 48 ]; then
    pass "$label"
  else
    fail "$label ($key decoded to $decoded_len bytes, expected >=48)"
  fi
}

# Poll GET /api/instances/:id until status matches target.
wait_for_status() {
  local id="$1" target="$2" timeout="${3:-120}"
  for _ in $(seq 1 "$timeout"); do
    local status
    status=$(curl -sf "$API/api/instances/$id" 2>/dev/null \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
    if [ "$status" = "$target" ]; then return 0; fi
    sleep 1
  done
  return 1
}

# Poll GET /api/instances?includeK8s=1 until the namespace appears.
wait_for_k8s_instance() {
  local id="$1" timeout="${2:-180}"
  for _ in $(seq 1 "$timeout"); do
    local found
    found=$(curl -sf "$API/api/instances?includeK8s=1" 2>/dev/null \
      | python3 -c "import sys,json; print(any(i['id']=='$id' for i in json.load(sys.stdin)))" 2>/dev/null || true)
    if [ "$found" = "True" ]; then return 0; fi
    sleep 1
  done
  return 1
}

# Poll the k8s instance list until its status matches target.
wait_for_k8s_status() {
  local id="$1" target="$2" timeout="${3:-180}"
  for _ in $(seq 1 "$timeout"); do
    local status
    status=$(curl -sf "$API/api/instances?includeK8s=1" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); inst=[i for i in d if i['id']=='$id']; print(inst[0]['status'] if inst else '')" 2>/dev/null || true)
    if [ "$status" = "$target" ]; then return 0; fi
    sleep 1
  done
  return 1
}

# PUT credentials with retry on 409 (concurrent update lock).
put_credentials() {
  local id="$1" body="$2" timeout="${3:-30}"
  for _ in $(seq 1 "$timeout"); do
    local http_code resp
    resp=$(curl -s --max-time 30 -w "\n%{http_code}" -X PUT "$API/api/instances/$id/tokenizer" \
      -H 'Content-Type: application/json' -d "$body")
    http_code=$(echo "$resp" | tail -1)
    resp=$(echo "$resp" | sed '$d')
    if [ "$http_code" = "202" ]; then
      echo "$resp"
      return 0
    elif [ "$http_code" = "409" ]; then
      sleep 2
    else
      echo "$resp"
      return 1
    fi
  done
  echo "timeout waiting for lock"
  return 1
}

# Poll GET /api/instances/:id/tokenizer until credential count matches.
wait_for_cred_count() {
  local id="$1" expected="$2" timeout="${3:-60}"
  for _ in $(seq 1 "$timeout"); do
    local count
    count=$(curl -sf "$API/api/instances/$id/tokenizer" 2>/dev/null \
      | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('credentials',[])))" 2>/dev/null || true)
    if [ "$count" = "$expected" ]; then return 0; fi
    sleep 1
  done
  return 1
}

cleanup_local() {
  local name="$1"
  log "Cleanup: deleting local instance $name"
  # Stop first (may fail if already stopped)
  curl -sf -X POST "$API/api/instances/$name/stop" >/dev/null 2>&1 || true
  sleep 2
  curl -sf -X DELETE "$API/api/instances/$name" >/dev/null 2>&1 || true
}

cleanup_k8s() {
  local ns="$1"
  log "Cleanup: deleting k8s instance $ns"
  curl -sf -X DELETE "$API/api/instances/$ns" >/dev/null 2>&1 || true
}

# ── Local (podman) tests ─────────────────────────────────────────────

test_local() {
  local NAME="openclaw-e2etkz-local"
  cleanup_local "$NAME"
  sleep 2

  log "LOCAL: Deploy with tokenizer enabled and one initial credential"
  local deploy_resp
  deploy_resp=$(curl -sf --max-time 30 -X POST "$API/api/deploy" \
    -H 'Content-Type: application/json' \
    -d '{
      "mode": "local",
      "agentName": "local",
      "prefix": "e2etkz",
      "port": '"$LOCAL_PORT"',
      "tokenizerEnabled": true,
      "tokenizerCredentials": [
        {"name": "github", "secret": "test-secret-not-real-000", "allowedHosts": ["api.github.com"]}
      ]
    }')
  assert_contains "deploy accepted" "deployId" "$deploy_resp"

  log "LOCAL: Waiting for instance to be running..."
  if wait_for_status "$NAME" "running" 120; then
    pass "instance is running"
  else
    fail "instance did not reach running state"
    cleanup_local "$NAME"
    return
  fi

  # Verify tokenizerEnabled is reported in the instance list
  local tkz_enabled
  tkz_enabled=$(curl -sf "$API/api/instances" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); inst=[i for i in d if i['id']=='$NAME']; print(inst[0]['config'].get('tokenizerEnabled', False) if inst else False)")
  assert_eq "tokenizerEnabled in listing" "True" "$tkz_enabled"

  # Verify GET /tokenizer returns the initial credential
  log "LOCAL: Verify initial credential metadata"
  local cred_resp
  cred_resp=$(curl -sf "$API/api/instances/$NAME/tokenizer")
  local cred_count
  cred_count=$(echo "$cred_resp" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('credentials',[])))")
  assert_eq "one initial credential" "1" "$cred_count"
  local cred_name
  cred_name=$(echo "$cred_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials'][0]['name'])")
  assert_eq "credential name is GITHUB" "GITHUB" "$cred_name"
  assert_no_secrets "no secrets in GET response" "$cred_resp"

  # ── Volume-level verification: initial deploy ──
  log "LOCAL: Verify volume contents after initial deploy"
  local WSID="e2etkz_local"
  local open_key
  open_key=$(read_open_key "$NAME")
  if [ -n "$open_key" ] && echo "$open_key" | grep -qE '^[0-9a-f]{64}$'; then
    pass "open-key is 64-char hex"
  else
    fail "open-key missing or bad format ('$open_key')"
  fi

  local env_snap1
  env_snap1=$(read_env "$NAME" "$WSID")
  assert_env_has_cred       "env has TOKENIZER_CRED_GITHUB"              "$env_snap1" "GITHUB"
  assert_auth_format        "env TOKENIZER_AUTH_GITHUB is 64-char hex"   "$env_snap1" "GITHUB"
  assert_hosts_contains     "env TOKENIZER_HOSTS_GITHUB has host"        "$env_snap1" "GITHUB" "api.github.com"
  assert_cred_sealed_format "TOKENIZER_CRED_GITHUB is valid sealed box"  "$env_snap1" "GITHUB"
  assert_contains "env has TOKENIZER_PROXY_URL"  "TOKENIZER_PROXY_URL=http://localhost:4001" "$env_snap1"
  assert_contains "env has TOKENIZER_SEAL_KEY"   "TOKENIZER_SEAL_KEY=" "$env_snap1"

  # ── Add a second credential ──
  log "LOCAL: Add a second credential (keep existing github, add stripe)"
  local update_resp
  update_resp=$(put_credentials "$NAME" '{
    "credentials": [
      {"name": "GITHUB", "secret": "", "allowedHosts": ["api.github.com"]},
      {"name": "stripe", "secret": "test-stripe-not-real-000", "allowedHosts": ["api.stripe.com"]}
    ]
  }')
  assert_contains "update accepted" "deployId" "$update_resp"

  log "LOCAL: Waiting for restart and credentials to update..."
  wait_for_status "$NAME" "running" 60 || true
  if wait_for_cred_count "$NAME" "2" 60; then
    pass "two credentials after add"
  else
    fail "credential count did not reach 2"
  fi

  cred_resp=$(curl -sf "$API/api/instances/$NAME/tokenizer")
  local cred_names
  cred_names=$(echo "$cred_resp" | python3 -c "import sys,json; print(','.join(sorted(c['name'] for c in json.load(sys.stdin)['credentials'])))")
  assert_eq "credential names" "GITHUB,STRIPE" "$cred_names"

  # ── Volume-level verification: after adding stripe ──
  log "LOCAL: Verify volume contents after adding stripe"
  local env_snap2
  env_snap2=$(read_env "$NAME" "$WSID")
  assert_env_has_cred       "env still has TOKENIZER_CRED_GITHUB"       "$env_snap2" "GITHUB"
  assert_env_has_cred       "env has new TOKENIZER_CRED_STRIPE"         "$env_snap2" "STRIPE"
  assert_auth_format        "TOKENIZER_AUTH_STRIPE is 64-char hex"      "$env_snap2" "STRIPE"
  assert_hosts_contains     "TOKENIZER_HOSTS_STRIPE has host"           "$env_snap2" "STRIPE" "api.stripe.com"
  assert_cred_sealed_format "TOKENIZER_CRED_STRIPE is valid sealed box" "$env_snap2" "STRIPE"

  # Verify the preserved GITHUB credential was NOT re-sealed (values unchanged)
  assert_env_value_eq "GITHUB cred preserved (not re-sealed)"  "$env_snap1" "$env_snap2" "TOKENIZER_CRED_GITHUB"
  assert_env_value_eq "GITHUB auth preserved"                  "$env_snap1" "$env_snap2" "TOKENIZER_AUTH_GITHUB"
  assert_env_value_eq "GITHUB hosts preserved"                 "$env_snap1" "$env_snap2" "TOKENIZER_HOSTS_GITHUB"

  # Verify the open key was reused (not regenerated)
  local open_key2
  open_key2=$(read_open_key "$NAME")
  assert_eq "open-key preserved after add" "$open_key" "$open_key2"

  # ── Delete one credential ──
  log "LOCAL: Delete stripe credential (keep github only)"
  update_resp=$(put_credentials "$NAME" '{
    "credentials": [
      {"name": "GITHUB", "secret": "", "allowedHosts": ["api.github.com"]}
    ]
  }')
  assert_contains "delete-update accepted" "deployId" "$update_resp"

  log "LOCAL: Waiting for restart and credentials to update..."
  wait_for_status "$NAME" "running" 60 || true
  if wait_for_cred_count "$NAME" "1" 60; then
    pass "one credential after delete"
  else
    fail "credential count did not reach 1"
  fi

  cred_resp=$(curl -sf "$API/api/instances/$NAME/tokenizer")
  cred_name=$(echo "$cred_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials'][0]['name'])")
  assert_eq "remaining credential is GITHUB" "GITHUB" "$cred_name"

  # ── Volume-level verification: after deleting stripe ──
  log "LOCAL: Verify volume contents after deleting stripe"
  local env_snap3
  env_snap3=$(read_env "$NAME" "$WSID")
  assert_env_has_cred "env still has TOKENIZER_CRED_GITHUB after delete" "$env_snap3" "GITHUB"
  assert_env_no_cred  "env has NO TOKENIZER_CRED_STRIPE after delete"   "$env_snap3" "STRIPE"
  # GITHUB should still be the same sealed value
  assert_env_value_eq "GITHUB cred still preserved after stripe delete"  "$env_snap1" "$env_snap3" "TOKENIZER_CRED_GITHUB"

  # ── Delete all credentials ──
  log "LOCAL: Delete all credentials"
  update_resp=$(put_credentials "$NAME" '{"credentials": []}')
  assert_contains "delete-all accepted" "deployId" "$update_resp"

  log "LOCAL: Waiting for restart and credentials to clear..."
  wait_for_status "$NAME" "running" 60 || true
  if wait_for_cred_count "$NAME" "0" 60; then
    pass "zero credentials after delete-all"
  else
    fail "credential count did not reach 0"
  fi

  # ── Volume-level verification: after deleting all ──
  log "LOCAL: Verify volume contents after deleting all credentials"
  local env_snap4
  env_snap4=$(read_env "$NAME" "$WSID")
  assert_env_no_cred "env has NO TOKENIZER_CRED_GITHUB after delete-all" "$env_snap4" "GITHUB"
  if echo "$env_snap4" | grep -q "^TOKENIZER_CRED_"; then
    fail "stale TOKENIZER_CRED_ entries remain in .env"
  else
    pass "no TOKENIZER_CRED_ entries in .env after delete-all"
  fi
  if echo "$env_snap4" | grep -q "^TOKENIZER_AUTH_"; then
    fail "stale TOKENIZER_AUTH_ entries remain in .env"
  else
    pass "no TOKENIZER_AUTH_ entries in .env after delete-all"
  fi
  if echo "$env_snap4" | grep -q "^TOKENIZER_HOSTS_"; then
    fail "stale TOKENIZER_HOSTS_ entries remain in .env"
  else
    pass "no TOKENIZER_HOSTS_ entries in .env after delete-all"
  fi

  # ── Cleanup ──
  cleanup_local "$NAME"
  log "LOCAL: Done"
}

# ── Kubernetes tests ─────────────────────────────────────────────────

test_k8s() {
  local NS="e2etkz-k8s-openclaw"
  cleanup_k8s "$NS"
  sleep 5

  log "K8S: Deploy with tokenizer enabled and one initial credential"
  local deploy_resp
  deploy_resp=$(curl -sf --max-time 30 -X POST "$API/api/deploy" \
    -H 'Content-Type: application/json' \
    -d '{
      "mode": "kubernetes",
      "agentName": "agent",
      "prefix": "e2etkz-k8s",
      "namespace": "'"$NS"'",
      "tokenizerEnabled": true,
      "tokenizerCredentials": [
        {"name": "github", "secret": "test-secret-not-real-000", "allowedHosts": ["api.github.com"]}
      ]
    }')
  assert_contains "deploy accepted" "deployId" "$deploy_resp"

  log "K8S: Waiting for instance to appear..."
  if wait_for_k8s_instance "$NS" 180; then
    pass "k8s instance discovered"
  else
    fail "k8s instance not found after 180s"
    cleanup_k8s "$NS"
    return
  fi

  log "K8S: Waiting for pods to be running..."
  if wait_for_k8s_status "$NS" "running" 180; then
    pass "k8s instance is running"
  else
    fail "k8s instance did not reach running state"
    cleanup_k8s "$NS"
    return
  fi

  # Verify GET /tokenizer returns the initial credential
  log "K8S: Verify initial credential metadata"
  local cred_resp
  cred_resp=$(curl -sf "$API/api/instances/$NS/tokenizer")
  local cred_count
  cred_count=$(echo "$cred_resp" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('credentials',[])))")
  assert_eq "one initial credential" "1" "$cred_count"
  local cred_name
  cred_name=$(echo "$cred_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials'][0]['name'])")
  assert_eq "credential name is GITHUB" "GITHUB" "$cred_name"
  assert_no_secrets "no secrets in GET response" "$cred_resp"

  # ── Secret-level verification: initial deploy ──
  log "K8S: Verify Secret contents after initial deploy"
  local k8s_open_key
  k8s_open_key=$(read_k8s_secret_key "$NS" "TOKENIZER_OPEN_KEY")
  if [ -n "$k8s_open_key" ] && echo "$k8s_open_key" | grep -qE '^[0-9a-f]{64}$'; then
    pass "k8s open-key is 64-char hex"
  else
    fail "k8s open-key missing or bad format"
  fi

  local k8s_seal_key
  k8s_seal_key=$(read_k8s_secret_key "$NS" "TOKENIZER_SEAL_KEY")
  if [ -n "$k8s_seal_key" ]; then
    pass "k8s Secret has TOKENIZER_SEAL_KEY"
  else
    fail "k8s Secret missing TOKENIZER_SEAL_KEY"
  fi

  assert_k8s_sealed_format "k8s TOKENIZER_CRED_GITHUB is valid sealed box" "$NS" "TOKENIZER_CRED_GITHUB"
  assert_k8s_auth_format   "k8s TOKENIZER_AUTH_GITHUB is 64-char hex"      "$NS" "TOKENIZER_AUTH_GITHUB"

  local k8s_hosts
  k8s_hosts=$(read_k8s_secret_key "$NS" "TOKENIZER_HOSTS_GITHUB")
  assert_contains "k8s TOKENIZER_HOSTS_GITHUB" "api.github.com" "$k8s_hosts"

  # Snapshot values for preservation checks
  local k8s_cred_github_v1 k8s_auth_github_v1
  k8s_cred_github_v1=$(read_k8s_secret_key "$NS" "TOKENIZER_CRED_GITHUB")
  k8s_auth_github_v1=$(read_k8s_secret_key "$NS" "TOKENIZER_AUTH_GITHUB")

  # ── Add a second credential ──
  log "K8S: Add a second credential (keep existing github, add stripe)"
  local update_resp
  update_resp=$(put_credentials "$NS" '{
    "credentials": [
      {"name": "GITHUB", "secret": "", "allowedHosts": ["api.github.com"]},
      {"name": "stripe", "secret": "test-stripe-not-real-000", "allowedHosts": ["api.stripe.com"]}
    ]
  }')
  assert_contains "update accepted" "deployId" "$update_resp"

  log "K8S: Waiting for pod restart and credentials to update..."
  sleep 5
  if wait_for_k8s_status "$NS" "running" 120; then
    pass "k8s instance running after credential add"
  else
    fail "k8s instance not running after credential add"
  fi

  if wait_for_cred_count "$NS" "2" 60; then
    pass "two credentials after add"
  else
    fail "credential count did not reach 2"
  fi

  cred_resp=$(curl -sf "$API/api/instances/$NS/tokenizer")
  local cred_names
  cred_names=$(echo "$cred_resp" | python3 -c "import sys,json; print(','.join(sorted(c['name'] for c in json.load(sys.stdin)['credentials'])))")
  assert_eq "credential names" "GITHUB,STRIPE" "$cred_names"

  # ── Secret-level verification: after adding stripe ──
  log "K8S: Verify Secret contents after adding stripe"
  assert_k8s_sealed_format "k8s TOKENIZER_CRED_STRIPE is valid sealed box" "$NS" "TOKENIZER_CRED_STRIPE"
  assert_k8s_auth_format   "k8s TOKENIZER_AUTH_STRIPE is 64-char hex"      "$NS" "TOKENIZER_AUTH_STRIPE"

  local k8s_stripe_hosts
  k8s_stripe_hosts=$(read_k8s_secret_key "$NS" "TOKENIZER_HOSTS_STRIPE")
  assert_contains "k8s TOKENIZER_HOSTS_STRIPE" "api.stripe.com" "$k8s_stripe_hosts"

  # Verify GITHUB credential was preserved (not re-sealed)
  local k8s_cred_github_v2 k8s_auth_github_v2
  k8s_cred_github_v2=$(read_k8s_secret_key "$NS" "TOKENIZER_CRED_GITHUB")
  k8s_auth_github_v2=$(read_k8s_secret_key "$NS" "TOKENIZER_AUTH_GITHUB")
  assert_eq "k8s GITHUB cred preserved (not re-sealed)" "$k8s_cred_github_v1" "$k8s_cred_github_v2"
  assert_eq "k8s GITHUB auth preserved"                 "$k8s_auth_github_v1" "$k8s_auth_github_v2"

  # Verify open key reused
  local k8s_open_key2
  k8s_open_key2=$(read_k8s_secret_key "$NS" "TOKENIZER_OPEN_KEY")
  assert_eq "k8s open-key preserved after add" "$k8s_open_key" "$k8s_open_key2"

  # ── Delete one credential ──
  log "K8S: Delete stripe credential (keep github only)"
  update_resp=$(put_credentials "$NS" '{
    "credentials": [
      {"name": "GITHUB", "secret": "", "allowedHosts": ["api.github.com"]}
    ]
  }')
  assert_contains "delete-update accepted" "deployId" "$update_resp"

  sleep 5
  if wait_for_k8s_status "$NS" "running" 120; then
    pass "k8s instance running after credential delete"
  else
    fail "k8s instance not running after credential delete"
  fi

  if wait_for_cred_count "$NS" "1" 60; then
    pass "one credential after delete"
  else
    fail "credential count did not reach 1"
  fi

  cred_resp=$(curl -sf "$API/api/instances/$NS/tokenizer")
  cred_name=$(echo "$cred_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['credentials'][0]['name'])")
  assert_eq "remaining credential is GITHUB" "GITHUB" "$cred_name"

  # ── Secret-level verification: after deleting stripe ──
  log "K8S: Verify Secret contents after deleting stripe"
  local k8s_cred_github_v3
  k8s_cred_github_v3=$(read_k8s_secret_key "$NS" "TOKENIZER_CRED_GITHUB")
  assert_eq "k8s GITHUB cred still preserved after stripe delete" "$k8s_cred_github_v1" "$k8s_cred_github_v3"

  local k8s_stripe_after_del
  k8s_stripe_after_del=$(read_k8s_secret_key "$NS" "TOKENIZER_CRED_STRIPE")
  if [ -z "$k8s_stripe_after_del" ]; then
    pass "k8s TOKENIZER_CRED_STRIPE removed from Secret"
  else
    fail "k8s TOKENIZER_CRED_STRIPE still in Secret after delete"
  fi

  # ── Delete all credentials ──
  log "K8S: Delete all credentials"
  update_resp=$(put_credentials "$NS" '{"credentials": []}')
  assert_contains "delete-all accepted" "deployId" "$update_resp"

  sleep 5
  if wait_for_k8s_status "$NS" "running" 120; then
    pass "k8s instance running after delete-all"
  else
    fail "k8s instance not running after delete-all"
  fi

  if wait_for_cred_count "$NS" "0" 60; then
    pass "zero credentials after delete-all"
  else
    fail "credential count did not reach 0"
  fi

  # ── Secret-level verification: after deleting all ──
  log "K8S: Verify Secret contents after deleting all credentials"
  local k8s_remaining_keys
  k8s_remaining_keys=$(list_k8s_tokenizer_keys "$NS")
  if echo "$k8s_remaining_keys" | grep -q "TOKENIZER_CRED_"; then
    fail "k8s stale TOKENIZER_CRED_ keys remain in Secret"
  else
    pass "k8s no TOKENIZER_CRED_ keys after delete-all"
  fi
  if echo "$k8s_remaining_keys" | grep -q "TOKENIZER_AUTH_"; then
    fail "k8s stale TOKENIZER_AUTH_ keys remain in Secret"
  else
    pass "k8s no TOKENIZER_AUTH_ keys after delete-all"
  fi
  if echo "$k8s_remaining_keys" | grep -q "TOKENIZER_HOSTS_"; then
    fail "k8s stale TOKENIZER_HOSTS_ keys remain in Secret"
  else
    pass "k8s no TOKENIZER_HOSTS_ keys after delete-all"
  fi

  # ── Cleanup ──
  cleanup_k8s "$NS"
  log "K8S: Done"
}

# ── Main ─────────────────────────────────────────────────────────────

mode="${1:-all}"

case "$mode" in
  local) test_local ;;
  k8s)   test_k8s ;;
  all)   test_local; test_k8s ;;
  *)     echo "Usage: $0 [local|k8s|all]"; exit 1 ;;
esac

printf "\n\033[1m── Results ──\033[0m\n"
printf "  \033[32mPassed: %d\033[0m\n" "$PASS"
if [ "$FAIL" -gt 0 ]; then
  printf "  \033[31mFailed: %d\033[0m\n" "$FAIL"
  printf "\033[31m%b\033[0m\n" "$ERRORS"
  exit 1
else
  printf "  \033[31mFailed: 0\033[0m\n"
  printf "\n\033[32mAll tests passed!\033[0m\n"
fi
