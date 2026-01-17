# SQLite スキーマ / Housekeeping（MVP）

このドキュメントは、MVP における SQLite の **最小スキーマ** と **TTL 掃除（Housekeeping）** を固定します。  
データ方針（何を保存しないか/TTL 等）は `.specs/04_data_policy_and_memory_model.md` を正とします。

## 0) 位置づけ（決定）

- MVP は `pending/confirmed` を保存できることを最優先にする
- “子どもの識別”は MVP では **`PERSONAL(name)` の `name`（呼び名）**で代用する
  - `children` テーブル等の正規化は後続（NFC導入時に再設計）

## 1) DB ファイル（決定）

- DB パスは環境変数 `DB_PATH` で指定する
- 未指定の場合の既定値: `var/wooly-fluffy.sqlite3`（repo root からの相対）
- DB ファイルはコミットしない（`.gitignore` で除外する）

## 2) テーブル（決定）

### 2.1 `memory_items`

`pending/confirmed/rejected/deleted` を同一テーブルで表現する。

- `id` `TEXT`（UUID）PRIMARY KEY
- `personal_name` `TEXT` NOT NULL
- `kind` `TEXT` NOT NULL
  - 値: `likes | food | play | hobby`
- `value` `TEXT` NOT NULL
- `source_quote` `TEXT` NULL
  - `pending` の職員確認補助（任意の短い引用）。全文ログは保存しない
- `status` `TEXT` NOT NULL
  - 値: `pending | confirmed | rejected | deleted`
- `created_at_ms` `INTEGER` NOT NULL
- `updated_at_ms` `INTEGER` NOT NULL
- `expires_at_ms` `INTEGER` NULL

### 2.2 Indexes（決定）

- `idx_memory_items_status_created_at` on (`status`, `created_at_ms` DESC)
- `idx_memory_items_status_expires_at` on (`status`, `expires_at_ms`)
- `idx_memory_items_personal_status` on (`personal_name`, `status`)

## 3) 状態遷移（決定）

### 3.1 `pending` 作成

- 作成契機: Orchestrator が `STORE_WRITE_PENDING(...)` を発行した時
- 保存内容（最小）:
  - `status=pending`
  - `expires_at_ms = now + 24h`
  - `source_quote` は任意（短い補助）

### 3.2 STAFF Confirm

- `pending → confirmed`
- 更新内容:
  - `status=confirmed`
  - `expires_at_ms = NULL`（自動忘却しない）
  - `source_quote = NULL`（データ最小化）

### 3.3 STAFF Deny

- `pending → rejected`
- 更新内容:
  - `status=rejected`
  - `expires_at_ms = now + 24h`（短期で自動削除）
  - `source_quote = NULL`（データ最小化）

### 3.4 Delete（後続のための枠 / 決定）

- 物理削除（DELETE）は Housekeeping が行う
- UI/運用からの削除は、まずは `status=deleted`（ソフト削除）で表現し、`expires_at_ms` を設定して短期で物理削除する
  - 具体の UI/手順は後続で確定する

## 4) Housekeeping（決定）

### 4.1 対象

- `expires_at_ms` が設定されており、`expires_at_ms <= now` の行は物理削除する
  - 想定: `pending`（期限切れ）、`rejected`（短期保持後）、`deleted`（短期保持後）

### 4.2 実行タイミング

- Server 起動時に 1 回実行する
- 以後は定期実行する（例: 10分間隔）

## 5) 代表クエリ（決定）

- STAFF pending 一覧:
  - `status="pending"` を `created_at_ms DESC` で返す
- PERSONAL 想起（ChatProvider入力用）:
  - `status="confirmed"` かつ `personal_name=<name>` を返す（取得数上限は後続で確定）
