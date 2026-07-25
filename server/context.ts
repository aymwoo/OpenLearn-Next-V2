import express from 'express';
import type { Server } from 'socket.io';
import type { ActivityRegistry } from '../packages/activity-ecosystem/index.js';

// ── Shared AI-agent types (previously declared at the top of server.ts) ──
export type AgentChatAttachment = { name: string; content: string };

/**
 * A single persisted turn of an agent conversation. Only `user`/`assistant`
 * text turns are stored (attachments are intentionally omitted to keep the
 * memory store compact). The `assistant` role is mapped to Gemini's `model`
 * role at injection time.
 */
export type AgentChatTurn = { role: 'user' | 'assistant'; content: string };

export type AgentChatRequest = {
  message: string;
  lang?: 'zh' | 'en';
  currentLessonId?: string | null;
  attachments?: AgentChatAttachment[];
  providerId?: string | null;
  callerRole?: string;
  /** Prior conversation turns (oldest first) used to give the agent memory. */
  history?: AgentChatTurn[];
};
export type AgentToolExecution = {
  callName: string;
  success: boolean;
  result?: any;
  error?: string;
};
export type StoredAIProvider = {
  id: string;
  name: string;
  api_url: string;
  api_key?: string | null;
  model_name: string;
};

/**
 * ServerContext bundles every piece of server-level state/behaviour that the
 * extracted route modules depend on. The Express `app`, the Socket.IO `io`
 * instance, the login rate-limiter, the in-memory caches and the AI-agent
 * helper functions all live here so that route modules can be pure
 * extractions of the original `server.ts` handlers (no logic changed — only
 * the surrounding wiring).
 */
export interface ServerContext {
  app: express.Express;
  io: Server;
  loginLimiter: any;
  activityRegistry: ActivityRegistry;
  MF_REMOTE_CACHE: Map<string, { entry: string; meta: Record<string, any> }>;
  lessonActiveSegments: Map<string, string>;
  buildAgentSystemInstruction: (lang: 'zh' | 'en', currentLessonId?: string | null) => string;
  buildAgentFinalMessage: (message: string, attachments?: AgentChatAttachment[]) => string;
  normalizeToolSchema: (schema: any) => any;
  buildOpenAITools: () => any[];
  executeAgentToolCall: (
    toolName: string,
    args: any,
    allExecutedTools: AgentToolExecution[],
    callerRole?: string,
    currentLessonId?: string | null
  ) => Promise<any>;
  buildOpenAIChatUrl: (apiUrl: string) => string;
  runGeminiAgentChat: (request: AgentChatRequest) => Promise<any>;
  runOpenAIAgentChat: (provider: StoredAIProvider, request: AgentChatRequest) => Promise<any>;
}
