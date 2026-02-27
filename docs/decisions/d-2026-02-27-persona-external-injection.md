# Decision: キャラクターペルソナと会話ポリシーを外部ファイルで注入する

## Decision-ID

D-2026-02-27-PERSONA_EXTERNAL_INJECTION

## Context

- 背景: マスコットキャラクターの性格・口調・行動指針を定義する必要があるが、コードにハードコードすると変更のたびにデプロイが必要になる。
- どの矛盾/制約を解決するか: キャラクター設定の柔軟な変更と、コードの安定性を両立する。

## Rationale

- なぜこの決定を採用したか: `persona.md`（キャラクター設定テキスト）と `policy.yaml`（出力長制限等のガードレール）を外部ファイルとして配置し、chokidar でファイル変更を監視してホットリロードする方式を採用。サーバ再起動なしでキャラクター調整が可能。
- SoT（PRD/Epic/Issue）との整合: PRD US-1「子どもが安心して話せる」を実現するためのキャラクター一貫性の仕組み。Issue #124, #125 で実装済み。

## Alternatives

### Alternative-A: 環境変数でペルソナを注入

- 採用可否: 不採用
- Pros: 追加依存なし
- Cons: 長文のペルソナテキストを環境変数に入れるのは非現実的

### Alternative-B: DB（SQLite）にペルソナを保存

- 採用可否: 不採用
- Pros: 管理UIが作れる
- Cons: 過剰。データ最小化方針に反する複雑さの追加

## Impact

- 影響範囲: `server/src/providers/persona-config.ts`, LLM Provider のシステムプロンプト構築
- 互換性: ファイルが存在しない場合はデフォルト（空ペルソナ）で動作
- 運用影響: macOS: `~/Library/Application Support/wooly-fluffy/persona.md` と `policy.yaml` を配置。環境変数 `WOOLY_FLUFFY_PERSONA_PATH` / `WOOLY_FLUFFY_POLICY_PATH` で上書き可能
- 追加依存: `chokidar`（ファイル監視）, `yaml`（YAML解析）, `valibot`（スキーマバリデーション）

## Verification

- 検証方法: `server/src/providers/persona-config.test.ts` で読み込み・バリデーション・ホットリロード・エッジケースをテスト
- エビデンス: Issue #124, #125 のテスト結果、PR #134, #135

## Supersedes

- N/A

## Inputs Fingerprint

- PRD: `docs/prd/wooly-fluffy.md` US-1, FR-5
- Epic: `docs/epics/provider-layer-epic.md` セクション3.2 技術選定-5（表情）
- Issue: #124, #125
- Related files: `server/src/providers/persona-config.ts`, `server/src/providers/llm-provider.ts`
