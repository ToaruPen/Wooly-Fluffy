---
paths:
  - "web/**"
---
# Web Rules

- Dev server: `npm run -w web dev` (port 5173, proxies `/api` → `http://127.0.0.1:3000`)
- Scripts: `npm run -w web typecheck|lint|test|coverage`
- E2E: `npm run -w web e2e` (requires both server and web running)

## E2E Smoke

Playwright (Chromium) waits for:
- Server: `http://127.0.0.1:3000/health`
- Web: `http://127.0.0.1:5173/kiosk`

## UI Verification

Claude in Chrome is allowed ONLY for manual visual review, NOT for CI decisions.

Check points:
- `/kiosk`: stage area visible, consent modal clickable, recording indicator readable
- `/staff`: login usable on desktop/mobile, PTT button large enough, pending list readable
