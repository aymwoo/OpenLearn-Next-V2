import { describe, it, expect, beforeAll } from 'vitest';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { ensureTestSchema } from '../../__tests__/helpers/test-schema.js';
import {
  ClassroomSessionService,
  buildSessionOwnershipClause,
  normalizeSessionPagination,
} from '../classroom-session-service.js';

/**
 * ClassroomSessionService（#427 第一阶段）：只读会话查询的服务层回归。
 *
 * 重点锁死两件事：
 *   1. 会话列表与活跃会话共用同一套归属裁剪 SQL（此前各写一遍，容易漂移）；
 *   2. 分页 / 状态筛选 / 互动统计的口径与迁移前完全一致。
 */
describe('ClassroomSessionService', () => {
  const db = kernelContainer.db as unknown as Database.Database;
  const service = new ClassroomSessionService(db);

  const teacherA = 'usr-css427-a';
  const teacherB = 'usr-css427-b';
  const lessonA = 'les-css427-a';
  const lessonB = 'les-css427-b';
  const lessonLegacy = 'les-css427-legacy';
  const classA = 'cls-css427-a';
  const classB = 'cls-css427-b';
  const classLegacy = 'cls-css427-legacy';

  const sessionA = 'cs-css427-a';
  const sessionArchived = 'cs-css427-archived';
  const sessionB = 'cs-css427-b';
  const sessionLegacy = 'cs-css427-legacy';

  const now = Date.now();

  beforeAll(() => {
    ensureTestSchema();

    const insertLesson = db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    insertLesson.run(lessonA, '服务层测试 A 课节', teacherA, now, now);
    insertLesson.run(lessonB, '服务层测试 B 课节', teacherB, now, now);
    insertLesson.run(lessonLegacy, '服务层测试遗留课节', null, now, now);

    const insertClass = db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)',
    );
    insertClass.run(classA, '服务层测试 A 班', teacherA, now);
    insertClass.run(classB, '服务层测试 B 班', teacherB, now);
    insertClass.run(classLegacy, '服务层测试遗留班', null, now);

    const insertSession = db.prepare(
      `INSERT OR REPLACE INTO classroom_sessions
         (id, lesson_id, class_id, teacher_id, stage, teaching_mode_id, checkin_code, started_at, ended_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertSession.run(
      sessionA,
      lessonA,
      classA,
      teacherA,
      'IN_CLASS_TEACHING',
      'inquiry',
      '1111',
      now - 1000,
      null,
      now - 1000,
    );
    insertSession.run(
      sessionArchived,
      lessonA,
      classA,
      teacherA,
      'ARCHIVED_REPORT',
      'lecture',
      '2222',
      now - 3000,
      now - 2000,
      now - 3000,
    );
    insertSession.run(
      sessionB,
      lessonB,
      classB,
      teacherB,
      'IN_CLASS_TEACHING',
      'drill',
      '3333',
      now - 2000,
      null,
      now - 2000,
    );
    // 历史会话：teacher / 班级 owner / 课节 creator 全为空，应保留给所有教师可见。
    insertSession.run(
      sessionLegacy,
      lessonLegacy,
      classLegacy,
      'teacher',
      'IN_CLASS_TEACHING',
      null,
      null,
      now - 5000,
      null,
      now - 5000,
    );

    // 互动统计：A 会话 2 次投票 / 1 张通票 / 3 条信息流。
    const insertPoll = db.prepare(
      'INSERT OR REPLACE INTO classroom_quick_polls (id, session_id, lesson_id, question_type, options_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertPoll.run('poll-css427-1', sessionA, lessonA, 'ABCD', '["A","B"]', now);
    insertPoll.run('poll-css427-2', sessionA, lessonA, 'ABCD', '["A","B"]', now);

    db.prepare(
      'INSERT OR REPLACE INTO classroom_exit_tickets (id, session_id, lesson_id, student_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('ticket-css427-1', sessionA, lessonA, 'stu-css427', now);

    const insertFeed = db.prepare(
      'INSERT OR REPLACE INTO classroom_feed (id, session_id, lesson_id, type, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (let i = 0; i < 3; i++) {
      insertFeed.run('feed-css427-' + i, sessionA, lessonA, 'info', '测试动态', now + i);
    }
  });

  it('归一化分页参数：all 视为 1000，普通值限制在 1..100', () => {
    expect(normalizeSessionPagination(1, 'all')).toEqual({ page: 1, pageSize: 1000, offset: 0 });
    expect(normalizeSessionPagination(3, 'all')).toEqual({ page: 3, pageSize: 1000, offset: 2000 });
    expect(normalizeSessionPagination(0, 0)).toEqual({ page: 1, pageSize: 20, offset: 0 });
    expect(normalizeSessionPagination(2, 500)).toEqual({ page: 2, pageSize: 100, offset: 100 });
  });

  it('归属裁剪 SQL：管理员不裁剪、无令牌为 1=0、令牌会按三个位置展开', () => {
    expect(buildSessionOwnershipClause({ isAdmin: true, tokens: [] }).clause).toBeNull();

    const anonymous = buildSessionOwnershipClause({ isAdmin: false, tokens: [] });
    expect(anonymous.clause).toBe('1 = 0');
    expect(anonymous.params).toEqual([]);

    const scoped = buildSessionOwnershipClause({ isAdmin: false, tokens: ['u1', 'u2'] }, 's');
    expect(scoped.clause).toContain('s.teacher_id IN (?,?)');
    expect(scoped.clause).toContain('c.owner_user_id IN (?,?)');
    expect(scoped.clause).toContain('l.creator_id IN (?,?)');
    expect(scoped.params).toEqual(['u1', 'u2', 'u1', 'u2', 'u1', 'u2']);
  });

  it('管理员按课节筛选可见全部会话，并按状态区分活跃/归档', () => {
    const all = service.listSessions({
      filters: { lessonId: lessonA },
      actor: { isAdmin: true, tokens: [] },
    });
    expect(all.total).toBe(2);
    expect(all.items.map((i) => i.id).sort()).toEqual([sessionA, sessionArchived].sort());

    const archived = service.listSessions({
      filters: { lessonId: lessonA, status: 'archived' },
      actor: { isAdmin: true, tokens: [] },
    });
    expect(archived.total).toBe(1);
    expect(archived.items[0].id).toBe(sessionArchived);

    const active = service.listSessions({
      filters: { lessonId: lessonA, status: 'active' },
      actor: { isAdmin: true, tokens: [] },
    });
    expect(active.total).toBe(1);
    expect(active.items[0].id).toBe(sessionA);
  });

  it('非管理员只能看到自己归属的会话，看不到同课节下别人的会话', () => {
    const own = service.listSessions({
      filters: { lessonId: lessonA },
      actor: { isAdmin: false, tokens: [teacherA, 'teacher_a'] },
    });
    expect(own.total).toBe(2);

    const cross = service.listSessions({
      filters: { lessonId: lessonA },
      actor: { isAdmin: false, tokens: [teacherB] },
    });
    expect(cross.total).toBe(0);
    expect(cross.items).toEqual([]);
  });

  it('无人归属的历史会话对所有教师可见（保持旧语义，避免老数据消失）', () => {
    const legacy = service.listSessions({
      filters: { lessonId: lessonLegacy },
      actor: { isAdmin: false, tokens: [teacherB] },
    });
    expect(legacy.total).toBe(1);
    expect(legacy.items[0].id).toBe(sessionLegacy);
  });

  it('没有可用归属令牌的调用方看不到任何会话', () => {
    const none = service.listSessions({
      filters: { lessonId: lessonA },
      actor: { isAdmin: false, tokens: [] },
    });
    expect(none.total).toBe(0);
    expect(none.items).toEqual([]);
  });

  it('列表项聚合互动计数与教学模式展示名', () => {
    const result = service.listSessions({
      filters: { lessonId: lessonA, status: 'active' },
      actor: { isAdmin: true, tokens: [] },
    });
    const item = result.items.find((i) => i.id === sessionA);
    expect(item).toBeDefined();
    expect(item!.stats).toEqual({ pollCount: 2, exitTicketCount: 1, feedCount: 3 });
    expect(item!.teachingModeId).toBe('inquiry');
    expect(item!.teachingModeName).toBe('探究式');
    expect(item!.lessonTitle).toBe('服务层测试 A 课节');
    expect(item!.className).toBe('服务层测试 A 班');
  });

  it('分页返回 totalPages，页大小受上限保护', () => {
    const page1 = service.listSessions({
      filters: { lessonId: lessonA },
      actor: { isAdmin: true, tokens: [] },
      page: 1,
      pageSize: 1,
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.totalPages).toBe(2);
  });

  it('活跃会话排除归档阶段，并遵守归属裁剪', () => {
    const adminRows = service.listActiveSessions({ isAdmin: true, tokens: [] });
    const adminIds = adminRows.map((row) => row.id);
    expect(adminIds).toContain(sessionA);
    expect(adminIds).not.toContain(sessionArchived);

    const bRows = service.listActiveSessions({ isAdmin: false, tokens: [teacherB] });
    const bIds = bRows.map((row) => row.id);
    expect(bIds).toContain(sessionB);
    expect(bIds).not.toContain(sessionA);

    // 投影为显式列：不得下发签到码与设置原文（Issue #241）。
    for (const row of adminRows) {
      expect('checkin_code' in row).toBe(false);
      expect('settings_json' in row).toBe(false);
    }
  });
});
