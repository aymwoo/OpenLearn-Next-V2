/**
 * 课时级学案包（Gitee IKVO15 P0）。
 *
 * 活动与课堂 timeline 并列，完成活动不会改写环节门禁或课堂阶段。
 * 活动级状态是进度主口径；student_lesson_progress 仅在课节存在必做已发布活动时被回写成汇总。
 * 自报（self-report）不得把 verified 置为 1。课件 / 测验 / 作品的成绩仍走既有提交系统，这里只同步展示，不二次记入成绩册。
 */
import type Database from 'better-sqlite3';
import { randomId } from '../utils/id.js';
import {
  hasSubmitableProgrammingArtifact,
  isProgrammingKind,
  normalizeProgrammingArtifact,
  normalizeProgrammingConfig,
  type ProgrammingArtifact,
  type ProgrammingKind,
} from './lesson-activity-programming.js';

export const ACTIVITY_TYPES = ['reading', 'courseware', 'quiz', 'submission', 'programming'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_STATUSES = ['not_started', 'in_progress', 'submitted', 'graded'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const BLOCK_TYPES = [
  'learning_goals',
  'key_points',
  'resources',
  'operation_tips',
  'work_appreciation',
  'freeform',
] as const;
export type ActivityBlockType = (typeof BLOCK_TYPES)[number];

const STATUS_RANK: Record<ActivityStatus, number> = {
  not_started: 0,
  in_progress: 1,
  submitted: 2,
  graded: 3,
};

import { LessonActivityError } from './lesson-activity-error.js';
export { LessonActivityError };

export interface LessonActivityRecord {
  id: string;
  lessonId: string;
  orderIndex: number;
  type: ActivityType;
  title: string;
  config: Record<string, unknown>;
  required: boolean;
  visible: boolean;
  peerReview: boolean;
  groupMode: boolean;
  submissionType: string | null;
  rubric: unknown;
  releaseAt: number | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LessonActivityBlockRecord {
  id: string;
  lessonId: string;
  blockType: ActivityBlockType;
  orderIndex: number;
  content: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ActivityProgressRecord {
  studentId: string;
  activityId: string;
  status: ActivityStatus;
  progressPercent: number;
  verified: boolean;
  score: number | null;
  feedback: string | null;
  gradedAt: number | null;
  lastActivityAt: number | null;
  artifact: ProgrammingArtifact | null;
}

export interface LessonProgressAggregate {
  displayPercent: number;
  verifiedPercent: number;
  completed: boolean;
  requiredTotal: number;
  requiredVerified: number;
  requiredSubmitted: number;
}

export interface UnresolvedActivityBinding {
  activityId: string;
  title: string;
  type: ActivityType;
  field: 'coursewareId' | 'assessmentId' | 'assessmentAssignmentId' | 'assignmentId';
  originalId: string;
}

export type RelinkActivityInput = {
  coursewareId?: string;
  assessmentId?: string;
  assessmentAssignmentId?: string;
  assignmentId?: string;
};

export interface CreateActivityInput {
  type: ActivityType;
  title: string;
  config?: Record<string, unknown>;
  required?: boolean;
  visible?: boolean;
  peerReview?: boolean;
  groupMode?: boolean;
  submissionType?: string | null;
  rubric?: unknown;
  releaseAt?: number | null;
  dueAt?: number | null;
  orderIndex?: number;
}

export type UpdateActivityInput = Partial<CreateActivityInput>;

export interface UpsertBlockInput {
  id?: string;
  blockType: ActivityBlockType;
  content?: Record<string, unknown>;
}

interface ActivityRow {
  id: string;
  lesson_id: string;
  order_index: number;
  type: ActivityType;
  title: string;
  config_json: string;
  required: number;
  visible: number;
  peer_review: number;
  group_mode: number;
  submission_type: string | null;
  rubric_json: string | null;
  release_at: number | null;
  due_at: number | null;
  created_at: number;
  updated_at: number;
}

interface BlockRow {
  id: string;
  lesson_id: string;
  block_type: ActivityBlockType;
  order_index: number;
  content_json: string;
  created_at: number;
  updated_at: number;
}

interface ProgressRow {
  student_id: string;
  activity_id: string;
  status: ActivityStatus;
  progress_percent: number;
  verified: number;
  score: number | null;
  feedback: string | null;
  graded_at: number | null;
  last_activity_at: number | null;
  artifact_json?: string | null;
}

export function parseJsonValue(raw: string | null | undefined, fallback: unknown = {}): unknown {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  const value = parseJsonValue(raw, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

export function isActivityStatus(value: unknown): value is ActivityStatus {
  return typeof value === 'string' && (ACTIVITY_STATUSES as readonly string[]).includes(value);
}

export function isBlockType(value: unknown): value is ActivityBlockType {
  return typeof value === 'string' && (BLOCK_TYPES as readonly string[]).includes(value);
}

export function maxStatus(a: ActivityStatus, b: ActivityStatus): ActivityStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function clampPercent(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function isReleased(activity: Pick<LessonActivityRecord, 'visible' | 'releaseAt'>, now = Date.now()): boolean {
  if (!activity.visible) return false;
  if (activity.releaseAt != null && activity.releaseAt > now) return false;
  return true;
}

export function aggregateLessonActivityProgress(
  items: Array<{ required: boolean; released: boolean; status: ActivityStatus; verified: boolean }>,
): LessonProgressAggregate {
  const required = items.filter((item) => item.required && item.released);
  const requiredTotal = required.length;
  const requiredVerified = required.filter((item) => item.verified).length;
  const requiredSubmitted = required.filter(
    (item) => item.verified || item.status === 'submitted' || item.status === 'graded',
  ).length;
  if (requiredTotal === 0) {
    return {
      displayPercent: 0,
      verifiedPercent: 0,
      completed: false,
      requiredTotal: 0,
      requiredVerified: 0,
      requiredSubmitted: 0,
    };
  }
  return {
    displayPercent: Math.round((requiredSubmitted / requiredTotal) * 100),
    verifiedPercent: Math.round((requiredVerified / requiredTotal) * 100),
    completed: requiredVerified === requiredTotal,
    requiredTotal,
    requiredVerified,
    requiredSubmitted,
  };
}

function mapActivity(row: ActivityRow): LessonActivityRecord {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    orderIndex: row.order_index,
    type: row.type,
    title: row.title,
    config: parseJsonObject(row.config_json),
    required: row.required === 1,
    visible: row.visible === 1,
    peerReview: row.peer_review === 1,
    groupMode: row.group_mode === 1,
    submissionType: row.submission_type,
    rubric: parseJsonValue(row.rubric_json, null),
    releaseAt: row.release_at,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBlock(row: BlockRow): LessonActivityBlockRecord {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    blockType: row.block_type,
    orderIndex: row.order_index,
    content: parseJsonObject(row.content_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseArtifact(raw: string | null | undefined): ProgrammingArtifact | null {
  const value = parseJsonValue(raw, null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (!isProgrammingKind(kind)) return null;
  return value as ProgrammingArtifact;
}

function mapProgress(row: ProgressRow): ActivityProgressRecord {
  return {
    studentId: row.student_id,
    activityId: row.activity_id,
    status: row.status,
    progressPercent: row.progress_percent,
    verified: row.verified === 1,
    score: row.score,
    feedback: row.feedback,
    gradedAt: row.graded_at,
    lastActivityAt: row.last_activity_at,
    artifact: parseArtifact(row.artifact_json),
  };
}

function emptyProgress(studentId: string, activityId: string): ActivityProgressRecord {
  return {
    studentId,
    activityId,
    status: 'not_started',
    progressPercent: 0,
    verified: false,
    score: null,
    feedback: null,
    gradedAt: null,
    lastActivityAt: null,
    artifact: null,
  };
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return fallback;
}

function trimTitle(title: unknown): string {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) throw new LessonActivityError(400, 'Activity title is required');
  if (text.length > 200) throw new LessonActivityError(400, 'Activity title is too long');
  return text;
}

export class LessonActivityService {
  constructor(private readonly db: Database.Database) {}

  lessonExists(lessonId: string): boolean {
    const row = this.db.prepare('SELECT 1 AS ok FROM lessons WHERE id = ? LIMIT 1').get(lessonId) as
      { ok: number } | undefined;
    return !!row;
  }

  assertLesson(lessonId: string): void {
    if (!this.lessonExists(lessonId)) {
      throw new LessonActivityError(404, 'Lesson not found');
    }
  }

  listActivities(lessonId: string, opts: { includeHidden?: boolean; now?: number } = {}): LessonActivityRecord[] {
    this.assertLesson(lessonId);
    const rows = this.db
      .prepare('SELECT * FROM lesson_activities WHERE lesson_id = ? ORDER BY order_index ASC, created_at ASC')
      .all(lessonId) as ActivityRow[];
    const now = opts.now ?? Date.now();
    return rows.map(mapActivity).filter((activity) => (opts.includeHidden ? true : isReleased(activity, now)));
  }

  getActivity(activityId: string): LessonActivityRecord {
    const row = this.db.prepare('SELECT * FROM lesson_activities WHERE id = ?').get(activityId) as
      ActivityRow | undefined;
    if (!row) throw new LessonActivityError(404, 'Activity not found');
    return mapActivity(row);
  }

  listBlocks(lessonId: string): LessonActivityBlockRecord[] {
    this.assertLesson(lessonId);
    const rows = this.db
      .prepare('SELECT * FROM lesson_activity_blocks WHERE lesson_id = ? ORDER BY order_index ASC, created_at ASC')
      .all(lessonId) as BlockRow[];
    return rows.map(mapBlock);
  }

  createActivity(lessonId: string, input: CreateActivityInput): LessonActivityRecord {
    this.assertLesson(lessonId);
    if (!isActivityType(input.type)) {
      throw new LessonActivityError(400, 'Unsupported activity type');
    }
    const title = trimTitle(input.title);
    const config = this.normalizeConfig(input.type, input.config ?? {});
    const visible = asBool(input.visible, false);
    const required = asBool(input.required, true);
    this.assertPublishable(input.type, config, visible);
    const now = Date.now();
    const id = randomId('lact_');
    const maxOrder = this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) AS max_order FROM lesson_activities WHERE lesson_id = ?')
      .get(lessonId) as { max_order: number };
    const orderIndex = Number.isFinite(Number(input.orderIndex)) ? Number(input.orderIndex) : maxOrder.max_order + 1;
    this.db
      .prepare(
        `INSERT INTO lesson_activities (
          id, lesson_id, order_index, type, title, config_json, required, visible,
          peer_review, group_mode, submission_type, rubric_json, release_at, due_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        lessonId,
        orderIndex,
        input.type,
        title,
        JSON.stringify(config),
        required ? 1 : 0,
        visible ? 1 : 0,
        asBool(input.peerReview, false) ? 1 : 0,
        asBool(input.groupMode, false) ? 1 : 0,
        input.submissionType ?? null,
        input.rubric == null ? null : JSON.stringify(input.rubric),
        input.releaseAt ?? null,
        input.dueAt ?? null,
        now,
        now,
      );
    return this.getActivity(id);
  }

  updateActivity(activityId: string, input: UpdateActivityInput): LessonActivityRecord {
    const current = this.getActivity(activityId);
    const type = input.type ?? current.type;
    if (!isActivityType(type)) {
      throw new LessonActivityError(400, 'Unsupported activity type');
    }
    const title = input.title === undefined ? current.title : trimTitle(input.title);
    const config = this.normalizeConfig(type, input.config ?? current.config);
    const visible = asBool(input.visible, current.visible);
    this.assertPublishable(type, config, visible);
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE lesson_activities SET
          type = ?, title = ?, config_json = ?, required = ?, visible = ?,
          peer_review = ?, group_mode = ?, submission_type = ?, rubric_json = ?,
          release_at = ?, due_at = ?, order_index = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        type,
        title,
        JSON.stringify(config),
        asBool(input.required, current.required) ? 1 : 0,
        visible ? 1 : 0,
        asBool(input.peerReview, current.peerReview) ? 1 : 0,
        asBool(input.groupMode, current.groupMode) ? 1 : 0,
        input.submissionType === undefined ? current.submissionType : input.submissionType,
        input.rubric === undefined
          ? current.rubric == null
            ? null
            : JSON.stringify(current.rubric)
          : input.rubric == null
            ? null
            : JSON.stringify(input.rubric),
        input.releaseAt === undefined ? current.releaseAt : input.releaseAt,
        input.dueAt === undefined ? current.dueAt : input.dueAt,
        input.orderIndex === undefined ? current.orderIndex : Number(input.orderIndex),
        now,
        activityId,
      );
    return this.getActivity(activityId);
  }

  deleteActivity(activityId: string): void {
    const current = this.getActivity(activityId);
    this.db.prepare('DELETE FROM activity_progress WHERE activity_id = ?').run(activityId);
    this.db.prepare('DELETE FROM lesson_activities WHERE id = ?').run(activityId);
    this.reindex(current.lessonId);
  }

  reorderActivities(lessonId: string, activityIds: string[]): LessonActivityRecord[] {
    this.assertLesson(lessonId);
    const existing = this.listActivities(lessonId, { includeHidden: true });
    if (activityIds.length !== existing.length || new Set(activityIds).size !== activityIds.length) {
      throw new LessonActivityError(400, 'Reorder payload must include every activity exactly once');
    }
    const allowed = new Set(existing.map((item) => item.id));
    if (activityIds.some((id) => !allowed.has(id))) {
      throw new LessonActivityError(400, 'Reorder payload contains unknown activity');
    }
    const now = Date.now();
    const tx = this.db.transaction(() => {
      activityIds.forEach((id, index) => {
        this.db
          .prepare('UPDATE lesson_activities SET order_index = ?, updated_at = ? WHERE id = ?')
          .run(index, now, id);
      });
    });
    tx();
    return this.listActivities(lessonId, { includeHidden: true });
  }

  replaceBlocks(lessonId: string, inputs: UpsertBlockInput[]): LessonActivityBlockRecord[] {
    this.assertLesson(lessonId);
    if (!Array.isArray(inputs)) {
      throw new LessonActivityError(400, 'Blocks payload must be an array');
    }
    if (inputs.length > 40) {
      throw new LessonActivityError(400, 'Too many homepage blocks');
    }
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM lesson_activity_blocks WHERE lesson_id = ?').run(lessonId);
      inputs.forEach((input, index) => {
        if (!isBlockType(input.blockType)) {
          throw new LessonActivityError(400, 'Unsupported homepage block type');
        }
        const content =
          input.content && typeof input.content === 'object' && !Array.isArray(input.content) ? input.content : {};
        const id = input.id && String(input.id).trim() ? String(input.id) : randomId('labk_');
        this.db
          .prepare(
            `INSERT INTO lesson_activity_blocks (
              id, lesson_id, block_type, order_index, content_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, lessonId, input.blockType, index, JSON.stringify(content), now, now);
      });
    });
    tx();
    return this.listBlocks(lessonId);
  }

  getTeacherPack(lessonId: string): {
    lessonId: string;
    courseId: string | null;
    blocks: LessonActivityBlockRecord[];
    activities: LessonActivityRecord[];
    unresolvedBindings: UnresolvedActivityBinding[];
  } {
    this.assertLesson(lessonId);
    const lesson = this.db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId) as {
      course_id: string | null;
    };
    const activities = this.listActivities(lessonId, { includeHidden: true });
    return {
      lessonId,
      courseId: lesson.course_id ?? null,
      blocks: this.listBlocks(lessonId),
      activities,
      unresolvedBindings: this.listUnresolvedBindings(lessonId, activities),
    };
  }

  getStudentPack(
    lessonId: string,
    studentId: string,
    now = Date.now(),
  ): {
    lessonId: string;
    courseId: string | null;
    blocks: LessonActivityBlockRecord[];
    activities: Array<LessonActivityRecord & { progress: ActivityProgressRecord }>;
    summary: LessonProgressAggregate;
  } {
    this.assertLesson(lessonId);
    const lesson = this.db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId) as {
      course_id: string | null;
    };
    const activities = this.listActivities(lessonId, { includeHidden: false, now });
    const withProgress = activities.map((activity) => {
      const progress = this.reconcileStudentActivity(activity, studentId, now);
      return { ...activity, progress };
    });
    const summary = this.persistLessonSummary(lessonId, studentId, withProgress, now);
    return {
      lessonId,
      courseId: lesson.course_id ?? null,
      blocks: this.listBlocks(lessonId),
      activities: withProgress,
      summary,
    };
  }

  getPreviewPack(
    lessonId: string,
    now = Date.now(),
  ): {
    preview: true;
    previewKind: 'activity-pack-student';
    unpublishedCount: number;
    lessonId: string;
    courseId: string | null;
    blocks: LessonActivityBlockRecord[];
    activities: Array<LessonActivityRecord & { progress: ActivityProgressRecord }>;
    summary: LessonProgressAggregate;
  } {
    this.assertLesson(lessonId);
    const lesson = this.db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId) as {
      course_id: string | null;
    };
    const visible = this.listActivities(lessonId, { includeHidden: false, now });
    const all = this.listActivities(lessonId, { includeHidden: true, now });
    const withProgress = visible.map((activity) => ({
      ...activity,
      progress: {
        studentId: 'preview',
        activityId: activity.id,
        status: 'not_started' as ActivityStatus,
        progressPercent: 0,
        verified: false,
        score: null,
        feedback: null,
        gradedAt: null,
        lastActivityAt: null,
        artifact: null,
      },
    }));
    return {
      preview: true,
      previewKind: 'activity-pack-student',
      unpublishedCount: all.length - visible.length,
      lessonId,
      courseId: lesson.course_id ?? null,
      blocks: this.listBlocks(lessonId),
      activities: withProgress,
      summary: aggregateLessonActivityProgress(
        visible.map((activity) => ({
          required: activity.required,
          released: true,
          status: 'not_started' as ActivityStatus,
          verified: false,
        })),
      ),
    };
  }

  listStudentPackSummaries(
    studentId: string,
    lessonIds: string[],
    now = Date.now(),
  ): Array<{
    lessonId: string;
    activityCount: number;
    summary: LessonProgressAggregate;
  }> {
    const out: Array<{ lessonId: string; activityCount: number; summary: LessonProgressAggregate }> = [];
    for (const lessonId of lessonIds) {
      if (!this.lessonExists(lessonId)) continue;
      const activities = this.listActivities(lessonId, { includeHidden: false, now });
      if (activities.length === 0) continue;
      const withProgress = activities.map((activity) => this.reconcileStudentActivity(activity, studentId, now));
      out.push({
        lessonId,
        activityCount: activities.length,
        summary: aggregateLessonActivityProgress(
          activities.map((activity, index) => ({
            required: activity.required,
            released: true,
            status: withProgress[index].status,
            verified: withProgress[index].verified,
          })),
        ),
      });
    }
    return out;
  }

  startActivity(activityId: string, studentId: string, now = Date.now()): ActivityProgressRecord {
    const activity = this.requireReleasedActivity(activityId, now);
    const current = this.reconcileStudentActivity(activity, studentId, now);
    if (STATUS_RANK[current.status] >= STATUS_RANK.in_progress) {
      return current;
    }
    return this.upsertProgress(studentId, activity, {
      status: 'in_progress',
      progressPercent: Math.max(current.progressPercent, 1),
      verified: current.verified,
      score: current.score,
      feedback: current.feedback,
      gradedAt: current.gradedAt,
      lastActivityAt: now,
    });
  }

  selfReportActivity(activityId: string, studentId: string, now = Date.now()): ActivityProgressRecord {
    const activity = this.requireReleasedActivity(activityId, now);
    const current = this.reconcileStudentActivity(activity, studentId, now);
    if (current.status === 'graded' || current.verified) {
      return current;
    }
    const progress = this.upsertProgress(studentId, activity, {
      status: maxStatus(current.status, 'submitted'),
      progressPercent: 100,
      verified: false,
      score: current.score,
      feedback: current.feedback,
      gradedAt: current.gradedAt,
      lastActivityAt: now,
    });
    this.persistLessonSummaryForStudent(activity.lessonId, studentId, now);
    return this.getProgress(studentId, activityId) ?? progress;
  }

  teacherVerify(
    activityId: string,
    studentId: string,
    input: { score?: number | null; feedback?: string | null } = {},
    now = Date.now(),
  ): ActivityProgressRecord {
    const activity = this.getActivity(activityId);
    const current = this.reconcileStudentActivity(activity, studentId, now);
    const hasScore = input.score !== undefined && input.score !== null;
    const progress = this.upsertProgress(studentId, activity, {
      status: hasScore ? 'graded' : maxStatus(current.status, 'submitted'),
      progressPercent: 100,
      verified: true,
      score: hasScore ? Number(input.score) : current.score,
      feedback: input.feedback === undefined ? current.feedback : input.feedback,
      gradedAt: hasScore ? now : current.gradedAt,
      lastActivityAt: now,
    });
    this.persistLessonSummaryForStudent(activity.lessonId, studentId, now);
    return this.getProgress(studentId, activityId) ?? progress;
  }

  teacherGrade(
    activityId: string,
    studentId: string,
    input: { score: number; feedback?: string | null },
    now = Date.now(),
  ): ActivityProgressRecord {
    if (!Number.isFinite(Number(input.score))) {
      throw new LessonActivityError(400, 'Score is required');
    }
    return this.teacherVerify(
      activityId,
      studentId,
      { score: Number(input.score), feedback: input.feedback ?? null },
      now,
    );
  }

  listActivityProgress(activityId: string): ActivityProgressRecord[] {
    this.getActivity(activityId);
    const rows = this.db
      .prepare('SELECT * FROM activity_progress WHERE activity_id = ? ORDER BY last_activity_at DESC')
      .all(activityId) as ProgressRow[];
    return rows.map(mapProgress);
  }

  inspectBindings(activity: LessonActivityRecord): UnresolvedActivityBinding[] {
    const bindings: UnresolvedActivityBinding[] = [];
    const push = (field: UnresolvedActivityBinding['field'], raw: unknown, exists: (id: string) => boolean) => {
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (!id) return;
      if (!exists(id)) {
        bindings.push({
          activityId: activity.id,
          title: activity.title,
          type: activity.type,
          field,
          originalId: id,
        });
      }
    };
    if (activity.type === 'courseware') {
      push('coursewareId', activity.config.coursewareId, (id) => this.coursewareExists(id));
    }
    if (activity.type === 'quiz') {
      push('assessmentId', activity.config.assessmentId, (id) => this.assessmentExists(id));
      push('assessmentAssignmentId', activity.config.assessmentAssignmentId, (id) =>
        this.assessmentAssignmentExists(id),
      );
    }
    if (activity.type === 'submission') {
      push('assignmentId', activity.config.assignmentId, (id) => this.assignmentExists(id));
    }
    return bindings;
  }

  listUnresolvedBindings(lessonId: string, activities?: LessonActivityRecord[]): UnresolvedActivityBinding[] {
    this.assertLesson(lessonId);
    const list = activities ?? this.listActivities(lessonId, { includeHidden: true });
    return list.flatMap((activity) => this.inspectBindings(activity));
  }

  relinkActivity(
    activityId: string,
    input: RelinkActivityInput,
  ): { activity: LessonActivityRecord; unresolvedBindings: UnresolvedActivityBinding[] } {
    const current = this.getActivity(activityId);
    const config: Record<string, unknown> = { ...current.config };
    if (current.type === 'courseware') {
      if (input.coursewareId === undefined) {
        throw new LessonActivityError(400, 'coursewareId is required to relink this activity');
      }
      const id = input.coursewareId.trim();
      if (!this.coursewareExists(id)) throw new LessonActivityError(400, 'Linked courseware was not found');
      config.coursewareId = id;
    } else if (current.type === 'quiz') {
      if (input.assessmentId === undefined && input.assessmentAssignmentId === undefined) {
        throw new LessonActivityError(
          400,
          'assessmentId or assessmentAssignmentId is required to relink this activity',
        );
      }
      if (input.assessmentId !== undefined) {
        const id = input.assessmentId.trim();
        if (!this.assessmentExists(id)) throw new LessonActivityError(400, 'Linked assessment was not found');
        config.assessmentId = id;
      }
      if (input.assessmentAssignmentId !== undefined) {
        const id = input.assessmentAssignmentId.trim();
        if (id && !this.assessmentAssignmentExists(id)) {
          throw new LessonActivityError(400, 'Linked assessment assignment was not found');
        }
        if (id) config.assessmentAssignmentId = id;
        else delete config.assessmentAssignmentId;
      }
    } else if (current.type === 'submission') {
      if (input.assignmentId === undefined) {
        throw new LessonActivityError(400, 'assignmentId is required to relink this activity');
      }
      const id = input.assignmentId.trim();
      if (!this.assignmentExists(id)) throw new LessonActivityError(400, 'Linked assignment was not found');
      config.assignmentId = id;
    } else {
      throw new LessonActivityError(400, 'This activity type does not need resource relinking');
    }
    const activity = this.updateActivity(activityId, { config });
    return { activity, unresolvedBindings: this.inspectBindings(activity) };
  }

  saveProgrammingArtifact(
    activityId: string,
    studentId: string,
    raw: unknown,
    submit = false,
    now = Date.now(),
  ): ActivityProgressRecord {
    const activity = this.requireReleasedActivity(activityId, now);
    if (activity.type !== 'programming') {
      throw new LessonActivityError(400, 'Only programming activities accept an in-pack artifact');
    }
    const kind = isProgrammingKind(activity.config.kind) ? (activity.config.kind as ProgrammingKind) : null;
    if (!kind) throw new LessonActivityError(400, 'Programming kind is not configured');
    const artifact = normalizeProgrammingArtifact(kind, raw, now);
    const current = this.reconcileStudentActivity(activity, studentId, now);
    if (current.status === 'graded' || current.verified) {
      throw new LessonActivityError(409, 'Verified or graded work cannot be overwritten by the student');
    }
    if (submit) {
      if (!hasSubmitableProgrammingArtifact(artifact)) {
        throw new LessonActivityError(400, 'Submit a programming artifact first');
      }
      artifact.submittedAt = now;
    }
    const progress = this.upsertProgress(studentId, activity, {
      status: submit ? maxStatus(current.status, 'submitted') : maxStatus(current.status, 'in_progress'),
      progressPercent: submit ? 100 : Math.max(current.progressPercent, 20),
      verified: false,
      score: current.score,
      feedback: current.feedback,
      gradedAt: current.gradedAt,
      lastActivityAt: now,
      artifact,
    });
    this.persistLessonSummaryForStudent(activity.lessonId, studentId, now);
    return this.getProgress(studentId, activityId) ?? progress;
  }

  private requireReleasedActivity(activityId: string, now: number): LessonActivityRecord {
    const activity = this.getActivity(activityId);
    if (!isReleased(activity, now)) {
      throw new LessonActivityError(404, 'Activity not found');
    }
    return activity;
  }

  private reindex(lessonId: string): void {
    const rows = this.db
      .prepare('SELECT id FROM lesson_activities WHERE lesson_id = ? ORDER BY order_index ASC, created_at ASC')
      .all(lessonId) as { id: string }[];
    const now = Date.now();
    rows.forEach((row, index) => {
      this.db
        .prepare('UPDATE lesson_activities SET order_index = ?, updated_at = ? WHERE id = ?')
        .run(index, now, row.id);
    });
  }

  private normalizeConfig(type: ActivityType, config: Record<string, unknown>): Record<string, unknown> {
    const src = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    const out: Record<string, unknown> = { ...src };
    if (type === 'reading') {
      if (out.body != null && typeof out.body !== 'string') {
        throw new LessonActivityError(400, 'Reading body must be text');
      }
      if (typeof out.body === 'string' && out.body.length > 100_000) {
        throw new LessonActivityError(400, 'Reading body is too long');
      }
    }
    if (type === 'courseware') {
      const id = typeof out.coursewareId === 'string' ? out.coursewareId.trim() : '';
      if (id) out.coursewareId = id;
      else delete out.coursewareId;
    }
    if (type === 'quiz') {
      const assessmentId = typeof out.assessmentId === 'string' ? out.assessmentId.trim() : '';
      const assessmentAssignmentId =
        typeof out.assessmentAssignmentId === 'string' ? out.assessmentAssignmentId.trim() : '';
      if (assessmentId) out.assessmentId = assessmentId;
      else delete out.assessmentId;
      if (assessmentAssignmentId) out.assessmentAssignmentId = assessmentAssignmentId;
      else delete out.assessmentAssignmentId;
    }
    if (type === 'submission') {
      const assignmentId = typeof out.assignmentId === 'string' ? out.assignmentId.trim() : '';
      if (assignmentId) out.assignmentId = assignmentId;
      else delete out.assignmentId;
    }
    if (type === 'programming') {
      return normalizeProgrammingConfig(out);
    }
    return out;
  }

  private assertPublishable(type: ActivityType, config: Record<string, unknown>, visible: boolean): void {
    if (!visible) return;
    if (type === 'courseware') {
      const id = typeof config.coursewareId === 'string' ? config.coursewareId : '';
      if (!id || !this.coursewareExists(id)) {
        throw new LessonActivityError(400, 'Publish a courseware activity after linking a courseware item');
      }
    }
    if (type === 'quiz') {
      const assessmentId = typeof config.assessmentId === 'string' ? config.assessmentId : '';
      const assignmentId = typeof config.assessmentAssignmentId === 'string' ? config.assessmentAssignmentId : '';
      const assessmentOk = assessmentId ? this.assessmentExists(assessmentId) : false;
      const assignmentOk = assignmentId ? this.assessmentAssignmentExists(assignmentId) : false;
      if (!assessmentOk && !assignmentOk) {
        throw new LessonActivityError(400, 'Publish a quiz activity after linking an assessment');
      }
    }
    if (type === 'submission') {
      const id = typeof config.assignmentId === 'string' ? config.assignmentId : '';
      if (!id || !this.assignmentExists(id)) {
        throw new LessonActivityError(400, 'Publish a submission activity after linking an assignment');
      }
    }
    if (type === 'programming' && !isProgrammingKind(config.kind)) {
      throw new LessonActivityError(
        400,
        'Publish a programming activity after choosing Scratch, Python, flowchart, or mind map',
      );
    }
  }

  private coursewareExists(coursewareId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS ok FROM courseware WHERE id = ? OR uuid = ? LIMIT 1')
      .get(coursewareId, coursewareId) as { ok: number } | undefined;
    return !!row;
  }

  private assessmentExists(assessmentId: string): boolean {
    if (!this.tableExists('assessments')) return false;
    return !!this.db.prepare('SELECT 1 AS ok FROM assessments WHERE id = ? LIMIT 1').get(assessmentId);
  }

  private assessmentAssignmentExists(assignmentId: string): boolean {
    if (!this.tableExists('assessment_assignments')) return false;
    return !!this.db.prepare('SELECT 1 AS ok FROM assessment_assignments WHERE id = ? LIMIT 1').get(assignmentId);
  }

  private assignmentExists(assignmentId: string): boolean {
    const plugin = this.tableExists('plugin_assignments')
      ? (this.db.prepare('SELECT 1 AS ok FROM plugin_assignments WHERE id = ? LIMIT 1').get(assignmentId) as
          { ok: number } | undefined)
      : undefined;
    if (plugin) return true;
    const classic = this.db.prepare('SELECT 1 AS ok FROM assignments WHERE id = ? LIMIT 1').get(assignmentId) as
      { ok: number } | undefined;
    return !!classic;
  }

  private tableExists(name: string): boolean {
    return !!this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  }

  private getProgress(studentId: string, activityId: string): ActivityProgressRecord | null {
    const row = this.db
      .prepare('SELECT * FROM activity_progress WHERE student_id = ? AND activity_id = ?')
      .get(studentId, activityId) as ProgressRow | undefined;
    return row ? mapProgress(row) : null;
  }

  private upsertProgress(
    studentId: string,
    activity: LessonActivityRecord,
    patch: Omit<ActivityProgressRecord, 'studentId' | 'activityId' | 'artifact'> & {
      artifact?: ProgrammingArtifact | null;
    },
  ): ActivityProgressRecord {
    const existing = this.getProgress(studentId, activity.id);
    const artifact = patch.artifact === undefined ? (existing?.artifact ?? null) : patch.artifact;
    this.db
      .prepare(
        `INSERT INTO activity_progress (
          student_id, activity_id, status, progress_percent, verified, score, feedback, graded_at, last_activity_at, artifact_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, activity_id) DO UPDATE SET
          status = excluded.status,
          progress_percent = excluded.progress_percent,
          verified = excluded.verified,
          score = excluded.score,
          feedback = excluded.feedback,
          graded_at = excluded.graded_at,
          last_activity_at = excluded.last_activity_at,
          artifact_json = excluded.artifact_json`,
      )
      .run(
        studentId,
        activity.id,
        patch.status,
        clampPercent(patch.progressPercent),
        patch.verified ? 1 : 0,
        patch.score,
        patch.feedback,
        patch.gradedAt,
        patch.lastActivityAt,
        artifact ? JSON.stringify(artifact) : null,
      );
    return (
      this.getProgress(studentId, activity.id) ?? {
        studentId,
        activityId: activity.id,
        ...patch,
        artifact,
      }
    );
  }

  reconcileStudentActivity(
    activity: LessonActivityRecord,
    studentId: string,
    now = Date.now(),
  ): ActivityProgressRecord {
    const stored = this.getProgress(studentId, activity.id) ?? emptyProgress(studentId, activity.id);
    const linked = this.readLinkedProgress(activity, studentId);
    const merged: ActivityProgressRecord = {
      ...stored,
      status: maxStatus(stored.status, linked.status),
      progressPercent: Math.max(stored.progressPercent, linked.progressPercent),
      verified: stored.verified || linked.verified,
      score: linked.score ?? stored.score,
      feedback: linked.feedback ?? stored.feedback,
      gradedAt: linked.gradedAt ?? stored.gradedAt,
      lastActivityAt: Math.max(stored.lastActivityAt ?? 0, linked.lastActivityAt ?? 0) || now,
      artifact: stored.artifact,
    };
    const changed =
      stored.status !== merged.status ||
      stored.progressPercent !== merged.progressPercent ||
      stored.verified !== merged.verified ||
      stored.score !== merged.score ||
      stored.feedback !== merged.feedback ||
      stored.gradedAt !== merged.gradedAt;
    if (changed || stored.lastActivityAt == null) {
      return this.upsertProgress(studentId, activity, {
        status: merged.status,
        progressPercent: merged.progressPercent,
        verified: merged.verified,
        score: merged.score,
        feedback: merged.feedback,
        gradedAt: merged.gradedAt,
        lastActivityAt: merged.lastActivityAt,
      });
    }
    return stored;
  }

  private readLinkedProgress(
    activity: LessonActivityRecord,
    studentId: string,
  ): Pick<
    ActivityProgressRecord,
    'status' | 'progressPercent' | 'verified' | 'score' | 'feedback' | 'gradedAt' | 'lastActivityAt'
  > {
    const empty = {
      status: 'not_started' as ActivityStatus,
      progressPercent: 0,
      verified: false,
      score: null as number | null,
      feedback: null as string | null,
      gradedAt: null as number | null,
      lastActivityAt: null as number | null,
    };
    if (activity.type === 'courseware') {
      return { ...empty, ...this.readCoursewareProgress(String(activity.config.coursewareId || ''), studentId) };
    }
    if (activity.type === 'quiz') {
      return {
        ...empty,
        ...this.readQuizProgress(
          String(activity.config.assessmentAssignmentId || ''),
          String(activity.config.assessmentId || ''),
          studentId,
        ),
      };
    }
    if (activity.type === 'submission') {
      return { ...empty, ...this.readSubmissionProgress(String(activity.config.assignmentId || ''), studentId) };
    }
    return empty;
  }

  private readCoursewareProgress(coursewareId: string, studentId: string): Partial<ActivityProgressRecord> {
    if (!coursewareId) return {};
    const attempt = this.db
      .prepare(
        `SELECT id, status, started_at, finished_at
         FROM courseware_attempt
         WHERE student_id = ? AND courseware_id = ?
         ORDER BY COALESCE(finished_at, started_at) DESC
         LIMIT 1`,
      )
      .get(studentId, coursewareId) as
      { id: string; status: string; started_at: number; finished_at: number | null } | undefined;
    if (!attempt) return {};
    const finished =
      !!attempt.finished_at ||
      attempt.status === 'finished' ||
      attempt.status === 'completed' ||
      attempt.status === 'submitted';
    let score: number | null = null;
    let verified = false;
    if (this.tableExists('submission_result')) {
      const result = this.db
        .prepare(
          `SELECT score, completion FROM submission_result
           WHERE attempt_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(attempt.id) as { score: number | null; completion: number | null } | undefined;
      if (result) {
        score = result.score ?? null;
      }
    }
    // 课件自动成绩视为已验证来源；没有分数时仅记已提交、未验证。不同步写入成绩册。
    if (finished && score != null) verified = true;
    return {
      status: finished ? (verified ? 'graded' : 'submitted') : 'in_progress',
      progressPercent: finished ? 100 : 50,
      verified,
      score,
      lastActivityAt: attempt.finished_at ?? attempt.started_at,
      gradedAt: verified ? (attempt.finished_at ?? attempt.started_at) : null,
    };
  }

  private readQuizProgress(
    assessmentAssignmentId: string,
    assessmentId: string,
    studentId: string,
  ): Partial<ActivityProgressRecord> {
    if (!this.tableExists('assessment_attempts')) return {};
    let assignmentId = assessmentAssignmentId;
    if (!assignmentId && assessmentId) {
      const row = this.db
        .prepare(
          `SELECT aa.id
           FROM assessment_assignments aa
           WHERE aa.assessment_id = ?
           ORDER BY aa.created_at DESC
           LIMIT 1`,
        )
        .get(assessmentId) as { id: string } | undefined;
      assignmentId = row?.id ?? '';
    }
    if (!assignmentId) return {};
    const attempt = this.db
      .prepare(
        `SELECT status, score, submitted_at, started_at
         FROM assessment_attempts
         WHERE assignment_id = ? AND student_id = ?
         ORDER BY attempt_no DESC, started_at DESC
         LIMIT 1`,
      )
      .get(assignmentId, studentId) as
      { status: string; score: number | null; submitted_at: number | null; started_at: number } | undefined;
    if (!attempt) return {};
    const submitted = attempt.status === 'submitted' || attempt.status === 'graded' || attempt.status === 'released';
    const graded = attempt.status === 'graded' || attempt.status === 'released' || attempt.score != null;
    return {
      status: graded ? 'graded' : submitted ? 'submitted' : 'in_progress',
      progressPercent: submitted || graded ? 100 : 50,
      verified: graded,
      score: attempt.score,
      lastActivityAt: attempt.submitted_at ?? attempt.started_at,
      gradedAt: graded ? (attempt.submitted_at ?? attempt.started_at) : null,
    };
  }

  private readSubmissionProgress(assignmentId: string, studentId: string): Partial<ActivityProgressRecord> {
    if (!assignmentId) return {};
    if (this.tableExists('plugin_submissions')) {
      const submission = this.db
        .prepare(
          `SELECT id, updated_at, created_at FROM plugin_submissions
           WHERE assignment_id = ? AND student_id = ?
           LIMIT 1`,
        )
        .get(assignmentId, studentId) as { id: string; updated_at: number; created_at: number } | undefined;
      if (submission) {
        let score: number | null = null;
        let gradedAt: number | null = null;
        let feedback: string | null = null;
        if (this.tableExists('plugin_grades')) {
          const grade = this.db
            .prepare(
              `SELECT COALESCE(g.calculated_final_score, g.teacher_score) AS score,
                      g.graded_at, g.teacher_comment, g.status, g.published_at
               FROM plugin_grades g
               WHERE g.submission_id = ?
               ORDER BY COALESCE(g.graded_at, 0) DESC
               LIMIT 1`,
            )
            .get(submission.id) as
            | {
                score: number | null;
                graded_at: number | null;
                teacher_comment: string | null;
                status: string;
                published_at: number | null;
              }
            | undefined;
          if (
            grade &&
            (grade.score != null ||
              grade.status === 'published' ||
              grade.published_at != null ||
              grade.graded_at != null)
          ) {
            score = grade.score;
            gradedAt = grade.graded_at ?? grade.published_at;
            feedback = grade.teacher_comment;
          }
        }
        const verified = score != null;
        return {
          status: verified ? 'graded' : 'submitted',
          progressPercent: 100,
          verified,
          score,
          feedback,
          gradedAt,
          lastActivityAt: submission.updated_at ?? submission.created_at,
        };
      }
    }
    const classic = this.db
      .prepare(
        `SELECT content, score, feedback, submitted_at, graded_at, status
         FROM assignment_submissions
         WHERE assignment_id = ? AND student_id = ?
         LIMIT 1`,
      )
      .get(assignmentId, studentId) as
      | {
          content: string | null;
          score: number | null;
          feedback: string | null;
          submitted_at: number;
          graded_at: number | null;
          status: string;
        }
      | undefined;
    if (!classic) return {};
    const graded = classic.score != null || classic.graded_at != null || classic.status === 'graded';
    return {
      status: graded ? 'graded' : 'submitted',
      progressPercent: 100,
      verified: graded,
      score: classic.score,
      feedback: classic.feedback,
      gradedAt: classic.graded_at,
      lastActivityAt: classic.graded_at ?? classic.submitted_at,
    };
  }

  private persistLessonSummaryForStudent(lessonId: string, studentId: string, now: number): LessonProgressAggregate {
    const activities = this.listActivities(lessonId, { includeHidden: false, now });
    const withProgress = activities.map((activity) => ({
      ...activity,
      progress: this.reconcileStudentActivity(activity, studentId, now),
    }));
    return this.persistLessonSummary(lessonId, studentId, withProgress, now);
  }

  private persistLessonSummary(
    lessonId: string,
    studentId: string,
    activities: Array<LessonActivityRecord & { progress: ActivityProgressRecord }>,
    now: number,
  ): LessonProgressAggregate {
    const summary = aggregateLessonActivityProgress(
      activities.map((activity) => ({
        required: activity.required,
        released: true,
        status: activity.progress.status,
        verified: activity.progress.verified,
      })),
    );
    if (summary.requiredTotal === 0) return summary;
    this.db
      .prepare(
        `INSERT INTO student_lesson_progress (
          student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at, verified, verified_progress_percent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, lesson_id) DO UPDATE SET
          completed = excluded.completed,
          progress_percent = excluded.progress_percent,
          verified = excluded.verified,
          verified_progress_percent = excluded.verified_progress_percent`,
      )
      .run(
        studentId,
        lessonId,
        summary.completed ? 1 : 0,
        summary.displayPercent,
        '[]',
        now,
        summary.completed ? 1 : 0,
        summary.verifiedPercent,
      );
    return summary;
  }
}
