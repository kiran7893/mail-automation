import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import type { CalendarProposal } from '../../shared/types';
import type { AppDatabase } from './database';
import type { GoogleAuthService } from './googleAuth';
import { nowIso } from './time';

export interface CalendarCreateResult {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
}

export function normalizeCalendarProposal(input: CalendarProposal): CalendarProposal {
  const timeZone = input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    ...input,
    attendees: Array.from(new Set(input.attendees.map((email) => email.trim()).filter(Boolean))),
    timeZone,
    needsCalendarInvite: input.needsCalendarInvite !== false,
  };
}

export class CalendarService {
  constructor(
    private readonly auth: GoogleAuthService,
    private readonly db: AppDatabase,
  ) {}

  async checkFreeBusy(proposal: CalendarProposal): Promise<{ busy: boolean; blocks: unknown[] }> {
    const normalized = normalizeCalendarProposal(proposal);
    const client = await this.auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: client });
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: normalized.start,
        timeMax: normalized.end,
        timeZone: normalized.timeZone,
        items: [{ id: 'primary' }],
      },
    });
    const blocks = response.data.calendars?.primary?.busy ?? [];
    return { busy: blocks.length > 0, blocks };
  }

  async createEvent(proposal: CalendarProposal): Promise<CalendarCreateResult> {
    const normalized = normalizeCalendarProposal(proposal);
    const client = await this.auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: client });
    const response = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      sendUpdates: 'all',
      requestBody: {
        summary: normalized.summary,
        description: normalized.description,
        attendees: normalized.attendees.map((email) => ({ email })),
        start: {
          dateTime: normalized.start,
          timeZone: normalized.timeZone,
        },
        end: {
          dateTime: normalized.end,
          timeZone: normalized.timeZone,
        },
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });
    await this.db.addAudit({
      id: randomUUID(),
      type: 'calendar.create',
      summary: `Created event: ${normalized.summary}`,
      data: {
        eventId: response.data.id,
        htmlLink: response.data.htmlLink,
        attendees: normalized.attendees,
      },
      createdAt: nowIso(),
    });
    return {
      id: response.data.id ?? undefined,
      htmlLink: response.data.htmlLink ?? undefined,
      hangoutLink: response.data.hangoutLink ?? undefined,
    };
  }
}
