import crypto from 'crypto';

/**
 * 课件 HTML 访问令牌（SEC-AUTH）。
 *
 * Why: `GET /api/courseware/:id` 与 `/runtime/:uuid/` 是课件 iframe 的 src，而沙箱
 * iframe（无 `allow-same-origin` + `credentialless`）的请求**不携带会话 cookie**，
 * 无法用 `requireAuth` 保护，否则所有课件加载都会 401。改为两步：已认证的父页面
 * 铸造短时 HMAC token，iframe URL 以 `?ct=` 携带，路由侧验签后放行。
 *
 * v2（Issue IKYP8P 阶段 F）：token 不再只绑定课件，而是绑定
 * `coursewareId + attemptId + userId + lessonId + exp`。这样 `/runtime` 不再把
 * 所有匿名访问者塞进同一条 `guest` attempt，而是直接使用父页面为其创建/复用的
 * 本人 attempt；提交侧仍由会话 + attempt 归属双重校验。
 *
 * 为了兼容进程内已签发的旧 token，`verifyCoursewareTokenClaims` 同时接受
 * 旧格式 `<exp>.<hmac(coursewareId.exp)>`（没有 attempt/user 信息）。
 *
 * 密钥为**每次进程启动随机生成**：token 只服务「父页面已认证 → iframe 拉取 HTML」
 * 这一瞬间的桥接（默认 30 分钟有效期），重启失效是可接受的（页面刷新即重新铸造）。
 */

const SECRET = crypto.randomBytes(32);
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const TOKEN_PREFIX = 'v2';

export interface CoursewareTokenClaims {
  coursewareId: string;
  attemptId?: string;
  userId?: string;
  lessonId?: string;
  exp: number;
  /** v2 = 绑定声明；legacy = 仅绑定课件 */
  version: 'v2' | 'legacy';
}

export interface MintCoursewareTokenOptions {
  ttlMs?: number;
  attemptId?: string;
  userId?: string;
  lessonId?: string;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function encodeClaims(claims: Omit<CoursewareTokenClaims, 'version'>): string {
  // 短键压缩 token 长度；decodeClaims 必须使用同一套键名
  const compact: Record<string, unknown> = { c: claims.coursewareId, e: claims.exp };
  if (claims.attemptId) compact.a = claims.attemptId;
  if (claims.userId) compact.u = claims.userId;
  if (claims.lessonId) compact.l = claims.lessonId;
  return Buffer.from(JSON.stringify(compact), 'utf8').toString('base64url');
}

function decodeClaims(payload: string): Omit<CoursewareTokenClaims, 'version'> | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const coursewareId = typeof parsed.c === 'string' ? parsed.c : '';
    const exp = typeof parsed.e === 'number' ? parsed.e : Number.NaN;
    if (!coursewareId || !Number.isFinite(exp)) return null;
    return {
      coursewareId,
      exp,
      attemptId: typeof parsed.a === 'string' && parsed.a ? parsed.a : undefined,
      userId: typeof parsed.u === 'string' && parsed.u ? parsed.u : undefined,
      lessonId: typeof parsed.l === 'string' && parsed.l ? parsed.l : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 为指定课件铸造访问 token。
 *
 * 传 `attemptId` / `userId` / `lessonId` 时生成 v2 绑定 token；
 * 只传数字时按旧签名（向后兼容既有调用与测试）。
 */
export function mintCoursewareToken(coursewareId: string, options: number | MintCoursewareTokenOptions = {}): string {
  const opts: MintCoursewareTokenOptions = typeof options === 'number' ? { ttlMs: options } : options || {};
  const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : DEFAULT_TTL_MS;
  const exp = Date.now() + ttlMs;
  const bound = !!(opts.attemptId || opts.userId || opts.lessonId);
  if (!bound) {
    // legacy：`<exp>.<hmac(coursewareId.exp)>`
    return `${exp}.${sign(`${coursewareId}.${exp}`)}`;
  }
  const payload = encodeClaims({
    coursewareId,
    exp,
    attemptId: opts.attemptId,
    userId: opts.userId,
    lessonId: opts.lessonId,
  });
  return `${TOKEN_PREFIX}.${payload}.${sign(`${TOKEN_PREFIX}.${payload}`)}`;
}

/** 验证 token 与课件 id 的绑定及有效期（timing-safe 比较），返回声明或 null。 */
export function verifyCoursewareTokenClaims(
  coursewareId: string,
  token: string | undefined | null,
): CoursewareTokenClaims | null {
  if (!token || typeof token !== 'string') return null;

  if (token.startsWith(`${TOKEN_PREFIX}.`)) {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [, payload, signature] = parts;
    if (!safeEqual(signature, sign(`${TOKEN_PREFIX}.${payload}`))) return null;
    const claims = decodeClaims(payload);
    if (!claims) return null;
    if (claims.coursewareId !== coursewareId) return null;
    if (!Number.isFinite(claims.exp) || claims.exp < Date.now()) return null;
    return { ...claims, version: 'v2' };
  }

  // legacy：`<exp>.<hmac(coursewareId.exp)>`
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, sign(`${coursewareId}.${exp}`))) return null;
  return { coursewareId, exp, version: 'legacy' };
}

/** 验证 token 与课件 id 的绑定及有效期（布尔便捷入口）。 */
export function verifyCoursewareToken(coursewareId: string, token: string | undefined | null): boolean {
  return verifyCoursewareTokenClaims(coursewareId, token) !== null;
}
