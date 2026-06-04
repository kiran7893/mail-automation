import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Edit3,
  FileDown,
  Inbox,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  AppSettings,
  AuditEvent,
  EmailAnalysis,
  EmailItem,
  GoogleAuthStatus,
  SuggestedReply,
} from '../shared/types';
import {
  cleanDisplayText,
  cleanEmailForDisplay,
  type CleanEmailPart,
} from './emailReader';

type BusyKey =
  | 'boot'
  | 'save'
  | 'google'
  | 'refresh'
  | 'analyze'
  | 'approve'
  | 'cancel'
  | 'chat'
  | 'logs';

type AppView = 'inbox' | 'settings';
type ThemeChoice = 'light' | 'dark' | 'system';
type ReviewReceiptStatus = 'sending' | 'sent' | 'failed' | 'cancelled';

interface ReviewReceipt {
  status: ReviewReceiptStatus;
  summary: string;
  detail?: string;
  updatedAt: string;
}

const THEME_STORAGE_KEY = 'mailAutomation.theme';

function isBusy(busy: BusyKey | null, key: BusyKey): boolean {
  return busy === key;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function accountInitials(email?: string): string {
  if (!email) return 'GA';
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'GA';
}

function accountLabel(email?: string): string {
  if (!email) return 'Google account';
  const [name] = email.split('@');
  return name
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ') || email;
}

function isOpenRouterSettings(settings: AppSettings): boolean {
  return (
    /^openrouter\//i.test(settings.openai.model) ||
    /openrouter\.ai/i.test(settings.openai.baseUrl)
  );
}

function isFallbackRisk(value: string): boolean {
  return /LLM unavailable|fallback suggestions|invalid JSON/i.test(value);
}

function safeSummary(analysis: EmailAnalysis): string {
  const summary = cleanDisplayText(analysis.summary);
  if (
    analysis.risks.some(isFallbackRisk) &&
    (!summary || (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(summary) || summary.length < 16))
  ) {
    return 'The model could not analyze this email. Review the message below or check the model configuration.';
  }
  return summary || 'Summary unavailable.';
}

function formatDate(value?: string): string {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function resultError(result: { ok: boolean; error?: string }): string | null {
  return result.ok ? null : result.error ?? 'Operation failed.';
}

function readStoredTheme(): ThemeChoice {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return 'system';
}

function makeReceipt(
  status: ReviewReceiptStatus,
  summary: string,
  detail?: string,
  updatedAt = new Date().toISOString(),
): ReviewReceipt {
  return { status, summary, detail, updatedAt };
}

function actionIdsForAnalysis(analysis?: EmailAnalysis | null): string[] {
  if (!analysis) return [];
  const replyActionIds = analysis.suggestedReplies
    .map((reply) => reply.actionId)
    .filter((actionId): actionId is string => Boolean(actionId));
  return [
    ...replyActionIds,
    ...(analysis.calendarProposal?.actionId ? [analysis.calendarProposal.actionId] : []),
  ];
}

function receiptFromAudit(events: AuditEvent[], actionIds: string[]): ReviewReceipt | null {
  if (actionIds.length === 0) return null;
  const actionIdSet = new Set(actionIds);
  const event = events.find((item) => item.actionId && actionIdSet.has(item.actionId));
  if (!event) return null;

  if (event.type === 'action.email_sent') {
    return makeReceipt('sent', 'Email sent after approval.', event.summary, event.createdAt);
  }
  if (event.type === 'action.calendar_created') {
    return makeReceipt('sent', 'Calendar invite created.', event.summary, event.createdAt);
  }
  if (event.type === 'action.failed') {
    return makeReceipt('failed', 'Action failed.', event.summary, event.createdAt);
  }
  if (event.type === 'action.cancelled') {
    return makeReceipt('cancelled', 'Action skipped.', event.summary, event.createdAt);
  }
  return null;
}

function receiptFromEmailStatus(email: EmailItem): ReviewReceipt | null {
  if (email.status === 'sent') {
    return makeReceipt('sent', 'Sent confirmed.', 'This conversation is marked sent.', email.updatedAt);
  }
  if (email.status === 'failed') {
    return makeReceipt('failed', 'Last action failed.', 'Open the audit log for details.', email.updatedAt);
  }
  return null;
}

export function App(): ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [googleStatus, setGoogleStatus] = useState<GoogleAuthStatus>({
    signedIn: false,
    scopes: [],
  });
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmailItem | null>(null);
  const [manualCommand, setManualCommand] = useState('');
  const [manualAnalysis, setManualAnalysis] = useState<EmailAnalysis | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState<BusyKey | null>('boot');
  const [notice, setNotice] = useState<string | null>(null);
  const [editReply, setEditReply] = useState<{ emailId: string; body: string } | null>(null);
  const [activeView, setActiveView] = useState<AppView>('inbox');
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => readStoredTheme());
  const [emailReceipts, setEmailReceipts] = useState<Record<string, ReviewReceipt>>({});

  const pendingCount = useMemo(
    () => emails.filter((email) => email.status === 'new' || email.status === 'analyzed').length,
    [emails],
  );
  const hasGoogleConfig = Boolean(settings?.google.clientId);

  async function boot(): Promise<void> {
    setBusy('boot');
    try {
      const [loadedSettings, status, loadedEmails, events] = await Promise.all([
        window.mailAssistant.settings.get(),
        window.mailAssistant.google.status(),
        window.mailAssistant.inbox.list(),
        window.mailAssistant.logs.list(50),
      ]);
      setSettings(loadedSettings);
      setGoogleStatus(status);
      setEmails(loadedEmails);
      setSelectedId(loadedEmails[0]?.id ?? null);
      setAuditEvents(events);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshSelected(id: string | null = selectedId): Promise<void> {
    if (!id) {
      setSelected(null);
      return;
    }
    const email = await window.mailAssistant.inbox.get(id);
    setSelected(email);
  }

  async function refreshLists(): Promise<void> {
    const [loadedEmails, events] = await Promise.all([
      window.mailAssistant.inbox.list(),
      window.mailAssistant.logs.list(50),
    ]);
    setEmails(loadedEmails);
    setAuditEvents(events);
    await refreshSelected();
  }

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    refreshSelected(selectedId).catch((error) => setNotice(errorText(error)));
  }, [selectedId]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeChoice);
  }, [themeChoice]);

  function setEmailReceipt(emailId: string | undefined, receipt: ReviewReceipt): void {
    if (!emailId) return;
    setEmailReceipts((current) => ({ ...current, [emailId]: receipt }));
  }

  function selectedSourceForAction(actionId: string): string | undefined {
    const selectedActionIds = actionIdsForAnalysis(selected?.analysis);
    return selectedActionIds.includes(actionId) ? selected?.id : undefined;
  }

  async function saveSettings(): Promise<void> {
    if (!settings) return;
    setBusy('save');
    setNotice(null);
    try {
      const updated = await window.mailAssistant.settings.update(settings);
      setSettings(updated);
      setNotice('Settings saved.');
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(): Promise<void> {
    if (!settings) return;
    const updated = await window.mailAssistant.settings.update({
      enabled: !settings.enabled,
    });
    setSettings(updated);
  }

  async function signIn(): Promise<void> {
    setBusy('google');
    setNotice(null);
    try {
      const result = await window.mailAssistant.google.signIn();
      const err = resultError(result);
      if (err) setNotice(err);
      if (result.ok) setGoogleStatus(result.status);
    } finally {
      setBusy(null);
    }
  }

  async function signOut(): Promise<void> {
    setBusy('google');
    const result = await window.mailAssistant.google.signOut();
    if (result.ok) setGoogleStatus(result.status);
    else setNotice(result.error);
    setBusy(null);
  }

  async function refreshInbox(): Promise<void> {
    setBusy('refresh');
    setNotice(null);
    try {
      const result = await window.mailAssistant.inbox.refresh();
      if (result.ok) {
        setEmails(result.emails);
        setNotice(
          `Fetched ${result.result.fetched}, inserted ${result.result.inserted}, skipped ${result.result.skipped}.`,
        );
        if (!selectedId && result.emails[0]) setSelectedId(result.emails[0].id);
      } else {
        setNotice(result.error);
      }
      setAuditEvents(await window.mailAssistant.logs.list(50));
    } finally {
      setBusy(null);
    }
  }

  async function analyze(emailId: string): Promise<void> {
    setBusy('analyze');
    setNotice(null);
    const result = await window.mailAssistant.agent.analyzeEmail(emailId);
    if (result.ok) {
      await refreshLists();
      setNotice('Analysis ready.');
    } else {
      setNotice(result.error);
    }
    setBusy(null);
  }

  async function regenerate(emailId: string): Promise<void> {
    setBusy('analyze');
    const result = await window.mailAssistant.agent.regenerate(emailId);
    if (result.ok) {
      await refreshLists();
      setNotice('New suggestions generated.');
    } else {
      setNotice(result.error);
    }
    setBusy(null);
  }

  async function approve(actionId?: string): Promise<void> {
    if (!actionId) return;
    const optimisticEmailId = selectedSourceForAction(actionId);
    setEmailReceipt(
      optimisticEmailId,
      makeReceipt('sending', 'Sending approved action...', 'Waiting for Gmail or Calendar confirmation.'),
    );
    setBusy('approve');
    setNotice(null);
    const result = await window.mailAssistant.action.approve(actionId);
    if (result.ok) {
      const targetEmailId = result.action.sourceEmailId ?? optimisticEmailId;
      const sent = result.action.status === 'sent';
      setEmailReceipt(
        targetEmailId,
        makeReceipt(
          sent ? 'sent' : 'failed',
          sent ? 'Sent confirmed.' : `Action ended as ${result.action.status}.`,
          sent ? 'The approved email or calendar invite completed.' : result.action.error,
        ),
      );
      setNotice(sent ? 'Approved action completed.' : result.action.status);
      await refreshLists();
    } else {
      setEmailReceipt(optimisticEmailId, makeReceipt('failed', 'Action failed.', result.error));
      setNotice(result.error);
      await refreshLists();
    }
    setBusy(null);
  }

  async function cancelAction(actionId?: string): Promise<void> {
    if (!actionId) return;
    const optimisticEmailId = selectedSourceForAction(actionId);
    setBusy('cancel');
    setNotice(null);
    const result = await window.mailAssistant.action.cancel(actionId);
    if (result.ok) {
      setEmailReceipt(
        result.action.sourceEmailId ?? optimisticEmailId,
        makeReceipt('cancelled', 'Action skipped.', 'No email or calendar invite was sent.'),
      );
      setNotice('Action skipped.');
      await refreshLists();
    } else {
      setEmailReceipt(optimisticEmailId, makeReceipt('failed', 'Could not skip action.', result.error));
      setNotice(result.error);
    }
    setBusy(null);
  }

  async function sendEdited(): Promise<void> {
    if (!editReply) return;
    const targetEmailId = editReply.emailId;
    setEmailReceipt(
      targetEmailId,
      makeReceipt('sending', 'Sending edited reply...', 'Waiting for Gmail confirmation.'),
    );
    setBusy('approve');
    const result = await window.mailAssistant.action.sendEdited(editReply.emailId, editReply.body);
    if (result.ok) {
      setEmailReceipt(
        result.action.sourceEmailId ?? targetEmailId,
        makeReceipt('sent', 'Edited reply sent.', 'Gmail confirmed the edited response.'),
      );
      setNotice('Edited reply sent.');
      setEditReply(null);
      await refreshLists();
    } else {
      setEmailReceipt(targetEmailId, makeReceipt('failed', 'Edited reply failed.', result.error));
      setNotice(result.error);
    }
    setBusy(null);
  }

  async function runChatCommand(): Promise<void> {
    setBusy('chat');
    setNotice(null);
    const result = await window.mailAssistant.agent.chatCommand(manualCommand);
    if (result.ok) {
      setManualAnalysis(result.analysis);
      setNotice('Manual context analyzed.');
      setAuditEvents(await window.mailAssistant.logs.list(50));
    } else {
      setNotice(result.error);
    }
    setBusy(null);
  }

  async function exportLogs(): Promise<void> {
    setBusy('logs');
    const result = await window.mailAssistant.logs.export();
    setNotice(result.ok ? `Exported ${result.result.count} audit events.` : result.error);
    setBusy(null);
  }

  async function forgetContent(): Promise<void> {
    setBusy('logs');
    const result = await window.mailAssistant.logs.forgetContent();
    setNotice(result.ok ? 'Local email/action content forgotten.' : result.error);
    await refreshLists();
    setBusy(null);
  }

  if (!settings || isBusy(busy, 'boot')) {
    return (
      <main className="boot">
        <Loader2 className="spin" size={22} />
        <span>Loading Mail Automation</span>
      </main>
    );
  }

  return (
    <main className="appShell" data-theme={themeChoice}>
      <header className="topbar">
        <div className="brandBlock">
          <div className="brandMark">MA</div>
          <div className="brandCopy">
            <h1>Mail Automation</h1>
            <p>{settings.enabled ? `${pendingCount} pending inbox items` : 'Assistant paused'}</p>
          </div>
        </div>

        <nav className="topNav" aria-label="Primary">
          <button
            className={activeView === 'inbox' ? 'navButton active' : 'navButton'}
            onClick={() => setActiveView('inbox')}
          >
            <Inbox />
            Inbox
          </button>
          <button
            className={activeView === 'settings' ? 'navButton active' : 'navButton'}
            onClick={() => setActiveView('settings')}
          >
            <SettingsIcon />
            Settings
          </button>
        </nav>

        <div className="topActions">
          <ThemeControl value={themeChoice} onChange={setThemeChoice} />
          <AccountProfile googleStatus={googleStatus} hasGoogleConfig={hasGoogleConfig} />
          <button className={settings.enabled ? 'powerToggle on' : 'powerToggle'} onClick={toggleEnabled}>
            {settings.enabled ? 'On' : 'Off'}
          </button>
          <button
            className="headerButton"
            onClick={googleStatus.signedIn ? signOut : signIn}
            disabled={busy !== null || (!googleStatus.signedIn && !hasGoogleConfig)}
          >
            {isBusy(busy, 'google') ? <Loader2 className="spin" /> : googleStatus.signedIn ? <LogOut /> : <ShieldCheck />}
            {googleStatus.signedIn ? 'Sign out' : 'Sign in'}
          </button>
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      {activeView === 'settings' ? (
        <SettingsView
          settings={settings}
          googleStatus={googleStatus}
          busy={busy}
          onSettingsChange={setSettings}
          onSave={saveSettings}
        />
      ) : (
        <InboxWorkspace
          settings={settings}
          googleStatus={googleStatus}
          emails={emails}
          selectedId={selectedId}
          selected={selected}
          manualCommand={manualCommand}
          manualAnalysis={manualAnalysis}
          auditEvents={auditEvents}
          busy={busy}
          emailReceipts={emailReceipts}
          onSelectEmail={setSelectedId}
          onOpenSettings={() => setActiveView('settings')}
          onRefreshInbox={refreshInbox}
          onAnalyze={analyze}
          onRegenerate={regenerate}
          onApprove={approve}
          onCancel={cancelAction}
          onEditReply={(reply) =>
            selected && setEditReply({ emailId: selected.id, body: reply.body })
          }
          onManualCommandChange={setManualCommand}
          onRunChatCommand={runChatCommand}
          onExportLogs={exportLogs}
          onForgetContent={forgetContent}
        />
      )}

      {editReply && (
        <div className="modalBackdrop" onMouseDown={() => setEditReply(null)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sectionHeader">
              <h2>Edit reply</h2>
              <button onClick={() => setEditReply(null)}>Close</button>
            </div>
            <textarea
              rows={12}
              value={editReply.body}
              onChange={(event) => setEditReply({ ...editReply, body: event.target.value })}
            />
            <button className="primary full" onClick={sendEdited} disabled={busy !== null}>
              {isBusy(busy, 'approve') ? <Loader2 className="spin" /> : <Send />}
              Send edited reply
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

interface ThemeControlProps {
  value: ThemeChoice;
  onChange: (theme: ThemeChoice) => void;
}

function ThemeControl({ value, onChange }: ThemeControlProps): ReactElement {
  return (
    <div className="themeControl" role="group" aria-label="Theme">
      <button
        className={value === 'light' ? 'themeButton active' : 'themeButton'}
        onClick={() => onChange('light')}
        title="Use light theme"
      >
        <Sun />
        <span>Light</span>
      </button>
      <button
        className={value === 'dark' ? 'themeButton active' : 'themeButton'}
        onClick={() => onChange('dark')}
        title="Use dark theme"
      >
        <Moon />
        <span>Dark</span>
      </button>
      <button
        className={value === 'system' ? 'themeButton active' : 'themeButton'}
        onClick={() => onChange('system')}
        title="Follow system theme"
      >
        <Monitor />
        <span>System</span>
      </button>
    </div>
  );
}

interface AccountProfileProps {
  googleStatus: GoogleAuthStatus;
  hasGoogleConfig: boolean;
}

function AccountProfile({ googleStatus, hasGoogleConfig }: AccountProfileProps): ReactElement {
  const signedIn = googleStatus.signedIn;
  return (
    <div className={signedIn ? 'accountProfile connected' : 'accountProfile'}>
      <span className="accountAvatar">{signedIn ? accountInitials(googleStatus.email) : 'GA'}</span>
      <div className="accountCopy">
        <strong>{signedIn ? accountLabel(googleStatus.email) : 'Google account'}</strong>
        <small>
          {signedIn
            ? googleStatus.email ?? 'Connected'
            : hasGoogleConfig
              ? 'Ready to sign in'
              : 'OAuth missing'}
        </small>
      </div>
    </div>
  );
}

interface SettingsViewProps {
  settings: AppSettings;
  googleStatus: GoogleAuthStatus;
  busy: BusyKey | null;
  onSettingsChange: (settings: AppSettings) => void;
  onSave: () => void;
}

function SettingsView({
  settings,
  googleStatus,
  busy,
  onSettingsChange,
  onSave,
}: SettingsViewProps): ReactElement {
  const providerLabel = isOpenRouterSettings(settings) ? 'OpenRouter' : 'OpenAI-compatible';
  const keyConfigured = Boolean(settings.openai.apiKeyConfigured || settings.openai.apiKey);

  return (
    <section className="settingsWorkspace">
      <div className="settingsHero">
        <div>
          <span className="eyebrow">Local configuration</span>
          <h2>Settings</h2>
          <p>LLM settings are editable here. Google OAuth and polling values are loaded from .env.</p>
        </div>
        <button className="primary saveSettingsButton" onClick={onSave} disabled={busy !== null}>
          {isBusy(busy, 'save') ? <Loader2 className="spin" /> : <Check />}
          Save LLM settings
        </button>
      </div>

      <div className="settingsGrid">
        <section className="settingsSection accountSettings">
          <div className="sectionHeader">
            <h2>Account</h2>
            <span className={googleStatus.signedIn ? 'status good' : 'status'}>
              {googleStatus.signedIn ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <AccountProfile
            googleStatus={googleStatus}
            hasGoogleConfig={Boolean(settings.google.clientId)}
          />
          <div className="configFacts">
            <div>
              <span>Gmail OAuth</span>
              <strong>{settings.google.clientId ? 'Configured' : 'Missing client ID'}</strong>
            </div>
            <div>
              <span>Scopes</span>
              <strong>{settings.google.gmailScopes.length + settings.google.calendarScopes.length} enabled</strong>
            </div>
          </div>
        </section>

        <section className="settingsSection wide">
          <div className="sectionHeader">
            <h2>AI Model</h2>
            <span className={keyConfigured ? 'status good' : 'status'}>
              {keyConfigured ? `${providerLabel} ready` : 'API key missing'}
            </span>
          </div>
          <div className="configFacts">
            <div>
              <span>Provider</span>
              <strong>{providerLabel}</strong>
            </div>
            <div>
              <span>Secret</span>
              <strong>{keyConfigured ? 'Configured and hidden' : 'Not set'}</strong>
            </div>
          </div>
          <label>
            OpenAI base URL
            <input
              value={settings.openai.baseUrl}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  openai: { ...settings.openai, baseUrl: event.target.value },
                })
              }
            />
          </label>
          <label>
            OpenAI model
            <input
              value={settings.openai.model}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  openai: { ...settings.openai, model: event.target.value },
                })
              }
            />
          </label>
          <label>
            OpenAI or OpenRouter API key
            <input
              type="password"
              autoComplete="new-password"
              placeholder={keyConfigured ? 'API key configured - paste a new key to replace' : 'Paste API key'}
              value={settings.openai.apiKey}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  openai: { ...settings.openai, apiKey: event.target.value },
                })
              }
            />
          </label>
        </section>
      </div>
    </section>
  );
}

interface InboxWorkspaceProps {
  settings: AppSettings;
  googleStatus: GoogleAuthStatus;
  emails: EmailItem[];
  selectedId: string | null;
  selected: EmailItem | null;
  manualCommand: string;
  manualAnalysis: EmailAnalysis | null;
  auditEvents: AuditEvent[];
  busy: BusyKey | null;
  emailReceipts: Record<string, ReviewReceipt>;
  onSelectEmail: (emailId: string) => void;
  onOpenSettings: () => void;
  onRefreshInbox: () => void;
  onAnalyze: (emailId: string) => void;
  onRegenerate: (emailId: string) => void;
  onApprove: (actionId?: string) => void;
  onCancel: (actionId?: string) => void;
  onEditReply: (reply: SuggestedReply) => void;
  onManualCommandChange: (value: string) => void;
  onRunChatCommand: () => void;
  onExportLogs: () => void;
  onForgetContent: () => void;
}

function InboxWorkspace({
  settings,
  googleStatus,
  emails,
  selectedId,
  selected,
  manualCommand,
  manualAnalysis,
  auditEvents,
  busy,
  emailReceipts,
  onSelectEmail,
  onOpenSettings,
  onRefreshInbox,
  onAnalyze,
  onRegenerate,
  onApprove,
  onCancel,
  onEditReply,
  onManualCommandChange,
  onRunChatCommand,
  onExportLogs,
  onForgetContent,
}: InboxWorkspaceProps): ReactElement {
  const hasGoogleConfig = Boolean(settings.google.clientId);
  return (
    <section className="workspace">
      <section className="inboxPanel">
        <div className="sectionHeader">
          <h2><Inbox /> Inbox</h2>
          <div className="panelActions">
            <span className="countPill">{emails.length}</span>
            <button
              onClick={onRefreshInbox}
              disabled={busy !== null || !hasGoogleConfig || !googleStatus.signedIn}
              title="Refresh inbox"
            >
              {isBusy(busy, 'refresh') ? <Loader2 className="spin" /> : <RefreshCw />}
              Refresh
            </button>
          </div>
        </div>
        <div className="emailList">
          {emails.map((email) => (
            <button
              key={email.id}
              className={selectedId === email.id ? 'emailRow selected' : 'emailRow'}
              onClick={() => onSelectEmail(email.id)}
            >
              <span className={`dot ${email.status}`} />
              <span className="emailRowMain">
                <strong>{cleanDisplayText(email.subject)}</strong>
                <small>{email.fromName || email.fromEmail}</small>
                <p>{cleanDisplayText(email.snippet || email.bodyText).slice(0, 150)}</p>
              </span>
              <span className="emailRowMeta">
                <time>{formatDate(email.date)}</time>
                <span className={`miniStatus ${email.status}`}>{email.status}</span>
              </span>
            </button>
          ))}
          {emails.length === 0 && (
            <EmptyInboxState
              hasGoogleConfig={hasGoogleConfig}
              signedIn={googleStatus.signedIn}
              busy={busy}
              onOpenSettings={onOpenSettings}
              onRefreshInbox={onRefreshInbox}
            />
          )}
        </div>
      </section>

      <section className="reviewPanel">
        {selected ? (
          <EmailReview
            email={selected}
            busy={busy}
            auditEvents={auditEvents}
            receipt={emailReceipts[selected.id] ?? null}
            onAnalyze={() => onAnalyze(selected.id)}
            onRegenerate={() => onRegenerate(selected.id)}
            onApprove={onApprove}
            onCancel={onCancel}
            onEdit={onEditReply}
          />
        ) : (
          <ReviewEmptyState
            hasGoogleConfig={hasGoogleConfig}
            signedIn={googleStatus.signedIn}
            onOpenSettings={onOpenSettings}
          />
        )}
      </section>

      <aside className="activityPanel">
        <section className="sideSection">
          <div className="sectionHeader">
            <h2><CalendarClock /> Manual Context</h2>
          </div>
          <textarea
            className="manualInput"
            rows={6}
            value={manualCommand}
            onChange={(event) => onManualCommandChange(event.target.value)}
            placeholder="Paste a chat/email context or type: schedule a call with..."
          />
          <button className="primary full" onClick={onRunChatCommand} disabled={busy !== null}>
            {isBusy(busy, 'chat') ? <Loader2 className="spin" /> : <Sparkles />}
            Analyze context
          </button>
          {manualAnalysis && (
            <AnalysisBlock
              analysis={manualAnalysis}
              busy={busy}
              onApprove={onApprove}
              onCancel={onCancel}
              onEdit={() => undefined}
              hideRepliesWithoutActions
              compact
            />
          )}
        </section>

        <section className="sideSection auditSection">
          <div className="sectionHeader logsHeader">
            <h2>Recent Activity</h2>
            <div className="iconActions">
              <button onClick={onExportLogs} title="Export audit log" disabled={busy !== null}>
                <FileDown />
              </button>
              <button onClick={onForgetContent} title="Forget local content" disabled={busy !== null}>
                <Trash2 />
              </button>
            </div>
          </div>
          <div className="auditList">
            {auditEvents.slice(0, 8).map((event) => (
              <div key={event.id} className="auditItem">
                <strong>{event.summary}</strong>
                <small>{event.type} - {formatDate(event.createdAt)}</small>
              </div>
            ))}
            {auditEvents.length === 0 && <p className="empty">No audit events yet.</p>}
          </div>
        </section>
      </aside>
    </section>
  );
}

interface EmptyInboxStateProps {
  hasGoogleConfig: boolean;
  signedIn: boolean;
  busy: BusyKey | null;
  onOpenSettings: () => void;
  onRefreshInbox: () => void;
}

function EmptyInboxState({
  hasGoogleConfig,
  signedIn,
  busy,
  onOpenSettings,
  onRefreshInbox,
}: EmptyInboxStateProps): ReactElement {
  if (!hasGoogleConfig) {
    return (
      <div className="emptySetup">
        <strong>Connect Gmail first</strong>
        <p>Add your Google OAuth client ID and secret to the local .env file, then restart the app.</p>
        <button onClick={onOpenSettings}>
          <SettingsIcon />
          Open Settings
        </button>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="emptySetup">
        <strong>Google sign-in needed</strong>
        <p>Use Sign in at the top or in Settings after saving your OAuth values.</p>
      </div>
    );
  }

  return (
    <div className="emptySetup">
      <strong>No messages fetched yet</strong>
      <p>Refresh inbox to pull messages that match the current Gmail query.</p>
      <button onClick={onRefreshInbox} disabled={busy !== null}>
        {isBusy(busy, 'refresh') ? <Loader2 className="spin" /> : <RefreshCw />}
        Refresh inbox
      </button>
    </div>
  );
}

interface ReviewEmptyStateProps {
  hasGoogleConfig: boolean;
  signedIn: boolean;
  onOpenSettings: () => void;
}

function ReviewEmptyState({
  hasGoogleConfig,
  signedIn,
  onOpenSettings,
}: ReviewEmptyStateProps): ReactElement {
  if (!hasGoogleConfig) {
    return (
      <div className="emptyState">
        <ShieldCheck />
        <strong>Setup is required</strong>
        <p>Enter OpenAI/OpenRouter and Google credentials before fetching email.</p>
        <button onClick={onOpenSettings}>Open Settings</button>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="emptyState">
        <ShieldCheck />
        <strong>Connect your Google account</strong>
        <p>After sign-in, refresh the inbox and select a message to review.</p>
      </div>
    );
  }

  return (
    <div className="emptyState">
      <Inbox />
      <strong>Select an email to review</strong>
      <p>Summaries, response choices, and calendar approvals appear here.</p>
    </div>
  );
}

interface EmailReviewProps {
  email: EmailItem;
  busy: BusyKey | null;
  auditEvents: AuditEvent[];
  receipt: ReviewReceipt | null;
  onAnalyze: () => void;
  onRegenerate: () => void;
  onApprove: (actionId?: string) => void;
  onCancel: (actionId?: string) => void;
  onEdit: (reply: SuggestedReply) => void;
}

function EmailReview({
  email,
  busy,
  auditEvents,
  receipt,
  onAnalyze,
  onRegenerate,
  onApprove,
  onCancel,
  onEdit,
}: EmailReviewProps): ReactElement {
  const actionIds = actionIdsForAnalysis(email.analysis);
  const visibleReceipt =
    receipt ?? receiptFromAudit(auditEvents, actionIds) ?? receiptFromEmailStatus(email);

  return (
    <div className="emailDetail">
      <div className="pingHeader">
        <span className="pingBadge">
          <Sparkles />
          Ping review
        </span>
        <span className={`status ${email.status}`}>{email.status}</span>
      </div>

      <div className="emailHeader">
        <div>
          <h2>{cleanDisplayText(email.subject)}</h2>
          <p>{email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}</p>
        </div>
        <time>{formatDate(email.date)}</time>
      </div>

      {visibleReceipt && <ReceiptBanner receipt={visibleReceipt} />}

      {email.analysis ? (
        <>
          <AnalysisBlock
            analysis={email.analysis}
            busy={busy}
            onApprove={onApprove}
            onCancel={onCancel}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
          />
          <section className="originalEmail">
            <div className="sectionHeader">
              <h2>Original Email</h2>
            </div>
            <EmailReader text={email.bodyText || email.snippet} />
          </section>
        </>
      ) : (
        <div className="preAnalysis">
          <EmailReader text={email.bodyText || email.snippet} />
          <div className="reviewPrompt">
            <div>
              <strong>Ready to summarize</strong>
              <p>Analyze this email to get a short summary, three response options, and any calendar proposal.</p>
            </div>
            <button className="primary" onClick={onAnalyze} disabled={busy !== null}>
              {isBusy(busy, 'analyze') ? <Loader2 className="spin" /> : <Sparkles />}
              Analyze email
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ReceiptBannerProps {
  receipt: ReviewReceipt;
}

function ReceiptBanner({ receipt }: ReceiptBannerProps): ReactElement {
  const Icon =
    receipt.status === 'sent'
      ? CheckCircle2
      : receipt.status === 'failed'
        ? AlertCircle
        : receipt.status === 'cancelled'
          ? XCircle
          : Clock3;

  return (
    <div className={`receiptBanner ${receipt.status}`}>
      <Icon />
      <div>
        <strong>{receipt.summary}</strong>
        {receipt.detail && <p>{receipt.detail}</p>}
      </div>
      <time>{formatDate(receipt.updatedAt)}</time>
    </div>
  );
}

interface EmailReaderProps {
  text: string;
}

function EmailReader({ text }: EmailReaderProps): ReactElement {
  const [showHidden, setShowHidden] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const cleaned = useMemo(() => cleanEmailForDisplay(text), [text]);

  return (
    <div className="messageReader">
      <div className="readerToolbar">
        <span>{cleaned.linksCollapsed} links collapsed</span>
        <div className="readerActions">
          {cleaned.hiddenFooter.length > 0 && (
            <button onClick={() => setShowHidden((value) => !value)}>
              {showHidden ? 'Hide footer' : `Show hidden footer (${cleaned.hiddenLineCount})`}
            </button>
          )}
          <button onClick={() => setShowRaw((value) => !value)}>
            {showRaw ? 'View clean email' : 'View raw email'}
          </button>
        </div>
      </div>

      {showRaw ? (
        <pre className="rawEmail">{cleaned.rawText}</pre>
      ) : (
        <>
          <div className="readerBody">
            {cleaned.visible.map((part, index) => (
              <ReaderPart key={`${part.type}-${index}`} part={part} />
            ))}
            {cleaned.visible.length === 0 && <p className="readerEmpty">No readable content found.</p>}
          </div>
          {showHidden && (
            <div className="hiddenFooter">
              {cleaned.hiddenFooter.map((part, index) => (
                <ReaderPart key={`hidden-${part.type}-${index}`} part={part} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface ReaderPartProps {
  part: CleanEmailPart;
}

function ReaderPart({ part }: ReaderPartProps): ReactElement {
  if (part.type === 'separator') return <div className="readerSeparator" />;
  if (part.type === 'link') {
    return (
      <a className="readerLink" href={part.link.href} target="_blank" rel="noreferrer">
        {part.link.label}
      </a>
    );
  }
  return (
    <p className="readerParagraph">
      {part.lines.map((line, index) => (
        <span key={`${line}-${index}`}>{line}</span>
      ))}
    </p>
  );
}

interface AnalysisBlockProps {
  analysis: EmailAnalysis;
  busy: BusyKey | null;
  onApprove: (actionId?: string) => void;
  onCancel: (actionId?: string) => void;
  onEdit: (reply: SuggestedReply) => void;
  onRegenerate?: () => void;
  hideRepliesWithoutActions?: boolean;
  compact?: boolean;
}

function AnalysisBlock({
  analysis,
  busy,
  onApprove,
  onCancel,
  onEdit,
  onRegenerate,
  hideRepliesWithoutActions = false,
  compact = false,
}: AnalysisBlockProps): ReactElement {
  const replies = hideRepliesWithoutActions
    ? analysis.suggestedReplies.filter((reply) => reply.actionId)
    : analysis.suggestedReplies.slice(0, 3);
  const fallbackNotice = analysis.risks.find(isFallbackRisk);
  const visibleRisks = analysis.risks.filter((risk) => !isFallbackRisk(risk));

  return (
    <div className={compact ? 'analysis compact' : 'analysis'}>
      {fallbackNotice && (
        <div className="analysisWarning">
          <AlertCircle />
          <div>
            <strong>LLM fallback used</strong>
            <p>{cleanDisplayText(fallbackNotice)}</p>
          </div>
        </div>
      )}

      <section className="summaryBlock">
        <div className="summaryTitle">
          <span>Summary</span>
          <strong>{analysis.intent}</strong>
        </div>
        <p>{safeSummary(analysis)}</p>
        {visibleRisks.length > 0 && (
          <ul>
            {visibleRisks.map((risk) => (
              <li key={risk}>{cleanDisplayText(risk)}</li>
            ))}
          </ul>
        )}
      </section>

      {replies.length > 0 && (
        <section className="responseSection">
          <div className="sectionHeader">
            <h2>Response Options</h2>
            <span className="muted">Choose one to send</span>
          </div>
          <div className="replyGrid">
            {replies.map((reply, index) => (
              <article className="replyOption" key={reply.id}>
                <div className="replyMeta">
                  <span>Option {index + 1}</span>
                  <span>{reply.tone}</span>
                </div>
                <h3>{cleanDisplayText(reply.title)}</h3>
                <p>{cleanDisplayText(reply.body)}</p>
                <div className="replyActions">
                  <button
                    className="primary"
                    onClick={() => onApprove(reply.actionId)}
                    disabled={!reply.actionId || busy !== null}
                  >
                    {isBusy(busy, 'approve') ? <Loader2 className="spin" /> : <Send />}
                    Agree & Send
                  </button>
                  {!hideRepliesWithoutActions && (
                    <>
                      <button onClick={onRegenerate} disabled={!onRegenerate || busy !== null}>
                        <RotateCcw />
                        Disagree
                      </button>
                      <button onClick={() => onEdit(reply)} disabled={busy !== null}>
                        <Edit3 />
                        Edit
                      </button>
                    </>
                  )}
                  <button
                    className="quietButton"
                    onClick={() => onCancel(reply.actionId)}
                    disabled={!reply.actionId || busy !== null}
                  >
                    {isBusy(busy, 'cancel') ? <Loader2 className="spin" /> : <XCircle />}
                    Skip
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {analysis.calendarProposal && (
        <article className="calendarProposal">
          <div className="calendarTitle">
            <CalendarClock />
            <div>
              <span>Calendar approval</span>
              <strong>{analysis.calendarProposal.summary}</strong>
            </div>
          </div>
          <p>{analysis.calendarProposal.description}</p>
          <div className="calendarDetails">
            <span>When</span>
            <strong>
              {formatDate(analysis.calendarProposal.start)} to {formatDate(analysis.calendarProposal.end)}
            </strong>
            <span>Guests</span>
            <strong>{analysis.calendarProposal.attendees.join(', ') || 'No attendees parsed'}</strong>
            <span>Zone</span>
            <strong>{analysis.calendarProposal.timeZone}</strong>
          </div>
          <div className="calendarActions">
            <button
              className="primary"
              onClick={() => onApprove(analysis.calendarProposal?.actionId)}
              disabled={!analysis.calendarProposal.actionId || busy !== null}
            >
              {isBusy(busy, 'approve') ? <Loader2 className="spin" /> : <Check />}
              Approve invite
            </button>
            <button
              onClick={() => onCancel(analysis.calendarProposal?.actionId)}
              disabled={!analysis.calendarProposal.actionId || busy !== null}
            >
              <XCircle />
              Skip invite
            </button>
          </div>
        </article>
      )}
    </div>
  );
}
