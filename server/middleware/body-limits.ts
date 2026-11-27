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
 *  - 装配顺序（必须在全局 parser **之前**）在模块内自洽，读代码即可确认；
 *  - 可以在一个裸 express app 上单独挂载并断言行为（见 __tests__/body-limits.test.ts）。
 *
 * ## 全局上限可配置（管理后台 → 站点信息设置）
 *
 * 全局 2MB 是安全默认值，但不同学校的业务请求体差异很大（大教案、内联图片、
 * 白板快照等），硬编码会把正常业务请求以裸 413 拒掉。现由
 * `site_settings.api_body_limit_mb` 配置，`mountConfigurableBodyParsers` 每次
 * 解析请求体前读取一次，管理员保存后**无需重启**即可生效。
 */
import type Database from 'better-sqlite3';
import express from 'express';
import {
  COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES,
  COURSE_PACKAGE_IMPORT_PATH,
  COURSE_PACKAGE_MAX_FILE_BYTES,
} from '../services/course-package.js';

/** 全局请求体上限默认值（MB），与历史硬编码 `2mb` 保持一致。 */
export const DEFAULT_API_BODY_LIMIT_MB = 2;
/** 管理后台可配置的最小值（MB）。 */
export const MIN_API_BODY_LIMIT_MB = 1;
/**
 * 管理后台可配置的最大值（MB）。
 *
 * 全局上限作用于所有非上传端点，抬得越高，恶意/异常请求造成的内存放大风险越大；
 * 50MB 足以覆盖当前业务里最大的内联 JSON（白板快照、大教案），又远低于
 * 专用上传端点的 110MB。需要更大体积的文件请走上传端点。
 */
export const MAX_API_BODY_LIMIT_MB = 50;

/**
 * 把任意来源（数据库 / 请求体）的上限值归一化为可用的 MB 整数。
 *
 * 非法值（空、非整数、越界）一律回落到安全默认值，避免坏配置把服务带崩。
 */
export function normalizeApiBodyLimitMb(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_API_BODY_LIMIT_MB;
  const value = Number(raw);
  if (!Number.isInteger(value)) return DEFAULT_API_BODY_LIMIT_MB;
  if (value < MIN_API_BODY_LIMIT_MB) return DEFAULT_API_BODY_LIMIT_MB;
  if (value > MAX_API_BODY_LIMIT_MB) return MAX_API_BODY_LIMIT_MB;
  return value;
}

/**
 * 读取管理员配置的全局请求体上限（MB）。
 *
 * 列缺失（旧库/极简测试库）时回落到默认值，不阻断请求。
 * 单次主键 SELECT 开销极低，且只在「可能带请求体」的请求上调用（见下）。
 */
export function resolveApiBodyLimitMb(db: Pick<Database.Database, 'prepare'>): number {
  try {
    const row = db.prepare('SELECT api_body_limit_mb FROM site_settings WHERE id = ?').get('global') as
      { api_body_limit_mb?: unknown } | undefined;
    return normalizeApiBodyLimitMb(row?.api_body_limit_mb);
  } catch {
    return DEFAULT_API_BODY_LIMIT_MB;
  }
}

/**
 * 挂载「上限可配置」的全局 JSON / urlencoded 解析器。
 *
 * body-parser 的 `limit` 在创建时固定，因此这里按当前配置缓存一对解析器，
 * 配置变化时重建 —— 管理员保存后下一个请求即生效，无需重启。
 *
 * **必须挂在 `mountLargeBodyParsers` 之后**：专用上传端点的解析器要先消费请求体。
 */
export function mountConfigurableBodyParsers(app: express.Express, resolveLimitMb: () => number): void {
  let cachedLimitMb = DEFAULT_API_BODY_LIMIT_MB;
  let jsonParser = express.json({ limit: `${cachedLimitMb}mb` });
  let urlencodedParser = express.urlencoded({ limit: `${cachedLimitMb}mb`, extended: true });

  app.use((req, res, next) => {
    // 没有请求体的请求（绝大多数 GET / 静态资源）不读配置，避免给热路径加库查询。
    // 判定逻辑与 body-parser 的 hasBody 保持一致（content-length: '0' 也视为有请求体）。
    const hasBody = 'transfer-encoding' in req.headers || !Number.isNaN(Number(req.headers['content-length']));
    if (!hasBody) return next();

    const limitMb = normalizeApiBodyLimitMb(resolveLimitMb());
    if (limitMb !== cachedLimitMb) {
      cachedLimitMb = limitMb;
      jsonParser = express.json({ limit: `${limitMb}mb` });
      urlencodedParser = express.urlencoded({ limit: `${limitMb}mb`, extended: true });
    }

    jsonParser(req, res, (err?: unknown) => {
      if (err) return next(err);
      urlencodedParser(req, res, next);
    });
  });
}

/**
 * 允许接收超大请求体的端点（解析上限 110MB）。
 *
 * 这些端点的共同点是「请求体本身就是文件内容」：课件上传、插件 zip、系统交互课件资源等。
 */
export const LARGE_UPLOAD_ENDPOINTS = [
  '/api/upload',
  '/api/courseware/upload',
  '/api/courseware/inline',
  '/api/plugins/upload-zip',
  '/api/resources',
];

/** 大文件上传端点的解析上限。 */
export const LARGE_UPLOAD_LIMIT = '110mb';

/**
 * 允许接收中等体量多媒体与 Base64 请求的端点（解析上限 30MB）。
 *
 * 这些端点传输由业务侧管控上限的文件或图片：
 * - /api/auth/avatar: 个人头像上传（后端业务校验文件 ≤ 2MB，但 base64 编码后约 2.8MB，必须放行至业务校验层）
 * - /api/timetable/ocr: 课表多模态 OCR 视觉识别（用户手机拍摄或截屏的课表原图常在 3MB~15MB）
 * - /api/site-settings: 站点品牌 Logo（支持 DataURL 上传）
 * - /api/agent/chat: 智能助手对话附件传输
 */
export const MEDIUM_UPLOAD_ENDPOINTS = [
  '/api/auth/avatar',
  '/api/timetable/ocr',
  '/api/site-settings',
  '/api/agent/chat',
];

/** 中等体量上传端点的解析上限。 */
export const MEDIUM_UPLOAD_LIMIT = '30mb';

/**
 * 挂载大体积请求体解析器。
 *
 * **必须在全局解析器（`mountConfigurableBodyParsers`）之前调用** —— body parser
 * 是「谁先处理谁说了算」，挂晚了就等于没挂。
 */
export function mountLargeBodyParsers(app: express.Express): void {
  // 1) 文件直传类端点：110MB
  app.use(
    LARGE_UPLOAD_ENDPOINTS,
    express.json({ limit: LARGE_UPLOAD_LIMIT }),
    express.urlencoded({ limit: LARGE_UPLOAD_LIMIT, extended: true }),
  );

  // 2) 中等体量多媒体与 OCR 端点：30MB
  app.use(
    MEDIUM_UPLOAD_ENDPOINTS,
    express.json({ limit: MEDIUM_UPLOAD_LIMIT }),
    express.urlencoded({ limit: MEDIUM_UPLOAD_LIMIT, extended: true }),
  );

  // 3) 课程包导入（Issue #246）：请求体是「自包含 JSON + base64 内联附件」，
  //    体积天然远超普通业务请求，但不能照搬到 110MB —— 课程包有明确的产品上限，
  //    这里按 COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES 单独开一个口子。
  //    此前该端点只吃全局 2MB 解析器：模板自带的极小课件能过，
  //    教师换上真实课件（数 MB × base64 膨胀 1.37 倍）必然 413。
  app.use(
    COURSE_PACKAGE_IMPORT_PATH,
    express.json({ limit: COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES }),
    express.urlencoded({ limit: COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES, extended: true }),
  );

  // 4) 课程包导入超限：给出能指到真实原因的错误，而不是裸的 "request entity too large"
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
