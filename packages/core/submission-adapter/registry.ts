/**
 * SubmissionRegistry + SubmissionAggregator。
 *
 * Registry：插件注册/注销适配器（按 owner 批量清理，插件卸载时宿主调 clearOwner）。
 * Aggregator：聚合所有适配器产出，按 (source.adapterId, externalId) 去重，按 modeIds 过滤，
 * 并提供把统一提交写回平台成绩的唯一通道（复用 grade-writer，守手动分保护）。
 */
import type {
  SubmissionAdapter,
  SubmissionFilter,
  NormalizedSubmission,
  RegisterAdapterResult,
  GradeWriteInputView,
} from './types.js';

/** grade-writer 端口（由宿主注入，避免本包直接依赖 db） */
export interface GradeWriterPort {
  applyGradeChange(input: GradeWriteInputView): { ok: boolean; reason?: string; historyId?: string };
}

export class SubmissionRegistry {
  private adapters = new Map<string, SubmissionAdapter>();

  register(adapter: SubmissionAdapter): RegisterAdapterResult {
    if (!adapter?.descriptor?.id || !adapter.descriptor.owner || !adapter.descriptor.kinds?.length) {
      return { ok: false, code: 'INVALID_ADAPTER', message: 'id/owner/kinds 必填' };
    }
    if (this.adapters.has(adapter.descriptor.id)) {
      return { ok: false, code: 'ADAPTER_EXISTS', message: `适配器 ${adapter.descriptor.id} 已注册` };
    }
    this.adapters.set(adapter.descriptor.id, adapter);
    return { ok: true };
  }

  unregister(id: string, owner: string): boolean {
    if (this.adapters.get(id)?.descriptor.owner !== owner) return false;
    return this.adapters.delete(id);
  }

  clearOwner(owner: string): void {
    for (const [id, a] of this.adapters) if (a.descriptor.owner === owner) this.adapters.delete(id);
  }

  list(): ReadonlyArray<SubmissionAdapter> {
    return Array.from(this.adapters.values());
  }

  clear(): void {
    this.adapters.clear();
  }
}

export interface AggregatedSubmissionsResult {
  submissions: NormalizedSubmission[];
  /** 各适配器报错，隔离不影响其它来源 */
  errors: Array<{ adapterId: string; message: string }>;
  total: number;
}

export class SubmissionAggregator {
  constructor(
    private registry: SubmissionRegistry,
    private gradeWriter: GradeWriterPort,
  ) {}

  /** 聚合所有（或指定 mode / adapter 的）适配器提交，去重 + 排序 */
  async list(filter: SubmissionFilter, modeId?: string): Promise<AggregatedSubmissionsResult> {
    const wantedAdapters = filter.adapterIds && filter.adapterIds.length > 0 ? new Set(filter.adapterIds) : null;
    const all = this.registry
      .list()
      .filter((a) => !wantedAdapters || wantedAdapters.has(a.descriptor.id))
      .filter(
        (a) =>
          !a.descriptor.modeIds ||
          a.descriptor.modeIds.length === 0 ||
          !modeId ||
          a.descriptor.modeIds.includes(modeId),
      );
    const seen = new Set<string>();
    const submissions: NormalizedSubmission[] = [];
    const errors: Array<{ adapterId: string; message: string }> = [];

    for (const adapter of all) {
      try {
        const items = await adapter.listSubmissions(filter);
        for (const item of items) {
          if (filter.studentId && item.studentId !== filter.studentId) continue;
          if (filter.classId && item.classId !== filter.classId) continue;
          if (filter.lessonId && item.lessonId !== filter.lessonId) continue;
          if (seen.has(item.id)) continue; // (adapterId, externalId) 去重
          seen.add(item.id);
          submissions.push(item);
        }
      } catch (e) {
        errors.push({ adapterId: adapter.descriptor.id, message: e instanceof Error ? e.message : String(e) });
      }
    }

    submissions.sort((a, b) => (b.submittedAt ?? b.startedAt ?? 0) - (a.submittedAt ?? a.startedAt ?? 0));
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
    return { submissions: submissions.slice(0, limit), errors, total: submissions.length };
  }

  /**
   * 把一条插件提交写回平台成绩（成绩采集闭环）。
   * 只接受提供了 toGradeInput 的适配器；成绩写入统一走 grade-writer，守手动分保护。
   */
  async writeGrade(
    adapterId: string,
    submissionId: string,
    filter: SubmissionFilter,
    grade: {
      score: number;
      feedback?: string | null;
      overrideProtected?: boolean;
      reason?: string | null;
      /** 操作者 actor（宿主注入），用于 graded_by 与审计历史；缺省保持旧行为。 */
      actorId?: string | null;
      actorRole?: string | null;
    },
  ): Promise<{ ok: boolean; reason?: string; historyId?: string }> {
    const adapter = this.registry.list().find((a) => a.descriptor.id === adapterId);
    if (!adapter || !adapter.toGradeInput) {
      return { ok: false, reason: 'adapter-not-found-or-no-grade-mapping' };
    }
    const items = await adapter.listSubmissions(filter);
    const sub = items.find((s) => s.id === submissionId);
    // 不能只信适配器自己的过滤：写分是特权操作，命中后必须再按本次授权的
    // classId/lessonId/studentId 复核归属，避免用 A 班授权改到 B 班提交。
    if (
      !sub ||
      (filter.classId && sub.classId !== filter.classId) ||
      (filter.lessonId && sub.lessonId !== filter.lessonId) ||
      (filter.studentId && sub.studentId !== filter.studentId)
    ) {
      return { ok: false, reason: 'submission-not-found' };
    }
    const mapped = adapter.toGradeInput(sub);
    if (!mapped) return { ok: false, reason: 'not-gradeable' };
    // 分数、评语和是否越过手动分保护以教师本次请求为准。适配器只提供作业与学生映射。
    const result = this.gradeWriter.applyGradeChange({
      assignmentId: mapped.assignmentId,
      studentId: mapped.studentId,
      score: grade.score,
      // 本通道只承接教师显式打分（score 必填且 0..100），落库状态即为 graded。
      status: 'graded',
      feedback: grade.feedback ?? null,
      source: 'manual',
      reason: grade.reason ?? mapped.reason ?? 'classroom-flow grade',
      overrideProtected: grade.overrideProtected === true,
      actorId: grade.actorId ?? null,
      actorRole: grade.actorRole ?? null,
    });
    if (result.ok && adapter.afterGrade) {
      try {
        adapter.afterGrade(sub, { score: grade.score, status: 'graded' });
      } catch {
        // 插件侧回写失败不回滚平台成绩册
      }
    }
    return result;
  }
}
