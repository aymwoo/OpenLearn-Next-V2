/**
 * 课程包（Course Package）HTTP 接口。
 *
 * - `GET  /api/course-packages/template`      下载内置课程模板（JSON，自包含附件）
 * - `POST /api/course-packages/import`        导入一个课程包（单事务写入）
 * - `GET  /api/lessons/:id/export-package`    把已有课程导出为课程包（自包含附件）
 *
 * 与 `POST /api/lessons`（CSV 批量导入的落点）并列，但走的是**完整**的导入语义：
 * 教学环节 + 白板元素 + 课件附件一起落库，失败整体回滚。
 */
import { getActorId, requireAuth } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import {
  buildTemplateCoursePackage,
  parseCoursePackage,
  COURSE_PACKAGE_MAX_FILE_BYTES,
} from '../services/course-package.js';
import { importCoursePackage, CoursePackageDuplicateError } from '../services/course-package-import.js';
import {
  buildExportFilename,
  CoursePackageExportError,
  exportLessonAsCoursePackage,
} from '../services/course-package-export.js';
import { checkLessonOwnership } from './lessons.js';
import type { ServerContext } from '../context.js';

/** 模板下载文件名（Content-Disposition 用）。 */
const TEMPLATE_FILENAME = 'openlearn-course-template.json';

/**
 * 课程包内附件的**解码后**总体积上限（字节）。
 *
 * 请求体上限挡的是「传输体积」，这里挡的是「真正落盘的文件体积」：
 * 两者不是一回事（base64 膨胀 1.37 倍），但教师关心的是后者 ——
 * 「我的课件到底能带多大」。超出时给出能指到真实原因的错误。
 */
const MAX_DECODED_ASSET_BYTES = COURSE_PACKAGE_MAX_FILE_BYTES;

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
   *
   * `allowDuplicate: true` 表示「命中去重也照常导入一份副本」——
   * 教师确实想导两份时（例如两个班各上一门）用这个开关绕开幂等保护。
   */
  app.post('/api/course-packages/import', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const body = req.body;
      const raw = body && typeof body === 'object' && 'package' in body ? (body as any).package : body;
      const allowDuplicate = Boolean(body && typeof body === 'object' && (body as any).allowDuplicate === true);

      const parsed = parseCoursePackage(raw);
      if (!parsed.ok) {
        return res.status(400).json({ success: false, error: parsed.error });
      }

      // Issue #246：附件解码后的总体积上限。请求体上限管的是「传输体积」，
      // 这里管的是「真正落盘的体积」——教师看到的是后者。
      let decodedBytes = 0;
      for (const asset of parsed.package.assets) {
        decodedBytes += Buffer.byteLength(asset.base64, 'base64');
      }
      if (decodedBytes > MAX_DECODED_ASSET_BYTES) {
        return res.status(413).json({
          success: false,
          code: 'COURSE_PACKAGE_TOO_LARGE',
          error:
            `课程包附件解码后共 ${(decodedBytes / (1024 * 1024)).toFixed(1)}MB，` +
            `超过 ${MAX_DECODED_ASSET_BYTES / (1024 * 1024)}MB 上限。请精简附件后重试。`,
        });
      }

      const session = (req as any).session;
      const creatorId = session?.userId || session?.username || getActorId(req) || 'usr_teacher';

      const result = await importCoursePackage(parsed.package, { creatorId, allowDuplicate });

      res.json({ success: true, result });
    } catch (e: any) {
      // 命中去重：409 + 现有课程信息，前端据此渲染「仍然导入副本」。
      if (e instanceof CoursePackageDuplicateError) {
        return res.status(409).json({
          success: false,
          code: e.code,
          error: e.message,
          duplicate: {
            lessonId: e.existingLessonId,
            lessonTitle: e.existingLessonTitle,
            importedAt: e.existingCreatedAt,
            packageKey: e.packageKey,
            hasDeclaredId: e.hasDeclaredId,
          },
        });
      }
      console.error('[CoursePackage] 导入失败:', e);
      sendSafeError(res, e);
    }
  });

  /**
   * 把已有课程导出为课程包。
   *
   * 与模板下载不同，这里的内容来自教师自己编排的课程：教学环节、白板元素
   * 以及它们引用的 `/uploads/*` 附件都会被逆向打包成自包含 JSON。
   *
   * 权限与白板写操作一致：仅课程创建教师或管理员可导出。
   */
  app.get('/api/lessons/:id/export-package', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { id } = req.params;
      const ownership = checkLessonOwnership(req, id);
      if (!ownership.allowed) {
        return res.status(ownership.status).json({ success: false, error: ownership.error });
      }

      const { package: pkg, stats } = await exportLessonAsCoursePackage(id);
      const filename = buildExportFilename(pkg.lesson.title);

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // filename 用 ASCII 兜底，filename* 携带 UTF-8 中文名（RFC 5987）。
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="course-package.json"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.setHeader('X-Course-Package-Filename', encodeURIComponent(filename));
      res.setHeader('X-Course-Package-Assets', String(stats.assets));
      res.setHeader('X-Course-Package-Skipped', String(stats.skipped.length + stats.skippedElements));
      res.send(JSON.stringify(pkg, null, 2));
    } catch (e) {
      if (e instanceof CoursePackageExportError) {
        return res.status(e.status).json({ success: false, code: e.code, error: e.message });
      }
      console.error('[CoursePackage] 导出失败:', e);
      sendSafeError(res, e);
    }
  });
}
