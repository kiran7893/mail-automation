export interface OpenAISettings {
  apiKey: string;
  apiKeyConfigured?: boolean;
  baseUrl: string;
  model: string;
}

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  gmailScopes: string[];
  calendarScopes: string[];
}

export interface AppSettings {
  appName: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enabled: boolean;
  openai: OpenAISettings;
  google: GoogleSettings;
  mailPollIntervalSeconds: number;
  mailGmailQuery: string;
  maxEmailsPerPoll: number;
  actionRequireApproval: boolean;
  auditLogRetentionDays: number;
}

export interface GoogleAuthStatus {
  signedIn: boolean;
  email?: string;
  scopes: string[];
  error?: string;
}

export type EmailStatus = 'new' | 'analyzed' | 'skipped' | 'sent' | 'failed';

export interface EmailItem {
  id: string;
  threadId: string;
  messageId?: string;
  subject: string;
  fromName?: string;
  fromEmail: string;
  to: string[];
  date?: string;
  snippet: string;
  bodyText: string;
  status: EmailStatus;
  analysis?: EmailAnalysis;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestedReply {
  id: string;
  actionId?: string;
  title: string;
  tone: string;
  body: string;
}

export interface CalendarProposal {
  actionId?: string;
  summary: string;
  description: string;
  attendees: string[];
  start: string;
  end: string;
  timeZone: string;
  needsCalendarInvite: boolean;
  rationale?: string;
}

export type EmailIntent = 'reply' | 'schedule' | 'both' | 'none';

export interface EmailAnalysis {
  emailId?: string;
  summary: string;
  intent: EmailIntent;
  suggestedReplies: SuggestedReply[];
  calendarProposal?: CalendarProposal;
  risks: string[];
}

export type ActionKind = 'email_reply' | 'calendar_event';
export type ActionStatus =
  | 'pending'
  | 'approved'
  | 'sent'
  | 'cancelled'
  | 'failed';

export interface ActionRecord<TPayload = unknown, TResult = unknown> {
  id: string;
  kind: ActionKind;
  sourceEmailId?: string;
  status: ActionStatus;
  payload: TPayload;
  result?: TResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
}

export interface AuditEvent {
  id: string;
  actionId?: string;
  type: string;
  summary: string;
  data?: unknown;
  createdAt: string;
}

export interface InboxRefreshResult {
  fetched: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

export interface ApproveActionRequest {
  actionId: string;
}

export interface SendEditedReplyRequest {
  emailId: string;
  body: string;
}

export interface ChatCommandResult {
  analysis: EmailAnalysis;
  actions: ActionRecord[];
}

export interface LogsExportResult {
  path: string;
  count: number;
}

export interface OkResult {
  ok: true;
}

export interface ErrorResult {
  ok: false;
  error: string;
}

export type Result<T> = (T & OkResult) | ErrorResult;

export const DEFAULT_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

export const DEFAULT_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
];
