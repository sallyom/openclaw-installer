# openclaw-installer Development Guide

## Pre-commit Checklist

Before committing, run the full CI validation locally:

```bash
npm run build    # Compiles server + provider plugins (catches type errors)
npm test         # Runs all vitest tests
npm run lint     # ESLint checks
```

`npm run build` is the most important -- it runs `tsc` with emit, which catches type errors that `--noEmit` or tsx may miss due to local `@types/node` version differences.

## Key Conventions

- ESM modules: all imports use `.js` extensions (TypeScript resolves `.ts` at build time)
- `vitest` for tests, in `__tests__/` directories next to source
- `tsx watch` for dev, `tsc` for production builds
- Provider plugins use relative imports back to `src/server/` (not `@openclaw/installer/*`)

## Build Configuration

- `tsconfig.server.json` -- compiles `src/server/` to `dist/`
- `tsconfig.provider-plugins.json` -- compiles `provider-plugins/*/src/` in-place (`.js` next to `.ts`)
- `vite.config.ts` -- builds the React frontend

## Testing

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

Tests mock external dependencies (fetch, K8s API). See `src/server/deployers/__tests__/registry.test.ts` for conventions.
