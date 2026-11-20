import { describe, it, expect, beforeEach, vi } from 'vitest';
import betterSqlite3 from 'better-sqlite3';
import { ClassroomMessageService, type MessageEventPublisher } from '../classroom-message-service.js';

describe('ClassroomMessageService — 可靠通道发送/ACK/补投', () => {
  let db: betterSqlite3.Database;
  let published: Array<{
    id: string;
    type: string;
    source: string;
    payload: Record<string, unknown>;
    timestamp: number;
    correlationId?: string;
  }>;
  let publisher: MessageEventPublisher;
  let service: ClassroomMessageService;

  beforeEach(() => {
    db = betterSqlite3(':memory:');
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
      CREATE INDEX idx_replay ON classroom_messages(lesson_id, seq);
    `);
    published = [];
    publisher = {
      publish: vi.fn(async (e) => {
        published.push(e);
      }),
    };
    service = new ClassroomMessageService(db, publisher);
    service.registerChannel({
      name: 'xuean:task',
      owner: 'ext-xuean',
      shared: true, // 测试里允许多个 senderRole/pluginId，避免每例单独登记
    });
  });

  const base = {
    channel: 'xuean:task',
    msgType: 'request' as const,
    lessonId: 'les-1',
    classId: 'cls-1',
    senderActorId: 'user:stu-1:student',
    senderRole: 'student',
    payload: { step: 2 },
  };

  it('send：落库（status=pending）+ 发 classroom.message 事件，seq 单调', () => {
    const r1 = service.send({ ...base, messageId: 'm1' });
    const r2 = service.send({ ...base, messageId: 'm2' });
    expect(r1.ok).toBe(true);
    expect(r2.seq).toBe(r1.seq! + 1);
    expect(published).toHaveLength(2);
    expect(published[0].type).toBe('classroom.message');
    expect(published[0].payload.messageId).toBe('m1');

    const row = db.prepare('SELECT status, payload FROM classroom_messages WHERE id = ?').get('m1') as {
      status: string;
      payload: string;
    };
    expect(row.status).toBe('pending');
    expect(JSON.parse(row.payload)).toEqual({ step: 2 });
  });

  it('幂等：同 messageId 重发不重复落库、不重复发事件', () => {
    const r1 = service.send({ ...base, messageId: 'm1' });
    const r2 = service.send({ ...base, messageId: 'm1' });
    expect(r2.duplicated).toBe(true);
    expect(r2.seq).toBe(r1.seq);
    expect(published).toHaveLength(1);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM classroom_messages').get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('ack 只让确认者自己离开补投，其他收件人仍能拉到广播', () => {
    service.send({ ...base, messageId: 'm1' });
    expect(service.ack('m1', 'stu-1')).toBe(true);
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-1' })).toHaveLength(0);
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-2' })).toHaveLength(1);
    expect(service.ack('m1', 'stu-2')).toBe(true);
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-2' })).toHaveLength(0);
  });

  it('非收件人不能确认定向消息', () => {
    service.send({ ...base, messageId: 'm1', targetUserIds: ['stu-1'] });
    expect(service.ack('m1', 'stu-2')).toBe(false);
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-1' })).toHaveLength(1);
  });

  it('同时给出课节和班级时，补投不串班', () => {
    service.send({ ...base, messageId: 'm1', classId: 'cls-1' });
    service.send({ ...base, messageId: 'm2', classId: 'cls-2' });
    const replay = service.replay({ lessonId: 'les-1', classId: 'cls-1', sinceSeq: 0, viewerId: 'stu-2' });
    expect(replay.map((m) => m.id)).toEqual(['m1']);
  });

  it('相同 messageId 但载荷不同视为冲突，不覆盖原消息', () => {
    service.send({ ...base, messageId: 'm1', payload: { step: 1 } });
    const conflict = service.send({ ...base, messageId: 'm1', payload: { step: 9 } });
    expect(conflict.ok).toBe(false);
    expect(conflict.code).toBe('MESSAGE_ID_CONFLICT');
  });

  it('补投按 seq 游标：只返回 sinceSeq 之后的消息', () => {
    const r1 = service.send({ ...base, messageId: 'm1' });
    service.send({ ...base, messageId: 'm2' });
    const replay = service.replay({ lessonId: 'les-1', sinceSeq: r1.seq!, viewerId: 'stu-2' });
    expect(replay).toHaveLength(1);
    expect(replay[0].id).toBe('m2');
    expect(replay[0].seq).toBeGreaterThan(r1.seq!);
  });

  it('目标用户过滤：定向消息只对指定用户可见', () => {
    service.send({ ...base, messageId: 'm1', targetUserIds: ['stu-1'] });
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-1' })).toHaveLength(1);
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-2' })).toHaveLength(0);
  });

  it('教师视角可补投定向消息（与实时投递收件人+班主任一致）', () => {
    service.send({ ...base, messageId: 'm1', targetUserIds: ['stu-1'] });
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'tea-1' })).toHaveLength(0);
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'tea-1', staffView: true })).toHaveLength(1);
  });

  it('replayPage：游标越过不可见消息，并正确报告 hasMore', () => {
    const hidden = service.send({ ...base, messageId: 'm1', targetUserIds: ['stu-2'] });
    service.send({ ...base, messageId: 'm2' });
    service.send({ ...base, messageId: 'm3' });

    // 第一批只扫到定向消息，对 stu-1 不可见；游标仍必须前进，不能卡在同一段。
    const first = service.replayPage({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-1', limit: 1 });
    expect(first.messages).toEqual([]);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBe(hidden.seq!);

    const second = service.replayPage({ lessonId: 'les-1', sinceSeq: first.cursor, viewerId: 'stu-1', limit: 1 });
    expect(second.messages.map((m) => m.id)).toEqual(['m2']);
    expect(second.hasMore).toBe(true);

    const third = service.replayPage({ lessonId: 'les-1', sinceSeq: second.cursor, viewerId: 'stu-1', limit: 1 });
    expect(third.messages.map((m) => m.id)).toEqual(['m3']);
    expect(third.hasMore).toBe(false);
  });

  it('过期消息不补投', () => {
    service.send({ ...base, messageId: 'm1', ttlMs: -1000 });
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-2' })).toHaveLength(0);
  });

  it('markDelivered 后仍可被补投查询命中（delivered 状态），但再次 mark 不重复', () => {
    service.send({ ...base, messageId: 'm1' });
    service.markDelivered('m1');
    const row = db.prepare('SELECT status FROM classroom_messages WHERE id = ?').get('m1') as { status: string };
    expect(row.status).toBe('delivered');
    expect(service.replay({ lessonId: 'les-1', sinceSeq: 0, viewerId: 'stu-2' })).toHaveLength(1);
  });
});

describe('ClassroomMessageService — channel 注册与归属校验（Q14=B）', () => {
  let db: betterSqlite3.Database;
  let service: ClassroomMessageService;

  beforeEach(() => {
    db = betterSqlite3(':memory:');
    db.exec(`
      CREATE TABLE classroom_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        channel TEXT NOT NULL, msg_type TEXT NOT NULL,
        lesson_id TEXT, class_id TEXT, target_user_ids TEXT,
        sender_actor_id TEXT NOT NULL, sender_role TEXT NOT NULL, sender_plugin_id TEXT,
        correlation_id TEXT, payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        delivered_at INTEGER, acked_at INTEGER, expires_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE classroom_message_receipts (
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        acked_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, user_id)
      );
    `);
    service = new ClassroomMessageService(db);
  });

  const send = (channel: string, pluginId?: string, role = 'student', payload: unknown = {}) =>
    service.send({
      channel,
      msgType: 'request',
      senderActorId: `user:${role}`,
      senderRole: role,
      senderPluginId: pluginId,
      payload,
    });

  it('未注册 channel 拒绝发送', () => {
    const r = send('ghost:channel', 'ext-x');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('CHANNEL_NOT_REGISTERED');
  });

  it('重复注册同 channel 被拒', () => {
    expect(service.registerChannel({ name: 'x:task', owner: 'ext-x' }).ok).toBe(true);
    expect(service.registerChannel({ name: 'x:task', owner: 'ext-y' })).toEqual({
      ok: false,
      code: 'CHANNEL_EXISTS',
      message: expect.stringContaining('已注册'),
    });
  });

  it('owner 不匹配拒绝；shared 通道允许多插件', () => {
    service.registerChannel({ name: 'x:private', owner: 'ext-x' });
    expect(send('x:private', 'ext-evil').code).toBe('CHANNEL_OWNER_MISMATCH');
    expect(send('x:private', 'ext-x').ok).toBe(true);

    service.registerChannel({ name: 'x:shared', owner: 'ext-x', shared: true });
    expect(send('x:shared', 'ext-y').ok).toBe(true);
  });

  it('rolesAllowed 校验', () => {
    service.registerChannel({ name: 'x:teacher', owner: 'ext-x', rolesAllowed: ['teacher'] });
    expect(send('x:teacher', 'ext-x', 'student').code).toBe('ROLE_NOT_ALLOWED');
    expect(send('x:teacher', 'ext-x', 'teacher').ok).toBe(true);
  });

  it('requiredPayloadFields 校验', () => {
    service.registerChannel({ name: 'x:graded', owner: 'ext-x', requiredPayloadFields: ['answer'] });
    expect(send('x:graded', 'ext-x', 'student', {}).code).toBe('PAYLOAD_INVALID');
    expect(send('x:graded', 'ext-x', 'student', { answer: 'A' }).ok).toBe(true);
  });

  it('clearOwner 按 owner 批量清理；清理后 channel 失效', () => {
    service.registerChannel({ name: 'x:a', owner: 'ext-x' });
    service.registerChannel({ name: 'x:b', owner: 'ext-x' });
    service.registerChannel({ name: 'y:c', owner: 'ext-y' });
    service.clearOwner('ext-x');
    expect(service.listChannels().map((c) => c.name)).toEqual(['y:c']);
    expect(send('x:a', 'ext-x').code).toBe('CHANNEL_NOT_REGISTERED');
  });
});
