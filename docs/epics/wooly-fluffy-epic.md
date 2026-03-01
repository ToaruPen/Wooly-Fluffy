# Epic: Wooly-Fluffy（PRD v1.0 実装計画）

---

## メタ情報

- 作成日: 2026-02-07
- 作成者: -
- ステータス: 廃止（`docs/epics/wooly-fluffy-mvp-epic.md` に統合）
- 参照PRD: `docs/prd/wooly-fluffy.md`

**⚠ このファイルは廃止済みです。参照しないでください。**

NOTE: このEpicは過去の設計（`PERSONAL(name)` や同意フロー等）を含みます。最新の実装計画は `docs/epics/wooly-fluffy-mvp-epic.md` と Issue #114-#119 を参照してください。`memory_items` データモデルは `session_summary_items` に置換されています。

---

## 1. 概要

### 1.1 目的

学童の現場で、子どもが安心して話しかけられる「マスコットキャラクター」と会話できる体験を、運用が破綻しない形（職員見守り・責任分界）で成立させる。
会話全文/音声/STT全文の保存を避けつつ、`PERSONAL(name)` における低センシティブな「記憶」を最小限で扱い、職員Confirmでのみ保存する。

### 1.2 スコープ

**含む:**

- `ROOM` / `PERSONAL(name)` のモード遷移（無操作300秒で `ROOM` に戻る）
- Push-to-talk（KIOSK/職員操作）で録音開始/停止を制御し、待機中は無反応にできる（KIOSK/STAFFとも hold-to-talk を前提、STAFFは緊急停止を維持）
- 記憶候補（低センシティブのみ）の提示 → 子どもの「はい/いいえ」 → 「はい」のみ `pending` 作成 → 職員Confirm/Deny
- `pending` 一覧の取得と、Confirm/Deny 操作（STAFF画面）
- STAFFアクセス制御（LAN内限定 + 共有パスコード + 自動ロック）
- 芸事（モーション/ジェスチャ）の許可リスト実行（未知は安全に無視/代替し会話継続）
- ツール呼び出し（外部情報参照）の許可リスト実行（タイムアウト + 失敗時フォールバック）

**含まない（PRDのスコープ外を継承）:**

- バイオメトリクス（声紋等）による本人確認
- 録音ファイルの保存
- 会話全文ログ（`ROOM` / `PERSONAL` ともに）の永続保存
- 施設外からの遠隔アクセス（インターネット公開）
- 子どもの指示で任意の外部サイトへアクセス/ブラウズ/検索する機能
- Webカメラの常時稼働、映像/画像の保存、個人識別（顔認証）
- LLMに任意のファイル読み書き/任意コード実行の権限を与える機能（ツールは許可リストに限定）

### 1.3 PRD制約の確認

項目: 規模感
PRDの値: 小規模（`docs/prd/wooly-fluffy.md` セクション 7）
Epic対応: 単機ローカル運用・単一サーバ中心の構成を維持し、コンポーネントを最小にする

項目: 技術方針
PRDの値: シンプル優先（`docs/prd/wooly-fluffy.md` セクション 7）
Epic対応: 下記の制限（外部サービス<=1、新規ライブラリ<=3、新規コンポーネント<=3、非同期基盤なし）を適用する

項目: 既存言語/FW
PRDの値: Yes（TypeScript（Node.js LTS）+ React（Vite）+ SQLite）
Epic対応: 既存スタックに固定し、追加技術は最小にする

項目: デプロイ先
PRDの値: Yes（常設PC上でローカル稼働、同一LAN内ブラウザ）
Epic対応: インターネット公開を前提としない（LAN内限定 + ローカル依存の運用を許容）

---

## 2. 必須提出物（3一覧）

### 2.1 外部サービス一覧

外部サービス-1
名称: 天気API（未選定）
用途: `get_weather` ツール（例: 「今日の天気」）のための外部情報参照
必須理由: PRD FR-6 に「外部情報をツール呼び出しで参照」が Must として含まれるため
代替案: ツール機能は枠のみ実装し、外部呼び出しは行わず「わからない/確認できない」フォールバックで会話を継続する（外部サービス=0）

### 2.2 コンポーネント一覧

コンポーネント-1
名称: API Server
責務: HTTP API、SSE配信、状態管理（モード/同意/タイマー）、Provider呼び出し、SQLite永続、アクセス制御
デプロイ形態: 常設PC上の単一プロセス

コンポーネント-2
名称: Web Frontend（KIOSK/STAFF）
責務: KIOSK表示・入力（録音/同意UI/モーション実行）、STAFF操作（PTT/Confirm/Deny/緊急停止/ログイン）、SSE受信
デプロイ形態: 常設PC上で配信（同一LAN内ブラウザ）

### 2.3 新規技術一覧

なし（既存の TypeScript/React/Vite/SQLite の範囲で実装する）

---

## 3. 技術設計

### 3.1 アーキテクチャ概要

システム境界:

- KIOSK/STAFF（ブラウザ）: 録音/再生/UI表示/入力などのI/O担当
- API Server: 状態（`ROOM/PERSONAL`、同意、タイムアウト）と永続（`pending/confirmed`）と境界制御（許可リスト、タイムアウト、フォールバック）担当
- 外部サービス（任意）: 天気APIのみ（許可リストで呼び出し、失敗しても会話継続）

主要データフロー-1
from: STAFF UI
to: API Server
用途: PTT開始/終了、セッションリセット、緊急停止/復帰などのイベント入力
プロトコル: HTTP

主要データフロー-2
from: API Server
to: KIOSK UI
用途: 録音開始/停止、発話、モーション実行、出力停止などのコマンド配信
プロトコル: SSE

主要データフロー-3
from: KIOSK UI
to: API Server
用途: STT用の音声アップロード（永続保存しない）
プロトコル: HTTP（multipart/form-data）

主要データフロー-4
from: API Server
to: 天気API（任意）
用途: `get_weather` ツール実行
プロトコル: HTTPS

### 3.2 技術選定

技術選定-1
カテゴリ: 言語/ランタイム
選択: TypeScript（Node.js LTS）
理由: 状態遷移・境界条件（タイムアウト/キャンセル/レース）を型とテストで固定しやすい

技術選定-2
カテゴリ: UI
選択: React + Vite
理由: KIOSK/STAFFの2画面を明確に分け、SSE購読とUI状態を管理しやすい

技術選定-3
カテゴリ: 永続化
選択: SQLite
理由: 単機ローカル運用に適合し、`pending/confirmed` の最小永続が軽い

技術選定-4
カテゴリ: Realtime
選択: SSE（Server-Sent Events）
理由: KIOSK/STAFFへ状態スナップショットとコマンドを簡単に配信できる
代替案（よりシンプル）: Polling（UIが複雑化し、待機/停止/同意UIなどのタイミング制御が難しい）

技術選定-5
カテゴリ: ツール呼び出し（外部情報）
選択: 許可リスト方式のツール実行（天気APIは1つに限定、タイムアウト + 失敗時フォールバック）
理由: PRD FR-6 を満たしつつ、外部依存の故障モードでも会話を止めない
代替案（よりシンプル）: ツール無し（「わからない」と返す）

### 3.3 データモデル（概要）

エンティティ-1
名前: memory_items
主要属性: id, personal_name, kind, value, source_quote, status, created_at_ms, updated_at_ms, expires_at_ms
関連: -

データ最小化ルール:

- `ROOM` の会話全文、音声、STT全文は永続保存しない
- `PERSONAL(name)` の保存対象は、職員Confirm後の「低センシティブ記憶」のみ
- `source_quote` は `pending` の確認補助に限定し、Confirm時は `NULL` に落とす（PRD AC-4）

### 3.4 API設計（概要）

API-1
エンドポイント: `/api/v1/kiosk/stream`
メソッド: GET
説明: KIOSK向けSSEストリーム（snapshot + commands）

API-2
エンドポイント: `/api/v1/staff/stream`
メソッド: GET
説明: STAFF向けSSEストリーム（snapshot + pending_list）

API-3
エンドポイント: `/api/v1/staff/auth/login`
メソッド: POST
説明: 共有パスコードでログインし、セッションを付与

API-4
エンドポイント: `/api/v1/staff/event`
メソッド: POST
説明: PTT/セッションリセット/緊急停止/復帰などのSTAFFイベント入力

API-5
エンドポイント: `/api/v1/kiosk/event`
メソッド: POST
説明: 子どもの同意（はい/いいえ）などのKIOSKイベント入力

API-6
エンドポイント: `/api/v1/staff/pending`
メソッド: GET
説明: pending一覧取得

API-7
エンドポイント: `/api/v1/staff/pending/:id/confirm`
メソッド: POST
説明: pendingをconfirmedへ（`source_quote` は `NULL` へ）

API-8
エンドポイント: `/api/v1/staff/pending/:id/deny`
メソッド: POST
説明: pendingをrejectedへ

### 3.5 プロジェクト固有指標（任意）

固有指標-1
指標名: MVP主要フローの自動テスト網羅
測定方法: `npm run test` / `npm run coverage`
目標値: PRDのAC（正常系/異常系）に対応するテストがCIで常にパスする
Before/After記録方法: CIの結果（失敗時は該当テストケースを根拠に修正）

固有指標-2
指標名: データ最小化（永続化・ログ）
測定方法: DBスキーマ検査・ログ出力方針のテスト/レビュー（/sync-docs）
目標値: 音声/会話全文/STT全文がDBに保存されず、ログにも出力されない
Before/After記録方法: テスト + コードレビュー（保存/ログ経路の差分確認）

### 3.6 境界条件（異常系/リソース解放/レース）

対象境界:

- HTTP: `/api/v1/staff/*`, `/api/v1/kiosk/*`
- Realtime: SSE（`/api/v1/kiosk/stream`, `/api/v1/staff/stream`）
- Browser API: 録音（MediaRecorder/WebAudio等）、音声再生
- subprocess/file/DB: STTの一時ファイル（ある場合）、SQLite接続、SSE接続

シナリオ-1（レース: PTT連打/順序逆転）

- 事象: `PTT_UP` が `PTT_DOWN` より先に届く、または短時間に `DOWN/UP` が連続する
- 期待挙動: 破綻せず無視/デバウンスし、録音・STT要求が多重に走らない（in-flight相関で重複結果は捨てる）

シナリオ-2（SSE再接続: 重複コマンド）

- 事象: KIOSKが再接続し、同じ `speak`/`play_motion` 相当が再送される
- 期待挙動: UI側は `say_id` / `motion_instance_id` 等で重複排除し、二重再生しない

シナリオ-3（タイムアウト: 同意待ち30秒）

- 事象: 「覚えていい？」提示後、30秒以内に回答がない
- 期待挙動: 候補は破棄され `pending` は作成されない（PRD AC-E1）。UIは通常会話へ復帰し、会話を止めない

シナリオ-4（キャンセル: セッションリセット/緊急停止）

- 事象: STT/会話生成/ツール実行中に `STAFF_RESET_SESSION` または `STAFF_EMERGENCY_STOP` が入る
- 期待挙動: 進行中の出力を止め、以降に遅延して返ってきた結果は `request_id` 不一致として無視する（状態を壊さない）

シナリオ-5（リソース解放: 録音停止/アンマウント）

- 事象: 録音停止、ページ遷移、SSE切断、ブラウザタブクローズ
- 期待挙動: MediaStream track を確実に停止し、録音中フラグ/タイマーを解除し、サーバ側も接続/タイマー/一時ファイル（ある場合）を確実に解放する

---

## 4. Issue分割案

### 4.1 Issue一覧

Issue-1
番号: 1
Issue名: モード/同意/タイムアウトの状態遷移（純粋ロジック）+ ユニットテスト
概要: `ROOM/PERSONAL(name)`、無操作300秒、同意30秒、フォールバック、優先度（セッションリセット/緊急停止）を純粋関数として固定する
推定行数: 200-300行
依存: -

Issue-2
番号: 2
Issue名: SQLiteストア（memory_items）+ pending/confirmed/rejected + 統合テスト
概要: `pending` 作成、Confirm/Deny、AC-4の `source_quote=NULL` を含む永続ロジックをテストで固定する
推定行数: 200-300行
依存: #1

Issue-3
番号: 3
Issue名: HTTP API v1（KIOSK/STAFF）+ エラー形式統一
概要: `/api/v1` の基本エンドポイント（event/pending/auth）を実装し、UIが確実にエラー処理できるレスポンス形式を固定する
推定行数: 150-250行
依存: #2

Issue-4
番号: 4
Issue名: SSE（KIOSK/STAFF）配信（snapshot + commands）+ 再接続設計
概要: 接続時に必ずsnapshotを送る、keep-alive、重複排除IDの扱い（say_id等）を含め、再接続でも破綻しない契約をテストで固定する
推定行数: 200-300行
依存: #3

Issue-5
番号: 5
Issue名: STAFFアクセス制御（LAN内限定 + セッション + 自動ロック）
概要: LAN外拒否（remote addressベース）、共有パスコードログイン、操作がない場合の失効（keepalive設計）を実装し、異常系AC（PRD AC-E2/AC-E3）を満たす
推定行数: 200-300行
依存: #3

Issue-6
番号: 6
Issue名: Web（STAFF）: ログイン + PTT操作 + pending一覧/Confirm/Deny
概要: STAFF画面でログイン/自動ロック、PTTボタン、pending表示とConfirm/Denyを実装する
推定行数: 200-300行
依存: #4, #5

Issue-7
番号: 7
Issue名: Web（KIOSK）: 状態表示 + 同意UI + 出力停止 + コマンド重複排除
概要: KIOSK画面で状態（ROOM/PERSONAL/同意表示）を描画し、speak/stop_output/play_motion等のSSEコマンドを安全に反映する
推定行数: 200-300行
依存: #4

Issue-8
番号: 8
Issue名: ツール実行（get_weather）: 許可リスト + タイムアウト + フォールバック
概要: 外部情報参照の実行器を追加し、タイムアウト/失敗でも会話が止まらないことをテストで固定する（外部サービスは1つに限定）
推定行数: 150-300行
依存: #1, #3

### 4.2 依存関係図

依存関係（関係を1行ずつ列挙）:

- Issue 2 depends_on Issue 1
- Issue 3 depends_on Issue 2
- Issue 4 depends_on Issue 3
- Issue 5 depends_on Issue 3
- Issue 6 depends_on Issue 4
- Issue 6 depends_on Issue 5
- Issue 7 depends_on Issue 4
- Issue 8 depends_on Issue 1
- Issue 8 depends_on Issue 3

---

## 5. プロダクション品質設計（PRD Q6に応じて記載）

### 5.1 パフォーマンス設計（PRD Q6-7: Yesの場合必須）

PRD Q6-7: No
N/A（本PRDでは数値目標を置かない）

### 5.2 セキュリティ設計（PRD Q6-5: Yesの場合必須）

PRD Q6-5: Yes

扱うデータ:

- 呼び名（`name` / `personal_name`）: 個人に紐づく可能性があるため最小化（用途を `PERSONAL(name)` の体験に限定）
- 低センシティブ記憶候補（likes/food/play/hobby 等）: 子どもの同意 + 職員Confirm後のみ保存
- 音声/会話全文/STT全文: 永続保存しない（ログにも出さない）

認証/認可:

- 認証方式: 共有パスコード + セッション（Cookie）
- 認可モデル: STAFF系APIはセッション必須、KIOSK系は原則不要（ただし操作可能な範囲を最小にする）
- ネットワーク制限: STAFF系はLAN内からのみ許可（LAN外は拒否）

対策チェックリスト:

- [ ] 入力検証/サニタイズ（HTTP/SSE payload、パスコード、各種ID）
- [ ] SQLインジェクション対策（パラメタ化、文字列連結しない）
- [ ] XSS対策（UIは外部文字列をHTMLとして解釈しない）
- [ ] CSRF対策（LAN内でもセッションを使うため、SameSite/CORS方針を固定）
- [ ] シークレット管理（`STAFF_PASSCODE` 等は環境変数。ログ出力しない）

### 5.3 観測性設計（PRD Q6-6: Yesの場合必須）

PRD Q6-6: No
N/A（監査ログ要件なし。ログは最小限にし、会話本文などの機微情報は出さない）

### 5.4 可用性設計（PRD Q6-8: Yesの場合必須）

PRD Q6-8: No
N/A（SLA/SLOなし。単機ローカル運用を前提）

---

## 6. リスクと対策

リスク-1
リスク: 外部ツール（天気API）が遅延/失敗する
影響度: 中
対策: タイムアウト固定 + 失敗時フォールバック（会話継続）。外部サービスは1つに限定

リスク-2
リスク: PTT/録音/再接続のレースで状態が壊れる
影響度: 高
対策: request_id相関、重複排除ID、タイムアウト、セッションリセット/緊急停止の優先順位を仕様として固定し、テストで担保

リスク-3
リスク: データ最小化が実装/ログで破られる
影響度: 高
対策: 何を保存/ログしないかをテスト観点に落とし、DBスキーマとログ方針をレビューで固定

---

## 7. マイルストーン

Phase-1
フェーズ: Phase 1
完了条件: Issue 1-4が完了し、主要フローの状態遷移/API/SSE契約がテストで固定される
目標日: -

Phase-2
フェーズ: Phase 2
完了条件: Issue 5-7が完了し、STAFF操作とKIOSK表示（同意/停止/重複排除）が最低限成立する
目標日: -

Phase-3
フェーズ: Phase 3
完了条件: Issue 8が完了し、ツール呼び出し（外部情報参照）が許可リスト/タイムアウト付きで成立する
目標日: -

---

## 8. 技術方針別の制限チェック

### シンプル優先の場合

- [ ] 外部サービス数が1以下（天気APIのみ。使わない場合は0）
- [ ] 新規導入ライブラリが3以下
- [ ] 新規コンポーネント数が3以下
- [ ] 非同期基盤（キュー/イベントストリーム）を使用していない
- [ ] マイクロサービス分割をしていない
- [ ] コンテナオーケストレーション（K8s等）を使用していない

### 共通チェック

- [ ] 新規技術/サービス名が5つ以下
- [ ] 各選択に「なぜこれを選んだか」の理由がある
- [ ] 代替案（よりシンプルな方法）が提示されている
- [ ] 「将来のため」だけを理由にした項目がない
- [ ] 必須提出物（外部サービス一覧/コンポーネント一覧/新規技術一覧）が揃っている

---

## 9. Unknown項目の確認（PRDから引き継ぎ）

なし（PRD Q6のUnknownは0件）

---

## 変更履歴

- 2026-02-07: v1.0 初版作成
