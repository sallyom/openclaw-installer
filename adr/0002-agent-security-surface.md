# ADR 0002: Agent Security Surface

## Status

Accepted

## Context

The installer historically handled most credentials in the simplest possible way:

- collect secrets in the UI
- persist installer-managed values
- inject them into the OpenClaw runtime as plaintext environment variables or generated config

Upstream OpenClaw now has stronger built-in security features for secret handling:

- SecretRefs for `env`, `file`, and `exec` providers
- `openclaw secrets audit|configure|apply|reload`
- runtime redaction and security audit tooling

We also want a place in the installer UI for future hardening options, including possible runtime wrappers such as `nono`, without scattering security-related knobs across unrelated deploy sections.

## Decision

We add an `Agent Security` section to the installer UX and use it as the home for security-related deployment options.

For secret handling, the installer now always prefers the upstream OpenClaw model instead of offering a legacy/basic mode toggle.

- Local deploys inject secrets as environment variables and write env-backed SecretRefs into `openclaw.json`
- Kubernetes and OpenShift deploys store secrets in the installer-managed Kubernetes Secret, inject them with `secretKeyRef`, and write env-backed SecretRefs into `openclaw.json`
- explicit SecretRef overrides remain available for:
  - `env`
  - `file`
  - `exec`
- optional `secrets.providers` JSON remains available for provider-backed setups such as Vault

The installer should prefer configuring OpenClaw's native security model over inventing a parallel secret-management system.

### Future Work

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

- Adds some UX complexity because advanced users can still override the default env-backed SecretRefs with explicit provider details.
- Some provider-backed SecretRef flows require runtime prerequisites that the installer cannot magically provide, such as:
  - a `vault` binary in the runtime image
  - `VAULT_ADDR` / `VAULT_TOKEN` or equivalent auth available in the runtime environment

### Risks

- SecretRef support in the installer may create expectations that every deploy target automatically has the required external tooling installed. The UX must state runtime prerequisites explicitly.

## Notes

HashiCorp Vault should be treated as one possible `exec` provider integration, not as a special installer-owned secret backend.
