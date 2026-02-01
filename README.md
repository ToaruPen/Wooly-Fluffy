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

## Provider Layer Setup

This project integrates external providers for STT (whisper.cpp), TTS (VOICEVOX), and 3D avatar (VRM). These assets are **not** included in the repository and must be set up manually.

### Prerequisites

- **Platform**: macOS Apple Silicon (M1/M2/M3)
- **Tools**: Homebrew, Docker Desktop
- **Account**: pixiv account (for VRoid Hub access)

### 1. whisper.cpp (Speech-to-Text)

Build whisper.cpp with Core ML support for optimized inference on Apple Silicon:

```bash
# Install build tools
brew install cmake ninja

# Clone and build whisper.cpp
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build -DWHISPER_COREML=1
cmake --build build -j --config Release

# Download base model (multilingual, 141MB)
./models/download-ggml-model.sh base

# Generate Core ML encoder (optional, for iOS/macOS optimization)
pip install ane_transformers openai-whisper coremltools
./models/generate-coreml-model.sh base
```

**Verification**:
```bash
./build/bin/whisper-cli --help
ls -lah models/ggml-base.bin  # Should be ~141MB
```

**Fallback**: If Core ML build fails, the CPU backend will be used automatically.

### 2. VOICEVOX (Text-to-Speech)

Run VOICEVOX engine via Docker:

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

### 3. VRM Model (3D Avatar)

Download a CC0-licensed VRM model from VRoid Hub:

1. Visit [VRoid Hub](https://hub.vroid.com/) and sign in with pixiv account
2. Search for CC0 models (e.g., [β Ver AvatarSample](https://hub.vroid.com/en/users/36144806))
3. Download `.vrm` file
4. Place in `web/public/assets/vrm/` directory

**Verification**:
```bash
ls -lah web/public/assets/vrm/*.vrm
```

**License**: Ensure the model is CC0 or compatible with commercial use. See [VRM CC0 License](https://vroid.pixiv.help/hc/en-us/articles/4402614652569).

### License References

- whisper.cpp: [MIT License](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)
- VOICEVOX: [利用規約](https://voicevox.hiroshiba.jp/term/)
- VRM: [CC0 License](https://vroid.pixiv.help/hc/en-us/articles/4402614652569)

See `docs/decisions.md` (ADR-9) for full license documentation.

## Healthcheck
`GET http://127.0.0.1:3000/health` returns `200` with `{"status":"ok"}`
