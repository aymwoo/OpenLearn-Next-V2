/**
 * ClassroomFlowServer HTTP 门面（设计 Q9=A）。
 *
 * 把内核里的统一学分发放 / 奖励目录 / 兑换服务暴露为 /api/classroomflowserver/*。
 * 路由层保持薄：身份一律服务端派生（禁止客户端自报 studentId 刷分/代兑），
 * 业务规则在三个 service 里；路由只做鉴权、参数整理、默认值收敛
 * （货币维度、发放来源、消息类型与收件人范围）和结果映射。
 */
import type { Express, Request, Response } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import {
  ICreditAwardServiceToken,
  IRewardCatalogServiceToken,
  ICreditRedemptionServiceToken,
  IClassroomMessageServiceToken,
  type ICreditAwardService,
  type ICreditRedemptionService,
  type IClassroomMessageService,
} from '../../packages/core/di/interfaces.js';
import type { RewardCatalogService, RewardEligibility } from '../../packages/core/di/reward-catalog-service.js';
import { BUILTIN_AWARD_SOURCES } from '../../packages/core/di/credit-award-service.js';
import { ISubmissionAggregatorToken } from '../../packages/core/submission-adapter/index.js';
import { getActorId } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import {
  authorizeClass,
  authorizeClassroomControl,
  authorizeClassroomRead,
  isAdministrator,
  isTeacher,
  studentActorId,
  teacherCanSeeStudent,
  type AccessSession,
} from '../services/class-access.js';
import { sendSafeError } from '../utils/error-handler.js';
import { loadLessonClassId } from '../services/classroom-class-lock.js';
import { DEFAULT_REDEEM_DIMENSION } from '../../packages/core/di/credit-redemption-service.js';

function getSession(req: Request): AccessSession | undefined {
  return (req as unknown as { session?: AccessSession })?.session;
}

function viewerIdOf(session: AccessSession | undefined): string {
  return studentActorId(session) || String(session?.userId ?? '');
}

function deny(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

/**
 * 奖励目录 token 对外声明为只读端口（IRewardCatalogReader），内核注册的是完整
 * RewardCatalogService 实例。这里统一解析并收窄为完整类型，供管理端写操作使用。
 */
async function getCatalog(): Promise<RewardCatalogService> {
  return kernelContainer.serviceRegistry.resolve(IRewardCatalogServiceToken) as Promise<RewardCatalogService>;
}

/** 工具：角色判定（管理员 > 教师 > 学生） */
function sessionRole(session: AccessSession | undefined): string {
  if (isAdministrator(session)) return 'administrator';
  if (isTeacher(session)) return 'teacher';
  return 'student';
}

/**
 * 学生消息的收件人范围：必须是本班学生或班主任。
 *
 * 班级无法判定时 fail closed —— 学生不能靠省略 classId、只给 lessonId
 * 就给任意 userId 定向投递（课节消息会直接进对方 user-* 私房间）。
 */
function studentTargetsBelongToClass(classId: string | null, targets: string[]): boolean {
  if (!classId) return false;
  const db = kernelContainer.db;
  const owner = db.prepare('SELECT owner_user_id FROM classes WHERE id = ?').get(classId) as
    { owner_user_id?: string | null } | undefined;
  const ownerId = owner?.owner_user_id ?? null;
  const enrolled = db.prepare('SELECT 1 AS ok FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1');
  return targets.every((id) => id === ownerId || Boolean(enrolled.get(classId, id)));
}

export function registerClassroomFlowServerRoutes(app: Express): void {
  // ── 统一学分发放（教师/管理员）────────────────────────────────────────
  app.post(
    '/api/classroomflowserver/awardCredits',
    requireScopedAuth('class-staff'),
    async (req: Request, res: Response) => {
      try {
        const svc = await kernelContainer.serviceRegistry.resolve<ICreditAwardService>(ICreditAwardServiceToken);
        const { studentId, classId, dimensionId, deltaPoints, source, idempotencyKey, reason } = (req.body ??
          {}) as Record<string, unknown>;
        const classKey = String(classId ?? '');
        const classAuth = authorizeClass(kernelContainer.db, getSession(req), classKey, 'staff');
        if (!classAuth.ok) return deny(res, classAuth.status, classAuth.error);
        // 来源参与审计：教师手工发放一律记 manual；管理员可补录内置来源，
        // 但 HTTP 通道没有插件身份，不接受 plugin:* 以免伪造来源。
        const role = sessionRole(getSession(req));
        const requestedSource = String(source ?? 'manual') || 'manual';
        const awardSource = role === 'administrator' ? requestedSource : 'manual';
        if (!(BUILTIN_AWARD_SOURCES as readonly string[]).includes(awardSource)) {
          return res.status(400).json({ success: false, error: 'source 必须为内置来源' });
        }
        const result = svc.award({
          studentId: String(studentId ?? ''),
          classId: classKey,
          dimensionId: String(dimensionId || DEFAULT_REDEEM_DIMENSION),
          deltaPoints: Number(deltaPoints),
          source: awardSource,
          idempotencyKey: String(idempotencyKey ?? ''),
          reason: String(reason ?? ''),
          actorId: getActorId(req),
        });
        if (!result.ok) {
          const status = result.code === 'STUDENT_NOT_ENROLLED' ? 404 : 400;
          return res.status(status).json({ success: false, code: result.code, error: result.message });
        }
        return res.json({ success: true, ...result });
      } catch (e) {
        return sendSafeError(res, e, 500);
      }
    },
  );

  // ── 奖励目录：浏览（任意登录用户）─────────────────────────────────────
  app.get('/api/classroomflowserver/rewards', requireScopedAuth('authenticated'), async (req: Request, res) => {
    try {
      const svc = await getCatalog();
      const session = getSession(req);
      let rewards = svc.listAvailable();
      // 学生侧不展示已无库存或角色不符的条目，避免点进去才被兑换接口拒绝。
      if (!isTeacher(session) && !isAdministrator(session)) {
        const role = sessionRole(session);
        rewards = rewards.filter((reward) => {
          if (reward.stock !== null && reward.stock <= 0) return false;
          const roles = reward.eligibility?.roles;
          return !roles || roles.length === 0 || roles.includes(role);
        });
      }
      return res.json({ success: true, rewards });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  app.get(
    '/api/classroomflowserver/rewards/:id',
    requireScopedAuth('authenticated'),
    async (req: Request, res: Response) => {
      try {
        const svc = await getCatalog();
        const item = svc.getById(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: 'Reward not found' });
        // 下架/未开始/已结束的奖励对学生按不存在处理；教师/管理员可预览配置。
        const session = getSession(req);
        if (!isTeacher(session) && !isAdministrator(session)) {
          const now = Date.now();
          const visible =
            item.status === 'active' &&
            (item.availableFrom == null || item.availableFrom <= now) &&
            (item.availableUntil == null || item.availableUntil >= now);
          if (!visible) return res.status(404).json({ success: false, error: 'Reward not found' });
        }
        return res.json({ success: true, reward: item });
      } catch (e) {
        return sendSafeError(res, e, 500);
      }
    },
  );

  // ── 奖励目录：创建/上下架（管理员）────────────────────────────────────
  app.post('/api/classroomflowserver/rewards', requireScopedAuth('admin'), async (req: Request, res: Response) => {
    try {
      const svc = await getCatalog();
      const b = (req.body ?? {}) as Record<string, unknown>;
      const item = svc.create({
        id: String(b.id ?? ''),
        name: String(b.name ?? ''),
        nameEn: b.nameEn as string | null | undefined,
        description: b.description as string | null | undefined,
        icon: b.icon as string | null | undefined,
        color: b.color as string | null | undefined,
        costPoints: Number(b.costPoints),
        stock: b.stock === undefined || b.stock === null ? null : Number(b.stock),
        eligibility: (b.eligibility as RewardEligibility) ?? null,
        availableFrom: b.availableFrom === undefined ? null : Number(b.availableFrom),
        availableUntil: b.availableUntil === undefined ? null : Number(b.availableUntil),
        sortOrder: b.sortOrder === undefined ? undefined : Number(b.sortOrder),
      });
      return res.json({ success: true, reward: item });
    } catch (e) {
      return sendSafeError(res, e, 400);
    }
  });

  app.post(
    '/api/classroomflowserver/rewards/:id/status',
    requireScopedAuth('admin'),
    async (req: Request, res: Response) => {
      try {
        const svc = await getCatalog();
        const status = String((req.body as Record<string, unknown>)?.status ?? '');
        if (status !== 'active' && status !== 'inactive') {
          return res.status(400).json({ success: false, error: 'status must be active or inactive' });
        }
        const ok = svc.setStatus(req.params.id, status);
        if (!ok) return res.status(404).json({ success: false, error: 'Reward not found' });
        return res.json({ success: true, id: req.params.id, status });
      } catch (e) {
        return sendSafeError(res, e, 500);
      }
    },
  );

  // ── 兑换（学生本人，studentId 从会话派生）────────────────────────────
  app.post('/api/classroomflowserver/redeem', requireScopedAuth('self'), async (req: Request, res) => {
    try {
      const svc =
        await kernelContainer.serviceRegistry.resolve<ICreditRedemptionService>(ICreditRedemptionServiceToken);
      const session = getSession(req);
      const studentId = studentActorId(session);
      if (!studentId) return res.status(401).json({ success: false, error: 'Not a student session' });

      const { rewardId, idempotencyKey, reason, classId } = (req.body ?? {}) as Record<string, unknown>;
      const classKey = String(classId ?? '');
      const classAuth = authorizeClass(kernelContainer.db, session, classKey, 'member');
      if (!classAuth.ok) return deny(res, classAuth.status, classAuth.error);
      const result = svc.redeem({
        studentId, // 服务端派生，禁止客户端自报
        classId: classKey,
        rewardId: String(rewardId ?? ''),
        idempotencyKey: String(idempotencyKey ?? ''),
        reason: reason as string | null | undefined,
        actorId: getActorId(req),
        role: sessionRole(session),
        // 兑换货币由服务端固定（默认维度），不接受客户端切换维度，
        // 否则可用另一种维度余额按目录价格兑换奖励。
      });
      if (!result.ok) {
        const status = result.code === 'INSUFFICIENT_CREDITS' || result.code === 'IDEMPOTENCY_KEY_CONFLICT' ? 409 : 400;
        return res.status(status).json({ success: false, code: result.code, error: result.message });
      }
      return res.json({ success: true, ...result });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  // ── 学分余额查询（本人或班级教师/管理员）──────────────────────────────
  app.get('/api/classroomflowserver/credits/summary', requireScopedAuth('self'), async (req: Request, res) => {
    try {
      const svc =
        await kernelContainer.serviceRegistry.resolve<ICreditRedemptionService>(ICreditRedemptionServiceToken);
      const session = getSession(req);
      const selfId = studentActorId(session);
      const requested = typeof req.query.studentId === 'string' ? req.query.studentId : null;
      const target = requested ?? selfId;
      const classId = String(req.query.classId ?? '');
      if (!target || !classId) {
        return res.status(400).json({ success: false, error: 'studentId/classId required' });
      }
      if (target !== selfId) {
        const staff = authorizeClass(kernelContainer.db, session, classId, 'staff');
        if (!staff.ok || !teacherCanSeeStudent(kernelContainer.db, session, target)) {
          return deny(res, 403, 'Forbidden');
        }
      } else {
        const member = authorizeClass(kernelContainer.db, session, classId, 'member');
        if (!member.ok) return deny(res, member.status, member.error);
      }
      const dimensionId = typeof req.query.dimensionId === 'string' ? req.query.dimensionId : DEFAULT_REDEEM_DIMENSION;
      const balance = svc.getBalance(target, classId, dimensionId);
      return res.json({ success: true, studentId: target, classId, balance });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  app.get('/api/classroomflowserver/messages', requireScopedAuth('class-member'), async (req: Request, res) => {
    try {
      const svc =
        await kernelContainer.serviceRegistry.resolve<IClassroomMessageService>(IClassroomMessageServiceToken);
      const session = getSession(req);
      const viewerId = viewerIdOf(session);
      if (!viewerId) return res.status(401).json({ success: false, error: 'Unauthenticated' });
      const sinceSeq = Number(req.query.since ?? 0);
      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : null;
      const classId = typeof req.query.classId === 'string' ? req.query.classId : null;
      if (!lessonId && !classId) {
        return res.status(400).json({ success: false, error: 'lessonId or classId required' });
      }
      if (lessonId) {
        const read = authorizeClassroomRead(kernelContainer.db, session, lessonId);
        if (!read.ok) return deny(res, read.status, read.error);
      }
      if (classId) {
        const member = authorizeClass(kernelContainer.db, session, classId, 'member');
        if (!member.ok) return deny(res, member.status, member.error);
      }
      const messages = svc.replayPage({
        lessonId,
        classId,
        sinceSeq: Number.isFinite(sinceSeq) ? sinceSeq : 0,
        viewerId,
        // 教师/管理员在本课节/班级内可补投定向消息（与实时投递收件人+班主任一致）。
        staffView: isTeacher(session) || isAdministrator(session),
      });
      // lessonId 与 classId 同时传入时取交集：只有以这一组合发布的消息会被补投。
      return res.json({
        success: true,
        messages: messages.messages,
        cursor: messages.cursor,
        hasMore: messages.hasMore,
      });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  app.post('/api/classroomflowserver/messages', requireScopedAuth('class-member'), async (req: Request, res) => {
    try {
      const svc =
        await kernelContainer.serviceRegistry.resolve<IClassroomMessageService>(IClassroomMessageServiceToken);
      const session = getSession(req);
      const viewerId = viewerIdOf(session);
      if (!viewerId) return res.status(401).json({ success: false, error: 'Unauthenticated' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const lessonId = typeof body.lessonId === 'string' && body.lessonId ? body.lessonId : null;
      const classId = typeof body.classId === 'string' && body.classId ? body.classId : null;
      if (!lessonId && !classId) {
        return res.status(400).json({ success: false, error: 'lessonId or classId required' });
      }
      if (body.msgType !== 'request' && body.msgType !== 'response') {
        return res.status(400).json({ success: false, error: 'msgType must be request or response' });
      }
      if (lessonId) {
        const read = authorizeClassroomRead(kernelContainer.db, session, lessonId);
        if (!read.ok) return deny(res, read.status, read.error);
      }
      if (classId) {
        const member = authorizeClass(kernelContainer.db, session, classId, 'member');
        if (!member.ok) return deny(res, member.status, member.error);
      }
      const role = sessionRole(session);
      const staff = role === 'teacher' || role === 'administrator';
      // 学生只能作答（response）：request 是教师侧指令，允许学生发会变成冒充教师催交/下发任务。
      if (!staff && body.msgType !== 'response') {
        return deny(res, 403, 'students may only send response messages');
      }
      const targets = Array.isArray(body.targetUserIds)
        ? body.targetUserIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : null;
      // 定向消息会直接进对方 user-* 私房间，不能只凭 classId 鉴权就信任任意收件人。
      if (!staff && targets?.length) {
        const msgClassId = classId ?? (lessonId ? loadLessonClassId(kernelContainer.db, lessonId) : null);
        if (!studentTargetsBelongToClass(msgClassId, targets)) {
          return deny(res, 403, 'targetUserIds must be members of this class');
        }
      }
      const result = svc.send({
        channel: String(body.channel ?? ''),
        msgType: body.msgType,
        lessonId,
        classId,
        targetUserIds: targets,
        correlationId: typeof body.correlationId === 'string' ? body.correlationId : null,
        payload: body.payload ?? {},
        ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : null,
        messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
        senderActorId: getActorId(req),
        senderRole: role,
        senderPluginId: null,
      });
      if (!result.ok) {
        const status = result.code === 'MESSAGE_ID_CONFLICT' ? 409 : 400;
        return res.status(status).json({ success: false, code: result.code, error: result.error });
      }
      return res.json({ success: true, messageId: result.messageId, seq: result.seq, duplicated: result.duplicated });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  app.post(
    '/api/classroomflowserver/messages/:id/ack',
    requireScopedAuth('class-member'),
    async (req: Request, res) => {
      try {
        const svc =
          await kernelContainer.serviceRegistry.resolve<IClassroomMessageService>(IClassroomMessageServiceToken);
        const session = getSession(req);
        const viewerId = viewerIdOf(session);
        if (!viewerId) return res.status(401).json({ success: false, error: 'Unauthenticated' });
        const ok = svc.ack(req.params.id, viewerId);
        if (!ok) return res.status(404).json({ success: false, error: 'Message not found' });
        return res.json({ success: true, id: req.params.id });
      } catch (e) {
        return sendSafeError(res, e, 500);
      }
    },
  );

  app.get('/api/classroomflowserver/submissions', requireScopedAuth('class-member'), async (req: Request, res) => {
    try {
      const agg = await kernelContainer.serviceRegistry.resolve(ISubmissionAggregatorToken);
      const session = getSession(req);
      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : undefined;
      const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
      const modeId = typeof req.query.modeId === 'string' ? req.query.modeId : undefined;
      if (!lessonId && !classId) {
        return res.status(400).json({ success: false, error: 'lessonId or classId required' });
      }
      if (lessonId) {
        const read = authorizeClassroomRead(kernelContainer.db, session, lessonId);
        if (!read.ok) return deny(res, read.status, read.error);
      }
      if (classId) {
        const level = isTeacher(session) || isAdministrator(session) ? 'staff' : 'member';
        const member = authorizeClass(kernelContainer.db, session, classId, level);
        if (!member.ok) return deny(res, member.status, member.error);
      }
      const staff = isTeacher(session) || isAdministrator(session);
      const result = await agg.list(
        { lessonId, classId, studentId: staff ? undefined : viewerIdOf(session) || undefined },
        modeId,
      );
      return res.json({ success: true, ...result });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  app.post(
    '/api/classroomflowserver/submissions/:adapterId/grade',
    requireScopedAuth('class-staff'),
    async (req: Request, res) => {
      try {
        const agg = await kernelContainer.serviceRegistry.resolve(ISubmissionAggregatorToken);
        const session = getSession(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const { submissionId, lessonId, classId, score, feedback, overrideProtected, reason } = body;
        if (typeof classId === 'string' && classId) {
          const staff = authorizeClass(kernelContainer.db, session, classId, 'staff');
          if (!staff.ok) return deny(res, staff.status, staff.error);
        } else if (typeof lessonId === 'string' && lessonId) {
          const control = authorizeClassroomControl(kernelContainer.db, session, lessonId, {
            actorId: getActorId(req),
          });
          if (!control.ok) return deny(res, control.status, control.error);
        } else {
          return res.status(400).json({ success: false, error: 'lessonId or classId required' });
        }
        if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
          return res.status(400).json({ success: false, error: 'score must be a number from 0 to 100' });
        }
        const result = await agg.writeGrade(
          req.params.adapterId,
          String(submissionId ?? ''),
          {
            lessonId: typeof lessonId === 'string' ? lessonId : undefined,
            classId: typeof classId === 'string' ? classId : undefined,
          },
          {
            score,
            feedback: typeof feedback === 'string' ? feedback : null,
            overrideProtected: overrideProtected === true,
            reason: typeof reason === 'string' ? reason : null,
          },
        );
        if (!result.ok) {
          return res.status(400).json({ success: false, code: result.reason, error: result.reason });
        }
        await kernelContainer.eventBus
          .publish({
            id: `sg_${result.historyId ?? String(submissionId ?? '')}`,
            type: 'submission.graded',
            source: 'classroomflowserver',
            payload: {
              adapterId: req.params.adapterId,
              submissionId: String(submissionId ?? ''),
              score,
              historyId: result.historyId,
            },
            timestamp: Date.now(),
          })
          .catch(() => undefined);
        return res.json({ success: true, ...result });
      } catch (e) {
        return sendSafeError(res, e, 500);
      }
    },
  );
}
