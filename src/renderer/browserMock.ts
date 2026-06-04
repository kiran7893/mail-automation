import type { MailAssistantApi } from '../preload';
import type { AppSettings, AuditEvent, EmailItem } from '../shared/types';

const demoSettings: AppSettings = {
  appName: 'Mail Automation',
  logLevel: 'info',
  enabled: true,
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
  },
  google: {
    clientId: '',
    clientSecret: '',
    gmailScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    calendarScopes: [
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/calendar.events',
    ],
  },
  mailPollIntervalSeconds: 60,
  mailGmailQuery: 'in:inbox newer_than:14d -category:promotions -category:social',
  maxEmailsPerPoll: 10,
  actionRequireApproval: true,
  auditLogRetentionDays: 90,
};

const demoEmail: EmailItem = {
  id: 'demo-email',
  threadId: 'demo-thread',
  messageId: '<demo@example.com>',
  subject: 'Quarterly planning sync',
  fromName: 'Santosh',
  fromEmail: 'santosh@example.com',
  to: ['me@example.com'],
  date: new Date().toISOString(),
  snippet: 'Can we lock a planning sync tomorrow afternoon?',
  bodyText:
    'Can we lock a planning sync tomorrow afternoon? I want to review the email automation prototype, align on calendar approval behavior, and confirm what should be logged before sending anything.',
  status: 'analyzed',
  analysis: {
    emailId: 'demo-email',
    summary:
      'Santosh wants to schedule a planning sync to review the prototype and approval/logging behavior.',
    intent: 'both',
    suggestedReplies: [
      {
        id: 'reply-1',
        actionId: 'action-reply-1',
        title: 'Agree',
        tone: 'concise',
        body: 'Tomorrow afternoon works for me. I will send a calendar invite with the agenda.',
      },
      {
        id: 'reply-2',
        actionId: 'action-reply-2',
        title: 'Ask timing',
        tone: 'collaborative',
        body: 'Tomorrow afternoon should work. What time window is best for you?',
      },
      {
        id: 'reply-3',
        actionId: 'action-reply-3',
        title: 'Defer',
        tone: 'direct',
        body: 'I cannot make tomorrow afternoon. Can we move this to the next working day?',
      },
    ],
    calendarProposal: {
      actionId: 'action-calendar-1',
      summary: 'Mail automation prototype planning',
      description: 'Review prototype, approval flow, and audit logging.',
      attendees: ['santosh@example.com'],
      start: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      end: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      needsCalendarInvite: true,
      rationale: 'Requested planning sync tomorrow afternoon.',
    },
    risks: ['Demo data only. Electron preload is required for real actions.'],
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

let settings = demoSettings;
let emails = [demoEmail];
let auditEvents: AuditEvent[] = [
  {
    id: 'audit-1',
    type: 'demo.loaded',
    summary: 'Loaded browser demo bridge',
    createdAt: new Date().toISOString(),
  },
];

export function installBrowserMock(): void {
  if (window.mailAssistant) return;
  window.mailAssistant = {
    settings: {
      get: async () => settings,
      update: async (patch) => {
        settings = {
          ...settings,
          ...patch,
          openai: { ...settings.openai, ...patch.openai },
          google: { ...settings.google, ...patch.google },
        };
        return settings;
      },
    },
    google: {
      signIn: async () => ({ ok: false, error: 'Google sign-in requires Electron.' }),
      signOut: async () => ({ ok: true, status: { signedIn: false, scopes: [] } }),
      status: async () => ({ signedIn: false, scopes: [], error: 'Browser demo mode' }),
    },
    inbox: {
      refresh: async () => ({
        ok: true,
        result: { fetched: 1, inserted: 0, skipped: 1, errors: [] },
        emails,
      }),
      list: async () => emails,
      get: async (id) => emails.find((email) => email.id === id) ?? null,
    },
    agent: {
      analyzeEmail: async () => ({ ok: true, analysis: demoEmail.analysis! }),
      chatCommand: async (command) => ({
        ok: true,
        analysis: {
          summary: command || 'Manual context demo',
          intent: 'none',
          suggestedReplies: [],
          risks: ['Browser demo mode.'],
        },
        actions: [],
      }),
      regenerate: async () => ({ ok: true, analysis: demoEmail.analysis! }),
    },
    action: {
      approve: async (actionId) => {
        auditEvents = [
          {
            id: `audit-${Date.now()}`,
            type: 'demo.approve',
            summary: `Demo approved ${actionId}`,
            createdAt: new Date().toISOString(),
          },
          ...auditEvents,
        ];
        return {
          ok: true,
          action: {
            id: actionId,
            kind: actionId.includes('calendar') ? 'calendar_event' : 'email_reply',
            status: 'sent',
            payload: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      },
      sendEdited: async () => ({
        ok: false,
        error: 'Edited sends require Electron.',
      }),
      cancel: async (actionId) => ({
        ok: true,
        action: {
          id: actionId,
          kind: 'email_reply',
          status: 'cancelled',
          payload: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    },
    logs: {
      list: async () => auditEvents,
      export: async () => ({ ok: false, error: 'Log export requires Electron.' }),
      forgetContent: async () => {
        emails = emails.map((email) => ({ ...email, bodyText: '', snippet: '' }));
        return { ok: true };
      },
    },
  } satisfies MailAssistantApi;
}
