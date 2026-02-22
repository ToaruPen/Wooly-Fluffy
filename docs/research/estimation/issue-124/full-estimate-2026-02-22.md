## Full見積もり

### 0. 前提確認

- Issue: #124 llm: キャラクター/振る舞いの外部注入 + チャット出力長制限
- Epic: `docs/epics/provider-layer-epic.md`（LLM Provider境界）
- PRD: `docs/prd/wooly-fluffy.md`
- 技術方針: シンプル優先
- 設定値/定数の方針: 可変値は env/config 化（`LLM_CHAT_MAX_OUTPUT_CHARS`、persona path、watch debounce等）、互換/安全制約は固定（JSON構造、allowlist、PII最小化）。前提として prereq #125（chokidar/yaml/valibot 導入）が完了済みであること。

### 1. 依頼内容の解釈

LLM chat にキャラクター定義（persona）を外部ファイルから毎回注入し、ファイル更新を再起動なしで反映する。同時に通常チャットの `assistant_text` に最大出力長を多層（モデル側制約 + アプリ側 clamp）で適用し、極端な長文応答を防ぐ。

### 2. 変更対象（ファイル:行）

Change-1
file: `server/src/providers/llm-provider.ts`
change: OpenAI/Gemini 両経路の system prompt 合成を persona 注入対応へ変更、`assistant_text` clamp、Gemini schema `assistant_text.maxLength` 追加、env読み込み追加
loc_range: 620-741, 876-975, 1127-1266, 340-410 行付近

Change-2
file: `server/src/providers/llm-provider.test.ts`
change: persona注入検証、`assistant_text` clamp検証、Gemini schema maxLength検証、env設定テスト追加
loc_range: 3191-3421 行付近 + chat系テストブロック

Change-3
file: `server/src/providers/persona-loader.ts`（新規）
change: persona/policy の読み込み・サイズ上限・watch/reload（依存注入で決定論的）
loc_range: 新規 80-180行

Change-4
file: `server/src/providers/persona-loader.test.ts`（新規）
change: mtime変化/再読込、上限超過フォールバック、path override のユニットテスト
loc_range: 新規 100-220行

total_loc_range: 260-520行

### 3. 作業項目と工数（レンジ + 信頼度）

Task-1
task: persona loader 実装（path解決、read/validate、watch/reload、フォールバック）
effort_range: 2-4h
confidence: Med

Task-2
task: llm-provider への persona 注入と chat 出力長制限の適用（OpenAI/Gemini両系統）
effort_range: 1.5-3h
confidence: Med

Task-3
task: unitテスト作成・更新（loader + llm-provider）
effort_range: 2-4h
confidence: Med

Task-4
task: 品質チェック（typecheck/lint/test/build）と失敗対応
effort_range: 1-2h
confidence: Med

total_effort_range: 6.5-13h
overall_confidence: Med

### 4. DB影響

N/A（本Issueは LLM Provider / 設定読み込み / テキスト出力制約の変更であり、DBスキーマ・マイグレーション変更なし）

### 5. ログ出力

原則 N/A（本文/STT全文/音声ログ禁止を維持）。
必要な場合は最小限の構造ログのみ（例: persona reload success/fallback reason のみ、本文は出さない）。

### 6. I/O一覧

IO-1
type: File Read
target: `~/Library/Application Support/wooly-fluffy/persona.md`（または `WOOLY_FLUFFY_PERSONA_PATH`）
purpose: system prompt に注入する persona 本文の取得

IO-2
type: File Watch
target: persona/policy ファイル
purpose: 編集内容の再起動なし反映

IO-3
type: API
target: OpenAI互換 `/chat/completions`
purpose: 通常チャット/inner_task 応答取得（chatは max output 制御を併用）

IO-4
type: API
target: Gemini native `models.generateContent`
purpose: 通常チャット/inner_task 応答取得（`responseJsonSchema` と `maxOutputTokens` 系設定対象）

### 7. リファクタ候補

候補あり（本Issue内では最小対応）:
- OpenAI/Gemini に重複する system prompt 文字列を共通ビルダ関数へ抽出
- `CHAT_JSON_SCHEMA` と parse/normalize の制約定義を1箇所へ集約

### 8. フェーズ分割

Phase-1: loader + 単体テスト先行（決定論的挙動を固定）
Phase-2: llm-provider へ統合（prompt合成、clamp、schema制約）
Phase-3: 回帰検証（OpenAI/Gemini両系統 + env/path variation）

### 9. テスト計画

Test-1
kind: Unit
target: `server/src/providers/persona-loader.test.ts`
content: mtime変化で内容切替、path override、上限超過時フォールバック、read失敗時の安全側挙動

Test-2
kind: Unit
target: `server/src/providers/llm-provider.test.ts`
content: persona が OpenAI/Gemini の system prompt/systemInstruction に反映される

Test-3
kind: Unit
target: `server/src/providers/llm-provider.test.ts`
content: `LLM_CHAT_MAX_OUTPUT_CHARS` 超過 `assistant_text` の clamp（決定論的）

Test-4
kind: Unit
target: `server/src/providers/llm-provider.test.ts`
content: Gemini schema に `assistant_text.maxLength` が反映される

Test-5
kind: Quality
target: server workspace
content: `npm run -w server typecheck` / `npm run -w server lint` / `npm run -w server test` / `npm run -w server build`

### 10. 矛盾点/不明点/確認事項

なし（PRD/Epic/Issueは整合）。
実装前提: #125 完了後に #124 実装を開始する。

### 11. 変更しないこと

- 会話本文/音声/STT全文の永続化・ログ出力ポリシー
- Orchestrator のセッション状態遷移仕様（本Issueは provider/config 境界に限定）
- web UI / DB スキーマ / STAFFアクセス制御仕様
