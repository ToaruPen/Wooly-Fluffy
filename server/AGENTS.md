# AGENTS.md (server/)

Applies to files under `server/`. This file augments the repo-root `AGENTS.md`.

## WHY (Purpose)
- 最小 HTTP サーバ（healthcheck）。`GET /health` を `200` + `{"status":"ok"}` で返す。

## WHAT (Key Files)
- `src/http-server.ts`: `createHttpServer()`（`/health` と 404 JSON）
- `src/http-server.test.ts`: vitest テスト
- `src/main.ts`: `HOST` / `PORT` を読み取り起動（coverage では除外）

## HOW (Work Here)
- Scripts: `npm run -w server build|start|typecheck|lint|test|coverage`
- Tooling facts:
  - TypeScript: `tsconfig.json` は `strict: true`（`noUnusedLocals` / `noUnusedParameters` も有効）
  - `typecheck`: `tsc --noEmit`
  - `lint`: ESLint（`console.log` 禁止 / `fs` 直利用禁止）
  - Coverage は `vitest.config.ts` で 100%（`src/main.ts` は除外）
- Build output: `dist/`（Node ESM, `"type": "module"`）
