# 04_tech_stack_findings

## 現状の方針（決定）

- 具体的な技術スタックは固定せず、差し替え可能な境界（Provider設計）を先に固めて検証する
- ただしMVPの“土台”としては **ローカルWeb + SQLite** が筋が良い（単機常設、運用が軽い、TTL/キュー/検索に強い）

## 外部調査LLMの提案（要約）

### 推奨案A（最短でMVP到達・品質優先のクラウド併用）

- UI: ローカルWeb（例: FastAPI + React/Vite） + Chrome kiosk
- STT: まずクラウドWhisper系API → 後からローカルWhisperへ差し替え
- TTS: まずspeechSynthesis（macOS日本語音声）→ 必要ならVOICEVOX等
- LLM: Mock/ルール → クラウドLLM（会話品質とキャラクター安定優先）
- 永続: SQLite

### 推奨案B（ネット断耐性・データ最小化のローカル優先）

- UI/永続: 案Aと同様（ローカルWeb + SQLite）
- STT: ローカル whisper.cpp（Metal）
- TTS: speechSynthesis → 必要ならローカルTTS（例: VOICEVOX engine）
- LLM: ローカルLLM（Ollama / llama.cpp 等。モデル選定は要調査）

## 重要な注意点（この時点で確定していない/要検証）

- ライセンス/利用規約:
  - VOICEVOX/Piper/ローカルLLMの「本体/モデル/音声の利用条件」は混同しやすい
  - 採用判断は“根拠URL付き”で再確認が必要
- クラウド送信:
  - 「端末に保存しない」≠「外部に残らない」
  - STT/LLM/TTSそれぞれの保持・学習利用・ログ設定を確認し、送信するテキスト量を仕様として最小化する必要がある
- 常設運用:
  - STAFF UIのアクセス制御（子どもが触れない）をMVPでも用意した方が安全
- パフォーマンス:
  - ローカルSTT + ローカルLLM + ローカルTTSを同時に走らせると詰まりやすい可能性があるため、最初は“重い処理は1系統ずつ”で段階導入が現実的

## 段階的MVP（技術面の進め方）

- Step1: 音声/LLMなしでも、モード/同意/DB/職員Confirmの骨格を完成させる（Mock/ルールでOK）
- Step2: STT/TTSを差し替えて現場入力UX（Push-to-talk）を固める（クラウドSTT vs ローカルSTTを比較）
- Step3: LLMを入れて会話品質/キャラクター一貫性/誤抽出耐性を詰める（必要ならローカルフォールバック）

