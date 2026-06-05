import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppDatabase } from '../main/services/database';
import type { ActionRecord, EmailAnalysis, EmailItem } from '../shared/types';

const timestamp = '2026-06-04T00:00:00.000Z';

const staleFallbackAnalysis: EmailAnalysis = {
  emailId: 'email-1',
  summary: 'r/StoryIdeas: I am not a writer but have a great story concept!',
  intent: 'reply',
  suggestedReplies: [
    {
      id: 'reply-1',
      actionId: 'action-1',
      title: 'Acknowledge',
      tone: 'professional',
      body: 'Thanks for reaching out.',
    },
  ],
  risks: [
    'LLM unavailable or returned invalid JSON; fallback suggestions were generated locally. [ { "expected": "object", "code": "invalid_type", "path": [ "calendarProposal" ], "message": "Invalid input: expected object, received null" } ]',
  ],
};

const staleEmail: EmailItem = {
  id: 'email-1',
  threadId: 'thread-1',
  messageId: '<email-1@example.com>',
  subject: 'Reddit notification',
  fromEmail: 'noreply@redditmail.com',
  to: ['me@example.com'],
  snippet: 'A new Reddit post needs review.',
  bodyText: 'A new Reddit post needs review.',
  status: 'analyzed',
  analysis: staleFallbackAnalysis,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const staleAction: ActionRecord = {
  id: 'action-1',
  kind: 'email_reply',
  sourceEmailId: staleEmail.id,
  status: 'pending',
  payload: {
    emailId: staleEmail.id,
    reply: staleFallbackAnalysis.suggestedReplies[0],
  },
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('AppDatabase migrations', () => {
  it('resets stale calendarProposal-null fallback analyses and cancels old no-reply reply actions', async () => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'mail-automation-db-'));
    const first = await AppDatabase.open(userDataPath);
    await first.upsertEmail(staleEmail);
    await first.createAction(staleAction);

    const reopened = await AppDatabase.open(userDataPath);
    const repairedEmail = reopened.getEmail(staleEmail.id);
    const repairedAction = reopened.getAction(staleAction.id);

    expect(repairedEmail?.status).toBe('new');
    expect(repairedEmail?.analysis).toBeUndefined();
    expect(repairedAction).toMatchObject({
      status: 'cancelled',
      error: 'Reply action cancelled because sender is a no-reply notification address.',
    });
  });
});
