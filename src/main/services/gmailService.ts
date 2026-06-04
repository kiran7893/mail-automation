import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { simpleParser, type AddressObject } from 'mailparser';
import type { EmailItem, InboxRefreshResult } from '../../shared/types';
import type { AppDatabase } from './database';
import type { GoogleAuthService } from './googleAuth';
import { nowIso } from './time';

interface ParsedAddress {
  name?: string;
  address: string;
}

interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

export interface SendReplyPayload {
  emailId: string;
  body: string;
}

export function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

export function encodeBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string | undefined {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function firstAddress(addresses: ParsedAddress[] | undefined): ParsedAddress | null {
  return addresses?.find((address) => Boolean(address.address)) ?? null;
}

function addressValues(value: AddressObject | AddressObject[] | undefined): ParsedAddress[] {
  if (!value) return [];
  const objects = Array.isArray(value) ? value : [value];
  return objects
    .flatMap((object) => object.value)
    .filter((address) => Boolean(address.address))
    .map((address) => ({
      name: address.name,
      address: address.address as string,
    }));
}

function escapeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildReplyRaw(email: EmailItem, body: string): string {
  const subject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;
  const lines = [
    `To: ${escapeHeader(email.fromEmail)}`,
    `Subject: ${escapeHeader(subject)}`,
    ...(email.messageId ? [`In-Reply-To: ${escapeHeader(email.messageId)}`, `References: ${escapeHeader(email.messageId)}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    body.trim(),
  ];
  return encodeBase64Url(lines.join('\r\n'));
}

export class GmailService {
  constructor(
    private readonly auth: GoogleAuthService,
    private readonly db: AppDatabase,
  ) {}

  async refresh(query: string, maxResults: number): Promise<InboxRefreshResult> {
    const client = await this.auth.getClient();
    const gmail = google.gmail({ version: 'v1', auth: client });
    const result: InboxRefreshResult = {
      fetched: 0,
      inserted: 0,
      skipped: 0,
      errors: [],
    };

    const list = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = list.data.messages ?? [];
    result.fetched = messages.length;

    for (const message of messages) {
      if (!message.id) continue;
      if (this.db.hasEmail(message.id)) {
        result.skipped += 1;
        continue;
      }
      try {
        const fetched = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'raw',
        });
        const email = await this.parseMessage(
          message.id,
          fetched.data.threadId ?? message.threadId ?? message.id,
          fetched.data.raw ?? '',
          fetched.data.snippet ?? '',
          fetched.data.payload?.headers,
        );
        const inserted = await this.db.upsertEmail(email);
        result.inserted += inserted ? 1 : 0;
        await this.db.addAudit({
          id: randomUUID(),
          type: 'gmail.fetch',
          summary: `Fetched email: ${email.subject}`,
          data: { emailId: email.id, from: email.fromEmail },
          createdAt: nowIso(),
        });
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return result;
  }

  async sendReply(payload: SendReplyPayload): Promise<{ id?: string; threadId?: string }> {
    const email = this.db.getEmail(payload.emailId);
    if (!email) throw new Error(`Email not found: ${payload.emailId}`);
    const client = await this.auth.getClient();
    const gmail = google.gmail({ version: 'v1', auth: client });
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: buildReplyRaw(email, payload.body),
        threadId: email.threadId,
      },
    });
    await this.db.setEmailStatus(email.id, 'sent');
    await this.db.addAudit({
      id: randomUUID(),
      type: 'gmail.send',
      summary: `Sent reply to ${email.fromEmail}`,
      data: { emailId: email.id, gmailMessageId: response.data.id },
      createdAt: nowIso(),
    });
    return {
      id: response.data.id ?? undefined,
      threadId: response.data.threadId ?? undefined,
    };
  }

  private async parseMessage(
    id: string,
    threadId: string,
    raw: string,
    snippet: string,
    headers?: GmailHeader[],
  ): Promise<EmailItem> {
    const parsed = raw ? await simpleParser(decodeBase64Url(raw)) : null;
    const headerList = headers ?? [];
    const from = firstAddress(addressValues(parsed?.from));
    const to = addressValues(parsed?.to)
      ?.map((address) => address.address)
      .filter(Boolean) ?? [];
    const messageId = parsed?.messageId || getHeader(headerList, 'Message-ID');
    const subject = parsed?.subject || getHeader(headerList, 'Subject') || '(no subject)';
    const bodyText = parsed?.text?.trim() || parsed?.html?.toString().replace(/<[^>]+>/g, ' ').trim() || snippet;
    const timestamp = nowIso();
    return {
      id,
      threadId,
      messageId,
      subject,
      fromName: from?.name,
      fromEmail: from?.address || getHeader(headerList, 'From') || 'unknown@example.com',
      to,
      date: parsed?.date?.toISOString() || getHeader(headerList, 'Date'),
      snippet,
      bodyText,
      status: 'new',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
