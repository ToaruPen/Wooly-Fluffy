# Agentic-SDD Append: Repository Agent Guide

This file is intentionally written in English for token efficiency.
User-facing interactions and generated artifacts (PRDs, Epics, Issues) remain in Japanese.

## Repository Purpose

This repository implements a "mascot LLM" project for an after-school program.
It includes a minimal HTTP healthcheck server and a test harness.

## Source of Truth (SoT)

Priority order:

- PRD (requirements): `docs/prd/`
- Epic (implementation plan): `docs/epics/`
- Decisions (ADRs): `docs/decisions.md`
- Implementation (code): `server/` (and `web/` when present)

Rule: If you detect a contradiction between higher-level docs and lower-level artifacts, STOP and ask a human with explicit references (PRD/Epic/code:line). Do not invent requirements.

Legacy:

- The former legacy specs folder has been removed. Do not rely on it.

## Repository Map

- Requirements (PRD): `docs/prd/wooly-fluffy.md`
- Implementation plan (Epic): `docs/epics/wooly-fluffy-mvp-epic.md`
- Decisions (ADR template and records): `docs/decisions.md`
- Memo / backlog (not SoT): `docs/memo/`
- Server implementation: `server/` (see `server/AGENTS.md` for directory-scoped rules)
- Node workspaces: npm with `package-lock.json`

## Workflow Commands (Local)

- Install: `npm install`
- Checks: `npm run typecheck` / `npm run lint` / `npm run test` / `npm run coverage` / `npm run deadcode`
- Run server: `npm run -w server start` (defaults: `HOST=127.0.0.1`, `PORT=3000`)

## Note on "slash commands" in this environment

- `functions.slashcommand` lists built-in skills/commands available to the assistant; it does not execute this repo's Agentic-SDD commands under `.agent/commands/`.
- To run Agentic-SDD commands for this repo, use the corresponding scripts under `./scripts/` (e.g. `./scripts/review-cycle.sh`, `./scripts/review.sh`, `./scripts/create-pr.sh`).

## Guardrails

- Follow PRD/Epic first for required behavior.
- Data minimization is mandatory: do not persist or log conversation text, audio, or full STT transcripts.
- Provider integrations must have explicit timeout/cancel and retry policy.
- Do not commit secrets (use environment variables / local config).
- Dependency additions and major changes require explicit agreement; record rationale and licensing links in the Epic or ADRs.

## Non-negotiables

- Do not implement features not documented in the PRD/Epic.
- Completion reports require evidence (diff and test results).
- Do not mix unrelated changes.
- Bug fixes require a test that fails before and passes after.

## Dynamic Verification (Runtime Behavior)

Static checks and unit tests often miss liveness/lifecycle regressions.

If your change affects runtime behavior, add a dynamic verification (integration test or smoke test run via `/review-cycle`'s `TEST_COMMAND`).

Examples (non-exhaustive):

- long-lived connections (SSE/WebSocket)
- graceful shutdown / SIGINT / SIGTERM
- timers/intervals
- file/DB/network I/O boundaries
- external provider calls (timeout/cancel/retry) and streaming

Requirements:

- deterministic and time-bounded (explicit timeout) so hangs become test failures
- covers the regression risk introduced by the diff (do not chase pre-existing issues)

Directory-scoped guidance:

- cross-cutting rule is here (repo root)
- server-specific examples: `server/AGENTS.md` (SSE/shutdown/connection draining)
- when an LLM/provider layer directory is added, add a scoped `AGENTS.md` there describing dynamic tests for timeout/cancel/retry/stream behavior

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

- Only create a PR after `/review` passes; do not change anything outside the Issue scope

## Worktree / Parallel Work

- One Issue = one branch = one worktree (never mix changes)
- Do not edit PRD/Epic across parallel branches; serialize SoT changes
- Use `./scripts/worktree.sh check` before applying `parallel-ok`

## Agentic-SDD Command Index

- `/create-prd`: create a PRD (7 questions)
- `/create-epic`: create an Epic (requires 3 lists)
- `/generate-project-config`: generate project-specific skills/rules from an Epic
- `/create-issues`: split an Epic into Issues
- `/estimation`: write a Full estimate (11 sections) and get approval
- `/impl`: implement an Issue (estimate required)
- `/tdd`: implement via TDD (red -> green -> refactor)
- `/ui-iterate`: iterate UI redesign in short loops (capture -> patch -> verify)
- `/review-cycle`: local review loop
- `/review`: definition-of-done check
- `/create-pr`: create a PR (gh)
- `/sync-docs`: check consistency across PRD/Epic/code
- `/worktree`: manage git worktrees

## References

- Glossary: `docs/glossary.md`
- Decisions (ADR): `docs/decisions.md`
