import { describe, expect, it } from 'vitest';
import { normalizeCalendarProposal } from '../main/services/calendarService';

describe('normalizeCalendarProposal', () => {
  it('dedupes attendees and keeps invite intent enabled by default', () => {
    const proposal = normalizeCalendarProposal({
      summary: 'Project sync',
      description: '',
      attendees: ['a@example.com', 'a@example.com', ' b@example.com '],
      start: '2026-06-05T10:00:00+05:30',
      end: '2026-06-05T10:30:00+05:30',
      timeZone: 'Asia/Kolkata',
      needsCalendarInvite: true,
    });

    expect(proposal.attendees).toEqual(['a@example.com', 'b@example.com']);
    expect(proposal.needsCalendarInvite).toBe(true);
  });
});
