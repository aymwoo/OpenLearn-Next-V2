/**
 * 请求体体积上限的装配点。
 *
 * ## 为什么单独抽一个模块（Issue #246）
 *
 * `server.ts` 里「哪些端点可以吃大请求体」的装配逻辑此前是内联的，
 * 既没法单测、也没法在别处复用；而这恰恰是 #246 的病根 ——
 * 课程包导入端点不在白名单里，被全局 2MB 上限拒掉真实课件，
 * 与产品对教师的「20MB」承诺直接矛盾。
 *
 * 抽出来之后：
 *  - 装配顺序（必须在全局 2MB parser **之前**）在模块内自洽，读代码即可确认；
 *  - 可以在一个裸 express app 上单独挂载并断言行为（见 __tests__/body-limits.test.ts）。
 */
import express from 'express';
import {
  COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES,
  COURSE_PACKAGE_IMPORT_PATH,
  COURSE_PACKAGE_MAX_FILE_BYTES,
} from '../services/course-package.js';

/**
 * 允许接收超大请求体的端点（解析上限 110MB）。
 *
 * 这些端点的共同点是「请求体本身就是文件内容」：课件上传、插件 zip 等。
 */
export const LARGE_UPLOAD_ENDPOINTS = [
  '/api/upload',
  '/api/courseware/upload',
  '/api/courseware/inline',
  '/api/plugins/upload-zip',
];

/** 大文件上传端点的解析上限。 */
export const LARGE_UPLOAD_LIMIT = '110mb';

/**
 * 挂载大体积请求体解析器。
 *
 * **必须在全局 `express.json({ limit: '2mb' })` 之前调用** —— body parser
 * 是「谁先处理谁说了算」，挂晚了就等于没挂。
 */
export function mountLargeBodyParsers(app: express.Express): void {
  // 1) 文件直传类端点：110MB
  app.use(
    LARGE_UPLOAD_ENDPOINTS,
    express.json({ limit: LARGE_UPLOAD_LIMIT }),
    express.urlencoded({ limit: LARGE_UPLOAD_LIMIT, extended: true }),
  );

  // 2) 课程包导入（Issue #246）：请求体是「自包含 JSON + base64 内联附件」，
  //    体积天然远超普通业务请求，但不能照搬到 110MB —— 课程包有明确的产品上限，
  //    这里按 COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES 单独开一个口子。
  //    此前该端点只吃全局 2MB 解析器：模板自带的极小课件能过，
  //    教师换上真实课件（数 MB × base64 膨胀 1.37 倍）必然 413。
  app.use(
    COURSE_PACKAGE_IMPORT_PATH,
    express.json({ limit: COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES }),
    express.urlencoded({ limit: COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES, extended: true }),
  );

  // 3) 课程包导入超限：给出能指到真实原因的错误，而不是裸的 "request entity too large"
  app.use(
    COURSE_PACKAGE_IMPORT_PATH,
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      const type = err && typeof err === 'object' ? (err as { type?: unknown }).type : undefined;
      if (type === 'entity.too.large') {
        return res.status(413).json({
          success: false,
          code: 'COURSE_PACKAGE_TOO_LARGE',
          error:
            `课程包体积超过上限（文件 ≤ ${COURSE_PACKAGE_MAX_FILE_BYTES / (1024 * 1024)}MB，` +
            `请求体 ≤ ${COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES / (1024 * 1024)}MB）。` +
            '请精简附件（课程包内附件以 base64 内联，体积约放大 1.37 倍）后重试。',
        });
      }
      next(err);
    },
  );
}
