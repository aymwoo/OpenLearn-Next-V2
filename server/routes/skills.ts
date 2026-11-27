/**
 * Skill 运行时路由（P0 备课 / P1 设置 / P2 课堂）。
 *
 * 产物落库不在这里「另起一套写通道」：
 * - 备课：返回环节草稿，前端确认后走既有 `PUT /api/lessons/:id/timeline`；
 * - 设置：只产出受控 `config_patch`，管理员确认后由本路由调用既有
 *   `setRuntimePolicies`，并保存旧值快照用于回滚；
 * - 课堂：教师确认后调用既有 `whiteboardService.drawElement` 投屏。
 */

import crypto from 'node:crypto';
import { filterXSS } from 'xss';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { recordSecurityAudit } from '../../packages/core/observability/audit-log.js';
import { getActorId, requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { sendSafeError } from '../utils/error-handler.js';
import { detectPromptInjection } from '../utils/crypto.js';
import { resolveAccessibleAiProvider } from '../services/ai-provider-resolver.js';
import { checkLessonOwnership } from './lessons.js';
import { authorizeClass } from '../services/class-access.js';
import { loadLessonClassId } from '../services/classroom-class-lock.js';
import { whiteboardService } from '../services/whiteboard-service.js';
import { emitClassroomEvent } from '../presence.js';
import { lessonActiveSegments } from '../shared-state.js';
import {
  resolveRuntimePolicies,
  setRuntimePolicies,
  type RuntimePoliciesSnapshot,
  type RuntimePolicyPatch,
} from '../services/runtime-policies.js';
import {
  CONFIG_PATCH_KEYS,
  collectSkillDescriptors,
  getSkillDescriptor,
  isSkillVisible,
  listSkillCatalog,
  normalizeConfigPatch,
  parseSkillArtifact,
  type SkillRole,
  type SkillSurface,
} from '../skill-registry.js';
import { executeSkillScript, SkillScriptError } from '../skill-script-sandbox.js';
import {
  deleteSkillBinding,
  finishSkillRun,
  getConfigRollback,
  listSkillRuns,
  loadSkillBindings,
  markConfigRollbackApplied,
  saveConfigRollback,
  setSkillSetting,
  startSkillRun,
  upsertSkillBinding,
  type SkillScopeType,
} from '../skill-store.js';
import type { ServerContext } from '../context.js';

const VALID_SURFACES: readonly SkillSurface[] = ['lesson_prep', 'admin_settings', 'classroom_live'];

const normalizeSurface = (value: unknown): SkillSurface =>
  typeof value === 'string' && (VALID_SURFACES as readonly string[]).includes(value)
    ? (value as SkillSurface)
    : 'lesson_prep';

interface RequestSession {
  role?: string;
  userId?: string;
  username?: string;
}

const readSession = (req: unknown): RequestSession | undefined => (req as { session?: RequestSession }).session;

const loadLesson = (lessonId: string) =>
  kernelContainer.db.prepare('SELECT id, title, content, timeline FROM lessons WHERE id = ?').get(lessonId) as
    { id: string; title?: string; content?: string; timeline?: string } | undefined;

const buildLessonContext = (lesson: { title?: string; content?: string; timeline?: string }): string =>
  [
    '[Lesson Context]',
    `title: ${lesson.title ?? ''}`,
    lesson.timeline ? `existing_segments: ${String(lesson.timeline).slice(0, 2000)}` : '',
    lesson.content ? `content_excerpt: ${String(lesson.content).slice(0, 2000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

const buildAdminContext = (snapshot: RuntimePoliciesSnapshot): string =>
  [
    '[Runtime Policies]',
    `hookTelemetryEnabled=${String(snapshot.hookTelemetry.storedValue)}`,
    `httpAccessLogMode=${String(snapshot.httpAccessLog.storedMode)}`,
    `httpAccessLogIgnore=${String(snapshot.httpAccessLog.storedIgnore)}`,
    `httpSlowMs=${String(snapshot.httpAccessLog.storedSlowMs)}`,
    `allowUnsignedByDefault=${String(snapshot.allowUnsigned.storedValue)}`,
    `modePacksEnabled=${String(snapshot.modePacks.storedValue)}`,
    `modePackShowXueanTab=${String(snapshot.modePacks.storedShowXueanTab)}`,
    `allowed_keys=${CONFIG_PATCH_KEYS.join(',')}`,
  ].join('\n');

const buildClassroomContext = (params: { lessonId: string; classId: string; stage?: string }): string => {
  const lesson = loadLesson(params.lessonId);
  const cls = kernelContainer.db.prepare('SELECT id, name FROM classes WHERE id = ?').get(params.classId) as
    { id: string; name?: string } | undefined;
  const activeSegment = lessonActiveSegments.get(params.lessonId);
  return [
    '[Classroom Context]',
    `class: ${cls?.name ?? params.classId}`,
    lesson ? buildLessonContext(lesson) : '',
    params.stage ? `stage: ${params.stage}` : '',
    activeSegment ? `active_segment: ${activeSegment}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

/** 从策略快照提取「本次 patch 相关字段的旧值」，用于回滚。 */
const previousValuesForPatch = (snapshot: RuntimePoliciesSnapshot, changes: Record<string, unknown>) => {
  const previous: Record<string, unknown> = {};
  if ('hookTelemetryEnabled' in changes) previous.hookTelemetryEnabled = snapshot.hookTelemetry.storedValue;
  if ('httpAccessLogMode' in changes) previous.httpAccessLogMode = snapshot.httpAccessLog.storedMode;
  if ('httpAccessLogIgnore' in changes) previous.httpAccessLogIgnore = snapshot.httpAccessLog.storedIgnore;
  if ('httpSlowMs' in changes) previous.httpSlowMs = snapshot.httpAccessLog.storedSlowMs;
  if ('allowUnsignedByDefault' in changes) previous.allowUnsignedByDefault = snapshot.allowUnsigned.storedValue;
  if ('modePacksEnabled' in changes) previous.modePacksEnabled = snapshot.modePacks.storedValue;
  if ('modePackShowXueanTab' in changes) previous.modePackShowXueanTab = snapshot.modePacks.storedShowXueanTab;
  return previous;
};

const toCatalogEntry = (skill: ReturnType<typeof listSkillCatalog>[number]) => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  whenToUse: skill.whenToUse,
  surfaces: skill.surfaces,
  roles: skill.roles ?? null,
  outputKind: skill.outputKind,
  latencyClass: skill.latencyClass,
  requiresConfirm: skill.requiresConfirm === true,
  source: skill.source,
  enabled: skill.enabled,
  toolCount: skill.tools.length,
});

export function registerSkillRoutes(ctx: ServerContext) {
  const { app, runOpenAIAgentChat, aiLimiter, io } = ctx;

  // ── 技能目录（按场景 + 角色 + 细粒度绑定）──────────────────────────────
  app.get('/api/skills', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const role = readSession(req)?.role;
      const surface = normalizeSurface(req.query.surface);
      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : null;
      const classId = typeof req.query.classId === 'string' ? req.query.classId : null;
      const skills = listSkillCatalog({ surface, role, lessonId, classId }).map(toCatalogEntry);
      res.json({ success: true, surface, skills });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  // ── 运行技能（预览态，不落业务数据）──────────────────────────────────────
  app.post('/api/skills/:id/run', requireAuth('teacher', 'administrator'), aiLimiter, async (req, res) => {
    try {
      const session = readSession(req);
      const callerRole = session?.role;
      const lang = req.body?.lang === 'en' ? 'en' : 'zh';
      const surface = normalizeSurface(req.body?.surface);
      const lessonId = typeof req.body?.lessonId === 'string' ? req.body.lessonId.trim() : '';
      const classId = typeof req.body?.classId === 'string' ? req.body.classId.trim() : '';
      const stage = typeof req.body?.stage === 'string' ? req.body.stage.trim().slice(0, 64) : '';

      const skill = getSkillDescriptor(req.params.id, { surface, lessonId, classId });
      if (!skill) {
        return res.status(404).json({ success: false, error: 'SKILL_NOT_FOUND' });
      }
      if (!isSkillVisible(skill, surface, callerRole)) {
        return res.status(403).json({ success: false, error: 'SKILL_FORBIDDEN' });
      }

      if (surface === 'admin_settings') {
        if (callerRole !== 'administrator') {
          return res.status(403).json({ success: false, error: 'ADMIN_ONLY' });
        }
      } else if (surface === 'classroom_live') {
        if (!lessonId || !classId) {
          return res.status(400).json({ success: false, error: 'LESSON_AND_CLASS_REQUIRED' });
        }
        const decision = authorizeClass(kernelContainer.db, session, classId, 'staff');
        if (!decision.ok) {
          return res.status(decision.status).json({ success: false, error: decision.error });
        }
        const boundClassId = loadLessonClassId(kernelContainer.db, lessonId);
        if (boundClassId && boundClassId !== classId) {
          return res.status(403).json({ success: false, error: 'LESSON_CLASS_MISMATCH' });
        }
      } else {
        if (!lessonId) {
          return res.status(400).json({ success: false, error: 'LESSON_REQUIRED' });
        }
        const ownership = checkLessonOwnership(req, lessonId);
        if (!ownership.allowed) {
          return res.status(ownership.status).json({ success: false, error: ownership.error });
        }
      }

      const lesson = lessonId ? loadLesson(lessonId) : undefined;
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
      const isScriptSkill = !!skill.script;
      let provider: ReturnType<typeof resolveAccessibleAiProvider> | null = null;
      if (!isScriptSkill) {
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
      }

      const runId = startSkillRun({
        skillId: skill.id,
        surface,
        actorId: getActorId(req),
        scope: { lessonId: lessonId || null, classId: classId || null, stage: stage || null },
      });

      let text = '';
      let artifact: ReturnType<typeof parseSkillArtifact> = null;
      let scriptLogs: string[] = [];
      let durationMs: number | null = null;
      let toolResults: unknown[] = [];
      let pendingConfirmations: unknown[] = [];

      if (isScriptSkill) {
        // 脚本类技能：确定性执行，不经过大模型，也不需要 AI Provider。
        try {
          const scriptResult = executeSkillScript(skill, {
            surface,
            lessonId: lessonId || null,
            classId: classId || null,
            stage: stage || null,
            userInput: rawInput,
            lang,
          });
          artifact = scriptResult.artifact;
          scriptLogs = scriptResult.logs;
          durationMs = scriptResult.durationMs;
          text = JSON.stringify(scriptResult.artifact);
        } catch (err) {
          const code = err instanceof SkillScriptError ? err.code : 'SCRIPT_ERROR';
          finishSkillRun(runId, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
          return res.status(400).json({
            success: false,
            error: code,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        if (!provider) {
          finishSkillRun(runId, { status: 'failed', error: 'NO_AI_PROVIDER' });
          return res.status(400).json({ success: false, error: 'NO_AI_PROVIDER' });
        }
        const contextBlock =
          surface === 'admin_settings'
            ? buildAdminContext(resolveRuntimePolicies(kernelContainer.db))
            : surface === 'classroom_live'
              ? buildClassroomContext({ lessonId, classId, stage })
              : lesson
                ? buildLessonContext(lesson)
                : '';
        const message = contextBlock ? `${contextBlock}\n\n[Request]\n${rawInput}` : rawInput;
        try {
          const result = await runOpenAIAgentChat(provider, {
            message,
            lang,
            currentLessonId: lessonId || null,
            callerRole,
            actorId: getActorId(req),
            surface,
            skillId: skill.id,
          });
          text = typeof result?.agentText === 'string' ? result.agentText : '';
          artifact = parseSkillArtifact(skill, text);
          toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
          pendingConfirmations = Array.isArray(result?.pendingConfirmations) ? result.pendingConfirmations : [];
        } catch (err) {
          finishSkillRun(runId, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
          throw err;
        }
      }

      finishSkillRun(runId, { status: 'succeeded', artifactKind: artifact?.kind ?? null });

      kernelContainer.eventBus
        .publish({
          id: crypto.randomUUID(),
          type: 'skill.run.completed',
          source: 'skill-runtime',
          payload: {
            runId,
            skillId: skill.id,
            surface,
            artifactKind: artifact?.kind ?? null,
            actorId: getActorId(req),
          },
          timestamp: Date.now(),
          correlationId: runId,
        })
        .catch(() => {
          /* 事件总线不可用时不影响运行结果 */
        });
      if (surface === 'classroom_live' && lessonId) {
        emitClassroomEvent(io, lessonId, 'skill:run', {
          runId,
          skillId: skill.id,
          artifactKind: artifact?.kind ?? null,
        });
      }

      res.json({
        success: true,
        runId,
        skill: { id: skill.id, name: skill.name, outputKind: skill.outputKind, script: isScriptSkill },
        surface,
        text,
        artifact,
        toolResults,
        pendingConfirmations,
        ...(isScriptSkill ? { logs: scriptLogs, durationMs } : {}),
      });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  // ── P2：课堂卡片投屏（教师确认后写入白板）────────────────────────────────
  app.post('/api/skills/:id/apply-card', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const session = readSession(req);
      const lessonId = typeof req.body?.lessonId === 'string' ? req.body.lessonId.trim() : '';
      const classId = typeof req.body?.classId === 'string' ? req.body.classId.trim() : '';
      const card = req.body?.card as { title?: unknown; body?: unknown } | undefined;
      if (!lessonId || !classId) {
        return res.status(400).json({ success: false, error: 'LESSON_AND_CLASS_REQUIRED' });
      }
      const skill = getSkillDescriptor(req.params.id, { surface: 'classroom_live', lessonId, classId });
      if (!skill || skill.outputKind !== 'classroom_card') {
        return res.status(404).json({ success: false, error: 'SKILL_NOT_FOUND' });
      }
      if (!isSkillVisible(skill, 'classroom_live', session?.role)) {
        return res.status(403).json({ success: false, error: 'SKILL_FORBIDDEN' });
      }
      const decision = authorizeClass(kernelContainer.db, session, classId, 'staff');
      if (!decision.ok) {
        return res.status(decision.status).json({ success: false, error: decision.error });
      }
      const boundClassId = loadLessonClassId(kernelContainer.db, lessonId);
      if (boundClassId && boundClassId !== classId) {
        return res.status(403).json({ success: false, error: 'LESSON_CLASS_MISMATCH' });
      }
      const lesson = loadLesson(lessonId);
      if (!lesson) {
        return res.status(404).json({ success: false, error: 'LESSON_NOT_FOUND' });
      }

      const title = filterXSS(String(card?.title ?? ''))
        .trim()
        .slice(0, 60);
      const body = filterXSS(String(card?.body ?? ''))
        .trim()
        .slice(0, 2000);
      if (!title && !body) {
        return res.status(400).json({ success: false, error: 'CARD_EMPTY' });
      }

      const segmentId = lessonActiveSegments.get(lessonId);
      const actorId = getActorId(req);
      const result = await whiteboardService.drawElement({
        lessonId,
        type: 'text',
        actorId,
        data: {
          x: 80,
          y: 80,
          text: [title, body].filter(Boolean).join('\n\n'),
          fontSize: 18,
          color: '#0f172a',
          page: 0,
          ...(segmentId ? { segmentId } : {}),
        },
      });

      recordSecurityAudit('skill.artifact_applied', {
        skillId: skill.id,
        lessonId,
        classId,
        actorId,
        kind: 'classroom_card',
      });
      const elementId = (result as { elementId?: string } | null)?.elementId ?? null;
      emitClassroomEvent(io, lessonId, 'skill:card', { title, body, elementId });
      // `text` 属于 LAYOUT_ONLY_ELEMENT_TYPES，不会自动触发白板刷新广播；
      // 投屏是教师显式动作，这里补一次 refresh，让课堂端立即看到卡片。
      emitClassroomEvent(io, lessonId, 'whiteboard-sync', { roomId: lessonId, type: 'refresh' });

      res.json({ success: true, elementId });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  // ── P1：config_patch 应用与回滚 ─────────────────────────────────────────
  app.post('/api/skills/:id/apply-config', requireAuth('administrator'), (req, res) => {
    try {
      const skill = getSkillDescriptor(req.params.id, { surface: 'admin_settings' });
      if (!skill || skill.outputKind !== 'config_patch') {
        return res.status(404).json({ success: false, error: 'SKILL_NOT_FOUND' });
      }
      const changes = normalizeConfigPatch(req.body?.changes);
      if (!changes || Object.keys(changes).length === 0) {
        return res.status(400).json({ success: false, error: 'EMPTY_OR_INVALID_PATCH' });
      }
      const runId = typeof req.body?.runId === 'string' && req.body.runId.trim() ? req.body.runId.trim() : '';
      if (!runId) {
        return res.status(400).json({ success: false, error: 'RUN_ID_REQUIRED' });
      }

      const before = resolveRuntimePolicies(kernelContainer.db);
      const previous = previousValuesForPatch(before, changes);
      const snapshot = setRuntimePolicies(kernelContainer.db, changes as RuntimePolicyPatch);
      saveConfigRollback({
        runId,
        patch: changes,
        previous,
        appliedBy: getActorId(req),
      });
      recordSecurityAudit('skill.config_patch_applied', {
        skillId: skill.id,
        runId,
        actorId: getActorId(req),
        keys: Object.keys(changes),
      });
      res.json({ success: true, policies: snapshot, applied: changes, rollbackRunId: runId });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  app.post('/api/admin/skill-runs/:runId/rollback', requireAuth('administrator'), (req, res) => {
    try {
      const record = getConfigRollback(req.params.runId);
      if (!record) {
        return res.status(404).json({ success: false, error: 'ROLLBACK_NOT_FOUND' });
      }
      if (record.rolledBackAt) {
        return res.status(409).json({ success: false, error: 'ALREADY_ROLLED_BACK' });
      }
      const snapshot = setRuntimePolicies(kernelContainer.db, record.previous as RuntimePolicyPatch);
      markConfigRollbackApplied(req.params.runId, getActorId(req));
      recordSecurityAudit('skill.config_patch_rolled_back', {
        runId: req.params.runId,
        actorId: getActorId(req),
        keys: Object.keys(record.previous),
      });
      res.json({ success: true, policies: snapshot });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  // ── P1：管理端技能管理 ─────────────────────────────────────────────────
  app.get('/api/admin/skills', requireAuth('administrator'), (_req, res) => {
    try {
      const skills = collectSkillDescriptors({ includeDisabled: true }).map(toCatalogEntry);
      res.json({ success: true, skills });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  app.patch('/api/admin/skills/:id', requireAuth('administrator'), (req, res) => {
    try {
      const skill = getSkillDescriptor(req.params.id, { includeDisabled: true });
      if (!skill) {
        return res.status(404).json({ success: false, error: 'SKILL_NOT_FOUND' });
      }
      const enabled = req.body?.enabled;
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'INVALID_ENABLED' });
      }
      let surfaces: SkillSurface[] | null | undefined;
      if (req.body?.surfaces !== undefined) {
        if (req.body.surfaces === null) {
          surfaces = null;
        } else if (Array.isArray(req.body.surfaces)) {
          const parsed = req.body.surfaces.filter(
            (item: unknown): item is SkillSurface =>
              typeof item === 'string' && (VALID_SURFACES as readonly string[]).includes(item),
          );
          if (parsed.length !== req.body.surfaces.length) {
            return res.status(400).json({ success: false, error: 'INVALID_SURFACES' });
          }
          surfaces = parsed;
        } else {
          return res.status(400).json({ success: false, error: 'INVALID_SURFACES' });
        }
      }
      if (enabled === undefined && surfaces === undefined) {
        return res.status(400).json({ success: false, error: 'EMPTY_PATCH' });
      }
      const saved = setSkillSetting(req.params.id, { enabled, surfaces }, getActorId(req));
      recordSecurityAudit('admin.skill_setting_updated', {
        skillId: req.params.id,
        actorId: getActorId(req),
        enabled: saved.enabled,
        surfaces: saved.surfaces ?? null,
      });
      res.json({ success: true, setting: saved });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  app.get('/api/admin/skill-runs', requireAuth('administrator'), (req, res) => {
    try {
      const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
      res.json({ success: true, runs: listSkillRuns(Number.isFinite(limitRaw) ? limitRaw : 50) });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  // ── 细粒度绑定（全局 / 班级 / 课节）──────────────────────────────────────
  app.get('/api/admin/skills/:id/bindings', requireAuth('administrator'), (req, res) => {
    try {
      const skill = getSkillDescriptor(req.params.id, { includeDisabled: true });
      if (!skill) {
        return res.status(404).json({ success: false, error: 'SKILL_NOT_FOUND' });
      }
      const bindings = loadSkillBindings().filter((binding) => binding.skillId === skill.id);
      res.json({ success: true, bindings });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  app.put('/api/admin/skills/:id/bindings', requireAuth('administrator'), (req, res) => {
    try {
      const skill = getSkillDescriptor(req.params.id, { includeDisabled: true });
      if (!skill) {
        return res.status(404).json({ success: false, error: 'SKILL_NOT_FOUND' });
      }
      const surface = normalizeSurface(req.body?.surface);
      if (!skill.surfaces.includes(surface)) {
        return res.status(400).json({ success: false, error: 'SURFACE_NOT_SUPPORTED' });
      }
      const scopeType = req.body?.scopeType as SkillScopeType;
      if (scopeType !== 'global' && scopeType !== 'class' && scopeType !== 'lesson') {
        return res.status(400).json({ success: false, error: 'INVALID_SCOPE_TYPE' });
      }
      if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'INVALID_ENABLED' });
      }
      const scopeId = scopeType === 'global' ? '' : String(req.body?.scopeId ?? '').trim();
      if (scopeType !== 'global' && !scopeId) {
        return res.status(400).json({ success: false, error: 'SCOPE_ID_REQUIRED' });
      }
      if (scopeType === 'class') {
        const exists = kernelContainer.db.prepare('SELECT 1 AS ok FROM classes WHERE id = ?').get(scopeId);
        if (!exists) return res.status(404).json({ success: false, error: 'CLASS_NOT_FOUND' });
      }
      if (scopeType === 'lesson') {
        const exists = kernelContainer.db.prepare('SELECT 1 AS ok FROM lessons WHERE id = ?').get(scopeId);
        if (!exists) return res.status(404).json({ success: false, error: 'LESSON_NOT_FOUND' });
      }

      let roles: SkillRole[] | null = null;
      if (req.body?.roles !== undefined && req.body.roles !== null) {
        if (!Array.isArray(req.body.roles)) {
          return res.status(400).json({ success: false, error: 'INVALID_ROLES' });
        }
        const validRoles: readonly SkillRole[] = ['administrator', 'teacher', 'student'];
        const parsedRoles = req.body.roles.filter(
          (item: unknown): item is SkillRole =>
            typeof item === 'string' && (validRoles as readonly string[]).includes(item),
        );
        if (parsedRoles.length !== req.body.roles.length) {
          return res.status(400).json({ success: false, error: 'INVALID_ROLES' });
        }
        roles = parsedRoles;
      }

      const binding = upsertSkillBinding({
        skillId: skill.id,
        surface,
        scopeType,
        scopeId,
        enabled: req.body.enabled,
        roles,
        actorId: getActorId(req),
      });
      recordSecurityAudit('admin.skill_binding_updated', {
        skillId: skill.id,
        surface,
        scopeType,
        scopeId: binding.scopeId,
        enabled: binding.enabled,
        roles: binding.roles ?? null,
        actorId: getActorId(req),
      });
      res.json({ success: true, binding });
    } catch (err) {
      sendSafeError(res, err);
    }
  });

  app.delete('/api/admin/skills/:id/bindings', requireAuth('administrator'), (req, res) => {
    try {
      const skill = getSkillDescriptor(req.params.id, { includeDisabled: true });
      if (!skill) {
        return res.status(404).json({ success: false, error: 'SKILL_NOT_FOUND' });
      }
      const surface = normalizeSurface(req.query.surface);
      const scopeType = req.query.scopeType as SkillScopeType;
      if (scopeType !== 'global' && scopeType !== 'class' && scopeType !== 'lesson') {
        return res.status(400).json({ success: false, error: 'INVALID_SCOPE_TYPE' });
      }
      const scopeId = scopeType === 'global' ? '' : String(req.query.scopeId ?? '').trim();
      const removed = deleteSkillBinding({ skillId: skill.id, surface, scopeType, scopeId });
      recordSecurityAudit('admin.skill_binding_removed', {
        skillId: skill.id,
        surface,
        scopeType,
        scopeId,
        removed,
        actorId: getActorId(req),
      });
      res.json({ success: true, removed });
    } catch (err) {
      sendSafeError(res, err);
    }
  });
}
