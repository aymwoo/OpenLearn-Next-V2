/**
 * LearningSurface 服务层（阶段 1）。
 *
 * 设计：docs/architecture/learning-surface.md
 *
 * 负责三件事：
 *   ① `LearningContentRef` 的结构校验与序列化（只存引用，不落 HTML 正文）；
 *   ② `learning_surfaces` 的按容器 upsert / 软删；
 *   ③ `learning_surface_attempts` 的懒创建、续用、进度、提交与评分。
 *
 * 权限判定不在这里做：路由层复用 `server/services/class-access.ts` 的口径，
 * 本模块只接收已经过授权的 surface / attempt。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { randomId } from '../utils/id.js';

export const LEARNING_SURFACE_KINDS = ['whiteboard_element', 'lesson_activity', 'assignment', 'lesson_eval'] as const;
export type LearningSurfaceKind = (typeof LEARNING_SURFACE_KINDS)[number];

export const LEARNING_CONTENT_SOURCE_KINDS = ['courseware', 'resource', 'assignment', 'activity', 'inline'] as const;
export type LearningContentSourceKind = (typeof LEARNING_CONTENT_SOURCE_KINDS)[number];

export const LEARNING_ATTEMPT_STATUSES = ['in_progress', 'submitted', 'graded'] as const;
export type LearningAttemptStatus = (typeof LEARNING_ATTEMPT_STATUSES)[number];

/** 渲染器执行方式：内置 inline（React 树内）；插件一律 sandbox。 */
export type RendererExecution = 'inline' | 'sandbox';

export interface LearningContentRef {
  rendererId: string;
  source: {
    kind: LearningContentSourceKind;
    id?: string;
  };
  config?: {
    title?: string;
    height?: number;
    aspectRatio?: string;
    maxAttempts?: number;
    /** presentation + inline 的内联 Markdown（纯文本，限 64KB）。 */
    markdown?: string;
  };
}

export interface LearningSurfaceRow {
  id: string;
  lesson_id: string;
  kind: LearningSurfaceKind;
  owner_id: string;
  content_ref_json: string;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface LearningSurfaceAttemptRow {
  id: string;
  lesson_id: string;
  surface_id: string;
  student_id: string;
  attempt_no: number;
  renderer_id: string;
  status: LearningAttemptStatus;
  auto_score: number | null;
  score: number | null;
  max_score: number | null;
  completion: number | null;
  state_json: string | null;
  is_preview: number;
  submitted_at: number | null;
  graded_at: number | null;
  graded_by: string | null;
  created_at: number;
  updated_at: number;
}

/** attempt + surface 的只读视图（按课时/学生列表时返回）。 */
export interface LearningSurfaceAttemptView extends LearningSurfaceAttemptRow {
  content_ref_json: string;
  surface_kind: LearningSurfaceKind;
  surface_owner_id: string;
  surface_deleted_at: number | null;
}

export interface RendererDescriptor {
  id: string;
  label: string;
  execution: RendererExecution;
  capabilities: string[];
  sourceKinds: LearningContentSourceKind[];
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };
  aspectRatio?: string;
  pluginId?: string;
  /** 插件静态目录下的相对路径；宿主据此在沙箱 iframe 内加载。 */
  view?: string;
}

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** state / 提交负载上限：避免把 attempt 表写成课件内容仓库。 */
export const MAX_STATE_BYTES = 64 * 1024;

/** presentation 内联 Markdown 上限（纯文本，不含脚本）。 */
export const MAX_MARKDOWN_BYTES = 64 * 1024;

const BUILTIN_RENDERERS: readonly RendererDescriptor[] = [
  {
    id: 'presentation',
    label: '演示文稿',
    execution: 'inline',
    capabilities: ['resizable', 'progress'],
    sourceKinds: ['resource', 'inline'],
    defaultSize: { width: 960, height: 540 },
    minSize: { width: 320, height: 240 },
    aspectRatio: '16:9',
  },
  {
    id: 'html_courseware',
    label: 'HTML 课件',
    execution: 'inline',
    capabilities: ['resizable', 'progress', 'submittable'],
    sourceKinds: ['courseware', 'resource', 'inline'],
    defaultSize: { width: 960, height: 540 },
    minSize: { width: 320, height: 240 },
    aspectRatio: '16:9',
  },
  {
    id: 'assignment_submission',
    label: '作业提交',
    execution: 'inline',
    capabilities: ['progress', 'submittable', 'scorable'],
    sourceKinds: ['assignment'],
    defaultSize: { width: 720, height: 480 },
    minSize: { width: 360, height: 240 },
  },
];

const BUILTIN_RENDERER_IDS = new Set(BUILTIN_RENDERERS.map((renderer) => renderer.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function trimString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** 校验 `LearningContentRef`：未知渲染器允许（第三方插件），但结构必须合法。 */
export function validateLearningContentRef(input: unknown): Validation<LearningContentRef> {
  if (!isRecord(input)) return { ok: false, error: 'contentRef must be an object' };

  const rendererId = trimString(input.rendererId, 128);
  if (!rendererId) return { ok: false, error: 'contentRef.rendererId is required' };

  const source = input.source;
  if (!isRecord(source)) return { ok: false, error: 'contentRef.source is required' };
  const kind = trimString(source.kind, 32);
  if (!kind || !(LEARNING_CONTENT_SOURCE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: 'contentRef.source.kind is invalid' };
  }
  const sourceKind = kind as LearningContentSourceKind;

  const sourceId = source.id == null ? undefined : trimString(source.id, 128);
  if (source.kind !== 'inline') {
    if (source.id == null || !sourceId) {
      return { ok: false, error: 'contentRef.source.id is required unless kind is inline' };
    }
  } else if (!BUILTIN_RENDERER_IDS.has(rendererId)) {
    // inline 内容只在宿主内置渲染器内解释，插件渲染器必须走自己的资源引用。
    return { ok: false, error: 'inline content is only supported by built-in renderers' };
  }

  const configInput = input.config;
  if (configInput != null && !isRecord(configInput)) {
    return { ok: false, error: 'contentRef.config must be an object' };
  }

  const config: LearningContentRef['config'] = {};
  if (isRecord(configInput)) {
    if (configInput.title != null) {
      const title = trimString(configInput.title, 200);
      if (!title) return { ok: false, error: 'contentRef.config.title is invalid' };
      config.title = title;
    }
    if (configInput.height != null) {
      const height = Number(configInput.height);
      if (!Number.isFinite(height) || height <= 0 || height > 10000) {
        return { ok: false, error: 'contentRef.config.height is invalid' };
      }
      config.height = Math.round(height);
    }
    if (configInput.aspectRatio != null) {
      const aspectRatio = trimString(configInput.aspectRatio, 32);
      if (!aspectRatio || !/^\d{1,5}:\d{1,5}$/.test(aspectRatio)) {
        return { ok: false, error: 'contentRef.config.aspectRatio is invalid' };
      }
      config.aspectRatio = aspectRatio;
    }
    if (configInput.maxAttempts != null) {
      const maxAttempts = Number(configInput.maxAttempts);
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000) {
        return { ok: false, error: 'contentRef.config.maxAttempts must be an integer between 1 and 1000' };
      }
      config.maxAttempts = maxAttempts;
    }
    if (configInput.markdown != null) {
      // 例外：presentation 的 inline 纯文本 Markdown。仍不落 HTML / 脚本。
      if (rendererId !== 'presentation' || sourceKind !== 'inline') {
        return { ok: false, error: 'contentRef.config.markdown is only supported by inline presentation' };
      }
      if (typeof configInput.markdown !== 'string' || configInput.markdown.length > MAX_MARKDOWN_BYTES) {
        return { ok: false, error: 'contentRef.config.markdown is invalid or too large' };
      }
      config.markdown = configInput.markdown;
    }
  }

  return {
    ok: true,
    value: {
      rendererId,
      source: { kind: sourceKind, ...(sourceId ? { id: sourceId } : {}) },
      ...(Object.keys(config).length > 0 ? { config } : {}),
    },
  };
}

export function parseLearningContentRef(json: string | null | undefined): LearningContentRef | null {
  if (!json) return null;
  try {
    const parsed = validateLearningContentRef(JSON.parse(json));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

export function serializeLearningContentRef(ref: LearningContentRef): string {
  return JSON.stringify(ref);
}

/** 作业定义对应的内容引用（阶段 2 起的统一作业渲染器）。 */
export function assignmentContentRef(assignmentId: string, title: string): LearningContentRef {
  return {
    rendererId: 'assignment_submission',
    source: { kind: 'assignment', id: assignmentId },
    config: { title: title || '作业' },
  };
}

/** 课时级随堂提交（历史 eval-submissions）对应的内容引用。 */
export function lessonEvalContentRef(lessonId: string): LearningContentRef {
  return {
    rendererId: 'assignment_submission',
    source: { kind: 'activity', id: lessonId },
    config: { title: '随堂提交' },
  };
}

// ── 渲染器目录 ───────────────────────────────────────────────────────────

interface PluginRecord {
  id?: string;
  state?: string;
  status?: string;
  manifest?: string | Record<string, unknown> | null;
}

function readActivePluginRecords(): readonly PluginRecord[] {
  try {
    return (kernelContainer.pluginLifecycleManager?.listPlugins() ?? []) as readonly PluginRecord[];
  } catch {
    return [];
  }
}

function parseManifest(record: PluginRecord): Record<string, unknown> | null {
  if (!record.manifest) return null;
  if (typeof record.manifest === 'object') return record.manifest as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(record.manifest);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isActivePlugin(record: PluginRecord): boolean {
  return record.state === 'active' || record.status === 'active';
}

function normalizePluginRenderer(raw: unknown, pluginId: string): RendererDescriptor | null {
  if (!isRecord(raw)) return null;
  const id = trimString(raw.id, 128);
  const label = trimString(raw.label, 120);
  if (!id || !label) return null;

  const view = (() => {
    if (typeof raw.view !== 'string') return null;
    const trimmed = raw.view.trim();
    // 先判绝对路径，再去前导斜杠 —— 否则 `/etc/passwd` 会被洗成相对路径放行。
    if (!trimmed || trimmed.startsWith('/') || trimmed.startsWith('\\')) return null;
    if (trimmed.includes('..') || trimmed.includes('://') || trimmed.includes('\\')) return null;
    return /^[a-zA-Z0-9_\-./]+$/.test(trimmed) ? trimmed : null;
  })();

  const sourceKinds = Array.isArray(raw.sourceKinds)
    ? raw.sourceKinds.filter(
        (kind): kind is LearningContentSourceKind =>
          typeof kind === 'string' && (LEARNING_CONTENT_SOURCE_KINDS as readonly string[]).includes(kind),
      )
    : [];
  if (sourceKinds.length === 0) return null;

  const size = (value: unknown): { width: number; height: number } | null => {
    if (!isRecord(value)) return null;
    const width = Number(value.width);
    const height = Number(value.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width: Math.round(width), height: Math.round(height) };
  };

  const defaultSize = size(raw.defaultSize) ?? { width: 960, height: 540 };
  const minSize = size(raw.minSize) ?? undefined;
  const aspectRatio = trimString(raw.aspectRatio, 32) ?? undefined;
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    id,
    label,
    // 第三方渲染器不允许 inline：安装期/运行时统一降级为 sandbox。
    execution: 'sandbox',
    capabilities,
    sourceKinds,
    defaultSize,
    ...(minSize ? { minSize } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(view ? { view } : {}),
    pluginId,
  };
}

/** 内置渲染器 + 已激活插件声明的渲染器（同 id 时内置优先）。 */
export function listLearningSurfaceRenderers(
  plugins: readonly PluginRecord[] = readActivePluginRecords(),
): RendererDescriptor[] {
  const renderers: RendererDescriptor[] = [...BUILTIN_RENDERERS];
  const seen = new Set(renderers.map((renderer) => renderer.id));

  for (const plugin of plugins) {
    if (!isActivePlugin(plugin)) continue;
    const manifest = parseManifest(plugin);
    if (!manifest) continue;
    const contributes = manifest.contributes;
    if (!isRecord(contributes)) continue;
    const entries = contributes['learning.surface'];
    if (!Array.isArray(entries)) continue;
    const pluginId = typeof manifest.id === 'string' ? manifest.id : plugin.id;
    for (const entry of entries) {
      const renderer = normalizePluginRenderer(entry, pluginId ?? 'unknown');
      if (!renderer) continue;
      if (seen.has(renderer.id)) {
        console.warn(`[learning-surface] 渲染器 id 冲突，已忽略插件 ${pluginId}:${renderer.id}`);
        continue;
      }
      seen.add(renderer.id);
      renderers.push(renderer);
    }
  }

  return renderers;
}

// ── Surface ──────────────────────────────────────────────────────────────

export function getLearningSurface(
  db: Database.Database,
  surfaceId: string,
  options: { includeDeleted?: boolean } = {},
): LearningSurfaceRow | undefined {
  const sql = options.includeDeleted
    ? 'SELECT * FROM learning_surfaces WHERE id = ?'
    : 'SELECT * FROM learning_surfaces WHERE id = ? AND deleted_at IS NULL';
  return db.prepare(sql).get(surfaceId) as LearningSurfaceRow | undefined;
}

export type SurfaceUpsertResult =
  { ok: true; surface: LearningSurfaceRow; created: boolean } | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * 按容器（kind + owner_id）创建或更新 Surface。
 * 同一容器重复保存只更新内容引用；换课时视为冲突，避免 attempt 归属漂移。
 */
export function upsertLearningSurface(
  db: Database.Database,
  input: { lessonId: string; kind: LearningSurfaceKind; ownerId: string; contentRef: LearningContentRef; now?: number },
): SurfaceUpsertResult {
  const { lessonId, kind, ownerId, contentRef } = input;
  if (!ownerId) return { ok: false, status: 400, error: 'ownerId is required' };
  if (!(LEARNING_SURFACE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, status: 400, error: 'Invalid surface kind' };
  }
  // 空字符串是「班级级作业」的显式哨兵（阶段 2 已确认）：这类定义不属于任何课时。
  if (!lessonId && kind !== 'assignment') {
    return { ok: false, status: 400, error: 'lessonId is required' };
  }

  if (lessonId) {
    const lesson = db.prepare('SELECT id FROM lessons WHERE id = ?').get(lessonId) as { id: string } | undefined;
    if (!lesson) return { ok: false, status: 404, error: 'Lesson not found' };
  }

  const now = input.now ?? Date.now();
  const contentRefJson = serializeLearningContentRef(contentRef);
  const existing = db.prepare('SELECT * FROM learning_surfaces WHERE kind = ? AND owner_id = ?').get(kind, ownerId) as
    LearningSurfaceRow | undefined;

  if (existing) {
    if (existing.lesson_id !== lessonId) {
      return { ok: false, status: 409, error: 'Surface owner is already bound to another lesson' };
    }
    db.prepare('UPDATE learning_surfaces SET content_ref_json = ?, deleted_at = NULL, updated_at = ? WHERE id = ?').run(
      contentRefJson,
      now,
      existing.id,
    );
    return { ok: true, surface: getLearningSurface(db, existing.id, { includeDeleted: true })!, created: false };
  }

  const id = randomId('ls_');
  db.prepare(
    `INSERT INTO learning_surfaces
       (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(id, lessonId, kind, ownerId, contentRefJson, now, now);

  return { ok: true, surface: getLearningSurface(db, id, { includeDeleted: true })!, created: true };
}

/** 软删 Surface；attempt 保留，教师历史视图仍可读。 */
export function softDeleteLearningSurface(db: Database.Database, surfaceId: string, now = Date.now()): boolean {
  const result = db
    .prepare('UPDATE learning_surfaces SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(now, now, surfaceId);
  return result.changes > 0;
}

export function maxAttemptsOf(surface: LearningSurfaceRow): number | null {
  const ref = parseLearningContentRef(surface.content_ref_json);
  const maxAttempts = ref?.config?.maxAttempts;
  return typeof maxAttempts === 'number' && maxAttempts > 0 ? maxAttempts : null;
}

// ── Attempt ──────────────────────────────────────────────────────────────

export function getLearningSurfaceAttempt(
  db: Database.Database,
  attemptId: string,
): LearningSurfaceAttemptRow | undefined {
  return db.prepare('SELECT * FROM learning_surface_attempts WHERE id = ?').get(attemptId) as
    LearningSurfaceAttemptRow | undefined;
}

export function listStudentAttempts(
  db: Database.Database,
  input: { studentId: string; lessonId?: string; surfaceId?: string; includePreview?: boolean },
): LearningSurfaceAttemptView[] {
  const filters = ['a.student_id = ?'];
  const params: unknown[] = [input.studentId];
  if (input.lessonId) {
    filters.push('a.lesson_id = ?');
    params.push(input.lessonId);
  }
  if (input.surfaceId) {
    filters.push('a.surface_id = ?');
    params.push(input.surfaceId);
  }
  if (!input.includePreview) filters.push('a.is_preview = 0');

  return db
    .prepare(
      `SELECT a.*, s.content_ref_json, s.kind AS surface_kind, s.owner_id AS surface_owner_id,
              s.deleted_at AS surface_deleted_at
         FROM learning_surface_attempts a
         JOIN learning_surfaces s ON s.id = a.surface_id
        WHERE ${filters.join(' AND ')}
        ORDER BY a.lesson_id ASC, a.surface_id ASC, a.attempt_no DESC`,
    )
    .all(...params) as LearningSurfaceAttemptView[];
}

export function listLessonAttempts(
  db: Database.Database,
  lessonId: string,
  options: { includePreview?: boolean } = {},
): LearningSurfaceAttemptView[] {
  const previewFilter = options.includePreview ? '' : 'AND a.is_preview = 0';
  return db
    .prepare(
      `SELECT a.*, s.content_ref_json, s.kind AS surface_kind, s.owner_id AS surface_owner_id,
              s.deleted_at AS surface_deleted_at
         FROM learning_surface_attempts a
         JOIN learning_surfaces s ON s.id = a.surface_id
        WHERE a.lesson_id = ? ${previewFilter}
        ORDER BY a.surface_id ASC, a.attempt_no ASC, a.student_id ASC`,
    )
    .all(lessonId) as LearningSurfaceAttemptView[];
}

function insertAttempt(
  db: Database.Database,
  surface: LearningSurfaceRow,
  input: { studentId: string; attemptNo: number; isPreview: number; now: number },
): LearningSurfaceAttemptRow {
  const id = randomId('lsa_');
  db.prepare(
    `INSERT INTO learning_surface_attempts
       (id, lesson_id, surface_id, student_id, attempt_no, renderer_id, status, auto_score, score, max_score,
        completion, state_json, is_preview, submitted_at, graded_at, graded_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'in_progress', NULL, NULL, NULL, 0, NULL, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(
    id,
    surface.lesson_id,
    surface.id,
    input.studentId,
    input.attemptNo,
    surfaceRendererId(surface),
    input.isPreview,
    input.now,
    input.now,
  );
  return getLearningSurfaceAttempt(db, id)!;
}

function surfaceRendererId(surface: LearningSurfaceRow): string {
  return parseLearningContentRef(surface.content_ref_json)?.rendererId ?? 'unknown';
}

function latestAttempt(
  db: Database.Database,
  surfaceId: string,
  studentId: string,
  isPreview: number,
): LearningSurfaceAttemptRow | undefined {
  return db
    .prepare(
      `SELECT * FROM learning_surface_attempts
        WHERE surface_id = ? AND student_id = ? AND is_preview = ?
        ORDER BY attempt_no DESC LIMIT 1`,
    )
    .get(surfaceId, studentId, isPreview) as LearningSurfaceAttemptRow | undefined;
}

export interface AttemptCreationResult {
  attempt: LearningSurfaceAttemptRow;
  created: boolean;
  /** 达到 maxAttempts 上限时只读返回最近一次。 */
  readOnly: boolean;
}

/**
 * 懒创建 / 续用：优先续用未提交的 attempt；达到次数上限时只读返回最近一次。
 * 只有渲染器真的上报进度或提交时，路由层才调用这里，因此不会产生空记录。
 */
export function createOrResumeAttempt(
  db: Database.Database,
  surface: LearningSurfaceRow,
  input: { studentId: string; isPreview: number; now?: number },
): AttemptCreationResult {
  const latest = latestAttempt(db, surface.id, input.studentId, input.isPreview);
  if (latest?.status === 'in_progress') return { attempt: latest, created: false, readOnly: false };

  const maxAttempts = maxAttemptsOf(surface);
  if (latest && maxAttempts != null && latest.attempt_no >= maxAttempts) {
    return { attempt: latest, created: false, readOnly: true };
  }

  const now = input.now ?? Date.now();
  const attempt = insertAttempt(db, surface, {
    studentId: input.studentId,
    attemptNo: (latest?.attempt_no ?? 0) + 1,
    isPreview: input.isPreview,
    now,
  });
  return { attempt, created: true, readOnly: false };
}

export type NextAttemptResult =
  { ok: true; attempt: LearningSurfaceAttemptRow } | { ok: false; status: 409; error: string };

/** 显式开启下一次尝试；上一次未提交或达到上限时拒绝。 */
export function createNextAttempt(
  db: Database.Database,
  surface: LearningSurfaceRow,
  input: { studentId: string; isPreview: number; now?: number },
): NextAttemptResult {
  const latest = latestAttempt(db, surface.id, input.studentId, input.isPreview);
  if (latest?.status === 'in_progress') {
    return { ok: false, status: 409, error: 'Previous attempt is still in progress' };
  }
  const maxAttempts = maxAttemptsOf(surface);
  if (latest && maxAttempts != null && latest.attempt_no >= maxAttempts) {
    return { ok: false, status: 409, error: 'Maximum attempts reached' };
  }

  const now = input.now ?? Date.now();
  const attempt = insertAttempt(db, surface, {
    studentId: input.studentId,
    attemptNo: (latest?.attempt_no ?? 0) + 1,
    isPreview: input.isPreview,
    now,
  });
  return { ok: true, attempt };
}

export interface AttemptProgressPatch {
  state?: unknown;
  completion?: number;
  autoScore?: number | null;
  maxScore?: number | null;
}

function serializeBounded(value: unknown): Validation<string> {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { ok: false, error: 'state is not JSON serializable' };
  }
  if (json.length > MAX_STATE_BYTES) return { ok: false, error: 'state is too large' };
  return { ok: true, value: json };
}

export type AttemptMutationResult =
  { ok: true; attempt: LearningSurfaceAttemptRow } | { ok: false; status: 400 | 409; error: string };

/** 更新进度快照；已提交 / 已评分的 attempt 不再接受学生写入。 */
export function updateAttemptProgress(
  db: Database.Database,
  attempt: LearningSurfaceAttemptRow,
  patch: AttemptProgressPatch,
  now = Date.now(),
): AttemptMutationResult {
  if (attempt.status !== 'in_progress') {
    return { ok: false, status: 409, error: 'Attempt is already submitted' };
  }

  let stateJson: string | null = null;
  if (patch.state !== undefined) {
    const serialized = serializeBounded(patch.state);
    if (!serialized.ok) return { ok: false, status: 400, error: serialized.error };
    stateJson = serialized.value;
  }

  let completion: number | null = null;
  if (patch.completion !== undefined) {
    const value = Number(patch.completion);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return { ok: false, status: 400, error: 'completion must be between 0 and 1' };
    }
    completion = value;
  }

  for (const [key, value] of [
    ['autoScore', patch.autoScore],
    ['maxScore', patch.maxScore],
  ] as const) {
    if (value == null) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return { ok: false, status: 400, error: `${key} must be a non-negative number` };
    }
  }

  db.prepare(
    `UPDATE learning_surface_attempts
        SET state_json = COALESCE(?, state_json),
            completion = COALESCE(?, completion),
            auto_score = COALESCE(?, auto_score),
            max_score = COALESCE(?, max_score),
            updated_at = ?
      WHERE id = ?`,
  ).run(stateJson, completion, patch.autoScore ?? null, patch.maxScore ?? null, now, attempt.id);

  return { ok: true, attempt: getLearningSurfaceAttempt(db, attempt.id)! };
}

export interface AttemptSubmission {
  autoScore?: number | null;
  maxScore?: number | null;
  payload?: unknown;
}

/** 提交；重复提交幂等返回既有 attempt。 */
export function submitAttempt(
  db: Database.Database,
  attempt: LearningSurfaceAttemptRow,
  input: AttemptSubmission,
  now = Date.now(),
): AttemptMutationResult {
  if (attempt.status !== 'in_progress') return { ok: true, attempt };

  for (const [key, value] of [
    ['autoScore', input.autoScore],
    ['maxScore', input.maxScore],
  ] as const) {
    if (value == null) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return { ok: false, status: 400, error: `${key} must be a non-negative number` };
    }
  }

  let stateJson = attempt.state_json;
  if (input.payload !== undefined) {
    const serialized = serializeBounded(input.payload);
    if (!serialized.ok) return { ok: false, status: 400, error: serialized.error };
    let base: Record<string, unknown> = {};
    if (attempt.state_json) {
      try {
        const parsed: unknown = JSON.parse(attempt.state_json);
        base = isRecord(parsed) ? parsed : { state: parsed };
      } catch {
        base = { state: attempt.state_json };
      }
    }
    base.submission = input.payload;
    stateJson = JSON.stringify(base);
    if (stateJson.length > MAX_STATE_BYTES) return { ok: false, status: 400, error: 'submission payload is too large' };
  }

  db.prepare(
    `UPDATE learning_surface_attempts
        SET status = 'submitted',
            auto_score = COALESCE(?, auto_score),
            max_score = COALESCE(?, max_score),
            completion = 1,
            state_json = COALESCE(?, state_json),
            submitted_at = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(input.autoScore ?? null, input.maxScore ?? null, stateJson, now, now, attempt.id);

  return { ok: true, attempt: getLearningSurfaceAttempt(db, attempt.id)! };
}

/** 教师评分（可覆盖渲染器自动分）；学生读取的是最终 `score`。 */
export function gradeAttempt(
  db: Database.Database,
  attempt: LearningSurfaceAttemptRow,
  input: { score: number; maxScore?: number | null; gradedBy: string },
  now = Date.now(),
): AttemptMutationResult {
  const score = Number(input.score);
  if (!Number.isFinite(score) || score < 0) {
    return { ok: false, status: 400, error: 'score must be a non-negative number' };
  }
  if (input.maxScore != null) {
    const maxScore = Number(input.maxScore);
    if (!Number.isFinite(maxScore) || maxScore < 0) {
      return { ok: false, status: 400, error: 'maxScore must be a non-negative number' };
    }
  }

  db.prepare(
    `UPDATE learning_surface_attempts
        SET status = 'graded',
            score = ?,
            max_score = COALESCE(?, max_score),
            submitted_at = COALESCE(submitted_at, ?),
            graded_at = ?,
            graded_by = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(score, input.maxScore ?? null, now, now, input.gradedBy, now, attempt.id);

  return { ok: true, attempt: getLearningSurfaceAttempt(db, attempt.id)! };
}
