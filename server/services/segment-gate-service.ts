/**
 * 教学环节门槛的服务端判定。
 *
 * 全班共用 `classroom_sessions.current_segment_id`。学生能否看到该环节的内容，
 * 由本服务按 timeline.gates 决定。四阶段课堂生命周期不调用这里。
 *
 * 插件条件不注册函数。宿主读取已激活插件 manifest 的
 * `contributes['segment.gate_type']`，再执行其声明的命令。命令必须已在
 * actionRegistry 登记。进程内插件与 PR #21 的子进程插件都走 CommandBus
 * （后者由现有 registerHandler 桥接），因此 #21 未合入时同样可用。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { resolvePluginCommandType } from '../../packages/core/plugin-host/plugin-namespace.js';
import { setActiveSegment, lessonActiveSegments } from '../shared-state.js';
import { CLASSROOM_EVENTS, publishClassroomEvent } from '../classroom-events.js';
import { randomId } from '../utils/id.js';
import { looksLikeQuizAnswerData } from '../../packages/core/whiteboard/quiz-answer.js';
import {
  aggregateVerdicts,
  evaluateBuiltinGate,
  parseProgressConditions,
  resolveSegmentGates,
  type AssignmentFact,
  type QuizFact,
  type SegmentGateConfig,
  type SegmentGateFacts,
  type SegmentGateProgress,
  type SegmentGateVerdict,
} from '../../packages/core/lesson-engine/segment-gate.js';

const PLUGIN_GATE_TIMEOUT_MS = 1500;
const SYSTEM_ACTOR = 'system:segment-gate';
const GATE_CAPABILITY = 'segment:gate_eval';
const ARCHIVED = 'ARCHIVED_REPORT';

export interface SegmentAccessResult {
  allowed: boolean;
  reason?: string;
  progress?: SegmentGateProgress;
  gates: SegmentGateVerdict[];
  overridden?: boolean;
  bypass?: boolean;
  segmentId: string;
  classSegmentId: string | null;
  /** 未放行时，学生仍应看到的上一环节（便于补齐条件）。没有则为 null。 */
  visibleSegmentId: string | null;
  usedDeprecatedProgressConditions?: boolean;
}

export interface EvaluateSegmentAccessInput {
  studentId: string;
  lessonId: string;
  targetSegmentId: string;
  /** 教师/管理员查看自己时跳过条件，不记停留 */
  bypass?: boolean;
  /** 学生必须请求课堂当前环节，不能各自换环节 */
  enforceClassSegment?: boolean;
}

interface TimelineSegment {
  id: string;
  gates?: unknown;
  assignmentIds?: unknown;
  elementIds?: unknown;
}

interface PluginGateType {
  id: string;
  commandType: string;
  manifestId: string;
}

let systemActorReady = false;

function ensureSystemActor(): void {
  if (systemActorReady) return;
  kernelContainer.capabilityGuard.grant(SYSTEM_ACTOR, GATE_CAPABILITY);
  systemActorReady = true;
}

function parseTimeline(raw: unknown): TimelineSegment[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is TimelineSegment => !!s && typeof s === 'object' && typeof (s as TimelineSegment).id === 'string',
  );
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function segmentIdOfElement(data: Record<string, unknown>): string | null {
  return typeof data.segmentId === 'string' && data.segmentId.trim() ? data.segmentId.trim() : null;
}

function looksLikeQuiz(type: string, data: Record<string, unknown>, submitted: boolean): boolean {
  if (submitted) return true;
  if (type === 'quiz') return true;
  // Issue #107：正确答案的权威字段是 correctIndex，旧数据才只有 correctAnswer。
  // 两个都认，否则只设了 correctIndex 的测验进不了环节门禁的判定。
  return looksLikeQuizAnswerData(data);
}

export class SegmentGateService {
  public readClassSegmentId(lessonId: string): string | null {
    const mem = lessonActiveSegments.get(lessonId);
    if (mem) return mem;
    const row = kernelContainer.db
      .prepare(
        `SELECT current_segment_id AS id FROM classroom_sessions
         WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(lessonId, ARCHIVED) as { id: string | null } | undefined;
    return row?.id || null;
  }

  /** 教师推进全班环节：写入内存与会话列，并冻结其他环节上仍打开的停留。 */
  public setClassSegment(lessonId: string, segmentId: string): void {
    setActiveSegment(lessonId, segmentId);
    const now = Date.now();
    const session = kernelContainer.db
      .prepare(`SELECT id FROM classroom_sessions WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1`)
      .get(lessonId, ARCHIVED) as { id: string } | undefined;
    if (session) {
      kernelContainer.db
        .prepare('UPDATE classroom_sessions SET current_segment_id = ? WHERE id = ?')
        .run(segmentId, session.id);
    }
    kernelContainer.db
      .prepare(
        `UPDATE segment_visits SET left_at = ?
         WHERE lesson_id = ? AND left_at IS NULL AND segment_id != ?`,
      )
      .run(now, lessonId, segmentId);
  }

  public recordCheckin(lessonId: string, studentId: string, at = Date.now()): void {
    kernelContainer.db
      .prepare(
        `INSERT INTO lesson_checkins (lesson_id, student_id, checked_in_at) VALUES (?, ?, ?)
         ON CONFLICT(lesson_id, student_id) DO UPDATE SET checked_in_at = excluded.checked_in_at`,
      )
      .run(lessonId, studentId, at);
  }

  public async setOverride(
    actorId: string,
    lessonId: string,
    segmentId: string,
    studentId: string,
    reason?: string,
  ): Promise<void> {
    const now = Date.now();
    kernelContainer.db
      .prepare(
        `INSERT INTO segment_gate_overrides (lesson_id, segment_id, student_id, actor_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(lesson_id, segment_id, student_id)
         DO UPDATE SET actor_id = excluded.actor_id, reason = excluded.reason, created_at = excluded.created_at`,
      )
      .run(lessonId, segmentId, studentId, actorId, reason || null, now);
    await publishClassroomEvent(
      CLASSROOM_EVENTS.SEGMENT_GATE_OVERRIDDEN,
      { lessonId, segmentId, studentId, actorId, reason: reason || null },
      { correlationId: lessonId, source: 'server.segment-gate' },
    );
  }

  public async clearOverride(actorId: string, lessonId: string, segmentId: string, studentId: string): Promise<void> {
    kernelContainer.db
      .prepare('DELETE FROM segment_gate_overrides WHERE lesson_id = ? AND segment_id = ? AND student_id = ?')
      .run(lessonId, segmentId, studentId);
    await publishClassroomEvent(
      CLASSROOM_EVENTS.SEGMENT_GATE_OVERRIDE_REVOKED,
      { lessonId, segmentId, studentId, actorId },
      { correlationId: lessonId, source: 'server.segment-gate' },
    );
  }

  public async evaluate(input: EvaluateSegmentAccessInput): Promise<SegmentAccessResult> {
    const classSegmentId = this.readClassSegmentId(input.lessonId);
    const base = {
      segmentId: input.targetSegmentId,
      classSegmentId,
      gates: [] as SegmentGateVerdict[],
      visibleSegmentId: input.targetSegmentId,
    };

    if (input.bypass) {
      return { ...base, allowed: true, bypass: true };
    }

    if (input.enforceClassSegment) {
      const expected = classSegmentId;
      if (expected && input.targetSegmentId !== expected) {
        return {
          ...base,
          allowed: false,
          reason: '请跟随课堂当前环节',
          visibleSegmentId: expected,
        };
      }
    }

    const lesson = kernelContainer.db
      .prepare('SELECT timeline, progress_mode, progress_conditions FROM lessons WHERE id = ?')
      .get(input.lessonId) as
      { timeline: string | null; progress_mode: string | null; progress_conditions: string | null } | undefined;
    const segments = parseTimeline(lesson?.timeline);
    const index = segments.findIndex((s) => s.id === input.targetSegmentId);
    const segment = index >= 0 ? segments[index] : null;
    const previousSegmentId = index > 0 ? segments[index - 1].id : null;
    const resolved = resolveSegmentGates(
      segment,
      index < 0 ? 0 : index,
      lesson?.progress_mode,
      parseProgressConditions(lesson?.progress_conditions),
    );

    if (this.hasOverride(input.lessonId, input.targetSegmentId, input.studentId)) {
      this.enterSegment(input.studentId, input.lessonId, input.targetSegmentId);
      return {
        ...base,
        allowed: true,
        overridden: true,
        usedDeprecatedProgressConditions: resolved.usedDeprecatedProgressConditions,
        visibleSegmentId: input.targetSegmentId,
      };
    }

    if (resolved.gates.length === 0) {
      this.enterSegment(input.studentId, input.lessonId, input.targetSegmentId);
      return {
        ...base,
        allowed: true,
        usedDeprecatedProgressConditions: false,
      };
    }

    const facts = this.loadFacts(input.lessonId, input.studentId, segments, previousSegmentId);
    const verdicts: SegmentGateVerdict[] = [];
    for (const gate of resolved.gates) {
      const builtin = evaluateBuiltinGate(gate, facts);
      if (builtin.deferred) verdicts.push(await this.evaluatePluginGate(gate, input));
      else verdicts.push(builtin);
    }
    const summary = aggregateVerdicts(verdicts);
    if (summary.allowed) this.enterSegment(input.studentId, input.lessonId, input.targetSegmentId);
    return {
      ...base,
      ...summary,
      gates: verdicts,
      usedDeprecatedProgressConditions: resolved.usedDeprecatedProgressConditions,
      visibleSegmentId: summary.allowed ? input.targetSegmentId : previousSegmentId,
    };
  }

  private hasOverride(lessonId: string, segmentId: string, studentId: string): boolean {
    const row = kernelContainer.db
      .prepare(
        `SELECT 1 AS ok FROM segment_gate_overrides
         WHERE lesson_id = ? AND segment_id = ? AND student_id = ?`,
      )
      .get(lessonId, segmentId, studentId) as { ok: number } | undefined;
    return !!row;
  }

  private enterSegment(studentId: string, lessonId: string, segmentId: string): void {
    const now = Date.now();
    const open = kernelContainer.db
      .prepare(
        `SELECT id, segment_id FROM segment_visits
         WHERE lesson_id = ? AND student_id = ? AND left_at IS NULL`,
      )
      .all(lessonId, studentId) as { id: string; segment_id: string }[];
    let staying = false;
    for (const row of open) {
      if (row.segment_id === segmentId) staying = true;
      else {
        kernelContainer.db.prepare('UPDATE segment_visits SET left_at = ? WHERE id = ?').run(now, row.id);
      }
    }
    if (!staying) {
      kernelContainer.db
        .prepare(
          `INSERT INTO segment_visits (id, lesson_id, segment_id, student_id, entered_at, left_at)
           VALUES (?, ?, ?, ?, ?, NULL)`,
        )
        .run(randomId('sv_'), lessonId, segmentId, studentId, now);
    }
  }

  private loadFacts(
    lessonId: string,
    studentId: string,
    segments: TimelineSegment[],
    previousSegmentId: string | null,
  ): SegmentGateFacts {
    const db = kernelContainer.db;
    const elements = db.prepare('SELECT id, type, data FROM whiteboard_elements WHERE lesson_id = ?').all(lessonId) as {
      id: string;
      type: string;
      data: string | null;
    }[];
    const submissions = db
      .prepare(`SELECT element_id, score FROM lesson_quiz_submissions WHERE lesson_id = ? AND student_id = ?`)
      .all(lessonId, studentId) as { element_id: string; score: number }[];
    const submittedByElement = new Map(submissions.map((s) => [s.element_id, Number(s.score) || 0]));

    const quizzes: QuizFact[] = elements.map((el) => {
      const data = parseJsonObject(el.data);
      const submitted = submittedByElement.has(el.id);
      return {
        elementId: el.id,
        segmentId: segmentIdOfElement(data),
        submitted,
        score: submitted ? submittedByElement.get(el.id) || 0 : 0,
        isQuiz: looksLikeQuiz(el.type, data, submitted),
      };
    });

    const assignmentSegment = new Map<string, string | null>();
    for (const seg of segments) {
      const ids = [
        ...(Array.isArray(seg.assignmentIds) ? seg.assignmentIds : []),
        ...(Array.isArray(seg.elementIds) ? seg.elementIds : []),
      ];
      for (const id of ids) {
        if (typeof id === 'string') assignmentSegment.set(id, seg.id);
      }
    }

    const assignments: AssignmentFact[] = [];
    const pluginRows = db
      .prepare('SELECT id, element_id FROM plugin_assignments WHERE lesson_id = ?')
      .all(lessonId) as { id: string; element_id: string | null }[];
    const pluginSubmitted = new Set(
      (
        db.prepare('SELECT assignment_id FROM plugin_submissions WHERE student_id = ?').all(studentId) as {
          assignment_id: string;
        }[]
      ).map((r) => r.assignment_id),
    );
    for (const row of pluginRows) {
      const fromElement = row.element_id
        ? quizzes.find((q) => q.elementId === row.element_id)?.segmentId || null
        : null;
      assignments.push({
        assignmentId: row.id,
        segmentId: assignmentSegment.get(row.id) || fromElement,
        submitted: pluginSubmitted.has(row.id),
      });
    }

    const legacyRows = db.prepare('SELECT id FROM assignments WHERE lesson_id = ?').all(lessonId) as { id: string }[];
    const legacySubmitted = new Set(
      (
        db.prepare('SELECT assignment_id FROM assignment_submissions WHERE student_id = ?').all(studentId) as {
          assignment_id: string;
        }[]
      ).map((r) => r.assignment_id),
    );
    for (const row of legacyRows) {
      assignments.push({
        assignmentId: row.id,
        segmentId: assignmentSegment.get(row.id) || null,
        submitted: legacySubmitted.has(row.id),
      });
    }

    const visits = db
      .prepare(
        `SELECT segment_id, entered_at, left_at FROM segment_visits
         WHERE lesson_id = ? AND student_id = ?`,
      )
      .all(lessonId, studentId) as { segment_id: string; entered_at: number; left_at: number | null }[];
    const now = Date.now();
    const dwellSecondsBySegment: Record<string, number> = {};
    for (const visit of visits) {
      const end = visit.left_at ?? now;
      const seconds = Math.max(0, (end - visit.entered_at) / 1000);
      dwellSecondsBySegment[visit.segment_id] = (dwellSecondsBySegment[visit.segment_id] || 0) + seconds;
    }

    const checkedIn = this.isCheckedIn(lessonId, studentId);

    return { quizzes, assignments, dwellSecondsBySegment, checkedIn, previousSegmentId };
  }

  private isCheckedIn(lessonId: string, studentId: string): boolean {
    const direct = kernelContainer.db
      .prepare('SELECT 1 AS ok FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?')
      .get(lessonId, studentId) as { ok: number } | undefined;
    if (direct) return true;
    const attendance = kernelContainer.db
      .prepare(
        `SELECT 1 AS ok FROM attendance a
         JOIN schedules s ON s.id = a.schedule_id
         WHERE s.lesson_id = ? AND a.student_id = ? AND a.status = 'present'`,
      )
      .get(lessonId, studentId) as { ok: number } | undefined;
    return !!attendance;
  }

  private loadPluginGateTypes(): PluginGateType[] {
    const rows = kernelContainer.db.prepare(`SELECT manifest FROM plugins WHERE status = 'active'`).all() as {
      manifest: string;
    }[];
    const types: PluginGateType[] = [];
    for (const row of rows) {
      let manifest: Record<string, unknown> = {};
      try {
        manifest = JSON.parse(row.manifest);
      } catch {
        continue;
      }
      const manifestId = typeof manifest.id === 'string' ? manifest.id : '';
      const contributes = manifest.contributes as Record<string, unknown> | undefined;
      const entries = contributes?.['segment.gate_type'];
      if (!manifestId || !Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const id = (entry as { id?: unknown }).id;
        const commandType = (entry as { commandType?: unknown }).commandType;
        if (typeof id !== 'string' || typeof commandType !== 'string' || !id || !commandType) continue;
        types.push({ id, commandType: resolvePluginCommandType(commandType, manifestId), manifestId });
      }
    }
    return types;
  }

  private async evaluatePluginGate(
    gate: SegmentGateConfig,
    input: EvaluateSegmentAccessInput,
  ): Promise<SegmentGateVerdict> {
    const declared = this.loadPluginGateTypes().find((t) => t.id === gate.type);
    if (!declared) {
      return { type: gate.type, allowed: false, reason: `未知条件类型 ${gate.type}` };
    }
    ensureSystemActor();
    try {
      const command = kernelContainer.commandBus.createCommand(
        declared.commandType,
        {
          studentId: input.studentId,
          lessonId: input.lessonId,
          segmentId: input.targetSegmentId,
          gateType: gate.type,
          params: gate.params || {},
          readOnly: true,
        },
        SYSTEM_ACTOR,
        { approved: true },
      );
      const result = await Promise.race([
        kernelContainer.commandBus.execute(command),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), PLUGIN_GATE_TIMEOUT_MS);
        }),
      ]);
      return normalizePluginResult(gate.type, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const timedOut = message === 'timeout';
      return {
        type: gate.type,
        allowed: false,
        reason: timedOut ? `条件插件「${gate.type}」响应超时` : `条件插件「${gate.type}」执行失败`,
      };
    }
  }
}

function normalizePluginResult(type: string, raw: unknown): SegmentGateVerdict {
  const body = unwrap(raw);
  if (!body || typeof body.allowed !== 'boolean') {
    return { type, allowed: false, reason: `条件插件「${type}」返回了无法识别的结果` };
  }
  const progress = body.progress;
  const validProgress =
    progress &&
    typeof progress === 'object' &&
    typeof (progress as SegmentGateProgress).current === 'number' &&
    typeof (progress as SegmentGateProgress).target === 'number'
      ? {
          current: (progress as SegmentGateProgress).current,
          target: (progress as SegmentGateProgress).target,
          unit:
            typeof (progress as SegmentGateProgress).unit === 'string'
              ? (progress as SegmentGateProgress).unit
              : undefined,
        }
      : undefined;
  return {
    type,
    allowed: body.allowed,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    progress: validProgress,
  };
}

function unwrap(raw: unknown): { allowed?: boolean; reason?: string; progress?: SegmentGateProgress } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { allowed?: boolean; reason?: string; progress?: SegmentGateProgress; result?: unknown };
  if (typeof obj.allowed === 'boolean') return obj;
  if (obj.result && typeof obj.result === 'object') return unwrap(obj.result);
  return null;
}

export const segmentGateService = new SegmentGateService();
