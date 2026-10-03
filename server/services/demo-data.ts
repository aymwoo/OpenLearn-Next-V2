/**
 * 演示数据播种与清理（DEMO-SEED-01）
 *
 * ## 为什么需要登记表
 *
 * 既有实现（`server/routes/admin.ts` 的 `/api/admin/seed-demo`）有两个安全问题：
 *
 * 1. `lessonId` 取自 `SELECT id FROM lessons LIMIT 1` —— 它**劫持一門真实课程**
 *    而非自建一门。清理时无法安全删除"演示课程"，因为那可能就是老师正在用的课。
 * 2. 学生按 `student_number`（`S001`…）复用 —— 这些学号可能与真实学生冲突，
 *    一旦命中就会把**真实学生**链接进演示班级，清理时进退两难。
 *
 * 本模块改为：播种时把**实际创建的每一行**登记进 `demo_data_registry`，
 * 清理时只删登记过的行。不依赖任何命名约定，因此不会误伤真实数据。
 *
 * ## 不变量
 *
 * - 清理**永不**删除 `users.role = 'administrator'` 的账号（代码侧兜底断言）。
 * - 清理**永不**删除未在登记表中的行。
 * - 播种幂等：重复调用不会产生重复数据，返回同一批 ID。
 *
 * @module
 */

import type Database from 'better-sqlite3';
import { hashPassword } from '../../packages/core/db/index.js';

/** 演示数据标记前缀 —— 仅用于 UI 展示与肉眼识别，**清理不依赖它**。 */
export const DEMO_TAG = '[演示]';

/** 播种时使用的确定性 ID。确定性保证播种幂等，且清理可精确定位。 */
export const DEMO_IDS = {
  lesson: 'demo-lesson',
  primaryClass: 'demo-class',
  secondaryClass: 'demo-class-2',
  teacher: 'demo_teacher',
  schedule: 'demo-schedule',
} as const;

/** 演示教师账号凭据（用于 Demo 演示，务必与生产账号区分）。 */
export const DEMO_TEACHER = {
  username: 'demo_teacher',
  password: 'Demo@2026',
  name: '演示教师',
} as const;

const STUDENT_NAMES = [
  '林小雨', '陈子涵', '王思远', '李梦琪', '张一鸣', '刘欣怡',
  '赵梓轩', '孙嘉怡', '周浩然', '吴语彤', '郑博文', '黄芷若',
] as const;

/** 登记表中 entity_type 的取值（同时也是清理顺序的分组依据）。 */
type EntityType =
  | 'schedule'
  | 'class_student'
  | 'student'
  | 'class'
  | 'lesson'
  | 'user';

export interface DemoDataStatus {
  seeded: boolean;
  counts: Record<EntityType, number>;
  total: number;
  demoTeacherExists: boolean;
  /** 播种时间（最早一条登记的 created_at），未播种时为 null。 */
  seededAt: number | null;
  demo: {
    lessonId: string;
    classIds: string[];
    studentIds: string[];
    teacherUsername: string;
    scheduleId: string;
  };
}

const ALL_ENTITY_TYPES: EntityType[] = [
  'schedule',
  'class_student',
  'student',
  'class',
  'lesson',
  'user',
];

export const DEMO_TEACHER_USERNAME = DEMO_TEACHER.username;

/** 确保登记表存在（老库升级后、迁移尚未跑完时的兜底）。 */
export function ensureRegistryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_data_registry (
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );
  `);
}

/** 统计当前登记情况。 */
export function getDemoDataStatus(db: Database.Database): DemoDataStatus {
  ensureRegistryTable(db);

  const rows = db.prepare('SELECT entity_type, entity_id, created_at FROM demo_data_registry').all() as {
    entity_type: string;
    entity_id: string;
    created_at: number;
  }[];

  const counts = Object.fromEntries(ALL_ENTITY_TYPES.map((t) => [t, 0])) as Record<EntityType, number>;
  const ids: Record<string, string[]> = Object.fromEntries(ALL_ENTITY_TYPES.map((t) => [t, []]));

  let seededAt: number | null = null;
  for (const r of rows) {
    if (r.entity_type in counts) {
      counts[r.entity_type as EntityType] += 1;
      ids[r.entity_type]!.push(r.entity_id);
    }
    if (seededAt === null || r.created_at < seededAt) seededAt = r.created_at;
  }

  const teacher = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(DEMO_TEACHER.username) as { id: string } | undefined;

  return {
    seeded: rows.length > 0,
    counts,
    total: rows.length,
    demoTeacherExists: !!teacher,
    seededAt,
    demo: {
      lessonId: DEMO_IDS.lesson,
      classIds: [DEMO_IDS.primaryClass, DEMO_IDS.secondaryClass],
      studentIds: ids.student ?? [],
      teacherUsername: DEMO_TEACHER.username,
      scheduleId: DEMO_IDS.schedule,
    },
  };
}

/**
 * 清空"演示 ID 命名空间"下的残留行。
 *
 * 升级场景：旧版 `/api/admin/seed-demo` 用的是同一批确定性 ID
 * （`demo-class` / `demo-lesson` / `demo-s1`…），但**没有登记表**。
 * 新实现直接 INSERT 会撞主键，且这些行确实属于演示数据。
 *
 * 因此播种前先把这些 ID 上的行连同依赖一起删掉。
 * 安全性：这些 ID 是演示数据的专用命名空间，只有播种器会产生；
 * 真实的用户数据使用 UUID 或 `usr_*` 形式的 ID，不会落在这个空间内。
 */
function purgeDemoNamespace(db: Database.Database): void {
  const studentIds = db
    .prepare(`SELECT id FROM students WHERE id LIKE 'demo-stu-%' OR id LIKE 'demo-s%'`)
    .all() as { id: string }[];
  const classIds = db
    .prepare(`SELECT id FROM classes WHERE id = ? OR id LIKE 'demo-class%'`)
    .all(DEMO_IDS.primaryClass) as { id: string }[];

  for (const s of studentIds) {
    for (const sql of [
      'DELETE FROM class_students WHERE student_id = ?',
      'DELETE FROM student_lesson_progress WHERE student_id = ?',
      'DELETE FROM student_rollcalls WHERE student_id = ?',
      'DELETE FROM student_point_logs WHERE student_id = ?',
    ]) {
      try {
        db.prepare(sql).run(s.id);
      } catch {
        /* 表不存在则跳过 */
      }
    }
    db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
  }

  for (const c of classIds) {
    for (const sql of [
      'DELETE FROM class_students WHERE class_id = ?',
      'DELETE FROM schedules WHERE class_id = ?',
      'DELETE FROM class_groups WHERE class_id = ?',
    ]) {
      try {
        db.prepare(sql).run(c.id);
      } catch {
        /* 表不存在则跳过 */
      }
    }
    db.prepare('DELETE FROM classes WHERE id = ?').run(c.id);
  }

  db.prepare('DELETE FROM schedules WHERE id = ?').run(DEMO_IDS.schedule);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(DEMO_IDS.lesson);
  // 旧的播种器用的正是 `demo-class` / `demo-schedule` / `demo-lesson`，这里一并清掉。
  db.prepare('DELETE FROM users WHERE id = ?').run(`usr_${DEMO_TEACHER.username}`);
  db.prepare('DELETE FROM users WHERE id = ?').run('usr_demo_teacher');
}

/**
 * 播种演示数据（幂等）。
 *
 * 已播种时直接返回现有登记，不做任何写入 —— 重复点击不会产生第二份数据。
 * 未播种但存在旧版残留时会先清空演示 ID 命名空间，再重新播种。
 */
export function seedDemoData(db: Database.Database): DemoDataStatus {
  ensureRegistryTable(db);

  const existing = getDemoDataStatus(db);
  if (existing.seeded) return existing;

  const now = Date.now();
  const register = db.prepare(
    'INSERT OR IGNORE INTO demo_data_registry (entity_type, entity_id, created_at) VALUES (?, ?, ?)',
  );
  const mark = (type: EntityType, id: string) => register.run(type, id, now);

  const tx = db.transaction(() => {
    purgeDemoNamespace(db);

    // ── 1. 演示教师账号 ────────────────────────────────────────────
    // 管理员账号不在此处创建，也不由清理触碰。
    const teacherExists = db.prepare('SELECT id FROM users WHERE username = ?').get(DEMO_TEACHER.username);
    if (!teacherExists) {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, name, created_at, status)
         VALUES (?, ?, ?, 'teacher', ?, ?, 'active')`,
      ).run(
        `usr_${DEMO_TEACHER.username}`,
        DEMO_TEACHER.username,
        hashPassword(DEMO_TEACHER.password),
        DEMO_TEACHER.name,
        now,
      );
    }
    mark('user', `usr_${DEMO_TEACHER.username}`);

    // ── 2. 演示课程（自建，不再劫持真实课程）──────────────────────
    db.prepare(
      `INSERT INTO lessons (id, title, content, timeline, progress_mode, created_at, updated_at, creator_id)
       VALUES (?, ?, ?, NULL, 'manual', ?, ?, ?)`,
    ).run(
      DEMO_IDS.lesson,
      `${DEMO_TAG} 初中信息技术 · 第一单元`,
      JSON.stringify({
        description: '演示用课程：一节课即可跑通课堂互动、白板与反馈闭环。',
        objectives: [
          '认识信息与数字化',
          '会用在线白板做思维导图',
          '完成一次课堂测验与讲评',
        ],
        elements: [],
      }),
      now,
      now,
      `usr_${DEMO_TEACHER.username}`,
    );
    mark('lesson', DEMO_IDS.lesson);

    // ── 3. 演示班级 ×2 ────────────────────────────────────────────
    const classes = [
      { id: DEMO_IDS.primaryClass, name: `${DEMO_TAG} 一年级(1)班`, passcode: '1001' },
      { id: DEMO_IDS.secondaryClass, name: `${DEMO_TAG} 一年级(2)班`, passcode: '1002' },
    ];
    for (const c of classes) {
      db.prepare(
        'INSERT INTO classes (id, name, description, class_passcode, class_passcode_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        c.id,
        c.name,
        '系统一键生成的演示班级，用于 Demo 演示与功能验收。',
        c.passcode,
        now + 365 * 24 * 3600 * 1000,
        now,
      );
      mark('class', c.id);
    }

    // ── 4. 演示学生 ×12 + 班级关联 ────────────────────────────────
    // 学号用 DEMO-Sxx 前缀，天然避开真实学号命名空间。
    const linkStudent = db.prepare(
      'INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
    );
    STUDENT_NAMES.forEach((name, i) => {
      const id = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      db.prepare(
        'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, `DEMO-S${String(i + 1).padStart(2, '0')}`, name, `${id}@demo.local`, now);
      mark('student', id);

      // 轮流分配到两个班，保证两个班都有学生
      const classId = i % 2 === 0 ? classes[0]!.id : classes[1]!.id;
      linkStudent.run(classId, id, now);
      mark('class_student', `${classId}::${id}`);
    });

    // ── 5. 演示课表 ───────────────────────────────────────────────
    // scheduled_date 存 `YYYY-MM-DD HH:mm:ss`，与既有写入约定一致。
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
    ).run(
      DEMO_IDS.schedule,
      classes[0]!.id,
      DEMO_IDS.lesson,
      `${dateStr} 09:00:00`,
      '第1节',
      '演示课表：用于验证排课与开课链路。',
      now,
    );
    mark('schedule', DEMO_IDS.schedule);
  });

  tx();

  return getDemoDataStatus(db);
}

export interface CleanupReport {
  removed: Record<EntityType, number>;
  /** 因是管理员账号而被跳过的条目（正常情况下恒为 0，保留作为审计信号）。 */
  skippedAdministrators: number;
  totalRemoved: number;
}

/**
 * 清理演示数据。
 *
 * 只删除 `demo_data_registry` 中登记的行，按依赖倒序删除；删除完成后清空登记表。
 * 管理员账号在任何情况下都不会被删除。
 */
export function cleanupDemoData(db: Database.Database): CleanupReport {
  ensureRegistryTable(db);

  const removed: Record<EntityType, number> = Object.fromEntries(
    ALL_ENTITY_TYPES.map((t) => [t, 0]),
  ) as Record<EntityType, number>;
  let skippedAdministrators = 0;

  const idsFor = db.prepare('SELECT entity_id FROM demo_data_registry WHERE entity_type = ?');
  const unregister = db.prepare('DELETE FROM demo_data_registry WHERE entity_type = ? AND entity_id = ?');

  const tx = db.transaction(() => {
    // ── schedule（依赖 class / lesson）────────────────────────────
    for (const { entity_id } of idsFor.all('schedule') as { entity_id: string }[]) {
      removed.schedule += db.prepare('DELETE FROM schedules WHERE id = ?').run(entity_id).changes;
      unregister.run('schedule', entity_id);
    }

    // ── class_students 关联（依赖 class / student）────────────────
    for (const { entity_id } of idsFor.all('class_student') as { entity_id: string }[]) {
      const [classId, studentId] = entity_id.split('::') as [string, string];
      removed.class_student += db
        .prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?')
        .run(classId, studentId).changes;
      unregister.run('class_student', entity_id);
    }

    // ── 学生相关的下游表 ─────────────────────────────────────────
    for (const { entity_id } of idsFor.all('student') as { entity_id: string }[]) {
      const id = entity_id;
      // 这些表可能不存在（按迁移进度而定），逐个容错。
      for (const sql of [
        'DELETE FROM student_lesson_progress WHERE student_id = ?',
        'DELETE FROM class_rollcalls WHERE student_id = ?',
        'DELETE FROM student_rollcalls WHERE student_id = ?',
        'DELETE FROM student_point_logs WHERE student_id = ?',
        'DELETE FROM attendance WHERE student_id = ?',
      ]) {
        try {
          db.prepare(sql).run(id);
        } catch {
          /* 表不存在则跳过 */
        }
      }
      removed.student += db.prepare('DELETE FROM students WHERE id = ?').run(id).changes;
      unregister.run('student', id);
    }

    // ── 课程相关的下游表 ─────────────────────────────────────────
    for (const { entity_id } of idsFor.all('lesson') as { entity_id: string }[]) {
      const id = entity_id;
      for (const sql of [
        'DELETE FROM whiteboard_elements WHERE lesson_id = ?',
        'DELETE FROM assignments WHERE lesson_id = ?',
        'DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?',
        'DELETE FROM student_lesson_progress WHERE lesson_id = ?',
      ]) {
        try {
          db.prepare(sql).run(id);
        } catch {
          /* 表不存在则跳过 */
        }
      }
      removed.lesson += db.prepare('DELETE FROM lessons WHERE id = ?').run(id).changes;
      unregister.run('lesson', id);
    }

    // ── 班级相关的下游表 ─────────────────────────────────────────
    for (const { entity_id } of idsFor.all('class') as { entity_id: string }[]) {
      const id = entity_id;
      for (const sql of [
        'DELETE FROM class_groups WHERE class_id = ?',
        'DELETE FROM class_rollcalls WHERE class_id = ?',
        'DELETE FROM student_rollcalls WHERE class_id = ?',
      ]) {
        try {
          db.prepare(sql).run(id);
        } catch {
          /* 表不存在则跳过 */
        }
      }
      removed.class += db.prepare('DELETE FROM classes WHERE id = ?').run(id).changes;
      unregister.run('class', id);
    }

    // ── 演示教师（管理员账号硬保护）──────────────────────────────
    for (const { entity_id } of idsFor.all('user') as { entity_id: string }[]) {
      const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(entity_id) as
        | { id: string; role: string }
        | undefined;
      if (!row) {
        unregister.run('user', entity_id);
        continue;
      }
      if (row.role === 'administrator') {
        // 兜底不变量：管理员账号永不因演示数据清理而被删除。
        skippedAdministrators += 1;
        continue;
      }
      removed.user += db.prepare('DELETE FROM users WHERE id = ?').run(entity_id).changes;
      unregister.run('user', entity_id);
    }

    // 清理任何遗留登记（实体早已不存在的情况）
    db.prepare('DELETE FROM demo_data_registry').run();
  });

  tx();

  return {
    removed,
    skippedAdministrators,
    totalRemoved: Object.values(removed).reduce((a, b) => a + b, 0),
  };
}
