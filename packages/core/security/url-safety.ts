/**
 * 链接安全（前后端共用）。
 *
 * 学生的作品路径 / 链接、插件清单里的 repository / homepage 等字段都是**用户可控**的，
 * 最终会被渲染成 `<a href="...">`。协议不受限的话，`javascript:` / `data:` 之类
 * 的值就会进入 href —— 现代浏览器虽然会拦截 `javascript:` 导航，但
 * `data:text/html`、以及各种「协议相对」与大小写/空白变体仍会构成钓鱼或注入面。
 *
 * 这里给出唯一的白名单入口：
 *
 * - 写入侧（服务端）：落库前校验，拒绝非法协议的值；
 * - 读取侧（前端）：渲染进 href 前再过一次，覆盖历史脏数据与
 *   「绕过写入侧」的其他入口（插件清单、CSV 导入等）。
 *
 * 与富文本净化（`./html-sanitize.ts`）是同一套思路：**输入不可信，输出收敛**。
 */

/** 允许出现在 href 中的绝对 URL 协议。 */
export const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'] as const;

/** 协议语法：`scheme:` 开头（RFC 3986 的 scheme 规则）。 */
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * 控制字符（不含空格）：浏览器会忽略 URL 里的 `\n` / `\t` / `\r`，
 * 于是 `java\nscript:alert(1)` 在部分环境下会被拼成可执行的 `javascript:` 协议。
 */
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * 把一个用户提供的链接 / 路径收敛成可以安全放进 `href` 的值。
 *
 * 规则：
 * 1. 非字符串、空串 → 拒绝；
 * 2. 含控制字符 → 拒绝（避免 `java\nscript:` 这类拼接绕过）；
 * 3. 以 `//` 或 `\\` 开头（协议相对外链）→ 拒绝；
 * 4. 带 scheme 的绝对 URL → scheme 必须在白名单内（`http:` / `https:`）；
 * 5. 其余视为站内相对路径 → 放行。
 *
 * @returns 安全的 href；不合法时返回 `null`（调用方应当不渲染链接）。
 */
export function sanitizeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (CONTROL_CHAR_PATTERN.test(value)) return null;
  if (value.startsWith('//') || value.startsWith('\\\\')) return null;

  const schemeMatch = SCHEME_PATTERN.exec(value);
  if (schemeMatch) {
    // 保留冒号，与 ALLOWED_URL_PROTOCOLS 的取值形态一致（'http:' / 'https:'）
    const scheme = value.slice(0, value.indexOf(':') + 1).toLowerCase();
    if (!(ALLOWED_URL_PROTOCOLS as readonly string[]).includes(scheme)) return null;
  }
  return value;
}

/** `sanitizeHref` 的布尔版本。 */
export function isSafeHref(raw: unknown): boolean {
  return sanitizeHref(raw) !== null;
}
