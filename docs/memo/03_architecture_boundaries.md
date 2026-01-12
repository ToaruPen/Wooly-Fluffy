# 03_architecture_boundaries

仕様を固定しつつ、技術スタック（STT/TTS/LLM/UI）を差し替えて試せるように「境界（インターフェース）」を先に決める。

## 全体方針（決定）

- 会話を止めないために **同期（会話パス）** と **非同期（記憶パス）** を分離する

## コンポーネント案（境界）

- `KIOSK UI`（子ども用）
- `STAFF UI`（職員用）
- `Conversation Orchestrator`（中核）
  - `ROOM` / `PERSONAL(name)` の状態遷移
  - inactivity 3分で `ROOM` 復帰
  - 破綻しない定型動作（順番促し、聞き返し）
- Provider（差し替え対象）
  - `STTProvider`: audio → text
  - `TTSProvider`: text → audio（またはUI側でspeechSynthesis）
  - `ChatProvider`: {mode, persona, short_context, confirmed_memories…} → assistant_text
  - `MemoryExtractor`: user_text（+必要ならassistant_text）→ memory_candidate（ホワイトリスト準拠）
- `Store`（永続）
  - SQLite等（`children`, `memory_items`）
- `Housekeeping`（常設運用）
  - 起動時復旧（必ず `ROOM` から開始＝安全側）
  - TTL掃除（`pending` の期限切れ削除）
  - ヘルスチェック（STT/LLMが落ちてもUIが固まらない）

## データフロー（MVP）

1. PTT押下 → KIOSKが録音開始（待機時は無反応）
2. PTT離す → `STTProvider` → text
3. Orchestrator がモード解釈
   - `「パーソナル、<name>」` → `PERSONAL(name)`
   - `「ルーム」` → `ROOM`
4. Orchestrator → `ChatProvider` で返答生成
5. 返答を音声化（`TTSProvider` or UI側）して再生
6. `PERSONAL` 中に `MemoryExtractor` が候補を出す
   - 候補が出たら「覚えていい？」へ
   - 子ども「いいえ」→破棄（職員UIへ載せない）
   - 子ども「はい」→ `pending` をStoreへ保存 → STAFF UIへ
   - 職員Confirm → `confirmed`（想起対象）

## 失敗時の挙動（止めない）

- STT失敗: テキスト未取得 → 定型で聞き返し（全文ログは保存しない）
- LLM失敗/タイムアウト:
  - `ROOM`: 順番促し/相づち/短い質問など “安全な定型” へフォールバック
  - `PERSONAL`: 低センシティブの定型会話に限定、必要なら自然に `ROOM` へ戻る
- TTS失敗: 音声なしでテキスト表示のみ（会話は継続）
- DB失敗: `pending/confirmed` 書込失敗 → 「先生にあとで言ってね」等で落とす（会話は継続）
- 再起動: モードは `ROOM` に戻す。`pending` は残るので職員が後から処理できる

