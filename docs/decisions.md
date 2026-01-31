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
ステータス: 承認
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

承認

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

案Aを採用する。

### 理由

- 現場運用（見守り）に合致し、破綻しにくい

### 影響

- KIOSKは子どもの入力で収録/送信を開始しない

### 参照

- PRD: `docs/prd/wooly-fluffy.md` セクション 4
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 3.1

---

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
- VOICEVOX engine LICENSE: https://raw.githubusercontent.com/VOICEVOX/voicevox_engine/master/LICENSE
- VOICEVOX terms: https://voicevox.hiroshiba.jp/term/
- VOICEVOX Nemo terms: https://voicevox.hiroshiba.jp/nemo/term/

Local LLM:
- llama.cpp: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/LICENSE
- Ollama: https://raw.githubusercontent.com/ollama/ollama/main/LICENSE
- Qwen2.5 7B: https://huggingface.co/Qwen/Qwen2.5-7B/resolve/main/LICENSE

### 参照

- PRD: `docs/prd/wooly-fluffy.md` セクション 7
- Epic: `docs/epics/wooly-fluffy-mvp-epic.md` セクション 2.1, 3.2
