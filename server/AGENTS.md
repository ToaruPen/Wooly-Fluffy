# AGENTS.md (server/)

Applies to files under `server/`. This file augments the repo-root `AGENTS.md`.

## WHY (Purpose)

- Minimal HTTP server (healthcheck). `GET /health` returns `200` with `{"status":"ok"}`.

## WHAT (Key Files)

- `src/http-server.ts`: `createHttpServer()` (`/health` and JSON 404)
- `src/http-server.test.ts`: vitest tests
- `src/main.ts`: reads `HOST` / `PORT` and starts the server (excluded from coverage)

## HOW (Work Here)

- Scripts: `npm run -w server build|start|typecheck|lint|test|coverage`
- Tooling facts:
  - TypeScript: `tsconfig.json` is `strict: true` (also enables `noUnusedLocals` / `noUnusedParameters`)
  - `typecheck`: `tsc --noEmit`
  - `lint`: ESLint (disallow `console.log` / disallow direct `fs` usage)
  - Coverage is 100% in `vitest.config.ts` (`src/main.ts` is excluded)
- Build output: `dist/` (Node ESM, `"type": "module"`)

## Runtime / Dynamic Verification

When changing server runtime behavior, add a dynamic verification (test or smoke) that fails on hangs.

Common cases:

- SSE endpoints (`/api/v1/*/stream`) and other long-lived connections
- shutdown behavior (`server.close()` waiting for existing connections)
- keep-alive intervals/timers

Notes:

- `src/main.ts` is excluded from coverage, so do not rely on coverage gates to catch lifecycle regressions.
- Prefer a test that keeps an SSE connection open, triggers shutdown, and asserts shutdown completes within a timeout.
