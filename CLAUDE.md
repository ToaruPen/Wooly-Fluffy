# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Mascot LLM" for an after-school program. VRM avatar (KIOSK) talks to users via STT→LLM→TTS pipeline. STAFF page is the control panel. Node.js native HTTP server (no Express) + React 18 + Vite frontend. npm workspaces: `server/` and `web/`.

## Non-obvious Commands

```bash
# Single test file (workspace flag + vitest filter)
npx -w server vitest run src/store.test.ts
npx -w web vitest run src/lib/wav.test.ts

# E2E (Playwright, first time needs install)
npm run -w web e2e:install
npm run -w web e2e

# Formatting applies only to changed files
npm run format
```

## Architecture (Big Picture)

Server request flow: `http-server.ts` → route matching → `orchestrator.ts` → providers (STT/TTS/LLM) → `effect-executor.ts` → SSE response

Web routing: `app.tsx` → `/kiosk` (VRM avatar + PTT) or `/staff` (control panel). Three.js + @pixiv/three-vrm for 3D rendering.

Tests live alongside source (`*.test.ts`). E2E tests in `web/e2e/`.

## Constraints

- **Coverage: 100%** — Both workspaces. `server/src/main.ts` is the only exclusion.
- **No `console.log`** — ESLint error. Use `console.warn` or `console.error`.
- **No direct `fs` imports** — ESLint forbids `node:fs` / `fs` (data minimization).
- **Data minimization** — Never persist conversation text, audio, or full STT transcripts.
- **Dynamic verification** — Runtime behavior changes (SSE, shutdown, timers, I/O, provider calls) require tests with explicit timeouts.

## Source of Truth Hierarchy

PRD (`docs/prd/`) > Epic (`docs/epics/`) > ADRs (`docs/decisions.md`) > Code. If contradiction found → STOP, cite references, ask human.

## Non-negotiables

- Do not implement features not in PRD/Epic.
- Do not mix unrelated changes in one branch.
- Bug fixes require a test that fails before and passes after.
- Dependency additions require explicit agreement + rationale in Epic/ADR.

## Agentic-SDD: Development Cycle Protocol

0. Bootstrap

- Read this file and the minimum necessary rule/command file under `.agent/` for the next action.

1. Entry decision

- No PRD: `/create-prd`
- PRD exists but no Epic: `/create-epic`
- Epic exists but no Issues / not split: `/create-issues`
- Issues exist: ask the user to choose `/impl` vs `/tdd` (do not choose on your own)

2. Implement one Issue

- `/estimation` (Full estimate; 11 sections) -> user approval -> `/impl` or `/tdd` -> tests -> gates
- Use `/sync-docs` whenever you suspect drift, and always before creating a PR

3. PR / merge

- Only create a PR after `/final-review` passes; do not change anything outside the Issue scope

### Worktree / Parallel Work

- One Issue = one branch = one worktree (never mix changes)
- Do not edit PRD/Epic across parallel branches; serialize SoT changes
- Use `./scripts/worktree.sh check` before applying `parallel-ok`
- Before high-impact operations (`/review-cycle`, `/create-pr`, `/pr-bots-review`, manual conflict resolution), run Scope Lock checks:
  - `git branch --show-current`
  - `gh issue develop --list <issue-number>`
  - `gh pr view <pr-number-or-url> --json headRefName --jq '.headRefName'`

### Command Index

- `/create-prd`: create a PRD (7 questions)
- `/create-epic`: create an Epic (requires 3 lists)
- `/generate-project-config`: generate project-specific skills/rules from an Epic
- `/create-issues`: split an Epic into Issues
- `/estimation`: write a Full estimate (11 sections) and get approval
- `/impl`: implement an Issue (estimate required)
- `/tdd`: implement via TDD (red -> green -> refactor)
- `/test-review`: run fail-fast test review checks before review/PR gates
- `/review-cycle`: local review loop
- `/final-review`: definition-of-done check
- `/create-pr`: create a PR (gh)
- `/pr-bots-review`: request a PR review-bot check and iterate until feedback is resolved
- `/sync-docs`: check consistency across PRD/Epic/code
- `/worktree`: manage git worktrees

### Note on slash commands

- Built-in skills/commands do not execute this repo's Agentic-SDD commands under `.agent/commands/`.
- To run Agentic-SDD commands, use the corresponding scripts under `./scripts/` (e.g. `./scripts/review-cycle.sh`, `./scripts/test-review.sh`, `./scripts/create-pr.sh`).

### References

- Glossary: `docs/glossary.md`
- Decisions (ADR): `docs/decisions.md`
