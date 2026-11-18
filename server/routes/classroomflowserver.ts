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
import { isAdministrator, isTeacher, studentActorId } from '../services/class-access.js';
import { sendSafeError } from '../utils/error-handler.js';

function getSession(req: Request): Record<string, unknown> | undefined {
  return (req as unknown as { session?: Record<string, unknown> })?.session;
}

/**
 * 奖励目录 token 对外声明为只读端口（IRewardCatalogReader），内核注册的是完整
 * RewardCatalogService 实例。这里统一解析并收窄为完整类型，供管理端写操作使用。
 */
async function getCatalog(): Promise<RewardCatalogService> {
  return kernelContainer.serviceRegistry.resolve(IRewardCatalogServiceToken) as Promise<RewardCatalogService>;
}

/** 工具：角色判定（管理员 > 教师 > 学生） */
function sessionRole(session: Record<string, unknown> | undefined): string {
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
        const result = svc.award({
          studentId: String(studentId ?? ''),
          classId: String(classId ?? ''),
          dimensionId: String(dimensionId ?? ''),
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

      const { rewardId, idempotencyKey, reason, classId } = (req.body ?? {}) as Record<string, unknown>;
      const result = svc.redeem({
        studentId, // 服务端派生，禁止客户端自报
        classId: String(classId ?? ''),
        rewardId: String(rewardId ?? ''),
        idempotencyKey: String(idempotencyKey ?? ''),
        reason: reason as string | null | undefined,
        actorId: getActorId(req),
        role: sessionRole(session),
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
      if (requested && requested !== selfId && !isTeacher(session) && !isAdministrator(session)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const target = requested ?? selfId;
      const classId = String(req.query.classId ?? '');
      if (!target || !classId) {
        return res.status(400).json({ success: false, error: 'studentId/classId required' });
      }
      const balance = svc.getBalance(target, classId);
      return res.json({ success: true, studentId: target, classId, balance });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  // ── 通讯协议：可靠消息拉取（客户端离线兜底，Q13=C 的 A 路径）─────────
  app.get('/api/classroomflowserver/messages', requireScopedAuth('self'), async (req: Request, res) => {
    try {
      const svc =
        await kernelContainer.serviceRegistry.resolve<IClassroomMessageService>(IClassroomMessageServiceToken);
      const session = getSession(req);
      const viewerId = studentActorId(session) || String(session?.userId ?? '');
      if (!viewerId) return res.status(401).json({ success: false, error: 'Unauthenticated' });
      const sinceSeq = Number(req.query.since ?? 0);
      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : null;
      const classId = typeof req.query.classId === 'string' ? req.query.classId : null;
      if (!lessonId && !classId) {
        return res.status(400).json({ success: false, error: 'lessonId or classId required' });
      }
      const messages = svc.replay({ lessonId, classId, sinceSeq: Number.isFinite(sinceSeq) ? sinceSeq : 0, viewerId });
      return res.json({ success: true, messages, cursor: messages.at(-1)?.seq ?? sinceSeq });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  // ── 通讯协议：ACK（客户端处理完消息后确认）────────────────────────────
  app.post('/api/classroomflowserver/messages/:id/ack', requireScopedAuth('self'), async (req: Request, res) => {
    try {
      const svc =
        await kernelContainer.serviceRegistry.resolve<IClassroomMessageService>(IClassroomMessageServiceToken);
      const ok = svc.ack(req.params.id);
      return res.json({ success: ok, id: req.params.id });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  // ── 提交适配器：统一成绩面板数据源（官方课件 + 第三方教学模式）─────────
  app.get('/api/classroomflowserver/submissions', requireScopedAuth('class-member'), async (req: Request, res) => {
    try {
      const agg = await kernelContainer.serviceRegistry.resolve(ISubmissionAggregatorToken);
      const lessonId = typeof req.query.lessonId === 'string' ? req.query.lessonId : undefined;
      const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
      const modeId = typeof req.query.modeId === 'string' ? req.query.modeId : undefined;
      const result = await agg.list({ lessonId, classId }, modeId);
      return res.json({ success: true, ...result });
    } catch (e) {
      return sendSafeError(res, e, 500);
    }
  });

  // ── 提交适配器：把插件提交写回平台成绩（教师）─────────────────────────
  app.post(
    '/api/classroomflowserver/submissions/:adapterId/grade',
    requireScopedAuth('class-staff'),
    async (req: Request, res) => {
      try {
        const agg = await kernelContainer.serviceRegistry.resolve(ISubmissionAggregatorToken);
        const { submissionId, lessonId, classId } = (req.body ?? {}) as Record<string, unknown>;
        const result = await agg.writeGrade(
          req.params.adapterId,
          String(submissionId ?? ''),
          { lessonId: lessonId as string | undefined, classId: classId as string | undefined },
          getActorId(req),
        );
        if (!result.ok) {
          return res.status(400).json({ success: false, code: result.reason, error: result.reason });
        }
        return res.json({ success: true, ...result });
      } catch (e) {
        return sendSafeError(res, e, 500);
      }
    },
  );
}
