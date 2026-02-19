# Decision: Wooly-Fluffy 既存ADR（ADR-1..14）の Snapshot 形式移行

## Decision-ID

D-2026-02-19-WOOLY_FLUFFY_LEGACY_ADR_MIGRATION

## Context

- Agentic-SDD v0.3.00 導入に伴い、`docs/decisions.md` は「索引のみ」を保持する形式へ更新された
- 本リポジトリには v0.3.00 導入前から、`docs/decisions.md` に ADR-1..14 の本文が集約されていた
- リポジトリ固有の意思決定（データ最小化、PTT運用、SSE採用、STAFFアクセス制御、Providerライセンス等）を失わずに最新運用へ移行する必要がある

## Rationale

- 最新の Decision Snapshot 運用（index + per-file）をデフォルトにしつつ、既存の文脈を継承するため
- 旧形式の本文をそのまま捨てるのではなく、参照可能な移行Decisionとして残すことで、SoTの追跡性を維持するため

## Alternatives

### Alternative-A: 旧 `docs/decisions.md` をそのまま復元する

- 採用可否: No
- Pros: 既存本文がそのまま残る
- Cons: 最新の Decision Snapshot 運用（1決定=1ファイル）と不整合になる

### Alternative-B: 最新index形式を維持し、旧ADRのカタログを移行Decisionに集約する

- 採用可否: Yes
- Pros: 最新運用と互換を保ちつつ、リポジトリ固有情報を保持できる
- Cons: 旧ADR本文を個別ファイルへ完全分割する追加作業は今後必要になりうる

## Impact

- `docs/decisions.md` は index として継続運用される
- 旧ADR群は本ファイルのカタログを入口に参照する
- 今後の意思決定追加は `docs/decisions/_template.md` を使い、1決定=1ファイルで追記する

## Verification

- 検証方法: 旧 `docs/decisions.md`（v0.3.00 導入前）に存在した ADR 見出しを照合
- エビデンス: ADR-1..14 のタイトル一致（下記カタログ）

## Supersedes

- N/A

## Inputs Fingerprint

- PRD: `docs/prd/wooly-fluffy.md`
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md`
- Issue: N/A（導入・移行作業）
- Related files: `docs/decisions.md`, `docs/decisions/README.md`

## Legacy ADR Catalog（v0.3.00 導入前）

- ADR-1: データ最小化（保存/ログ）方針
- ADR-2: 入力UX（PTTは職員操作、待機は無反応）
- ADR-3: モード設計（ROOM/PERSONAL）と同意フロー
- ADR-4: Orchestratorを純粋ロジックとして固定（Event/Effect）
- ADR-5: RealtimeはSSEを採用し、WS移行可能なメッセージ形を維持
- ADR-6: STAFFアクセス制御（LAN内限定 + 共有パスコード + 自動ロック）
- ADR-7: SQLiteスキーマ（session_summary_items）とTTL Housekeeping
- ADR-8: 技術スタック（TS/React/Vite/SQLite）と一次情報URLの運用
- ADR-9: Provider Layer アセットのライセンスと帰属表記
- ADR-10: multipart/form-data の音声アップロード解析に busboy を採用
- ADR-11: Mixamoモーションはローカル運用の仮素材として採用し、rawファイルをリポジトリに含めない
- ADR-12: Geminiネイティブ structured outputs / function calling のために Google GenAI SDK（@google/genai）を採用
- ADR-13: 入力UX（KIOSK PTT許可）とSTAFFデバッグログ（表示/保存/ログ境界）
- ADR-14: セッション設計（モード表示なし）とセッション要約（pending→職員Confirm/Deny）
