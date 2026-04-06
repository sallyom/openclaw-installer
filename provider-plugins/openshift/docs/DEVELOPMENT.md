# Development Setup

How to work on the OpenShift installer provider plugin within openclaw-installer.

## Prerequisites

- Node.js 20+
- npm 10+
- `oc` CLI (if testing against an OpenShift cluster)
- `podman` or `docker` (if testing local deployments)

## Getting Started

The OpenShift plugin lives in `provider-plugins/openshift/` within the main installer repo. It is loaded automatically by the plugin loader -- no linking or separate installation is needed.

```bash
# Install dependencies (includes js-yaml used by the plugin)
npm install

# Start the dev server
npm run dev
```

You should see in the terminal output:
```
Loading plugins...
Loaded installer provider plugin: openshift
Plugins loaded. Registered deployers: local, kubernetes, openshift
```

## Testing with OpenShift

To see the OpenShift deployer in the UI:

```bash
# Log into your OpenShift cluster
oc login --server=https://api.your-cluster.example.com:6443

# Restart the dev server (it detects OpenShift at startup)
# In the UI, the OpenShift card should appear and be auto-selected
```

## Common issues

### Plugin not showing up in the UI

- **Did you run `npm install`?** The plugin depends on `js-yaml` which must be installed in the main repo's `node_modules`.
- **Is the plugin loader scanning `provider-plugins/`?** Check that `src/server/plugins/loader.ts` includes the `discoverProviderPlugins()` call.

### TypeScript errors

- The plugin imports from `../../../src/server/` using relative paths. If you move files around, these paths need updating.

### "No deployer registered for mode: openshift"

- The plugin loaded but failed to register. Check the terminal for error messages during startup.

## Making changes

When you change plugin code:

- **With `npm run dev`**: `tsx watch` auto-reloads server-side changes, including plugin source files. No rebuild needed.
- **For production builds**: The plugin source needs to be included in the build compilation. See `tsconfig.server.json`.
