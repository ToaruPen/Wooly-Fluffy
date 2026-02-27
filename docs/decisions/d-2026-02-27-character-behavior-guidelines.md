# Decision: キャラクター行動指針（表情・モーション・言葉遣いの運用ルール）

## Decision-ID

D-2026-02-27-CHARACTER_BEHAVIOR_GUIDELINES

## Context

- 背景: PRD FR-5（芸事）と Provider Layer Epic で表情4種・モーション許可リストの技術設計は定義されたが、「どの場面でどの表情/モーションを使うか」「キャラクターの言葉遣い」の運用指針がドキュメントに記載されていなかった。
- どの矛盾/制約を解決するか: 実装はされているが設計判断として明文化されておらず、キャラクター一貫性の根拠がコードとペルソナファイルにしかない状態を解消する。

## Rationale

- なぜこの決定を採用したか: 現在の実装を基にキャラクター行動指針を明文化する。キャラクターの具体的な性格・口調は `persona.md`（外部ファイル、D-2026-02-27-PERSONA_EXTERNAL_INJECTION 参照）で定義し、本ADRでは表情・モーションの使い分けルールと技術的な制約を記録する。

### 表情の使い分け

LLM が Function Calling / Structured Output で以下の4ラベルから選択する:

| ラベル | 用途 | 備考 |
|--------|------|------|
| `neutral` | デフォルト、挨拶、質問への応答 | 会話開始時・不明時のフォールバック |
| `happy` | 楽しい話題、褒める、共感 | 頻度高。主に子どもとのポジティブなやりとり |
| `sad` | 残念な話題、共感 | 控えめに使用。PRD「感情を断定しない」に注意 |
| `surprised` | 驚き、新しい発見 | アクセントとして使用 |

制約: LLMが表情を返さない場合は `neutral` にフォールバックする。

### モーションの使い分け

| motion_id | 用途 | ループ | 備考 |
|-----------|------|--------|------|
| `idle` | 待機中 | Yes | デフォルト。one-shotモーション完了後に自動復帰 |
| `greeting` | 挨拶、応答開始 | No | 回答の冒頭で使用。完了後 idle へ |
| `cheer` | 応援、盛り上がり | No | ポジティブな反応時。完了後 idle へ |
| `thinking` | LLM応答待ち | Yes | `waiting_chat` フェーズ中のフィードバック用 |

DWモーション（15種）は `web/public/assets/motions/dw__*.vrma` に配置されているが、現在は LLM からの呼び出し経路に接続されていない。将来的に許可リストを拡張する際に利用する。

### 口パク・瞬き

- 口パク: TTS再生の音量レベル（0-1）を `aa` ブレンドシェイプにマッピング
- 瞬き: 自動（周期的にランダム間隔で発火）。`prefers-reduced-motion` 時は無効

### 言葉遣い

具体的なキャラクター設定（性格、口調、禁止事項）は `persona.md` 外部ファイルで定義する（D-2026-02-27-PERSONA_EXTERNAL_INJECTION 参照）。PRDレベルの制約は:

- 推定結果を根拠に感情を断定する発話はしない（PRD 非機能要件）
- 子どもが安心できる短い応答を優先する（PRD US-1）
- 出力長は `policy.yaml` の `chat.max_output_chars` / `chat.max_output_tokens` で制限可能

## Alternatives

### Alternative-A: 表情/モーションをルールベースで自動決定（LLM不使用）

- 採用可否: 不採用
- Pros: LLMへの追加負荷がない
- Cons: 文脈に応じた自然な表情変化ができない

### Alternative-B: 表情ラベルを増やす（6種以上）

- 採用可否: 不採用（現時点）
- Pros: より豊かな表現
- Cons: VRMモデル依存が増え、モデル差し替え時の互換性が下がる

## Impact

- 影響範囲: LLM Provider（表情/モーション選択）, KIOSK VRM Avatar, ペルソナファイル
- 互換性: 4表情・4モーションの枠組みはVRM標準に準拠。モデル差し替えで破綻しない
- 運用影響: キャラクターの調整は `persona.md` の編集で即時反映（サーバ再起動不要）

## Verification

- 検証方法: KIOSK画面での目視確認。表情遷移・モーション再生・口パク・瞬きが自然に動作すること
- エビデンス: `web/src/components/vrm-avatar.tsx` のユニットテスト、`web/src/kiosk-page.tsx` の統合テスト

## Supersedes

- N/A

## Inputs Fingerprint

- PRD: `docs/prd/wooly-fluffy.md` FR-5, 非機能要件（感情断定禁止）
- Epic: `docs/epics/provider-layer-epic.md` セクション3.2 技術選定-5, 技術選定-6
- Issue: #82, #88, #124
- Related files: `web/src/components/vrm-avatar.tsx`, `server/src/providers/persona-config.ts`, `server/src/providers/llm-provider.ts`, `web/public/assets/motions/`
