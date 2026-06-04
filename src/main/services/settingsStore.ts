import { app, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  DEFAULT_CALENDAR_SCOPES,
  DEFAULT_GMAIL_SCOPES,
  type AppSettings,
} from '../../shared/types';
import { clampNumber, splitScopes } from './time';
import { decryptWith, encryptWith } from './credentialCipher';

dotenv.config();

const SETTINGS_FILE = 'settings.json';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-5.5';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const SECRET_PATHS = [
  ['openai', 'apiKey'],
] as const;

function envSettings(): AppSettings {
  return {
    appName: process.env['APP_NAME'] || 'Mail Automation',
    logLevel: normalizeLogLevel(process.env['LOG_LEVEL']),
    enabled: true,
    openai: {
      apiKey: process.env['OPENAI_API_KEY'] || '',
      baseUrl: process.env['OPENAI_BASE_URL'] || DEFAULT_OPENAI_BASE_URL,
      model: process.env['OPENAI_MODEL'] || DEFAULT_OPENAI_MODEL,
    },
    google: {
      clientId: process.env['GOOGLE_OAUTH_CLIENT_ID'] || '',
      clientSecret: process.env['GOOGLE_OAUTH_CLIENT_SECRET'] || '',
      gmailScopes: splitScopes(process.env['GOOGLE_GMAIL_SCOPES'], DEFAULT_GMAIL_SCOPES),
      calendarScopes: splitScopes(
        process.env['GOOGLE_CALENDAR_SCOPES'],
        DEFAULT_CALENDAR_SCOPES,
      ),
    },
    mailPollIntervalSeconds: clampNumber(
      process.env['MAIL_POLL_INTERVAL_SECONDS'],
      60,
      15,
    ),
    mailGmailQuery:
      process.env['MAIL_GMAIL_QUERY'] ||
      'in:inbox newer_than:14d -category:promotions -category:social',
    maxEmailsPerPoll: clampNumber(process.env['MAX_EMAILS_PER_POLL'], 10, 1),
    actionRequireApproval:
      String(process.env['ACTION_REQUIRE_APPROVAL'] || 'true').toLowerCase() !== 'false',
    auditLogRetentionDays: clampNumber(process.env['AUDIT_LOG_RETENTION_DAYS'], 90, 1),
  };
}

function normalizeLogLevel(value: unknown): AppSettings['logLevel'] {
  if (value === 'debug' || value === 'warn' || value === 'error') return value;
  return 'info';
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function isOpenRouterKey(value: string): boolean {
  return /^sk-or-/i.test(value.trim());
}

function isOpenRouterModel(value: string): boolean {
  return /^openrouter\//i.test(value.trim());
}

function normalizeOpenAISettings(
  value: Partial<AppSettings['openai']> | undefined,
  defaults: AppSettings['openai'],
): AppSettings['openai'] {
  let apiKey = typeof value?.apiKey === 'string' ? value.apiKey : defaults.apiKey;
  if (!apiKey && defaults.apiKey) apiKey = defaults.apiKey;

  let model = typeof value?.model === 'string' && value.model.trim()
    ? value.model.trim()
    : defaults.model;
  if (model === DEFAULT_OPENAI_MODEL && defaults.model !== DEFAULT_OPENAI_MODEL) {
    model = defaults.model;
  }

  let baseUrl = typeof value?.baseUrl === 'string' && value.baseUrl.trim()
    ? cleanBaseUrl(value.baseUrl)
    : cleanBaseUrl(defaults.baseUrl);

  const openRouterSignal =
    isOpenRouterKey(apiKey) ||
    isOpenRouterKey(defaults.apiKey) ||
    isOpenRouterModel(model) ||
    isOpenRouterModel(defaults.model);
  if (openRouterSignal && baseUrl === DEFAULT_OPENAI_BASE_URL) {
    baseUrl = OPENROUTER_BASE_URL;
  }

  return { apiKey, baseUrl, model };
}

function normalizeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  const defaults = envSettings();
  const openai: Partial<AppSettings['openai']> = value?.openai ?? {};
  return {
    appName: defaults.appName,
    logLevel: defaults.logLevel,
    enabled: value?.enabled === false ? false : defaults.enabled,
    openai: normalizeOpenAISettings(openai, defaults.openai),
    google: defaults.google,
    mailPollIntervalSeconds: defaults.mailPollIntervalSeconds,
    mailGmailQuery: defaults.mailGmailQuery,
    maxEmailsPerPoll: defaults.maxEmailsPerPoll,
    actionRequireApproval: defaults.actionRequireApproval,
    auditLogRetentionDays: defaults.auditLogRetentionDays,
  };
}

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

function transformSecrets(
  settings: AppSettings,
  transform: (value: string) => string,
): AppSettings {
  const copy = cloneSettings(settings);
  for (const [section, key] of SECRET_PATHS) {
    const sectionValue = copy[section] as unknown as Record<string, string>;
    sectionValue[key] = transform(sectionValue[key] || '');
  }
  return copy;
}

export class SettingsStore {
  private readonly filePath: string;

  constructor(userDataPath = app.getPath('userData')) {
    this.filePath = path.join(userDataPath, SETTINGS_FILE);
  }

  async get(): Promise<AppSettings> {
    const loaded = await this.readRaw();
    const normalized = normalizeSettings(loaded);
    const decrypted = transformSecrets(normalized, (value) => decryptWith(safeStorage, value));
    await this.persist(decrypted);
    return decrypted;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const openaiPatch = patch.openai
      ? {
          ...patch.openai,
          apiKey: patch.openai.apiKey || current.openai.apiKey,
        }
      : undefined;
    const merged = normalizeSettings({
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      openai: { ...current.openai, ...openaiPatch },
    });
    await this.persist(merged);
    return merged;
  }

  private async readRaw(): Promise<Partial<AppSettings> | undefined> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as Partial<AppSettings>;
    } catch {
      return undefined;
    }
  }

  private async persist(settings: AppSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const encrypted = transformSecrets(settings, (value) => encryptWith(safeStorage, value));
    const persisted: Partial<AppSettings> = {
      enabled: encrypted.enabled,
      openai: encrypted.openai,
    };
    await fs.writeFile(this.filePath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
  }
}

export { normalizeSettings };
