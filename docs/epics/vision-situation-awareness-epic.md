# Epic: Webカメラ状況認識（非識別ムード）

---

## メタ情報

- 作成日: 2026-02-07
- 作成者: -
- ステータス: Draft
- 参照PRD: `docs/prd/vision-situation-awareness.md`

---

## 1. 概要

### 1.1 目的

KIOSKのマスコット体験を「会話（音声）」に依存させず、目の前の“場の雰囲気”に合わせた非言語リアクション（表情・モーション）で雰囲気づくりを補強する。
映像入力はセンシティブなため、デフォルトOFF・ローカル処理・保存/ログなし・個人識別なしを前提にする。

### 1.2 スコープ

**含む:**

- STAFF画面でのVision機能ON/OFF（デフォルトOFF）
- API ServerでのVision有効状態（boolean）の保持（永続化しない。再起動でOFF）とKIOSKへの配信
- KIOSKでのWebカメラ利用（ON時のみ稼働）
- ローカル推論での粗いムード推定（`happy|neutral|unknown`）
- 平滑化/ヒステリシス/最小更新間隔による安定化
- ムードをKIOSKの表情・モーションに反映（発話はしない）
- KIOSK上の「カメラ有効」インジケータ表示（プレビューは出さない）
- STAFFセッション失効/自動ロック時にVisionを安全側（OFF）に戻す

**含まない（PRDのスコープ外を継承）:**

- 個人識別（顔認証/個人ID付与/長期追跡）
- 画像/動画/推論結果の永続保存、推論結果のログ保存
- 推定結果を根拠にした断定発話
- クラウドへの映像送信

### 1.3 PRD制約の確認

項目: 規模感
PRDの値: 小規模
Epic対応: 単一KIOSKで完結する（サーバへ映像/派生信号を送らない）。ON/OFF制御のみSTAFF操作で行う

項目: 技術方針
PRDの値: シンプル優先
Epic対応: 外部サービス<=1、新規ライブラリ<=3、新規コンポーネント<=3、非同期基盤なし

項目: 既存言語/FW
PRDの値: Yes
Epic対応: 既存のWeb（KIOSK/STAFF）+ API Server構成の範囲で実装し、映像/推論結果はKIOSK内に限定する

項目: デプロイ先
PRDの値: Yes
Epic対応: 常設PC上のローカル稼働（単一KIOSK）

---

## 2. 必須提出物（3一覧）

### 2.1 外部サービス一覧

外部サービス-1
名称: なし
用途: -
必須理由: -
代替案: -

### 2.2 コンポーネント一覧

コンポーネント-1
名称: Web Frontend（KIOSK）
責務: カメラ入力（ON時）、ローカル推論、ムード要約、表情/モーション反映
デプロイ形態: 常設PC上で配信（ブラウザ）

コンポーネント-2
名称: Web Frontend（STAFF）
責務: Vision機能のON/OFF操作（認証済みSTAFFのみ）
デプロイ形態: 常設PC上で配信（ブラウザ）

コンポーネント-3
名称: API Server（既存）
責務: Vision有効状態（boolean）の保持（永続化しない）、STAFF操作の受付、KIOSKへの配信（snapshot/SSE）
デプロイ形態: 常設PC上の単一プロセス

### 2.3 新規技術一覧

新規技術-1
名称: Webカメラ（`getUserMedia({ video: true })`）
カテゴリ: Browser API
既存との差: 新規導入
導入理由: KIOSKの状況認識（非言語リアクション）に必要

新規技術-2
名称: オンデバイス視覚推論（KIOSK内）
カテゴリ: Vision
既存との差: 新規導入
導入理由: 映像外部送信なしでムード推定を行うため

---

## 3. 技術設計

### 3.1 アーキテクチャ概要

システム境界:

- STAFF（ブラウザ）: Vision機能のON/OFFを操作する
- API Server: Vision有効状態（boolean）を保持し、KIOSKへ配信する（映像/推論結果は扱わない）
- KIOSK（ブラウザ）: カメラ入力・推論・表情/モーション反映を完結する（派生信号もサーバへ送らない）

主要データフロー-1
from: STAFF（ブラウザ）
to: API Server
用途: Vision機能のON/OFF
プロトコル: HTTP（既存のSTAFF event）

主要データフロー-2
from: API Server
to: KIOSK（ブラウザ）
用途: Vision有効状態（boolean）の配信
プロトコル: SSE（既存のKIOSK stream）

主要データフロー-3
from: Browser（KIOSK）
to: ローカル推論（KIOSK内）
用途: ムード推定（`happy|neutral|unknown`）
プロトコル: in-process

主要データフロー-4
from: ムード推定（KIOSK内）
to: アバター表情/モーション
用途: 非言語リアクション
プロトコル: in-process

### 3.2 技術選定

技術選定-1
カテゴリ: Vision（ブラウザ推論）
選択: MediaPipe（Tasks/Vision系）
理由: 依存追加を1つに抑えやすく、オンデバイス実行の前提で実装しやすい
代替案（よりシンプル）: Visionを導入せず、時間ベースのアイドルモーション/表情だけで雰囲気づくりを行う（推定なし）

技術選定-2
カテゴリ: 出力（表情）
選択: 既存の4ラベル（`neutral|happy|sad|surprised`）へ縮退マッピング
理由: 既存実装との競合を避け、UI側の変更範囲を小さくする

### 3.3 データモデル（概要）

エンティティ-1
名前: VisionState（KIOSK内）
主要属性: enabled, face_present, mood, confidence, stability_ms, updated_at_ms
関連: 永続化しない（メモリのみ）

エンティティ-2
名前: VisionControlState（Server内）
主要属性: enabled
関連: 永続化しない（メモリのみ）。サーバ再起動でOFF。STAFFセッション失効でOFF。

### 3.4 API設計（概要）

方針: 映像/推論結果はServerへ送らず、Vision有効状態（boolean）のみをServerが配信する。

- STAFF -> Server
  - 既存の `POST /api/v1/staff/event` に、Vision制御イベントを追加する
  - イベント例:
    - `{ "type": "STAFF_VISION_SET", "enabled": true }`
    - `{ "type": "STAFF_VISION_SET", "enabled": false }`

- Server -> KIOSK
  - 既存の `GET /api/v1/kiosk/stream` の snapshot に、Vision有効状態を含める
  - 例: `kiosk.snapshot.data.state.vision_enabled: boolean`

UI配置（方針）:

- VisionのON/OFFはSTAFFの運用/設定セクションに配置する（PTT等の主要操作と分離する）
- ONにする際は確認ダイアログを必須とし、ON中は状態（例: `VISION: ON`）を常時可視にする

### 3.5 プロジェクト固有指標（任意）

固有指標-1
指標名: ムード更新のスロットリング
測定方法: ユニットテスト（推定入力の揺れに対して出力の更新頻度が上限を超えないこと）
目標値: 出力更新が最大2Hz（またはイベント時のみ）に抑制される
Before/After記録方法: テスト結果

固有指標-2
指標名: カメラリソース解放
測定方法: ユニットテスト/スモーク（OFFやアンマウントでMediaStream trackが停止される）
目標値: trackが停止され、バックグラウンドでカメラが稼働し続けない
Before/After記録方法: テスト結果

### 3.6 境界条件（異常系/リソース解放/レース）

対象境界:

- Browser API: `getUserMedia`、MediaStream track、ページ非表示/アンマウント
- Realtime: 既存の会話由来の表情更新（SSE）との競合
- Server lifecycle: サーバ再起動（Vision状態はOFFに戻る）

シナリオ-1（権限拒否/未対応）

- 事象: `getUserMedia` が利用不可、またはユーザーが権限を拒否
- 期待挙動: KIOSKはエラーで停止せず、VisionはOFF扱いに戻り、表情はneutralへフォールバックする

シナリオ-2（ON/OFF切替時のリソース解放）

- 事象: VisionをOFFに切り替える、またはページアンマウント
- 期待挙動: MediaStream track を確実に停止し、推論ループ/タイマーを止め、CPU/GPU負荷が残らない

シナリオ-3（表情競合: 会話ターン優先）

- 事象: 会話由来の表情（既存4ラベル）が更新される最中に、ムード由来の表情更新が走る
- 期待挙動: 会話ターンの表情を優先し、ムード側はidle時のみ適用（人格がブレない）

シナリオ-4（サーバ再起動: 安全側へ復帰）

- 事象: API Serverが再起動する
- 期待挙動: Vision有効状態はOFFとして扱われ、KIOSKはカメラを開始しない（SSE再接続時のsnapshotでOFFが同期される）

シナリオ-5（STAFFセッション失効/自動ロック: 安全側へ復帰）

- 事象: STAFFセッションが失効（keepaliveが届かない等）し、自動ロック状態になる
- 期待挙動: Vision有効状態はOFFとして扱われ、KIOSKはカメラを停止する（SSE再接続時のsnapshotでもOFFが同期される）

---

## 4. Issue分割案

### 4.1 Issue一覧

Issue-1
番号: 1
Issue名: STAFF Visionトグル + Serverの状態保持 + KIOSKへの配信
概要: STAFFの運用/設定セクションでON/OFFし、ON時は確認ダイアログを必須とする。ServerがVision有効状態（永続化しない、再起動でOFF、STAFFセッション失効でOFF）を保持し、KIOSK snapshotへ配信する。ON中は `VISION: ON` の状態を常時可視にする
推定行数: 150-250行
依存: -

Issue-2
番号: 2
Issue名: KIOSK Visionライフサイクル（ON/OFF、track停止）
概要: snapshotのVision有効状態に追従して、ON時のみ `getUserMedia(video)`、OFF/アンマウントで確実に停止する
推定行数: 150-300行
依存: #1

Issue-3
番号: 3
Issue名: KIOSK ローカル推論（MediaPipe）を差し替え可能なモジュールとして実装
概要: 推論結果を生のフレームではなく最小限のスコアとして扱い、外部送信/永続化しない
推定行数: 150-300行
依存: #2

Issue-4
番号: 4
Issue名: ムード安定化（平滑化/ヒステリシス/最小更新間隔）+ 表情/モーションマッピング
概要: `happy|neutral|unknown` を安定化し、既存表情ラベルと許可リストモーションへ反映する。KIOSK上に「カメラ有効」インジケータを表示する（プレビューは出さない）
推定行数: 150-250行
依存: #3

Issue-5
番号: 5
Issue名: テスト（揺れ抑制、フォールバック、track停止、サーバ再起動OFF）
概要: ロジックをユニットテストで固定し、エラー時やサーバ再起動でも破綻しないことを担保する
推定行数: 150-250行
依存: #1, #2, #4

### 4.2 依存関係図

依存関係（関係を1行ずつ列挙）:

- Issue 2 depends_on Issue 1
- Issue 3 depends_on Issue 2
- Issue 4 depends_on Issue 3
- Issue 5 depends_on Issue 1
- Issue 5 depends_on Issue 2
- Issue 5 depends_on Issue 4

---

## 5. プロダクション品質設計（PRD Q6に応じて記載）

### 5.1 パフォーマンス設計（PRD Q6-7: Yesの場合必須）

PRD Q6-7: No
N/A（本PRDでは数値目標を置かない）

### 5.2 セキュリティ設計（PRD Q6-5: Yesの場合必須）

PRD Q6-5: Yes

扱うデータ:

- 映像入力（カメラ）: センシティブ。保存しない/ログに出さない/外部送信しない/個人識別しない
- 派生データ（ムード）: `happy|neutral|unknown` の粗い分類に限定し、永続保存しない

認証/認可:

- STAFF操作は認証済みSTAFFのみが実行できる
- 新規エンドポイントは追加せず、既存のSTAFF eventとKIOSK streamを拡張する（映像/推論結果は扱わない）

対策チェックリスト:

- [ ] デフォルトOFF（運用判断なしにカメラが起動しない）
- [ ] 映像プレビューを表示しない
- [ ] 保存/ログ/外部送信を行わない
- [ ] 個人識別/個人ID付与/長期追跡をしない
- [ ] 推定結果を根拠に断定発話をしない（非言語リアクションのみ）

### 5.3 観測性設計（PRD Q6-6: Yesの場合必須）

PRD Q6-6: No
N/A（監査ログ要件なし。推論結果はログに出さない）

### 5.4 可用性設計（PRD Q6-8: Yesの場合必須）

PRD Q6-8: No
N/A（単機ローカル運用を前提）

---

## 6. リスクと対策

リスク-1
リスク: 誤推定で不自然な挙動になる
影響度: 中
対策: 平滑化/ヒステリシス/unknownフォールバックで揺れを抑える。断定発話はしない。

リスク-2
リスク: カメラがOFFでも裏で動き続ける（リソース解放漏れ）
影響度: 高
対策: track停止/推論ループ停止をテストで固定する

---

## 7. マイルストーン

Phase-1
フェーズ: Phase 1
完了条件: VisionのON/OFFとリソース解放が成立し、フォールバックが保証される
目標日: -

Phase-2
フェーズ: Phase 2
完了条件: ムード推定と安定化が入り、表情/モーションに反映される（非言語のみ）
目標日: -

---

## 8. 技術方針別の制限チェック

### シンプル優先の場合

- [ ] 外部サービス数が1以下（本Epicは0）
- [ ] 新規導入ライブラリが3以下
- [ ] 新規コンポーネント数が3以下
- [ ] 非同期基盤（キュー/イベントストリーム）を使用していない
- [ ] マイクロサービス分割をしていない
- [ ] コンテナオーケストレーション（K8s等）を使用していない

### 共通チェック

- [ ] 新規技術/サービス名が5つ以下
- [ ] 各選択に理由がある
- [ ] 代替案（よりシンプルな方法）が提示されている
- [ ] 「将来のため」だけを理由にした項目がない
- [ ] 必須提出物（外部サービス一覧/コンポーネント一覧/新規技術一覧）が揃っている

---

## 9. Unknown項目の確認（PRDから引き継ぎ）

Unknown-1
項目: 期限
PRDの値: Unknown
確認結果: -

---

## 変更履歴

- 2026-02-07: v1.0 初版作成
