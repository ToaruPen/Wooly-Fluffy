---
paths:
  - "server/**"
---
# Server Rules

- Build: `npm run -w server build` (tsc → `dist/`, Node ESM)
- Start: `npm run -w server start` (builds first, HOST=127.0.0.1, PORT=3000)
- Scripts: `npm run -w server typecheck|lint|test|coverage`
- `main.ts` is excluded from coverage; do not rely on coverage gates for lifecycle regressions.

## Dynamic Verification

When changing runtime behavior, add a test that fails on hangs (explicit timeout):
- SSE endpoints (`/api/v1/*/stream`) and long-lived connections
- Shutdown behavior (`server.close()` + connection draining)
- Keep-alive intervals/timers
- Provider calls (timeout/cancel/retry/streaming)
