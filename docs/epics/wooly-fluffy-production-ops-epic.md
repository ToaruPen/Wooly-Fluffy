# Epic: Wooly-Fluffy 本番運用（単一オリジン + LaunchAgent）

---

## メタ情報

- 作成日: 2026-02-07
- 作成者: -
- ステータス: Draft
- 参照PRD: `docs/prd/wooly-fluffy.md`

---

## 1. 概要

### 1.1 目的

常設PC（Mac mini想定）上で、Wooly-Fluffy を **本番運用として「迷わず起動できる」**状態にする。

具体的には、

- ブラウザのアクセス先を **単一オリジン**（例: `http://<host>:3000/kiosk`）に統一する
- ログイン後に **自動起動**し、異常時は **自動再起動**する（macOS `launchd` LaunchAgent）
- STT/TTS/LLM が揃っていない場合は **中途半端に起動しない（fail-fast）**

を実現する。

### 1.2 スコープ

**含む:**

- API Server が `web/dist` を静的配信し、`/kiosk` `/staff` を同一オリジンで提供する
  - `/assets/*`（Vite build成果物）配信
  - SPAルーティング（`/kiosk` `/staff` の `index.html` フォールバック）
- 本番起動用の preflight と health gate
- preflight: 必須環境変数、ファイル存在/権限、外部依存（TTS Engine（VOICEVOX互換） / LLM）到達性
  - health gate: `GET /health` の provider 状態が **stt/tts/llm 全て ok** にならなければ起動失敗
- 外部依存（TTS Engine（VOICEVOX互換） / LLMサーバ等）は **本Epicのスクリプトで起動しない**
  - 期待: 外部依存は別手段で起動済みである
  - 未起動/到達不可の場合: preflight/health gate により fail-fast する
- 起動/更新の標準コマンド（`npm run ...` / `scripts/...`）整備
  - `prod:build`（更新時）
  - `prod:start`（常駐の起動エントリ）
- macOS LaunchAgent のテンプレ/インストール手順（ログイン後自動起動）
  - `~/Library/LaunchAgents/*.plist`
  - `launchctl bootstrap/kickstart` を用いた導線
- Runbook（本番機向けの手順書）
  - envファイルの配置（repo外）
  - DB/ログの配置（repo外）
  - トラブルシュート（providers 断、ポート競合、権限不足）

**含まない（PRDのスコープ外を継承 + 本Epicの対象外）:**

- whisper.cpp / TTS Engine（VOICEVOX互換）/ LM Studio 等の **導入手順の詳細整備**（既存READMEの「外部依存セットアップ」を参照。必要なら別Issue）
- TTS Engine（VOICEVOX互換）/ LLM サーバの **起動・常駐管理**（Docker起動/監視やLM Studio自動起動の設計は本Epicでは扱わない）
- インターネット公開（TLS/認証基盤/公開ホスティング）
- 新しい監査ログ要件（PRD Q6-6 は No）
- 会話本文/音声/STT全文の保存（PRDの非機能と矛盾するため）

### 1.3 PRD制約の確認

項目: 規模感
PRDの値: 小規模
Epic対応: 単一マシン・単一オリジン・単一サーバ中心を維持する（Web用の別常駐サーバを増やさない）

項目: 技術方針
PRDの値: シンプル優先
Epic対応: 追加の常駐コンポーネントは増やさず、OS標準の `launchd` で運用する（新規外部SaaSは追加しない）

項目: 既存言語/FW
PRDの値: Yes（TypeScript（Node.js LTS）+ React（Vite）+ SQLite）
Epic対応: 既存の Node/TS と Vite build の範囲で完結させる

項目: デプロイ先
PRDの値: Yes（常設PC（Mac mini想定）上でローカル稼働。KIOSK/STAFFは同一LAN内のブラウザから利用）
Epic対応: `HOST=0.0.0.0` で待ち受け、LAN内ブラウザから単一ポートへアクセスできるようにする

---

## 2. 必須提出物（3一覧）

### 2.1 外部サービス一覧

外部サービス-1
名称: TTS Engine（VOICEVOX互換）
用途: TTS（Serverが `/api/v1/kiosk/tts` の裏で呼び出す）
必須理由: 本番は「STT/TTS/LLMが揃っていないなら起動しない」の方針のため
代替案: 本番方針を緩めて「起動はするが音声出力は無効」とする（本Epicでは採用しない）
補足: TTS Engine の起動は別手段（アプリ/バイナリ/Docker等）で行い、本Epicは到達性チェックと fail-fast を提供する（既定: AivisSpeech Engine）

外部サービス-2
名称: LLM（OpenAI互換 API: LM Studio local または external provider）
用途: 会話生成 + 内側タスク + ツール呼び出し結果の統合
必須理由: 本番の主要ループ成立に必要（PRD「完成と言える状態」）
代替案: stub（開発のみ）。本番では禁止
補足: LLM サーバの起動は別手段で行い、本Epicは到達性チェックと fail-fast を提供する

外部サービス-3
名称: whisper.cpp（ローカル実行バイナリ + モデル）
用途: STT（Serverが subprocess で実行）
必須理由: 本番の主要ループ成立に必要
代替案: STT無し運用（本Epicでは採用しない）

### 2.2 コンポーネント一覧

コンポーネント-1
名称: API Server（Static Web配信を含む）
責務: `/api/v1/*` + `/health` + `web/dist` の静的配信（`/kiosk` `/staff`）
デプロイ形態: 常設PC上の単一プロセス（launchd配下で常駐）

コンポーネント-2
名称: Web Frontend（build artifact）
責務: KIOSK/STAFF UI（Vite build成果物として server が配信）
デプロイ形態: serverプロセスに同梱（`web/dist`）

### 2.3 新規技術一覧

新規技術-1
名称: macOS launchd（LaunchAgent）
カテゴリ: 運用/プロセス管理
既存との差: 新規導入
導入理由: ログイン後の自動起動・自動再起動を、追加サービス無しで実現する

---

## 3. 技術設計

### 3.1 アーキテクチャ概要

システム境界:

- 同一LANのブラウザ（KIOSK/STAFF）: `http://<host>:3000/kiosk|/staff` にアクセスし、SSE/HTTPでServerと通信する
- API Server: `/api/v1/*` を提供し、同一プロセスで `web/dist` を静的配信する
- OS（macOS）: `launchd` が Server プロセスを管理する

主要データフロー-1
from: Browser（KIOSK/STAFF）
to: API Server
用途: UI表示と操作（SSE購読、PTT、同意、pending確認）
プロトコル: HTTP + SSE

主要データフロー-2
from: API Server
to: TTS Engine（VOICEVOX互換）
用途: TTS生成
プロトコル: HTTP（localhost）

主要データフロー-3
from: API Server
to: LLM（local/external）
用途: chat / inner_task
プロトコル: HTTP（localhost）/ HTTPS

主要データフロー-4
from: API Server
to: whisper.cpp
用途: STT（subprocess）
プロトコル: exec + tmpfile（ただし永続保存しない）

### 3.2 技術選定

技術選定-1
カテゴリ: 配信方式（Web）
選択: API Server が `web/dist` を配信（単一オリジン）
理由: `web/` の API 呼び出しは `/api/v1/...` 相対パス前提であり、別オリジン運用（CORS/設定）を避けるため

技術選定-2
カテゴリ: 常駐起動
選択: LaunchAgent（`~/Library/LaunchAgents`）
理由: sudo不要で導入でき、ログイン後自動起動の要件に一致するため

技術選定-3
カテゴリ: 起動保証
選択: fail-fast（preflight + health gate）
理由: 本番は「一部だけ動く」を避け、運用者が問題を即座に検知できるようにするため

### 3.3 データモデル（概要）

本Epicでは新規の永続データモデルは追加しない。

ただし運用上の配置ルールを固定する:

- DB: `DB_PATH` は repo 外に配置する（例: `~/Library/Application Support/wooly-fluffy/wooly-fluffy.sqlite3`）
- 設定: envファイルを repo 外に配置する（例: `~/Library/Application Support/wooly-fluffy/env`）
- ログ: repo 外に出す（例: `~/Library/Logs/wooly-fluffy/`）

### 3.4 API設計（概要）

API-1
エンドポイント: `/kiosk`
メソッド: GET
説明: `web/dist/index.html` を返す（SPAのエントリ）

API-2
エンドポイント: `/staff`
メソッド: GET
説明: `web/dist/index.html` を返す（SPAのエントリ）

API-3
エンドポイント: `/assets/*`
メソッド: GET
説明: `web/dist/assets/*` を配信する

注記:

- `/api/v1/*` と `/health` は既存の仕様を維持する
- 静的配信はパストラバーサルを防止し、`web/dist` 外へ出られない

### 3.5 プロジェクト固有指標（任意）

固有指標-1
指標名: 本番起動の一貫性（fail-fast）
測定方法: 起動スクリプトの統合テスト（もしくはスモーク）で、依存未設定時に確実に非0終了することを確認
目標値: 依存（STT/TTS/LLM）のいずれかが unavailable の場合、起動は成功しない
Before/After記録方法: テスト結果 + Runbook記載

### 3.6 境界条件（異常系/リソース解放/レース）

対象境界:

- HTTP: `/kiosk`, `/staff`, `/assets/*`, `/api/v1/*`, `/health`
- OS: LaunchAgent（再起動、ログ出力、スロットリング）
- subprocess/file: whisper.cpp の tmpfile（残留しない）、`web/dist` ファイル読み込み

チェック項目:

- 入力不正: 静的配信のパス（`..` や `%2e%2e` 等）で dist 外へ出ない（常に 404/安全）
- タイムアウト/キャンセル:
  - preflight/health gate は必ずタイムバウンドで失敗する（ハングしない）
  - providers の health は既存のタイムアウト方針を尊重する
- リソース解放:
  - 起動失敗時に子プロセスが残らない（wrapperが存在する場合）
  - launchd の再起動で重複プロセスが残らない
- 運用上の安定性:
  - 依存未起動で fail-fast が続く場合でも、launchd が過剰再起動ループにならない（スロットリング/間隔を設定する）
- データ最小化:
  - preflight/ログに `STAFF_PASSCODE` や `LLM_API_KEY` を出さない
  - 会話本文/音声/STT全文をログに出さない（既存方針を維持）

---

## 4. Issue分割案

### 4.1 Issue一覧

Issue-1
番号: 1
Issue名: Server: `web/dist` 静的配信（単一オリジン）
概要: `/kiosk` `/staff` `/assets/*` を server が配信し、既存APIと干渉しないことをテストで固定する
推定行数: 200-400行
依存: -

Issue-2
番号: 2
Issue名: 本番起動: preflight + health gate（fail-fast）
概要: 依存（STT/TTS/LLM）が揃っていない場合に起動失敗する起動スクリプトと、必要な npm scripts を整備する
推定行数: 150-300行
依存: #1

Issue-3
番号: 3
Issue名: macOS LaunchAgent: install/uninstall + テンプレ + ログ配置
概要: `~/Library/LaunchAgents` への導入と、ログイン後自動起動・自動再起動を実現する（シークレットはrepo外）
推定行数: 150-300行
依存: #2

Issue-4
番号: 4
Issue名: Runbook: 本番機セットアップ/更新/トラブルシュート
概要: env/DB/log配置、更新手順、healthの見方、依存が落ちている場合の復旧手順を README に整理する
推定行数: 80-180行
依存: #3

### 4.2 依存関係図

依存関係（関係を1行ずつ列挙）:

- Issue 2 depends_on Issue 1
- Issue 3 depends_on Issue 2
- Issue 4 depends_on Issue 3

---

## 5. プロダクション品質設計（PRD Q6に応じて記載）

### 5.1 パフォーマンス設計（PRD Q6-7: Yesの場合必須）

PRD Q6-7: No

N/A（パフォーマンス要件なし）

### 5.2 セキュリティ設計（PRD Q6-5: Yesの場合必須）

PRD Q6-5: Yes

扱うデータ:

- `STAFF_PASSCODE`: 共有秘密（ログ出力禁止、repoコミット禁止）
- `LLM_API_KEY`（external / gemini_native）: 秘密（ログ出力禁止、repoコミット禁止）
- DB（SQLite）: 低センシティブ記憶（confirmed）

認証/認可:

- 認証方式: 共有パスコード + セッションCookie（既存）
- 認可モデル: STAFF系はLAN内限定 + セッション必須（既存）

対策チェックリスト:

- [ ] preflight/ログにシークレットを出さない
- [ ] DB/ログ/設定は repo 外に配置し、更新で露出しない
- [ ] `/api/v1/staff/*` は LAN 制限を維持する（`X-Forwarded-For` 等は信頼しない）
- [ ] 静的配信はパストラバーサルを防止する

### 5.3 観測性設計（PRD Q6-6: Yesの場合必須）

PRD Q6-6: No

N/A（監査ログ要件なし）

### 5.4 可用性設計（PRD Q6-8: Yesの場合必須）

PRD Q6-8: No

N/A（SLA/SLOなし。単機ローカル運用を前提）

---

## 6. リスクと対策

リスク-1
リスク: 外部依存（TTS Engine（VOICEVOX互換）/LLM/whisper.cpp）が落ちていて起動できない
影響度: 高
対策: preflight と `/health` ゲートで即時検知し、Runbook で復旧手順を固定する（launchd の過剰再起動を避ける設定も行う）

リスク-2
リスク: `web/dist` 配信の実装ミスで `/api` が壊れる、または静的配信が漏れる
影響度: 高
対策: ルーティング優先順位をテストで固定し、パストラバーサルをテストで防ぐ

リスク-3
リスク: 設定/DB が repo 配下に置かれ、更新で消える/漏れる
影響度: 高
対策: Runbook で repo 外配置を標準にし、起動スクリプトで明示的にパスを指定する

---

## 7. マイルストーン

Phase-1
フェーズ: Phase 1
完了条件: 単一オリジンで `/kiosk` `/staff` が表示でき、既存 `/api` と共存する
目標日: -

Phase-2
フェーズ: Phase 2
完了条件: preflight + health gate により、依存未設定で起動が成功しないことが担保される
目標日: -

Phase-3
フェーズ: Phase 3
完了条件: LaunchAgent でログイン後自動起動/自動再起動が成立し、Runbook が整備される
目標日: -

---

## 8. 技術方針別の制限チェック

### シンプル優先の場合

- [ ] 新規導入ライブラリが3以下（理想: 0。launchd はOS機能）
- [ ] 新規コンポーネント数が3以下（Webサーバを別で増やさない）
- [ ] 非同期基盤（キュー/イベントストリーム）を使用していない
- [ ] コンテナオーケストレーション（K8s等）を使用していない

### 共通チェック

- [ ] 必須提出物（外部サービス一覧/コンポーネント一覧/新規技術一覧）が揃っている

---

## 9. Unknown項目の確認（PRDから引き継ぎ）

Unknown-1
項目: 本番の providers 構成（LLM: local vs external、VRM/モーション資産の配置）
PRDの値: -
確認結果: 本Epicでは「単一オリジン + 常駐起動 + 起動ゲート」を固定し、providers の選択や資産そのものは env/運用手順で扱う

---

## 変更履歴

- 2026-02-07: v1.0 初版作成
