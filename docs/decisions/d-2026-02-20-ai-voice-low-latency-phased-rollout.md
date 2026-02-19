# Decision: AI音声低遅延化を互換拡張で段階導入する

## Decision-ID

D-2026-02-20-AI_VOICE_LOW_LATENCY_PHASED_ROLLOUT

## Context

- 背景: 現行は `CHAT_RESULT -> SAY(全文) -> /api/v1/kiosk/tts(全文)` の直列処理で、AI応答の初回発話が遅くなりやすい。
- どの矛盾/制約を解決するか: 低遅延化したい一方で、既存SSE契約・Orchestrator純粋性・データ最小化要件は維持する必要がある。

## Rationale

- なぜこの決定を採用したか: 既存 `kiosk.command.speak` を残しつつ `kiosk.command.speech.*` を追加することで、互換性を保ったまま段階移行できるため。
- SoT（PRD/Epic/Issue）との整合: PRD v1.1のFR-7/AC-5/AC-E5、およびAI低遅延化Epic（Phase1-3）に整合する。

## Alternatives

### Alternative-A: 既存 `kiosk.command.speak` を即時置換

- 採用可否: 不採用
- Pros: 実装箇所を減らせる
- Cons: 既存クライアント互換を壊し、回帰リスクが高い

### Alternative-B: 音声バイナリをSSEで直接配信

- 採用可否: 不採用
- Pros: HTTP往復を減らせる可能性がある
- Cons: 現行設計の責務分離と合わず、欠落/再送/メモリ管理の複雑性が高い

## Impact

- 影響範囲: `server/src/effect-executor.ts`, `server/src/http-server.ts`, `server/src/providers/types.ts`, `web/src/kiosk-page.tsx` 付近
- 互換性: 既存 `kiosk.command.speak` を維持するため後方互換あり
- 運用影響: TTFA測定とstop_outputの観測を追加（本文は収集しない）

## Verification

- 検証方法: PhaseごとにTTFA改善率、順序違反0件、stop_output反映時間（p95）をテスト/計測で確認
- エビデンス: Issue #128, #129, #130 の受け入れ条件とテスト結果

## Supersedes

- N/A

## Inputs Fingerprint

- PRD: `docs/prd/wooly-fluffy.md:1`
- Epic: `docs/epics/wooly-fluffy-ai-voice-latency-epic.md:1`
- Issue: #128, #129, #130
- Related files: `server/src/effect-executor.ts`, `server/src/http-server.ts`, `server/src/providers/types.ts`, `web/src/kiosk-page.tsx`
