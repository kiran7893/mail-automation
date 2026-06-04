import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import type {
  ActionRecord,
  ActionStatus,
  AuditEvent,
  EmailAnalysis,
  EmailItem,
  EmailStatus,
} from '../../shared/types';
import { safeJsonParse, toJson } from './json';
import { nowIso } from './time';

interface EmailRow {
  id: string;
  thread_id: string;
  message_id: string | null;
  subject: string;
  from_name: string | null;
  from_email: string;
  to_json: string;
  date: string | null;
  snippet: string;
  body_text: string;
  status: EmailStatus;
  analysis_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ActionRow {
  id: string;
  kind: ActionRecord['kind'];
  source_email_id: string | null;
  status: ActionStatus;
  payload_json: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}

interface AuditRow {
  id: string;
  action_id: string | null;
  type: string;
  summary: string;
  data_json: string | null;
  created_at: string;
}

let sqlModulePromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlModulePromise) {
    sqlModulePromise = initSqlJs({
      locateFile: (file: string) => path.join(process.cwd(), 'node_modules/sql.js/dist', file),
    });
  }
  return sqlModulePromise;
}

function rows<T>(db: Database, sql: string, params: SqlValue[] = []): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    return out;
  } finally {
    stmt.free();
  }
}

function first<T>(db: Database, sql: string, params: SqlValue[] = []): T | null {
  return rows<T>(db, sql, params)[0] ?? null;
}

function mapEmail(row: EmailRow): EmailItem {
  return {
    id: row.id,
    threadId: row.thread_id,
    messageId: row.message_id ?? undefined,
    subject: row.subject,
    fromName: row.from_name ?? undefined,
    fromEmail: row.from_email,
    to: safeJsonParse<string[]>(row.to_json, []),
    date: row.date ?? undefined,
    snippet: row.snippet,
    bodyText: row.body_text,
    status: row.status,
    analysis: safeJsonParse<EmailAnalysis | undefined>(row.analysis_json, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAction(row: ActionRow): ActionRecord {
  return {
    id: row.id,
    kind: row.kind,
    sourceEmailId: row.source_email_id ?? undefined,
    status: row.status,
    payload: safeJsonParse(row.payload_json, {}),
    result: safeJsonParse(row.result_json, undefined),
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at ?? undefined,
  };
}

function mapAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    actionId: row.action_id ?? undefined,
    type: row.type,
    summary: row.summary,
    data: safeJsonParse(row.data_json, undefined),
    createdAt: row.created_at,
  };
}

export class AppDatabase {
  private db!: Database;

  private constructor(private readonly dbPath: string) {}

  static async open(userDataPath = app.getPath('userData')): Promise<AppDatabase> {
    const dbPath = path.join(userDataPath, 'mail-automation.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const SQL = await loadSqlJs();
    let db: Database;
    try {
      const bytes = await fs.readFile(dbPath);
      db = new SQL.Database(bytes);
    } catch {
      db = new SQL.Database();
    }
    const store = new AppDatabase(dbPath);
    store.db = db;
    store.migrate();
    await store.save();
    return store;
  }

  listEmails(limit = 50): EmailItem[] {
    return rows<EmailRow>(
      this.db,
      'SELECT * FROM email_items ORDER BY COALESCE(date, created_at) DESC LIMIT ?',
      [limit],
    ).map(mapEmail);
  }

  getEmail(id: string): EmailItem | null {
    const row = first<EmailRow>(this.db, 'SELECT * FROM email_items WHERE id = ?', [id]);
    return row ? mapEmail(row) : null;
  }

  hasEmail(id: string): boolean {
    return Boolean(first<{ id: string }>(this.db, 'SELECT id FROM email_items WHERE id = ?', [id]));
  }

  async upsertEmail(email: EmailItem): Promise<boolean> {
    const existed = this.hasEmail(email.id);
    const timestamp = nowIso();
    this.db.run(
      `INSERT INTO email_items (
        id, thread_id, message_id, subject, from_name, from_email, to_json, date,
        snippet, body_text, status, analysis_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thread_id = excluded.thread_id,
        message_id = excluded.message_id,
        subject = excluded.subject,
        from_name = excluded.from_name,
        from_email = excluded.from_email,
        to_json = excluded.to_json,
        date = excluded.date,
        snippet = excluded.snippet,
        body_text = excluded.body_text,
        updated_at = excluded.updated_at`,
      [
        email.id,
        email.threadId,
        email.messageId ?? null,
        email.subject,
        email.fromName ?? null,
        email.fromEmail,
        toJson(email.to),
        email.date ?? null,
        email.snippet,
        email.bodyText,
        email.status,
        email.analysis ? toJson(email.analysis) : null,
        email.createdAt || timestamp,
        timestamp,
      ],
    );
    await this.save();
    return !existed;
  }

  async setEmailAnalysis(id: string, analysis: EmailAnalysis): Promise<void> {
    this.db.run(
      'UPDATE email_items SET status = ?, analysis_json = ?, updated_at = ? WHERE id = ?',
      ['analyzed', toJson(analysis), nowIso(), id],
    );
    await this.save();
  }

  async setEmailStatus(id: string, status: EmailStatus): Promise<void> {
    this.db.run('UPDATE email_items SET status = ?, updated_at = ? WHERE id = ?', [
      status,
      nowIso(),
      id,
    ]);
    await this.save();
  }

  listActions(status?: ActionStatus): ActionRecord[] {
    const sql = status
      ? 'SELECT * FROM actions WHERE status = ? ORDER BY created_at DESC'
      : 'SELECT * FROM actions ORDER BY created_at DESC';
    const params = status ? [status] : [];
    return rows<ActionRow>(this.db, sql, params).map(mapAction);
  }

  getAction(id: string): ActionRecord | null {
    const row = first<ActionRow>(this.db, 'SELECT * FROM actions WHERE id = ?', [id]);
    return row ? mapAction(row) : null;
  }

  async createAction(action: ActionRecord): Promise<ActionRecord> {
    this.db.run(
      `INSERT INTO actions (
        id, kind, source_email_id, status, payload_json, result_json, error,
        created_at, updated_at, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        action.id,
        action.kind,
        action.sourceEmailId ?? null,
        action.status,
        toJson(action.payload),
        action.result ? toJson(action.result) : null,
        action.error ?? null,
        action.createdAt,
        action.updatedAt,
        action.approvedAt ?? null,
      ],
    );
    await this.save();
    return action;
  }

  async updateAction(
    id: string,
    patch: Partial<Pick<ActionRecord, 'status' | 'result' | 'error' | 'approvedAt' | 'payload'>>,
  ): Promise<ActionRecord | null> {
    const current = this.getAction(id);
    if (!current) return null;
    const next: ActionRecord = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    this.db.run(
      `UPDATE actions SET
        status = ?, payload_json = ?, result_json = ?, error = ?, updated_at = ?, approved_at = ?
      WHERE id = ?`,
      [
        next.status,
        toJson(next.payload),
        next.result ? toJson(next.result) : null,
        next.error ?? null,
        next.updatedAt,
        next.approvedAt ?? null,
        id,
      ],
    );
    await this.save();
    return next;
  }

  async addAudit(event: AuditEvent): Promise<void> {
    this.db.run(
      'INSERT INTO audit_events (id, action_id, type, summary, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        event.id,
        event.actionId ?? null,
        event.type,
        event.summary,
        event.data ? toJson(event.data) : null,
        event.createdAt,
      ],
    );
    await this.save();
  }

  listAudit(limit = 200): AuditEvent[] {
    return rows<AuditRow>(
      this.db,
      'SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?',
      [limit],
    ).map(mapAudit);
  }

  async forgetContent(): Promise<void> {
    this.db.run("UPDATE email_items SET snippet = '', body_text = '', analysis_json = NULL, updated_at = ?", [
      nowIso(),
    ]);
    this.db.run("UPDATE actions SET payload_json = '{}', result_json = NULL, error = NULL, updated_at = ?", [
      nowIso(),
    ]);
    this.db.run('UPDATE audit_events SET data_json = NULL');
    await this.save();
  }

  async exportAuditTo(filePath: string): Promise<number> {
    const events = this.listAudit(10000);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
    return events.length;
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS email_items (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        message_id TEXT,
        subject TEXT NOT NULL,
        from_name TEXT,
        from_email TEXT NOT NULL,
        to_json TEXT NOT NULL,
        date TEXT,
        snippet TEXT NOT NULL,
        body_text TEXT NOT NULL,
        status TEXT NOT NULL,
        analysis_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_email_id TEXT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        action_id TEXT,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        data_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_email_items_status ON email_items(status);
      CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
      CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
    `);
  }

  private async save(): Promise<void> {
    const bytes = this.db.export();
    await fs.writeFile(this.dbPath, Buffer.from(bytes));
  }
}
