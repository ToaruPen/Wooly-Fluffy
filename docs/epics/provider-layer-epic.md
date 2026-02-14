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
- TTS（ローカル）: VOICEVOX 互換の TTS エンジンによるテキスト→音声（既定: AivisSpeech Engine）
- LLM（ローカル/外部）: ローカルはLM Studio（OpenAI互換API）をデフォルトとし、外部LLM APIは任意で切り替え可能（切り替えはサーバ再起動で行う）。外部の候補として Gemini Developer API（AI Studio API key）を想定する。
- Effect Executor: OrchestratorのEffectを実行し、結果をEventとして戻す橋渡し
- KIOSK: ブラウザ録音（PTT）と、16kHz mono WAV への変換
- KIOSK: VRM表示（既製VRM）+ 表情（4種）+ 音量ベースの口パク
- KIOSK: 芸事（例: ダンス/手をふる等）を「許可リストのモーションID」で再生できる
- ツール呼び出し: 天気などの外部情報を必要に応じて取得し、回答に反映できる（LLMはツール呼び出し要求を返すだけ。実行はアプリ側）

**含まない（PRDのスコープ外を継承）:**

- 録音ファイル/会話全文/STT全文の永続保存
- Webカメラの常時稼働、映像/画像の保存、個人識別（顔認証）
- Viseme/phonemeベースの高精度リップシンク
- 感情履歴・トレンド分析（永続化）
- 画像入力（マルチモーダル）を用いた機能拡張（PRD更新なしでは実装しない）

### 1.3 PRD制約の確認

項目: 規模感
PRDの値: 小規模
Epic対応: Provider層はAPI Serverに内包し、追加の常駐コンポーネントは最小に抑える（TTS Engine（VOICEVOX互換）。ローカルLLMはLM Studioを選択する場合は別プロセス）

項目: 技術方針
PRDの値: シンプル優先
Epic対応: 外部サービス数の上限では縛らず、許可リスト + タイムアウト + フォールバックで暴走/コスト/故障モードを抑制する（同時に有効なLLM Providerは1つ）

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
名称: なし（デフォルト）
用途: -
必須理由: -
代替案: 外部サービスを使う場合は下記

外部サービス-2
名称: 外部LLM API（例: OpenAI / GLM など）
用途: LLM（会話生成）+ 内側タスク（session_summary 等）+ ツール呼び出し結果の統合
必須理由: ローカルLLMの品質/遅延が要件を満たさない場合の代替。
代替案: ローカルLLM（LM Studio等）

外部サービス-3
名称: 天気API（候補は後で確定）
用途: `get_weather` ツール
必須理由: リアルタイム情報の参照が必要なため
代替案: ツール無し（「わからない」と返す）

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
名称: TTS Engine（VOICEVOX互換）
責務: 音声合成（TTS）
デプロイ形態: 常設PC上の別プロセス（既定: localhost:10101; 代替: localhost:50021 等）

コンポーネント-4
名称: LM Studio Local Server（任意）
責務: ローカルLLMの推論（OpenAI互換API）
デプロイ形態: 常設PC上の別プロセス（localhost）

### 2.3 新規技術一覧

新規技術-1
名称: whisper.cpp
カテゴリ: STT
既存との差: 新規導入
導入理由: ローカル実行、高速（Mac M-series + Core ML）、音声データを外部に出さない

新規技術-2
名称: AivisSpeech Engine（VOICEVOX互換）
カテゴリ: TTS
既存との差: 新規導入
導入理由: VOICEVOX 互換 HTTP API（/audio_query→/synthesis）でローカル実行でき、モデル追加が可能。

新規技術-3
名称: @pixiv/three-vrm + three
カテゴリ: 3D表示
既存との差: 新規導入
導入理由: KIOSK上でマスコット表示（VRM）を最小の実装で実現できる

新規技術-4
名称: LLM接続（LM Studio / Gemini Developer API）
カテゴリ: LLM（ローカル/外部）
既存との差: 新規導入
導入理由: OpenAI互換API（LM Studio）に加え、品質/安定性/コストの観点で外部LLM（Gemini Developer API）へ切替できる。
補足:

- Geminiネイティブ（structured outputs / function calling）は公式SDK `@google/genai` を使用する。
- TypeScript のビルド/型チェックでは、`@google/genai` の型定義が MCP（Model Context Protocol）SDK を参照するため、`@modelcontextprotocol/sdk` を dev dependency としてインストールしておく（実行時にアプリが MCP を直接利用することを意味しない）。

新規技術-5
名称: Tool/Function Calling（OpenAI互換形式）
カテゴリ: LLM拡張
既存との差: 新規導入
導入理由: 外部情報（天気等）を許可リスト経由で取得し、会話に反映できる

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
to: LLM Provider（ローカルLM Studio / 外部LLM API）
用途: 会話生成（必要に応じて内側タスク/ツール呼び出し）
プロトコル: HTTP（localhost）/ HTTPS

主要データフロー-3
from: API Server
to: TTS Engine（VOICEVOX互換）
用途: TTS生成
プロトコル: HTTP（localhost）

主要データフロー-4
from: API Server
to: KIOSK
用途: 再生する音声・表情（emotion）などのイベント配信
プロトコル: SSE（既存）

主要データフロー-5
from: API Server
to: 天気API（任意）
用途: `get_weather` ツールの実行
プロトコル: HTTPS

### 3.2 技術選定

技術選定-1
カテゴリ: STT
選択: whisper.cpp（Core ML）
理由: ローカル実行でデータ最小化に整合、かつMacで高速

技術選定-2
カテゴリ: TTS
選択: AivisSpeech Engine（VOICEVOX互換）を既定とし、TTS Engine は差し替え可能にする
理由: VOICEVOX互換APIのため実装を簡素に保てる。モデル追加により声質を調整できる。
代替案（よりシンプル）: OpenAI TTS（外部サービス増はないが音声が外部に出る） / ブラウザのSpeechSynthesis（音質・声質の制御が難しい）

技術選定-3
カテゴリ: LLM
選択: ローカルLM Studio（OpenAI互換API）をデフォルト、外部LLM APIは任意で切り替え
理由: コスト/データ最小化を優先しつつ、必要なら外部に切り替えられる
代替案（よりシンプル）: 外部LLM API固定（APIキー/トークン）

技術選定-4
カテゴリ: VRM
選択: @pixiv/three-vrm + three
理由: VRM読み込みと表情制御が最小実装で可能
代替案（よりシンプル）: 静止画 + 表情差分（3D不要）

技術選定-5
カテゴリ: 感情/表情
選択: LLM Function Callingで4種類の表情ラベルを返す
理由: 追加モデル無しで実装でき、PRDの「感情を断定する発話はしない」に抵触しにくい

技術選定-6
カテゴリ: 芸事（モーション）
選択: LLMは `motion_id`（許可リスト）を返し、KIOSKが事前に用意したモーション資産を適用する
理由: LLMにファイル操作/任意スクリプト実行をさせず、失敗時は安全に無視/代替できる
補足（ローカル運用）:

- 暫定で Mixamo のモーションを使用してよい（ローカル運用のみ）
- rawファイル（FBX/VRMA等）はリポジトリに含めず、再配布もしない
- `motion_id` は小さな許可リストで運用し、未知の `motion_id` は安全に無視する
- 参照: ADR-11, Issue #38

技術選定-7
カテゴリ: ツール呼び出し
選択: OpenAI互換の `tools` / `tool_calls` 形式を用い、実行はアプリ側（許可リスト）で行う
理由: LLMは「要求」だけを返し、実際の外部アクセスはアプリが安全に制御できる

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
Issue名: TTS Provider（VOICEVOX互換）
概要: VOICEVOX互換 HTTP API クライアントとヘルスチェックを実装する（既定: AivisSpeech Engine）。帰属表記は「エンジン/モデルの一次情報URL」を参照し、UI表示は運用方針に合わせて別Issueで扱う。
推定行数: 150-250行
依存: #6

Issue-10
番号: 10
Issue名: LLM Provider（local/external + expression）
概要: LLM Providerの切り替え（ローカル/外部）と、表情ラベル（4種）を返す構造化出力/ツール呼び出しを実装する。外部LLMとして Gemini（OpenAI互換 / ネイティブSDK）も選択肢に含める。
推定行数: 200-300行
依存: #6

Issue-11
番号: 11
Issue名: VRM表示 + 表情/口パク
概要: 既製VRMを読み込み表示し、感情→表情、音量→口パクを反映する
推定行数: 250-350行
依存: #7, #9, #10

Issue-12
番号: 12
Issue名: Tool Executor（get_weather など）
概要: `tools/tool_calls` を解釈し、許可リストのツールを実行して結果をモデルへ返す（タイムアウト/フォールバックを含む）
推定行数: 200-350行
依存: #6

Issue-13
番号: 13
Issue名: 芸事（モーション）再生コマンド
概要: Server->KIOSKの `play_motion` コマンドと、KIOSK側の許可リストモーション適用（ダンス等）を実装する
推定行数: 200-400行
依存: #11
実装Issue（PoC）: #38（Mixamo motion playback PoC）

Issue-14
番号: 14
Issue名: 主要ループ（外部依存）: STTを実行経路に接続（スタブ撤去）
概要: サーバのSTTスタブをwhisper.cpp Providerへ差し替え、未設定/失敗時も会話が止まらないことをテストで固定する（/healthのsttステータスも実態と一致させる）
推定行数: 80-180行
依存: #6, #8

Issue-15
番号: 15
Issue名: Runbook: 外部依存/環境変数セットアップ + 主要ループ手動スモーク
概要: whisper.cpp / TTS Engine（VOICEVOX互換）/ LLM（LM Studioまたは外部）/ VRMのセットアップと環境変数一覧、主要ループの手動スモーク手順をREADMEへ追記する
推定行数: 50-120行
依存: #14

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
- Issue 12 depends_on Issue 6
- Issue 13 depends_on Issue 11
- Issue 14 depends_on Issue 6
- Issue 14 depends_on Issue 8
- Issue 15 depends_on Issue 14

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
リスク: TTS Engine（VOICEVOX互換）が起動していない
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

- [ ] （更新）外部サービス数では縛らず、許可リスト/タイムアウト/フォールバックで制御できている
- [ ] （更新）常駐コンポーネントは最小に抑えられている（LM Studioは任意）
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
