# STAFF アクセス制御（MVP）

このドキュメントは、MVP における **STAFF UI / STAFF API の最小アクセス制御**を固定します。  
目的は「施設内の誤操作・いたずら・偶発的な露出」を避けることであり、強固なゼロトラストやインターネット公開はスコープ外です。

## 0) 位置づけ（決定）

- STAFF 画面/操作は **無保護にしない**
- MVP は「共有パスコード + 自動ロック + LAN 内限定」を最小ラインとする
- アカウント管理（個別ユーザー/権限分離）は後続

## 1) 前提（決定）

- STAFF は別端末ブラウザ（OS不問）からアクセスする（同一LAN）
- Server は常設PC上で稼働する
- HTTPS 終端や VPN は後続（MVP では必須にしない）

## 2) LAN 内限定（決定）

STAFF 系エンドポイントは、アクセス元 IP が次の範囲に属する場合のみ許可する。

- IPv4（Private）: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- IPv4（Loopback）: `127.0.0.0/8`
- IPv6（Local）: `::1`（loopback）, `fc00::/7`（ULA）, `fe80::/10`（link-local）

> これは「P2P（端末同士の直結）」ではなく、**サーバ中心のまま**“LAN外からの到達を弾く”ための制限。

### 2.1 Trust Proxy（決定）

- MVP では reverse proxy を前提にしない
- 原則として `X-Forwarded-For` 等は信頼せず、TCP 接続の実IP（サーバが観測する remote address）で判定する

## 3) 共有パスコード（決定）

- STAFF の共有パスコードは環境変数 `STAFF_PASSCODE` で与える（リポジトリにコミットしない）
- パスコードは STAFF 操作に必要で、KIOSK には要求しない

## 4) 認証セッション（決定）

### 4.1 ログイン

- `POST /api/v1/staff/auth/login`
  - request: `{ "passcode": string }`
  - success: `200 { "ok": true }` + セッション Cookie を付与
  - failure: `401 { "error": ... }`

### 4.2 セッションの提示

- 以後の STAFF API / STAFF SSE はセッション Cookie が必須

## 5) 自動ロック（決定）

- 自動ロックは **3分**（`180_000ms`）
- 「ロック」とは、以後の STAFF 操作ができず、再度パスコード入力が必要になること

### 5.1 “無操作”の定義（決定）

- “無操作” は STAFF UI 上のユーザー操作（キー入力/マウス/タップ等）が無い状態を指す
- 単に SSE が接続されている/画面が表示されているだけでは “操作” とみなさない

### 5.2 keepalive（決定）

STAFF UI は、ユーザー操作が継続している間だけ keepalive を送る（例: 30秒に1回、操作があった時にスケジュール）。

- `POST /api/v1/staff/auth/keepalive`
  - success: `200 { "ok": true }`
  - expired: `401 { "error": ... }`（UI はロックする）

> 自動ロックをサーバ側でも担保するために、keepalive が 3分 来なければセッションを失効させる。

### 5.3 失効時の挙動（決定）

- STAFF API は `401` を返す
- STAFF SSE は切断してよい（UI は再ログインを促す）

## 6) ログ方針（決定）

- 認証ログにパスコード本文を出さない
- 会話本文/音声/STT全文等をログに出さない（`.specs/01_principles.md`, `.specs/04_data_policy_and_memory_model.md` を正）
