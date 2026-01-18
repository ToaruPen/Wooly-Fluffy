# Wooly-Fluffy

M0 bootstrap with a minimal HTTP server, SSE endpoints, and a web skeleton.

## Requirements
- Node.js LTS
- npm

## Install
```
npm install
```

## Checks
```
npm run typecheck
npm run lint
npm run test
npm run coverage
npm run deadcode
```

## CI (GitHub Actions)
- `.github/workflows/ci.yml`: runs on pull requests and pushes to `main`.
  - `npm ci`
  - `npm audit --audit-level=high --omit=dev` (prod deps only)
  - `npm run typecheck`, `npm run lint`
  - `npm run -w server build`, `npm run -w web build`
  - `npm run coverage`, `npm run deadcode`
- `.github/workflows/security-audit.yml`: runs weekly (Mon 03:00 UTC) and via manual trigger.
  - `npm audit --audit-level=high` (including dev deps)

## Run server
```
npm run -w server start
```

Defaults: `HOST=127.0.0.1`, `PORT=3000`.

## Run web (dev)
```
npm run -w web dev
```

Open:
- `http://127.0.0.1:5173/kiosk`
- `http://127.0.0.1:5173/staff`

The dev server proxies `/api` to `http://127.0.0.1:3000`.

## Healthcheck
`GET http://127.0.0.1:3000/health` returns `200` with `{"status":"ok"}`
