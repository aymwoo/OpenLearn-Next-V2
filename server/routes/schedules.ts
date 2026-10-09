import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { parsePagination } from '../utils/pagination.js';
import { ScheduleService } from '../services/schedule-service.js';

export function registerSchedulesRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const scheduleService = new ScheduleService(kernelContainer.db);

  /**
   * 今日/指定日期的排课查询 (支持周循环课表匹配)
   */
  app.get('/api/schedules/today', requireAuth(), (req, res) => {
    try {
      const clientDate = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const schedules = scheduleService.getTodaySchedules(clientDate);
      res.json({ success: true, schedules });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 全量排课列表 (A7 标准分页信封)
   */
  app.get('/api/schedules', requireAuth(), (req, res) => {
    try {
      const pg = parsePagination(req.query as any);
      const result = scheduleService.listSchedules(pg);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 排课冲突预检端点
   */
  app.post('/api/schedules/check-conflict', requireAuth(), (req, res) => {
    try {
      const { classId, scheduledDate, timeSlot, lessonId, excludeScheduleId } = req.body;
      if (!classId || !scheduledDate) {
        return res.status(400).json({ error: 'classId and scheduledDate are required' });
      }
      const report = scheduleService.detectConflicts({
        classId,
        scheduledDate,
        timeSlot,
        lessonId,
        excludeScheduleId,
      });
      res.json({ success: true, ...report });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 指定班级的排课列表 (保持裸数组兼容)
   */
  app.get('/api/classes/:classId/schedules', requireAuth(), (req, res) => {
    try {
      const schedules = scheduleService.getClassSchedules(req.params.classId);
      res.json(schedules);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 为班级创建单条排课 (支持冲突防御与 force 覆盖)
   */
  app.post('/api/classes/:classId/schedules', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId, scheduledDate, timeSlot, status, notes, force, allowConflict } = req.body;
      const schedule = scheduleService.createSchedule(
        {
          classId: req.params.classId,
          lessonId,
          scheduledDate,
          timeSlot,
          status,
          notes,
        },
        { allowConflict: Boolean(force || allowConflict) },
      );
      res.json({
        success: true,
        schedule,
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 更新已有排课信息 (支持冲突防御与 force 覆盖)
   */
  app.put('/api/classes/:classId/schedules/:scheduleId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { lessonId, scheduledDate, timeSlot, status, notes, force, allowConflict } = req.body;
      scheduleService.updateSchedule(
        req.params.scheduleId,
        req.params.classId,
        {
          lessonId,
          scheduledDate,
          timeSlot,
          status,
          notes,
        },
        { allowConflict: Boolean(force || allowConflict) },
      );
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 级联删除排课记录及关联考勤表 (DATA-INT-01 原子事务)
   */
  app.delete('/api/classes/:classId/schedules/:scheduleId', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      scheduleService.deleteScheduleCascade(req.params.scheduleId, req.params.classId);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 批量创建排课 (原子事务封装)
   */
  app.post('/api/classes/:classId/schedules/batch', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { schedules, force, allowConflict } = req.body;
      const result = scheduleService.batchCreateSchedules(req.params.classId, schedules || [], {
        allowConflict: Boolean(force || allowConflict),
      });
      res.json({ success: true, count: result.count, ids: result.ids });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 课程表多模态 OCR 视觉识别与清洗
   */
  app.post('/api/timetable/ocr', requireAuth('teacher', 'administrator'), async (req, res) => {
    const startTime = Date.now();
    try {
      const { imageBase64, lang = 'zh', providerId } = req.body;
      const result = await scheduleService.processTimetableOcr(imageBase64, { lang, providerId });
      res.json({
        success: true,
        entries: result.entries,
        providerUsed: result.providerUsed,
      });
    } catch (e: any) {
      const elapsed = Date.now() - startTime;
      console.error(`[OCR Error after ${elapsed}ms]:`, (e as Error).message);
      sendSafeError(res, e);
    }
  });
}
