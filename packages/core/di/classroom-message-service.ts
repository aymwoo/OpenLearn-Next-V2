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
  'CHANNEL_NOT_REGISTERED' | 'CHANNEL_OWNER_MISMATCH' | 'ROLE_NOT_ALLOWED' | 'PAYLOAD_INVALID';

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
  limit?: number;
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
  enqueue(effect: { op: 'emitEvent'; bizKey: string; payload: unknown; correlationId: string }): void | Promise<void>;
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

    const row = this.db.prepare('SELECT seq FROM classroom_messages WHERE id = ?').get(messageId) as { seq: number };
    const duplicated = info.changes === 0;

    if (!duplicated) this.publishEvent(messageId, input, now);

    return { ok: true, messageId, seq: row.seq, duplicated };
  }

  /** 客户端确认收到 */
  ack(messageId: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE classroom_messages SET status = 'acked', acked_at = ?, updated_at = ?
          WHERE id = ? AND status <> 'acked'`,
      )
      .run(Date.now(), Date.now(), messageId);
    return info.changes > 0;
  }

  /** 断线补投查询：严格按 seq 游标，过滤目标用户与过期消息 */
  replay(query: ReplayQuery): ReplayedMessage[] {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    let rows: MessageRow[];
    if (query.lessonId) {
      rows = this.db
        .prepare(
          `SELECT * FROM classroom_messages
            WHERE lesson_id = ? AND seq > ?
              AND status IN ('pending', 'delivered')
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY seq ASC LIMIT ?`,
        )
        .all(query.lessonId, query.sinceSeq, Date.now(), limit) as MessageRow[];
    } else if (query.classId) {
      rows = this.db
        .prepare(
          `SELECT * FROM classroom_messages
            WHERE class_id = ? AND seq > ?
              AND status IN ('pending', 'delivered')
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY seq ASC LIMIT ?`,
        )
        .all(query.classId, query.sinceSeq, Date.now(), limit) as MessageRow[];
    } else {
      return [];
    }

    return rows
      .filter((r) => this.canSee(r, query.viewerId))
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
    if (!desc.shared && input.senderPluginId && desc.owner !== input.senderPluginId) {
      return {
        ok: false,
        code: 'CHANNEL_OWNER_MISMATCH',
        error: `channel "${input.channel}" 属于 ${desc.owner}，发送者 ${input.senderPluginId} 无权使用`,
      };
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

  private canSee(row: MessageRow, viewerId: string): boolean {
    if (!row.target_user_ids) return true; // 房间广播
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
    void this.publisher.publish(event).catch(() => {
      if (this.enqueuer) {
        void this.enqueuer.enqueue({
          op: 'emitEvent',
          bizKey: `classroom.message:${messageId}`,
          payload: event,
          correlationId: messageId,
        });
      }
    });
  }
}
