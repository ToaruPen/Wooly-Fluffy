# Decision: VRMモデルは暫定選定とし今後変更予定あり

## Decision-ID

D-2026-02-27-VRM_MODEL_SELECTION

## Context

- 背景: KIOSK画面のマスコットキャラクターとして VRM モデルが必要。Provider Layer Epic (Unknown-1) で「VRoid Hubのどのモデルを使うか」が未決のまま残っていた。
- どの矛盾/制約を解決するか: 開発・デモ用に `web/public/assets/vrm/mascot.vrm` を配置して使用しているが、これが暫定選定であることを明示する。

## Rationale

- なぜこの決定を採用したか: 開発を進めるために暫定モデルを使用しているが、最終的なキャラクター選定は別途行う。モデルのすげ替えを前提とした設計（VRM標準準拠、表情4種のみ依存）にしている。
- SoT（PRD/Epic/Issue）との整合: Provider Layer Epic セクション9 Unknown-1 の解決。

## Alternatives

### Alternative-A: モデル確定を先に行う

- 採用可否: 不採用（現時点）
- Pros: キャラクターデザインの一貫性が早期に確保できる
- Cons: 開発速度が落ちる。モデル選定は運用開始前に確定すればよい

### Alternative-B: 自作VRMモデル

- 採用可否: 将来検討
- Pros: 著作権/ライセンスの問題がない
- Cons: 3Dモデリングのスキル/コストが必要

## Impact

- 影響範囲: `web/public/assets/vrm/mascot.vrm`、KIOSK画面のVRM表示
- 互換性: VRM標準に準拠していれば差し替え可能。表情は `neutral | happy | sad | surprised` の4種を使用
- 運用影響: モデル差し替え時は `mascot.vrm` を置き換えるのみ。モーション（VRMA）はモデル非依存

## Verification

- 検証方法: 差し替え後に KIOSK 画面で表情4種・モーション4種・口パク・瞬きが動作することを目視確認
- エビデンス: 手動スモーク（自動テストはVRM描画をスタブ化しているため外観は検証外）

## Supersedes

- N/A（Provider Layer Epic Unknown-1 を解消）

## Inputs Fingerprint

- PRD: `docs/prd/wooly-fluffy.md` FR-5（芸事）
- Epic: `docs/epics/provider-layer-epic.md` セクション9 Unknown-1
- Related files: `web/public/assets/vrm/mascot.vrm`, `web/src/components/vrm-avatar.tsx`
