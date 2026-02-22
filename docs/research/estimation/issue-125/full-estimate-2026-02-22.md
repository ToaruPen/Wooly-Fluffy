## Full見積もり

### 0. 前提確認

- Issue: #125 deps: chokidar/yaml/valibot 導入（persona/policy 外部注入 + 出力長制限用）
- Epic: `docs/epics/provider-layer-epic.md`
- PRD: `docs/prd/wooly-fluffy.md`
- 技術方針: シンプル優先
- 設定値/定数の方針: 本Issueは依存導入のみ。実行時チューニング値（timeout/max chars/debounce等）は導入しない。依存追加先は `server` ワークスペースに固定し、依存数は `chokidar`/`yaml`/`valibot` の3つに限定する。

### 1. 依頼内容の解釈

#124 の前提として server ワークスペースへ `chokidar`/`yaml`/`valibot` を導入し、`npm install` 後に `npm run -w server typecheck` と `npm run -w server test` が通る状態を作る。依存導入だけで挙動変更を起こさず、理由/ライセンス情報は Issue 記録で追跡可能に保つ。

### 2. 変更対象（ファイル:行）

Change-1
file: `server/package.json`
change: `dependencies` に `chokidar` / `yaml` / `valibot` を追加（server限定）
loc_range: 6-12行

Change-2
file: `package-lock.json`
change: lockfile の依存解決状態を更新（必要時のみ）
loc_range: 6290-6320行付近（`packages["server"].dependencies` セクション）

Change-3
file: `docs/research/estimation/issue-125/2026-02-22.md`
change: 見積もり前調査（候補比較・リスク・止め時）
loc_range: 新規 1-170行

total_loc_range: 30-120行

### 3. 作業項目と工数（レンジ + 信頼度）

Task-1
task: 現状確認（Issue依存関係、既存依存、追加先がserver限定であることの確認）
effort_range: 0.3-0.8h
confidence: High

Task-2
task: 依存追加（`server/package.json`）と lockfile 更新（必要時）
effort_range: 0.5-1.2h
confidence: High

Task-3
task: 品質確認（`npm run -w server typecheck` / `npm run -w server test`）
effort_range: 0.4-1.0h
confidence: Med

Task-4
task: スコープ逸脱確認（3依存以外を追加していないこと、挙動変更なしの確認）
effort_range: 0.2-0.6h
confidence: High

total_effort_range: 1.4-3.6h
overall_confidence: High

### 4. DB影響

N/A（依存追加のみであり、DBスキーマ/マイグレーション/データ移行は発生しない）

### 5. ログ出力

N/A（ログ追加・変更なし。既存のデータ最小化ポリシーを維持する）

### 6. I/O一覧

IO-1
type: Package Registry
target: npm registry（`npm install`）
purpose: `chokidar` / `yaml` / `valibot` の取得と lockfile 反映

IO-2
type: Local File Write
target: `server/package.json` / `package-lock.json`
purpose: 依存宣言と解決結果の更新

N/A（外部API連携や実行時I/O仕様の追加は本Issueでは行わない）

### 7. リファクタ候補

N/A（依存導入Issueのため、リファクタリングはスコープ外）

### 8. フェーズ分割

N/A（単一フェーズで完了可能。依存追加 + 品質確認のみ）

### 9. テスト計画

Test-1
kind: Quality
target: server workspace
content: `npm run -w server typecheck` が成功する

Test-2
kind: Quality
target: server workspace
content: `npm run -w server test` が成功する

Test-3
kind: Scope guard
target: git diff
content: 3依存以外の追加や実装コード変更が混入していないことを確認する

### 10. 矛盾点/不明点/確認事項

なし（`server/package.json` と `package-lock.json` に `chokidar` / `yaml` / `valibot` が既に存在するため、実装フェーズは「依存宣言の再追加」ではなく「AC再検証 + スコープ逸脱がないことの確認」が中心になる）

### 11. 変更しないこと

- provider 実装本体（persona loader / llm provider のロジック）
- web UI / DB スキーマ / Orchestrator 振る舞い
- 会話本文/音声/STT全文の永続化禁止ポリシー
