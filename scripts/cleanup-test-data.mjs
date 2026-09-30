import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = path.resolve('packages/core/db/educational_os.db');

if (!fs.existsSync(dbPath)) {
  console.log('[cleanup-test-data] Database file not found at:', dbPath);
  process.exit(0);
}

const db = new Database(dbPath);
console.log('[cleanup-test-data] Scanning database for leftover test/E2E records in:', dbPath);

const cleanupTx = db.transaction(() => {
  // 1. 查找所有 E2E / 金丝雀测试课程
  const testLessons = db
    .prepare("SELECT id, title FROM lessons WHERE title LIKE 'E2E %' OR title LIKE '%canary%' OR title LIKE '%金丝雀%'")
    .all();

  console.log(`[cleanup-test-data] Found ${testLessons.length} leftover test lessons:`);
  for (const l of testLessons) {
    console.log(`  - [${l.id}] ${l.title}`);
  }

  if (testLessons.length > 0) {
    const lessonIds = testLessons.map((l) => l.id);
    const placeholders = lessonIds.map(() => '?').join(',');

    // 级联清理 whiteboard_elements
    const delWb = db.prepare(`DELETE FROM whiteboard_elements WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Removed ${delWb.changes} whiteboard elements`);

    // 级联清理 student_lesson_progress
    const delProg = db.prepare(`DELETE FROM student_lesson_progress WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Removed ${delProg.changes} student lesson progress rows`);

    // 级联清理 schedules
    const delSch = db.prepare(`DELETE FROM schedules WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Removed ${delSch.changes} schedules`);

    // 级联清理 assignments
    const delAss = db.prepare(`DELETE FROM assignments WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Removed ${delAss.changes} assignments`);

    // 级联清理 quiz submissions
    const delQuiz = db.prepare(`DELETE FROM lesson_quiz_submissions WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Removed ${delQuiz.changes} quiz submissions`);

    // 级联清理 preset polls (if table exists)
    try {
      const delPreset = db.prepare(`DELETE FROM lesson_preset_polls WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      console.log(`  ✓ Removed ${delPreset.changes} preset polls`);
    } catch {}

    // 级联清理 classroom sessions and poll votes
    try {
      const sessions = db.prepare(`SELECT id FROM classroom_sessions WHERE lesson_id IN (${placeholders})`).all(...lessonIds);
      if (sessions.length > 0) {
        const sessionIds = sessions.map((s) => s.id);
        const sPlaceholders = sessionIds.map(() => '?').join(',');

        try {
          db.prepare(`DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE session_id IN (${sPlaceholders}))`).run(...sessionIds);
        } catch {}
        try {
          db.prepare(`DELETE FROM classroom_quick_polls WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
        } catch {}
        try {
          db.prepare(`DELETE FROM classroom_buzzers WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
        } catch {}
        try {
          db.prepare(`DELETE FROM classroom_exit_tickets WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
        } catch {}
        try {
          db.prepare(`DELETE FROM classroom_feed WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
        } catch {}
        try {
          db.prepare(`DELETE FROM classroom_danmaku WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
        } catch {}
      }
      const delSessions = db.prepare(`DELETE FROM classroom_sessions WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      console.log(`  ✓ Removed ${delSessions.changes} classroom sessions`);
    } catch {}

    // 删除 lessons 自身
    const delLessons = db.prepare(`DELETE FROM lessons WHERE id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Successfully deleted ${delLessons.changes} test lessons.`);
  }

  // 2. 查找并清理所有 E2E / 探针测试学生 (STU_ 开头带有时间戳的临时学生，严禁误伤普通测试学生)
  const testStudents = db
    .prepare("SELECT id, student_number, name FROM students WHERE (student_number LIKE 'STU_%-%') OR (student_number LIKE 'STU_POLL_%-%') OR student_number LIKE '%CANARY%'")
    .all();

  console.log(`[cleanup-test-data] Found ${testStudents.length} leftover test students:`);
  if (testStudents.length > 0) {
    const studentIds = testStudents.map((s) => s.id);
    const sPlaceholders = studentIds.map(() => '?').join(',');

    db.prepare(`DELETE FROM student_seats WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
    db.prepare(`DELETE FROM class_students WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
    try {
      db.prepare(`DELETE FROM lesson_quiz_submissions WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
    } catch {}
    try {
      db.prepare(`DELETE FROM student_lesson_progress WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
    } catch {}

    const delStudents = db.prepare(`DELETE FROM students WHERE id IN (${sPlaceholders})`).run(...studentIds);
    console.log(`  ✓ Successfully deleted ${delStudents.changes} test students.`);
  }

  // 3. 查找并清理所有 E2E / 金丝雀测试班级
  const testClasses = db
    .prepare("SELECT id, name FROM classes WHERE name LIKE 'E2E %' OR name LIKE '%canary%' OR name LIKE '%金丝雀%'")
    .all();

  console.log(`[cleanup-test-data] Found ${testClasses.length} leftover test classes:`);
  if (testClasses.length > 0) {
    const classIds = testClasses.map((c) => c.id);
    const cPlaceholders = classIds.map(() => '?').join(',');

    db.prepare(`DELETE FROM student_seats WHERE class_id IN (${cPlaceholders})`).run(...classIds);
    db.prepare(`DELETE FROM class_students WHERE class_id IN (${cPlaceholders})`).run(...classIds);
    db.prepare(`DELETE FROM schedules WHERE class_id IN (${cPlaceholders})`).run(...classIds);

    const delClasses = db.prepare(`DELETE FROM classes WHERE id IN (${cPlaceholders})`).run(...classIds);
    console.log(`  ✓ Successfully deleted ${delClasses.changes} test classes.`);
  }
});

try {
  cleanupTx();
  console.log('[cleanup-test-data] All test/E2E artifacts successfully purged from database.');
} catch (err) {
  console.error('[cleanup-test-data] Error during cleanup transaction:', err);
  process.exit(1);
} finally {
  db.close();
}
