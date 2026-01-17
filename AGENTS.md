# AGENTS.md

## WHY (Project Goal / 目的)
- 学童向け「マスコットLLM」プロジェクトの実装リポジトリ。最小の HTTP healthcheck server とテスト基盤を含む（`README.md`）。

## WHAT (Repo Map / 構成)
- SoT（要件/決定事項）: `.specs/`（判断の正。仕様変更がある場合は先に更新）
- メモ/ToDo（SoT外）: `docs/memo/`（検討→「決定」になったら `.specs/` へ反映）
- 実装: `server/`（Node/TypeScript の最小 HTTP サーバ。詳細は `server/AGENTS.md`）
- Node: npm workspaces（lockfile は `package-lock.json`）
- 主要ドキュメント:
  - `.specs/README.md`
  - `README.md`
  - `docs/memo/README.md`
  - `.specs/99_implementation_roadmap.md`（実装ロードマップ / SoT）

## HOW (Workflow / 作業手順)
- Install: `npm install`
- Checks: `npm run typecheck` / `npm run lint` / `npm run test` / `npm run coverage` / `npm run deadcode`
- Run server: `npm run -w server start`（defaults: `HOST=127.0.0.1`, `PORT=3000`）
- Coverage: `server/vitest.config.ts` で 100% を要求（落ちたらテストを追加/修正）

## Guardrails (Safety & Change Policy)
- 仕様/失敗時の挙動は `.specs/` を優先（未定義・曖昧ならユーザーに確認してから進める）
- データ最小化/ログ方針: `.specs/01_principles.md`, `.specs/04_data_policy_and_memory_model.md`（会話本文/音声/STT全文は保存しない）
- Provider 統合は timeout/cancel と retry 方針を持たせる（`.specs/05_architecture_approach.md`）
- 依存追加/主要変更は事前合意が前提。採用理由URL/ライセンスは `.specs/10_tech_stack_plan.md` に記録
- Secrets はコミットしない（環境変数/ローカル設定）

## Codex CLI Notes
- ユーザーが指定した Skill（例: `/plan`, `/check`, `/commit`）を優先
- 実装時は `estimation` → `impl-np` をデフォルト手順として扱う
