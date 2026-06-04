import { app, shell } from 'electron';
import path from 'node:path';
import type { AuditEvent, LogsExportResult } from '../../shared/types';
import type { AppDatabase } from './database';

function timestampSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class LogService {
  constructor(private readonly db: AppDatabase) {}

  list(limit = 200): AuditEvent[] {
    return this.db.listAudit(limit);
  }

  async export(): Promise<LogsExportResult> {
    const filePath = path.join(
      app.getPath('downloads'),
      `mail-automation-audit-${timestampSuffix()}.json`,
    );
    const count = await this.db.exportAuditTo(filePath);
    shell.showItemInFolder(filePath);
    return { path: filePath, count };
  }

  async forgetContent(): Promise<void> {
    await this.db.forgetContent();
  }
}
