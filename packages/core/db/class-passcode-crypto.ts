/**
 * 班级临时口令的可逆加密。
 *
 * 登录按「学生所在班级」取出 class_passcode 再比较，不是按口令查班级，
 * 因此不另建 HMAC 查找列：解密后用 SHA-256 摘要做常量时间比较。
 * 教师界面要看到原文，所以用与 AI Provider API Key 相同的 AES-256-GCM。
 *
 * 密文带 `olenc1:` 前缀，迁移据此跳过已加密的行。前缀后面是
 * `iv:authTag:ciphertext`（各段为十六进制，iv 与 tag 均为 16 字节）。
 */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { decryptApiKey, encryptApiKey } from '../di/api-key-crypto.js';
import { stripReasoningArtifacts } from '../ai/strip-reasoning.js';

export const CLASS_PASSCODE_PREFIX = 'olenc1:';

const REDACTED = '***REDACTED***';
const PASSCODE_KEYS = new Set(['class_passcode', 'classpasscode', 'passcode']);

export function isEncryptedClassPasscode(value: string | null | undefined): boolean {
  if (!value || !value.startsWith(CLASS_PASSCODE_PREFIX)) return false;
  const parts = value.slice(CLASS_PASSCODE_PREFIX.length).split(':');
  if (parts.length !== 3) return false;
  const [iv, tag, body] = parts;
  return (
    /^[0-9a-fA-F]{32}$/.test(iv) &&
    /^[0-9a-fA-F]{32}$/.test(tag) &&
    /^[0-9a-fA-F]+$/.test(body) &&
    body.length >= 2 &&
    body.length % 2 === 0
  );
}

/** 写入数据库前密封。null / 空串保持为 null。已经是密文则不再包一层。 */
export function sealClassPasscode(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (isEncryptedClassPasscode(value)) return value;
  return CLASS_PASSCODE_PREFIX + encryptApiKey(value);
}

/**
 * 读出教师界面要展示的原文。
 * 旧明文原样返回，供迁移前的读取；密文解密失败时抛错，不把密文当口令展示。
 */
export function openClassPasscode(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  if (!isEncryptedClassPasscode(stored)) return stored;
  try {
    return decryptApiKey(stored.slice(CLASS_PASSCODE_PREFIX.length));
  } catch {
    const err = new Error('班级临时口令解密失败：ENCRYPTION_KEY 与加密时不一致或数据已损坏') as Error & {
      status?: number;
    };
    err.status = 500;
    throw err;
  }
}

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

/**
 * 解密后比较。摘要长度固定，timingSafeEqual 不因口令内容提前返回。
 * 解密失败视为不匹配，且不把密文或原文写进错误对象。
 */
export function classPasscodeMatches(stored: string | null | undefined, provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || !stored) return false;
  let plain: string | null;
  try {
    plain = openClassPasscode(stored);
  } catch {
    console.error('[Auth] 班级临时口令解密失败（ENCRYPTION_KEY 不一致或数据损坏），已拒绝该次口令匹配');
    return false;
  }
  const left = plain?.trim() ?? '';
  if (!left) return false;
  return crypto.timingSafeEqual(digest(left), digest(provided));
}

export function encryptStoredClassPasscodes(db: Database.Database): { updated: number; skipped: number } {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'classes'").get() as
    { name: string } | undefined;
  if (!table) return { updated: 0, skipped: 0 };

  const rows = db
    .prepare(
      `SELECT id, class_passcode FROM classes
       WHERE class_passcode IS NOT NULL AND class_passcode != ''`,
    )
    .all() as { id: string; class_passcode: string }[];

  const update = db.prepare('UPDATE classes SET class_passcode = ? WHERE id = ? AND class_passcode = ?');
  let updated = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      if (isEncryptedClassPasscode(row.class_passcode)) {
        skipped += 1;
        continue;
      }
      const sealed = sealClassPasscode(row.class_passcode);
      updated += update.run(sealed, row.id, row.class_passcode).changes;
    }
  });
  run();
  return { updated, skipped };
}

export function cleanStoredLessonThinkArtifacts(db: Database.Database): { updated: number; examined: number } {
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lessons'").get();
  if (!tableCheck) return { updated: 0, examined: 0 };

  const dirtyRows = db
    .prepare(
      "SELECT id, content FROM lessons WHERE content LIKE '%<think%' OR content LIKE '%<thinking%' OR content LIKE '%<reasoning%' OR content LIKE '%```think%'",
    )
    .all() as { id: string; content: string }[];

  if (!dirtyRows || dirtyRows.length === 0) return { updated: 0, examined: 0 };

  const update = db.prepare('UPDATE lessons SET content = ? WHERE id = ?');
  let updated = 0;
  const run = db.transaction(() => {
    for (const row of dirtyRows) {
      if (!row.content) continue;
      const cleaned = stripReasoningArtifacts(row.content);
      if (cleaned !== row.content) {
        update.run(cleaned, row.id);
        updated++;
      }
    }
  });
  run();
  return { updated, examined: dirtyRows.length };
}

export function applyStartupDataMigrations(db: Database.Database): void {
  const result = encryptStoredClassPasscodes(db);
  if (result.updated > 0) {
    console.log(`[Migration] 已加密 ${result.updated} 条班级临时口令（跳过已加密 ${result.skipped} 条）`);
  }
  const cleanResult = cleanStoredLessonThinkArtifacts(db);
  if (cleanResult.updated > 0) {
    console.log(`[Migration] 已清洗 ${cleanResult.updated} 门课程中的模型思维链 (<think>) 残留`);
  }
  const backfillResult = backfillAcademicYearData(db);
  if (backfillResult.updated > 0) {
    console.log(`[Migration] 已回填 ${backfillResult.updated} 条历史数据的学年维度信息`);
  }
}

/**
 * 历史数据学年平滑回填（按日期与父级实体关系幂等更新为 NULL 的记录）
 */
export function backfillAcademicYearData(db: Database.Database): { updated: number } {
  const hasTable = (tableName: string) => {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
    return !!row;
  };

  const deriveYear = (dateVal: string | number | null | undefined, startMonth = 9): string | null => {
    if (!dateVal) return null;
    let year: number;
    let month: number;
    if (typeof dateVal === 'string') {
      const m = /^(\d{4})-(\d{2})/.exec(dateVal.trim());
      if (m) {
        year = Number(m[1]);
        month = Number(m[2]) - 1;
      } else {
        const d = new Date(dateVal);
        if (Number.isNaN(d.getTime())) return null;
        year = d.getFullYear();
        month = d.getMonth();
      }
    } else {
      const d = new Date(dateVal);
      if (Number.isNaN(d.getTime())) return null;
      year = d.getFullYear();
      month = d.getMonth();
    }
    const start = month + 1 >= startMonth ? year : year - 1;
    return `${start}-${start + 1}`;
  };

  let totalUpdated = 0;

  const run = db.transaction(() => {
    // 1. schedules
    if (hasTable('schedules')) {
      const unassignedSchedules = db
        .prepare('SELECT id, scheduled_date, created_at FROM schedules WHERE academic_year IS NULL')
        .all() as Array<{ id: string; scheduled_date?: string | null; created_at?: string | null }>;
      const updateSchedule = db.prepare('UPDATE schedules SET academic_year = ? WHERE id = ?');
      for (const item of unassignedSchedules) {
        const y = deriveYear(item.scheduled_date || item.created_at);
        if (y) {
          updateSchedule.run(y, item.id);
          totalUpdated++;
        }
      }
    }

    // 2. assignments
    if (hasTable('assignments')) {
      const unassignedAssignments = db
        .prepare('SELECT id, created_at FROM assignments WHERE academic_year IS NULL')
        .all() as Array<{ id: string; created_at?: string | null }>;
      const updateAssignment = db.prepare('UPDATE assignments SET academic_year = ? WHERE id = ?');
      for (const item of unassignedAssignments) {
        const y = deriveYear(item.created_at);
        if (y) {
          updateAssignment.run(y, item.id);
          totalUpdated++;
        }
      }
    }

    // 3. assignment_submissions
    if (hasTable('assignment_submissions') && hasTable('assignments')) {
      // 优先从所属 assignment 继承
      const inherited = db
        .prepare(
          `UPDATE assignment_submissions
           SET academic_year = (SELECT a.academic_year FROM assignments a WHERE a.id = assignment_submissions.assignment_id)
           WHERE academic_year IS NULL
             AND EXISTS (SELECT 1 FROM assignments a WHERE a.id = assignment_submissions.assignment_id AND a.academic_year IS NOT NULL)`,
        )
        .run();
      totalUpdated += inherited.changes;

      // 若仍有未分类的，按 submitted_at 推导
      const unassignedSubs = db
        .prepare(
          'SELECT assignment_id, student_id, submitted_at FROM assignment_submissions WHERE academic_year IS NULL',
        )
        .all() as Array<{ assignment_id: string; student_id: string; submitted_at?: string | null }>;
      const updateSub = db.prepare(
        'UPDATE assignment_submissions SET academic_year = ? WHERE assignment_id = ? AND student_id = ?',
      );
      for (const item of unassignedSubs) {
        const y = deriveYear(item.submitted_at);
        if (y) {
          updateSub.run(y, item.assignment_id, item.student_id);
          totalUpdated++;
        }
      }
    }

    // 4. attendance
    if (hasTable('attendance') && hasTable('schedules')) {
      const inherited = db
        .prepare(
          `UPDATE attendance
           SET academic_year = (SELECT s.academic_year FROM schedules s WHERE s.id = attendance.schedule_id)
           WHERE academic_year IS NULL
             AND EXISTS (SELECT 1 FROM schedules s WHERE s.id = attendance.schedule_id AND s.academic_year IS NOT NULL)`,
        )
        .run();
      totalUpdated += inherited.changes;

      const unassignedAtt = db
        .prepare('SELECT schedule_id, student_id, recorded_at FROM attendance WHERE academic_year IS NULL')
        .all() as Array<{ schedule_id: string; student_id: string; recorded_at?: string | null }>;
      const updateAtt = db.prepare('UPDATE attendance SET academic_year = ? WHERE schedule_id = ? AND student_id = ?');
      for (const item of unassignedAtt) {
        const y = deriveYear(item.recorded_at);
        if (y) {
          updateAtt.run(y, item.schedule_id, item.student_id);
          totalUpdated++;
        }
      }
    }

    // 5. exams & exam_scores
    if (hasTable('exams')) {
      const unassignedExams = db
        .prepare('SELECT id, created_at FROM exams WHERE academic_year IS NULL')
        .all() as Array<{ id: string; created_at?: string | null }>;
      const updateExam = db.prepare('UPDATE exams SET academic_year = ? WHERE id = ?');
      for (const item of unassignedExams) {
        const y = deriveYear(item.created_at);
        if (y) {
          updateExam.run(y, item.id);
          totalUpdated++;
        }
      }
    }

    if (hasTable('exam_scores') && hasTable('exams')) {
      const inherited = db
        .prepare(
          `UPDATE exam_scores
           SET academic_year = (SELECT e.academic_year FROM exams e WHERE e.id = exam_scores.exam_id)
           WHERE academic_year IS NULL
             AND EXISTS (SELECT 1 FROM exams e WHERE e.id = exam_scores.exam_id AND e.academic_year IS NOT NULL)`,
        )
        .run();
      totalUpdated += inherited.changes;
    }

    // 6. student_lesson_progress
    if (hasTable('student_lesson_progress')) {
      const cols = (db.prepare('PRAGMA table_info(student_lesson_progress)').all() as Array<{ name: string }>).map(
        (c) => c.name,
      );
      if (cols.includes('academic_year')) {
        const dateCol = cols.includes('assigned_at')
          ? 'assigned_at'
          : cols.includes('updated_at')
            ? 'updated_at'
            : cols.includes('created_at')
              ? 'created_at'
              : null;
        if (dateCol) {
          const unassignedProgress = db
            .prepare(
              `SELECT lesson_id, student_id, ${dateCol} as date_val FROM student_lesson_progress WHERE academic_year IS NULL`,
            )
            .all() as Array<{ lesson_id: string; student_id: string; date_val?: string | null }>;
          const updateProgress = db.prepare(
            'UPDATE student_lesson_progress SET academic_year = ? WHERE lesson_id = ? AND student_id = ?',
          );
          for (const item of unassignedProgress) {
            const y = deriveYear(item.date_val);
            if (y) {
              updateProgress.run(y, item.lesson_id, item.student_id);
              totalUpdated++;
            }
          }
        }
      }
    }
  });

  run();
  return { updated: totalUpdated };
}

/** 审计事件入库前去掉口令字段和 olenc1 密文，不改调用方拿到的原对象。 */
export function redactPasscodeMaterial(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.replace(/olenc1:[0-9a-fA-F:]+/g, REDACTED);
  if (value == null || typeof value !== 'object') return value;
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactPasscodeMaterial(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PASSCODE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactPasscodeMaterial(nested, depth + 1);
  }
  return out;
}
