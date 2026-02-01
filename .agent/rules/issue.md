# Issue Granularity Rules

Rules defining the appropriate size and structure of a single Issue.

---

## Principles

- LOC: 50-300
- Files: 1-5
- AC: 2-5

---

## Priority (Triage)

For bug fix / urgent response Issues, assign Priority:

- P0 (Crash / Data loss): Immediate
- P1 (Major feature broken): Within 24 hours
- P2 (Feature malfunction): Current sprint
- P3 (Performance): When available
- P4 (Visual improvement): Backlog

Scope:

- Planned new feature: N/A (determined by Epic dependencies)
- Bug fix: Assign P0-P4
- Urgent response: Assign P0-P4

Note: If P0-P1 Issues exist, prioritize them over planned new features.

---

## Signs an Issue is too large (split needed)

Consider splitting if any applies:

- [ ] Expected LOC > 300
- [ ] Files >= 6
- [ ] AC >= 6
- [ ] Multiple verbs ("do A and B and C")

Example:

Before (too large):

```
Issue: Implement user management
- User registration
- User edit
- User delete
- User list
- Permission management
```

After (appropriate size):

```
Issue #1: Implement user registration API
Issue #2: Implement user edit API
Issue #3: Implement user delete API
Issue #4: Implement user list API
Issue #5: Implement permission management
```

---

## Signs an Issue is too small (consider merging)

Consider merging if any applies:

- [ ] Expected LOC < 50
- [ ] Only 1 AC
- [ ] Always done together with another Issue

If you need to keep multiple small Issues as separate "status observation points" (e.g., lower updates; middle approves), prefer creating a single parent Issue as the implementation unit and keep the small Issues as tracking-only children (no branches/worktrees for children).

Example:

Before (too small):

```
Issue #1: Create User model (20 LOC)
Issue #2: Create User migration (15 LOC)
Issue #3: Add User validation (10 LOC)
```

After (appropriate size):

```
Issue #1: Create User model + migration (45 LOC)
  - Create model
  - Create migration
  - Add validation
```

---

## Exception labels

If you must violate the principles, add an exception label and fill all required fields:

- `bulk-format`
  - Purpose: automated formatting/renaming
  - Required: reason (tool name)
  - Required: impact/review focus (confirm no functional change)
  - Required: risk
- `test-heavy`
  - Purpose: large test additions
  - Required: reason (what is being tested)
  - Required: impact/review focus (coverage/quality)
  - Required: risk
- `config-risk`
  - Purpose: config changes with wide impact
  - Required: reason (what changes)
  - Required: impact/review focus (blast radius)
  - Required: risk
- `refactor-scope`
  - Purpose: broad refactor
  - Required: reason (refactor goal)
  - Required: impact/review focus (behavior preserved)
  - Required: risk

Example:

```markdown
## 例外ラベル: `bulk-format`

理由: Prettier format across the repo (triggered by config update)
影響/レビュー観点: Confirm no functional change; whitespace-only diffs
想定リスク: Unintended code changes mixed in
```

---

## Expressing dependencies

Required fields:

1. Blocked by: dependent Issue number and reason
2. 先に終わると何が可能になるか: one-line description of what becomes possible after completion

Example:

```markdown
## 依存関係

- Blocked by: #12（DBスキーマが必要なため）
- 先に終わると何が可能になるか: APIエンドポイントの実装が開始可能
```

Labels:

- `blocked`
- `parallel-ok`

### `parallel-ok` (deterministic rules)

Use `parallel-ok` only when it is safe to work in parallel.

Required:

- The Issue body includes `### 変更対象ファイル（推定）` with repo-relative paths.
- The declared file set does NOT overlap with other parallel Issues.

Validation:

- Use `./scripts/worktree.sh check ...` to detect overlaps before starting.

If file targets are unknown or overlaps exist, do NOT use `parallel-ok`; mark as `blocked` and serialize.

---

## Issue body template (Japanese output)

## Implementation mode decision (required)

Every Issue must include a short, explicit implementation-mode decision so the team can choose `/impl` vs `/tdd` deterministically.

Rule of thumb:

- Prefer `/tdd` when behavior can be fixed via unit/integration tests (parsing, state machines, allowlists, fallbacks, error handling, request correlation).
- Prefer `/impl` when the work is primarily integration/UI/device/3D where deterministic tests are hard at first (recording, WebAudio, three.js/VRM, heavy browser APIs). Still unit-test any pure functions extracted.

```markdown
## 概要

[何をするかを1-2文で]

## 優先度（バグ修正/緊急対応の場合）

<!-- 新機能の場合は空欄可 -->
- [ ] P0: クラッシュ/データ損失
- [ ] P1: 主要機能停止
- [ ] P2: 機能不全
- [ ] P3: パフォーマンス
- [ ] P4: 見た目改善

## 背景

- Epic: [Epicファイルへのリンク]
- PRD: [PRDファイルへのリンク]

## 受け入れ条件（AC）

- [ ] AC1: [観測可能な条件]
- [ ] AC2: [観測可能な条件]

## 境界条件（異常系/リソース解放/レース条件）

<!--
目的: AI/人間の実装判断がブレやすい部分（異常系・後始末・競合）を事前に固定する。
ここで挙げた項目のうち、最低1つはACまたはテスト観点に落とす（重要なものは複数）。
-->

- [ ] 入力不正/欠損: [無効payload/不足フィールド/型不一致] のとき安全に失敗/フォールバックする
- [ ] リソース解放: [connection/process/tmp file/media track] を成功/失敗/中断/アンマウントで確実に解放する
- [ ] レース条件: [start/stop連打、重複/順序逆転、再接続] の期待挙動が決まっている（優先/無視/キャンセル）
- [ ] タイムアウト/キャンセル: ハングせず、キャンセル時も状態が壊れない

## 技術メモ

### 変更対象ファイル（推定）

<!-- 1〜5ファイルを目安 / parallel-ok の衝突判定入力 -->

- [ ] `path/to/file1.ts`
- [ ] `path/to/file2.ts`

### 推定行数

- [ ] 50行未満（小さい）
- [x] 50〜150行（適正）
- [ ] 150〜300行（大きめ）
- [ ] 300行超（要分割検討）

## 実装アプローチ（Agentic-SDD）

推奨: `/tdd` または `/impl`

理由:
- [1-2行]

最低限のテスト観点:
※ここに書くのは「下限」。ACを満たす/回帰を防ぐために必要なテストは追加する。
- [2-4行]

## 依存関係

- Blocked by: #[Issue番号]（[理由]）
- 先に終わると何が可能になるか: [説明]

## ラベル

- 少なくとも1つ付与（例: `enhancement` / `bug` / `documentation` / `question`）
- `priority:P[0-4]`（バグ修正の場合）
- `parallel-ok` / `blocked`
```

---

## First-cycle guidance

On the first cycle, avoid using exception labels.

Reason:

- Build intuition for the standard granularity
- Introduce exceptions only when truly necessary

---

## Related

- `.agent/commands/create-issues.md` - create-issues command
- `.agent/rules/epic.md` - epic generation rules
- `.agent/rules/dod.md` - Definition of Done
