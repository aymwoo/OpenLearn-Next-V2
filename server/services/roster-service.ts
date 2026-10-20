/**
 * 班级花名册与学生领域服务 (RosterService)
 *
 * 承载班级全生命周期、学生 12 张表级联删除事务、批量选课算法、
 * 智能自动分组、机房排座事务以及班级/学生看板统计。
 * 独立于 HTTP 传输层，可直接进行无状态单元测试。
 */
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { hashPassword as bcryptHashPassword } from '../../packages/core/db/index.js';
import { randomId } from '../utils/id.js';
import { generateStudentNumber } from '../routes/shared.js';
import { recordSecurityAudit } from '../../packages/core/observability/audit-log.js';
import type { Pagination } from '../utils/pagination.js';
import { openClassPasscode, sealClassPasscode } from '../../packages/core/db/class-passcode-crypto.js';
import { sanitizePrivateNotes } from '../../packages/core/security/html-sanitize.js';

export interface ClassItem {
  id: string;
  name: string;
  description?: string | null;
  lab_id?: string | null;
  student_count?: number;
  course_count?: number;
  assignment_count?: number;
  created_at: number;
}

export interface StudentItem {
  id: string;
  student_number: string;
  name: string;
  email?: string | null;
  avatar?: string | null;
  locked_lesson_id?: string | null;
  lock_mode?: 'full' | 'navigation' | null;
  lock_target?: string | null;
  private_notes?: string | null;
  created_at: number;
  joined_at?: number;
}

/**
 * 学生自查可见的字段子集。
 *
 * 学生端只需要「自己这一条」来在本地执行锁定状态（`locked_lesson_id` /
 * `lock_mode` / `lock_target`，见 `useStudentViewState`），因此**不下发**
 * 邮箱与教师私有备注（`private_notes`）。
 */
export type StudentSelfItem = Pick<
  StudentItem,
  'id' | 'student_number' | 'name' | 'avatar' | 'locked_lesson_id' | 'lock_mode' | 'lock_target' | 'created_at'
>;

export interface BulkEnrollInput {
  name: string;
  email?: string;
  student_number?: string;
  password?: string;
  private_notes?: string;
}

export interface BulkEnrollResultItem {
  id: string;
  name: string;
  student_number?: string;
  email?: string;
  status: 'created_and_enrolled' | 'enrolled_existing';
  /** 系统自动生成初始密码时回传（仅新建学生有），教师需据此分发 */
  initial_password?: string;
}

/** 批量导入单行输入（CSV / JSON 归一化后的形态）。 */
export interface RosterImportInput {
  name?: string;
  email?: string;
  student_number?: string;
  password?: string;
  private_notes?: string;
}

/**
 * 批量导入结果项。
 *
 * `initial_password` 仅在「CSV 未提供密码 → 系统自动生成」时返回明文，供教师
 * 分发给学生；CSV 已显式指定密码时**不回传**（教师自己填的，无需再告知）。
 */
export interface RosterImportResult {
  id: string;
  name: string;
  email: string;
  student_number: string;
  /** true = 本次新建；false = 命中已有学生，未改动其任何字段 */
  created: boolean;
  initial_password?: string;
}

/** 去重命中时读出的已有学生行（仅取回传给教师所需的字段）。 */
interface ExistingStudentRow {
  id: string;
  student_number: string | null;
  name: string;
  email: string | null;
}

export interface ClassGroupItem {
  id: string;
  class_id: string;
  name: string;
  name_en?: string | null;
  color: string;
  member_ids: string[];
  memberIds: string[];
  leader_id?: string | null;
  is_default: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export class RosterService {
  private readonly pluginHost?: any;

  constructor(
    private readonly db: Database.Database = kernelContainer.db,
    private readonly readDb?: Database.Database,
    pluginHost?: any,
  ) {
    this.pluginHost = pluginHost || (kernelContainer as any)?.pluginHost;
  }

  private get reader(): Database.Database {
    return this.readDb || kernelContainer.getReadDb() || this.db;
  }

  // ── 辅助工具 ────────────────────────────────────────────────────────────────

  private generateInitialPassword(): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(12);
    let out = '';
    for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  private clearDefaultMarker(classId: string): void {
    this.db.prepare('UPDATE class_groups SET is_default = 0 WHERE class_id = ? AND is_default = 1').run(classId);
  }

  private parseGroupRow(row: any): ClassGroupItem | null {
    if (!row) return null;
    let memberIds: string[] = [];
    try {
      memberIds = JSON.parse(row.member_ids || '[]');
    } catch {
      memberIds = [];
    }
    return {
      id: row.id,
      class_id: row.class_id,
      name: row.name,
      name_en: row.name_en,
      color: row.color,
      member_ids: memberIds,
      memberIds,
      leader_id: row.leader_id,
      is_default: Boolean(row.is_default),
      sort_order: row.sort_order,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // ── 1. 班级生命周期管理 ──────────────────────────────────────────────────────

  public listClasses(
    pg: Pagination,
    scope?: { mode?: 'all' | 'owner' | 'enrolled'; userId?: string },
  ): { data: ClassItem[]; total: number; page: number; pageSize: number } {
    const mode = scope?.mode ?? 'all';
    const userId = scope?.userId ?? '';
    let where = '';
    const whereParams: unknown[] = [];
    if (mode === 'owner') {
      where = 'WHERE c.owner_user_id = ?';
      whereParams.push(userId);
    } else if (mode === 'enrolled') {
      where = 'WHERE c.id IN (SELECT class_id FROM class_students WHERE student_id = ?)';
      whereParams.push(userId);
    }
    const total = (this.reader.prepare(`SELECT COUNT(*) AS n FROM classes c ${where}`).get(...whereParams) as any).n;
    const classes = this.reader
      .prepare(
        `
        SELECT c.id, c.name, c.description, c.lab_id, c.owner_user_id, c.created_at,
          (SELECT COUNT(*) FROM class_students WHERE class_id = c.id) AS student_count,
          (SELECT COUNT(*) FROM schedules WHERE class_id = c.id) AS course_count,
          (SELECT COUNT(*) FROM assignments WHERE class_id = c.id) AS assignment_count
        FROM classes c
        ${where}
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(
        ...whereParams,
        pg.isAll ? -1 : ((pg as any).pageSize ?? (pg as any).limit ?? 20),
        pg.offset ?? 0,
      ) as ClassItem[];

    const pageSize = pg.isAll ? total : ((pg as any).pageSize ?? (pg as any).limit ?? 20);
    return { data: classes, total, page: pg.page ?? 1, pageSize };
  }

  public createClass(name: string, description?: string, labId?: string, ownerUserId?: string | null): string {
    if (!name?.trim()) throw new Error('Class name is required');
    const classId = randomId('cls_');
    this.db
      .prepare(
        'INSERT INTO classes (id, name, description, lab_id, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(classId, name.trim(), description || '', labId || null, ownerUserId || null, Date.now());
    return classId;
  }

  /**
   * 部分更新：只为**显式传入**的字段生成 SET 子句（与 `updateGroup` 同一写法）。
   *
   * 此前是全量覆盖（`SET name = ?, description = ?, lab_id = ?`），任何只带 `name`
   * 的请求都会把 `description` 与 `lab_id` 清空 —— `lab_id` 是班级↔机房绑定，
   * `getClassSeats` 依赖它，置空后排座 UI 失效。同时"只改 description"的请求
   * 会被路由层 `if (name)` 门控整条丢弃（旧代码是逐字段 `if (x !== undefined)`）。
   *
   * 约定：`undefined` = 不改该字段；`''` / `null` = 显式清空。
   */
  public updateClass(id: string, name?: string, description?: string, labId?: string): void {
    const sets: string[] = [];
    const args: unknown[] = [];

    if (name !== undefined) {
      if (!name?.trim()) {
        const err = new Error('Class name is required') as Error & { status?: number };
        err.status = 400;
        throw err;
      }
      sets.push('name = ?');
      args.push(name.trim());
    }
    if (description !== undefined) {
      sets.push('description = ?');
      args.push(description || '');
    }
    if (labId !== undefined) {
      sets.push('lab_id = ?');
      args.push(labId || null);
    }

    if (sets.length === 0) {
      const err = new Error('没有可更新的字段') as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    const res = this.db.prepare('UPDATE classes SET ' + sets.join(', ') + ' WHERE id = ?').run(...args, id);
    if (res.changes === 0) {
      const err = new Error('Class not found') as Error & { status?: number };
      err.status = 404;
      throw err;
    }
  }

  public getClassPasscode(id: string): {
    classId: string;
    className: string;
    classPasscode: string | null;
    expiresAt: number | null;
    isExpired: boolean;
    remainingSeconds: number | null;
    studentCount: number;
  } {
    const cls = this.db
      .prepare('SELECT id, name, class_passcode, class_passcode_expires_at FROM classes WHERE id = ?')
      .get(id) as { id: string; name: string; class_passcode?: string; class_passcode_expires_at?: number } | undefined;
    if (!cls) throw new Error('Class not found');

    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM class_students WHERE class_id = ?').get(id) as any;

    const now = Date.now();
    let passcode = openClassPasscode(cls.class_passcode);
    let expiresAt = cls.class_passcode_expires_at ?? null;

    if (!passcode || !expiresAt || now > expiresAt) {
      passcode = Math.floor(100000 + Math.random() * 900000).toString();
      expiresAt = now + 4 * 60 * 60 * 1000; // 4 hours
      this.db
        .prepare('UPDATE classes SET class_passcode = ?, class_passcode_expires_at = ? WHERE id = ?')
        .run(sealClassPasscode(passcode), expiresAt, id);
    }

    const isExpired = expiresAt ? now > expiresAt : false;
    const remainingSeconds = expiresAt && !isExpired ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : null;

    return {
      classId: cls.id,
      className: cls.name,
      classPasscode: passcode || null,
      expiresAt,
      isExpired,
      remainingSeconds,
      studentCount: countRow?.count ?? 0,
    };
  }

  public deleteClassCascade(classId: string): void {
    const tx = this.db.transaction(() => {
      // P0-1 修复：删班只删本班域。先记录本班学生，绝不删除跨班学生的全局行；
      // 删选课后成为孤儿（不属于任何班级）的学生，才 GC 其无归属的全局残留，
      // students 本体默认保留（需二次确认的 GDPR 流程才删）。
      const memberIds = (
        this.db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId) as {
          student_id: string;
        }[]
      ).map((r) => r.student_id);
      const tableExists = (name: string) =>
        !!this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

      // 1. 先清本班的选课关系（后续孤儿判定依赖此结果）
      this.db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
      this.db
        .prepare(
          'DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)',
        )
        .run(classId);
      this.db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);

      // 插件作业生态清理
      if (tableExists('plugin_assignments')) {
        if (tableExists('plugin_assignment_files')) {
          this.db
            .prepare(
              'DELETE FROM plugin_assignment_files WHERE assignment_id IN (SELECT id FROM plugin_assignments WHERE class_id = ?)',
            )
            .run(classId);
        }
        if (tableExists('plugin_peer_review_tasks')) {
          this.db
            .prepare(
              'DELETE FROM plugin_peer_review_tasks WHERE assignment_id IN (SELECT id FROM plugin_assignments WHERE class_id = ?)',
            )
            .run(classId);
        }
        if (tableExists('plugin_peer_reviews')) {
          this.db
            .prepare(
              'DELETE FROM plugin_peer_reviews WHERE assignment_id IN (SELECT id FROM plugin_assignments WHERE class_id = ?)',
            )
            .run(classId);
        }
        if (tableExists('plugin_grades')) {
          this.db
            .prepare(
              'DELETE FROM plugin_grades WHERE assignment_id IN (SELECT id FROM plugin_assignments WHERE class_id = ?)',
            )
            .run(classId);
        }
        if (tableExists('plugin_submission_versions')) {
          this.db
            .prepare(
              'DELETE FROM plugin_submission_versions WHERE assignment_id IN (SELECT id FROM plugin_assignments WHERE class_id = ?)',
            )
            .run(classId);
        }
        if (tableExists('plugin_submissions')) {
          this.db
            .prepare(
              'DELETE FROM plugin_submissions WHERE assignment_id IN (SELECT id FROM plugin_assignments WHERE class_id = ?)',
            )
            .run(classId);
        }
        this.db.prepare('DELETE FROM plugin_assignments WHERE class_id = ?').run(classId);
      }

      // 考试与学期成绩关联表清理
      if (tableExists('exams')) {
        if (tableExists('exam_scores')) {
          this.db
            .prepare('DELETE FROM exam_scores WHERE exam_id IN (SELECT id FROM exams WHERE class_id = ?)')
            .run(classId);
        }
        this.db.prepare('DELETE FROM exams WHERE class_id = ?').run(classId);
      }
      if (tableExists('class_grade_weights')) {
        this.db.prepare('DELETE FROM class_grade_weights WHERE class_id = ?').run(classId);
      }
      if (tableExists('semester_grades')) {
        this.db.prepare('DELETE FROM semester_grades WHERE class_id = ?').run(classId);
      }

      // 课堂互动会话与关联瞬态数据清理
      if (tableExists('classroom_sessions')) {
        const sessionSubquery = 'SELECT id FROM classroom_sessions WHERE class_id = ?';
        if (tableExists('classroom_poll_votes') && tableExists('classroom_quick_polls')) {
          this.db
            .prepare(
              `DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE session_id IN (${sessionSubquery}))`,
            )
            .run(classId);
        }
        if (tableExists('classroom_quick_polls')) {
          this.db.prepare(`DELETE FROM classroom_quick_polls WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_buzzers')) {
          this.db.prepare(`DELETE FROM classroom_buzzers WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_exit_tickets')) {
          this.db.prepare(`DELETE FROM classroom_exit_tickets WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_pacing_signals')) {
          this.db.prepare(`DELETE FROM classroom_pacing_signals WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_danmaku')) {
          this.db.prepare(`DELETE FROM classroom_danmaku WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_peer_review_tasks')) {
          this.db.prepare(`DELETE FROM classroom_peer_review_tasks WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_peer_reviews')) {
          this.db.prepare(`DELETE FROM classroom_peer_reviews WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_peer_badges')) {
          this.db.prepare(`DELETE FROM classroom_peer_badges WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_peer_nominations')) {
          this.db.prepare(`DELETE FROM classroom_peer_nominations WHERE session_id IN (${sessionSubquery})`).run(classId);
        }
        if (tableExists('classroom_peer_rubric_dimensions')) {
          this.db
            .prepare(`DELETE FROM classroom_peer_rubric_dimensions WHERE session_id IN (${sessionSubquery})`)
            .run(classId);
        }
        if (tableExists('classroom_feed')) {
          this.db
            .prepare(`DELETE FROM classroom_feed WHERE session_id IN (${sessionSubquery}) OR class_id = ?`)
            .run(classId, classId);
        }
        this.db.prepare('DELETE FROM classroom_sessions WHERE class_id = ?').run(classId);
      }

      this.db
        .prepare('DELETE FROM attendance WHERE schedule_id IN (SELECT id FROM schedules WHERE class_id = ?)')
        .run(classId);
      this.db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
      this.db.prepare('DELETE FROM student_seats WHERE class_id = ?').run(classId);
      try {
        this.db.prepare('DELETE FROM student_rollcalls WHERE class_id = ?').run(classId);
      } catch {}
      this.db.prepare('DELETE FROM class_groups WHERE class_id = ?').run(classId);
      this.db.prepare('DELETE FROM classes WHERE id = ?').run(classId);

      // 2. 孤儿 GC：本班学生中删选课后已不属于任何班级的，仅清其无归属全局残留
      const stillEnrolled = this.db.prepare('SELECT 1 AS ok FROM class_students WHERE student_id = ? LIMIT 1');
      const delProgress = this.db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?');
      const delReadNotif = this.db.prepare('DELETE FROM student_read_notifications WHERE student_id = ?');
      const delSubByStudent = this.db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?');
      for (const sid of memberIds) {
        if (!stillEnrolled.get(sid)) {
          delProgress.run(sid);
          try {
            delReadNotif.run(sid);
          } catch {}
          try {
            this.db.prepare('DELETE FROM student_rollcalls WHERE student_id = ?').run(sid);
          } catch {}
          delSubByStudent.run(sid);
        }
      }
    });

    tx();
  }

  // ── 2. 学生管理与 12 表安全级联删除 ──────────────────────────────────────────

  /**
   * 学生列表。`scope.mode = 'owner'` 时只返回教师本人班级的在册学生；
   * 管理员使用 `'all'`。默认 `'all'` 仅为兼容既有内部调用。
   */
  public listStudents(
    pg: Pagination,
    scope: { mode: 'all' | 'owner'; userId?: string; username?: string } = { mode: 'all' },
  ): { data: StudentItem[]; total: number; page: number; pageSize: number } {
    const ownerScoped = scope.mode === 'owner';
    const where = ownerScoped
      ? `WHERE s.id IN (
           SELECT cs.student_id
           FROM class_students cs
           JOIN classes c ON c.id = cs.class_id
           WHERE c.owner_user_id = ? OR c.owner_user_id = ?
         )`
      : '';
    const params: string[] = ownerScoped ? [scope.userId || '', scope.username || ''] : [];

    const total = (this.reader.prepare(`SELECT COUNT(*) AS n FROM students s ${where}`).get(...params) as any).n;
    const students = this.reader
      .prepare(
        `SELECT s.id, s.student_number, s.name, s.email, s.avatar, s.locked_lesson_id, s.lock_mode, s.lock_target, s.private_notes, s.created_at
         FROM students s ${where}
         ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...params,
        pg.isAll ? -1 : ((pg as any).pageSize ?? (pg as any).limit ?? 20),
        pg.offset ?? 0,
      ) as StudentItem[];

    const pageSize = pg.isAll ? total : ((pg as any).pageSize ?? (pg as any).limit ?? 20);
    return { data: students, total, page: pg.page ?? 1, pageSize };
  }

  /**
   * 取「学生自己」这一条记录（自查范围）。
   *
   * ## 为什么需要
   *
   * 学生端要在本地执行「答题锁定 / 锁定课节」，判定依据是**自己这一行**的
   * `locked_lesson_id` / `lock_mode` / `lock_target`（见
   * `src/hooks/useStudentViewState.ts`）。此前学生只能通过
   * `GET /api/students` 取花名册，而该端点限定教师/管理员 → 学生恒定拿到 403，
   * 于是自己那一行永远取不到，**教师锁了学生、学生端却不受约束**。
   *
   * 因此这里提供一条**只返回自己**的路径：字段子集不含邮箱与教师私有备注。
   */
  public getStudentSelf(studentId: string): StudentSelfItem | null {
    if (!studentId) return null;
    const row = this.reader
      .prepare(
        `SELECT s.id, s.student_number, s.name, s.avatar, s.locked_lesson_id, s.lock_mode, s.lock_target, s.created_at
         FROM students s
         WHERE s.id = ? OR s.student_number = ?
         LIMIT 1`,
      )
      .get(studentId, studentId) as StudentSelfItem | undefined;
    return row ?? null;
  }

  public createStudent(params: { name: string; email?: string; student_number?: string; password?: string }): {
    id: string;
    student_number: string;
    initial_password?: string;
  } {
    const { name, email, student_number, password } = params;
    if (!name?.trim()) throw new Error('Student name is required');

    const studentId = randomId();
    let finalNum = student_number && student_number.trim() !== '' ? student_number.trim() : '';
    if (!finalNum) {
      finalNum = generateStudentNumber(this.db) || `ST_${studentId}`;
    }

    const teacherPwd = typeof password === 'string' ? password.trim() : '';
    let initialPassword: string | null = null;
    let finalPlain: string;
    if (teacherPwd && teacherPwd !== '123456') {
      finalPlain = teacherPwd;
    } else {
      initialPassword = this.generateInitialPassword();
      finalPlain = initialPassword;
    }
    const hashedPassword = bcryptHashPassword(finalPlain);

    this.db
      .prepare('INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(studentId, finalNum, name.trim(), email || '', hashedPassword, Date.now());

    return {
      id: studentId,
      student_number: finalNum,
      ...(initialPassword ? { initial_password: initialPassword } : {}),
    };
  }

  public updateStudent(
    id: string,
    params: {
      name?: string;
      email?: string;
      student_number?: string;
      password?: string;
      locked_lesson_id?: string | null;
      lock_mode?: 'full' | 'navigation' | null;
      lock_target?: string | object | null;
      private_notes?: string | null;
    },
  ): void {
    const { name, email, student_number, password, locked_lesson_id, lock_mode, lock_target, private_notes } = params;
    if (name) this.db.prepare('UPDATE students SET name = ? WHERE id = ?').run(name.trim(), id);
    if (email !== undefined)
      this.db.prepare('UPDATE students SET email = ? WHERE id = ?').run(email?.trim() || null, id);
    if (password !== undefined) {
      const hashed = password.trim() !== '' ? bcryptHashPassword(password) : password;
      this.db.prepare('UPDATE students SET password = ? WHERE id = ?').run(hashed, id);
    }
    if (locked_lesson_id !== undefined) {
      this.db.prepare('UPDATE students SET locked_lesson_id = ? WHERE id = ?').run(locked_lesson_id, id);
      if (locked_lesson_id === null) {
        this.db.prepare("UPDATE students SET lock_mode = 'full', lock_target = NULL WHERE id = ?").run(id);
      }
    }
    if (lock_mode !== undefined && locked_lesson_id !== null) {
      const validMode = lock_mode === 'navigation' ? 'navigation' : 'full';
      this.db.prepare('UPDATE students SET lock_mode = ? WHERE id = ?').run(validMode, id);
    }
    if (lock_target !== undefined && locked_lesson_id !== null) {
      const targetStr =
        lock_target ? (typeof lock_target === 'string' ? lock_target : JSON.stringify(lock_target)) : null;
      this.db.prepare('UPDATE students SET lock_target = ? WHERE id = ?').run(targetStr, id);
    }
    if (private_notes !== undefined)
      this.db.prepare('UPDATE students SET private_notes = ? WHERE id = ?').run(sanitizePrivateNotes(private_notes), id);
    if (student_number !== undefined)
      this.db.prepare('UPDATE students SET student_number = ? WHERE id = ?').run(student_number, id);
  }

  /**
   * 学生安全级联删除（DATA-INT-01 / GDPR）：内置 13 张关联子表 + 调度插件删除钩子 + students 本体。
   * 采用同步清理本地 SQLite 事务保障同进程即时一致性，随后异步调度活跃插件的 onStudentDelete。
   */
  public async deleteStudentCascade(
    studentId: string,
  ): Promise<{ pluginsCleaned: Record<string, { success: boolean; error?: string }> }> {
    // 1. 同步单事务彻底清理内置关联子表与 student 本体（含 student_point_logs）
    this.deleteStudentCascadeSync(studentId);

    // 2. 调度活跃插件的 onStudentDelete 钩子
    let pluginsCleaned: Record<string, { success: boolean; error?: string }> = {};
    if (this.pluginHost && typeof this.pluginHost.deleteStudentDataFromPlugins === 'function') {
      try {
        pluginsCleaned = await this.pluginHost.deleteStudentDataFromPlugins(studentId);
      } catch (err) {
        console.warn(`[RosterService] Error deleting student data from plugins for student ${studentId}:`, err);
      }
    }

    // 3. 记录安全审计
    recordSecurityAudit('student.gdpr_deleted', {
      studentId,
      pluginsCleaned,
    });

    return { pluginsCleaned };
  }

  /**
   * 内置表单事务同步级联删除（供内部及测试纯同步场景使用）。
   */
  public deleteStudentCascadeSync(studentId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM class_students WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM attendance WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM exam_scores WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM student_semester_reports WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM student_rollcalls WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM plugin_submissions WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM plugin_peer_reviews WHERE reviewer_id = ?').run(studentId);
      this.db.prepare('DELETE FROM student_seats WHERE student_id = ?').run(studentId);
      this.db.prepare('DELETE FROM student_read_notifications WHERE student_id = ?').run(studentId);
      try {
        this.db.prepare('DELETE FROM student_point_logs WHERE student_id = ?').run(studentId);
      } catch {
        // 表可能未建
      }
      this.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    });
    tx();
  }

  public async exportStudentData(studentId: string): Promise<any> {
    const student = this.reader
      .prepare('SELECT id, student_number, name, email, avatar, created_at FROM students WHERE id = ?')
      .get(studentId) as any;
    if (!student) throw new Error('Student not found');

    const classEnrollments = this.reader
      .prepare(
        `SELECT c.name as class_name FROM classes c JOIN class_students cs ON c.id = cs.class_id WHERE cs.student_id = ?`,
      )
      .all(studentId);
    const progress = this.reader.prepare('SELECT * FROM student_lesson_progress WHERE student_id = ?').all(studentId);
    const submissions = this.reader.prepare('SELECT * FROM assignment_submissions WHERE student_id = ?').all(studentId);
    const attendance = this.reader.prepare('SELECT * FROM attendance WHERE student_id = ?').all(studentId);
    const examScores = this.reader.prepare('SELECT * FROM exam_scores WHERE student_id = ?').all(studentId);
    const semesterReports = this.reader
      .prepare('SELECT * FROM student_semester_reports WHERE student_id = ?')
      .all(studentId);
    const rollcalls = this.reader.prepare('SELECT * FROM student_rollcalls WHERE student_id = ?').all(studentId);
    const pluginSubmissions = this.reader.prepare('SELECT * FROM plugin_submissions WHERE student_id = ?').all(studentId);
    const peerReviews = this.reader.prepare('SELECT * FROM plugin_peer_reviews WHERE reviewer_id = ?').all(studentId);

    let pointLogs: any[] = [];
    try {
      pointLogs = this.reader.prepare('SELECT * FROM student_point_logs WHERE student_id = ?').all(studentId);
    } catch {
      // 表可能未建
    }

    let pluginData: Record<string, unknown> = {};
    if (this.pluginHost && typeof this.pluginHost.exportStudentDataFromPlugins === 'function') {
      try {
        pluginData = await this.pluginHost.exportStudentDataFromPlugins(studentId);
      } catch (err) {
        console.warn(`[RosterService] Error exporting student data from plugins for student ${studentId}:`, err);
      }
    }

    return {
      student: { ...student, password: '[REDACTED]' },
      classes: classEnrollments,
      progress,
      assignmentSubmissions: submissions,
      attendance,
      examScores,
      semesterReports,
      rollcalls,
      pointLogs,
      pluginSubmissions,
      peerReviews,
      pluginData,
      exportedAt: new Date().toISOString(),
    };
  }

  // ── 3. 选课与花名册管理 ──────────────────────────────────────────────────────

  public getClassStudents(classId: string): StudentItem[] {
    return this.reader
      .prepare(
        `
      SELECT s.id, s.student_number, s.name, s.email, s.avatar, s.locked_lesson_id, s.lock_mode, s.lock_target, s.private_notes, s.created_at, cs.joined_at
      FROM students s
      INNER JOIN class_students cs ON s.id = cs.student_id
      WHERE cs.class_id = ?
      ORDER BY cs.joined_at DESC
    `,
      )
      .all(classId) as StudentItem[];
  }

  public enrollStudent(classId: string, studentId: string): void {
    if (!this.db.prepare('SELECT id FROM classes WHERE id = ?').get(classId)) {
      throw new Error('Class not found');
    }
    if (!this.db.prepare('SELECT id FROM students WHERE id = ?').get(studentId)) {
      throw new Error('Student not found');
    }
    this.db
      .prepare('INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)')
      .run(classId, studentId, Date.now());
  }

  /**
   * 批量导入学生的**唯一实现**。
   *
   * 此前「新建班级并导入学生」(`/api/classes/import`)、「独立学生导入」
   * (`/api/students/import`)、「向已有班级批量加入学生」
   * (`/api/classes/:id/students/bulk-enroll`) 三条路径各自实现了入库逻辑，
   * 行为互相矛盾，且都存在同一批缺陷：
   *
   * 1. **只按 email 去重** —— 没填邮箱的学生每导入一次就多一条重复记录；
   * 2. **不写 password** —— 落库为 NULL，学生用「学号 + 密码」登录时
   *    `roster.ts` 的密码校验恒不通过，只能退到班级 passcode 分支；
   * 3. **`/api/classes/import` 完全忽略传入的学号**，无条件重新生成，
   *    导致同一个人走班级模板与走学生模板会得到不同学号。
   *
   * 现在三者统一走这里：去重键为 email → student_number，
   * 密码缺失时自动生成并把明文回传给教师（供分发）。
   *
   * 密码语义与 `createStudent` 有一处**刻意差异**：CSV 中显式填写的密码
   * （哪怕是 `123456`）一律照用，不触发自动生成 —— CSV 没有表单默认值，
   * 显式填写就是教师的明确选择。
   *
   * @param classId 同时加入该班级（省略则只建学生、不入班）
   */
  public importStudents(
    students: RosterImportInput[],
    options: { classId?: string } = {},
  ): { results: RosterImportResult[]; created: number; existing: number } {
    if (!Array.isArray(students)) throw new Error('Invalid payload: students must be an array');
    const { classId } = options;

    if (classId && !this.db.prepare('SELECT id FROM classes WHERE id = ?').get(classId)) {
      throw new Error('Class not found');
    }

    // ── 事务外预计算：清洗 + bcrypt 哈希 ──────────────────────────────────
    // bcrypt(cost=10) 单次约 60~100ms。一个 50 人的班放进写事务里会把
    // SQLite 写锁按住 3~5 秒，因此哈希全部在事务开始前算好。
    const prepared: {
      name: string;
      email: string;
      studentNumber: string;
      notes: string;
      /** 明文初始密码，仅当 autoPassword 为 true 时才回传给教师 */
      plainPassword: string;
      autoPassword: boolean;
      hashedPassword: string;
    }[] = [];

    for (const st of students) {
      const name = st?.name ? st.name.trim() : '';
      if (!name) continue;

      const email = st?.email ? st.email.trim() : '';
      const studentNumber = st?.student_number ? st.student_number.trim() : '';
      const notes = sanitizePrivateNotes(st?.private_notes ? st.private_notes.trim() : '') || '';
      const provided = typeof st?.password === 'string' ? st.password.trim() : '';
      const autoPassword = provided === '';
      // 只能生成一次：明文与哈希必须来自同一个密码，否则回传给教师的明文无法登录。
      const plainPassword = provided || this.generateInitialPassword();

      prepared.push({
        name,
        email,
        studentNumber,
        notes,
        plainPassword,
        autoPassword,
        hashedPassword: bcryptHashPassword(plainPassword),
      });
    }

    const insertStudent = this.db.prepare(
      'INSERT INTO students (id, student_number, name, email, password, private_notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const findByEmail = this.db.prepare('SELECT id, student_number, name, email FROM students WHERE email = ?');
    const findByNumber = this.db.prepare(
      'SELECT id, student_number, name, email FROM students WHERE student_number = ?',
    );
    const insertClassStudent = this.db.prepare(
      'INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );

    const results: RosterImportResult[] = [];

    const tx = this.db.transaction(() => {
      const now = Date.now();
      for (const row of prepared) {
        // 去重：先 email 后学号。两者都没有的新生才会被创建。
        const existing =
          (row.email ? (findByEmail.get(row.email) as ExistingStudentRow | undefined) : undefined) ??
          (row.studentNumber ? (findByNumber.get(row.studentNumber) as ExistingStudentRow | undefined) : undefined);

        if (existing) {
          // 命中已有学生：不覆盖任何字段（含密码），只补班级关系。
          // 回传**库里的真实值**而非 CSV 原值，否则教师拿到的学号可能与实际登录用的不一致。
          results.push({
            id: existing.id,
            name: existing.name,
            email: existing.email || '',
            student_number: existing.student_number || '',
            created: false,
          });
          if (classId) insertClassStudent.run(classId, existing.id, now);
          continue;
        }

        const studentId = randomId('stu_');
        const finalNum = row.studentNumber || generateStudentNumber(this.db) || `ST_${studentId}`;

        insertStudent.run(studentId, finalNum, row.name, row.email || null, row.hashedPassword, row.notes || null, now);

        results.push({
          id: studentId,
          name: row.name,
          email: row.email,
          student_number: finalNum,
          created: true,
          ...(row.autoPassword ? { initial_password: row.plainPassword } : {}),
        });

        if (classId) insertClassStudent.run(classId, studentId, now);
      }
    });

    tx();

    return {
      results,
      created: results.filter((r) => r.created).length,
      existing: results.filter((r) => !r.created).length,
    };
  }

  /**
   * 向已有班级批量加入学生 —— 复用 `importStudents` 的去重 / 学号 / 密码逻辑，
   * 只把结果映射成前端期望的 `BulkEnrollResultItem` 形状。
   */
  public bulkEnrollStudents(
    classId: string,
    students: BulkEnrollInput[],
  ): { count: number; results: BulkEnrollResultItem[] } {
    const { results } = this.importStudents(students, { classId });

    const mapped: BulkEnrollResultItem[] = results.map((r) => ({
      id: r.id,
      name: r.name,
      student_number: r.student_number,
      email: r.email,
      status: r.created ? 'created_and_enrolled' : 'enrolled_existing',
      ...(r.initial_password ? { initial_password: r.initial_password } : {}),
    }));

    return { count: mapped.length, results: mapped };
  }

  public unenrollStudent(classId: string, studentId: string): void {
    this.db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?').run(classId, studentId);
  }

  // ── 4. 机房与座位排布 ────────────────────────────────────────────────────────

  public listLabs(): any[] {
    return this.reader.prepare('SELECT * FROM computer_labs ORDER BY created_at DESC').all();
  }

  public createLab(data: { room_number: string; rows: number; cols: number }): {
    id: string;
    room_number: string;
    rows: number;
    cols: number;
  } {
    const { room_number, rows, cols } = data;
    if (!room_number?.trim()) throw new Error('room_number is required');
    const labId = randomId('lab_');
    const parsedRows = parseInt(String(rows), 10) || 6;
    const parsedCols = parseInt(String(cols), 10) || 8;

    this.db
      .prepare('INSERT INTO computer_labs (id, room_number, rows, cols, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(labId, room_number.trim(), parsedRows, parsedCols, Date.now());

    return { id: labId, room_number: room_number.trim(), rows: parsedRows, cols: parsedCols };
  }

  public updateLab(id: string, data: { room_number: string; rows: number; cols: number }): void {
    const { room_number, rows, cols } = data;
    if (!room_number?.trim()) throw new Error('room_number is required');
    const parsedRows = parseInt(String(rows), 10) || 6;
    const parsedCols = parseInt(String(cols), 10) || 8;

    this.db
      .prepare('UPDATE computer_labs SET room_number = ?, rows = ?, cols = ? WHERE id = ?')
      .run(room_number.trim(), parsedRows, parsedCols, id);
  }

  public deleteLab(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE classes SET lab_id = NULL WHERE lab_id = ?').run(id);
      this.db.prepare('DELETE FROM student_seats WHERE lab_id = ?').run(id);
      this.db.prepare('DELETE FROM computer_labs WHERE id = ?').run(id);
    });
    tx();
  }

  public getClassSeats(classId: string): { lab_id: string | null; seats: any[] } {
    const classInfo = this.reader.prepare('SELECT lab_id FROM classes WHERE id = ?').get(classId) as any;
    const labId = classInfo ? classInfo.lab_id : null;

    const seats = this.reader
      .prepare(
        `SELECT ss.class_id, ss.student_id, ss.lab_id, ss.row_idx, ss.col_idx,
                s.name AS student_name, s.student_number
         FROM student_seats ss
         LEFT JOIN students s ON ss.student_id = s.id
         WHERE ss.class_id = ?`,
      )
      .all(classId);

    return { lab_id: labId, seats };
  }

  public saveClassSeats(
    classId: string,
    labId: string | null,
    seats: Array<{ student_id: string; row_idx: number; col_idx: number }>,
  ): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE classes SET lab_id = ? WHERE id = ?').run(labId || null, classId);
      this.db.prepare('DELETE FROM student_seats WHERE class_id = ?').run(classId);

      if (labId && Array.isArray(seats)) {
        const insertStmt = this.db.prepare(
          'INSERT INTO student_seats (class_id, student_id, lab_id, row_idx, col_idx) VALUES (?, ?, ?, ?, ?)',
        );
        for (const s of seats) {
          insertStmt.run(classId, s.student_id, labId, s.row_idx, s.col_idx);
        }
      }
    });
    tx();
  }

  // ── 5. 分组管理与智能自动分组 ────────────────────────────────────────────────

  public listClassGroups(classId: string, scope?: string): ClassGroupItem[] {
    let rows = this.reader
      .prepare('SELECT g.* FROM class_groups g WHERE g.class_id = ? ORDER BY g.sort_order ASC, g.created_at ASC')
      .all(classId) as any[];

    if (scope === 'default') {
      rows = rows.filter((r: any) => r.is_default);
    }
    return rows.map((r) => this.parseGroupRow(r)!).filter(Boolean);
  }

  public createGroup(
    classId: string,
    data: {
      name: string;
      name_en?: string;
      color?: string;
      memberIds?: string[];
      leaderId?: string;
      isDefault?: boolean;
      sortOrder?: number;
    },
  ): ClassGroupItem {
    const { name, name_en: nameEn, color, memberIds, leaderId, isDefault, sortOrder } = data;
    if (!classId || !name?.trim()) throw new Error('name is required');
    if (!this.db.prepare('SELECT id FROM classes WHERE id = ?').get(classId)) {
      throw new Error(`Class "${classId}" not found`);
    }

    const ids = Array.isArray(memberIds) ? memberIds.filter((v: any) => typeof v === 'string' && v.trim()) : [];
    const rosterRows = this.db
      .prepare('SELECT s.id FROM students s INNER JOIN class_students cs ON s.id = cs.student_id WHERE cs.class_id = ?')
      .all(classId) as { id: string }[];
    const rosterIdSet = new Set<string>(rosterRows.map((r) => r.id));
    const unknown = ids.filter((id) => !rosterIdSet.has(id));
    if (unknown.length > 0) {
      throw new Error(`以下学生不属于该班级：${unknown.join(', ')}`);
    }
    if (leaderId && !ids.includes(leaderId)) {
      throw new Error('组长必须是本组有效成员');
    }

    const groupId = `grp_${crypto.randomUUID()}`;
    const now = Date.now();

    if (isDefault) {
      this.db.prepare('UPDATE class_groups SET is_default = 0, updated_at = ? WHERE class_id = ?').run(now, classId);
    }

    this.db
      .prepare(
        `
      INSERT INTO class_groups (id, class_id, name, name_en, color, member_ids, leader_id, is_default, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        groupId,
        classId,
        name.trim(),
        nameEn?.trim() || null,
        color?.trim() || 'bg-indigo-500',
        JSON.stringify(ids),
        ids.includes(leaderId!) ? leaderId : null,
        isDefault ? 1 : 0,
        Number.isFinite(sortOrder) ? Number(sortOrder) : 100,
        now,
        now,
      );

    const row = this.db.prepare('SELECT * FROM class_groups WHERE id = ?').get(groupId);
    return this.parseGroupRow(row)!;
  }

  public updateGroup(
    classId: string,
    groupId: string,
    data: {
      name?: string;
      name_en?: string | null;
      color?: string;
      memberIds?: string[];
      leaderId?: string | null;
      isDefault?: boolean;
      sortOrder?: number;
    },
  ): ClassGroupItem {
    const row = this.db
      .prepare('SELECT * FROM class_groups WHERE id = ? AND class_id = ?')
      .get(groupId, classId) as any;
    if (!row) throw new Error('Group not found');

    const { name, name_en: nameEn, color, memberIds, leaderId, isDefault, sortOrder } = data || {};
    const sets: string[] = [];
    const args: unknown[] = [];

    if (typeof name === 'string' && name.trim()) {
      sets.push('name = ?');
      args.push(name.trim());
    }
    if (nameEn !== undefined) {
      sets.push('name_en = ?');
      args.push(typeof nameEn === 'string' && nameEn.trim() ? nameEn.trim() : null);
    }
    if (color !== undefined) {
      sets.push('color = ?');
      args.push(typeof color === 'string' && color.trim() ? color.trim() : 'bg-indigo-500');
    }
    if (Number.isFinite(sortOrder)) {
      sets.push('sort_order = ?');
      args.push(Number(sortOrder));
    }

    let finalIds = this.parseGroupRow(row)!.memberIds;
    if (memberIds !== undefined) {
      if (Array.isArray(memberIds)) {
        finalIds = memberIds.filter((v: any) => typeof v === 'string' && v.trim());
      } else {
        throw new Error('memberIds must be an array');
      }
    }

    const rosterIdSet = new Set(
      (
        this.db
          .prepare(
            'SELECT s.id FROM students s INNER JOIN class_students cs ON s.id = cs.student_id WHERE cs.class_id = ?',
          )
          .all(classId) as { id: string }[]
      ).map((r) => r.id),
    );
    const unknown = finalIds.filter((id) => !rosterIdSet.has(id));
    if (unknown.length > 0) {
      throw new Error(`以下学生不属于该班级：${unknown.join(', ')}`);
    }

    let nextLeader = this.parseGroupRow(row)!.memberIds.includes(leaderId!) ? leaderId : row.leader_id;
    if (leaderId !== undefined) {
      if (!finalIds.includes(leaderId!)) {
        throw new Error('组长必须是本组有效成员');
      }
      nextLeader = leaderId;
    }

    if (finalIds.length > 0 && nextLeader && !finalIds.includes(nextLeader)) {
      throw new Error('组长必须是本组有效成员');
    }

    if (memberIds !== undefined) {
      sets.push('member_ids = ?');
      args.push(JSON.stringify(finalIds));
    }
    if (leaderId !== undefined) {
      sets.push('leader_id = ?');
      args.push(nextLeader);
    }

    if (isDefault === true) this.clearDefaultMarker(classId);
    if (isDefault !== undefined) {
      sets.push('is_default = ?');
      args.push(isDefault ? 1 : 0);
    }

    if (sets.length === 0) {
      throw new Error('没有可更新的字段');
    }

    sets.push('updated_at = ?');
    const now = Date.now();
    args.push(now);

    const stmt = 'UPDATE class_groups SET ' + sets.join(', ') + ' WHERE id = ?';
    args.push(groupId);
    this.db.prepare(stmt).run(...args);

    const updated = this.db.prepare('SELECT * FROM class_groups WHERE id = ?').get(groupId) as any;
    const group = this.parseGroupRow(updated)!;
    if (group.leader_id && !group.memberIds.includes(group.leader_id)) {
      this.db.prepare('UPDATE class_groups SET leader_id = NULL, updated_at = ? WHERE id = ?').run(Date.now(), groupId);
      group.leader_id = null;
    }

    return group;
  }

  /**
   * 按 `class_id` 归属作用域删除。缺了 `AND class_id = ?` 的话
   * `DELETE /api/classes/{A班}/groups/{B班的小组id}` 会成功删掉 B 班的小组，
   * URL 里的班级 ID 沦为装饰（契约从 404 变 200）。与 `updateGroup` / `listClassGroups` 同口径。
   */
  public deleteGroup(classId: string, groupId: string): void {
    const res = this.db.prepare('DELETE FROM class_groups WHERE id = ? AND class_id = ?').run(groupId, classId);
    if (res.changes === 0) throw new Error('Group not found');
  }

  public autoGroup(classId: string, groupCount: number): ClassGroupItem[] {
    const count = Math.max(1, Math.min(12, groupCount || 4));
    if (!this.db.prepare('SELECT id FROM classes WHERE id = ?').get(classId)) {
      throw new Error(`Class "${classId}" not found`);
    }

    const roster = this.db
      .prepare(
        `
      SELECT s.id FROM students s
      INNER JOIN class_students cs ON s.id = cs.student_id
      WHERE cs.class_id = ?
      ORDER BY s.student_number, s.name
    `,
      )
      .all(classId) as { id: string }[];

    const shuffled = [...roster.map((r) => r.id)].sort(() => Math.random() - 0.5);
    const perGroup = Math.ceil(shuffled.length / count);
    const now = Date.now();

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM class_groups WHERE class_id = ?').run(classId);
      const created: ClassGroupItem[] = [];
      const colors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-violet-500'];

      for (let i = 0; i < count; i++) {
        const chunk = shuffled.slice(i * perGroup, (i + 1) * perGroup);
        if (chunk.length === 0) continue;
        const groupId = `grp_${crypto.randomUUID()}`;
        this.db
          .prepare(
            `
          INSERT INTO class_groups (id, class_id, name, color, member_ids, leader_id, is_default, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `,
          )
          .run(
            groupId,
            classId,
            `第 ${i + 1} 小组`,
            colors[i % colors.length],
            JSON.stringify(chunk),
            chunk[0] || null, // 默认组长为第一人
            i + 1,
            now,
            now,
          );
        created.push(this.parseGroupRow(this.db.prepare('SELECT * FROM class_groups WHERE id = ?').get(groupId))!);
      }
      return created;
    });

    return tx();
  }

  // ── 6. 选人与点名候选池 ────────────────────────────────────────────────────

  public getPickerCandidates(
    classId: string,
    lessonId?: string,
    options?: { restrictToPresentIds?: readonly string[] },
  ): any[] {
    const students = this.reader
      .prepare(
        `
      SELECT 
        s.id,
        s.name,
        s.email,
        s.student_number,
        COALESCE(term_rc.count, 0) as term_picked_count,
        COALESCE(term_rc.coins, 0) as total_reward_coins,
        term_rc.last_picked_time,
        COALESCE(lesson_rc.count, 0) as lesson_picked_count,
        COALESCE(sub.avg_score, 80) as avg_assignment_score
      FROM class_students cs
      JOIN students s ON cs.student_id = s.id
      LEFT JOIN (
        SELECT 
          student_id, 
          COUNT(*) as count, 
          SUM(COALESCE(reward_coins, 0)) as coins,
          MAX(picked_time) as last_picked_time
        FROM student_rollcalls
        WHERE class_id = ?
        GROUP BY student_id
      ) term_rc ON s.id = term_rc.student_id
      LEFT JOIN (
        SELECT 
          student_id, 
          COUNT(*) as count
        FROM student_rollcalls
        WHERE class_id = ? AND lesson_id = ?
        GROUP BY student_id
      ) lesson_rc ON s.id = lesson_rc.student_id
      LEFT JOIN (
        SELECT 
          student_id, 
          AVG(score) as avg_score
        FROM assignment_submissions
        WHERE score IS NOT NULL
        GROUP BY student_id
      ) sub ON s.id = sub.student_id
      WHERE cs.class_id = ?
      ORDER BY s.student_number ASC, s.name ASC
    `,
      )
      .all(classId, classId, lessonId || '', classId) as any[];

    const mapped = students.map((s) => {
      let tier: 'basic' | 'intermediate' | 'advanced' = 'intermediate';
      if (s.avg_assignment_score < 70 || s.term_picked_count === 0) {
        tier = 'basic';
      } else if (s.avg_assignment_score >= 88 && s.term_picked_count >= 1) {
        tier = 'advanced';
      }
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        student_number: s.student_number,
        term_picked_count: s.term_picked_count,
        lesson_picked_count: s.lesson_picked_count,
        last_picked_time: s.last_picked_time,
        total_reward_coins: s.total_reward_coins,
        tier,
      };
    });

    // 未传 restrictToPresentIds 时保持全班名单（没有课节就无法判断本节会话）。
    // 传入数组（含空数组）时只保留当前在场的学生，频次权重仍来自上面的点名统计。
    if (!options || !Array.isArray(options.restrictToPresentIds)) return mapped;
    const present = new Set(options.restrictToPresentIds);
    return mapped.filter((s) => present.has(s.id));
  }

  public evaluateRollcall(params: {
    id?: string;
    studentId: string;
    studentName?: string;
    classId?: string | null;
    lessonId?: string | null;
    rating?: string | number;
    score?: number;
    rewardCoins?: number;
    difficulty?: string;
  }): {
    rollcallId: string;
    studentId: string;
    studentName?: string;
    classId?: string | null;
    lessonId?: string | null;
    rating?: string | number;
    score: number;
    rewardCoins: number;
    difficulty: string;
    timestamp: number;
  } {
    const {
      id,
      studentId,
      studentName,
      classId = null,
      lessonId = null,
      rating,
      score = 0,
      rewardCoins = 0,
      difficulty = 'intermediate',
    } = params;

    if (!studentId) {
      throw new Error('studentId is required');
    }

    const rollcallId = id || `rollcall-${studentId}-${Date.now()}`;
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time, rating, score, reward_coins, difficulty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        rating = excluded.rating,
        score = excluded.score,
        reward_coins = excluded.reward_coins,
        difficulty = excluded.difficulty
    `,
      )
      .run(
        rollcallId,
        studentId,
        classId || null,
        lessonId || null,
        now,
        rating ?? null,
        score,
        rewardCoins,
        difficulty,
      );

    return {
      rollcallId,
      studentId,
      studentName,
      classId,
      lessonId,
      rating,
      score,
      rewardCoins,
      difficulty,
      timestamp: now,
    };
  }
}
