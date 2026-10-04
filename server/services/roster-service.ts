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
import type { Pagination } from '../utils/pagination.js';

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
  private_notes?: string | null;
  created_at: number;
  joined_at?: number;
}

export interface BulkEnrollInput {
  name: string;
  email?: string;
  student_number?: string;
}

export interface BulkEnrollResultItem {
  id: string;
  name: string;
  student_number?: string;
  email?: string;
  status: 'created_and_enrolled' | 'enrolled_existing';
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
  constructor(private readonly db: Database.Database = kernelContainer.db) {}

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

  public listClasses(pg: Pagination): { data: ClassItem[]; total: number; page: number; pageSize: number } {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM classes').get() as any).n;
    const classes = this.db
      .prepare(
        `
        SELECT c.*,
          (SELECT COUNT(*) FROM class_students WHERE class_id = c.id) AS student_count,
          (SELECT COUNT(*) FROM schedules WHERE class_id = c.id) AS course_count,
          (SELECT COUNT(*) FROM assignments WHERE class_id = c.id) AS assignment_count
        FROM classes c
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(
        pg.isAll ? -1 : ((pg as any).pageSize ?? (pg as any).limit ?? 20),
        pg.offset ?? 0,
      ) as ClassItem[];

    const pageSize = pg.isAll ? total : ((pg as any).pageSize ?? (pg as any).limit ?? 20);
    return { data: classes, total, page: pg.page ?? 1, pageSize };
  }

  public createClass(name: string, description?: string, labId?: string): string {
    if (!name?.trim()) throw new Error('Class name is required');
    const classId = randomId('cls_');
    this.db
      .prepare('INSERT INTO classes (id, name, description, lab_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(classId, name.trim(), description || '', labId || null, Date.now());
    return classId;
  }

  public updateClass(id: string, name: string, description?: string, labId?: string): void {
    if (!name?.trim()) throw new Error('Class name is required');
    const res = this.db
      .prepare('UPDATE classes SET name = ?, description = ?, lab_id = ? WHERE id = ?')
      .run(name.trim(), description || '', labId || null, id);
    if (res.changes === 0) throw new Error('Class not found');
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

    const countRow = this.db
      .prepare('SELECT COUNT(*) as count FROM class_students WHERE class_id = ?')
      .get(id) as any;

    const now = Date.now();
    let passcode = cls.class_passcode;
    let expiresAt = cls.class_passcode_expires_at ?? null;

    if (!passcode || !expiresAt || now > expiresAt) {
      passcode = Math.floor(100000 + Math.random() * 900000).toString();
      expiresAt = now + 4 * 60 * 60 * 1000; // 4 hours
      this.db
        .prepare('UPDATE classes SET class_passcode = ?, class_passcode_expires_at = ? WHERE id = ?')
        .run(passcode, expiresAt, id);
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
      // 1. 获取班级中所有学生
      const students = this.db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId) as {
        student_id: string;
      }[];

      // 2. 删除每个学生的数据
      const deleteStudentStmt = this.db.prepare('DELETE FROM students WHERE id = ?');
      const deleteClassStudentByStudentStmt = this.db.prepare('DELETE FROM class_students WHERE student_id = ?');
      const deleteProgressStmt = this.db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?');
      const deleteSubmissionsByStudentStmt = this.db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?');
      const deleteAttendanceByStudentStmt = this.db.prepare('DELETE FROM attendance WHERE student_id = ?');
      const deleteSeatsByStudentStmt = this.db.prepare('DELETE FROM student_seats WHERE student_id = ?');
      const deleteReadNotificationsStmt = this.db.prepare('DELETE FROM student_read_notifications WHERE student_id = ?');
      const deleteRollcallsByStudentStmt = this.db.prepare('DELETE FROM student_rollcalls WHERE student_id = ?');

      for (const s of students) {
        deleteStudentStmt.run(s.student_id);
        deleteClassStudentByStudentStmt.run(s.student_id);
        deleteProgressStmt.run(s.student_id);
        deleteSubmissionsByStudentStmt.run(s.student_id);
        deleteAttendanceByStudentStmt.run(s.student_id);
        deleteSeatsByStudentStmt.run(s.student_id);
        deleteReadNotificationsStmt.run(s.student_id);
        try {
          deleteRollcallsByStudentStmt.run(s.student_id);
        } catch {}
      }

      // 3. 删除班级关联数据
      this.db.prepare(
        'DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)',
      ).run(classId);
      this.db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);
      this.db.prepare('DELETE FROM attendance WHERE schedule_id IN (SELECT id FROM schedules WHERE class_id = ?)').run(
        classId,
      );
      this.db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
      this.db.prepare('DELETE FROM student_seats WHERE class_id = ?').run(classId);
      try {
        this.db.prepare('DELETE FROM student_rollcalls WHERE class_id = ?').run(classId);
      } catch {}
      this.db.prepare('DELETE FROM class_groups WHERE class_id = ?').run(classId);
      this.db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
      this.db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    });

    tx();
  }

  // ── 2. 学生管理与 12 表安全级联删除 ──────────────────────────────────────────

  public listStudents(pg: Pagination): { data: StudentItem[]; total: number; page: number; pageSize: number } {
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM students').get() as any).n;
    const students = this.db
      .prepare(
        'SELECT id, student_number, name, email, avatar, locked_lesson_id, private_notes, created_at FROM students ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .all(
        pg.isAll ? -1 : ((pg as any).pageSize ?? (pg as any).limit ?? 20),
        pg.offset ?? 0,
      ) as StudentItem[];

    const pageSize = pg.isAll ? total : ((pg as any).pageSize ?? (pg as any).limit ?? 20);
    return { data: students, total, page: pg.page ?? 1, pageSize };
  }

  public createStudent(params: {
    name: string;
    email?: string;
    student_number?: string;
    password?: string;
  }): { id: string; student_number: string; initial_password?: string } {
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
      .prepare(
        'INSERT INTO students (id, student_number, name, email, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
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
      private_notes?: string | null;
    },
  ): void {
    const { name, email, student_number, password, locked_lesson_id, private_notes } = params;
    if (name) this.db.prepare('UPDATE students SET name = ? WHERE id = ?').run(name.trim(), id);
    if (email !== undefined)
      this.db.prepare('UPDATE students SET email = ? WHERE id = ?').run(email?.trim() || null, id);
    if (password !== undefined) {
      const hashed = password.trim() !== '' ? bcryptHashPassword(password) : password;
      this.db.prepare('UPDATE students SET password = ? WHERE id = ?').run(hashed, id);
    }
    if (locked_lesson_id !== undefined)
      this.db.prepare('UPDATE students SET locked_lesson_id = ? WHERE id = ?').run(locked_lesson_id, id);
    if (private_notes !== undefined)
      this.db.prepare('UPDATE students SET private_notes = ? WHERE id = ?').run(private_notes, id);
    if (student_number !== undefined)
      this.db.prepare('UPDATE students SET student_number = ? WHERE id = ?').run(student_number, id);
  }

  /**
   * 学生安全级联删除（DATA-INT-01）：12 张关联子表 + students 本体，单事务执行。
   */
  public deleteStudentCascade(studentId: string): void {
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
      this.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    });
    tx();
  }

  public exportStudentData(studentId: string): any {
    const student = this.db
      .prepare('SELECT id, student_number, name, email, avatar, created_at FROM students WHERE id = ?')
      .get(studentId) as any;
    if (!student) throw new Error('Student not found');

    const classEnrollments = this.db
      .prepare(
        `SELECT c.name as class_name FROM classes c JOIN class_students cs ON c.id = cs.class_id WHERE cs.student_id = ?`,
      )
      .all(studentId);
    const progress = this.db.prepare('SELECT * FROM student_lesson_progress WHERE student_id = ?').all(studentId);
    const submissions = this.db.prepare('SELECT * FROM assignment_submissions WHERE student_id = ?').all(studentId);
    const attendance = this.db.prepare('SELECT * FROM attendance WHERE student_id = ?').all(studentId);
    const examScores = this.db.prepare('SELECT * FROM exam_scores WHERE student_id = ?').all(studentId);
    const semesterReports = this.db
      .prepare('SELECT * FROM student_semester_reports WHERE student_id = ?')
      .all(studentId);
    const rollcalls = this.db.prepare('SELECT * FROM student_rollcalls WHERE student_id = ?').all(studentId);
    const pluginSubmissions = this.db
      .prepare('SELECT * FROM plugin_submissions WHERE student_id = ?')
      .all(studentId);
    const peerReviews = this.db
      .prepare('SELECT * FROM plugin_peer_reviews WHERE reviewer_id = ?')
      .all(studentId);

    return {
      student: { ...student, password: '[REDACTED]' },
      classes: classEnrollments,
      progress,
      assignmentSubmissions: submissions,
      attendance,
      examScores,
      semesterReports,
      rollcalls,
      pluginSubmissions,
      peerReviews,
      exportedAt: new Date().toISOString(),
    };
  }

  // ── 3. 选课与花名册管理 ──────────────────────────────────────────────────────

  public getClassStudents(classId: string): StudentItem[] {
    return this.db
      .prepare(
        `
      SELECT s.id, s.student_number, s.name, s.email, s.avatar, s.locked_lesson_id, s.private_notes, s.created_at, cs.joined_at
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

  public bulkEnrollStudents(classId: string, students: BulkEnrollInput[]): { count: number; results: BulkEnrollResultItem[] } {
    if (!Array.isArray(students)) throw new Error('Invalid payload: students must be an array');
    if (!this.db.prepare('SELECT id FROM classes WHERE id = ?').get(classId)) {
      throw new Error('Class not found');
    }

    const insertStudent = this.db.prepare(
      'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const findStudentByEmail = this.db.prepare('SELECT id FROM students WHERE email = ?');
    const insertClassStudent = this.db.prepare(
      'INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );

    const results: BulkEnrollResultItem[] = [];

    const tx = this.db.transaction(() => {
      const now = Date.now();
      for (const st of students) {
        const stName = st.name ? st.name.trim() : '';
        const stEmail = st.email ? st.email.trim() : '';
        const stNum = st.student_number ? st.student_number.trim() : '';
        if (!stName) continue;

        let studentId = '';
        if (stEmail) {
          const existing = findStudentByEmail.get(stEmail) as { id: string } | undefined;
          if (existing) studentId = existing.id;
        }

        let finalNum = stNum;
        if (!studentId) {
          studentId = randomId('stu_');
          if (!finalNum) finalNum = generateStudentNumber(this.db) || `ST_${studentId}`;
          insertStudent.run(studentId, finalNum, stName, stEmail || null, now);
          results.push({
            id: studentId,
            student_number: finalNum,
            name: stName,
            email: stEmail,
            status: 'created_and_enrolled',
          });
        } else {
          results.push({ id: studentId, name: stName, email: stEmail, status: 'enrolled_existing' });
        }

        insertClassStudent.run(classId, studentId, now);
      }
    });

    tx();
    return { count: results.length, results };
  }

  public unenrollStudent(classId: string, studentId: string): void {
    this.db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?').run(classId, studentId);
  }

  // ── 4. 机房与座位排布 ────────────────────────────────────────────────────────

  public listLabs(): any[] {
    return this.db.prepare('SELECT * FROM computer_labs ORDER BY created_at DESC').all();
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
    const classInfo = this.db.prepare('SELECT lab_id FROM classes WHERE id = ?').get(classId) as any;
    const labId = classInfo ? classInfo.lab_id : null;

    const seats = this.db
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
    let rows = this.db
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
    const row = this.db.prepare('SELECT * FROM class_groups WHERE id = ? AND class_id = ?').get(groupId, classId) as any;
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
      this.db
        .prepare('UPDATE class_groups SET leader_id = NULL, updated_at = ? WHERE id = ?')
        .run(Date.now(), groupId);
      group.leader_id = null;
    }

    return group;
  }

  public deleteGroup(groupId: string): void {
    const res = this.db.prepare('DELETE FROM class_groups WHERE id = ?').run(groupId);
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
      const colors = [
        'bg-indigo-500',
        'bg-emerald-500',
        'bg-amber-500',
        'bg-rose-500',
        'bg-cyan-500',
        'bg-violet-500',
      ];

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

  public getPickerCandidates(classId: string, lessonId?: string): any[] {
    const students = this.db
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

    return students.map((s) => {
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
      .run(rollcallId, studentId, classId || null, lessonId || null, now, rating ?? null, score, rewardCoins, difficulty);

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
