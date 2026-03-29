# ADR 0002: Remove trustedProxies to Fix Subagent Pairing on OpenShift

## Status

Accepted

## Context

After deploying to OpenShift with a multi-agent bundle, subagent delegation
fails with `gateway closed (1008): pairing required` (issue #69).

### Why auto-pairing breaks with trustedProxies

The OpenShift deployer previously set
`gateway.trustedProxies: ["127.0.0.1", "::1"]` so the gateway would handle
`X-Forwarded-For` headers from the OAuth proxy sidecar.

This has a side effect: when the agent subprocess calls `callGateway()` to
spawn a subagent, it opens a WebSocket to the gateway at `127.0.0.1:18789`
**without** `X-Forwarded-For` headers (it's a direct connection, not proxied).
The gateway's `resolveClientIp()` sees the remote address is a trusted proxy,
looks for forwarding headers, finds none, and returns `undefined`. With an
undefined client IP, `shouldAllowSilentLocalPairing` returns `false` and the
pairing stays pending forever.

The `dangerouslyDisableDeviceAuth: true` flag does not help — it only bypasses
device identity checks for Control UI (operator-role) connections, not for
node-role connections like the agent subprocess.

## Decision

Remove `gateway.trustedProxies` from the OpenShift ConfigMap patch entirely.

## Rationale

### Without trustedProxies, both connection paths work

Testing on OpenShift (ROSA) confirmed:

1. **Agent subprocess auto-pairing works**: Without `trustedProxies`,
   `127.0.0.1` is treated as a direct local connection, so
   `shouldAllowSilentLocalPairing` returns `true` and device pairing
   succeeds automatically.

2. **Control UI works through the OAuth proxy**: The gateway logs a cosmetic
   warning ("Proxy headers detected from untrusted address. Connection will
   not be treated as local.") but the WebSocket connection still succeeds.
   `dangerouslyDisableDeviceAuth: true` bypasses device auth for the
   Control UI, so the "not treated as local" classification has no effect
   on functionality.

### What we lose

- **Client IP logging**: The gateway sees `127.0.0.1` for all connections
  instead of real user IPs from `X-Forwarded-For`. The OAuth proxy's own
  logs still contain real client IPs.
- **A cosmetic warning**: The gateway logs "Proxy headers detected from
  untrusted address" when the OAuth proxy forwards requests. This is
  harmless but noisy.

### What we gain

- Subagent spawning works on OpenShift without manual intervention or
  lifecycle hooks
- Simpler deployment — no postStart hooks or timing dependencies
- Brings OpenShift config closer to parity with the working local deployer

## Alternatives Considered

### Auto-approve pairing via postStart lifecycle hook

Keep `trustedProxies` and add a Kubernetes `postStart` hook that runs
`openclaw devices approve --latest` after the gateway starts. This was
tested and the approval itself succeeded, but the hook's early WebSocket
connections to the gateway during startup caused the Control UI to stop
accepting connections entirely. The hook approach adds complexity and
introduces fragile timing dependencies.

### Set allowRealIpFallback: true

Keep `trustedProxies` but configure the gateway to fall back to the remote
address when `X-Forwarded-For` is missing. This would be the cleanest fix
but depends on a gateway config option that may not be available in all
versions.

### Switch to auth.mode: trusted-proxy

Fully delegate auth to the OAuth proxy. A bigger architectural change that
modifies the auth model.

## Consequences

### Positive

- Subagent spawning works on OpenShift without manual intervention
- No lifecycle hooks or timing dependencies
- Simple, self-contained change

### Negative

- Gateway logs a cosmetic warning about proxy headers from untrusted address
- Gateway logs lose real client IPs (mitigated by OAuth proxy logs)
- If a future use case needs the gateway to distinguish real client IPs,
  `trustedProxies` would need to be re-added along with a mechanism to
  preserve agent subprocess auto-pairing (e.g., `allowRealIpFallback`)
