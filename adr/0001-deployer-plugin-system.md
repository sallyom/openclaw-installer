# ADR 0001: Deployer Plugin System

## Status

Accepted

## Context

The openclaw-installer supports deploying OpenClaw to multiple targets (local containers, Kubernetes). As adoption grows, there is demand for deploying to additional platforms — managed Kubernetes services, cloud-specific environments, edge devices, and enterprise platforms that each have their own authentication, networking, and resource management patterns.

Hardcoding support for every target platform into the installer creates several problems:

1. **Unbounded scope** — each new platform adds code, dependencies, and maintenance burden to the core installer.
2. **Vendor coupling** — platform-specific code in the core ties the project to particular vendors, which is inappropriate for a community-maintained tool.
3. **Slow iteration** — platform-specific features must go through the core project's release cycle even when they only affect one deployment target.
4. **Contributor friction** — contributors adding a new platform must understand the entire codebase rather than implementing a focused interface.

## Decision

We add a deployer plugin system that allows external npm packages to register new deployment targets at runtime.

### Architecture

**DeployerRegistry** (`src/server/deployers/registry.ts`) — a singleton registry where deployers are registered by mode name. Built-in deployers (local, kubernetes) register at startup. Plugins register after.

**InstallerPlugin interface** — plugins are npm packages that export a `register(registry)` function. The registry provides `register()`, `get()`, `list()`, and `detect()` methods.

**DeployerRegistration** — each registration includes:
- `mode` — unique string identifier (e.g., "local", "kubernetes")
- `title` / `description` — human-readable labels for the UI
- `deployer` — an object implementing the `Deployer` interface
- `detect` — optional async function that returns true if the platform is available
- `priority` — numeric priority for auto-selection when multiple deployers detect availability

**Plugin discovery** (`src/server/plugins/loader.ts`) — at startup, the installer scans for:
1. npm packages matching `openclaw-installer-*` in node_modules
2. Entries in `~/.openclaw/installer/plugins.json` (for local development)

**Dynamic frontend** — the `DeployForm` component no longer hardcodes available modes. It fetches the list of registered deployers from `/api/health` and renders mode cards dynamically. The highest-priority detected deployer is auto-selected.

**Exported API** — the core package exports types and classes that plugins need via `package.json` exports:
- `./deployers/types` — `Deployer`, `DeployConfig`, `DeployResult`, `LogCallback`
- `./deployers/registry` — `DeployerRegistry`, `DeployerRegistration`, `InstallerPlugin`
- `./deployers/kubernetes` — `KubernetesDeployer` (for plugins that extend K8s behavior)
- `./deployers/k8s-helpers` — shared K8s helper functions
- `./services/k8s` — K8s client utilities

### Key Changes

- `DeployMode` type widened from a closed union (`"local" | "kubernetes" | ...`) to `string`, allowing plugins to introduce new modes without modifying core types.
- The hardcoded `getDeployer()` switch statement in `routes/deploy.ts` and the hardcoded deployer instances in `routes/status.ts` are replaced with `registry.get(mode)` lookups.
- Built-in deployers are registered in `index.ts` before plugins load, so they serve as defaults if no plugins are installed.

## Consequences

### Positive

- New deployment platforms can be added without modifying the core installer.
- Platform-specific code lives in separate packages with independent release cycles.
- The core installer remains vendor-neutral and focused on shared functionality.
- Plugin authors only need to implement the `Deployer` interface and a `register` function.
- The auto-detection mechanism lets plugins automatically activate when their platform is detected.

### Negative

- The `Deployer` interface and exported helpers become a public API surface. Breaking changes require coordination with plugin authors.
- Plugin loading adds a small amount of startup time (scanning node_modules).
- Plugins that wrap `KubernetesDeployer` are coupled to its internal behavior, which isn't formally versioned beyond semver on the package.

### Risks

- A misbehaving plugin could affect the entire installer. Mitigation: plugins run in-process (no sandboxing), but errors during registration are caught and logged without crashing.
- The exported API surface may need to grow as plugin authors discover they need access to more internals. We accept this and will expand exports conservatively as needed.
