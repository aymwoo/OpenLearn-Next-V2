/**
 * 课堂会话只读查询服务 (ClassroomSessionService)
 *
 * 把 `routes/classroom.ts` 里两段手写的「会话归属裁剪 + 三表 JOIN + 互动统计」
 * SQL 收敛到一处：
 *   - `GET /api/classroom/sessions`（分页 + 筛选 + 统计）
 *   - `GET /api/classroom/active-sessions`（最近活跃会话）
 *
 * 两个端点的非管理员归属条件（teacher_id / 班级 owner / 课节 creator，
 * 以及历史遗留的 teacher 空值兜底）此前各写一遍，任何一侧改动都可能造成
 * 「列表能看、活跃会话看不到」这类不一致。
 *
 * 只读、无 HTTP 依赖，可直接单测；写路径（创建/归档/环节流转）仍留在
 * `ClassroomRuntimeService`，后续按 #427 的分阶段计划继续迁移。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getPresentStudentIds } from '../presence.js';
import { normalizeAcademicYear } from '../utils/academic-year.js';
import { randomId } from '../utils/id.js';
import { ARCHIVED_REPORT_STAGE } from './classroom-runtime-service.js';
import { BUILTIN_TEACHING_MODE_MAP } from './teaching-modes.js';

/** 会话归属判定所需的调用方身份。管理员不做裁剪，tokens 为空。 */
export interface ClassroomActorScope {
  isAdmin: boolean;
  /** 非管理员的归属令牌（user id / username / actorId），已去重 */
  tokens: string[];
}

export interface SessionListFilters {
  classId?: string | null;
  lessonId?: string | null;
  stage?: string | null;
  status?: string | null;
  search?: string | null;
  academicYear?: string | null;
}

export interface SessionListOptions {
  filters?: SessionListFilters;
  actor: ClassroomActorScope;
  page?: number;
  pageSize?: number | 'all';
}

export interface ClassroomSessionStats {
  pollCount: number;
  exitTicketCount: number;
  feedCount: number;
}

export interface ClassroomSessionListItem {
  id: string;
  lessonId: string;
  lessonTitle: string;
  classId: string;
  className: string;
  teacherId: string | null;
  stage: string;
  teachingModeId: string | null;
  teachingModeName: string | null;
  checkinCode: string | null;
  focusMode: boolean;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  presentCount: number;
  stats: ClassroomSessionStats;
}

export interface ClassroomSessionListResult {
  items: ClassroomSessionListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 会话视图状态补丁：currentPage 落 settings_json，activeSegmentId 落独立列。 */
export interface SessionViewStatePatch {
  currentPage?: number;
  activeSegmentId?: string | null;
}

/** 会话现场：原始整行 + 当前活动投票 / 抢答器，由调用方按角色裁剪。 */
export interface ClassroomSessionDetail {
  session: Record<string, unknown> | null;
  activePoll: Record<string, unknown> | null;
  activeBuzzer: Record<string, unknown> | null;
}

/** 学生端「当前可进入的课堂」DTO。 */
export interface ClassroomStudentActiveSession {
  sessionId: string;
  lessonId: string;
  lessonTitle: string;
  classId: string;
  className: string;
  stage: string;
  startedAt: number | null;
}

/** 极速投票创建入参（会话 / 课节归属由调用方先鉴权）。 */
export interface QuickPollInput {
  sessionId: string;
  lessonId: string;
  questionType: string;
  title: string;
  options: string[];
  correctOption?: string | null;
}

/** 投票快照：只暴露路由判定与统计需要的字段。 */
export interface QuickPollSnapshot {
  id: string;
  sessionId: string;
  lessonId: string;
  status: string;
  options: string[];
}

/** 投票聚合结果（按选项计数，不含投票人信息）。 */
export interface QuickPollTally {
  distribution: Record<string, number>;
  totalVotes: number;
}

/** 新建投票后返回给发起教师的数据（含正确答案，不可广播）。 */
export interface QuickPollCreated {
  id: string;
  sessionId: string;
  lessonId: string;
  questionType: string;
  title: string;
  options: string[];
  correctOption: string | null;
  status: 'ACTIVE';
  totalVotes: number;
  /** 保留旧响应里的 votes 字段（始终为空对象，历史客户端会读取）。 */
  votes: Record<string, number>;
}

/** 活跃会话端点使用的显式投影（不含 checkin_code / settings_json）。 */
export interface ClassroomActiveSessionRow {
  id: string;
  lesson_id: string;
  class_id: string;
  teacher_id: string | null;
  stage: string;
  current_segment_id: string | null;
  focus_mode: number | boolean;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
  teaching_mode_id: string | null;
  academic_year: string | null;
  lesson_title: string | null;
  class_name: string | null;
}

interface RawSessionRow {
  id: string;
  lesson_id: string;
  class_id: string;
  teacher_id: string | null;
  stage: string;
  current_segment_id: string | null;
  checkin_code: string | null;
  focus_mode: number | boolean;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
  teaching_mode_id: string | null;
  academic_year: string | null;
  lesson_title: string | null;
  class_name: string | null;
}

/** 分页参数归一化：`all` 视为一次取 1000 条（管理端导出场景）。 */
export function normalizeSessionPagination(
  page?: number,
  pageSize?: number | 'all',
): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  if (pageSize === 'all') {
    return { page: safePage, pageSize: 1000, offset: (safePage - 1) * 1000 };
  }
  const safeSize = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 20)));
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

/**
 * 生成会话归属的 WHERE 片段。
 *
 * 非管理员只能看到：自己带的会话、自己拥有的班级的会话、自己创建的课节的会话，
 * 以及历史数据中 teacher/owner/creator 全为空、无法归属的会话（保持既有语义，
 * 否则老数据会整体从列表消失）。
 *
 * @param alias classroom_sessions 的 SQL 别名
 */
export function buildSessionOwnershipClause(
  actor: ClassroomActorScope,
  alias = 'cs',
): { clause: string | null; params: string[] } {
  if (actor.isAdmin) return { clause: null, params: [] };
  if (actor.tokens.length === 0) return { clause: '1 = 0', params: [] };
  const placeholders = actor.tokens.map(() => '?').join(',');
  const clause = `(
    ${alias}.teacher_id IN (${placeholders})
    OR c.owner_user_id IN (${placeholders})
    OR l.creator_id IN (${placeholders})
    OR (
      (${alias}.teacher_id IS NULL OR ${alias}.teacher_id = '' OR ${alias}.teacher_id = 'teacher')
      AND (c.owner_user_id IS NULL OR c.owner_user_id = '')
      AND (l.creator_id IS NULL OR l.creator_id = '')
    )
  )`;
  return { clause, params: [...actor.tokens, ...actor.tokens, ...actor.tokens] };
}

/** 解析投票 options_json；损坏或非数组一律视为空选项集（保持旧行为的容错口径）。 */
function parsePollOptions(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export class ClassroomSessionService {
  /** 测试可注入独立库；生产用 kernelContainer 的进程级单例。 */
  constructor(private readonly dbOverride?: Database.Database) {}

  private get db(): Database.Database {
    return this.dbOverride ?? kernelContainer.db;
  }

  /** 分页查询课堂会话，附带投票/通票/信息流互动计数。 */
  listSessions(options: SessionListOptions): ClassroomSessionListResult {
    const filters = options.filters ?? {};
    const { page, pageSize, offset } = normalizeSessionPagination(options.page, options.pageSize);

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.classId && filters.classId.trim()) {
      conditions.push('cs.class_id = ?');
      params.push(filters.classId.trim());
    }
    if (filters.lessonId && filters.lessonId.trim()) {
      conditions.push('cs.lesson_id = ?');
      params.push(filters.lessonId.trim());
    }

    const stage = filters.stage && filters.stage !== 'all' ? filters.stage.trim() : '';
    if (stage) {
      conditions.push('cs.stage = ?');
      params.push(stage);
    } else if (filters.status === 'active') {
      conditions.push('cs.stage != ?');
      params.push(ARCHIVED_REPORT_STAGE);
    } else if (filters.status === 'archived') {
      conditions.push('cs.stage = ?');
      params.push(ARCHIVED_REPORT_STAGE);
    }

    if (filters.search && filters.search.trim()) {
      const keyword = `%${filters.search.trim()}%`;
      conditions.push('(l.title LIKE ? OR c.name LIKE ? OR cs.id LIKE ?)');
      params.push(keyword, keyword, keyword);
    }

    if (filters.academicYear && filters.academicYear.trim()) {
      const normalized = normalizeAcademicYear(filters.academicYear);
      // 无效值不追加条件（保持旧行为：返回全部而不是 500）。
      if (normalized) {
        conditions.push('cs.academic_year = ?');
        params.push(normalized);
      }
    }

    const ownership = buildSessionOwnershipClause(options.actor, 'cs');
    if (ownership.clause) {
      conditions.push(ownership.clause);
      params.push(...ownership.params);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM classroom_sessions cs
           LEFT JOIN lessons l ON cs.lesson_id = l.id
           LEFT JOIN classes c ON cs.class_id = c.id
           ${whereClause}`,
      )
      .get(...params) as { total: number } | undefined;
    const total = totalRow?.total ?? 0;

    const rows = this.db
      .prepare(
        `SELECT
            cs.id,
            cs.lesson_id,
            cs.class_id,
            cs.teacher_id,
            cs.stage,
            cs.current_segment_id,
            cs.checkin_code,
            cs.focus_mode,
            cs.started_at,
            cs.ended_at,
            cs.created_at,
            cs.teaching_mode_id,
            cs.academic_year,
            l.title AS lesson_title,
            c.name AS class_name
          FROM classroom_sessions cs
          LEFT JOIN lessons l ON cs.lesson_id = l.id
          LEFT JOIN classes c ON cs.class_id = c.id
          ${whereClause}
          ORDER BY cs.created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as RawSessionRow[];

    const statsMap = this.loadSessionStats(rows.map((row) => row.id));

    const items = rows.map((row) => {
      const stats = statsMap.get(row.id) ?? { pollCount: 0, exitTicketCount: 0, feedCount: 0 };
      const mode = row.teaching_mode_id ? BUILTIN_TEACHING_MODE_MAP.get(row.teaching_mode_id) : undefined;
      return {
        id: row.id,
        lessonId: row.lesson_id,
        lessonTitle: row.lesson_title || '未命名课程',
        classId: row.class_id,
        className: row.class_name || '未绑定班级',
        teacherId: row.teacher_id,
        stage: row.stage,
        teachingModeId: row.teaching_mode_id,
        teachingModeName: mode?.name || row.teaching_mode_id || null,
        checkinCode: row.checkin_code,
        focusMode: Boolean(row.focus_mode),
        startedAt: row.started_at,
        endedAt: row.ended_at,
        createdAt: row.created_at,
        // 已进入本节 live class 且仍在线的学生数（Issue #91）。
        // 用 getPresentStudentIds 而非在线总人数：历史签到不算，已离开的不算。
        presentCount: getPresentStudentIds(row.lesson_id).length,
        stats,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 最近活跃会话（`stage != ARCHIVED_REPORT`），默认最多 10 条。
   * 投影为显式列，不下发 checkin_code / settings_json（Issue #241）。
   */
  listActiveSessions(actor: ClassroomActorScope, limit = 10): ClassroomActiveSessionRow[] {
    const conditions: string[] = ['s.stage != ?'];
    const params: (string | number)[] = [ARCHIVED_REPORT_STAGE];

    const ownership = buildSessionOwnershipClause(actor, 's');
    if (ownership.clause) {
      conditions.push(ownership.clause);
      params.push(...ownership.params);
    }

    return this.db
      .prepare(
        `SELECT
            s.id,
            s.lesson_id,
            s.class_id,
            s.teacher_id,
            s.stage,
            s.current_segment_id,
            s.focus_mode,
            s.started_at,
            s.ended_at,
            s.created_at,
            s.teaching_mode_id,
            s.academic_year,
            l.title AS lesson_title,
            c.name AS class_name
          FROM classroom_sessions s
          LEFT JOIN lessons l ON s.lesson_id = l.id
          LEFT JOIN classes c ON s.class_id = c.id
          WHERE ${conditions.join(' AND ')}
          ORDER BY s.created_at DESC
          LIMIT ?`,
      )
      .all(...params, limit) as ClassroomActiveSessionRow[];
  }

  /** 读取某课节当前活动会话整行（`stage != ARCHIVED_REPORT`，取最新一条）。 */
  getActiveSessionForLesson(lessonId: string): Record<string, unknown> | null {
    const row = this.db
      .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1')
      .get(lessonId, ARCHIVED_REPORT_STAGE) as Record<string, unknown> | undefined;
    return row ?? null;
  }

  /**
   * 回写会话视图状态（教师切页 / 切环节的防抖落库）。
   *
   * currentPage 用 `json_set` 原子更新，避免读整列再写回覆盖掉并发的 countdown
   * 等其它 settings 字段（P1-4）。返回更新后的 `viewState`；会话不存在返回 null。
   */
  updateViewState(sessionId: string, patch: SessionViewStatePatch): Record<string, unknown> | null {
    if (patch.currentPage !== undefined) {
      this.db
        .prepare(
          `UPDATE classroom_sessions
              SET settings_json = json_set(coalesce(settings_json, '{}'), '$.viewState.currentPage', ?)
            WHERE id = ?`,
        )
        .run(Math.floor(patch.currentPage), sessionId);
    }

    if (patch.activeSegmentId !== undefined) {
      const segmentId = patch.activeSegmentId === null ? null : String(patch.activeSegmentId).slice(0, 128);
      this.db.prepare('UPDATE classroom_sessions SET current_segment_id = ? WHERE id = ?').run(segmentId, sessionId);
    }

    const fresh = this.db.prepare('SELECT settings_json FROM classroom_sessions WHERE id = ?').get(sessionId) as
      { settings_json: string | null } | undefined;
    if (!fresh) return null;
    try {
      const settings = JSON.parse(fresh.settings_json || '{}') as { viewState?: Record<string, unknown> };
      return settings.viewState ?? {};
    } catch {
      return {};
    }
  }

  /**
   * 读取某课节的最新会话现场（会话整行 + 当前活动投票 + 活动抢答器）。
   *
   * 返回**未裁剪**的原始行：调用方必须按角色剥离 `settings_json` / `checkin_code` /
   * 答案字段（教师与学生的可见范围不同）。服务层只负责取数，不掺授权判定。
   */
  getSessionDetail(lessonId: string): ClassroomSessionDetail {
    const session = this.db
      .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(lessonId) as Record<string, unknown> | undefined;
    if (!session) return { session: null, activePoll: null, activeBuzzer: null };

    const sessionId = String(session.id ?? '');
    const activePoll =
      (this.db
        .prepare(
          'SELECT * FROM classroom_quick_polls WHERE session_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(sessionId, 'ACTIVE') as Record<string, unknown> | undefined) ?? null;

    if (activePoll) {
      try {
        activePoll.options = JSON.parse(String(activePoll.options_json));
      } catch {
        activePoll.options = [];
      }
      // v0.6.1 数据真实性：中控「结束投票 (N人)」此前读不存在的字段恒为 0。
      try {
        const counted = this.db
          .prepare('SELECT COUNT(*) AS n FROM classroom_poll_votes WHERE poll_id = ?')
          .get(String(activePoll.id ?? '')) as { n: number } | undefined;
        activePoll.totalVotes = counted?.n ?? 0;
      } catch {
        activePoll.totalVotes = 0;
      }
    }

    const activeBuzzer =
      (this.db
        .prepare('SELECT * FROM classroom_buzzers WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(sessionId) as Record<string, unknown> | undefined) ?? null;

    return { session, activePoll, activeBuzzer };
  }

  /**
   * 学生当前可进入的课堂会话：优先 IN_CLASS_TEACHING / WRAP_UP_EXIT_TICKET，
   * 其次其他非归档阶段；同一班级可能并行多个课节，取最新创建的一个。
   */
  getStudentActiveSession(studentId: string): ClassroomStudentActiveSession | null {
    const row = this.db
      .prepare(
        `SELECT cs.id AS session_id, cs.lesson_id, cs.class_id, cs.stage, cs.started_at, cs.created_at,
                l.title AS lesson_title, c.name AS class_name
           FROM classroom_sessions cs
           INNER JOIN class_students cst ON cst.class_id = cs.class_id
           LEFT JOIN lessons l ON l.id = cs.lesson_id
           LEFT JOIN classes c ON c.id = cs.class_id
          WHERE cst.student_id = ? AND cs.stage != ?
          ORDER BY
            CASE WHEN cs.stage IN ('IN_CLASS_TEACHING', 'WRAP_UP_EXIT_TICKET') THEN 0 ELSE 1 END,
            cs.created_at DESC
          LIMIT 1`,
      )
      .get(studentId, ARCHIVED_REPORT_STAGE) as
      | {
          session_id: string;
          lesson_id: string;
          class_id: string;
          stage: string;
          started_at: number | null;
          created_at: number;
          lesson_title: string | null;
          class_name: string | null;
        }
      | undefined;

    if (!row) return null;
    return {
      sessionId: row.session_id,
      lessonId: row.lesson_id,
      lessonTitle: row.lesson_title || '',
      classId: row.class_id,
      className: row.class_name || '',
      stage: row.stage,
      startedAt: row.started_at ?? null,
    };
  }

  /** 读取投票快照（选项已解析）。不存在返回 null。 */
  getQuickPoll(pollId: string): QuickPollSnapshot | null {
    const row = this.db
      .prepare('SELECT id, session_id, lesson_id, status, options_json FROM classroom_quick_polls WHERE id = ?')
      .get(pollId) as
      { id: string; session_id: string; lesson_id: string; status: string; options_json: string | null } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      lessonId: row.lesson_id,
      status: row.status,
      options: parsePollOptions(row.options_json),
    };
  }

  /**
   * 创建极速投票：先关闭同一会话里仍 ACTIVE 的投票，再插入新投票。
   * 两条语句放在同一事务里 —— 旧实现先 UPDATE 再 INSERT，插入失败会留下
   * 「没有任何进行中投票」的空窗。
   */
  createQuickPoll(input: QuickPollInput): QuickPollCreated {
    const pollId = randomId('poll_');
    const now = Date.now();
    const correctOption = input.correctOption || null;

    const create = this.db.transaction(() => {
      this.db
        .prepare('UPDATE classroom_quick_polls SET status = ? WHERE session_id = ? AND status = ?')
        .run('CLOSED', input.sessionId, 'ACTIVE');
      this.db
        .prepare(
          `INSERT INTO classroom_quick_polls
             (id, session_id, lesson_id, question_type, title, options_json, correct_option, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        )
        .run(
          pollId,
          input.sessionId,
          input.lessonId,
          input.questionType,
          input.title,
          JSON.stringify(input.options),
          correctOption,
          now,
        );
    });
    create();

    return {
      id: pollId,
      sessionId: input.sessionId,
      lessonId: input.lessonId,
      questionType: input.questionType,
      title: input.title,
      options: input.options,
      correctOption,
      status: 'ACTIVE',
      votes: {},
      totalVotes: 0,
    };
  }

  /**
   * 学生投票：同一学生对同一投票重复提交时按 (poll_id, student_id) 覆盖。
   * 选项合法性由调用方用 getQuickPoll().options 校验（错误语义属于 HTTP 层）。
   */
  voteQuickPoll(pollId: string, studentId: string, studentName: string, option: string): QuickPollTally {
    const voteId = randomId('vote_');
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO classroom_poll_votes (id, poll_id, student_id, student_name, selected_option, voted_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(poll_id, student_id) DO UPDATE SET
           selected_option = excluded.selected_option,
           voted_at = excluded.voted_at`,
      )
      .run(voteId, pollId, studentId, studentName, option, now);
    return this.tallyQuickPoll(pollId);
  }

  /** 关闭投票并返回最终聚合结果。 */
  closeQuickPoll(pollId: string): QuickPollTally {
    this.db.prepare('UPDATE classroom_quick_polls SET status = ? WHERE id = ?').run('CLOSED', pollId);
    return this.tallyQuickPoll(pollId);
  }

  /** 按选项聚合票数（不含投票人身份，保护学生隐私）。 */
  private tallyQuickPoll(pollId: string): QuickPollTally {
    const rows = this.db
      .prepare(
        'SELECT selected_option, COUNT(*) AS count FROM classroom_poll_votes WHERE poll_id = ? GROUP BY selected_option',
      )
      .all(pollId) as { selected_option: string; count: number }[];

    const distribution: Record<string, number> = {};
    let totalVotes = 0;
    for (const row of rows) {
      distribution[row.selected_option] = row.count;
      totalVotes += row.count;
    }
    return { distribution, totalVotes };
  }

  /**
   * 批量统计会话下的投票 / 通票 / 信息流条数。
   * 单表缺失（历史库/精简测试 schema）时降级为 0，不影响会话列表本身。
   */
  private loadSessionStats(sessionIds: string[]): Map<string, ClassroomSessionStats> {
    const stats = new Map<string, ClassroomSessionStats>();
    if (sessionIds.length === 0) return stats;

    const placeholders = sessionIds.map(() => '?').join(',');
    const queries: Array<{ key: keyof ClassroomSessionStats; table: string }> = [
      { key: 'pollCount', table: 'classroom_quick_polls' },
      { key: 'exitTicketCount', table: 'classroom_exit_tickets' },
      { key: 'feedCount', table: 'classroom_feed' },
    ];

    for (const { key, table } of queries) {
      try {
        const rows = this.db
          .prepare(
            `SELECT session_id, COUNT(*) AS count FROM ${table} WHERE session_id IN (${placeholders}) GROUP BY session_id`,
          )
          .all(...sessionIds) as { session_id: string; count: number }[];
        for (const row of rows) {
          const current = stats.get(row.session_id) ?? { pollCount: 0, exitTicketCount: 0, feedCount: 0 };
          current[key] = row.count;
          stats.set(row.session_id, current);
        }
      } catch {
        // 表不存在或查询失败：该维度保持 0。
      }
    }

    return stats;
  }
}

/** 进程级默认实例：路由与插件都通过它读取会话，避免每请求 new。 */
export const classroomSessionService = new ClassroomSessionService();
