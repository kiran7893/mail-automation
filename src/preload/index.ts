import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/channels';
import type {
  ActionRecord,
  AppSettings,
  AuditEvent,
  ChatCommandResult,
  EmailAnalysis,
  EmailItem,
  GoogleAuthStatus,
  InboxRefreshResult,
  LogsExportResult,
  Result,
} from '../shared/types';

const api = {
  settings: {
    get(): Promise<AppSettings> {
      return ipcRenderer.invoke(CHANNELS.settingsGet);
    },
    update(patch: Partial<AppSettings>): Promise<AppSettings> {
      return ipcRenderer.invoke(CHANNELS.settingsUpdate, patch);
    },
  },
  google: {
    signIn(): Promise<Result<{ status: GoogleAuthStatus }>> {
      return ipcRenderer.invoke(CHANNELS.googleSignIn);
    },
    signOut(): Promise<Result<{ status: GoogleAuthStatus }>> {
      return ipcRenderer.invoke(CHANNELS.googleSignOut);
    },
    status(): Promise<GoogleAuthStatus> {
      return ipcRenderer.invoke(CHANNELS.googleStatus);
    },
  },
  inbox: {
    refresh(): Promise<Result<{ result: InboxRefreshResult; emails: EmailItem[] }>> {
      return ipcRenderer.invoke(CHANNELS.inboxRefresh);
    },
    list(): Promise<EmailItem[]> {
      return ipcRenderer.invoke(CHANNELS.inboxList);
    },
    get(id: string): Promise<EmailItem | null> {
      return ipcRenderer.invoke(CHANNELS.inboxGet, id);
    },
  },
  agent: {
    analyzeEmail(emailId: string): Promise<Result<{ analysis: EmailAnalysis }>> {
      return ipcRenderer.invoke(CHANNELS.agentAnalyzeEmail, emailId);
    },
    chatCommand(command: string): Promise<Result<ChatCommandResult>> {
      return ipcRenderer.invoke(CHANNELS.agentChatCommand, command);
    },
    regenerate(emailId: string): Promise<Result<{ analysis: EmailAnalysis }>> {
      return ipcRenderer.invoke(CHANNELS.agentRegenerate, emailId);
    },
  },
  action: {
    approve(actionId: string): Promise<Result<{ action: ActionRecord }>> {
      return ipcRenderer.invoke(CHANNELS.actionApprove, actionId);
    },
    sendEdited(emailId: string, body: string): Promise<Result<{ action: ActionRecord }>> {
      return ipcRenderer.invoke(CHANNELS.actionSendEdited, { emailId, body });
    },
    cancel(actionId: string): Promise<Result<{ action: ActionRecord }>> {
      return ipcRenderer.invoke(CHANNELS.actionCancel, actionId);
    },
  },
  logs: {
    list(limit?: number): Promise<AuditEvent[]> {
      return ipcRenderer.invoke(CHANNELS.logsList, limit);
    },
    export(): Promise<Result<{ result: LogsExportResult }>> {
      return ipcRenderer.invoke(CHANNELS.logsExport);
    },
    forgetContent(): Promise<Result<object>> {
      return ipcRenderer.invoke(CHANNELS.logsForgetContent);
    },
  },
};

contextBridge.exposeInMainWorld('mailAssistant', api);

export type MailAssistantApi = typeof api;
