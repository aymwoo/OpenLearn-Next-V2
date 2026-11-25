/**
 * Skill 运行时路由（P0）。
 *
 * 只做两件事：
 * 1. `GET /api/skills` —— 按场景 + 角色返回技能目录（内置技能 + active 插件贡献）；
 * 2. `POST /api/skills/:id/run` —— 以选定技能为上下文调用现有 Agent 链路，返回
 *    结构化产物（`lesson_segments`）供前端预览。
 *
 * 产物的落库不在本路由内完成：备课端确认后仍走既有
 * `PUT /api/lessons/:id/timeline` → `lesson.update_timeline` 命令，
 * 保持「写操作只经 commandBus + 调用者 actor」的约束。
 */

import crypto from 'node:crypto';
import { filterXSS } from 'xss';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getActorId, requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import { detectPromptInjection } from '../utils/crypto.js';
import { resolveAccessibleAiProvider } from '../services/ai-provider-resolver.js';
import { checkLessonOwnership } from './lessons.js';
import {
  getSkillDescriptor,
  isSkillVisible,
  listSkillCatalog,
  parseSkillArtifact,
  type SkillSurface,
} from '../skill-registry.js';
import type { ServerContext } from '../context.js';

const normalizeSurface = (value: unknown): SkillSurface =>
  value === 'admin_settings' || value === 'classroom_live' ? value : 'lesson_prep';

const toCatalogEntry = (skill: ReturnType<typeof listSkillCatalog>[number]) => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  whenToUse: skill.whenToUse,
  surfaces: skill.surfaces,
  outputKind: skill.outputKind,
  latencyClass: skill.latencyClass,
  requiresConfirm: skill.requiresConfirm === true,
  source: skill.source,
});

export function registerSkillRoutes(ctx: ServerContext) {
  const { app, runOpenAIAgentChat, aiLimiter } = ctx;

  // ── 技能目录 ───────────────────────────────────────────────────────────
  app.get('/api/skills', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const session = (req as { session?: { role?: string } }).session;
      const role = session?.role;
      const surface = normalizeSurface(req.query.surface);
      const skills = listSkillCatalog({ surface, role }).map(toCatalogEntry);
      res.json({ success: true, surface, skills });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  // ── 运行技能（预览态，不落库）──────────────────────────────────────────
  app.post('/api/skills/:id/run', requireAuth('teacher', 'administrator'), aiLimiter, async (req, res) => {
    try {
      const session = (req as { session?: { role?: string; userId?: string; username?: string } }).session;
      const callerRole = session?.role;
      const lang = req.body?.lang === 'en' ? 'en' : 'zh';
      const surface = normalizeSurface(req.body?.surface);
      const lessonId = typeof req.body?.lessonId === 'string' ? req.body.lessonId.trim() : '';

      const skill = getSkillDescriptor(req.params.id);
      if (!skill) {
        return res.status(404).json({ success: false, error: 'SKILL_NOT_FOUND' });
      }
      if (!isSkillVisible(skill, surface, callerRole)) {
        return res.status(403).json({ success: false, error: 'SKILL_FORBIDDEN' });
      }

      if (surface === 'lesson_prep' && !lessonId) {
        return res.status(400).json({ success: false, error: 'LESSON_REQUIRED' });
      }
      if (lessonId) {
        const ownership = checkLessonOwnership(req, lessonId);
        if (!ownership.allowed) {
          return res.status(ownership.status).json({ success: false, error: ownership.error });
        }
      }

      const lesson = lessonId
        ? (kernelContainer.db.prepare('SELECT id, title, content, timeline FROM lessons WHERE id = ?').get(lessonId) as
            { id: string; title?: string; content?: string; timeline?: string } | undefined)
        : undefined;
      if (lessonId && !lesson) {
        return res.status(404).json({ success: false, error: 'LESSON_NOT_FOUND' });
      }

      let rawInput =
        typeof req.body?.input === 'string' && req.body.input.trim()
          ? req.body.input.trim()
          : skill.whenToUse || skill.description;
      rawInput = filterXSS(rawInput);
      if (detectPromptInjection(rawInput)) {
        return res.status(400).json({ success: false, error: 'PROMPT_INJECTION_DETECTED' });
      }

      const userId = session?.userId || session?.username;
      let provider;
      try {
        provider = resolveAccessibleAiProvider(kernelContainer.db, { userId, lang });
      } catch (err: unknown) {
        const errObj = err as { status?: number; code?: string; message?: string };
        return res.status(errObj.status || 400).json({
          success: false,
          error: errObj.code || 'NO_AI_PROVIDER',
          message: errObj.message || 'AI provider error',
        });
      }

      // 把课节上下文压缩成一段可控的 system 侧输入，避免把整份课程内容塞进对话。
      const contextBlock = lesson
        ? [
            `[Lesson Context]`,
            `title: ${lesson.title ?? ''}`,
            lesson.timeline ? `existing_segments: ${lesson.timeline}` : '',
            lesson.content ? `content_excerpt: ${String(lesson.content).slice(0, 2000)}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : '';
      const message = contextBlock ? `${contextBlock}\n\n[Request]\n${rawInput}` : rawInput;

      const result = await runOpenAIAgentChat(provider, {
        message,
        lang,
        currentLessonId: lessonId || null,
        callerRole,
        actorId: getActorId(req),
        surface,
        skillId: skill.id,
      });

      const text = typeof result?.agentText === 'string' ? result.agentText : '';
      res.json({
        success: true,
        runId: `skillsk_${crypto.randomUUID()}`,
        skill: { id: skill.id, name: skill.name, outputKind: skill.outputKind },
        surface,
        text,
        artifact: parseSkillArtifact(skill, text),
        toolResults: Array.isArray(result?.toolResults) ? result.toolResults : [],
        pendingConfirmations: Array.isArray(result?.pendingConfirmations) ? result.pendingConfirmations : [],
      });
    } catch (err) {
      sendSafeError(res, err);
    }
  });
}
