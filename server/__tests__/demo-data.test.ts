/**
 * 演示数据播种与清理的测试（DEMO-SEED-01）
 *
 * 重点不在"能不能造出数据"，而在**清理的精确作用域**：
 * 只删登记过的行，真实数据与管理员账号必须毫发无损。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  seedDemoData,
  cleanupDemoData,
  getDemoDataStatus,
  DEMO_IDS,
  DEMO_TEACHER,
} from '../services/demo-data.js';

/** 最小可用 schema —— 覆盖播种与清理触及的全部表。 */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, role TEXT, name TEXT, created_at INTEGER, status TEXT);
    CREATE TABLE lessons (id TEXT PRIMARY KEY, title TEXT, content TEXT, timeline TEXT, progress_mode TEXT, created_at INTEGER, updated_at INTEGER, creator_id TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, name TEXT, description TEXT, class_passcode TEXT, class_passcode_expires_at INTEGER, created_at INTEGER);
    CREATE TABLE students (id TEXT PRIMARY KEY, student_number TEXT UNIQUE, name TEXT, email TEXT, created_at INTEGER);
    CREATE TABLE class_students (class_id TEXT, student_id TEXT, joined_at INTEGER, PRIMARY KEY(class_id,student_id));
    CREATE TABLE schedules (id TEXT PRIMARY KEY, class_id TEXT, lesson_id TEXT, scheduled_date TEXT, time_slot TEXT, status TEXT, notes TEXT, created_at INTEGER);
  `);
  return db;
}

/** 预置"真实数据"，用于验证不被误伤。 */
function seedRealData(db: Database.Database): void {
  db.prepare(
    `INSERT INTO users VALUES ('usr_admin','admin','x','administrator','系统管理员',1,'active')`,
  ).run();
  db.prepare(
    `INSERT INTO users VALUES ('usr_t1','teacher','x','teacher','真实教师',1,'active')`,
  ).run();
  db.prepare(
    `INSERT INTO lessons VALUES ('real-lesson','真实课程','{}',NULL,'manual',1,1,NULL)`,
  ).run();
  db.prepare(`INSERT INTO students VALUES ('real-stu','S999','真实学生','r@x.com',1)`).run();
  db.prepare(`INSERT INTO classes VALUES ('real-class','真实班级','d','9999',NULL,1)`).run();
  db.prepare(
    `INSERT INTO schedules VALUES ('real-sch','real-class','real-lesson','2026-01-01 09:00:00','第1节','scheduled','',1)`,
  ).run();
}

let db: any;

beforeEach(() => {
  db = makeDb();
  seedRealData(db);
});

describe('演示数据 · 播种', () => {
  it('创建课程 / 班级 / 学生 / 教师 / 课表', () => {
    const s = seedDemoData(db);
    expect(s.seeded).toBe(true);
    expect(s.counts.lesson).toBe(1);
    expect(s.counts.class).toBe(2);
    expect(s.counts.student).toBe(12);
    expect(s.counts.user).toBe(1);
    expect(s.counts.schedule).toBe(1);
    expect(s.counts.class_student).toBe(12);
  });

  it('演示教师是可登录的 teacher 账号，且密码可用 bcrypt 校验', async () => {
    seedDemoData(db);
    const { verifyPassword } = await import('../../packages/core/db/index.js');
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(DEMO_TEACHER.username) as {
      password_hash: string;
      role: string;
    };
    expect(row.role).toBe('teacher');
    expect(verifyPassword(DEMO_TEACHER.password, row.password_hash).valid).toBe(true);
  });

  it('不创建也不修改任何 administrator 账号', () => {
    seedDemoData(db);
    const admins = db.prepare(`SELECT id FROM users WHERE role='administrator'`).all();
    expect(admins).toHaveLength(1);
    expect((admins[0] as { id: string }).id).toBe('usr_admin');
  });

  it('两个班级都分到了学生', () => {
    seedDemoData(db);
    const per = db
      .prepare('SELECT class_id, COUNT(*) n FROM class_students GROUP BY class_id')
      .all() as { class_id: string; n: number }[];
    expect(per).toHaveLength(2);
    for (const c of per) expect(c.n).toBeGreaterThan(0);
  });

  it('课表指向演示课程与演示班级', () => {
    seedDemoData(db);
    const sch = db.prepare('SELECT * FROM schedules WHERE id = ?').get(DEMO_IDS.schedule) as {
      lesson_id: string;
      class_id: string;
    };
    expect(sch.lesson_id).toBe(DEMO_IDS.lesson);
    expect([DEMO_IDS.primaryClass, DEMO_IDS.secondaryClass]).toContain(sch.class_id);
  });

  it('学号使用 DEMO- 前缀，不与真实学号命名空间冲突', () => {
    seedDemoData(db);
    const nums = db.prepare('SELECT student_number FROM students WHERE id LIKE ?').all('demo-stu-%') as {
      student_number: string;
    }[];
    expect(nums.length).toBe(12);
    for (const n of nums) expect(n.student_number).toMatch(/^DEMO-S\d{2}$/);
  });
});

describe('演示数据 · 播种幂等', () => {
  it('重复播种不产生第二份数据', () => {
    const a = seedDemoData(db);
    const b = seedDemoData(db);
    expect(b.total).toBe(a.total);
    expect(db.prepare('SELECT COUNT(*) n FROM students').get().n).toBe(1 + 12); // 1 真实 + 12 演示
    expect(db.prepare('SELECT COUNT(*) n FROM classes').get().n).toBe(1 + 2);
    expect(db.prepare('SELECT COUNT(*) n FROM lessons').get().n).toBe(1 + 1);
  });

  it('重复播种后关联表不重复', () => {
    seedDemoData(db);
    seedDemoData(db);
    expect(db.prepare('SELECT COUNT(*) n FROM class_students').get().n).toBe(12);
  });
});

describe('演示数据 · 清理的精确作用域', () => {
  it('只删除登记过的演示数据，真实数据与管理员账号毫发无损', () => {
    seedDemoData(db);
    const report = cleanupDemoData(db);

    expect(report.totalRemoved).toBe(29);
    expect(report.skippedAdministrators).toBe(0);

    // 真实数据全部存活
    expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(2); // admin + 真实教师
    expect(db.prepare('SELECT COUNT(*) n FROM lessons').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM students').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM classes').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) n FROM schedules').get().n).toBe(1);

    // 管理员账号未被删除
    expect(
      db.prepare(`SELECT id FROM users WHERE username='admin'`).get(),
    ).toBeTruthy();
    // 真实教师也未被删除
    expect(
      db.prepare(`SELECT id FROM users WHERE username='teacher'`).get(),
    ).toBeTruthy();
  });

  it('清理后登记表为空，可再次播种', () => {
    seedDemoData(db);
    cleanupDemoData(db);
    expect(getDemoDataStatus(db).total).toBe(0);

    const again = seedDemoData(db);
    expect(again.seeded).toBe(true);
    expect(again.total).toBe(29);
  });

  it('未播种时清理是安全的空操作', () => {
    const report = cleanupDemoData(db);
    expect(report.totalRemoved).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(2);
  });

  it('播种 → 清理 → 播种 循环后，真实数据仍然完好', () => {
    for (let i = 0; i < 3; i++) {
      seedDemoData(db);
      cleanupDemoData(db);
    }
    expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(2);
    expect(db.prepare('SELECT COUNT(*) n FROM students').get().n).toBe(1);
    expect(db.prepare('SELECT id FROM users WHERE role=\'administrator\'').get()).toBeTruthy();
  });
});

describe('演示数据 · 管理员账号硬保护', () => {
  it('即使有人把管理员账号登记进表，清理也会跳过它', () => {
    seedDemoData(db);
    // 人为把管理员登记为演示数据（模拟登记表被污染的极端情况）
    db.prepare(
      'INSERT OR REPLACE INTO demo_data_registry (entity_type, entity_id, created_at) VALUES (?,?,?)',
    ).run('user', 'usr_admin', Date.now());

    const report = cleanupDemoData(db);

    expect(report.skippedAdministrators).toBe(1);
    expect(db.prepare(`SELECT id FROM users WHERE username='admin'`).get()).toBeTruthy();
  });
});

describe('演示数据 · 状态查询', () => {
  it('未播种时 seeded=false', () => {
    const s = getDemoDataStatus(db);
    expect(s.seeded).toBe(false);
    expect(s.total).toBe(0);
    expect(s.seededAt).toBeNull();
    expect(s.demoTeacherExists).toBe(false);
  });

  it('播种后返回各类数量与播种时间', () => {
    seedDemoData(db);
    const s = getDemoDataStatus(db);
    expect(s.seeded).toBe(true);
    expect(s.seededAt).toBeGreaterThan(0);
    expect(s.demoTeacherExists).toBe(true);
    expect(s.demo.classIds).toHaveLength(2);
    expect(s.demo.studentIds).toHaveLength(12);
  });
});

describe('演示数据 · 旧版播种器残留的升级场景', () => {
  /** 旧版 `/api/admin/seed-demo` 留下的数据：确定性 ID 相同，但**没有登记表**。 */
  function seedLegacyDemo(db: Database.Database): void {
    db.prepare(
      `INSERT INTO classes VALUES ('demo-class','人工智能与创意编程示范班','旧版','4466',NULL,1)`,
    ).run();
    for (let i = 1; i <= 5; i++) {
      db.prepare(`INSERT INTO students VALUES (?,?,?,null,1)`).run(
        `demo-s${i}`,
        `S00${i}`,
        ['小明', '小红', '小华', '小丽', '小强'][i - 1],
      );
      db.prepare('INSERT INTO class_students VALUES (?,?,?)').run('demo-class', `demo-s${i}`, 1);
    }
    db.prepare('INSERT INTO schedules VALUES (?,?,?,?,?,?,?,?)').run(
      'demo-schedule', 'demo-class', 'real-lesson', '2026-01-01 09:00:00', null, 'scheduled', '', 1,
    );
  }

  it('旧残留 + 真实数据共存时，播种成功且不撞主键', () => {
    seedLegacyDemo(db);
    const s = seedDemoData(db);
    expect(s.seeded).toBe(true);
    expect(s.counts.class).toBe(2);
    expect(s.counts.student).toBe(12);
  });

  it('清理后旧残留一并消失，真实数据仍存活', () => {
    seedLegacyDemo(db);
    seedDemoData(db);
    cleanupDemoData(db);

    expect(db.prepare('SELECT COUNT(*) n FROM classes').get().n).toBe(1); // 仅真实班级
    expect(db.prepare(`SELECT id FROM classes WHERE id='real-class'`).get()).toBeTruthy();
    // 旧播种器注册的 5 个 demo-s* 学生不再残留
    expect(db.prepare(`SELECT COUNT(*) n FROM students WHERE id LIKE 'demo-s%'`).get().n).toBe(0);
    // 真实学生 S999 保留
    expect(db.prepare(`SELECT id FROM students WHERE id='real-stu'`).get()).toBeTruthy();
  });
});
