import { safeStorage, shell } from 'electron';
import http from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { google, type oauth2_v2 } from 'googleapis';
import { CodeChallengeMethod, type OAuth2Client } from 'google-auth-library';
import type { AppSettings, GoogleAuthStatus } from '../../shared/types';
import type { AppDatabase } from './database';
import { decryptWith, encryptWith } from './credentialCipher';
import { nowIso } from './time';

interface StoredGoogleCredentials {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
}

type StoredGoogleCredentialsOnDisk = StoredGoogleCredentials;

const GOOGLE_TOKEN_ACTION_ID = '__google_tokens__';

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function uniqueScopes(settings: AppSettings): string[] {
  return Array.from(
    new Set([...settings.google.gmailScopes, ...settings.google.calendarScopes]),
  );
}

function assertGoogleConfigured(settings: AppSettings): void {
  if (!settings.google.clientId) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID is missing.');
  }
}

export class GoogleAuthService {
  constructor(
    private readonly settingsProvider: () => Promise<AppSettings>,
    private readonly db: AppDatabase,
  ) {}

  async signIn(): Promise<GoogleAuthStatus> {
    const settings = await this.settingsProvider();
    assertGoogleConfigured(settings);

    const verifier = base64Url(randomBytes(64));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const state = randomUUID();
    const scopes = uniqueScopes(settings);

    const { server, redirectUri, codePromise } = await this.createLoopbackServer(state);
    const client = this.createOAuthClient(settings, redirectUri);
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state,
      code_challenge: challenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });

    await shell.openExternal(authUrl);

    try {
      const code = await codePromise;
      const { tokens } = await client.getToken({
        code,
        codeVerifier: verifier,
        redirect_uri: redirectUri,
      });
      client.setCredentials(tokens);
      await this.saveCredentials({
        access_token: tokens.access_token ?? undefined,
        refresh_token: tokens.refresh_token ?? undefined,
        expiry_date: tokens.expiry_date ?? undefined,
        scope: tokens.scope ?? scopes.join(' '),
        token_type: tokens.token_type ?? undefined,
      });
      return this.status();
    } finally {
      server.close();
    }
  }

  async signOut(): Promise<GoogleAuthStatus> {
    await this.db.updateAction(GOOGLE_TOKEN_ACTION_ID, {
      status: 'cancelled',
      payload: {},
      result: {},
      error: undefined,
    });
    await this.db.addAudit({
      id: randomUUID(),
      actionId: GOOGLE_TOKEN_ACTION_ID,
      type: 'google.sign_out',
      summary: 'Google account disconnected',
      createdAt: nowIso(),
    });
    return this.status();
  }

  async status(): Promise<GoogleAuthStatus> {
    const credentials = this.getStoredCredentials();
    const scopes = credentials?.scope?.split(/\s+/).filter(Boolean) ?? [];
    if (!credentials?.refresh_token && !credentials?.access_token) {
      return { signedIn: false, scopes };
    }
    try {
      const client = await this.getClient();
      const email = await this.getAccountEmail(client);
      return {
        signedIn: true,
        email,
        scopes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/invalid_grant|invalid_token|unauthorized|401/i.test(message)) {
        return {
          signedIn: true,
          scopes,
          error: message,
        };
      }
      return {
        signedIn: false,
        scopes,
        error: message,
      };
    }
  }

  async getClient(): Promise<OAuth2Client> {
    const settings = await this.settingsProvider();
    assertGoogleConfigured(settings);
    const client = this.createOAuthClient(settings);
    const credentials = this.getStoredCredentials();
    if (!credentials?.refresh_token && !credentials?.access_token) {
      throw new Error('Google account is not signed in.');
    }
    client.setCredentials(credentials);
    client.on('tokens', async (tokens) => {
      const current = this.getStoredCredentials() ?? {};
      await this.saveCredentials({
        ...current,
        access_token: tokens.access_token ?? current.access_token,
        refresh_token: tokens.refresh_token ?? current.refresh_token,
        expiry_date: tokens.expiry_date ?? current.expiry_date,
        scope: tokens.scope ?? current.scope,
        token_type: tokens.token_type ?? current.token_type,
      });
    });
    return client;
  }

  private createOAuthClient(settings: AppSettings, redirectUri?: string): OAuth2Client {
    return new google.auth.OAuth2(
      settings.google.clientId,
      settings.google.clientSecret || undefined,
      redirectUri,
    );
  }

  private async getAccountEmail(client: OAuth2Client): Promise<string | undefined> {
    try {
      const gmail = google.gmail({ version: 'v1', auth: client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      return profile.data.emailAddress ?? undefined;
    } catch (gmailError) {
      try {
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const profile = await oauth2.userinfo.get();
        return profile.data.email ?? undefined;
      } catch {
        throw gmailError;
      }
    }
  }

  private getStoredCredentials(): StoredGoogleCredentials | null {
    const action = this.db.getAction(GOOGLE_TOKEN_ACTION_ID);
    if (!action || action.status === 'cancelled') return null;
    return this.decryptCredentials(action.payload as StoredGoogleCredentialsOnDisk);
  }

  private async saveCredentials(credentials: StoredGoogleCredentials): Promise<void> {
    const encryptedCredentials = this.encryptCredentials(credentials);
    const existing = this.db.getAction(GOOGLE_TOKEN_ACTION_ID);
    if (existing) {
      await this.db.updateAction(GOOGLE_TOKEN_ACTION_ID, {
        status: 'approved',
        payload: encryptedCredentials,
        result: { savedAt: nowIso() },
      });
    } else {
      await this.db.createAction({
        id: GOOGLE_TOKEN_ACTION_ID,
        kind: 'calendar_event',
        status: 'approved',
        payload: encryptedCredentials,
        result: { savedAt: nowIso() },
        createdAt: nowIso(),
        updatedAt: nowIso(),
        approvedAt: nowIso(),
      });
    }
    await this.db.addAudit({
      id: randomUUID(),
      actionId: GOOGLE_TOKEN_ACTION_ID,
      type: 'google.sign_in',
      summary: 'Google OAuth tokens stored locally',
      data: { scopes: credentials.scope },
      createdAt: nowIso(),
    });
  }

  private encryptCredentials(credentials: StoredGoogleCredentials): StoredGoogleCredentialsOnDisk {
    return {
      ...credentials,
      access_token: credentials.access_token
        ? encryptWith(safeStorage, credentials.access_token)
        : undefined,
      refresh_token: credentials.refresh_token
        ? encryptWith(safeStorage, credentials.refresh_token)
        : undefined,
    };
  }

  private decryptCredentials(credentials: StoredGoogleCredentialsOnDisk): StoredGoogleCredentials {
    return {
      ...credentials,
      access_token: credentials.access_token
        ? decryptWith(safeStorage, credentials.access_token)
        : undefined,
      refresh_token: credentials.refresh_token
        ? decryptWith(safeStorage, credentials.refresh_token)
        : undefined,
    };
  }

  private async createLoopbackServer(expectedState: string): Promise<{
    server: http.Server;
    redirectUri: string;
    codePromise: Promise<string>;
  }> {
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    const codePromise = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        const code = requestUrl.searchParams.get('code');
        const state = requestUrl.searchParams.get('state');
        const error = requestUrl.searchParams.get('error');
        res.writeHead(error ? 400 : 200, { 'content-type': 'text/html' });
        res.end(
          `<html><body><h3>${error ? 'Authorization failed' : 'Authorization complete'}</h3><p>You can return to Mail Automation.</p></body></html>`,
        );
        if (error) {
          rejectCode(new Error(error));
          return;
        }
        if (!code || state !== expectedState) {
          rejectCode(new Error('OAuth response failed state/code validation.'));
          return;
        }
        resolveCode(code);
      } catch (err) {
        rejectCode(err instanceof Error ? err : new Error(String(err)));
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Failed to start OAuth loopback listener.');
    }
    const redirectUri = `http://127.0.0.1:${address.port}`;
    const timeout = setTimeout(() => {
      rejectCode(new Error('Google sign-in timed out.'));
      server.close();
    }, 5 * 60 * 1000);
    codePromise.finally(() => clearTimeout(timeout)).catch(() => undefined);
    return { server, redirectUri, codePromise };
  }
}

export type GoogleOAuth2Client = OAuth2Client;
export type GoogleUserInfo = oauth2_v2.Schema$Userinfo;
