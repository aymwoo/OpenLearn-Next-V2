import crypto from 'crypto';

/**
 * 课件 HTML 访问令牌（SEC-AUTH）。
 *
 * Why: `GET /api/courseware/:id` 是课件 iframe 的 src，而沙箱 iframe（无
 * `allow-same-origin` + `credentialless`）的请求**不携带会话 cookie**（SameSite=Lax
 * 且发起方为不透明 origin），无法用 `requireAuth` 保护，否则所有课件加载都会 401。
 * 改为两步：已认证的父页面经 `GET /api/courseware/:id/access-token` 铸造短时
 * HMAC token，iframe URL 以 `?ct=` 携带，路由侧验签后放行。
 *
 * 密钥为**每次进程启动随机生成**：token 只服务「父页面已认证 → iframe 拉取 HTML」
 * 这一瞬间的桥接（默认 30 分钟有效期），重启失效是可接受的（页面刷新即重新铸造）。
 */

const SECRET = crypto.randomBytes(32);
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/** 为指定课件铸造访问 token（`<exp>.<hmac(coursewareId.exp)>`）。 */
export function mintCoursewareToken(coursewareId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  return `${exp}.${sign(`${coursewareId}.${exp}`)}`;
}

/** 验证 token 与课件 id 的绑定及有效期（timing-safe 比较）。 */
export function verifyCoursewareToken(coursewareId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const sig = token.slice(dot + 1);
  const expected = sign(`${coursewareId}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
