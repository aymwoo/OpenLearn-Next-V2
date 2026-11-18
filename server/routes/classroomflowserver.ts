/**
 * ClassroomFlowServer HTTP 门面（设计 Q9=A）。
 *
 * 把内核里的统一学分发放 / 奖励目录 / 兑换服务暴露为 /api/classroomflowserver/*。
 * 路由层保持薄：身份一律服务端派生（禁止客户端自报 studentId 刷分/代兑），
 * 业务规则在三个 service 里，路由只做鉴权、参数整理、结果映射。
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
        const result = svc.award({
          studentId: String(studentId ?? ''),
          classId: classKey,
          dimensionId: String(dimensionId || DEFAULT_REDEEM_DIMENSION),
          deltaPoints: Number(deltaPoints),
          source: String(source ?? ''),
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
  app.get('/api/classroomflowserver/rewards', requireScopedAuth('authenticated'), async (_req, res) => {
    try {
      const svc = await getCatalog();
      return res.json({ success: true, rewards: svc.listAvailable() });
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

      const { rewardId, idempotencyKey, reason, classId, dimensionId } = (req.body ?? {}) as Record<string, unknown>;
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
        dimensionId: typeof dimensionId === 'string' && dimensionId ? dimensionId : DEFAULT_REDEEM_DIMENSION,
      });
      if (!result.ok) {
        const status = result.code === 'INSUFFICIENT_CREDITS' ? 409 : 400;
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
      const messages = svc.replay({
        lessonId,
        classId,
        sinceSeq: Number.isFinite(sinceSeq) ? sinceSeq : 0,
        viewerId,
      });
      return res.json({ success: true, messages, cursor: messages.at(-1)?.seq ?? sinceSeq });
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
      const targets = Array.isArray(body.targetUserIds)
        ? body.targetUserIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : null;
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
        senderRole: sessionRole(session) === 'administrator' ? 'administrator' : sessionRole(session),
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
