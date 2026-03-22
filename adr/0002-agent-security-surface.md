# ADR 0002: Agent Security Surface

## Status

Proposed

## Context

The installer currently handles most credentials in the simplest possible way:

- collect secrets in the UI
- persist installer-managed values
- inject them into the OpenClaw runtime as plaintext environment variables or generated config

That path is still useful, but upstream OpenClaw now has stronger built-in security features for secret handling:

- SecretRefs for `env`, `file`, and `exec` providers
- `openclaw secrets audit|configure|apply|reload`
- runtime redaction and security audit tooling

We also want a place in the installer UI for future hardening options, including possible runtime wrappers such as `nono`, without scattering security-related knobs across unrelated deploy sections.

## Decision

We add an `Agent Security` section to the installer UX and use it as the home for security-related deployment options.

### Phase 1

Phase 1 focuses on upstream-compatible secret handling:

- keep the current plaintext/env injection flow as the default simple path
- add an advanced path that maps installer inputs to OpenClaw SecretRef-based configuration
- support SecretRef sources that already exist upstream:
  - `env`
  - `file`
  - `exec`

The installer should prefer configuring OpenClaw's native security model over inventing a parallel secret-management system.

### Phase 2+

Future hardening options may also live under `Agent Security`, including:

- runtime isolation options beyond the container/pod baseline
- `nono` integration if it proves feasible
- stricter channel-access defaults or shared-inbox guidance where appropriate

These are explicitly out of scope for the first implementation.

## Consequences

### Positive

- Gives users one predictable place to look for security-related settings.
- Keeps the installer aligned with upstream OpenClaw instead of duplicating secret infrastructure.
- Leaves room for future hardening work without forcing a UI redesign later.
- Allows advanced operators to use Vault-like `exec` providers, mounted secret files, or env-based SecretRefs without storing raw third-party secrets in installer-managed config.

### Negative

- Adds UX complexity compared with the current "just paste the token" flow.
- Requires clear copy so users understand the difference between plaintext secrets and SecretRefs.
- Some provider-backed SecretRef flows require runtime prerequisites that the installer cannot magically provide, such as:
  - a `vault` binary in the runtime image
  - `VAULT_ADDR` / `VAULT_TOKEN` or equivalent auth available in the runtime environment

### Risks

- If the UI exposes low-level provider details too early, the feature may confuse users who only want a simple local deploy.
- SecretRef support in the installer may create expectations that every deploy target automatically has the required external tooling installed. The UX must state runtime prerequisites explicitly.

## Notes

HashiCorp Vault should be treated as one possible `exec` provider integration, not as a special installer-owned secret backend.
