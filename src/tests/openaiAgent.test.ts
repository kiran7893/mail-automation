import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractJsonObject, OpenAIAgent } from '../main/services/openaiAgent';
import type { AppSettings, EmailItem } from '../shared/types';

const settings: AppSettings = {
  appName: 'Mail Automation',
  logLevel: 'info',
  enabled: true,
  openai: {
    apiKey: 'sk-or-v1-test',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/owl-alpha',
  },
  google: {
    clientId: '',
    clientSecret: '',
    gmailScopes: [],
    calendarScopes: [],
  },
  mailPollIntervalSeconds: 60,
  mailGmailQuery: '',
  maxEmailsPerPoll: 10,
  actionRequireApproval: true,
  auditLogRetentionDays: 90,
};

const email: EmailItem = {
  id: 'email-1',
  threadId: 'thread-1',
  subject: 'Registration approved',
  fromEmail: 'sender@example.com',
  to: [],
  snippet: 'You have a spot at the event.',
  bodyText: 'You have a spot at the event.',
  status: 'new',
  createdAt: '2026-06-04T00:00:00.000Z',
  updatedAt: '2026-06-04T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractJsonObject', () => {
  it('extracts fenced JSON from model output', () => {
    expect(
      extractJsonObject('```json\n{"summary":"ok","suggestedReplies":[]}\n```'),
    ).toEqual({ summary: 'ok', suggestedReplies: [] });
  });

  it('extracts the first object from surrounding text', () => {
    expect(extractJsonObject('Here is it: {"intent":"reply"} thanks')).toEqual({
      intent: 'reply',
    });
  });

  it('retries OpenRouter-style models without response_format when JSON mode is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'response_format is not supported by this model',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Registration was approved.',
                  intent: 'reply',
                  suggestedReplies: [{ title: 'Thanks', tone: 'brief', body: 'Thank you.' }],
                  risks: [],
                }),
              },
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const agent = new OpenAIAgent(async () => settings);
    const result = await agent.chatCommand('Registration approved.');

    expect(result.summary).toBe('Registration was approved.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({
      type: 'json_object',
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
  });

  it('includes the LLM failure reason in email fallback risks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid key sk-or-v1-test',
      }),
    );

    const agent = new OpenAIAgent(async () => settings);
    const result = await agent.analyzeEmail(email);

    expect(result.risks[0]).toContain('OpenAI-compatible request failed: 401');
    expect(result.risks[0]).not.toContain('sk-or-v1-test');
  });
});
