import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppSettings, CalendarProposal, EmailAnalysis, EmailItem } from '../../shared/types';

const suggestedReplySchema = z.object({
  title: z.string().min(1).default('Reply'),
  tone: z.string().min(1).default('professional'),
  body: z.string().min(1),
});

const calendarProposalSchema = z.object({
  summary: z.string().min(1),
  description: z.string().default(''),
  attendees: z.array(z.string()).default([]),
  start: z.string().min(1),
  end: z.string().min(1),
  timeZone: z.string().default('UTC'),
  needsCalendarInvite: z.boolean().default(true),
  rationale: z.string().optional(),
});

const analysisSchema = z.object({
  summary: z.string().min(1),
  intent: z.enum(['reply', 'schedule', 'both', 'none']).default('reply'),
  suggestedReplies: z.array(suggestedReplySchema).default([]),
  calendarProposal: calendarProposalSchema.optional(),
  risks: z.array(z.string()).default([]),
});

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  response_format?: { type: 'json_object' };
  temperature?: number;
}

export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('Model response did not contain a JSON object.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function cleanFallbackText(value: string): string {
  return value
    .replace(/[\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackSummary(email: EmailItem): string {
  const cleaned = cleanFallbackText(email.snippet || email.bodyText).slice(0, 240);
  if (!cleaned || (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cleaned) || cleaned.length < 16)) {
    return 'Email needs review. The model was unavailable, so fallback suggestions were generated locally.';
  }
  return cleaned;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [hidden]')
    .replace(/sk-[A-Za-z0-9._-]+/g, '[api-key-hidden]')
    .slice(0, 500);
}

function supportsResponseFormatRetry(message: string): boolean {
  return /response_format|json[_ -]?object|json_schema|unsupported|not support|invalid parameter/i.test(message);
}

function withIds(analysis: z.infer<typeof analysisSchema>, emailId?: string): EmailAnalysis {
  const suggestedReplies = analysis.suggestedReplies.slice(0, 3).map((reply) => ({
    id: randomUUID(),
    title: reply.title,
    tone: reply.tone,
    body: reply.body,
  }));
  while (suggestedReplies.length < 3 && analysis.intent !== 'none') {
    suggestedReplies.push({
      id: randomUUID(),
      title: `Option ${suggestedReplies.length + 1}`,
      tone: 'professional',
      body: 'Thanks for the note. I will review this and get back to you.',
    });
  }
  return {
    emailId,
    summary: analysis.summary,
    intent: analysis.intent,
    suggestedReplies,
    calendarProposal: analysis.calendarProposal as CalendarProposal | undefined,
    risks: analysis.risks,
  };
}

function fallbackAnalysis(email: EmailItem, error?: unknown): EmailAnalysis {
  const detail = error ? ` ${sanitizeError(error)}` : '';
  return {
    emailId: email.id,
    summary: fallbackSummary(email),
    intent: 'reply',
    suggestedReplies: [
      {
        id: randomUUID(),
        title: 'Acknowledge',
        tone: 'professional',
        body: 'Thanks for reaching out. I have seen this and will get back to you shortly.',
      },
      {
        id: randomUUID(),
        title: 'Agree',
        tone: 'concise',
        body: 'Thanks. This works for me.',
      },
      {
        id: randomUUID(),
        title: 'Ask for details',
        tone: 'collaborative',
        body: 'Thanks for sharing this. Could you send a little more context so I can respond properly?',
      },
    ],
    risks: [`LLM unavailable or returned invalid JSON; fallback suggestions were generated locally.${detail}`],
  };
}

function systemPrompt(): string {
  return [
    'You are a private desktop email assistant.',
    'Return only valid JSON. Do not send emails or create calendar events.',
    'Every action needs human approval later, so your job is only summarization and draft preparation.',
    'If a meeting should be scheduled, include a calendarProposal with RFC3339 start/end times and attendee emails.',
    'If dates are ambiguous, do not invent a time; include the ambiguity in risks.',
  ].join('\n');
}

function analysisInstruction(email: EmailItem): string {
  return JSON.stringify(
    {
      task: 'Summarize this email and draft exactly three response options.',
      expectedShape: {
        summary: 'short summary',
        intent: 'reply | schedule | both | none',
        suggestedReplies: [
          { title: 'Agree', tone: 'concise', body: 'reply body' },
          { title: 'Disagree', tone: 'direct', body: 'reply body' },
          { title: 'Edit needed', tone: 'collaborative', body: 'reply body' },
        ],
        calendarProposal: {
          summary: 'meeting title',
          description: 'context',
          attendees: ['person@example.com'],
          start: 'RFC3339 timestamp',
          end: 'RFC3339 timestamp',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          needsCalendarInvite: true,
          rationale: 'why this time/event',
        },
        risks: ['approval or ambiguity notes'],
      },
      email: {
        from: email.fromEmail,
        subject: email.subject,
        date: email.date,
        snippet: email.snippet,
        bodyText: email.bodyText.slice(0, 12000),
      },
      currentTime: new Date().toISOString(),
      localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
    null,
    2,
  );
}

function chatInstruction(command: string): string {
  return JSON.stringify(
    {
      task: 'Interpret this manually supplied chat/email context. Draft response options and a calendar proposal only when scheduling is explicit.',
      command,
      currentTime: new Date().toISOString(),
      localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      expectedShape: {
        summary: 'short summary',
        intent: 'reply | schedule | both | none',
        suggestedReplies: [{ title: 'Option', tone: 'tone', body: 'message body' }],
        calendarProposal: {
          summary: 'meeting title',
          description: 'context',
          attendees: ['person@example.com'],
          start: 'RFC3339 timestamp',
          end: 'RFC3339 timestamp',
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          needsCalendarInvite: true,
          rationale: 'why this time/event',
        },
        risks: ['ambiguities'],
      },
    },
    null,
    2,
  );
}

export class OpenAIAgent {
  constructor(private readonly settingsProvider: () => Promise<AppSettings>) {}

  async analyzeEmail(email: EmailItem): Promise<EmailAnalysis> {
    try {
      const parsed = await this.complete(analysisInstruction(email));
      return withIds(parsed, email.id);
    } catch (error) {
      return fallbackAnalysis(email, error);
    }
  }

  async chatCommand(command: string): Promise<EmailAnalysis> {
    const parsed = await this.complete(chatInstruction(command));
    return withIds(parsed);
  }

  async regenerate(email: EmailItem): Promise<EmailAnalysis> {
    const prompt = `${analysisInstruction(email)}\n\nRegenerate with substantially different wording.`;
    const parsed = await this.complete(prompt);
    return withIds(parsed, email.id);
  }

  private async complete(userContent: string): Promise<z.infer<typeof analysisSchema>> {
    const settings = await this.settingsProvider();
    if (!settings.openai.apiKey) {
      throw new Error('OPENAI_API_KEY is missing.');
    }
    const baseUrl = settings.openai.baseUrl.replace(/\/$/, '');
    const messages: ChatCompletionRequest['messages'] = [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userContent },
    ];
    const request: ChatCompletionRequest = {
      model: settings.openai.model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    };
    let data: ChatCompletionResponse;
    try {
      data = await this.chatCompletion(baseUrl, settings.openai.apiKey, request);
    } catch (error) {
      const message = sanitizeError(error);
      if (!supportsResponseFormatRetry(message)) throw error;
      data = await this.chatCompletion(baseUrl, settings.openai.apiKey, {
        model: settings.openai.model,
        messages: [
          { role: 'system', content: `${systemPrompt()}\nReturn a single JSON object only. No markdown.` },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
      });
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Model returned no content.');
    return analysisSchema.parse(extractJsonObject(content));
  }

  private async chatCompletion(
    baseUrl: string,
    apiKey: string,
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'x-title': 'Mail Automation',
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI-compatible request failed: ${response.status} ${text}`);
    }
    return (await response.json()) as ChatCompletionResponse;
  }
}
