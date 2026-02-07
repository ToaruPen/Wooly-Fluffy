# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wooly-Fluffy is a "mascot LLM" application for an after-school program. A 3D VRM avatar (KIOSK page) interacts with users via speech, powered by STT (whisper.cpp), LLM (OpenAI-compatible API), and TTS (VOICEVOX). A separate STAFF page provides a control panel. The server uses Node.js native HTTP (no Express) with SQLite persistence.

## Monorepo Structure

npm workspaces with two packages:

- `server/` — Node.js HTTP server (ESM, `"type": "module"`). Providers (STT/TTS/LLM), orchestrator, effect executor, tools, SQLite store, SSE streaming, graceful shutdown.
- `web/` — React 18 + Vite frontend. Three.js + @pixiv/three-vrm for 3D avatar. Two pages: `/kiosk` (avatar + PTT) and `/staff` (control panel).

Tests live alongside source files (`*.test.ts` / `*.test.tsx`). E2E tests are in `web/e2e/`.

## Commands

```bash
# Install
npm install

# All checks (what CI runs)
npm run typecheck          # tsc --noEmit for both workspaces
npm run lint               # ESLint for both workspaces
npm run test               # Vitest for both workspaces
npm run coverage           # Vitest with 100% coverage gate
npm run deadcode           # Knip dead code detection
npm run format:check       # Prettier (changed files only)

# Single workspace
npm run -w server test     # Server tests only
npm run -w web test        # Web tests only
npm run -w server coverage
npm run -w web coverage

# Single test file (vitest run with filter)
npx -w server vitest run src/store.test.ts
npx -w web vitest run src/lib/wav.test.ts

# Build
npm run -w server build    # tsc → dist/
npm run -w web build       # vite build

# Run
npm run -w server start    # Builds then runs (HOST=127.0.0.1, PORT=3000)
npm run -w web dev         # Vite dev server (port 5173, proxies /api → :3000)

# E2E (Playwright, Chromium)
npm run -w web e2e:install # First time
npm run -w web e2e         # Requires server + web running

# Formatting
npm run format             # Auto-fix changed files
```

## Architecture

### Server (`server/src/`)

Request flow: `http-server.ts` → route matching → `orchestrator.ts` → providers → `effect-executor.ts` → SSE response

- **`http-server.ts`** — Native HTTP server. Routes: `/health`, `/api/v1/*`. Exports `createHttpServer()`.
- **`orchestrator.ts`** — Coordinates STT→LLM→TTS pipeline for a conversation turn.
- **`effect-executor.ts`** — Executes side effects (TTS synthesis, tool calls) from orchestrator output.
- **`providers/`** — Abstraction layer for external services:
  - `stt-provider.ts` — whisper.cpp CLI wrapper
  - `tts-provider.ts` — VOICEVOX HTTP API
  - `llm-provider.ts` — OpenAI-compatible chat completion (streaming)
  - `types.ts` — Shared provider type definitions
- **`tools/`** — LLM function-calling tools (`tool-executor.ts`, `get-weather.ts`)
- **`store.ts`** — SQLite via better-sqlite3 (session state, housekeeping)
- **`access-control.ts`** — LAN-only restriction for STAFF endpoints
- **`graceful-shutdown.ts`** — Connection tracking, SIGINT/SIGTERM handling
- **`multipart.ts`** — Audio upload parsing via busboy
- **`main.ts`** — Entry point (excluded from coverage)

### Web (`web/src/`)

- **`app.tsx`** — Router: `/kiosk` → `kiosk-page.tsx`, `/staff` → `staff-page.tsx`
- **`kiosk-page.tsx`** — Avatar display, PTT recording, SSE event handling
- **`staff-page.tsx`** — Login, PTT control, pending interaction list
- **`components/vrm-avatar.tsx`** — Three.js scene with VRM model loading
- **`components/audio-player.tsx`** — TTS audio playback
- **`kiosk-*.ts`** — Kiosk-specific logic (PTT, audio capture, expressions, motion, tool calls)
- **`sse-client.ts`** — Server-Sent Events client
- **`api.ts`** — HTTP API client
- **`lib/wav.ts`** — WAV encoding utilities

## Key Constraints

- **Coverage: 100%** — Both workspaces enforce 100% statement/branch/function/line coverage. `server/src/main.ts` is the only exclusion.
- **No `console.log`** — ESLint forbids it. Use `console.warn` or `console.error` only.
- **No direct `fs` imports** — ESLint restricts `node:fs` / `fs` imports (data minimization policy).
- **Data minimization** — Do not persist conversation text, audio, or full STT transcripts.
- **Dynamic verification** — Changes to runtime behavior (SSE, shutdown, timers, I/O, provider calls) require integration or smoke tests with explicit timeouts.
- **SoT hierarchy** — PRD (`docs/prd/`) > Epic (`docs/epics/`) > ADRs (`docs/decisions.md`) > Code. Stop and ask if contradictions are found.

## Environment Variables (Server)

Required: `STAFF_PASSCODE`. For full functionality: `WHISPER_CPP_CLI_PATH`, `WHISPER_CPP_MODEL_PATH`, `LLM_PROVIDER_KIND` (`local`/`external`/`stub`), `LLM_BASE_URL`, `LLM_MODEL`. External LLM also needs `LLM_API_KEY`. Optional: `DB_PATH`, `VOICEVOX_ENGINE_URL`, `HOST`, `PORT`.

## External Dependencies (Not in Repo)

- **whisper.cpp** — STT, built with optional Core ML (macOS Apple Silicon)
- **VOICEVOX** — TTS, Docker container on port 50021
- **LLM** — OpenAI-compatible API (LM Studio local or external provider)
- **VRM model** — 3D avatar at `web/public/assets/vrm/mascot.vrm` (CC0 licensed)
- **VRMA motions** — `web/public/assets/motions/{idle,greeting,cheer}.vrma`

## CI

GitHub Actions (`.github/workflows/ci.yml`): format check → filename check → naming check → npm audit → typecheck → lint → build server → build web → Playwright E2E → coverage → deadcode. 10-minute timeout.

## Agentic-SDD Workflow

Development follows the Agentic-SDD cycle: PRD → Epic → Issues → Estimation → Implementation → Review → PR. Scripts in `scripts/` automate this. See root `AGENTS.md` for the full protocol and command index.
