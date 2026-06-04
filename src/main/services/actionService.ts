import { randomUUID } from 'node:crypto';
import type {
  ActionRecord,
  CalendarProposal,
  ChatCommandResult,
  EmailAnalysis,
  EmailItem,
  SuggestedReply,
} from '../../shared/types';
import type { AppDatabase } from './database';
import type { GmailService } from './gmailService';
import type { CalendarService } from './calendarService';
import { nowIso } from './time';

interface ReplyActionPayload {
  emailId: string;
  reply: SuggestedReply;
}

interface CalendarActionPayload {
  emailId?: string;
  proposal: CalendarProposal;
}

export class ActionService {
  constructor(
    private readonly db: AppDatabase,
    private readonly gmail: GmailService,
    private readonly calendar: CalendarService,
  ) {}

  async persistAnalysis(email: EmailItem, analysis: EmailAnalysis): Promise<EmailAnalysis> {
    const actions = await this.createActions(analysis, email.id);
    const next = this.attachActionIds(analysis, actions);
    await this.db.setEmailAnalysis(email.id, next);
    await this.db.addAudit({
      id: randomUUID(),
      type: 'agent.analysis',
      summary: `Analyzed email: ${email.subject}`,
      data: { emailId: email.id, intent: next.intent },
      createdAt: nowIso(),
    });
    return next;
  }

  async persistChatAnalysis(analysis: EmailAnalysis): Promise<ChatCommandResult> {
    const actions = await this.createActions(analysis);
    const next = this.attachActionIds(analysis, actions);
    await this.db.addAudit({
      id: randomUUID(),
      type: 'agent.chat_command',
      summary: next.summary,
      data: { intent: next.intent },
      createdAt: nowIso(),
    });
    return { analysis: next, actions };
  }

  async approve(actionId: string): Promise<ActionRecord> {
    const action = this.db.getAction(actionId);
    if (!action) throw new Error(`Action not found: ${actionId}`);
    if (action.status === 'sent') return action;
    if (action.status === 'cancelled') throw new Error('Cannot approve a cancelled action.');

    await this.db.updateAction(action.id, {
      status: 'approved',
      approvedAt: nowIso(),
    });

    try {
      if (action.kind === 'email_reply') {
        const payload = action.payload as ReplyActionPayload;
        const result = await this.gmail.sendReply({
          emailId: payload.emailId,
          body: payload.reply.body,
        });
        const updated = await this.db.updateAction(action.id, {
          status: 'sent',
          result,
          error: undefined,
        });
        await this.db.addAudit({
          id: randomUUID(),
          actionId: action.id,
          type: 'action.email_sent',
          summary: `Approved and sent reply: ${payload.reply.title}`,
          data: result,
          createdAt: nowIso(),
        });
        return updated ?? action;
      }

      const payload = action.payload as CalendarActionPayload;
      const freeBusy = await this.calendar.checkFreeBusy(payload.proposal);
      if (freeBusy.busy) {
        throw new Error('Primary calendar is busy for the proposed time.');
      }
      const result = await this.calendar.createEvent(payload.proposal);
      const updated = await this.db.updateAction(action.id, {
        status: 'sent',
        result,
        error: undefined,
      });
      await this.db.addAudit({
        id: randomUUID(),
        actionId: action.id,
        type: 'action.calendar_created',
        summary: `Approved and created event: ${payload.proposal.summary}`,
        data: result,
        createdAt: nowIso(),
      });
      return updated ?? action;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await this.db.updateAction(action.id, {
        status: 'failed',
        error: message,
      });
      await this.db.addAudit({
        id: randomUUID(),
        actionId: action.id,
        type: 'action.failed',
        summary: message,
        createdAt: nowIso(),
      });
      throw error;
    }
  }

  async sendEditedReply(emailId: string, body: string): Promise<ActionRecord> {
    const email = this.db.getEmail(emailId);
    if (!email) throw new Error(`Email not found: ${emailId}`);
    const action: ActionRecord<ReplyActionPayload> = {
      id: randomUUID(),
      kind: 'email_reply',
      sourceEmailId: emailId,
      status: 'pending',
      payload: {
        emailId,
        reply: {
          id: randomUUID(),
          title: 'Edited reply',
          tone: 'custom',
          body,
        },
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.db.createAction(action);
    return this.approve(action.id);
  }

  async cancel(actionId: string): Promise<ActionRecord> {
    const action = await this.db.updateAction(actionId, {
      status: 'cancelled',
      error: undefined,
    });
    if (!action) throw new Error(`Action not found: ${actionId}`);
    await this.db.addAudit({
      id: randomUUID(),
      actionId,
      type: 'action.cancelled',
      summary: `Cancelled ${action.kind}`,
      createdAt: nowIso(),
    });
    return action;
  }

  private async createActions(
    analysis: EmailAnalysis,
    emailId?: string,
  ): Promise<ActionRecord[]> {
    const actions: ActionRecord[] = [];
    for (const reply of analysis.suggestedReplies) {
      if (!emailId) continue;
      const action: ActionRecord<ReplyActionPayload> = {
        id: randomUUID(),
        kind: 'email_reply',
        sourceEmailId: emailId,
        status: 'pending',
        payload: {
          emailId,
          reply,
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await this.db.createAction(action);
      actions.push(action);
    }

    if (analysis.calendarProposal) {
      const action: ActionRecord<CalendarActionPayload> = {
        id: randomUUID(),
        kind: 'calendar_event',
        sourceEmailId: emailId,
        status: 'pending',
        payload: {
          emailId,
          proposal: analysis.calendarProposal,
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await this.db.createAction(action);
      actions.push(action);
    }
    return actions;
  }

  private attachActionIds(analysis: EmailAnalysis, actions: ActionRecord[]): EmailAnalysis {
    const replyActions = actions.filter((action) => action.kind === 'email_reply');
    const calendarAction = actions.find((action) => action.kind === 'calendar_event');
    return {
      ...analysis,
      suggestedReplies: analysis.suggestedReplies.map((reply, index) => ({
        ...reply,
        actionId: replyActions[index]?.id,
      })),
      calendarProposal: analysis.calendarProposal
        ? { ...analysis.calendarProposal, actionId: calendarAction?.id }
        : undefined,
    };
  }
}
