import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

type SessionSummaryStatus = "pending" | "confirmed";
type SessionSummaryTrigger = "idle";

type SessionSummaryItem = {
  id: string;
  schema_version: number;
  trigger: SessionSummaryTrigger;
  title: string;
  summary_json: unknown;
  status: SessionSummaryStatus;
  created_at_ms: number;
  updated_at_ms: number;
  expires_at_ms: number | null;
};

type PendingSessionSummaryItem = {
  id: string;
  schema_version: number;
  trigger: SessionSummaryTrigger;
  title: string;
  summary_json: unknown;
  status: "pending";
  created_at_ms: number;
  expires_at_ms: number;
};

type Store = {
  createPendingSessionSummary: (input: { title: string; summary_json: unknown }) => string;
  getSessionSummaryById: (id: string) => SessionSummaryItem | null;
  listPendingSessionSummaries: () => PendingSessionSummaryItem[];
  confirmSessionSummary: (id: string) => boolean;
  denySessionSummary: (id: string) => boolean;
  housekeepExpiredSessionSummaries: () => number;
  close: () => void;
};

type CreateStoreOptions = {
  db_path: string;
  now_ms?: () => number;
  id_factory?: () => string;
};

const WEEK_MS = 86_400_000 * 7;

const schemaSql = `
CREATE TABLE IF NOT EXISTS session_summary_items (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed')),
  title TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('idle')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NULL,
  CHECK (
    (status = 'pending' AND expires_at_ms IS NOT NULL) OR
    (status = 'confirmed' AND expires_at_ms IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_session_summary_items_status_created_at
  ON session_summary_items (status, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_session_summary_items_status_expires_at
  ON session_summary_items (status, expires_at_ms);
`;

export const createStore = (options: CreateStoreOptions): Store => {
  const nowMs = options.now_ms ?? (() => Date.now());
  const idFactory = options.id_factory ?? (() => randomUUID());

  const db = new Database(options.db_path);
  db.exec(schemaSql);

  const insertPendingSessionSummary = db.prepare(
    `INSERT INTO session_summary_items (
      id,
      status,
      title,
      summary_json,
      trigger,
      schema_version,
      created_at_ms,
      updated_at_ms,
      expires_at_ms
    ) VALUES (
      @id,
      'pending',
      @title,
      @summary_json,
      'idle',
      @schema_version,
      @created_at_ms,
      @updated_at_ms,
      @expires_at_ms
    )`,
  );

  const listPendingSessionSummariesStmt = db.prepare(
    `SELECT
      id,
      schema_version,
      trigger,
      title,
      summary_json,
      created_at_ms,
      expires_at_ms
    FROM session_summary_items
    WHERE status = 'pending' AND expires_at_ms IS NOT NULL
    ORDER BY created_at_ms DESC`,
  );

  const getSessionSummaryByIdStmt = db.prepare(
    `SELECT
      id,
      schema_version,
      trigger,
      title,
      summary_json,
      status,
      created_at_ms,
      updated_at_ms,
      expires_at_ms
    FROM session_summary_items
    WHERE id = @id`,
  );

  const confirmSessionSummaryStmt = db.prepare(
    `UPDATE session_summary_items
    SET
      status = 'confirmed',
      updated_at_ms = @updated_at_ms,
      expires_at_ms = NULL
    WHERE id = @id AND status = 'pending'`,
  );

  const denySessionSummaryStmt = db.prepare(
    `DELETE FROM session_summary_items
    WHERE id = @id AND status = 'pending'`,
  );

  const deleteExpiredSessionSummariesStmt = db.prepare(
    `DELETE FROM session_summary_items
    WHERE status = 'pending' AND expires_at_ms IS NOT NULL AND expires_at_ms <= @now_ms`,
  );

  const parseDbJson = (value: string): unknown => JSON.parse(value) as unknown;

  const serializeSummaryJson = (value: unknown): string => {
    const s = JSON.stringify(value);
    if (typeof s !== "string") {
      throw new Error("summary_json must be JSON-serializable");
    }
    return s;
  };

  return {
    createPendingSessionSummary: (input) => {
      const now = nowMs();
      const id = idFactory();
      insertPendingSessionSummary.run({
        id,
        title: input.title,
        summary_json: serializeSummaryJson(input.summary_json),
        schema_version: 1,
        created_at_ms: now,
        updated_at_ms: now,
        expires_at_ms: now + WEEK_MS,
      });
      return id;
    },

    listPendingSessionSummaries: () => {
      const rows = listPendingSessionSummariesStmt.all() as Array<{
        id: string;
        schema_version: number;
        trigger: SessionSummaryTrigger;
        title: string;
        summary_json: string;
        created_at_ms: number;
        expires_at_ms: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        schema_version: row.schema_version,
        trigger: row.trigger,
        title: row.title,
        summary_json: parseDbJson(row.summary_json),
        status: "pending" as const,
        created_at_ms: row.created_at_ms,
        expires_at_ms: row.expires_at_ms,
      }));
    },

    getSessionSummaryById: (id) => {
      const row = getSessionSummaryByIdStmt.get({ id }) as
        | {
            id: string;
            schema_version: number;
            trigger: SessionSummaryTrigger;
            title: string;
            summary_json: string;
            status: SessionSummaryStatus;
            created_at_ms: number;
            updated_at_ms: number;
            expires_at_ms: number | null;
          }
        | undefined;
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        schema_version: row.schema_version,
        trigger: row.trigger,
        title: row.title,
        summary_json: parseDbJson(row.summary_json),
        status: row.status,
        created_at_ms: row.created_at_ms,
        updated_at_ms: row.updated_at_ms,
        expires_at_ms: row.expires_at_ms,
      };
    },

    confirmSessionSummary: (id) => {
      const now = nowMs();
      const res = confirmSessionSummaryStmt.run({ id, updated_at_ms: now });
      return res.changes === 1;
    },

    denySessionSummary: (id) => {
      const res = denySessionSummaryStmt.run({ id });
      return res.changes === 1;
    },

    housekeepExpiredSessionSummaries: () => {
      const now = nowMs();
      const res = deleteExpiredSessionSummariesStmt.run({ now_ms: now });
      return res.changes;
    },

    close: () => {
      db.close();
    },
  };
};
