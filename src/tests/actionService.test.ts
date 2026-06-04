import { describe, expect, it, vi } from 'vitest';
import { ActionService } from '../main/services/actionService';
import type { ActionRecord } from '../shared/types';

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
});
