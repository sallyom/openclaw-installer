# openclaw-installer Development Guide

## Pre-commit Checklist

Before committing, run the full CI validation locally:

```bash
npm run build    # Compiles server + installer provider plugins (catches type errors)
npm test         # Runs all vitest tests
npm run lint     # ESLint checks
```

`npm run build` is the most important -- it runs `tsc` with emit, which catches type errors that `--noEmit` or tsx may miss due to local `@types/node` version differences.

## Key Conventions

- ESM modules: all imports use `.js` extensions (TypeScript resolves `.ts` at build time)
- `vitest` for tests, in `__tests__/` directories next to source
- `tsx watch` for dev, `tsc` for production builds
- Installer provider plugins use relative imports back to `src/server/` (not `@openclaw/installer/*`)

## Build Configuration

- `tsconfig.server.json` -- compiles `src/server/` to `dist/`
- `tsconfig.provider-plugins.json` -- compiles `provider-plugins/*/src/` in-place (`.js` next to `.ts`) for installer provider plugins
- `vite.config.ts` -- builds the React frontend

## Testing

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

Tests mock external dependencies (fetch, K8s API). See `src/server/deployers/__tests__/registry.test.ts` for conventions.

## Manual Testing

For manual testing, ask the user to start the app themselves with `./run.sh` and manage the dev server lifecycle on their own. Do not start or stop the dev server automatically unless explicitly asked to. Only open a browser or trigger deployments if the user specifically requests it.

## Stopping the Dev Server

If you must stop the dev server (only when explicitly asked), do **not** use `lsof -i :port -t | xargs kill` or `lsof -i :port -t -c node | xargs kill` — these can kill unrelated processes including the user's browser. Instead, kill only the dev server's own process tree:

```bash
pkill -f "tsx watch src/server/index.ts" 2>/dev/null
pkill -f "vite --strictPort" 2>/dev/null
```

## GitHub CLI

When editing PR descriptions, use `gh api repos/OWNER/REPO/pulls/NUMBER -X PATCH -f body="..."` instead of `gh pr edit --body` — the latter fails on repos with deprecated classic project integrations.
