/**
 * 演示数据播种与清理的测试（DEMO-SEED-01 / v2）
 *
 * 重点不在"能不能造出数据"，而在**清理的精确作用域**：
 * 只删登记过的行，真实数据与管理员账号必须毫发无损。
 *
 * v2 起测试库直接跑 migrations/ 全量迁移建 schema（与生产库同构），
 * 这样白板元素 / 学案活动 / Surface / 测评等新表的写入也会被验证。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMigrationsFromDirectory, executeSqlStatements } from '../../packages/core/db/migrator.js';
import {
  seedDemoData,
  cleanupDemoData,
  getDemoDataStatus,
  DEMO_IDS,
  DEMO_TEACHER,
  DEMO_TEACHER_B,
} from '../services/demo-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 与生产库同构的内存库：跑完 80 个迁移。 */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  const migrations = loadMigrationsFromDirectory(path.join(ROOT, 'migrations'));
  for (const m of migrations) executeSqlStatements(db, m.up);
  return db;
}

/** 预置"真实数据"，用于验证不被误伤。 */
function seedRealData(db: Database.Database): void {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, created_at, status) VALUES ('usr_admin','admin','x','administrator','系统管理员',1,'active')`,
  ).run();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, name, created_at, status) VALUES ('usr_t1','teacher','x','teacher','真实教师',1,'active')`,
  ).run();
  db.prepare(
    `INSERT INTO lessons (id, title, content, created_at, updated_at) VALUES ('real-lesson','真实课程','{}',1,1)`,
  ).run();
  db.prepare(
    `INSERT INTO students (id, student_number, name, created_at) VALUES ('real-stu','S999','真实学生',1)`,
  ).run();
  db.prepare(`INSERT INTO classes (id, name, created_at) VALUES ('real-class','真实班级',1)`).run();
  db.prepare(
    `INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES ('real-sch','real-class','real-lesson','2026-01-01 09:00:00',1)`,
  ).run();
}

let db: Database.Database;

/** better-sqlite3 的 .get() 返回 unknown，测试里统一在此断言计数形状。 */
const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;

beforeEach(() => {
  db = makeDb();
  seedRealData(db);
});

describe('演示数据 · 播种', () => {
  it('铺好账号 / 机房 / 班级 / 学生 / 课程 / 课表全矩阵', () => {
    const s = seedDemoData(db);
    expect(s.seeded).toBe(true);
    expect(s.counts.user).toBe(2);
    expect(s.counts.lab).toBe(2);
    expect(s.counts.class).toBe(3);
    expect(s.counts.student).toBe(24);
    expect(s.counts.class_student).toBe(24);
    expect(s.counts.seat).toBe(24);
    expect(s.counts.group).toBe(6);
    expect(s.counts.lesson).toBe(4);
    expect(s.counts.schedule).toBe(8);
    expect(s.total).toBeGreaterThan(250);
  });

  it('两位教师都是可登录的 teacher 账号，密码可用 bcrypt 校验', async () => {
    seedDemoData(db);
    const { verifyPassword } = await import('../../packages/core/db/index.js');
    for (const t of [DEMO_TEACHER, DEMO_TEACHER_B]) {
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(t.username) as {
        password_hash: string;
        role: string;
      };
      expect(row.role).toBe('teacher');
      expect(verifyPassword(t.password, row.password_hash).valid).toBe(true);
    }
  });

  it('学生也设置了统一登录密码（bcrypt），学号用 DEMO- 前缀', async () => {
    seedDemoData(db);
    const { verifyPassword } = await import('../../packages/core/db/index.js');
    const rows = db.prepare("SELECT student_number, password FROM students WHERE id LIKE 'demo-stu-%'").all() as {
      student_number: string;
      password: string;
    }[];
    expect(rows).toHaveLength(24);
    for (const r of rows) {
      expect(r.student_number).toMatch(/^DEMO-S\d{2}$/);
      expect(verifyPassword(DEMO_TEACHER.password, r.password).valid).toBe(true);
    }
  });

  it('机房座位按班级绑定且不重叠', () => {
    seedDemoData(db);
    const seats = db.prepare('SELECT class_id, student_id, lab_id, row_idx, col_idx FROM student_seats').all() as {
      class_id: string;
      lab_id: string;
      row_idx: number;
      col_idx: number;
    }[];
    expect(seats).toHaveLength(24);
    const keys = new Set(seats.map((s) => `${s.lab_id}:${s.row_idx}:${s.col_idx}`));
    expect(keys.size).toBe(24);
    const third = db
      .prepare('SELECT lab_id FROM student_seats WHERE class_id = ? LIMIT 1')
      .get(DEMO_IDS.thirdClass) as {
      lab_id: string;
    };
    expect(third.lab_id).toBe(DEMO_IDS.lab2);
  });

  it('两个班归主讲教师、一个班归协同教师', () => {
    seedDemoData(db);
    const rows = db.prepare('SELECT id, owner_user_id FROM classes WHERE id LIKE ? ORDER BY id').all('demo-class%') as {
      id: string;
      owner_user_id: string;
    }[];
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.owner_user_id === `usr_${DEMO_TEACHER.username}`)).toHaveLength(2);
    expect(rows.filter((r) => r.owner_user_id === `usr_${DEMO_TEACHER_B.username}`)).toHaveLength(1);
  });

  it('白板课与学案课交付模式正确（含内置学案模式包 ID）', () => {
    seedDemoData(db);
    const rows = db
      .prepare('SELECT id, delivery_mode, mode_pack_id, timeline FROM lessons WHERE id LIKE ?')
      .all('demo-lesson%') as {
      id: string;
      delivery_mode: string;
      mode_pack_id: string | null;
      timeline: string;
    }[];
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.delivery_mode === 'whiteboard')).toHaveLength(2);
    expect(rows.filter((r) => r.delivery_mode === 'xuean')).toHaveLength(2);
    for (const l of rows.filter((r) => r.delivery_mode === 'xuean')) {
      expect(l.mode_pack_id).toBe('@openlearn/mode-xuean');
    }
    for (const l of rows) expect(JSON.parse(l.timeline).length).toBeGreaterThanOrEqual(3);
  });

  it('五种白板环节与三种学案环节全部出现', () => {
    seedDemoData(db);
    const rows = db.prepare('SELECT timeline FROM lessons WHERE id LIKE ?').all('demo-lesson%') as {
      timeline: string;
    }[];
    const types = new Set<string>();
    for (const r of rows) for (const seg of JSON.parse(r.timeline) as { type: string }[]) types.add(seg.type);
    for (const t of ['intro', 'lecture', 'practice', 'quiz', 'summary', 'xuean:preview', 'xuean', 'xuean:drill']) {
      expect(types.has(t), `缺少环节类型 ${t}`).toBe(true);
    }
  });

  it('白板元素覆盖常用组件且 learning_surface 元素绑定了 Surface', () => {
    seedDemoData(db);
    const types = new Set(
      (
        db.prepare("SELECT type FROM whiteboard_elements WHERE lesson_id LIKE 'demo-lesson%'").all() as {
          type: string;
        }[]
      ).map((r) => r.type),
    );
    for (const t of [
      'presentation',
      'quiz',
      'rollcall',
      'timer',
      'assignment',
      'code-sandbox',
      'math-graph',
      'learning_surface',
    ]) {
      expect(types.has(t), `缺少白板组件 ${t}`).toBe(true);
    }
    const ls = db.prepare("SELECT id, data FROM whiteboard_elements WHERE type = 'learning_surface'").all() as {
      id: string;
      data: string;
    }[];
    expect(ls.length).toBeGreaterThan(0);
    for (const el of ls) {
      const { surfaceId } = JSON.parse(el.data) as { surfaceId?: string };
      expect(surfaceId).toBeTruthy();
      const surface = db.prepare('SELECT kind, content_ref_json FROM learning_surfaces WHERE id = ?').get(surfaceId) as
        { kind: string; content_ref_json: string } | undefined;
      expect(surface?.kind).toBe('whiteboard_element');
      expect(JSON.parse(surface!.content_ref_json).rendererId).toBeTruthy();
    }
  });

  it('学案活动覆盖 8 种类型，互动课件块绑定 lesson_block Surface', () => {
    seedDemoData(db);
    const types = new Set(
      (
        db.prepare('SELECT type FROM lesson_activities WHERE lesson_id LIKE ?').all('demo-lesson-xuean%') as {
          type: string;
        }[]
      ).map((r) => r.type),
    );
    for (const t of ['reading', 'submission', 'quiz', 'survey', 'discussion', 'courseware', 'scratch', 'form']) {
      expect(types.has(t), `缺少学案活动类型 ${t}`).toBe(true);
    }
    const cwBlock = db
      .prepare("SELECT id, surface_id FROM lesson_activity_blocks WHERE block_type = 'interactive_courseware' LIMIT 1")
      .get() as { id: string; surface_id: string };
    expect(cwBlock.surface_id).toBeTruthy();
    const surface = db.prepare('SELECT kind, owner_id FROM learning_surfaces WHERE id = ?').get(cwBlock.surface_id) as {
      kind: string;
      owner_id: string;
    };
    expect(surface.kind).toBe('lesson_block');
    expect(surface.owner_id).toBe(cwBlock.id);
  });

  it('作业含 coursewareUuid / activityId 去重键', () => {
    seedDemoData(db);
    const contents = (
      db.prepare("SELECT content FROM assignments WHERE id LIKE 'asg-cw-%' OR id LIKE 'xuean-activity:%'").all() as {
        content: string;
      }[]
    ).map((r) => JSON.parse(r.content) as Record<string, unknown>);
    expect(contents.some((c) => typeof c.coursewareUuid === 'string')).toBe(true);
    expect(contents.some((c) => typeof c.activityId === 'string')).toBe(true);
  });

  it('不创建也不修改任何 administrator 账号', () => {
    seedDemoData(db);
    const admins = db.prepare(`SELECT id FROM users WHERE role='administrator'`).all();
    expect(admins).toHaveLength(1);
    expect((admins[0] as { id: string }).id).toBe('usr_admin');
  });

  it('课表覆盖多个班级、多门课与三种状态', () => {
    seedDemoData(db);
    const rows = db.prepare('SELECT class_id, lesson_id, status FROM schedules WHERE id LIKE ?').all('demo-sch%') as {
      class_id: string;
      lesson_id: string;
      status: string;
    }[];
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.class_id)).size).toBe(3);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['scheduled', 'completed', 'cancelled']));
  });
});

describe('演示数据 · 播种幂等', () => {
  it('重复播种不产生第二份数据', () => {
    const a = seedDemoData(db);
    const b = seedDemoData(db);
    expect(b.total).toBe(a.total);
    expect(count('SELECT COUNT(*) n FROM students')).toBe(1 + 24);
    expect(count('SELECT COUNT(*) n FROM classes')).toBe(1 + 3);
    expect(count('SELECT COUNT(*) n FROM lessons')).toBe(1 + 4);
  });

  it('重复播种后关联表不重复', () => {
    seedDemoData(db);
    seedDemoData(db);
    expect(count('SELECT COUNT(*) n FROM class_students')).toBe(24);
    expect(count('SELECT COUNT(*) n FROM learning_surfaces')).toBe(7);
  });
});

describe('演示数据 · 清理的精确作用域', () => {
  it('只删除登记过的演示数据，真实数据与管理员账号毫发无损', () => {
    seedDemoData(db);
    const report = cleanupDemoData(db);

    expect(report.totalRemoved).toBe(278);
    expect(report.skippedAdministrators).toBe(0);

    expect(count('SELECT COUNT(*) n FROM users')).toBe(2); // admin + 真实教师
    expect(count('SELECT COUNT(*) n FROM lessons')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM students')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM classes')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM schedules')).toBe(1);
    for (const t of [
      'whiteboard_elements',
      'lesson_activities',
      'lesson_activity_blocks',
      'learning_surfaces',
      'learning_surface_attempts',
      'assignments',
      'assessment_attempts',
      'computer_labs',
      'student_seats',
      'class_groups',
      'attendance',
      'student_point_logs',
      'demo_data_registry',
    ]) {
      expect(count(`SELECT COUNT(*) n FROM ${t}`), `${t} 未清空`).toBe(0);
    }

    expect(db.prepare(`SELECT id FROM users WHERE username='admin'`).get()).toBeTruthy();
    expect(db.prepare(`SELECT id FROM users WHERE username='teacher'`).get()).toBeTruthy();
  });

  it('清理后登记表为空，可再次播种', () => {
    seedDemoData(db);
    cleanupDemoData(db);
    expect(getDemoDataStatus(db).total).toBe(0);

    const again = seedDemoData(db);
    expect(again.seeded).toBe(true);
    expect(again.total).toBe(278);
  });

  it('未播种时清理是安全的空操作', () => {
    const report = cleanupDemoData(db);
    expect(report.totalRemoved).toBe(0);
    expect(count('SELECT COUNT(*) n FROM users')).toBe(2);
  });

  it('播种 → 清理 → 播种 循环后，真实数据仍然完好', () => {
    for (let i = 0; i < 3; i++) {
      seedDemoData(db);
      cleanupDemoData(db);
    }
    expect(count('SELECT COUNT(*) n FROM users')).toBe(2);
    expect(count('SELECT COUNT(*) n FROM students')).toBe(1);
    expect(db.prepare("SELECT id FROM users WHERE role='administrator'").get()).toBeTruthy();
  });
});

describe('演示数据 · 管理员账号硬保护', () => {
  it('即使有人把管理员账号登记进表，清理也会跳过它', () => {
    seedDemoData(db);
    db.prepare('INSERT OR REPLACE INTO demo_data_registry (entity_type, entity_id, created_at) VALUES (?,?,?)').run(
      'user',
      'usr_admin',
      Date.now(),
    );
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

  it('播种后返回各类数量与演示资源清单', () => {
    seedDemoData(db);
    const s = getDemoDataStatus(db);
    expect(s.seeded).toBe(true);
    expect(s.seededAt).toBeGreaterThan(0);
    expect(s.demoTeacherExists).toBe(true);
    expect(s.demo.classIds).toHaveLength(3);
    expect(s.demo.studentIds).toHaveLength(24);
    expect(s.demo.lessonIds).toHaveLength(4);
    expect(s.demo.whiteboardLessonIds).toHaveLength(2);
    expect(s.demo.xueanLessonIds).toHaveLength(2);
    expect(s.demo.labIds).toHaveLength(2);
    expect(s.demo.scheduleIds).toHaveLength(8);
    expect(s.demo.teacherUsernames).toEqual([DEMO_TEACHER.username, DEMO_TEACHER_B.username]);
  });
});

describe('演示数据 · 旧版播种器残留的升级场景', () => {
  /** 旧版 `/api/admin/seed-demo` 留下的数据：确定性 ID 相同，但没有登记表。 */
  function seedLegacyDemo(db: Database.Database): void {
    db.prepare(`INSERT INTO classes (id, name, created_at) VALUES ('demo-class','人工智能与创意编程示范班',1)`).run();
    for (let i = 1; i <= 5; i++) {
      db.prepare(`INSERT INTO students (id, student_number, name, created_at) VALUES (?,?,?,1)`).run(
        `demo-s${i}`,
        `S00${i}`,
        ['小明', '小红', '小华', '小丽', '小强'][i - 1],
      );
      db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?,?,1)').run(
        'demo-class',
        `demo-s${i}`,
      );
    }
    db.prepare(
      `INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES ('demo-schedule','demo-class','real-lesson','2026-01-01 09:00:00',1)`,
    ).run();
  }

  it('旧残留 + 真实数据共存时，播种成功且不撞主键', () => {
    seedLegacyDemo(db);
    const s = seedDemoData(db);
    expect(s.seeded).toBe(true);
    expect(s.counts.class).toBe(3);
    expect(s.counts.student).toBe(24);
  });

  it('清理后旧残留一并消失，真实数据仍存活', () => {
    seedLegacyDemo(db);
    seedDemoData(db);
    cleanupDemoData(db);

    expect(count('SELECT COUNT(*) n FROM classes')).toBe(1);
    expect(db.prepare(`SELECT id FROM classes WHERE id='real-class'`).get()).toBeTruthy();
    expect(count(`SELECT COUNT(*) n FROM students WHERE id LIKE 'demo-s%'`)).toBe(0);
    expect(db.prepare(`SELECT id FROM students WHERE id='real-stu'`).get()).toBeTruthy();
  });
});
