import { describe, expect, it, vi } from 'vitest';
import { ActionService } from '../main/services/actionService';
import { NO_REPLY_RISK } from '../main/services/noReply';
import type { ActionRecord, EmailAnalysis, EmailItem } from '../shared/types';

const noReplyEmail: EmailItem = {
  id: 'email-1',
  threadId: 'thread-1',
  messageId: '<email-1@example.com>',
  subject: 'Reddit notification',
  fromEmail: 'noreply@redditmail.com',
  to: ['me@example.com'],
  snippet: 'A new Reddit post needs review.',
  bodyText: 'A new Reddit post needs review.',
  status: 'new',
  createdAt: '2026-06-04T00:00:00.000Z',
  updatedAt: '2026-06-04T00:00:00.000Z',
};

const analysis: EmailAnalysis = {
  emailId: 'email-1',
  summary: 'A Reddit notification contains a story idea post.',
  intent: 'both',
  suggestedReplies: [
    {
      id: 'reply-1',
      title: 'Ask for details',
      tone: 'collaborative',
      body: 'Could you share more context?',
    },
  ],
  calendarProposal: {
    summary: 'Story discussion',
    description: 'Discuss the story idea.',
    attendees: ['person@example.com'],
    start: '2026-06-05T15:00:00.000Z',
    end: '2026-06-05T15:30:00.000Z',
    timeZone: 'UTC',
    needsCalendarInvite: true,
  },
  risks: [],
};

describe('ActionService approval idempotency', () => {
  it('returns already sent actions without sending again', async () => {
    const sentAction: ActionRecord = {
      id: 'action-1',
      kind: 'email_reply',
      sourceEmailId: 'email-1',
      status: 'sent',
      payload: {},
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
    };
    const db = {
      getAction: vi.fn(() => sentAction),
    };
    const gmail = {
      sendReply: vi.fn(),
    };
    const service = new ActionService(db as never, gmail as never, {} as never);

    await expect(service.approve('action-1')).resolves.toBe(sentAction);
    expect(gmail.sendReply).not.toHaveBeenCalled();
  });

  it('skips reply actions for no-reply senders while preserving calendar actions', async () => {
    const db = {
      createAction: vi.fn(async (action: ActionRecord) => action),
      setEmailAnalysis: vi.fn(),
      addAudit: vi.fn(),
    };
    const service = new ActionService(db as never, {} as never, {} as never);

    const result = await service.persistAnalysis(noReplyEmail, analysis);

    expect(db.createAction).toHaveBeenCalledTimes(1);
    expect(db.createAction.mock.calls[0][0]).toMatchObject({ kind: 'calendar_event' });
    expect(result.suggestedReplies[0].actionId).toBeUndefined();
    expect(result.calendarProposal?.actionId).toBe(db.createAction.mock.calls[0][0].id);
    expect(result.risks).toContain(NO_REPLY_RISK);
    expect(db.setEmailAnalysis.mock.calls[0][1]).toMatchObject({
      risks: expect.arrayContaining([NO_REPLY_RISK]),
    });
  });

  it('blocks edited replies to no-reply senders before creating actions', async () => {
    const db = {
      getEmail: vi.fn(() => noReplyEmail),
      createAction: vi.fn(),
    };
    const service = new ActionService(db as never, {} as never, {} as never);

    await expect(service.sendEditedReply(noReplyEmail.id, 'Thanks.')).rejects.toThrow(
      'Cannot send a reply to no-reply notification address',
    );
    expect(db.createAction).not.toHaveBeenCalled();
  });
});
