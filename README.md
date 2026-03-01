# Wooly-Fluffy

Local-first mascot LLM project for an after-school program.

- `server/`: Node.js HTTP API + orchestrator + SQLite (includes SSE + `/health`)
- `web/`: React (Vite) UI for KIOSK/STAFF flows

## Source of Truth

- Requirements (PRD): `docs/prd/wooly-fluffy.md`
- Implementation plan (Epic): `docs/epics/wooly-fluffy-mvp-epic.md`
- Decisions (ADR): `docs/decisions.md`

Safety note (data minimization): do not persist or log conversation text/audio/STT transcripts. See ADR-1.

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
npm run format:check
npm run check:filenames
npm run lint:naming
npm run typecheck
npm run lint
npm run test
npm run coverage
npm run deadcode
```

## CI (GitHub Actions)

- `.github/workflows/ci.yml`: runs on pull requests and pushes to `main`.
  - `npm ci`
  - `npm run format:check`
  - `npm run check:filenames`
  - `npm run lint:naming`
  - `npm audit --audit-level=high --omit=dev` (prod deps only)
  - `npm run typecheck`, `npm run lint`
  - `npm run -w server build`, `npm run -w web build`
  - `npm run -w web e2e:install:ci`, `npm run -w web e2e`
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

- `http://127.0.0.1:5173/` (KIOSK)
- `http://127.0.0.1:5173/kiosk`
- `http://127.0.0.1:5173/staff`

The dev server proxies `/api` to `http://127.0.0.1:3000`.

## Run server + web (macOS convenience)

If you are on macOS, this repo also includes a small launcher that starts both processes:

```bash
./WoolyFluffy.command
```

Notes:

- Expects `npm install` to be done.
- Uses `~/Library/Application Support/wooly-fluffy/server.env` for `STAFF_PASSCODE` etc (see `server-env.example`).

## Production (macOS LaunchAgent)

> **Note**: This section is for the production Mac (e.g. Mac mini at the venue).
> For development, use the `npm run -w server start` / `npm run -w web dev` workflow described above.
>
> **Dev vs Prod URL summary**:
>
> | Environment | URL | Notes |
> |---|---|---|
> | Dev (Vite) | `http://127.0.0.1:5173/kiosk` &#124; `/staff` | HMR, proxies `/api` to `:3000` |
> | Production | `http://<host>:3000/kiosk` &#124; `/staff` | Static build served by Node.js |
>
> Do **not** use the Vite dev URL (`5173`) on the production machine.

### Prerequisites (production)

- macOS Apple Silicon (M1/M2/M3)
- Node.js LTS installed (`/opt/homebrew/bin/node` or `/usr/local/bin/node`)
- External services running: AivisSpeech Engine (or VOICEVOX), LLM provider, whisper.cpp built
- Env file configured (see below)

### Env file (production)

The production server reads environment variables from:

```text
~/Library/Application Support/wooly-fluffy/server.env
```

**Permissions**: `chmod 600` (owner-only read/write). The file contains secrets.

```bash
# Create the directory and copy the template
mkdir -p "$HOME/Library/Application Support/wooly-fluffy"
cp ./server-env.example "$HOME/Library/Application Support/wooly-fluffy/server.env"
chmod 600 "$HOME/Library/Application Support/wooly-fluffy/server.env"

# Edit with your values (dummy examples shown)
# STAFF_PASSCODE="change-me-in-production"
# LLM_PROVIDER_KIND="local"
# LLM_BASE_URL="http://127.0.0.1:1234/v1"
# LLM_MODEL="your-model-id"
# WHISPER_CPP_CLI_PATH="/Users/you/whisper.cpp/build/bin/whisper-cli"
# WHISPER_CPP_MODEL_PATH="/Users/you/whisper.cpp/models/ggml-large-v3-turbo.bin"
```

See [Required environment variables](#required-environment-variables) for the full list.

### DB and log locations

| Data               | Default path                               | Notes                               |
| ------------------ | ------------------------------------------ | ----------------------------------- |
| SQLite DB          | `var/wooly-fluffy.sqlite3` (repo-relative) | Override with `DB_PATH` env var     |
| LaunchAgent stdout | `~/Library/Logs/wooly-fluffy/stdout.log`   | Created by `launchagent-install.sh` |
| LaunchAgent stderr | `~/Library/Logs/wooly-fluffy/stderr.log`   | Created by `launchagent-install.sh` |

### Build for production

```bash
npm run prod:build
```

This builds both `server/dist/` and `web/dist/`. The production server serves `web/dist/` as static files (no separate Vite process needed).

### Manual start (foreground)

```bash
npm run prod:start
```

This runs: env file load → preflight checks → `node server/dist/main.js`.

The preflight checks verify:

- `STAFF_PASSCODE` is set
- `WHISPER_CPP_CLI_PATH` exists and is executable
- `WHISPER_CPP_MODEL_PATH` exists and is readable
- TTS engine (`TTS_ENGINE_URL`) is reachable
- `LLM_PROVIDER_KIND` is not `stub`
- LLM provider is reachable (for `local`/`external`)
- `LLM_API_KEY` is set (for `external`/`gemini_native`)

If any check fails, the server will not start and the failing checks are printed to stderr.

### LaunchAgent (auto-start on login)

Install as a macOS LaunchAgent to start automatically on user login and restart on crash:

```bash
# Install and start
./scripts/prod/launchagent-install.sh

# Check status
launchctl print "gui/$(id -u)/com.woolyfluffy.server"

# View logs
tail -f ~/Library/Logs/wooly-fluffy/stdout.log
tail -f ~/Library/Logs/wooly-fluffy/stderr.log

# Uninstall (stop and remove)
./scripts/prod/launchagent-uninstall.sh
```

The LaunchAgent:

- Runs `scripts/prod/launchagent-run.sh` (loads env → preflight → server)
- Restarts on non-zero exit (crash recovery), with a 30-second throttle
- Starts at login (`RunAtLoad`)
- Plist installed at `~/Library/LaunchAgents/com.woolyfluffy.server.plist`

### Access URLs (production)

After the server is running (port 3000 by default):

| Page   | URL                         |
| ------ | --------------------------- |
| KIOSK  | `http://<host>:3000/kiosk`  |
| STAFF  | `http://<host>:3000/staff`  |
| Health | `http://<host>:3000/health` |

Replace `<host>` with the machine's LAN IP (e.g. `192.168.1.100`) or `127.0.0.1` for local access.

### Updating

```bash
cd /path/to/Wooly-Fluffy
git pull
npm install
npm run prod:build

# If LaunchAgent is installed, restart it:
launchctl kickstart -k "gui/$(id -u)/com.woolyfluffy.server"
```

### Troubleshooting (production)

#### 1. Check provider health

```bash
curl -s http://127.0.0.1:3000/health | python3 -m json.tool
```

Look at `providers.stt.status`, `providers.tts.status`, `providers.llm.status` — each should be `ok`.

#### 2. VOICEVOX / AivisSpeech unreachable (`providers.tts.status: unavailable`)

```bash
# AivisSpeech Engine (default, port 10101)
curl -fsS http://127.0.0.1:10101/version

# VOICEVOX Engine (alternative, port 50021)
curl -fsS http://127.0.0.1:50021/version
```

If the command fails, the TTS engine is not running. Start it and verify again.

#### 3. LLM unreachable (`providers.llm.status: unavailable`)

```bash
# Check the configured LLM_BASE_URL (must include /v1)
curl -fsS "$LLM_BASE_URL/models"
```

Common causes: LM Studio is not running, `LLM_BASE_URL` is missing `/v1`, firewall blocking.

#### 4. whisper.cpp path or permission error (`providers.stt.status: unavailable`)

```bash
# Check path exists and is executable
ls -la "$WHISPER_CPP_CLI_PATH"
"$WHISPER_CPP_CLI_PATH" --help

# Check model file exists and is readable
ls -la "$WHISPER_CPP_MODEL_PATH"
```

#### 5. Port 3000 already in use

```bash
lsof -i :3000
```

Kill the conflicting process or change the port via `PORT` env var.

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

#### 2) AivisSpeech Engine (Text-to-Speech) (Default)

Run AivisSpeech Engine (VOICEVOX-compatible HTTP API) locally.

- Default port: `10101`
- Official docs: https://github.com/Aivis-Project/AivisSpeech-Engine

**Verification**:

```bash
curl -s http://127.0.0.1:10101/version
curl -s http://127.0.0.1:10101/speakers | head -c 200
```

**Expected output**: `"1.0.0"` (for `/version`)

#### 2b) VOICEVOX Engine (Text-to-Speech) (Alternative)

Run VOICEVOX Engine via Docker (requires a Docker-compatible runtime):

```bash
# Pull VOICEVOX Docker image
docker pull voicevox/voicevox_engine:cpu-0.25.1

# Run VOICEVOX Engine (port 50021)
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
- AivisSpeech Engine: [LICENSE](https://github.com/Aivis-Project/AivisSpeech-Engine/blob/master/LICENSE) / [Docs](https://github.com/Aivis-Project/AivisSpeech-Engine)
- AivisHub: [Terms of Service](https://hub.aivis-project.com/terms-of-service)
- VOICEVOX: [利用規約](https://voicevox.hiroshiba.jp/term/)
- VRM: [CC0 License](https://vroid.pixiv.help/hc/en-us/articles/4402614652569)
- Google GenAI SDK (`@google/genai`): [Apache-2.0](https://github.com/googleapis/js-genai/blob/main/LICENSE)
- Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`): [MIT](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE)

See `docs/decisions.md` (ADR-8, ADR-9) for license primary-source URLs.

### Required environment variables

Server (required unless noted):

- `STAFF_PASSCODE` (required): passcode for `/staff` login (STAFF APIs are LAN-only)
- `DB_PATH` (optional): defaults to `var/wooly-fluffy.sqlite3`
- `TTS_ENGINE_URL` (optional): VOICEVOX-compatible engine base URL (default: `http://127.0.0.1:10101`)
- `TTS_SPEAKER_ID` (optional): style id (int32). If unset, the server picks the first style from `GET /speakers`.
- Legacy (fallback; prefer `TTS_*`): `VOICEVOX_ENGINE_URL`, `VOICEVOX_SPEAKER_ID`
- `LLM_PROVIDER_KIND` (required for non-stub): `local` / `external` / `gemini_native` (default: `stub`)
- `LLM_BASE_URL` (required for `local`/`external`): OpenAI-compatible base URL (include `/v1`)
- `LLM_MODEL` (required for `local`/`external`/`gemini_native`): model id string
- `LLM_API_KEY` (required for `external`/`gemini_native`): API key string (keep secret)
  - For Gemini native, `GEMINI_API_KEY` / `GOOGLE_API_KEY` are also accepted.
- `WOOLY_FLUFFY_PERSONA_PATH` (optional): persona markdown path. default: `~/Library/Application Support/wooly-fluffy/persona.md`
- `WOOLY_FLUFFY_POLICY_PATH` (optional): policy yaml path. default: `~/Library/Application Support/wooly-fluffy/policy.yaml`
- `WHISPER_CPP_CLI_PATH` (required for STT): path to `whisper-cli`
- `WHISPER_CPP_MODEL_PATH` (required for STT): path to `.bin` model file (adopted: `ggml-large-v3-turbo.bin`)

Server (optional tuning):

- `WF_STAFF_SESSION_TTL_MS` (optional): staff session TTL in ms (cookie Max-Age + server-side expiry; default: 180000; clamp: 10000..86400000)
- `WF_SSE_KEEPALIVE_INTERVAL_MS` (optional): SSE keep-alive interval in ms (default: 25000; clamp: 1000..300000)
- `WF_TICK_INTERVAL_MS` (optional): tick interval in ms (default: 1000; clamp: 50..60000)
- `WF_INACTIVITY_TIMEOUT_MS` (optional): inactivity timeout in ms (default: 300000; clamp: 10000..3600000)
- `WHISPER_CPP_TIMEOUT_MS` (optional): whisper.cpp process timeout in ms (default: 15000; clamp: 1000..120000)
- `TTS_TIMEOUT_MS` (optional): TTS request timeout in ms (default: 2000; clamp: 200..60000)
- Legacy (fallback; prefer `TTS_*`): `VOICEVOX_TIMEOUT_MS`
- `LLM_TIMEOUT_CHAT_MS` (optional): LLM chat timeout in ms (default: 12000; clamp: 1000..120000)
- `LLM_TIMEOUT_INNER_TASK_MS` (optional): LLM inner task timeout in ms (default: 4000; clamp: 500..120000)
- `LLM_TIMEOUT_HEALTH_MS` (optional): LLM health timeout in ms (default: 1500; clamp: 200..30000)
- `LLM_TOOL_TIMEOUT_MS` (optional): tool execution timeout cap in ms (default: 2000; clamp: 200..120000)
- `LLM_CHAT_MAX_OUTPUT_CHARS` (optional): app-side clamp for `assistant_text` (default: 320; clamp: 1..2000)
- `LLM_CHAT_MAX_OUTPUT_TOKENS` (optional): model-side chat output token cap (default: disabled; clamp: 1..8192)
- `WOOLY_FLUFFY_PERSONA_WATCH_DEBOUNCE_MS` (optional): persona/policy watch debounce in ms (default: 120; clamp: 0..3000)
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
# export TTS_ENGINE_URL="http://127.0.0.1:10101"
# export TTS_SPEAKER_ID="888753760"  # example; get ids from: GET $TTS_ENGINE_URL/speakers
# export DB_PATH="$(pwd)/var/wooly-fluffy.sqlite3"
# export LLM_CHAT_MAX_OUTPUT_CHARS="320"
# export LLM_CHAT_MAX_OUTPUT_TOKENS="256"
# export WOOLY_FLUFFY_PERSONA_PATH="$HOME/Library/Application Support/wooly-fluffy/persona.md"
# export WOOLY_FLUFFY_POLICY_PATH="$HOME/Library/Application Support/wooly-fluffy/policy.yaml"
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

### TTS evaluation script (local)

You can generate WAV samples and a JSON report with:

```bash
# (optional) wrapper
npm run tts:eval -- --help
```

```bash
# 1) List available styles from a VOICEVOX-compatible engine (Aivis included)
node scripts/tts-eval.mjs --list-speakers --engine-url http://127.0.0.1:10101

# 2) Generate samples by calling the engine directly
node scripts/tts-eval.mjs --engine-url http://127.0.0.1:10101 --speaker-ids 888753760

# 3) Generate samples through Wooly-Fluffy /api/v1/kiosk/tts
node scripts/tts-eval.mjs --server-url http://127.0.0.1:3000
```

Outputs are written under `var/tts-eval/<timestamp>/`:

- `*.wav`: synthesized samples
- `report.json`: latency and output metadata per utterance

### Common failure modes (what to check)

- `/health` shows `providers.stt.status: unavailable`
  - `WHISPER_CPP_CLI_PATH` / `WHISPER_CPP_MODEL_PATH` are missing or wrong
  - Verify locally: `"$WHISPER_CPP_CLI_PATH" --help`
- `/health` shows `providers.tts.status: unavailable`
  - TTS engine (VOICEVOX-compatible) is not running or not reachable
  - Verify (default AivisSpeech Engine): `curl -s http://127.0.0.1:10101/version`
  - Verify (VOICEVOX Engine alternative): `curl -s http://127.0.0.1:50021/version`
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
