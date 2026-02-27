# Estimate: Issue #154

## 1. スコープ
- #152: PTTボタンの状態表示と操作の齟齬修正（無効状態の明確化、文言重複解消）
- #153: エラー表示に再接続ボタン追加 + 再接続中の進行表示 + コントラスト改善

## 2. 変更対象ファイル
| ファイル | 変更内容 |
|---|---|
| `web/src/sse-client.ts` | `reconnect()` メソッドを公開APIに追加 |
| `web/src/kiosk-page.tsx` | 状態別UI分岐の整理、再接続ボタン追加、再接続ハンドラ |
| `web/src/styles.module.css` | 再接続ボタンスタイル、エラー表示コントラスト改善 |
| `web/src/sse-client.test.ts` | `reconnect()` メソッドのテスト追加 |
| テストファイル群 | 状態別UI表示テスト修正 |

## 3. 設計方針

### sse-client.ts
- `connectSse` の戻り値に `reconnect()` メソッドを追加
- `reconnect()`: 既存タイマーをキャンセル → `source.close()` → `isClosed=false` → 新しい `EventSource` 作成 → `attach()`

### kiosk-page.tsx (#152)
- PTTボタン: disabled 属性で無効化（常に表示）
- ボタンラベルの文言重複を解消（「つながるまで まってね」を削除）

### kiosk-page.tsx (#153)
- `streamConnection` に `"error"` 状態追加（3状態: connected/reconnecting/error）
- エラー時: 再接続ボタン「もういちどつなぐ」表示
- 再接続中: スピナー + 「つなぎなおしているよ…」表示

### styles.module.css
- `.reconnectButton` スタイル追加
- `.reconnectingSpinner` スピナーアニメーション追加
- `.errorText` のコントラスト改善（WCAG AA 4.5:1+）

## 4. 推定行数
合計: 100-160行

## 5. 推定工数
2-4時間

## 6. リスク
低: SSE再接続の既存自動再接続ロジックとの干渉なし

## 7. テスト計画
- `sse-client.test.ts`: `reconnect()` 呼び出しで新しい EventSource が作成されること
- kiosk-page テスト: 各状態でのUI要素の表示/非表示を検証

## 8. 依存関係
なし

## 9. ロールバック
コンポーネント内の変更のみ。revert 可能。

## 10. 未解決の質問
なし

## 11. AC マッピング
| AC | 実装箇所 |
|---|---|
| #152-AC1 | PTTボタン disabled + kioskPttButtonDisabled クラス |
| #152-AC2 | PTTボタン kioskPttButton クラス |
| #152-AC3 | 状態別UI分岐の整理、文言重複解消 |
| #153-AC1 | エラー時の再接続ボタン表示 |
| #153-AC2 | reconnect() メソッド呼び出し |
| #153-AC3 | reconnecting 状態のスピナー + テキスト表示 |
| #153-AC4 | errorText のコントラスト改善 |

## 承認
- モード: impl
- 承認: Yes（ユーザー承認済み）
