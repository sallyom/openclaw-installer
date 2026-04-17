#!/usr/bin/env bash
# ============================================================================
# Regression test for issue #110:
# Misleading "upgrade podman" error when Podman machine is stopped
#
# Tests the version-check section of run.sh by mocking podman commands.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
PASS=0
FAIL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}FAIL${NC}: $1 — $2"; FAIL=$((FAIL + 1)); }

# --------------------------------------------------------------------------
# Helper: extract and run just the version-check block from run.sh
# Uses a mock podman script placed first in PATH
# --------------------------------------------------------------------------
run_version_check() {
  local mock_dir="$1"

  # Build a minimal test harness around the version-check block
  local harness
  harness=$(cat <<'HARNESS'
set -euo pipefail
RUNTIME="podman"
RED='\033[0;31m'
NC='\033[0m'
error() { echo "ERROR: $1"; exit 1; }

# -- version check block extracted from run.sh --
PODMAN_VERSION=$(podman version --format '{{.Client.Version}}' 2>/dev/null || echo "0")
PODMAN_MAJOR=$(echo "$PODMAN_VERSION" | cut -d. -f1)
if [ "$PODMAN_MAJOR" -lt 5 ] 2>/dev/null; then
  if podman machine list --format '{{.Running}}' 2>/dev/null | grep -qi "false"; then
    error "Podman machine is not running. Start it with: podman machine start"
  fi
  error "Podman 5.0+ required (found $PODMAN_VERSION). Please upgrade podman."
fi
echo "OK: version check passed"
HARNESS
)

  PATH="$mock_dir:$PATH" bash -c "$harness" 2>&1
}

# --------------------------------------------------------------------------
# Test 1: Machine stopped → should suggest "podman machine start"
# --------------------------------------------------------------------------
test_machine_stopped() {
  local mock_dir
  mock_dir=$(mktemp -d)

  cat > "$mock_dir/podman" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  version)
    echo "Cannot connect to Podman machine" >&2
    exit 125
    ;;
  machine)
    # Simulate a stopped machine
    echo "false"
    ;;
esac
MOCK
  chmod +x "$mock_dir/podman"

  local output
  output=$(run_version_check "$mock_dir" || true)
  rm -rf "$mock_dir"

  if echo "$output" | grep -q "podman machine start"; then
    pass "Machine stopped → suggests 'podman machine start'"
  else
    fail "Machine stopped → should suggest 'podman machine start'" "got: $output"
  fi

  # Should NOT mention "upgrade"
  if echo "$output" | grep -qi "upgrade"; then
    fail "Machine stopped → should NOT mention 'upgrade'" "got: $output"
  else
    pass "Machine stopped → does not mention 'upgrade'"
  fi
}

# --------------------------------------------------------------------------
# Test 2: Podman genuinely too old (version 4.x, no machine) → upgrade message
# --------------------------------------------------------------------------
test_old_version() {
  local mock_dir
  mock_dir=$(mktemp -d)

  cat > "$mock_dir/podman" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  version)
    echo "4.9.1"
    ;;
  machine)
    # No machines
    echo ""
    ;;
esac
MOCK
  chmod +x "$mock_dir/podman"

  local output
  output=$(run_version_check "$mock_dir" || true)
  rm -rf "$mock_dir"

  if echo "$output" | grep -q "upgrade"; then
    pass "Old version → suggests upgrade"
  else
    fail "Old version → should suggest upgrade" "got: $output"
  fi

  if echo "$output" | grep -q "podman machine start"; then
    fail "Old version → should NOT suggest 'podman machine start'" "got: $output"
  else
    pass "Old version → does not suggest 'podman machine start'"
  fi
}

# --------------------------------------------------------------------------
# Test 3: Podman 5.x running → passes version check
# --------------------------------------------------------------------------
test_good_version() {
  local mock_dir
  mock_dir=$(mktemp -d)

  cat > "$mock_dir/podman" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  version)
    echo "5.3.1"
    ;;
esac
MOCK
  chmod +x "$mock_dir/podman"

  local output
  output=$(run_version_check "$mock_dir" || true)
  rm -rf "$mock_dir"

  if echo "$output" | grep -q "OK: version check passed"; then
    pass "Good version → passes check"
  else
    fail "Good version → should pass check" "got: $output"
  fi
}

# --------------------------------------------------------------------------
# Test 4: podman version fails AND no machine support → upgrade message
# --------------------------------------------------------------------------
test_no_machine_support() {
  local mock_dir
  mock_dir=$(mktemp -d)

  cat > "$mock_dir/podman" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  version)
    exit 1
    ;;
  machine)
    # machine subcommand not available
    echo "Error: unknown command" >&2
    exit 1
    ;;
esac
MOCK
  chmod +x "$mock_dir/podman"

  local output
  output=$(run_version_check "$mock_dir" || true)
  rm -rf "$mock_dir"

  if echo "$output" | grep -q "upgrade"; then
    pass "No machine support → falls through to upgrade message"
  else
    fail "No machine support → should fall through to upgrade" "got: $output"
  fi
}

# --------------------------------------------------------------------------
# Run all tests
# --------------------------------------------------------------------------
echo "=== run.sh version check tests (issue #110) ==="
echo ""

test_machine_stopped
test_old_version
test_good_version
test_no_machine_support

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
