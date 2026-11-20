/**
 * 通讯协议可靠通道服务（设计 Q10=C / Q11=B / Q12=B / Q13=C）。
 *
 * 职责：
 * - send()：Tier B 消息落 classroom_messages（seq 单调游标），并 publish
 *   'classroom.message' 事件交给 realtime bridge 投递；publish 失败进补偿队列。
 * - ack()：客户端确认收到，状态置 acked。
 * - replay()：断线补投查询——按 lesson_id + seq>cursor 扫未确认消息，
 *   并按 target_user_ids 过滤，只返回该学生有权看到的消息。
 *
 * Tier A（event/state）不经过本服务，直接走 eventBus → realtime bridge。
 */
import type { Database } from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { enqueueCompensation } from './credit-award-service.js';

export interface SendMessageInput {
  channel: string;
  msgType: 'request' | 'response';
  lessonId?: string | null;
  classId?: string | null;
  targetUserIds?: string[] | null;
  senderActorId: string;
  senderRole: string;
  senderPluginId?: string | null;
  correlationId?: string | null;
  payload: unknown;
  ttlMs?: number | null;
  /** 显式 messageId；缺省生成 uuid。用于幂等重发 */
  messageId?: string;
}

export type SendFailureCode =
  'CHANNEL_NOT_REGISTERED' | 'CHANNEL_OWNER_MISMATCH' | 'ROLE_NOT_ALLOWED' | 'PAYLOAD_INVALID' | 'MESSAGE_ID_CONFLICT';

export interface SendMessageResult {
  ok: boolean;
  /** 失败时给出原因；成功时 messageId/seq 有效 */
  code?: SendFailureCode;
  error?: string;
  messageId?: string;
  seq?: number;
  duplicated?: boolean;
}

export interface ReplayedMessage {
  seq: number;
  id: string;
  channel: string;
  msgType: string;
  correlationId: string | null;
  payload: unknown;
  status: string;
  createdAt: number;
}

export interface ReplayQuery {
  lessonId?: string | null;
  classId?: string | null;
  sinceSeq: number;
  /** 请求者 userId，用于 target_user_ids 过滤 */
  viewerId: string;
  /**
   * 教师/管理员视角：在已授权的课节或班级内，可补投定向消息
   * （与实时投递「收件人 + 班主任」保持一致）。
   */
  staffView?: boolean;
  limit?: number;
}

export interface ReplayPage {
  messages: ReplayedMessage[];
  /** 本轮扫描到的最大 seq；下次请求从这里继续，即使消息对当前用户不可见 */
  cursor: number;
  /** 是否还有下一批（按 limit 截断） */
  hasMore: boolean;
}

/** channel 注册描述符（Q14=B：归属 + 权限 + 格式校验） */
export interface ChannelDescriptor {
  /** 全局唯一，约定带命名空间前缀（如 xuean:task / official:quiz） */
  name: string;
  /** 拥有者插件 id；内置通道填 'official' */
  owner: string;
  /** 是否允许多插件协作共享该通道（共享时不做 owner 归属校验） */
  shared?: boolean;
  /** 允许发送的 senderRole 列表；空表示不限 */
  rolesAllowed?: string[];
  /** 载荷 JSON Schema（简化：仅校验 required 顶层字段存在） */
  requiredPayloadFields?: string[];
}

export type RegisterChannelResult =
  { ok: true } | { ok: false; code: 'INVALID_CHANNEL' | 'CHANNEL_EXISTS'; message: string };

/** 事件发布端口（复用内核 EventBus） */
export interface MessageEventPublisher {
  publish(event: {
    id: string;
    type: string;
    source: string;
    payload: unknown;
    timestamp: number;
    correlationId?: string;
  }): Promise<void>;
}

/** 补偿入队端口（失败投递进 pending_side_effects） */
export interface MessageSideEffectEnqueuer {
  enqueue(effect: {
    source: string;
    op: 'emitEvent';
    bizKey: string;
    payload: unknown;
    correlationId: string;
  }): void | Promise<void>;
}

interface MessageRow {
  seq: number;
  id: string;
  channel: string;
  msg_type: string;
  correlation_id: string | null;
  payload: string;
  status: string;
  target_user_ids: string | null;
  class_id: string | null;
  lesson_id: string | null;
  created_at: number;
}

export class ClassroomMessageService {
  /** channel 注册表（内存态，插件激活期注册，停用期由宿主 clearOwner） */
  private channels = new Map<string, ChannelDescriptor>();

  constructor(
    private db: Database,
    private publisher?: MessageEventPublisher,
    private enqueuer?: MessageSideEffectEnqueuer,
  ) {}

  /** 注册 channel。重复 name 拒绝；owner 须非空。 */
  registerChannel(desc: ChannelDescriptor): RegisterChannelResult {
    if (!desc?.name || !desc?.owner) {
      return { ok: false, code: 'INVALID_CHANNEL', message: 'channel name 与 owner 必填' };
    }
    if (this.channels.has(desc.name)) {
      return { ok: false, code: 'CHANNEL_EXISTS', message: `channel "${desc.name}" 已注册` };
    }
    this.channels.set(desc.name, { ...desc, shared: desc.shared ?? false });
    return { ok: true };
  }

  unregisterChannel(name: string, owner: string): boolean {
    const desc = this.channels.get(name);
    if (!desc || desc.owner !== owner) return false;
    return this.channels.delete(name);
  }

  /** 宿主在插件停用/卸载时按 owner 批量清理其注册的 channel */
  clearOwner(owner: string): void {
    for (const [name, desc] of this.channels) {
      if (desc.owner === owner) this.channels.delete(name);
    }
  }

  listChannels(): ReadonlyArray<ChannelDescriptor> {
    return Array.from(this.channels.values());
  }

  /** 发一条可靠消息：校验 channel → 幂等落库 → 事件发布 */
  send(input: SendMessageInput): SendMessageResult {
    // Q14=B：channel 归属/权限/格式校验
    const validation = this.validateSend(input);
    if (!validation.ok) return validation;

    const messageId = input.messageId || `msg_${uuidv7()}`;
    const now = Date.now();
    const expiresAt = input.ttlMs ? now + input.ttlMs : null;
    const targetJson =
      input.targetUserIds && input.targetUserIds.length > 0 ? JSON.stringify(input.targetUserIds) : null;

    //  INSERT OR IGNORE：messageId 唯一，重复发送取既有 seq
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO classroom_messages (
           id, channel, msg_type, lesson_id, class_id, target_user_ids,
           sender_actor_id, sender_role, sender_plugin_id, correlation_id,
           payload, status, attempts, expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
      )
      .run(
        messageId,
        input.channel,
        input.msgType,
        input.lessonId ?? null,
        input.classId ?? null,
        targetJson,
        input.senderActorId,
        input.senderRole,
        input.senderPluginId ?? null,
        input.correlationId ?? null,
        JSON.stringify(input.payload ?? {}),
        expiresAt,
        now,
        now,
      );

    if (info.changes === 0) {
      const existing = this.db
        .prepare('SELECT seq, channel, sender_actor_id, payload FROM classroom_messages WHERE id = ?')
        .get(messageId) as { seq: number; channel: string; sender_actor_id: string; payload: string } | undefined;
      if (
        !existing ||
        existing.channel !== input.channel ||
        existing.sender_actor_id !== input.senderActorId ||
        canonicalJson(this.safeParse(existing.payload)) !== canonicalJson(input.payload ?? {})
      ) {
        return { ok: false, code: 'MESSAGE_ID_CONFLICT', error: 'messageId 已被不同的消息占用' };
      }
      return { ok: true, messageId, seq: existing.seq, duplicated: true };
    }

    const row = this.db.prepare('SELECT seq FROM classroom_messages WHERE id = ?').get(messageId) as { seq: number };
    this.publishEvent(messageId, input, now);
    return { ok: true, messageId, seq: row.seq, duplicated: false };
  }

  /**
   * 收件人确认自己收到。回执按 (messageId, userId) 记录，不把整条消息标成已确认，
   * 因此一个学生的 ACK 不会停掉其他收件人的补投。非收件人返回 false。
   */
  ack(messageId: string, userId: string): boolean {
    if (!messageId || !userId) return false;
    const row = this.db.prepare('SELECT * FROM classroom_messages WHERE id = ?').get(messageId) as
      MessageRow | undefined;
    if (!row || !this.canSee(row, userId)) return false;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO classroom_message_receipts (message_id, user_id, acked_at)
         VALUES (?, ?, ?)`,
      )
      .run(messageId, userId, Date.now());
    return true;
  }

  /**
   * 断线补投查询：严格按 seq 游标，过滤目标用户、过期消息和该用户已确认的回执。
   * 分页返回游标与 hasMore，避免「过滤后 cursor 不前进」导致反复扫同一段。
   */
  replayPage(query: ReplayQuery): ReplayPage {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const now = Date.now();
    const pendingClause = `
      AND status IN ('pending', 'delivered')
      AND (expires_at IS NULL OR expires_at > ?)
      AND NOT EXISTS (
        SELECT 1 FROM classroom_message_receipts r
        WHERE r.message_id = classroom_messages.id AND r.user_id = ?
      )`;
    const fetchLimit = limit + 1;
    let rows: MessageRow[];
    if (query.lessonId && query.classId) {
      rows = this.db
        .prepare(
          `SELECT * FROM classroom_messages
            WHERE lesson_id = ? AND class_id = ? AND seq > ?
              ${pendingClause}
            ORDER BY seq ASC LIMIT ?`,
        )
        .all(query.lessonId, query.classId, query.sinceSeq, now, query.viewerId, fetchLimit) as MessageRow[];
    } else if (query.lessonId) {
      rows = this.db
        .prepare(
          `SELECT * FROM classroom_messages
            WHERE lesson_id = ? AND seq > ?
              ${pendingClause}
            ORDER BY seq ASC LIMIT ?`,
        )
        .all(query.lessonId, query.sinceSeq, now, query.viewerId, fetchLimit) as MessageRow[];
    } else if (query.classId) {
      rows = this.db
        .prepare(
          `SELECT * FROM classroom_messages
            WHERE class_id = ? AND seq > ?
              ${pendingClause}
            ORDER BY seq ASC LIMIT ?`,
        )
        .all(query.classId, query.sinceSeq, now, query.viewerId, fetchLimit) as MessageRow[];
    } else {
      return { messages: [], cursor: query.sinceSeq, hasMore: false };
    }

    const hasMore = rows.length > limit;
    const scanned = hasMore ? rows.slice(0, limit) : rows;
    const cursor = scanned.length > 0 ? scanned[scanned.length - 1].seq : query.sinceSeq;
    const messages = scanned
      .filter((r) => this.canSee(r, query.viewerId, query.staffView === true))
      .map((r) => ({
        seq: r.seq,
        id: r.id,
        channel: r.channel,
        msgType: r.msg_type,
        correlationId: r.correlation_id,
        payload: this.safeParse(r.payload),
        status: r.status,
        createdAt: r.created_at,
      }));
    return { messages, cursor, hasMore };
  }

  /** 兼容旧调用：只返回消息列表。需要游标/分页时用 replayPage。 */
  replay(query: ReplayQuery): ReplayedMessage[] {
    return this.replayPage(query).messages;
  }

  /** 标记已投递（重连补投 emit 成功后调用），供下次补投跳过 */
  markDelivered(messageId: string): void {
    this.db
      .prepare(
        `UPDATE classroom_messages SET status = 'delivered', delivered_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(Date.now(), Date.now(), messageId);
  }

  /** Q14=B：校验 channel 已注册、owner 归属、角色、payload 必填字段 */
  private validateSend(input: SendMessageInput): { ok: true } | { ok: false; code: SendFailureCode; error: string } {
    const desc = this.channels.get(input.channel);
    if (!desc) {
      return { ok: false, code: 'CHANNEL_NOT_REGISTERED', error: `channel "${input.channel}" 未注册` };
    }
    if (input.senderPluginId) {
      if (!desc.shared && desc.owner !== input.senderPluginId) {
        return {
          ok: false,
          code: 'CHANNEL_OWNER_MISMATCH',
          error: `channel "${input.channel}" 属于 ${desc.owner}，发送者 ${input.senderPluginId} 无权使用`,
        };
      }
    }
    if (desc.rolesAllowed && desc.rolesAllowed.length > 0 && !desc.rolesAllowed.includes(input.senderRole)) {
      return { ok: false, code: 'ROLE_NOT_ALLOWED', error: `角色 ${input.senderRole} 不可发送到 ${input.channel}` };
    }
    if (desc.requiredPayloadFields && desc.requiredPayloadFields.length > 0) {
      const payload = (input.payload ?? {}) as Record<string, unknown>;
      const missing = desc.requiredPayloadFields.filter((f) => !(f in payload));
      if (missing.length > 0) {
        return { ok: false, code: 'PAYLOAD_INVALID', error: `payload 缺少字段：${missing.join(', ')}` };
      }
    }
    return { ok: true };
  }

  private canSee(row: MessageRow, viewerId: string, staffView = false): boolean {
    if (!row.target_user_ids) return true; // 房间广播
    if (staffView) return true; // 课节/班级授权已在调用方完成，教师可观察定向消息
    try {
      const targets = JSON.parse(row.target_user_ids) as string[];
      return Array.isArray(targets) && targets.includes(viewerId);
    } catch {
      return false;
    }
  }

  private safeParse(json: string): unknown {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  private publishEvent(messageId: string, input: SendMessageInput, now: number): void {
    if (!this.publisher) return;
    const event = {
      id: messageId,
      type: 'classroom.message',
      source: input.senderPluginId ? `plugin:${input.senderPluginId}` : input.senderRole,
      payload: {
        messageId,
        channel: input.channel,
        msgType: input.msgType,
        lessonId: input.lessonId ?? null,
        classId: input.classId ?? null,
        targetUserIds: input.targetUserIds ?? null,
        payload: input.payload,
      },
      timestamp: now,
      correlationId: input.correlationId ?? undefined,
    };
    void this.publisher.publish(event).catch((publishError) => {
      console.warn('[classroom-message] classroom.message 发布失败，转入补偿队列', publishError);
      enqueueCompensation(
        this.enqueuer,
        {
          source: 'classroom.message',
          op: 'emitEvent',
          bizKey: `classroom.message:${messageId}`,
          payload: event,
          correlationId: messageId,
        },
        'classroom-message',
      );
    });
  }
}

/** 比较载荷时忽略键顺序，避免同一对象的两次序列化被当成冲突。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
