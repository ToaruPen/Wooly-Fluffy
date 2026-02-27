# Decision: フォントは同梱配信（セルフホスティング）とし外部CDNに依存しない

## Decision-ID

D-2026-02-27-FONT_SELF_HOSTING

## Context

- 背景: KIOSK/STAFF画面のフォントとして丸ゴシック体（M PLUS Rounded 1c）を採用したが、Google Fonts CDN経由か同梱配信かを決定する必要があった。
- どの矛盾/制約を解決するか: UI Redesign Epic の「外部CDN依存なし」方針（セクション3.2 技術選定-3）と、常設PC/LAN内運用（外部通信最小化）の制約を両立する。

## Rationale

- なぜこの決定を採用したか: woff2 ファイルを `web/public/fonts/` に同梱し、`@font-face` でローカル参照する。CDN障害やネットワーク不安定の影響を受けず、LAN内完結の運用方針に合致する。
- SoT（PRD/Epic/Issue）との整合: UI Redesign Epic セクション3.2 技術選定-3「外部CDN依存なし」。PRD Q6-2「常設PC上でローカル稼働」。

## Alternatives

### Alternative-A: Google Fonts CDN

- 採用可否: 不採用
- Pros: ファイル管理不要、キャッシュ効率が高い
- Cons: 外部依存の増加。LAN内運用でインターネット接続が不安定な場合にフォント未表示

### Alternative-B: システムフォントのみ

- 採用可否: 不採用
- Pros: 追加ファイル不要
- Cons: 丸ゴシック体が保証されず、キャラクター体験の一貫性が崩れる

## Impact

- 影響範囲: `web/public/fonts/` (woff2 6ファイル), `web/src/styles.module.css` (@font-face宣言)
- 互換性: フォールバック: `"Hiragino Maru Gothic ProN", "BIZ UDPGothic", system-ui, sans-serif`
- 運用影響: woff2 ファイル合計サイズは数MB程度。Vite build で `dist/fonts/` に含まれる

## Verification

- 検証方法: KIOSK/STAFF画面でフォントが正しく表示されることを目視確認。ネットワーク断でもフォントが有効であることを確認
- エビデンス: Issue #106（UI基盤）の実装

## Supersedes

- N/A

## Inputs Fingerprint

- PRD: `docs/prd/wooly-fluffy.md` Q6-2（デプロイ先）
- Epic: `docs/epics/wooly-fluffy-ui-redesign-epic.md` セクション3.2 技術選定-3
- Issue: #106
- Related files: `web/public/fonts/`, `web/src/styles.module.css`
