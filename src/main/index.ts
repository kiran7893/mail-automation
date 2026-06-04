import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { CHANNELS } from '../shared/channels';
import type { AppSettings } from '../shared/types';
import { ActionService } from './services/actionService';
import { CalendarService } from './services/calendarService';
import { AppDatabase } from './services/database';
import { GmailService } from './services/gmailService';
import { GoogleAuthService } from './services/googleAuth';
import { LogService } from './services/logService';
import { OpenAIAgent } from './services/openaiAgent';
import { invokeResult } from './services/result';
import { SettingsStore } from './services/settingsStore';

let mainWindow: BrowserWindow | null = null;
let settingsStore: SettingsStore;
let db: AppDatabase;
let googleAuth: GoogleAuthService;
let gmail: GmailService;
let calendar: CalendarService;
let agent: OpenAIAgent;
let actions: ActionService;
let logs: LogService;
let pollTimer: NodeJS.Timeout | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    show: false,
    title: 'Mail Automation',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}

async function refreshInboxFromSettings(): Promise<void> {
  const settings = await settingsStore.get();
  if (!settings.enabled) return;
  if (!settings.google.clientId) return;
  await gmail.refresh(settings.mailGmailQuery, settings.maxEmailsPerPoll);
}

async function schedulePolling(): Promise<void> {
  if (pollTimer) clearInterval(pollTimer);
  const settings = await settingsStore.get();
  if (!settings.enabled) return;
  if (!settings.google.clientId) return;
  pollTimer = setInterval(() => {
    refreshInboxFromSettings().catch((error) => {
      console.warn('[poll] inbox refresh failed', error);
    });
  }, settings.mailPollIntervalSeconds * 1000);
}

function rendererSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    openai: {
      ...settings.openai,
      apiKey: '',
      apiKeyConfigured: Boolean(settings.openai.apiKey),
    },
    google: {
      ...settings.google,
      clientSecret: '',
    },
  };
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.settingsGet, async () => rendererSettings(await settingsStore.get()));
  ipcMain.handle(CHANNELS.settingsUpdate, async (_event, patch: Partial<AppSettings>) => {
    const updated = await settingsStore.update(patch);
    await schedulePolling();
    return rendererSettings(updated);
  });

  ipcMain.handle(CHANNELS.googleSignIn, () => invokeResult(async () => ({
    status: await googleAuth.signIn(),
  })));
  ipcMain.handle(CHANNELS.googleSignOut, () => invokeResult(async () => ({
    status: await googleAuth.signOut(),
  })));
  ipcMain.handle(CHANNELS.googleStatus, () => googleAuth.status());

  ipcMain.handle(CHANNELS.inboxRefresh, () => invokeResult(async () => {
    const settings = await settingsStore.get();
    return {
      result: await gmail.refresh(settings.mailGmailQuery, settings.maxEmailsPerPoll),
      emails: db.listEmails(),
    };
  }));
  ipcMain.handle(CHANNELS.inboxList, () => db.listEmails());
  ipcMain.handle(CHANNELS.inboxGet, (_event, id: string) => db.getEmail(id));

  ipcMain.handle(CHANNELS.agentAnalyzeEmail, (_event, emailId: string) => invokeResult(async () => {
    const email = db.getEmail(emailId);
    if (!email) throw new Error(`Email not found: ${emailId}`);
    const analysis = await agent.analyzeEmail(email);
    return { analysis: await actions.persistAnalysis(email, analysis) };
  }));
  ipcMain.handle(CHANNELS.agentRegenerate, (_event, emailId: string) => invokeResult(async () => {
    const email = db.getEmail(emailId);
    if (!email) throw new Error(`Email not found: ${emailId}`);
    const analysis = await agent.regenerate(email);
    return { analysis: await actions.persistAnalysis(email, analysis) };
  }));
  ipcMain.handle(CHANNELS.agentChatCommand, (_event, command: string) => invokeResult(async () => {
    if (!command.trim()) throw new Error('Command cannot be empty.');
    return actions.persistChatAnalysis(await agent.chatCommand(command));
  }));

  ipcMain.handle(CHANNELS.actionApprove, (_event, actionId: string) => invokeResult(async () => ({
    action: await actions.approve(actionId),
  })));
  ipcMain.handle(
    CHANNELS.actionSendEdited,
    (_event, req: { emailId: string; body: string }) => invokeResult(async () => ({
      action: await actions.sendEditedReply(req.emailId, req.body),
    })),
  );
  ipcMain.handle(CHANNELS.actionCancel, (_event, actionId: string) => invokeResult(async () => ({
    action: await actions.cancel(actionId),
  })));

  ipcMain.handle(CHANNELS.logsList, (_event, limit?: number) => logs.list(limit));
  ipcMain.handle(CHANNELS.logsExport, () => invokeResult(async () => ({
    result: await logs.export(),
  })));
  ipcMain.handle(CHANNELS.logsForgetContent, () => invokeResult(async () => {
    await logs.forgetContent();
    return {};
  }));
}

async function bootstrap(): Promise<void> {
  settingsStore = new SettingsStore();
  db = await AppDatabase.open();
  googleAuth = new GoogleAuthService(() => settingsStore.get(), db);
  gmail = new GmailService(googleAuth, db);
  calendar = new CalendarService(googleAuth, db);
  agent = new OpenAIAgent(() => settingsStore.get());
  actions = new ActionService(db, gmail, calendar);
  logs = new LogService(db);
  registerIpc();
  mainWindow = createWindow();
  await schedulePolling();
}

app.whenReady().then(() => {
  bootstrap().catch((error) => {
    console.error('[main] failed to bootstrap', error);
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
