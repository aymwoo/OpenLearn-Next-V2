/**
 * 课程包（Course Package）HTTP 接口。
 *
 * - `GET  /api/course-packages/template`      下载内置课程模板（JSON，自包含附件）
 * - `POST /api/course-packages/import`        导入一个课程包（单事务写入）
 *
 * 与 `POST /api/lessons`（CSV 批量导入的落点）并列，但走的是**完整**的导入语义：
 * 教学环节 + 白板元素 + 课件附件一起落库，失败整体回滚。
 */
import { getActorId, requireAuth } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import { buildTemplateCoursePackage, parseCoursePackage } from '../services/course-package.js';
import { importCoursePackage } from '../services/course-package-import.js';
import type { ServerContext } from '../context.js';

/** 模板下载文件名（Content-Disposition 用）。 */
const TEMPLATE_FILENAME = 'openlearn-course-template.json';

export function registerCoursePackageRoutes(ctx: ServerContext) {
  const { app } = ctx;

  /**
   * 下载内置课程模板。
   *
   * 模板是**自包含**的单个 JSON：附件以 base64 内联，导入时再落盘，
   * 因此文件可以在任意实例之间搬运（不依赖导出方机器上的 /uploads 目录）。
   */
  app.get('/api/course-packages/template', requireAuth('teacher', 'administrator'), async (_req, res) => {
    try {
      const template = await buildTemplateCoursePackage();
      const body = JSON.stringify(template, null, 2);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${TEMPLATE_FILENAME}"`);
      res.send(body);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 导入一个课程包。
   *
   * 请求体既接受 `{ package: {...} }`，也接受课程包本身（顶层即 package）。
   */
  app.post('/api/course-packages/import', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const body = req.body;
      const raw = body && typeof body === 'object' && 'package' in body ? (body as any).package : body;

      const parsed = parseCoursePackage(raw);
      if (!parsed.ok) {
        return res.status(400).json({ success: false, error: parsed.error });
      }

      const session = (req as any).session;
      const creatorId = session?.userId || session?.username || getActorId(req) || 'usr_teacher';

      const result = await importCoursePackage(parsed.package, { creatorId });

      res.json({ success: true, result });
    } catch (e: any) {
      console.error('[CoursePackage] 导入失败:', e);
      sendSafeError(res, e);
    }
  });
}
