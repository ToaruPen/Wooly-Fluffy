# 技術スタック（予定 / SoT）

このドキュメントは、MVP実装に向けた「採用予定の技術スタック」と、その根拠（一次情報URL）をまとめます。  
ライセンス/利用規約の解釈は行わず、順守上の注意点を整理します（必要なら法務判断に接続）。

## 0) 方針（決定）

- 仕様（モード/同意/保存ルール）は `.specs/` を正とし、技術スタック（STT/TTS/LLM/UI）は差し替え可能な境界で設計する
- 常設運用の前提で、復旧容易性と“止まらない”フォールバックを重視する
- データ最小化を「実装境界（送信/保存の制限）」として固定する

## 1) 採用予定スタック（MVP）

> **表記**: `決定` / `予定` / `保留（要検証）`

### 1.1 実行環境

- `決定` 常設PC: Mac mini M4（16GB / 256GB）
- `決定` 提供形態: ローカルWeb（KIOSK/STAFF） + SQLite（単機常設で運用が軽い）
- `予定` ブラウザKIOSK: Google Chrome の kiosk 起動（再配布しない前提）

### 1.2 アプリ（KIOSK/STAFF）

- `決定` 主言語（本番中核）: TypeScript（Node.js LTS）
- `決定` Backend: Node.js（TypeScript）
- `決定` Frontend: React（TypeScript）
- `予定` Frontend build: Vite（SPA。`/kiosk` と `/staff` を分離）
- `決定` DB: SQLite

### 1.2.1 画面/端末（運用）

- `決定` KIOSK と STAFF は“操作面”として分離する（子どもが STAFF を触らない）
- `決定` MVP: KIOSK はモニター1画面固定、STAFF は別端末のブラウザからアクセス（OS不問、同一LAN）
- `保留（将来）` 2画面運用: 同一Macに第2モニターがある場合は、STAFF を第2画面に常時表示してもよい
- `予定` STAFF 画面はパスコード等で保護し、自動ロックを入れる（詳細は `.specs/90_open_questions.md`）
- `保留（将来）` 施設外/別拠点からの遠隔アクセス（VPN/SSHトンネル等）

### 1.3 音声入力（Push-to-talk）

- `決定` 待機時は無反応、Push-to-talk（PTT）中だけ収録/認識
- `予定` 物理ボタン: USB HID（キーボード/フットペダル相当）で `keydown/keyup` を拾う（ブラウザ許可ダイアログを避けやすい）
- `予定` 画面ボタン: PTTのフォールバックとして常設

### 1.4 STT（音声→テキスト）

`保留（要検証）`：クラウドとローカルを比較し、MVPの既定を確定する（差し替え可能に実装）。

- `予定` クラウドSTT: OpenAI Audio API（transcribe系）
  - 制約/注意（調査メモより）: 25MB制限、長尺は分割/`chunking_strategy` 等が必要
  - 参照: `audio_llm_asr_research_2026-01-12.md`（repo root）
- `予定` ローカルSTT: `whisper.cpp` + Core ML（まずは `turbo` を検証）
  - 速度/精度の代替候補: distil-whisper / faster-whisper / MLX

### 1.5 TTS（テキスト→音声）

- `予定` ローカルTTS: VOICEVOX Nemo（MVPでは“運用しやすさ”優先）
  - `予定` クレジット: KIOSK画面に常時表示 + 物理掲示（モニター横）
- `予定` フォールバック: ブラウザ `speechSynthesis`（音声生成が落ちた時の保険）
- `保留（外す方向）` Piper: 日本語音声の“公式の入手性”と採用実装の分岐（MIT/GPL）が不確実で、MVPでは推しにくい

### 1.6 LLM（会話/抽出）

`保留（要検証）`：会話品質/キャラクター一貫性/ネット断耐性の観点で確定する（差し替え可能に実装）。

- `予定` ローカルLLM候補（ネット断フォールバック/将来）:
  - 第一候補: `Qwen2.5 7B Instruct`（Apache-2.0）
  - 代替候補: `Llama-3-ELYZA-JP-8B`（Meta Llama系ライセンス）
- `予定` ローカル推論ランタイム候補:
  - `Ollama` / `llama.cpp`（モデルライセンスは別管理）

## 2) データ最小化（“境界仕様”のたたき台）

クラウド送信の有無に関わらず、実装境界として「送信/保存」を最小化する（詳細は `.specs/04_data_policy_and_memory_model.md`）。

- 送るのは「今の発話」＋「最小の状態要約」＋「confirmedのみ（低センシティブ）」を上限付きで
- `pending` はクラウドへ送らない
- `ROOM` の会話履歴はディスクに残さない（必要ならRAM短期）
- `confirmed` / `ROOM` の「みんなの思い出」は、端末故障に備えて暗号化したバックアップをクラウドへ退避してよい（同期ではなく片方向スナップショット）

## 3) 一次情報（確認済み）：ライセンス/利用規約/モデル

> ここは「採用判断の根拠URL」を固定化するための一覧。採用時はこの一覧を更新する。

### 3.1 App / DB / Kiosk

- TypeScript: Apache License 2.0  
  https://raw.githubusercontent.com/microsoft/TypeScript/main/LICENSE.txt
- Node.js: MIT License  
  https://raw.githubusercontent.com/nodejs/node/main/LICENSE
- React: MIT License  
  https://github.com/facebook/react/blob/main/LICENSE
- Vite: MIT License  
  https://raw.githubusercontent.com/vitejs/vite/main/LICENSE
- SQLite: Public Domain  
  https://sqlite.org/copyright.html
- Google Chrome（kiosk運用時）: 利用規約（プロプライエタリ）  
  https://www.google.com/chrome/terms/
- Chromium: LICENSE（Chromium側のライセンス）  
  https://chromium.googlesource.com/chromium/src/+/main/LICENSE

### 3.2 STT（Whisper系）

- whisper.cpp: MIT License  
  https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE
- OpenAI Whisper（モデル/コード）: MIT License  
  https://raw.githubusercontent.com/openai/whisper/main/LICENSE
- faster-whisper: MIT License  
  https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/LICENSE
- distil-whisper（モデルカード）: license=MIT  
  https://huggingface.co/distil-whisper/distil-large-v3
- OpenAI Audio API（Speech-to-Text）: 公式ドキュメント/価格（内容は運用前に再確認）  
  https://platform.openai.com/docs/pricing  
  https://platform.openai.com/docs/guides/speech-to-text  
  https://platform.openai.com/docs/models/gpt-4o-transcribe-diarize  
  https://platform.openai.com/docs/models/whisper-1

### 3.3 TTS（VOICEVOX）

- VOICEVOX engine: デュアルライセンス（LGPL v3 + “ソース公開不要な別ライセンス”）  
  https://raw.githubusercontent.com/VOICEVOX/voicevox_engine/master/LICENSE
- VOICEVOX ソフトウェア利用規約  
  https://voicevox.hiroshiba.jp/term/
- VOICEVOX Nemo 利用規約  
  https://voicevox.hiroshiba.jp/nemo/term/

### 3.4 ローカルLLM（ランタイム/モデル）

- llama.cpp: MIT License  
  https://raw.githubusercontent.com/ggml-org/llama.cpp/master/LICENSE
- Ollama: MIT License  
  https://raw.githubusercontent.com/ollama/ollama/main/LICENSE
- Qwen2.5 7B: Apache License 2.0  
  https://huggingface.co/Qwen/Qwen2.5-7B/resolve/main/LICENSE
- Llama-3-ELYZA-JP-8B: META LLAMA 3 COMMUNITY LICENSE AGREEMENT  
  https://huggingface.co/elyza/Llama-3-ELYZA-JP-8B/resolve/main/LICENSE
- Meta Llama 3.1 8B Instruct: LLAMA 3.1 COMMUNITY LICENSE AGREEMENT  
  https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct/resolve/main/LICENSE

### 3.5 Piper（MVPでは外す方向 / 参照）

- rhasspy/piper: MIT License（アーカイブ済み）  
  https://raw.githubusercontent.com/rhasspy/piper/master/LICENSE.md
- OHF-Voice/piper1-gpl: GNU GPL v3  
  https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/COPYING
- rhasspy/piper-voices（モデル配布）: license=MIT（モデルカード）  
  https://huggingface.co/rhasspy/piper-voices

## 4) 調査メモ（参照）

- `audio_llm_asr_research_2026-01-12.md`（repo root）: STT（クラウド/ローカル）候補比較、M4想定、次アクション案

## 5) 未確定（要検証）と更新方針

- STTの既定（クラウド vs ローカル）: 代表音声で比較し、遅延/誤認/運用を見て確定
- LLMの既定（クラウド vs ローカル）: 会話品質とキャラ一貫性を優先しつつ、ネット断フォールバックを設計
- STAFFアクセス制御（最小事故対策）: `.specs/90_open_questions.md` の「運用/安全」を先に確定する
