/**
 * OpenLearn AI Infrastructure - Conversation Service
 * Manages multi-turn conversation history, session memory, and tool execution logs.
 */

import { ConversationSession, ConversationMessage } from '../types/index.js';
import { AIEventBus } from '../event/ai-event-bus.js';

export class ConversationService {
  private sessions = new Map<string, ConversationSession>();
  private eventBus: AIEventBus;

  constructor(eventBus: AIEventBus) {
    this.eventBus = eventBus;
  }

  public createSession(title = 'New Conversation'): ConversationSession {
    const id = `conv_${globalThis.crypto.randomUUID()}`;
    const now = Date.now();
    const session: ConversationSession = Object.freeze({
      id,
      title,
      messages: Object.freeze([]),
      createdAt: now,
      updatedAt: now,
    });

    this.sessions.set(id, session);
    this.eventBus.publish('ConversationCreated', { conversationId: id });
    return session;
  }

  public addMessage(
    sessionId: string,
    role: ConversationMessage['role'],
    content: string,
    toolCalls?: ReadonlyArray<Record<string, unknown>>,
    toolResults?: ReadonlyArray<import('../types/index.js').ToolExecutionResult>
  ): ConversationMessage {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = this.createSession();
    }

    const msg: ConversationMessage = Object.freeze({
      id: `msg_${globalThis.crypto.randomUUID()}`,
      role,
      content,
      timestamp: Date.now(),
      toolCalls,
      toolResults,
    });

    const updatedMessages = [...session.messages, msg];
    const updatedSession: ConversationSession = Object.freeze({
      ...session,
      messages: Object.freeze(updatedMessages),
      updatedAt: Date.now(),
    });

    this.sessions.set(session.id, updatedSession);
    return msg;
  }

  public getSession(sessionId: string): ConversationSession | undefined {
    return this.sessions.get(sessionId);
  }

  public listSessions(): ReadonlyArray<ConversationSession> {
    return Object.freeze(Array.from(this.sessions.values()));
  }

  public clear(): void {
    this.sessions.clear();
  }
}
