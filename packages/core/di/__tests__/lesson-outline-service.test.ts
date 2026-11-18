/**
 * 课节标题只读：允许、拒绝、课节不存在。
 * 可见性走 canSeeLesson，与 GET /api/lessons/:id 同一口径。
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandBus } from '../../command-bus/index.js';
import { EventBus } from '../../event-bus/index.js';
import { LessonOutlineAccessError, LessonOutlineService } from '../lesson-outline-service.js';
import { lessonViewerFromActorId, runWithLessonViewer, setLessonViewerResolver } from '../lesson-viewer.js';

const TIMELINE = JSON.stringify([
  { id: 'seg-1', title: '导入', duration: '5m', notes: '不要泄露' },
  { id: 'seg-2', title: '实验' },
  { noise: true },
]);

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      timeline TEXT,
      creator_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE classes (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE schedules (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE classroom_sessions (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE class_students (class_id TEXT, student_id TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, role TEXT);
  `);
  db.prepare(
    `INSERT INTO lessons (id, title, content, timeline, creator_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('les-1', '牛顿第一定律', '机密正文', TIMELINE, 'teacher-a', 1, 1);
  db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)').run('teacher-a', 'alice', 'teacher');
  db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)').run('teacher-b', 'bob', 'teacher');
  return db;
}

describe('LessonOutlineService', () => {
  let db: Database.Database;
  let service: LessonOutlineService;

  beforeEach(() => {
    db = createDb();
    service = new LessonOutlineService(db);
    setLessonViewerResolver((actorId) => lessonViewerFromActorId(db, actorId));
  });

  afterEach(() => {
    setLessonViewerResolver(() => null);
    db.close();
  });

  it('当前用户可见时返回标题和环节标题，不返回正文', async () => {
    const outline = await runWithLessonViewer({ userId: 'teacher-a', username: 'alice', role: 'teacher' }, () =>
      service.getOutline('les-1'),
    );

    expect(outline).toEqual({
      id: 'les-1',
      title: '牛顿第一定律',
      segments: [
        { id: 'seg-1', title: '导入' },
        { id: 'seg-2', title: '实验' },
      ],
    });
    expect(JSON.stringify(outline)).not.toContain('机密正文');
    expect(JSON.stringify(outline)).not.toContain('不要泄露');
  });

  it('课节存在但当前用户看不见时拒绝，且错误不含标题', async () => {
    await expect(
      runWithLessonViewer({ userId: 'teacher-b', username: 'bob', role: 'teacher' }, () => service.getOutline('les-1')),
    ).rejects.toMatchObject({ name: 'LessonOutlineAccessError', reason: 'forbidden', status: 403 });
  });

  it('课节不存在时返回 null', async () => {
    const outline = await runWithLessonViewer(
      { userId: 'admin', role: 'administrator', subRole: 'administrator' },
      () => service.getOutline('missing'),
    );
    expect(outline).toBeNull();
  });

  it('没有登录用户时拒绝，即使课节存在', async () => {
    await expect(service.getOutline('les-1')).rejects.toBeInstanceOf(LessonOutlineAccessError);
    await expect(service.getOutline('les-1')).rejects.toMatchObject({ reason: 'no_viewer' });
  });

  it('损坏的 timeline 得到空环节列表，标题仍返回', async () => {
    db.prepare('UPDATE lessons SET timeline = ? WHERE id = ?').run('not-json', 'les-1');
    const outline = await runWithLessonViewer({ userId: 'teacher-a', username: 'alice', role: 'teacher' }, () =>
      service.getOutline('les-1'),
    );
    expect(outline?.segments).toEqual([]);
    expect(outline?.title).toBe('牛顿第一定律');
  });

  it('user: actor 的命令执行期间按该用户过滤，插件 actor 不能自带身份', async () => {
    const bus = new CommandBus(new EventBus());
    bus.registerHandler('ext.outline', {
      async execute() {
        return service.getOutline('les-1');
      },
    });

    const allowed = await bus.execute(bus.createCommand('ext.outline', {}, 'user:teacher-a:teacher'));
    expect(allowed).toMatchObject({ title: '牛顿第一定律' });

    await expect(bus.execute(bus.createCommand('ext.outline', {}, 'user:teacher-b:teacher'))).rejects.toMatchObject({
      reason: 'forbidden',
    });

    await expect(bus.execute(bus.createCommand('ext.outline', {}, 'plugin:ext-demo'))).rejects.toMatchObject({
      reason: 'no_viewer',
    });
  });
});
