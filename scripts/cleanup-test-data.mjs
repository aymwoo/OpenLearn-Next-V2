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

/**
 * 测试数据的命名前缀（课节标题 / 班级名）。
 *
 * ## 为什么集中成一常量
 *
 * 清理规则最初只写了 `E2E ` 与 canary，而 `e2e/a11y-gate.spec.ts` 建的是
 * `A11Y 学生端课节` / `A11Y 班级` / `A11Y 测评班` —— 前缀不在清单里，于是每跑
 * 一次无障碍门禁就永久留下 1 个空课节 + 2 个空班级（实测：开发库里堆了 5 个
 * 空白课节 + 10 个空班级，全部 `whiteboard_elements = 0`）。
 *
 * 现在新增 spec 只需要把前缀加到这里，不必再改 5 处 SQL；
 * 同时 `e2e/a11y-gate.spec.ts` 已改为「创建与清理共用同一组常量」，
 * 本清单是**第二道保险**（防其它 spec 或历史残留）。
 */
const TEST_NAME_PREFIXES = ['E2E ', 'A11Y ', 'A11Y2 ', 'A11Y3 '];
/** 按子串匹配的前缀（可以出现在名字任意位置） */
const TEST_NAME_MARKERS = ['canary', '金丝雀'];

/**
 * 测试学生的学号前缀。
 *
 * 原先只用 `STU_%-%`（带横杠）兜底，但 `student-return-to-class.spec.ts` 用的是
 * `STU_RETURN_${Date.now().toString(36).toUpperCase()}` —— base36 时间戳**不带横杠**，
 * 于是永远漏网（实测：开发库里留下了 `STU_RETURN_MVM67ALV` 这类学生）。
 *
 * 这里把各 spec 的 tag 全枚举出来，比“`STU_` 开头就删”更安全 ——
 * 后者会误伤人工建的普通测试学生（原注释已明确要求不得误伤）。
 */
const TEST_STUDENT_PREFIXES = [
  'STU_BUZZ_',
  'STU_COCKPIT_',
  'STU_CONTRAST_',
  'STU_E2E_',
  'STU_GATE_',
  'STU_GOLDEN_',
  'STU_LAB_',
  'STU_LOCK_',
  'STU_PACE_',
  'STU_POLL_',
  'STU_RESILIENCE_',
  'STU_RETURN_',
  'STU_STAGE_',
  'STU_TICKET_',
  'STU_WRAP_',
  'STU_A11Y_',
];

/** 生成「课节 title / 班级 name」匹配条件的 SQL 片段与参数。 */
function nameMatchClause(column) {
  const parts = [];
  const params = [];
  for (const prefix of TEST_NAME_PREFIXES) {
    parts.push(`${column} LIKE ?`);
    params.push(`${prefix}%`);
  }
  for (const marker of TEST_NAME_MARKERS) {
    parts.push(`${column} LIKE ?`);
    params.push(`%${marker}%`);
  }
  return { sql: parts.join(' OR '), params };
}

const lessonMatch = nameMatchClause('title');
const classNameMatch = nameMatchClause('name');

const cleanupTx = db.transaction(() => {
  // 1. 查找所有测试课程（E2E / A11Y / 金丝雀）
  const testLessons = db.prepare(`SELECT id, title FROM lessons WHERE ${lessonMatch.sql}`).all(...lessonMatch.params);

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
    const delProg = db
      .prepare(`DELETE FROM student_lesson_progress WHERE lesson_id IN (${placeholders})`)
      .run(...lessonIds);
    console.log(`  ✓ Removed ${delProg.changes} student lesson progress rows`);

    // 级联清理 schedules
    const delSch = db.prepare(`DELETE FROM schedules WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Removed ${delSch.changes} schedules`);

    // 级联清理 assignments
    const delAss = db.prepare(`DELETE FROM assignments WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Removed ${delAss.changes} assignments`);

    // 级联清理环节门禁履历（曾漏清：a11y 门禁跑一次就留下 19 条孤儿 segment_visits）
    for (const [table, label] of [
      ['segment_visits', 'segment visits'],
      ['segment_gate_overrides', 'segment gate overrides'],
    ]) {
      try {
        const del = db.prepare(`DELETE FROM ${table} WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
        if (del.changes > 0) console.log(`  ✓ Removed ${del.changes} ${label}`);
      } catch {
        // 老库可能没有这张表
      }
    }

    // 级联清理 quiz submissions
    const delQuiz = db
      .prepare(`DELETE FROM lesson_quiz_submissions WHERE lesson_id IN (${placeholders})`)
      .run(...lessonIds);
    console.log(`  ✓ Removed ${delQuiz.changes} quiz submissions`);

    // 级联清理 preset polls (if table exists)
    try {
      const delPreset = db
        .prepare(`DELETE FROM lesson_preset_polls WHERE lesson_id IN (${placeholders})`)
        .run(...lessonIds);
      console.log(`  ✓ Removed ${delPreset.changes} preset polls`);
    } catch {}

    // 级联清理 classroom sessions and poll votes
    try {
      const sessions = db
        .prepare(`SELECT id FROM classroom_sessions WHERE lesson_id IN (${placeholders})`)
        .all(...lessonIds);
      if (sessions.length > 0) {
        const sessionIds = sessions.map((s) => s.id);
        const sPlaceholders = sessionIds.map(() => '?').join(',');

        try {
          db.prepare(
            `DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE session_id IN (${sPlaceholders}))`,
          ).run(...sessionIds);
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
          db.prepare(`DELETE FROM classroom_pacing_signals WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
        } catch {}
        try {
          db.prepare(`DELETE FROM classroom_danmaku WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
        } catch {}
      }
      const delSessions = db
        .prepare(`DELETE FROM classroom_sessions WHERE lesson_id IN (${placeholders})`)
        .run(...lessonIds);
      console.log(`  ✓ Removed ${delSessions.changes} classroom sessions`);
    } catch {}

    // 删除 lessons 自身
    const delLessons = db.prepare(`DELETE FROM lessons WHERE id IN (${placeholders})`).run(...lessonIds);
    console.log(`  ✓ Successfully deleted ${delLessons.changes} test lessons.`);
  }

  // 2. 查找并清理所有 E2E / 探针测试学生 (STU_ 开头带有时间戳的临时学生，严禁误伤普通测试学生)
  const testStudents = db
    .prepare(
      'SELECT id, student_number, name FROM students WHERE ' +
        // 带横杠的时间戳后缀（多数 spec 的写法）
        "(student_number LIKE 'STU_%-%') OR " +
        // 枚举的 spec tag（覆盖 base36 等无横杠后缀）
        TEST_STUDENT_PREFIXES.map(() => 'student_number LIKE ?').join(' OR ') +
        " OR student_number LIKE '%CANARY%'",
    )
    .all(...TEST_STUDENT_PREFIXES.map((p) => `${p}%`));

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
    // 点名评价记录（含课堂金币）—— 实时同步 e2e 会写入
    try {
      db.prepare(`DELETE FROM student_rollcalls WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
    } catch {}
    // 积分台账流水 —— 加分/扣分用例会写入
    try {
      db.prepare(`DELETE FROM student_point_logs WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
    } catch {}
    // 点名已读回执
    try {
      db.prepare(`DELETE FROM student_read_notifications WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
    } catch {}

    const delStudents = db.prepare(`DELETE FROM students WHERE id IN (${sPlaceholders})`).run(...studentIds);
    console.log(`  ✓ Successfully deleted ${delStudents.changes} test students.`);
  }

  // 3. 查找并清理所有测试班级（E2E / A11Y / 金丝雀）
  const testClasses = db
    .prepare(`SELECT id, name FROM classes WHERE ${classNameMatch.sql}`)
    .all(...classNameMatch.params);

  console.log(`[cleanup-test-data] Found ${testClasses.length} leftover test classes:`);
  if (testClasses.length > 0) {
    const classIds = testClasses.map((c) => c.id);
    const cPlaceholders = classIds.map(() => '?').join(',');

    db.prepare(`DELETE FROM student_seats WHERE class_id IN (${cPlaceholders})`).run(...classIds);
    db.prepare(`DELETE FROM class_students WHERE class_id IN (${cPlaceholders})`).run(...classIds);
    db.prepare(`DELETE FROM schedules WHERE class_id IN (${cPlaceholders})`).run(...classIds);
    // 分组方案按 class_id 关联，SQLite 默认无级联 —— 班级被删后会留下孤儿行
    try {
      db.prepare(`DELETE FROM class_groups WHERE class_id IN (${cPlaceholders})`).run(...classIds);
    } catch {}
    // 课堂会话挂在 class_id 上，而按 lesson_id 的级联清理只覆盖测试**课节**；
    // 若用例只建班不建课节，投票/抢答/通票/动态流都会残留
    try {
      const sessions = db
        .prepare(`SELECT id FROM classroom_sessions WHERE class_id IN (${cPlaceholders})`)
        .all(...classIds);
      if (sessions.length > 0) {
        const ids = sessions.map((s) => s.id);
        const p2 = ids.map(() => '?').join(',');
        try {
          db.prepare(
            `DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE session_id IN (${p2}))`,
          ).run(...ids);
        } catch {}
        for (const t of [
          'classroom_quick_polls',
          'classroom_buzzers',
          'classroom_exit_tickets',
          'classroom_feed',
          'classroom_danmaku',
        ]) {
          try {
            db.prepare(`DELETE FROM ${t} WHERE session_id IN (${p2})`).run(...ids);
          } catch {}
        }
        db.prepare(`DELETE FROM classroom_sessions WHERE id IN (${p2})`).run(...ids);
      }
    } catch {}

    const delClasses = db.prepare(`DELETE FROM classes WHERE id IN (${cPlaceholders})`).run(...classIds);
    console.log(`  ✓ Successfully deleted ${delClasses.changes} test classes.`);
  }

  // 4. 查找并清理所有 E2E / 金丝雀测试机房 (room_number LIKE 'E2E %' OR '%canary%')
  try {
    const testLabs = db
      .prepare(
        "SELECT id, room_number FROM computer_labs WHERE room_number LIKE 'E2E %' OR room_number LIKE '%canary%'",
      )
      .all();

    console.log(`[cleanup-test-data] Found ${testLabs.length} leftover test computer labs:`);
    if (testLabs.length > 0) {
      const labIds = testLabs.map((l) => l.id);
      const lPlaceholders = labIds.map(() => '?').join(',');

      db.prepare(`DELETE FROM student_seats WHERE lab_id IN (${lPlaceholders})`).run(...labIds);
      const delLabs = db.prepare(`DELETE FROM computer_labs WHERE id IN (${lPlaceholders})`).run(...labIds);
      console.log(`  ✓ Successfully deleted ${delLabs.changes} test computer labs.`);
    }
  } catch (err) {
    console.warn('[cleanup-test-data] Warning cleaning up computer_labs:', err.message);
  }

  // 5. 查找并清理所有 E2E / 金丝雀测试教工账号 (username LIKE 'e2e_%' OR '%canary%')，严格保护 admin/teacher 种子账号
  try {
    const testUsers = db
      .prepare(
        "SELECT id, username FROM users WHERE (username LIKE 'e2e_%' OR username LIKE '%canary%') AND username NOT IN ('admin', 'teacher')",
      )
      .all();

    console.log(`[cleanup-test-data] Found ${testUsers.length} leftover test users:`);
    if (testUsers.length > 0) {
      const userIds = testUsers.map((u) => u.id);
      const uPlaceholders = userIds.map(() => '?').join(',');

      const delUsers = db.prepare(`DELETE FROM users WHERE id IN (${uPlaceholders})`).run(...userIds);
      console.log(`  ✓ Successfully deleted ${delUsers.changes} test users.`);
    }
  } catch (err) {
    console.warn('[cleanup-test-data] Warning cleaning up users:', err.message);
  }

  // 6. 查找并清理所有 E2E / 金丝雀测试 AI 提供商 (name LIKE 'E2E %' OR '%canary%')
  try {
    const testProviders = db
      .prepare("SELECT id, name FROM ai_providers WHERE name LIKE 'E2E %' OR name LIKE '%canary%'")
      .all();

    console.log(`[cleanup-test-data] Found ${testProviders.length} leftover test AI providers:`);
    if (testProviders.length > 0) {
      const provIds = testProviders.map((p) => p.id);
      const pPlaceholders = provIds.map(() => '?').join(',');

      const delProv = db.prepare(`DELETE FROM ai_providers WHERE id IN (${pPlaceholders})`).run(...provIds);
      console.log(`  ✓ Successfully deleted ${delProv.changes} test AI providers.`);
    }
  } catch (err) {
    console.warn('[cleanup-test-data] Warning cleaning up ai_providers:', err.message);
  }
  // 7. 清理**孤儿课堂会话**：课节已被删除、但会话还挂在库里的残留。
  // 上面的级联清理按 lesson_id / class_id 删会话，用例把课节删掉后
  // 会话就成了孤儿 —— 它仍会以「进行中的课堂会话」出现在互动课堂首屏，
  // 污染后续用例（e.g. a11y-gate 的互动课堂检查面）并让断言时序相关。
  try {
    const orphans = db
      .prepare(
        `SELECT id FROM classroom_sessions
         WHERE lesson_id NOT IN (SELECT id FROM lessons)
            OR (class_id IS NOT NULL AND class_id NOT IN (SELECT id FROM classes))`,
      )
      .all();
    if (orphans.length > 0) {
      const ids = orphans.map((o) => o.id);
      const ph = ids.map(() => '?').join(',');
      for (const sql of [
        `DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE session_id IN (${ph}))`,
        `DELETE FROM classroom_quick_polls WHERE session_id IN (${ph})`,
        `DELETE FROM classroom_pacing_signals WHERE session_id IN (${ph})`,
        `DELETE FROM classroom_danmaku WHERE session_id IN (${ph})`,
        `DELETE FROM classroom_sessions WHERE id IN (${ph})`,
      ]) {
        try {
          db.prepare(sql).run(...ids);
        } catch {}
      }
      console.log(`  ✓ Removed ${ids.length} orphaned classroom sessions`);
    }
  } catch (err) {
    console.warn('[cleanup-test-data] Warning cleaning up orphaned classroom sessions:', err.message);
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
