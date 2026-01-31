# Epic: Provider Layer（音声会話 + VRM表情）

---

## メタ情報

- 作成日: 2026-02-01
- 作成者: -
- ステータス: Draft
- 参照PRD: `docs/prd/wooly-fluffy.md`
- 参照Epic: `docs/epics/wooly-fluffy-mvp-epic.md`

---

## 1. 概要

### 1.1 目的

PRDの主要フロー（PTT→録音→STT→会話→TTS）を、Provider層の実装により実運用可能にする。
合わせて、KIOSK上に「マスコットキャラクター」を表示するための最小のVRM表示・表情制御を追加する。

### 1.2 スコープ

**含む:**
- STT（ローカル）: `whisper.cpp` + Core ML による音声→テキスト
- TTS（ローカル）: VOICEVOX Engine によるテキスト→音声（四国めたん speaker_id:2）
- LLM（外部）: OpenAI API（OAuth経由で取得したトークンを利用する想定。取得フローは本Epic外）
- Effect Executor: OrchestratorのEffectを実行し、結果をEventとして戻す橋渡し
- KIOSK: ブラウザ録音（PTT）と、16kHz mono WAV への変換
- KIOSK: VRM表示（既製VRM）+ 表情（4種）+ 音量ベースの口パク

**含まない（PRDのスコープ外を継承）:**
- 録音ファイル/会話全文/STT全文の永続保存
- Webカメラの常時稼働、映像/画像の保存、個人識別（顔認証）
- Viseme/phonemeベースの高精度リップシンク
- 感情履歴・トレンド分析（永続化）
- 画像入力（マルチモーダル）を用いた機能拡張（PRD更新なしでは実装しない）

### 1.3 PRD制約の確認

項目: 規模感
PRDの値: 小規模
Epic対応: Provider層はAPI Serverに内包し、追加の常駐コンポーネントはVOICEVOX Engineのみ

項目: 技術方針
PRDの値: シンプル優先
Epic対応: 外部サービスは最大1（OpenAI APIのみ）、新規コンポーネントは最大3、非同期基盤は導入しない

項目: 既存言語/FW
PRDの値: Yes
Epic対応: TypeScript（Node.js LTS）+ React（Vite）+ SQLite

項目: デプロイ先
PRDの値: Yes
Epic対応: 常設PC（Mac mini想定）上のローカル稼働 + 同一LAN内ブラウザ

---

## 2. 必須提出物（3一覧）

### 2.1 外部サービス一覧

外部サービス-1
名称: OpenAI API
用途: LLM（会話生成）+ 内側タスク（memory_extract / consent_decision）
必須理由: MVPで短期間に精度を検証できる。Providerを差し替え可能にしておく。
代替案: ローカルLLM（例: Qwen系）

外部サービス-2
名称: なし
用途: -
必須理由: -
代替案: -

### 2.2 コンポーネント一覧

コンポーネント-1
名称: API Server
責務: HTTP API、SSE配信、Orchestrator実行、Provider呼び出し（Effect Executor）、SQLite永続
デプロイ形態: 常設PC上の単一プロセス

コンポーネント-2
名称: Web Frontend（KIOSK/STAFF）
責務: KIOSK表示（録音/再生/キャラクター表示）、STAFF操作、SSE受信
デプロイ形態: 常設PC上で配信（既存）

コンポーネント-3
名称: VOICEVOX Engine
責務: 音声合成（TTS）
デプロイ形態: 常設PC上の別プロセス（localhost:50021）

### 2.3 新規技術一覧

新規技術-1
名称: whisper.cpp
カテゴリ: STT
既存との差: 新規導入
導入理由: ローカル実行、高速（Mac M-series + Core ML）、音声データを外部に出さない

新規技術-2
名称: VOICEVOX
カテゴリ: TTS
既存との差: 新規導入
導入理由: 日本語キャラクター声に適する。ローカル実行。

新規技術-3
名称: @pixiv/three-vrm + three
カテゴリ: 3D表示
既存との差: 新規導入
導入理由: KIOSK上でマスコット表示（VRM）を最小の実装で実現できる

---

## 3. 技術設計

### 3.1 アーキテクチャ概要

システム境界:
- KIOSKは録音/再生/VRM表示（I/O）
- API ServerはOrchestratorとEffect実行（Provider呼び出し）

主要データフロー-1
from: KIOSK（録音終了）
to: API Server
用途: 音声（16kHz mono WAV）を送信してSTTを実行
プロトコル: HTTP

主要データフロー-2
from: API Server
to: OpenAI API
用途: 会話生成（必要に応じて内側タスク）
プロトコル: HTTPS

主要データフロー-3
from: API Server
to: VOICEVOX Engine
用途: TTS生成
プロトコル: HTTP（localhost）

主要データフロー-4
from: API Server
to: KIOSK
用途: 再生する音声・表情（emotion）などのイベント配信
プロトコル: SSE（既存）

### 3.2 技術選定

技術選定-1
カテゴリ: STT
選択: whisper.cpp（Core ML）
理由: ローカル実行でデータ最小化に整合、かつMacで高速

技術選定-2
カテゴリ: TTS
選択: VOICEVOX（四国めたん speaker_id: 2）
理由: 日本語キャラクター声に適する。ローカル実行。
代替案（よりシンプル）: OpenAI TTS（外部サービス増はないが音声が外部に出る） / ブラウザのSpeechSynthesis（音質・声質の制御が難しい）

技術選定-3
カテゴリ: LLM
選択: OpenAI API（OAuthで取得したトークンを投入する想定）
理由: MVP検証の速度を優先しつつ、Provider差し替え可能な構造を維持
代替案（よりシンプル）: APIキー（環境変数）

技術選定-4
カテゴリ: VRM
選択: @pixiv/three-vrm + three
理由: VRM読み込みと表情制御が最小実装で可能
代替案（よりシンプル）: 静止画 + 表情差分（3D不要）

技術選定-5
カテゴリ: 感情/表情
選択: LLM Function Callingで4種類の表情ラベルを返す
理由: 追加モデル無しで実装でき、PRDの「感情を断定する発話はしない」に抵触しにくい

### 3.3 データモデル（概要）

エンティティ-1
名前: Expression
主要属性: `neutral | happy | sad | surprised`
関連: KIOSKのVRM表情（永続化しない）

### 3.4 API設計（概要）

API-1
エンドポイント: `/api/v1/kiosk/stt-audio`
メソッド: POST
説明: 録音済み音声を送信し、STT結果をOrchestratorへ入力する

API-2
エンドポイント: `/health`
メソッド: GET
説明: Provider可用性（stt/tts/llm）を含めて返す

### 3.5 プロジェクト固有指標（任意）

固有指標-1
指標名: STT処理時間
測定方法: 統合テスト/スモークテストで計測（タイムアウトで失敗）
目標値: 5秒音声で < 2000ms（目安）
Before/After記録方法: ローカル計測（CIでは機器差が出るため必須化しない）

固有指標-2
指標名: 音声永続化ゼロ
測定方法: テストで一時ファイルが残っていないことを検証
目標値: 常に0
Before/After記録方法: `npm run test` / `npm run coverage`

---

## 4. Issue分割案

### 4.1 Issue一覧

Issue-6
番号: 6
Issue名: Effect Executor（Effect→Provider→Event）基盤
概要: OrchestratorのEffectを実行し、結果をEventとしてOrchestratorへ返す橋渡しを実装する
推定行数: 150-250行
依存: #1（Orchestrator）

Issue-7
番号: 7
Issue名: KIOSK録音（PTT）+ WAV変換
概要: 録音、16kHz mono WAV変換、送信を実装する（保存しない）
推定行数: 200-300行
依存: #5（Web最小UI）

Issue-8
番号: 8
Issue名: STT Provider（whisper.cpp）
概要: whisper.cpp呼び出し（subprocess）と、音声一時ファイルの確実な削除を実装する
推定行数: 200-300行
依存: #6

Issue-9
番号: 9
Issue名: TTS Provider（VOICEVOX）
概要: VOICEVOX HTTP APIクライアントと、ヘルスチェック、帰属表示文言のUI表示を実装する
推定行数: 150-250行
依存: #6

Issue-10
番号: 10
Issue名: LLM Provider（OpenAI + emotion function）
概要: OpenAI API呼び出しと、表情ラベル（4種）を返すfunction callingを実装する
推定行数: 200-300行
依存: #6

Issue-11
番号: 11
Issue名: VRM表示 + 表情/口パク
概要: 既製VRMを読み込み表示し、感情→表情、音量→口パクを反映する
推定行数: 250-350行
依存: #7, #9, #10

### 4.2 依存関係図

依存関係（関係を1行ずつ列挙）:
- Issue 6 depends_on Issue 1
- Issue 7 depends_on Issue 5
- Issue 8 depends_on Issue 6
- Issue 9 depends_on Issue 6
- Issue 10 depends_on Issue 6
- Issue 11 depends_on Issue 7
- Issue 11 depends_on Issue 9
- Issue 11 depends_on Issue 10

---

## 5. プロダクション品質設計（PRD Q6に応じて記載）

### 5.1 パフォーマンス設計（PRD Q6-7: Yesの場合必須）

PRD Q6-7: No

N/A（パフォーマンス要件なし）

### 5.2 セキュリティ設計（PRD Q6-5: Yesの場合必須）

PRD Q6-5: Yes

扱うデータ:
- 呼び名（`name`）: 個人に紐づく可能性があるため最小化
- 低センシティブ記憶: 職員Confirm後のみ保存
- 音声/会話全文/STT全文: 永続保存しない

対策:
- 音声はメモリ内処理を優先し、やむを得ず一時ファイル化する場合は finally で即削除（テストで固定）
- ログは内容を出さず、Provider名/レイテンシ/エラーコードのみ
- 表情推定は発話の断定に使わない（PRD「推定結果を根拠に感情を断定する発話はしない」）

### 5.3 観測性設計（PRD Q6-6: Yesの場合必須）

PRD Q6-6: No

N/A（監査ログ要件なし）

### 5.4 可用性設計（PRD Q6-8: Yesの場合必須）

PRD Q6-8: No

N/A（可用性要件なし）

---

## 6. リスクと対策

リスク-1
リスク: VOICEVOX Engineが起動していない
影響度: 中
対策: /healthでunavailableを返し、UIは音声なしで継続できる設計

リスク-2
リスク: whisper.cpp の実行・モデル配置が環境依存
影響度: 中
対策: インストール手順を明記し、失敗時はフォールバック応答（既存の失敗時フレーズ）へ

リスク-3
リスク: VRMモデルのライセンス
影響度: 中
対策: VRoid HubのURL/利用条件をADRに記録してから同梱/配信する

---

## 7. マイルストーン

Phase-1
フェーズ: Phase 1
完了条件: Issue 6 完了（Effect Executor導入）
目標日: -

Phase-2
フェーズ: Phase 2
完了条件: Issue 7/8/9/10 完了（音声I/O + Provider）
目標日: -

Phase-3
フェーズ: Phase 3
完了条件: Issue 11 完了（VRM表示 + 表情/口パク）
目標日: -

---

## 8. 技術方針別の制限チェック

### シンプル優先の場合

- [x] 外部サービス数が1以下（OpenAI APIのみ）
- [x] 新規コンポーネント数が3以下（API Server / Web / VOICEVOX Engine）
- [x] 非同期基盤（キュー/イベントストリーム）を使用していない
- [x] マイクロサービス分割をしていない

### 共通チェック

- [x] 新規技術/サービス名が5つ以下
- [x] 各選択に「なぜこれを選んだか」の理由がある
- [x] 代替案（よりシンプルな方法）が提示されている
- [x] 「将来のため」だけを理由にした項目がない
- [x] 必須提出物（外部サービス一覧/コンポーネント一覧/新規技術一覧）が揃っている

---

## 9. Unknown項目の確認（PRDから引き継ぎ）

Unknown-1
項目: VRMモデル（VRoid Hubのどのモデルを使うか）
PRDの値: -
確認結果: 未決（実装前にURL/利用条件を確定してADRに記録）

Unknown-2
項目: OpenAI OAuthトークン取得フロー
PRDの値: -
確認結果: 本Epicでは「取得済みトークンを環境変数として投入」までを前提（取得手段は別途）

---

## 変更履歴

- 2026-02-01: v1.0 初版作成
