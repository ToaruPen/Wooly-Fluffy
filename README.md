# Wooly-Fluffy

M0 bootstrap with a minimal HTTP healthcheck server and test toolchain.

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

## Run server
```
npm run -w server start
```

Defaults: `HOST=127.0.0.1`, `PORT=3000`.

## Healthcheck
`GET http://127.0.0.1:3000/health` returns `200` with `{"status":"ok"}`
