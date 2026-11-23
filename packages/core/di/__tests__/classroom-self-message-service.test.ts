import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClassroomMessageService } from '../classroom-message-service.js';
import {
  ClassroomSelfMessageAccessError,
  ClassroomSelfMessageInputError,
  ClassroomSelfMessageService,
} from '../classroom-self-message-service.js';
import { runWithLessonViewer } from '../lesson-viewer.js';

const CHANNEL = 'ext:student-help';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE classroom_messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      msg_type TEXT NOT NULL,
      lesson_id TEXT,
      class_id TEXT,
      target_user_ids TEXT,
      sender_actor_id TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      sender_plugin_id TEXT,
      correlation_id TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      delivered_at INTEGER,
      acked_at INTEGER,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE classroom_message_receipts (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      acked_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE lessons (id TEXT PRIMARY KEY, title TEXT, timeline TEXT, creator_id TEXT);
    CREATE TABLE classes (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE class_students (class_id TEXT, student_id TEXT);
    CREATE TABLE schedules (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE classroom_sessions (id TEXT PRIMARY KEY, lesson_id TEXT, class_id TEXT);
    CREATE TABLE student_lesson_progress (student_id TEXT, lesson_id TEXT);
  `);
  db.prepare('INSERT INTO lessons (id, title, timeline) VALUES (?, ?, ?)').run('les-a', '课节 A', null);
  db.prepare('INSERT INTO lessons (id, title, timeline) VALUES (?, ?, ?)').run('les-b', '课节 B', null);
  db.prepare('INSERT INTO classes (id, owner_user_id) VALUES (?, ?)').run('cls-a', 'teacher-a');
  db.prepare('INSERT INTO classes (id, owner_user_id) VALUES (?, ?)').run('cls-b', 'teacher-b');
  db.prepare('INSERT INTO classes (id, owner_user_id) VALUES (?, ?)').run('cls-c', 'teacher-c');
  db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('cls-a', 'stu-a');
  db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('cls-a', 'stu-b');
  db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('cls-b', 'stu-c');
  // stu-a 同时在 cls-c，les-b 只挂 cls-c：用于覆盖 classId/lessonId 归属不一致。
  db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('cls-c', 'stu-a');
  db.prepare('INSERT INTO schedules (id, lesson_id, class_id) VALUES (?, ?, ?)').run('sch-a', 'les-a', 'cls-a');
  db.prepare('INSERT INTO schedules (id, lesson_id, class_id) VALUES (?, ?, ?)').run('sch-b', 'les-b', 'cls-c');
  return db;
}

describe('ClassroomSelfMessageService', () => {
  let db: Database.Database;
  let messages: ClassroomMessageService;
  let service: ClassroomSelfMessageService;

  beforeEach(() => {
    db = createDb();
    messages = new ClassroomMessageService(db as never);
    messages.registerChannel({
      name: CHANNEL,
      owner: 'ext-demo',
      shared: true,
      rolesAllowed: ['student'],
      requiredPayloadFields: ['kind'],
    });
    service = new ClassroomSelfMessageService(db, messages);
  });

  afterEach(() => db.close());

  it('学生以自己的 actor 发送消息，senderRole 为 student', async () => {
    const result = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.sendAsSelf(
        {
          channel: CHANNEL,
          msgType: 'request',
          classId: 'cls-a',
          payload: { kind: 'help' },
        },
        'ext-demo',
      ),
    );
    expect(result.ok).toBe(true);

    const row = db.prepare('SELECT sender_actor_id, sender_role, sender_plugin_id FROM classroom_messages').get() as {
      sender_actor_id: string;
      sender_role: string;
      sender_plugin_id: string;
    };
    expect(row).toMatchObject({
      sender_actor_id: 'user:stu-a:student',
      sender_role: 'student',
      sender_plugin_id: 'ext-demo',
    });
  });

  it('messageId 幂等：同载荷重发返回 duplicated', async () => {
    const input = {
      channel: CHANNEL,
      msgType: 'request' as const,
      classId: 'cls-a',
      payload: { kind: 'help' },
      messageId: 'msg-fixed-1',
    };
    const first = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.sendAsSelf(input, 'ext-demo'),
    );
    const second = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.sendAsSelf(input, 'ext-demo'),
    );
    expect(first.duplicated).toBe(false);
    expect(second).toMatchObject({ ok: true, duplicated: true, seq: first.seq });
  });

  it('非本班学生不能借班级发送；定向消息必须同班', () => {
    expect(() =>
      runWithLessonViewer({ userId: 'stu-c', studentId: 'stu-c', role: 'student' }, () =>
        service.sendAsSelf({ channel: CHANNEL, msgType: 'request', classId: 'cls-a', payload: { kind: 'help' } }),
      ),
    ).toThrow(ClassroomSelfMessageAccessError);

    expect(() =>
      runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
        service.sendAsSelf({
          channel: CHANNEL,
          msgType: 'request',
          classId: 'cls-a',
          targetUserIds: ['stu-c'],
          payload: { kind: 'help' },
        }),
      ),
    ).toThrow(ClassroomSelfMessageAccessError);
  });

  it('非法 targetUserIds 直接拒绝，不降级为广播', () => {
    expect(() =>
      runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
        service.sendAsSelf({
          channel: CHANNEL,
          msgType: 'request',
          classId: 'cls-a',
          targetUserIds: 'stu-b' as unknown as string[],
          payload: { kind: 'help' },
        }),
      ),
    ).toThrow(ClassroomSelfMessageInputError);

    expect(() =>
      runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
        service.sendAsSelf({
          channel: CHANNEL,
          msgType: 'request',
          classId: 'cls-a',
          targetUserIds: [123] as unknown as string[],
          payload: { kind: 'help' },
        }),
      ),
    ).toThrow(ClassroomSelfMessageInputError);

    expect(db.prepare('SELECT COUNT(*) AS c FROM classroom_messages').get() as { c: number }).toEqual({ c: 0 });
  });

  it('显式空数组沿用房间广播语义', async () => {
    const result = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.sendAsSelf({
        channel: CHANNEL,
        msgType: 'request',
        classId: 'cls-a',
        targetUserIds: [],
        payload: { kind: 'help' },
      }),
    );
    expect(result.ok).toBe(true);
    const row = db.prepare('SELECT target_user_ids FROM classroom_messages WHERE id = ?').get(result.messageId) as {
      target_user_ids: string | null;
    };
    expect(row.target_user_ids).toBeNull();
  });

  it('classId 与 lessonId 必须属于同一教学关系', async () => {
    expect(() =>
      runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
        service.sendAsSelf({
          channel: CHANNEL,
          msgType: 'request',
          classId: 'cls-a',
          lessonId: 'les-b',
          payload: { kind: 'help' },
        }),
      ),
    ).toThrow(ClassroomSelfMessageAccessError);

    const matched = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.sendAsSelf({
        channel: CHANNEL,
        msgType: 'request',
        classId: 'cls-c',
        lessonId: 'les-b',
        payload: { kind: 'help' },
      }),
    );
    expect(matched.ok).toBe(true);
  });

  it('教师与无登录用户不能使用 self 通道', () => {
    expect(() =>
      runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
        service.sendAsSelf({ channel: CHANNEL, msgType: 'request', classId: 'cls-a', payload: { kind: 'help' } }),
      ),
    ).toThrow(/Only a student session/);

    expect(() =>
      service.sendAsSelf({ channel: CHANNEL, msgType: 'request', classId: 'cls-a', payload: { kind: 'help' } }),
    ).toThrow(/signed-in student/);
  });

  it('channel 的 rolesAllowed 仍然生效', async () => {
    messages.registerChannel({ name: 'ext:teacher-only', owner: 'ext-demo', rolesAllowed: ['teacher'] });
    const result = await runWithLessonViewer({ userId: 'stu-a', studentId: 'stu-a', role: 'student' }, () =>
      service.sendAsSelf({
        channel: 'ext:teacher-only',
        msgType: 'request',
        classId: 'cls-a',
        payload: { kind: 'help' },
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'ROLE_NOT_ALLOWED' });
  });
});
