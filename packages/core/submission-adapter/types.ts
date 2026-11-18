/**
 * 提交适配器契约（设计 Q2/Q8 的"成绩采集"闭环）。
 *
 * 第三方教学模式（学案/Moodle）的提交不必写平台 courseware_attempts 表：
 * 插件实现一个 SubmissionAdapter，把自有存储里的作答规范化成 NormalizedSubmission，
 * 注册进 SubmissionRegistry。统一成绩面板经聚合器同时看到内置课件提交与插件提交。
 */

export type SubmissionKind = 'assignment' | 'quiz' | 'artifact' | 'participation' | 'custom';
export type SubmissionStatus = 'started' | 'submitted' | 'graded' | 'absent' | 'draft';

/** 统一提交视图（面板消费的最小公共形状） */
export interface NormalizedSubmission {
  /** 全局唯一：由 source.adapterId + externalId 生成，天然幂等去重 */
  id: string;
  source: {
    pluginId: string; // 'official' 表示平台内置
    adapterId: string;
    externalId: string;
    modeId?: string;
  };
  lessonId: string;
  classId: string;
  segmentId?: string | null;
  studentId: string;
  studentName?: string | null;
  kind: SubmissionKind;
  status: SubmissionStatus;
  startedAt?: number | null;
  submittedAt?: number | null;
  /** 0..100；null = 未判分 */
  score?: number | null;
  /** 0..1 */
  completion?: number | null;
  /** 原始数据在插件自有存储；宿主只存引用，不吞业务数据 */
  rawRef?: string | null;
  visibility?: 'teacher' | 'student' | 'anonymous';
}

export interface SubmissionFilter {
  lessonId?: string;
  classId?: string;
  studentId?: string;
  kinds?: SubmissionKind[];
  since?: number;
  limit?: number;
}

export interface SubmissionAdapterDescriptor {
  id: string;
  owner: string; // pluginId；'official' 表示平台内置适配器
  kinds: SubmissionKind[];
  modeIds?: string[]; // 仅在这些教学模式启用；空 = 全局
  label?: string;
}

/** 插件实现的适配器：把自有作答投影为统一视图 */
export interface SubmissionAdapter {
  readonly descriptor: SubmissionAdapterDescriptor;
  listSubmissions(filter: SubmissionFilter): Promise<NormalizedSubmission[]> | NormalizedSubmission[];
  /** 查看原始作答（插件自有数据），返回前必须由插件侧脱敏 */
  getRaw?(submissionId: string): Promise<unknown> | unknown;
  /** 把统一视图中的一条映射为成绩写入输入；返回 null 表示不参与成绩 */
  toGradeInput?(sub: NormalizedSubmission): GradeWriteInputView | null;
}

/** 成绩写入输入（与 grade-writer 的 GradeWriteInput 对齐的视图） */
export interface GradeWriteInputView {
  assignmentId: string;
  studentId: string;
  score: number | null;
  status?: string;
  feedback?: string | null;
  source: 'manual' | 'auto' | 'ai' | 'plugin' | 'system';
  reason?: string | null;
  overrideProtected?: boolean;
}

export interface RegisterAdapterResult {
  ok: boolean;
  code?: 'INVALID_ADAPTER' | 'ADAPTER_EXISTS';
  message?: string;
}
