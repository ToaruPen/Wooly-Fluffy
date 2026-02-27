# Epic: Wooly-Fluffy AI音声低遅延化（段階導入）

---

## メタ情報

- 作成日: 2026-02-20
- 作成者: OpenCode
- ステータス: Completed
- 参照PRD: `docs/prd/wooly-fluffy.md`

---

## 1. 概要

### 1.1 目的

AI応答（台本固定を除く）の体感遅延を改善し、最初の音が出るまでの待ち時間を短縮する。
既存のSSE契約とOrchestrator純粋性を壊さず、段階導入で安全に移行する。

### 1.2 スコープ

**含む:**

- `kiosk.command.speech.start|segment|end` の追加（既存 `kiosk.command.speak` は温存）
- 文境界分割（日本語句読点優先、短文断片の抑制）
- セグメント順序保証（`utterance_id` + `segment_index`）
- stop_output時のin-flight破棄（stale混入防止）
- 段階的TTFA改善の計測（本文非保存）

**含まない（PRDのスコープ外を継承）:**

- 会話全文/音声/STT全文の永続保存
- 台本固定パートの再設計
- 外部公開運用（インターネット公開）

### 1.3 PRD制約の確認

項目: 規模感
PRDの値: 小規模
Epic対応: 3 Issueに分割し、段階導入で局所変更する

項目: 技術方針
PRDの値: シンプル優先
Epic対応: 既存SSE/HTTPの経路を維持し、互換拡張で導入する

項目: 既存言語/FW
PRDの値: Yes
Epic対応: TypeScript（Node.js LTS）+ React（Vite）+ SQLite（変更なし）

項目: デプロイ先
PRDの値: Yes
Epic対応: 常設PC上ローカル + 同一LAN内ブラウザ（変更なし）

---

## 2. 必須提出物（3一覧）

### 2.1 外部サービス一覧

外部サービス-1
名称: 外部LLM API（既存）
用途: AI応答生成（Phase3でstream利用）
必須理由: 現行構成の継続利用
代替案: なし（本Epicではprovider差し替えを扱わない）

外部サービス-2
名称: VOICEVOX互換TTS（既存）
用途: セグメント単位TTS合成
必須理由: 現行音声合成経路の継続利用
代替案: なし（本EpicではTTSエンジン切替を扱わない）

### 2.2 コンポーネント一覧

コンポーネント-1
名称: API Server
責務: LLM応答処理、文分割、SSE送出、stop_output制御
デプロイ形態: 常設PC上単一プロセス

コンポーネント-2
名称: Web Frontend（KIOSK）
責務: `speech.segment` 受信、TTSプリフェッチ、FIFO再生、中断処理
デプロイ形態: 常設PC上配信

### 2.3 新規技術一覧

新規技術-1
名称: `kiosk.command.speech.*`
カテゴリ: Realtime protocol
既存との差: SSEコマンド拡張
導入理由: 文単位の段階出力と順序保証のため

新規技術-2
名称: なし
カテゴリ: -
既存との差: 依存追加なし
導入理由: 既存経路の拡張で達成可能なため

---

## 3. 技術設計

### 3.1 アーキテクチャ概要

システム境界:

- Orchestratorは最終確定イベント（`CHAT_RESULT`）を引き続き担当
- Effect Executorは段階出力コマンドの送出と非同期制御を担当
- KIOSKは段階出力専用キューを持ち、既存 `speak` 経路と分離して再生する

主要データフロー-1
from: Effect Executor
to: KIOSK SSE
用途: `speech.start -> speech.segment* -> speech.end` の順序送出
プロトコル: SSE（`/api/v1/kiosk/stream`）

主要データフロー-2
from: KIOSK
to: API Server
用途: セグメント単位TTS取得（並列プリフェッチ）
プロトコル: HTTP（`/api/v1/kiosk/tts`）

主要データフロー-3
from: LLM provider
to: Effect Executor
用途: Phase3でのstream delta受信
プロトコル: provider内部インターフェース（AsyncIterable）

### 3.2 API/イベント契約（追加）

- `kiosk.command.speech.start`
  - data: `{ utterance_id: string, chat_request_id: string }`
- `kiosk.command.speech.segment`
  - data: `{ utterance_id: string, chat_request_id: string, segment_index: number, text: string, is_last: boolean }`
- `kiosk.command.speech.end`
  - data: `{ utterance_id: string, chat_request_id: string }`

互換方針:

- 既存 `kiosk.command.speak` は削除しない（段階的移行）
- stop_outputは `speech.*` 系キューにも適用する

### 3.3 プロジェクト固有指標

固有指標-1
指標名: TTFA（最初の音が出るまで）
測定方法: PTT UPから最初の再生開始までを計測（本文なし）
目標値: Phase1: -10〜20%、Phase2: -20〜30%、Phase3: -30%以上（ベースライン比）
Before/After記録方法: ローカルベンチ + CIテストの時系列比較

固有指標-2
指標名: stop_output反映時間（p95）
測定方法: stop_output受信から再生停止までの時間
目標値: p95 <= 300ms（最終目標 200ms）
Before/After記録方法: テスト内メトリクスとログ（ID/時刻のみ）

固有指標-3
指標名: 順序整合
測定方法: `segment_index` の逆順/重複を検知
目標値: 0件
Before/After記録方法: unit/integrationテスト

---

## 4. Issue分割案

### 4.1 Issue一覧

Issue-1
番号: 128
Issue名: feat(ai): 低遅延音声パイプライン Phase1（文分割 speech.segment 送出）
概要: 非stream LLM前提で文分割し、`speech.*` コマンドを順序送出する
推定行数: 150-300行
依存: #119

Issue-2
番号: 129
Issue名: feat(web): 低遅延音声パイプライン Phase2（並列TTSプリフェッチ + FIFO再生）
概要: KIOSKでセグメントを並列取得し、`segment_index` 順に再生する
推定行数: 150-300行
依存: #128

Issue-3
番号: 130
Issue名: feat(server): 低遅延音声パイプライン Phase3（LLM stream + 逐次セグメント送出）
概要: providerにstream APIを追加し、deltaから文境界で早出しする
推定行数: 150-300行
依存: #129

### 4.2 依存関係図

- Issue 128 depends_on Issue 119
- Issue 129 depends_on Issue 128
- Issue 130 depends_on Issue 129

---

---

## 変更履歴

- 2026-02-20: v1.0 初版作成
- 2026-02-27: v1.1 全Issue完了確認（#128-#130, PR #137, #139, #146）、ステータスを Completed に変更

---

## 5. プロダクション品質設計

### 5.1 セキュリティ/データ最小化

- 音声/会話全文/STT全文は永続化しない
- メトリクスは `request_id`, `utterance_id`, `segment_index`, 時間(ms), 長さのみ扱い、本文は扱わない
- 例外ログにも本文を出さない

### 5.2 可用性/失敗時方針

- TTS timeout時は該当セグメントのみフォールバックし、全体停止を避ける
- reconnect時は `utterance_id + segment_index` で重複排除
- stop_output後は staleなin-flight結果を無視する
