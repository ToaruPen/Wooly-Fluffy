# 意思決定記録（ADR）

プロジェクトの技術的・設計的意思決定を記録するドキュメント。

---

## テンプレート

```markdown
## ADR-[番号]: [タイトル]

### ステータス

提案 / 承認 / 却下 / 廃止

### 日付

YYYY-MM-DD

### コンテキスト

[なぜこの決定が必要になったか]

### 選択肢

#### 案A: [名前]

- 説明: [説明]
- メリット: [メリット]
- デメリット: [デメリット]

#### 案B: [名前]

- 説明: [説明]
- メリット: [メリット]
- デメリット: [デメリット]

### 決定

[どの案を採用したか]

### 理由

[なぜその案を選んだか]

### 影響

[この決定による影響]

### 参照

- PRD: [関連PRD]
- Epic: [関連Epic]
- Issue: [関連Issue]
```

---

## 意思決定一覧

ADR-1
タイトル: データ最小化（保存/ログ）方針
ステータス: 承認
日付: 2026-01-31

ADR-2
タイトル: 入力UX（PTTは職員操作、待機は無反応）
ステータス: 廃止（ADR-13により置換）
日付: 2026-01-31

ADR-3
タイトル: モード設計（ROOM/PERSONAL）と同意フロー
ステータス: 承認
日付: 2026-01-31

ADR-4
タイトル: Orchestratorを純粋ロジックとして固定（Event/Effect）
ステータス: 承認
日付: 2026-01-31

ADR-5
タイトル: RealtimeはSSEを採用し、WS移行可能なメッセージ形を維持
ステータス: 承認
日付: 2026-01-31

ADR-6
タイトル: STAFFアクセス制御（LAN内限定 + 共有パスコード + 自動ロック）
ステータス: 承認
日付: 2026-01-31

ADR-7
タイトル: SQLiteスキーマ（memory_items）とTTL Housekeeping
ステータス: 承認
日付: 2026-01-31

ADR-8
タイトル: 技術スタック（TS/React/Vite/SQLite）と一次情報URLの運用
ステータス: 承認
日付: 2026-01-31

ADR-9
タイトル: Provider Layer アセットのライセンスと帰属表記
ステータス: 承認
日付: 2026-02-01

ADR-10
タイトル: multipart/form-data の音声アップロード解析に busboy を採用
ステータス: 承認
日付: 2026-02-02

ADR-11
タイトル: Mixamoモーションはローカル運用の仮素材として採用し、rawファイルをリポジトリに含めない
ステータス: 承認
日付: 2026-02-05

ADR-12
タイトル: Geminiネイティブ structured outputs / function calling のために Google GenAI SDK（@google/genai）を採用
ステータス: 承認
日付: 2026-02-07

ADR-13
タイトル: 入力UX（KIOSK PTT許可）とSTAFFデバッグログ（表示/保存/ログ境界）
ステータス: 承認
日付: 2026-02-08

---

## ADR-1: データ最小化（保存/ログ）方針

### ステータス

承認

### 日付

2026-01-31

### コンテキスト

学童向けで未成年が主対象となり得るため、運用・安全・プライバシーの観点で「保存しない/ログに出さない」を強く固定する必要がある。
また、クラウド利用有無にかかわらず、実装境界としてデータ最小化を徹底する必要がある。

### 選択肢

#### 案A: 音声/会話全文/STT全文を保存しない（最小化）

- 説明: 永続するのは `confirmed`（低センシティブ）中心とし、音声・会話全文・STT全文は保存しない
- メリット: リスク低減、削除要求/監査対応が単純化、運用事故の影響範囲が縮小
- デメリット: デバッグ/改善が難しくなる（メトリクス/要約等で代替が必要）

#### 案B: デバッグのために保存する（期間限定など）

- 説明: 一定期間、音声/全文ログを保存する
- メリット: 原因調査が容易
- デメリット: リスクが大きく、運用/削除要求/漏えい時の影響が重大

### 決定

案Aを採用する。

### 理由

- 学童向けの運用前提に合致し、破綻しにくい
- 仕様・実装・運用の責務分界を明確にできる

### 影響

- ログにはパスコード/会話本文/音声/STT全文を出さない
- DBには `pending/confirmed` など必要最小の構造化データのみを保存する

### 参照

- PRD: `docs/prd/wooly-fluffy.md` セクション 6
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 3.3, 5.2

---

## ADR-2: 入力UX（PTTは職員操作、待機は無反応）

### ステータス

廃止（ADR-13により置換）

### 日付

2026-01-31

### コンテキスト

子どもが直接操作すると、誤操作/意図しない送信/責任分界の曖昧化が起きやすい。
現場で破綻しない運用のため、入力開始の責任を職員側に寄せる必要がある。

### 選択肢

#### 案A: PTT（hold-to-talk）は職員が操作する

- 説明: 待機中は無反応。PTT中のみ収録/送信する
- メリット: 誤送信を減らす。運用責任が明確
- デメリット: 職員の操作負担が増える

#### 案B: 子どもがKIOSKで録音開始できる

- 説明: KIOSK側の操作で収録を開始できる
- メリット: 職員の操作負担が減る
- デメリット: 誤送信/いたずら/運用事故のリスクが増える

### 決定

本ADRは ADR-13 により廃止（置換）する。最新の方針は ADR-13 を参照する。

### 理由

- （当時の理由）現場運用（見守り）に合致し、破綻しにくい
- （置換理由）職員操作負担と入力UX改善のため、KIOSK PTTを許可する方針に変更（ADR-13）

### 影響

- （廃止済み）入力UXの最新方針は ADR-13 を参照する

### 参照

- PRD: `docs/prd/wooly-fluffy.md` セクション 4
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 3.1

---

## ADR-13: 入力UX（KIOSK PTT許可）とSTAFFデバッグログ（表示/保存/ログ境界）

### ステータス

承認

### 日付

2026-02-08

### コンテキスト

- ADR-2 では「PTTは職員操作」を採用していたが、運用上の負担や入力UXの観点から、KIOSK側にも PTT（hold-to-talk）を設けたい。
- ADR-1 は「会話本文/STT全文を保存しない・ログに出さない」を強く固定している。一方で、運用時のトラブルシュートのため、STAFF画面にデバッグ情報の表示領域を置きたい。
- そのため「ログ（永続/外部出力）」と「画面表示（一時）」の線引きをSoTとして明文化する必要がある。

### 選択肢

#### 入力UX

#### 案A: PTTは職員のみ（ADR-2維持）

- 説明: 待機中は無反応。入力開始の責任を職員側に寄せる
- メリット: 誤操作/運用事故のリスクが下がる
- デメリット: 職員の操作負担が増える

#### 案B: KIOSKでもPTT可能（デフォルトON）

- 説明: KIOSKのPTT UIをデフォルト有効とし、子ども側の操作で hold-to-talk により収録/送信を開始できる
- メリット: 職員の操作負担が減り、体験が途切れにくい
- デメリット: 誤操作/いたずら/運用事故のリスクが上がる（ガード設計と運用前提の明文化が必要）

#### 案C: KIOSKでもPTT可能（デフォルトOFF）

- 説明: 明示設定時のみKIOSKのPTTを有効化する
- メリット: リスクを抑えつつ段階導入しやすい
- デメリット: 構成/設定の運用が必要

#### STAFFデバッグログ

#### 案D: メタ情報のみ表示（本文は表示しない）

- 説明: 成功/失敗、所要時間、tool名、件数などのメタ情報のみ表示する
- メリット: プライバシーリスクが低い
- デメリット: 原因調査に限界がある

#### 案E: DEV/明示設定時のみ本文表示（RAMのみ・永続化なし）

- 説明: DEV/明示設定時のみ、STAFF画面に会話本文/STT全文を一時表示できる（RAMのリングバッファ）。永続化せず、server consoleにも出さない
- メリット: 調査力とデータ最小化の両立
- デメリット: 実装と運用の条件分岐が増える

#### 案F: 常時本文表示（永続化なし）

- 説明: 常に本文を画面表示する（永続化はしない）
- メリット: いつでも調査できる
- デメリット: プライバシー/運用リスクが大きい

### 決定

- 入力UX: 案B（KIOSKでもPTT可能、デフォルトON）
- STAFFデバッグログ: 案E（DEV/明示設定時のみ本文表示。RAMのみ・永続化なし）
- ADR-2 は本ADRにより廃止（置換）する

### 理由

- 入力開始を職員に集中させる前提は運用上安全だが、操作負担が高く、体験の途切れに直結する。
- デバッグのための「保存」は避けたい（ADR-1）。一方で、現場で詰まった時に最低限の観測手段は必要であり、DEV/明示設定下の一時表示に限定することで両立を図る。

### 影響

- KIOSKはPTT UIをデフォルト有効とする。KIOSKとSTAFFはいずれも hold-to-talk（押下中のみ収録）を前提とする。入力手段は Space 長押し + 画面ボタンを想定する。
- STAFFは緊急停止を維持し、必要時に入力を中断できる。
- 「ログに出さない」（ADR-1）は維持する。ここでのログとは、server console 出力、ファイルログ、DB永続などの外部/永続出力を指す。
- 会話本文/STT全文をSTAFF画面に表示する場合は DEV/明示設定時のみとし、RAM上のリングバッファに限定する（永続化しない、server console にも出さない）。
  - 有効化条件: Webが開発モード（Viteの `import.meta.env.DEV === true` 相当） **かつ** `VITE_STAFF_DEBUG_SHOW_BODY` が有効（両方必須）。
    - `VITE_STAFF_DEBUG_SHOW_BODY` の扱い: `unset/0/false` は無効、`1/true` は有効。
  - 送信/表示の境界: 無効時はSTAFFデバッグ表示用の本文/STT全文（リングバッファ等）を生成・保持・送信しない（UIで隠すだけにしない）。有効時のみ一時データとして扱う。
  - 運用前提（本番）: プロダクション運用では開発ビルド（`import.meta.env.DEV` が真になる状態）を用いず、本文/STT全文の送信/表示は有効化しない（フラグが立っていても有効化しない）。
  - 保持範囲: サイズ/時間で上限を設け、再起動で消える一時データとする（永続化しない）。

### 参照

- PRD: `docs/prd/wooly-fluffy.md`
- ADR-1: データ最小化（保存/ログ）方針
- ADR-2: 入力UX（廃止）
- Issue: #80

---

## ADR-10: multipart/form-data の音声アップロード解析に busboy を採用

### ステータス

承認

### 日付

2026-02-02

### コンテキスト

`/api/v1/kiosk/stt-audio` は `multipart/form-data` で音声ファイル（WAV）を受け取る。
自前の簡易パーサ（バイト列検索）だと、境界文字列やヘッダ相当のパターンがバイナリ内に出現した場合に切り出しの誤りが起き得る。
運用上は稀でも、発生時の原因特定が難しく、子どもの体験（たまに失敗する）に直結する。

### 選択肢

#### 案A: 自前実装を継続（バイト列検索）

- 説明: 現状の `Buffer.indexOf` ベースの切り出しを維持する
- メリット: 依存追加が無い
- デメリット: バイナリ/境界条件に弱く、修正やテストの作り込みが必要

#### 案B: 実績のあるmultipartパーサを採用（busboy）

- 説明: `busboy` により `multipart/form-data` の解析を行う
- メリット: 実運用でよく使われるパーサに寄せられる。自前でRFC相当の境界処理を実装する無駄を避けられる
- デメリット: 依存が1つ増える

### 決定

案B（busboy）を採用する。

### 理由

- 追加依存よりも、誤実装/テスト不足による「たまに壊れる」不具合の方が運用コストが高い
- 仕様上、音声は永続保存しない（ADR-1）ため、入力の取り扱いは堅牢性を優先する

### 影響

- `server` に `busboy` 依存が追加される
- `/api/v1/kiosk/stt-audio` のmultipart解析は busboy ベースになる

### 参照

- PRD: `docs/prd/wooly-fluffy.md`
- Epic: `docs/epics/provider-layer-epic.md`
- Issue: #18
- busboy license: https://github.com/mscdex/busboy/blob/master/LICENSE

## ADR-3: モード設計（ROOM/PERSONAL）と同意フロー

### ステータス

承認

### 日付

2026-01-31

### コンテキスト

個人紐付けの保存を行わない `ROOM` と、低センシティブな記憶を扱う `PERSONAL(name)` を分離し、誤爆や過剰保存を防ぎたい。
また、子どもの意思表示を尊重しつつ、最終的な保存可否は職員が確定する必要がある。

### 決定

- `ROOM`（デフォルト）: 個人紐付けの保存をしない
- `PERSONAL(name)`: 音声で名乗って開始し、無操作300秒で `ROOM` に戻る
- 記憶保存の同意: 「覚えていい？」を提示し、30秒以内に `yes/no` で分岐
  - `no`: 破棄（`pending` を作らない）
  - `yes`: `pending` を作り、職員Confirmで `confirmed` にする

### 参照

- PRD: `docs/prd/wooly-fluffy.md` セクション 4, 5
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 3.5

---

## ADR-4: Orchestratorを純粋ロジックとして固定（Event/Effect）

### ステータス

承認

### 日付

2026-01-31

### コンテキスト

モード/同意/タイムアウト/フォールバックは仕様として壊れやすく、I/O実装に引きずられると検証が難しくなる。
純粋ロジックとして固定し、ユニットテストで担保したい。

### 決定

- Orchestratorは `event + now -> nextState + effects[]` の純粋関数として実装する
- 非決定的処理は InnerTask のスキーマ固定JSONで受け、検証して採用する

### 参照

- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 3.5

---

## ADR-5: RealtimeはSSEを採用し、WS移行可能なメッセージ形を維持

### ステータス

承認

### 日付

2026-01-31

### コンテキスト

KIOSK/STAFFの画面更新はPollingを前提にせず、状態とコマンドをリアルタイムに配信したい。
MVPでは導入コストの低いSSEを選びつつ、将来WebSocketへ移行できる形にしたい。

### 決定

- MVPのRealtimeはSSEを採用する
- メッセージは `type/seq/data` の封筒で統一し、transport（SSE/WS）に依存しない形を維持する

### 参照

- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 3.4

---

## ADR-6: STAFFアクセス制御（LAN内限定 + 共有パスコード + 自動ロック）

### ステータス

承認

### 日付

2026-01-31

### コンテキスト

STAFF画面/操作を無保護にすると、誤操作・いたずら・偶発的な露出のリスクが高い。
一方で、MVPでは強固なゼロトラストやインターネット公開はスコープ外とする。

### 決定

- STAFF系エンドポイントはLAN内からのみ許可する（remote addressベース）
- 認証は共有パスコード + セッションCookie
- 自動ロック（セッション失効）は3分
- Trust Proxyは行わず、`X-Forwarded-For` 等は信頼しない

### 参照

- PRD: `docs/prd/wooly-fluffy.md` セクション 6
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 5.2

---

## ADR-7: SQLiteスキーマ（memory_items）とTTL Housekeeping

### ステータス

承認

### 日付

2026-01-31

### コンテキスト

MVPでは `pending/confirmed` を最優先で成立させ、保存してよいものだけを保存できるようにしたい。
単機ローカル運用のため、SQLiteを採用する。

### 決定

- `memory_items` で `pending/confirmed/rejected/deleted` を表現する
- TTL掃除（Housekeeping）で `expires_at_ms <= now` を物理削除する

### 参照

- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 3.3

---

## ADR-8: 技術スタック（TS/React/Vite/SQLite）と一次情報URLの運用

### ステータス

承認

### 日付

2026-01-31

### コンテキスト

MVPを最短で成立させつつ、Provider（STT/TTS/LLM）を差し替えて検証できる構造にしたい。
また、依存追加/主要変更の判断根拠として、ライセンス/利用規約などの一次情報URLを残したい。

### 決定

- 本番中核は TypeScript（Node.js LTS）で実装する
- UIは React（Vite）を採用する
- 永続は SQLite を採用する
- ライセンス/規約は「解釈」ではなく「一次情報URL」を記録する（運用前に再確認する）

### 一次情報URL（抜粋）

App / DB / Kiosk:

- TypeScript: https://raw.githubusercontent.com/microsoft/TypeScript/main/LICENSE.txt
- Node.js: https://raw.githubusercontent.com/nodejs/node/main/LICENSE
- React: https://github.com/facebook/react/blob/main/LICENSE
- Vite: https://raw.githubusercontent.com/vitejs/vite/main/LICENSE
- Vitest: https://raw.githubusercontent.com/vitest-dev/vitest/main/LICENSE
- ESLint: https://raw.githubusercontent.com/eslint/eslint/main/LICENSE
- SQLite: https://sqlite.org/copyright.html
- better-sqlite3: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/LICENSE

STT:

- whisper.cpp: https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE
- OpenAI Audio API docs/pricing: https://platform.openai.com/docs/guides/speech-to-text , https://platform.openai.com/docs/pricing

TTS:

- AivisSpeech Engine LICENSE: https://raw.githubusercontent.com/Aivis-Project/AivisSpeech-Engine/master/LICENSE
- AivisSpeech Engine docs: https://github.com/Aivis-Project/AivisSpeech-Engine
- AivisHub Terms of Service（モデル配布/利用条件）: https://hub.aivis-project.com/terms-of-service
- VOICEVOX engine LICENSE（代替エンジン）: https://raw.githubusercontent.com/VOICEVOX/voicevox_engine/master/LICENSE
- VOICEVOX terms（代替エンジン）: https://voicevox.hiroshiba.jp/term/
- VOICEVOX Nemo terms（代替エンジン）: https://voicevox.hiroshiba.jp/nemo/term/

Local LLM:

- llama.cpp: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/LICENSE
- Ollama: https://raw.githubusercontent.com/ollama/ollama/main/LICENSE
- Qwen2.5 7B: https://huggingface.co/Qwen/Qwen2.5-7B/resolve/main/LICENSE

External LLM (Gemini native SDK):

- Google GenAI SDK (`@google/genai`): https://github.com/googleapis/js-genai/blob/main/LICENSE
- Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE

### 参照

- PRD: `docs/prd/wooly-fluffy.md` セクション 7
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 2.1, 3.2

---

## ADR-9: Provider Layer アセットのライセンスと帰属表記

### ステータス

承認

### 日付

2026-02-01

### コンテキスト

Provider Layer で利用する外部アセット（VRM モデル、whisper.cpp、TTS Engine（VOICEVOX互換）および音声モデル）について、ライセンス条件と帰属表記要件を明確にする必要がある。
TTS はエンジン/モデルの組み合わせで条件が変わり得るため、運用前に一次情報URLを再確認し、最新の規約に従う必要がある。

### 選択肢

#### 案A: 一次情報URLのみを記録し、解釈は運用前に再確認する

- 説明: ADR-8 の方針に従い、ライセンス/規約の一次情報URLを記録し、解釈や要約は含めない
- メリット: 情報の正確性が保たれ、運用前に最新の規約を確認できる
- デメリット: 都度確認が必要

#### 案B: ライセンス全文をコピーして記録する

- 説明: ライセンス全文をドキュメントに含める
- メリット: オフラインでも参照可能
- デメリット: 更新時の同期が困難、ドキュメントが肥大化

### 決定

案Aを採用する。

### 理由

- ADR-8 で確立した「一次情報URLの運用」方針と一貫性がある
- ライセンス/規約の変更に対して柔軟に対応できる
- 運用前の再確認フローを強制できる

### 影響

- VRM、whisper.cpp、TTS Engine（VOICEVOX互換）および音声モデル配布/利用規約の一次情報URLを記録する
- 運用前にこれらのURLを再確認し、最新の規約に従う必要がある

### 一次情報URL

VRM:

- VRM CC0 ライセンス: https://vroid.pixiv.help/hc/en-us/articles/4402614652569

Web (VRM rendering):

- three.js LICENSE: https://github.com/mrdoob/three.js/blob/dev/LICENSE
- @pixiv/three-vrm LICENSE: https://github.com/pixiv/three-vrm/blob/dev/LICENSE

whisper.cpp:

- whisper.cpp LICENSE: https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE

TTS（VOICEVOX互換）:

- AivisSpeech Engine LICENSE: https://raw.githubusercontent.com/Aivis-Project/AivisSpeech-Engine/master/LICENSE
- AivisSpeech Engine docs: https://github.com/Aivis-Project/AivisSpeech-Engine
- AivisHub Terms of Service（モデル配布/利用条件）: https://hub.aivis-project.com/terms-of-service
- VOICEVOX 利用規約（代替エンジン）: https://voicevox.hiroshiba.jp/term/

### 参照

- ADR-8: 一次情報URLの運用
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 2.1（技術スタック）

---

## ADR-11: Mixamoモーションはローカル運用の仮素材として採用し、rawファイルをリポジトリに含めない

### ステータス

承認

### 日付

2026-02-05

### コンテキスト

KIOSKのリアリティ（待機モーション/しぐさ）を早期に検証したい。
一方で、モーション資産のライセンスや「rawファイルの再配布」リスクを避け、運用事故（誤コミット/公開）を防ぐ必要がある。

### 選択肢

#### 案A: Mixamoを仮素材として使用（ローカル運用のみ、rawはリポジトリ外）

- 説明: Mixamoのモーションを選定し、VRM向け（VRMA等）に変換してローカル配置で利用する。リポジトリにrawファイル（FBX/VRMA等）を含めない。
- メリット: 早く検証できる、バリエーションを揃えやすい
- デメリット: 将来の公開/配布形態によっては差し替えが必要になる

#### 案B: CC0/OSS素材のみを採用

- 説明: 最初からCC0/OSSのモーション素材のみで構成する
- メリット: 将来の公開/配布にもそのまま使いやすい
- デメリット: 素材探索/選定に時間がかかりやすい

### 決定

案Aを採用する。

### 理由

- 当面はローカル運用のみの前提であり、早期検証を優先する
- rawファイルをリポジトリに含めない運用ルールにより、再配布/公開の事故を抑制できる
- 将来公開する場合でも、`motion_id` 許可リスト + 変換パイプラインを維持して差し替え可能にする

### 影響

- Mixamo由来のrawファイル（FBX/VRMA等）はgit管理しない（コミット/公開しない）
- KIOSKは `motion_id` の許可リスト運用とし、未知の `motion_id` は安全に無視する
- 変換/配置/手動テスト手順をEpic/Issueに記録し、再現可能にする

### 参照

- PRD: `docs/prd/wooly-fluffy.md`
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md`（Server->KIOSK: `kiosk.command.play_motion`）
- Epic: `docs/epics/provider-layer-epic.md`（芸事/許可リスト）
- Issue: #38（Mixamo motion playback PoC）
- Mixamo FAQ: https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775

---

## ADR-12: Geminiネイティブ structured outputs / function calling のために Google GenAI SDK（@google/genai）を採用

### ステータス

承認

### 日付

2026-02-07

### コンテキスト

外部LLMとして Gemini 2.5 Flash-Lite を利用し、出力の安定性とコスト最適化を行いたい。
合わせて、PRD/Epicで求められる「構造化出力（JSON）」「ツール呼び出し（許可リスト）」を、API仕様変更に強い形で実装・保守したい。

### 選択肢

#### 案A: REST を自前実装（`fetch` 直叩き）

- 説明: Gemini Developer API の REST を `fetch` で直接呼ぶ。structured outputs / function calling のループも自前で構築する。
- メリット: 依存追加が不要、挙動の完全制御が可能
- デメリット: リクエスト/レスポンス構造の追従が必要、メンテ負荷が高くなりやすい

#### 案B: 公式SDK（Google GenAI SDK: `@google/genai`）を採用

- 説明: Gemini Developer API を公式SDKで呼び出す。structured outputs / function calling の表現・型を公式に寄せる。
- メリット: 公式ドキュメント/サンプルと一致し、API更新追従のコストが下がる。Abort（キャンセル）などの実装も一貫しやすい
- デメリット: 追加依存が増える（脆弱性/監査対応が必要）

### 決定

案Bを採用する。

### 理由

- structured outputs / function calling を「仕様どおり」「将来の変更に強く」実装する必要がある
- 公式ドキュメントで Google GenAI SDK が推奨（GA）されている
- Provider層は境界であり、依存追加の必然性が説明できる

### 影響

- server に `@google/genai` を追加し、`LLM_PROVIDER_KIND=gemini_native` をサポートする
- `@google/genai` は optional peer dependencies（MCP）等の型参照があるため、`@modelcontextprotocol/sdk` を dev dependency として追加する
- 依存側の ESM/CJS 混在を TypeScript が正しく解決できるよう、`server/tsconfig.json` は `module/moduleResolution: NodeNext` を採用する（自前コードは strict のまま型チェックする）
- `LLM_API_KEY`（または `GEMINI_API_KEY` / `GOOGLE_API_KEY`）をサーバ側に安全に配置する（ログ/コミット禁止）
- 既存の OpenAI互換 provider（LM Studio / 外部OpenAI互換）も継続サポートする

### 参照

- PRD: `docs/prd/wooly-fluffy.md`
- Epic: `docs/epics/provider-layer-epic.md`（LLM Provider / 構造化出力 / ツール呼び出し）
- Gemini API Libraries: https://ai.google.dev/gemini-api/docs/libraries
- Gemini API Structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini API Function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini API OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
