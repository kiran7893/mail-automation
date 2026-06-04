import { describe, expect, it } from 'vitest';
import type { EmailItem } from '../shared/types';
import { buildReplyRaw, decodeBase64Url } from '../main/services/gmailService';

const email: EmailItem = {
  id: 'gmail-1',
  threadId: 'thread-1',
  messageId: '<original@example.com>',
  subject: 'Meeting',
  fromEmail: 'sender@example.com',
  to: ['me@example.com'],
  snippet: 'Can we meet?',
  bodyText: 'Can we meet?',
  status: 'new',
  createdAt: '2026-06-04T00:00:00.000Z',
  updatedAt: '2026-06-04T00:00:00.000Z',
};

describe('buildReplyRaw', () => {
  it('builds a threaded RFC 2822 reply', () => {
    const decoded = decodeBase64Url(buildReplyRaw(email, 'Works for me.')).toString('utf8');
    expect(decoded).toContain('To: sender@example.com');
    expect(decoded).toContain('Subject: Re: Meeting');
    expect(decoded).toContain('In-Reply-To: <original@example.com>');
    expect(decoded).toContain('Works for me.');
  });
});
