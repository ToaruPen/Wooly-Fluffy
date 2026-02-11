---
name: UI Iteration
about: 画面改善を短いラウンドで反復するためのテンプレート
title: "feat(ui): <screen> のUI改善"
labels: ["enhancement", "ui"]
assignees: []
---

## Summary

<!-- 何を良くしたいかを1-2文で -->

## SoT

- PRD: <!-- 例: docs/prd/wooly-fluffy.md -->
- Epic: <!-- 例: docs/epics/wooly-fluffy-mvp-epic.md -->

## 対象画面 / ルート

- Screen: <!-- 例: KIOSK -->
- Route: <!-- 例: /kiosk -->

## 現状の課題（優先度順）

### P0 / P1（先に直す）

- [ ] <!-- 例: エラー表示中でも主ボタンが押せるように見える -->

### P2

- [ ] <!-- 例: CTAがステージを覆って主役コンテンツを隠す -->

### P3

- [ ] <!-- 例: 文言のゆれ / 細かい余白違和感 -->

## 受け入れ条件（AC）

- [ ] 操作可否と表示状態が矛盾しない
- [ ] 主操作は desktop/mobile で到達しやすい
- [ ] 主要コンテンツ（ステージ等）がCTAで隠れない
- [ ] 通常利用時にデバッグ情報を常時表示しない
- [ ] `web` の typecheck/lint/test が通る

## 非スコープ

- [ ] バックエンド仕様変更
- [ ] 新機能追加（本IssueのUI改善に不要なもの）

## 反復プラン（/ui-iterate）

- max-rounds: <!-- 例: 3 -->
- viewports: desktop + mobile
- screenshot root: `var/screenshot/issue-<n>/round-<xx>/`

### Round plan

- [ ] Round 00: ベースライン取得
- [ ] Round 01: P0/P1の解消
- [ ] Round 02: レイアウト/階層の改善
- [ ] Round 03: 文言/微調整 + 最終確認

## 検証コマンド

```bash
npm run -w web typecheck
npm run -w web lint
npm run -w web test
# 必要時
npm run -w web e2e
```

## スクリーンショット

- Round 00:
  - desktop: <!-- var/screenshot/issue-<n>/round-00/... -->
  - mobile: <!-- var/screenshot/issue-<n>/round-00/... -->
- Round 01:
  - desktop:
  - mobile:

## Completion checklist

- [ ] ACを満たした
- [ ] P0/P1が残っていない
- [ ] `/review-cycle` を通過
- [ ] `/review` でDoDを確認
