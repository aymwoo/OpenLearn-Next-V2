import express from 'express';
import type { Server } from 'socket.io';
import type { ActivityRegistry } from '../packages/activity-ecosystem/index.js';
import type { ActivityCompletedTracker } from './services/activity-completed-tracker.js';

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
  actorId?: string;
  /** P2: ai.agent.persona —— 选定的角色模板 id（面板下拉；空 = 默认助教） */
  personaId?: string | null;
  /** P0 Skill 运行时：调用场景（决定技能目录与可见性） */
  surface?: 'lesson_prep' | 'admin_settings' | 'classroom_live';
  /** P0 Skill 运行时：选定的技能 id（空 = 不启用技能收窄，保持旧行为） */
  skillId?: string | null;
  /** 细粒度绑定：当前课节 / 班级（用于解析 lesson > class > global 的绑定） */
  classId?: string | null;
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
  studentLookupLimiter?: express.RequestHandler;
  aiLimiter: any;
  activityRegistry: ActivityRegistry;
  /**
   * `activity.completed` 内存聚合器（可选）。
   * 未注入时依赖它的只读接口退化为 null，不影响任何既有字段。
   */
  activityCompletedTracker?: ActivityCompletedTracker;
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
    currentLessonId?: string | null,
  ) => Promise<any>;
  buildOpenAIChatUrl: (apiUrl: string) => string;
  runGeminiAgentChat: (request: AgentChatRequest) => Promise<any>;
  runOpenAIAgentChat: (provider: StoredAIProvider, request: AgentChatRequest) => Promise<any>;
}
