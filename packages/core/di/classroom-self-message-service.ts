/**
 * 学生 self 身份课堂消息服务（P0）。
 *
 * 目标：插件需要在学生端替当前学生发送课堂消息（如提交提示、求助请求），
 * 但 `classroom.sendMessage` 命令要求 `lesson:write`，学生没有该能力。
 *
 * 本服务把 sender 从 `plugin:<id>` 换成宿主派生的 `user:<studentId>:student`：
 * - 只允许学生会话调用，插件不能自报 studentId；
 * - 校验 channel 的 `rolesAllowed`（由底层 `ClassroomMessageService.send` 完成）；
 * - 校验班级成员关系与 `targetUserIds` 同班；
 * - 复用底层 `messageId` 幂等语义（重发不产生第二条消息）。
 */
import type { Database } from 'better-sqlite3';
import type { ClassroomSelfMessageInput, IClassroomSelfMessageService } from './interfaces.js';
import type { SendMessageResult } from './classroom-message-service.js';
import { canSeeLesson } from './lesson-visibility.js';
import { currentLessonViewer, studentIdFromViewer } from './lesson-viewer.js';

export class ClassroomSelfMessageInputError extends Error {
  readonly code = 'CLASSROOM_SELF_MESSAGE_INVALID_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'ClassroomSelfMessageInputError';
  }
}

export class ClassroomSelfMessageAccessError extends Error {
  readonly status = 403;
  readonly code = 'CLASSROOM_SELF_MESSAGE_FORBIDDEN';

  constructor(readonly reason: 'no_viewer' | 'not_student' | 'forbidden') {
    super(
      reason === 'no_viewer'
        ? 'Sending as a student requires the signed-in student who invoked this plugin'
        : reason === 'not_student'
          ? 'Only a student session can send a self message'
          : 'The student is not allowed to send this classroom message',
    );
    this.name = 'ClassroomSelfMessageAccessError';
  }
}

interface MessageSender {
  send(input: {
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
    messageId?: string;
  }): SendMessageResult;
}

export class ClassroomSelfMessageService implements IClassroomSelfMessageService {
  constructor(
    private readonly db: Database,
    private readonly messages: MessageSender,
  ) {}

  sendAsSelf(input: ClassroomSelfMessageInput, senderPluginId?: string): SendMessageResult {
    const viewer = currentLessonViewer();
    if (!viewer) throw new ClassroomSelfMessageAccessError('no_viewer');
    const studentId = studentIdFromViewer(viewer);
    if (!studentId) throw new ClassroomSelfMessageAccessError('not_student');

    const classId = typeof input.classId === 'string' && input.classId.trim() ? input.classId.trim() : null;
    const lessonId = typeof input.lessonId === 'string' && input.lessonId.trim() ? input.lessonId.trim() : null;
    const targetUserIds = normalizeTargets(input.targetUserIds);

    if (classId && !this.isEnrolled(classId, studentId)) {
      throw new ClassroomSelfMessageAccessError('forbidden');
    }
    if (lessonId && !canSeeLesson(this.db, viewer, lessonId)) {
      throw new ClassroomSelfMessageAccessError('forbidden');
    }
    // 课节与班级同时提供时必须属于同一教学关系，避免把 A 班标签的消息
    // 投进未挂到 A 班的课节补投流。
    if (classId && lessonId && !this.isLessonLinkedToClass(lessonId, classId)) {
      throw new ClassroomSelfMessageAccessError('forbidden');
    }
    if (targetUserIds) {
      if (!classId) {
        throw new ClassroomSelfMessageAccessError('forbidden');
      }
      for (const target of targetUserIds) {
        if (!this.isEnrolled(classId, target)) {
          throw new ClassroomSelfMessageAccessError('forbidden');
        }
      }
    }

    return this.messages.send({
      channel: input.channel,
      msgType: input.msgType,
      lessonId,
      classId,
      targetUserIds,
      senderActorId: `user:${studentId}:student`,
      senderRole: 'student',
      senderPluginId: senderPluginId ?? null,
      correlationId: input.correlationId ?? null,
      payload: input.payload,
      ttlMs: input.ttlMs ?? null,
      messageId: input.messageId,
    });
  }

  private isEnrolled(classId: string, studentId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS ok FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1')
      .get(classId, studentId) as { ok: number } | undefined;
    return Boolean(row);
  }

  /** 课节是否挂在该班级下（与 canSeeLesson 的关联口径一致）。 */
  private isLessonLinkedToClass(lessonId: string, classId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM schedules WHERE lesson_id = ? AND class_id = ?
         UNION ALL
         SELECT 1 FROM assignments WHERE lesson_id = ? AND class_id = ?
         UNION ALL
         SELECT 1 FROM classroom_sessions WHERE lesson_id = ? AND class_id = ?
         LIMIT 1`,
      )
      .get(lessonId, classId, lessonId, classId, lessonId, classId) as { ok: number } | undefined;
    return Boolean(row);
  }
}

function normalizeTargets(targets: unknown): string[] | null {
  // 未指定 = 房间广播；显式空数组沿用既有广播语义。
  if (targets === undefined || targets === null) return null;
  if (!Array.isArray(targets)) {
    throw new ClassroomSelfMessageInputError('targetUserIds must be an array of non-empty student ids');
  }
  const ids: string[] = [];
  for (const target of targets) {
    if (typeof target !== 'string' || target.trim().length === 0) {
      throw new ClassroomSelfMessageInputError('targetUserIds must contain only non-empty student ids');
    }
    ids.push(target.trim());
  }
  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}
