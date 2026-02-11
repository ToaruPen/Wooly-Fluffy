# Wooly-Fluffy

M0 bootstrap with a minimal HTTP server, SSE endpoints, and a web skeleton.

## Requirements

- Node.js LTS
- npm

## Install

```
npm install
```

Note:

- This repo expects you to install **devDependencies** (default `npm install` behavior).
- When using Gemini native via `@google/genai`, TypeScript may require `@modelcontextprotocol/sdk` for type resolution.

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

## Main loop setup (external deps + env vars + manual smoke)

This project integrates external providers for STT (whisper.cpp), TTS (VOICEVOX), and LLM (LM Studio or an external OpenAI-compatible provider), plus a VRM model for the KIOSK avatar.

These assets/services are **not** included in the repository and must be set up manually.

### Prerequisites

- **Platform**: macOS Apple Silicon (M1/M2/M3)
- **Tools**: Homebrew, a Docker-compatible runtime (Docker Desktop recommended)
- **Optional**: pixiv account (for VRoid Hub access)

### External dependencies (local-only)

#### 1) whisper.cpp (Speech-to-Text)

Build whisper.cpp with Core ML support for optimized inference on Apple Silicon (optional):

```bash
# Install build tools
brew install cmake ninja

# Clone and build whisper.cpp
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build -DWHISPER_COREML=1
cmake --build build -j --config Release

# Download the adopted model in this repo (multilingual)
./models/download-ggml-model.sh large-v3-turbo

# Generate Core ML encoder (optional, for iOS/macOS optimization)
pip install ane_transformers openai-whisper coremltools
./models/generate-coreml-model.sh large-v3-turbo
```

**Verification**:

```bash
./build/bin/whisper-cli --help
ls -lah models/ggml-large-v3-turbo.bin  # Should be around 1.5GB
```

Current adoption in this repository: `ggml-large-v3-turbo.bin`.

**Fallback**: If Core ML build fails, the CPU backend will be used automatically.

#### 2) VOICEVOX (Text-to-Speech)

Run VOICEVOX engine via Docker (requires a Docker-compatible runtime):

```bash
# Pull VOICEVOX Docker image
docker pull voicevox/voicevox_engine:cpu-0.25.1

# Run VOICEVOX engine (port 50021)
docker run -d --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-0.25.1

# Wait 45-60 seconds for startup, then verify
curl -s http://localhost:50021/version
```

**Expected output**: `{"version":"0.25.1"}`

**Note**: VOICEVOX requires attribution ("VOICEVOX を利用したことがわかるクレジット表記") per [利用規約](https://voicevox.hiroshiba.jp/term/).

#### 3) LLM (OpenAI-compatible OR Gemini native)

This server can use either:

- an **OpenAI-compatible** HTTP API (LM Studio local or external providers), or
- the **Gemini Developer API** (native; via `@google/genai`)

Option A: LM Studio (local)

1. Install LM Studio
2. Download a model and start the local server (OpenAI-compatible)
3. Verify the server:

```bash
curl -s http://127.0.0.1:1234/v1/models
```

Option B: external provider (OpenAI-compatible)

- Prepare a provider API key and a base URL (example: `https://api.openai.com/v1`)

Option C: Gemini 2.5 Flash-Lite (OpenAI-compatible)

Gemini provides an official OpenAI-compatibility endpoint.

- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai`
- Model id: `gemini-2.5-flash-lite`
- API key: create one in [Google AI Studio](https://aistudio.google.com/app/apikey) (Paid tier recommended)

Verification:

```bash
curl -s https://generativelanguage.googleapis.com/v1beta/openai/models \
  -H "Authorization: Bearer $LLM_API_KEY"
```

Option D: Gemini 2.5 Flash-Lite (native SDK)

This repo also supports calling Gemini natively with structured outputs and function calling via the official Google GenAI SDK.

TypeScript note:

- `@google/genai` type definitions reference the Model Context Protocol (MCP) TypeScript SDK.
- This repo includes `@modelcontextprotocol/sdk` as a devDependency so `npm run -w server build` / `npm run -w server typecheck` work reliably.

#### 4) VRM Model (3D Avatar)

Download a CC0-licensed VRM model from VRoid Hub:

1. Visit [VRoid Hub](https://hub.vroid.com/) and sign in with pixiv account
2. Search for CC0 models (e.g., [β Ver AvatarSample](https://hub.vroid.com/en/users/36144806))
3. Download `.vrm` file
4. Place in `web/public/assets/vrm/` directory

If you want to use the default path without configuration, name it `web/public/assets/vrm/mascot.vrm`.

**Verification**:

```bash
ls -lah web/public/assets/vrm/*.vrm
```

**License**: Ensure the model is CC0 or compatible with commercial use. See [VRM CC0 License](https://vroid.pixiv.help/hc/en-us/articles/4402614652569).

#### 5) VRMA Motions (local-only)

Issue #38 and #82 add local-only motion playback in `/kiosk` via SSE `kiosk.command.play_motion`.

1. Prepare 4 VRMA files (do not commit/distribute raw assets)
2. Place them under `web/public/assets/motions/` with these exact filenames:

- `idle.vrma`
- `greeting.vrma`
- `cheer.vrma`
- `thinking.vrma`

These files are ignored by git via `.gitignore`.

**Manual verification (dev)**:

1. Run web dev server: `npm run -w web dev`
2. Open `http://127.0.0.1:5173/kiosk`
3. Open DevTools console and run:

```js
window.__wfPlayMotion?.("idle");
window.__wfPlayMotion?.("greeting");
window.__wfPlayMotion?.("cheer");
window.__wfPlayMotion?.("thinking");
```

If the VRMA files are present and valid, the avatar should start playing the requested motion.

### License References

- whisper.cpp: [MIT License](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)
- VOICEVOX: [利用規約](https://voicevox.hiroshiba.jp/term/)
- VRM: [CC0 License](https://vroid.pixiv.help/hc/en-us/articles/4402614652569)
- Google GenAI SDK (`@google/genai`): [Apache-2.0](https://github.com/googleapis/js-genai/blob/main/LICENSE)
- Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`): [MIT](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE)

See `docs/decisions.md` (ADR-8, ADR-9) for license primary-source URLs.

### Required environment variables

Server (required unless noted):

- `STAFF_PASSCODE` (required): passcode for `/staff` login (STAFF APIs are LAN-only)
- `DB_PATH` (optional): defaults to `var/wooly-fluffy.sqlite3`
- `VOICEVOX_ENGINE_URL` (optional): defaults to `http://127.0.0.1:50021`
- `VOICEVOX_SPEAKER_ID` (optional): VOICEVOX speaker id (default: `2`; empty/non-integer falls back to `2`)
- `LLM_PROVIDER_KIND` (required for non-stub): `local` / `external` / `gemini_native` (default: `stub`)
- `LLM_BASE_URL` (required for `local`/`external`): OpenAI-compatible base URL (include `/v1`)
- `LLM_MODEL` (required for `local`/`external`/`gemini_native`): model id string
- `LLM_API_KEY` (required for `external`/`gemini_native`): API key string (keep secret)
  - For Gemini native, `GEMINI_API_KEY` / `GOOGLE_API_KEY` are also accepted.
- `WHISPER_CPP_CLI_PATH` (required for STT): path to `whisper-cli`
- `WHISPER_CPP_MODEL_PATH` (required for STT): path to `.bin` model file (adopted: `ggml-large-v3-turbo.bin`)

Server (optional tuning):

- `WF_STAFF_SESSION_TTL_MS` (optional): staff session TTL in ms (cookie Max-Age + server-side expiry; default: 180000; clamp: 10000..86400000)
- `WF_SSE_KEEPALIVE_INTERVAL_MS` (optional): SSE keep-alive interval in ms (default: 25000; clamp: 1000..300000)
- `WF_TICK_INTERVAL_MS` (optional): tick interval in ms (default: 1000; clamp: 50..60000)
- `WF_CONSENT_TIMEOUT_MS` (optional): consent wait timeout in ms (default: 30000; clamp: 1000..600000)
- `WF_INACTIVITY_TIMEOUT_MS` (optional): inactivity timeout in ms (default: 300000; clamp: 10000..3600000)
- `WHISPER_CPP_TIMEOUT_MS` (optional): whisper.cpp process timeout in ms (default: 15000; clamp: 1000..120000)
- `VOICEVOX_TIMEOUT_MS` (optional): VOICEVOX request timeout in ms (default: 2000; clamp: 200..60000)
- `LLM_TIMEOUT_CHAT_MS` (optional): LLM chat timeout in ms (default: 12000; clamp: 1000..120000)
- `LLM_TIMEOUT_INNER_TASK_MS` (optional): LLM inner task timeout in ms (default: 4000; clamp: 500..120000)
- `LLM_TIMEOUT_HEALTH_MS` (optional): LLM health timeout in ms (default: 1500; clamp: 200..30000)
- `LLM_TOOL_TIMEOUT_MS` (optional): tool execution timeout cap in ms (default: 2000; clamp: 200..120000)
  - Note: tool timeout uses `min(LLM_TOOL_TIMEOUT_MS, LLM_TIMEOUT_CHAT_MS)`

#### Local env file (macOS)

For local development on macOS, the server will also (best-effort) load environment variables from:

- `~/Library/Application Support/wooly-fluffy/server.env` (preferred), or
- `~/Library/Application Support/wooly-fluffy/.env`

Values from these files only fill **missing** keys (they do not override variables already present in `process.env`).

You can override the path explicitly with:

- `WOOLY_FLUFFY_ENV_PATH=/absolute/path/to/server.env`

#### Env templates (new machine setup)

This repo includes env templates you can copy and edit.

Server (macOS dev):

```bash
mkdir -p "$HOME/Library/Application Support/wooly-fluffy"
cp ./server-env.example "$HOME/Library/Application Support/wooly-fluffy/server.env"
```

Web (Vite dev):

```bash
cp ./web/env.example ./web/.env.local
```

Web (optional):

- `VITE_VRM_URL` (optional): defaults to `/assets/vrm/mascot.vrm`
- `VITE_STAFF_INACTIVITY_LOCK_MS` (optional): staff UI inactivity lock in ms (default: 180000; clamp: 10000..86400000)
- `VITE_STAFF_KEEPALIVE_INTERVAL_MS` (optional): staff keepalive interval in ms (default: 30000; clamp: 1000..300000)
- `VITE_FETCH_TIMEOUT_MS` (optional): fetch timeout in ms (default: 0 = disabled; clamp: 0..120000)
  - Applies to request timeout and `readJson()` timeout
- `VITE_SSE_RECONNECT_ENABLED` (optional): enable SSE reconnect (default: true)
- `VITE_SSE_RECONNECT_BASE_DELAY_MS` (optional): reconnect base delay in ms (default: 3000; clamp: 50..60000)
- `VITE_SSE_RECONNECT_MAX_DELAY_MS` (optional): reconnect max delay in ms (default: 30000; clamp: 50..300000)

Example (bash; placeholders):

```bash
export STAFF_PASSCODE="<choose-a-passcode>"
export WHISPER_CPP_CLI_PATH="/ABS/PATH/TO/whisper.cpp/build/bin/whisper-cli"
export WHISPER_CPP_MODEL_PATH="/ABS/PATH/TO/whisper.cpp/models/ggml-large-v3-turbo.bin"

export LLM_PROVIDER_KIND="local"
export LLM_BASE_URL="http://127.0.0.1:1234/v1"
export LLM_MODEL="<lm-studio-model-id>"

# Gemini (native SDK)
# export LLM_PROVIDER_KIND="gemini_native"
# export LLM_MODEL="gemini-2.5-flash-lite"
# export LLM_API_KEY="<ai-studio-api-key>"

# Optional overrides
# export VOICEVOX_ENGINE_URL="http://127.0.0.1:50021"
# export VOICEVOX_SPEAKER_ID="2"
# export DB_PATH="$(pwd)/var/wooly-fluffy.sqlite3"
```

### Minimal manual smoke steps

1. Start the server and web

```bash
npm run -w server start
```

In another terminal:

```bash
npm run -w web dev
```

2. Open pages

- `http://127.0.0.1:5173/kiosk` (allow microphone)
- `http://127.0.0.1:5173/staff` (LAN-only)

3. Login to staff

- Enter `STAFF_PASSCODE` and log in

4. PTT -> STT -> response -> TTS playback

- Press and hold the PTT button in `/staff`
- Speak into the KIOSK machine microphone
- Release PTT
- Confirm: KIOSK shows recording while held, then the assistant responds and TTS plays audio

5. Check provider health

```bash
curl -s http://127.0.0.1:3000/health
```

Expected shape:

- `status: ok`
- `providers.stt/tts/llm.status` should be `ok` when configured

### Common failure modes (what to check)

- `/health` shows `providers.stt.status: unavailable`
  - `WHISPER_CPP_CLI_PATH` / `WHISPER_CPP_MODEL_PATH` are missing or wrong
  - Verify locally: `"$WHISPER_CPP_CLI_PATH" --help`
- `/health` shows `providers.tts.status: unavailable`
  - VOICEVOX engine is not running or not reachable
  - Verify: `curl -s http://127.0.0.1:50021/version`
- `/health` shows `providers.llm.status: unavailable` (when `LLM_PROVIDER_KIND=local|external`)
  - `LLM_BASE_URL` is wrong (must include `/v1`) or the server is not running
  - Verify: `curl -s "$LLM_BASE_URL/models"`
- `/staff` login returns `Server misconfigured`
  - `STAFF_PASSCODE` is unset
- `/staff` is `Forbidden`
  - STAFF endpoints are LAN-only; access from a non-LAN address is rejected
- VRM does not load
  - Place `web/public/assets/vrm/mascot.vrm` or set `VITE_VRM_URL` and restart `npm run -w web dev`

## Healthcheck

`GET http://127.0.0.1:3000/health` returns `200` with `{"status":"ok","providers":{...}}`
