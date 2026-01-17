# 実装ロードマップ（MVP → 段階導入）

> このファイルはToDo（SoT外）。決定事項は `.specs/` に反映する。

このドキュメントは、SoT（`.specs/`）に基づいて「何をどの順で実装するか」を固定するためのロードマップです。  
スコープはまず **MVP（A→B0）** を最短で安全に成立させることに置きます。

## スコープ（このロードマップの対象）

- 仕様: `.specs/02_usecases_and_mvp.md`（A→B0）、`.specs/03_modes_identification_and_consent.md`、`.specs/04_data_policy_and_memory_model.md`、`.specs/05_architecture_approach.md`、`.specs/07_orchestrator_contract.md`
- 中核実装: TypeScript（Node.js LTS）+ React（Vite）+ SQLite（`.specs/06_tech_stack_plan.md`）
- 運用: KIOSK（モニター1画面）+ STAFF（別端末ブラウザ、OS不問、同一LAN）

## スコープ外（この段階ではやらない）

- Webカメラ（Vision）/ 3Dアバター / タッチゲーム（後続。`docs/memo/92_roadmap_backlog.md`）
- NFC導入（B）/ 複数拠点同期 / 施設外からの遠隔アクセス（後続）

## マイルストーン

### M0: 開発可能な最小骨格（UI/Server/DBの空配線）

狙い: 「動く箱」を先に用意して、以降の機能追加を小さく積み上げる。

- 成果物
  - `server`（Orchestrator APIの枠、healthcheck）
  - `web`（KIOSK/STAFF ルーティング枠、画面が出る）
    - 初期は CSS Modules で実装（必要なら後で Tailwind にピボット可能。ただし後ろ倒しほど移行コストは増える）
    - Web品質: React/TypeScript向け lint（例: ESLint + React Hooks）と deadcode 検出（`knip`）を `web` でも運用する（候補抽出→目視確認→テスト）
  - SQLiteの接続/マイグレーション枠（空でもよい）
- Evidence
  - ローカル起動手順が `README` 相当で再現できる

### M1: Orchestrator（状態機械）を純粋ロジックとして確定 + ユニットテスト

狙い: もっとも壊れやすい“仕様”（モード/同意/タイムアウト/フォールバック）をテストで固定する。

- 実装対象（SoT）
  - Orchestrator契約: `.specs/07_orchestrator_contract.md`
  - モード/同意: `.specs/03_modes_identification_and_consent.md`
  - `ROOM` / `PERSONAL(name)` 遷移
  - `3分` 無操作で `ROOM` へ戻る（明示アナウンスしない）
  - `「覚えていい？」` → 子ども `はい/いいえ` の分岐
  - 緊急停止/復帰（`STAFF_EMERGENCY_STOP` / `STAFF_RESUME`）
  - 失敗時フォールバック（STT/LLM/TTS/DBが落ちても止めない）
- Evidence（必須）
  - Orchestratorの主要仕様がユニットテストで担保されている（タイマーはfake timersで検証）

### M2: Store（SQLite）+ pending TTL + staff confirm（データパス）

狙い: 「保存してよいものだけを保存する」をデータ層で強制し、運用の核を成立させる。

- 実装対象（`.specs/04_data_policy_and_memory_model.md`）
  - `pending`（24h TTL）/ `confirmed`
  - TTL掃除ジョブ（Housekeeping）
  - 削除/編集はSTAFF側から（詳細手順は後続で詰める）
- Evidence
  - 統合テストで `pending` → staff confirm → `confirmed` まで通る
  - TTLで `pending` が消えることをテストで担保

### M3: API（KIOSK/STAFF）とProvider境界（スタブでOK）

狙い: STT/LLM/TTS をまだ繋がなくても、KIOSK↔STAFFの最小導線を成立させる。

- 実装対象（`.specs/05_architecture_approach.md`）
  - KIOSK: mode/state取得、発話入力（当面はテキストでも可）、応答表示
  - STAFF: pending一覧、Confirm/Deny、Force ROOM
  - Provider境界（スタブ実装）: STT/Chat/TTS/MemoryExtractor
- Evidence
  - Providerが落ちる/遅い/空返答でもUIが固まらず、定型フォールバックへ落ちる

### M4: KIOSK UI（状態表示/フォールバック）+ STAFF UI（PTT + 運用最低ライン）

狙い: 現場で使える“最低限の形”にする（見守り前提で破綻しない）。

- KIOSK（必須）
  - PTT状態の表示（録音中/認識中/発話中 など）
  - 「はい/いいえ」ボタン（STT誤認対策）
  - フォールバック（音声が無理ならテキスト表示のみでも進む）
- STAFF（必須）
  - PTT（hold-to-talk。ホットキーは `Space` 長押しを基本、画面ボタンはフォールバック。将来は物理ボタンも可）
  - パスコード等の最低限の保護（詳細は後で詰めるが、MVPでも“無保護”は避ける）
  - 診断（疎通）ページ（DB/Providerの状態が分かる）
- Web品質（将来導入予定）
  - React/TypeScript向け lint（例: ESLint + React Hooks など）を導入して、初期から破綻しにくくする（依存追加は合意の上で）
  - deadcode 検出（`knip`）を `web` も含めて運用し、「候補抽出→目視確認→テスト」で安全に削除できるようにする
- Evidence
  - 現場手順（起動/復旧/最低限の操作）が1枚で説明できる

### M5: 実Providerを段階導入（1つずつ）

狙い: 音声・LLM・TTSを同時に入れて詰まらないように、1系統ずつ安全に導入する。

導入順（推奨）:
1. TTS（まずは `speechSynthesis` フォールバック確実化 → VOICEVOX等）
2. STT（クラウド or ローカルを比較して既定を決める）
3. LLM（クラウド or ローカル。ネット断フォールバック含む）

- Evidence
  - 各Providerごとに「起動してない/遅い/失敗」の動作が診断画面で確認できる

### M5.5: （後続）`ROOM` の「みんなの思い出」

狙い: 会話体験（LLM/フォールバック/ログ最小化等）が固まってから、段階導入する。

- 実装対象（`.specs/04_data_policy_and_memory_model.md`）
  - 日付単位の要約（個人特定なし）
  - 作り方（職員手入力/半自動/自動抽出）の選択と、保持期間の決定

### M6: 常設運用（起動/監視/バックアップ/削除運用）

狙い: “止まらない”と“削除要求に対応できる”を運用として成立させる。

- 実装/整備対象
  - 自動起動（macOSの仕組み）
  - ログ最小化（会話本文/STT全文/音声/カメラをログに出さない）
  - 暗号化バックアップ（`confirmed` を中心に、片方向スナップショット）
  - 削除要求の手順（稼働DB/バックアップの範囲を明文化）
- Evidence
  - Runbookに沿って、復旧/削除/バックアップの手順が再現できる

## いま決める / 後で決める

- いま決める（実装が詰まるので固定）
  - MVPはA→B0、KIOSK1画面 + STAFF別端末ブラウザ
  - Orchestrator契約（状態/イベント/タイムアウト/緊急停止）は `.specs/07_orchestrator_contract.md` を正とする
  - Provider境界（InnerTask JSON、timeout/cancel/retry）は `.specs/07_orchestrator_contract.md` を正とする
  - 残り: API/DTO（KIOSK/STAFF）とSTAFF UIのアクセス制御（LAN内限定）
  - ログ最小化（本文/音声/カメラを残さない）
- 後で決める（差し替え前提）
  - STT/LLM/TTSの既定（ローカル/クラウド、モデル選定）
  - Vision/3D/タッチ（`docs/memo/92_roadmap_backlog.md`）
