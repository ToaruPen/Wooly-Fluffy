# アーキテクチャ方針（具体アプローチ）

## 全体方針（決定）

- 仕様を固定しつつ、技術スタック（STT/TTS/LLM/UI）を差し替えて検証できるように、境界（Provider）を先に決める
- 会話を止めないために **同期（会話パス）** と **非同期（記憶パス）** を分離する

## 実行環境（MVP）

- 常設PC: Mac mini (M4, 16GB mem, 256GB storage)
- 表示: モニターにマスコットを常時表示（ぬいぐるみ筐体は将来差し替え）
- 運用: ローカル1台で完結（サーバは同一端末。KIOSKはモニター、STAFFは別端末ブラウザからアクセス可能）

## コンポーネント案（境界）

- `KIOSK`（子ども用表示）
  - （予定）ブラウザ（WebGL）で VRM ビューアを常時表示する
  - 入力は原則 Push-to-talk（hold-to-talk）。**PTT操作はSTAFF側**（MVPは `Space` 長押し、画面ボタンはフォールバック）に寄せる
  - （予定）Webカメラは **デフォルトOFF**（STAFF 側の操作で ON/OFF）で非言語シグナルを作る
    - フレームはローカル処理して破棄（保存しない/外部送信しない）
    - STAFF UI には映像プレビューを出さず、運用上は「シグナル」のみ扱う
    - 物理的に遮断できる（プライバシーシャッター/カバー等）構成で運用する（ソフトOFFだけに依存しない）
  - （推奨）「はい/いいえ」ボタン（STT誤認対策。PTT以外の入力は必要最小にする）
- `STAFF UI`（職員用）
  - `pending` 一覧 → Confirm/Deny
  - 緊急で `ROOM` へ戻す
  - KIOSKのメタ制御（緊急停止、カメラON/OFFなど）
  - アクセス制御: 原則は別端末のブラウザから操作（OS不問、同一LAN）。共有パスコード + 自動ロックで保護する
- `Conversation Orchestrator`（中核）
  - `ROOM` / `PERSONAL(name)` の状態遷移
  - inactivity `3分` で `ROOM` 復帰
  - 破綻しない定型動作（順番促し、聞き返し）
- Provider（差し替え対象）
  - `STTProvider`: audio → text
  - `TTSProvider`: text → audio（またはUI側でspeechSynthesis）
  - `ChatProvider`（外側モデル）: {mode, persona, short_context, confirmed_memories…} → assistant_text
  - `InnerTaskProvider`（内側モデル）: 非決定的処理（分類/抽出/要約など）→ **スキーマ固定のJSON**（コード側で検証して採用）
  - `MemoryExtractor`: user_text（+必要ならassistant_text）→ memory_candidate（ホワイトリスト準拠。MVPでは `InnerTaskProvider` の task（例: `memory_extract`）として実装する）
  - `VisionProvider`: camera → scene_signals（保存しない/個人識別しない前提で `present` / `face_target_point` / `people_count_approx` / `mood`（表情の粗い分類）など）
    - 映像フレームは端末内で処理して破棄し、必要なら **シグナル（JSON）のみ**を境界の外へ渡す（フレームは送らない）
    - Orchestratorは「会話内容の事実」や「感情の断定」に使わない（非言語リアクション、順番促し、待機→挨拶の補助などに限定）
- `Store`（永続）
  - SQLite等（`children`, `memory_items`）
- `Housekeeping`（常設運用）
  - 起動時復旧（必ず `ROOM` から開始＝安全側）
  - TTL掃除（`pending` の期限切れ削除）
  - ヘルスチェック（STT/LLMが落ちてもUIが固まらない）
  - （予定）`confirmed` / `ROOM` の暗号化バックアップ作成（クラウド退避）

## データフロー（MVP）

1. STAFFがPTT開始（hold-to-talk） → Orchestrator → KIOSKが録音開始（待機時は無反応）
2. STAFFがPTT終了 → Orchestrator → KIOSKが録音停止 → `STTProvider` → text
3. Orchestrator がモード解釈
   - `「パーソナル、<name>」` → `PERSONAL(name)`
   - `「ルーム」` → `ROOM`
4. Orchestrator → `ChatProvider` で返答生成
5. 返答を音声化（`TTSProvider` or UI側）して再生（またはテキストのみ表示）
6. `PERSONAL` 中に `MemoryExtractor`（= `InnerTaskProvider` の `memory_extract`）が候補を出す
   - 候補が出たら「覚えていい？」へ
   - 子ども「いいえ」→破棄（職員UIへ載せない）
   - 子ども「はい」→ `pending` をStoreへ保存 → STAFF UIへ
   - 職員Confirm/Deny → Store の `pending` を `confirmed/rejected` に更新（想起対象は `confirmed` のみ）

## KIOSKの非言語リアクション（予定/決定）

### 目線追従（Vision → LookAt）

- KIOSK側で Webカメラを使用し（STAFF 操作で ON になっている間）、顔の**位置**を検出して VRM の注視点（LookAt）に使う
  - 個人識別はしない（顔認証/個人ID付与はしない）。画像は保存しない/外部送信しない
- 複数人が映る場合は「現在のターゲットを優先」し、安定性のために短期のターゲットロック/ヒステリシスを入れる
  - 例（初期値）:
    - 現ターゲットが見えている限り維持
    - 別の顔が「十分大きい」状態が **0.5秒** 続いたら切替（例: `challenger_area > current_area * 1.3`）
    - 現ターゲットが **0.3秒** 見えなければ解除し、最大サイズを新ターゲットにする
- 追従の強さは状態で変える（会話していない時は弱める）
  - `conversation_active = ptt_pressed || tts_playing || (now - last_conversation_event) < 2s`
  - `conversation_active` の間は追従を強め、そうでない時は弱める（“通過反応（弱）”と“ロック反応（強）”の2段階を想定）

### 口パク（TTS → LipSync）

- MVPは **振幅ベース**（音声の振幅から `mouthOpen` を作る）で実装する
  - VRMの表情（口形）は `A/I/U/E/O` を想定したインターフェースにする（MVPは `A` のみ使用）
- 将来の拡張として **音素/viseme ベース**（タイミング付きの口形）へ差し替え可能にする
- 口パク/表情は LLM に依存しない（会話体験のレイテンシに影響させない）

## 失敗時の挙動（止めない / 決定）

- STT失敗: テキスト未取得 → 定型で聞き返し（全文ログは保存しない）
- LLM失敗/タイムアウト:
  - `ROOM`: 順番促し/相づち/短い質問など “安全な定型” へフォールバック
  - `PERSONAL`: 低センシティブの定型会話に限定、必要なら自然に `ROOM` へ戻る
- TTS失敗: 音声なしでテキスト表示のみ（会話は継続）
- DB失敗: `pending/confirmed` 書込失敗 → 「先生にあとで言ってね」等で落とす（会話は継続）
- 再起動: モードは `ROOM` に戻す。`pending` は残るので職員が後から処理できる
