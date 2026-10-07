/**
 * 出站 URL 安全校验（SSRF 防护）。
 *
 * 该逻辑原本内联在 `server/routes/plugins.ts` 中，被插件一键更新与 AI 供应商
 * 连通性测试复用。社区插件市场同样需要对「注册表地址」与「插件包下载地址」
 * 做同等校验，故提取为共享工具，保证全平台只有一处实现、一处修规则。
 */
import net from 'net';

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
}

/**
 * 把 IPv6 展开为 8 组 16 位段的数值数组；非法返回 null。
 *
 * 处理**内嵌点分十进制尾段**：`::ffff:127.0.0.1` / `::127.0.0.1` 这类混合记法。
 * `net.isIPv6` 认它们合法，但朴素的 `split(':')` 会得到含点号的伪十六进制组，
 * `parseInt('127.0.0.1', 16)` → NaN → 整段返回 null → 私网判定被跳过。
 * 这正是 G-4c 的 DNS 层实测发现的缺口（dns.lookup 可能返回该形式）。
 */
function expandIPv6(addr: string): Array<number> | null {
  if (!net.isIPv6(addr)) return null;

  // 尾段是点分十进制：拆成两个 16 位组（a.b.c.d → 高 16 位 / 低 16 位）
  const lastColon = addr.lastIndexOf(':');
  const maybeV4 = addr.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const octets = parseIpv4NumericHostname(maybeV4);
    if (!octets) return null;
    const high = (octets[0] << 8) | octets[1];
    const low = (octets[2] << 8) | octets[3];
    addr = `${addr.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  let head: string[] = [];
  let tail: string[] = [];
  const doubleColon = addr.split('::');
  if (doubleColon.length > 2) return null; // 多个 :: 非法（net.isIPv6 已兜底，防御性）
  if (doubleColon.length === 2) {
    head = doubleColon[0] ? doubleColon[0].split(':') : [];
    tail = doubleColon[1] ? doubleColon[1].split(':') : [];
  } else {
    head = addr.split(':');
  }
  if (head.length + tail.length > 8) return null;
  const missing = 8 - head.length - tail.length;
  const groups = [...head, ...Array.from({ length: Math.max(missing, 0) }, () => '0'), ...tail];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * IPv4 数值私网/保留段判定（octets 已是 0~255）。
 *
 * G-4c 补齐的段（原先全部放行，均为实测确认）：
 * | 段                | 用途                          | 为何要拦                |
 * | ----------------- | ----------------------------- | ----------------------- |
 * | 100.64.0.0/10     | 运营商级 NAT (RFC 6598)       | k8s / 容器网络常用段     |
 * | 192.0.0.0/24      | IETF 协议分配（含 NAT64 发现）| 可探测宿主网络           |
 * | 198.18.0.0/15     | 基准测试 (RFC 2544)           | 非常规段                 |
 * | 192.0.2.0/24      | TEST-NET-1 (RFC 5737)         | 文档用段，不应被路由     |
 * | 198.51.100.0/24   | TEST-NET-2 (RFC 5737)         | 同上                     |
 * | 203.0.113.0/24    | TEST-NET-3 (RFC 5737)         | 同上                     |
 */
function isForbiddenIPv4(octets: Array<number>): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 || // 未指定 0.0.0.0/8
    a === 10 || // 私网 10/8
    a === 127 || // 回环 127/8
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // 链路本地 169.254/16（含云元数据 169.254.169.254）
    (a === 172 && b >= 16 && b <= 31) || // 私网 172.16/12
    (a === 192 && b === 0 && c === 0) || // IETF 协议分配 192.0.0/24
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1 192.0.2/24
    (a === 192 && b === 168) || // 私网 192.168/16
    (a === 198 && (b === 18 || b === 19)) || // 基准测试 198.18/15
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2 198.51.100/24
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3 203.0.113/24
    a >= 224 // 组播 224/4 + 保留 240/4
  );
}

/** IPv6 私网/保留段判定（expanded 为 8 组 16 位数值） */
function isForbiddenIPv6(expanded: Array<number>): boolean {
  const isAllZero = expanded.every((g) => g === 0);
  if (isAllZero) return true; // 未指定地址 ::
  // loopback ::1：前 7 组全 0、末组为 1
  if (expanded.slice(0, 7).every((g) => g === 0) && expanded[7] === 1) return true;
  // ULA fc00::/7：首字节 0xfc / 0xfd
  if ((expanded[0] & 0xfe00) === 0xfc00) return true;
  // 链路本地 fe80::/10：首 10 位 1111111010
  if ((expanded[0] & 0xffc0) === 0xfe80) return true;
  // 组播 ff00::/8
  if ((expanded[0] & 0xff00) === 0xff00) return true;
  // IPv4 映射 ::ffff:0:0/96：前 5 组全 0、第 6 组 0xffff —— 末 32 位按 IPv4 私网判定
  if (expanded.slice(0, 5).every((g) => g === 0) && expanded[5] === 0xffff) {
    const o1 = (expanded[6] >> 8) & 0xff;
    const o2 = expanded[6] & 0xff;
    const o3 = (expanded[7] >> 8) & 0xff;
    const o4 = expanded[7] & 0xff;
    return isForbiddenIPv4([o1, o2, o3, o4]);
  }
  return false;
}

/**
 * 非点分十进制主机名的 IPv4 数值编码归一化。
 * 仅当 hostname 整体是「纯十进制整数」（2130706433 → 127.0.0.1）或「恰 4 段且
 * 每段为十六进制(0x..)/八进制(0..)/十进制」时才解析出 4 个 octet；
 * 其余（普通域名，含 abc123.com、1x.dev 这类含数字域名）返回 null 放行。
 * 宁漏勿误：不认识的格式一律不放行到私网判定，也不拒绝。
 */
function parseIpv4NumericHostname(hostname: string): Array<number> | null {
  // 1) 整段数字形式（inet_aton 语义）：十进制整数 / 0x 十六进制整数 / 前导 0 八进制整数，
  //    均按 32 位大端展开（2130706433、0x7f000001、017700000001 → 127.0.0.1）
  if (/^(0[xX][0-9a-fA-F]+|\d+)$/.test(hostname)) {
    let num: number;
    if (/^0[xX]/.test(hostname)) {
      num = parseInt(hostname.slice(2), 16);
    } else if (/^0\d+$/.test(hostname) && /^[0-7]+$/.test(hostname.slice(1))) {
      // 前导 0 且全为八进制数字 → inet_aton 按八进制解释
      num = parseInt(hostname.slice(1), 8);
    } else {
      num = Number(hostname);
    }
    if (!Number.isSafeInteger(num) || num < 0 || num >= 2 ** 32) return null;
    return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff];
  }
  // 2) 恰 4 段，每段为十六进制/八进制/十进制数字字面量
  const segments = hostname.split('.');
  if (segments.length !== 4) return null;
  const octetRe = /^(0[xX][0-9a-fA-F]+|0[0-7]*|\d+)$/;
  if (!segments.every((s) => octetRe.test(s))) return null;
  // 注意：Number('0177') === 177（十进制），必须按前缀显式选进制 —— 0177 在
  // URL 规范里是八进制 127，解析错会让 0177.0.0.1 绕过私网判定。
  const octets = segments.map((s) => {
    let n: number;
    if (/^0[xX]/.test(s)) n = parseInt(s.slice(2), 16);
    else if (/^0\d/.test(s)) n = parseInt(s.slice(1), 8);
    else n = parseInt(s, 10);
    return Number.isSafeInteger(n) && n >= 0 && n <= 255 ? n : -1;
  });
  if (octets.some((o) => o < 0)) return null;
  return octets;
}

/**
 * 判断一个 URL 是否允许服务端发起出站请求。
 *
 * 拒绝：非 HTTP(S)、回环/本地域名、私有网段与链路本地 IPv4（含点分十进制与
 * 十六进制/八进制编码绕过）、IPv6 私网/保留段字面量（含 ::ffff: IPv4 映射地址）。
 * 注意：本函数只做字面量校验，不解析 DNS。若后续需要防御 DNS rebinding，
 * 需在 fetch 前固定已解析 IP。
 */
export function isSafeExternalUrl(urlStr: string): UrlSafetyResult {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: 'Only HTTP and HTTPS protocols are allowed' };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      return { safe: false, reason: 'Access to loopback/local addresses is forbidden' };
    }
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number);
      if (isForbiddenIPv4(octets)) {
        return { safe: false, reason: 'Access to private or link-local IP addresses is forbidden' };
      }
      return { safe: true };
    }
    // IPv6 括号字面量：URL hostname 保留方括号
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      const ip6 = hostname.slice(1, -1);
      const expanded = expandIPv6(ip6);
      if (!expanded) {
        return { safe: false, reason: 'Invalid IPv6 literal' };
      }
      if (isForbiddenIPv6(expanded)) {
        return { safe: false, reason: 'Access to private or reserved IPv6 addresses is forbidden' };
      }
      return { safe: true };
    }
    // IP 编码绕过归一化：纯十进制整数 / 十六进制·八进制混合四段
    const numericOctets = parseIpv4NumericHostname(hostname);
    if (numericOctets) {
      if (isForbiddenIPv4(numericOctets)) {
        return { safe: false, reason: 'Access to private or link-local IP addresses is forbidden' };
      }
      return { safe: true };
    }
    return { safe: true };
  } catch (e: any) {
    return { safe: false, reason: `Invalid URL format: ${e.message}` };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// G-4c：DNS rebinding 与重定向防护
// ────────────────────────────────────────────────────────────────────────────

/**
 * ## 为什么需要这两层
 *
 * `isSafeExternalUrl` 只做 **URL 字面量**校验，实测确认它挡不住两条路径：
 *
 * ### ① 重定向不复检（实测已复现）
 *
 * ```
 * 原始 URL 字面量校验: {"safe":false}          ← 若指向内网会被拦
 * fetch 默认 redirect=follow → 最终 status: 200
 * fetch 最终 response.url: http://127.0.0.1:33409/latest/meta-data/iam/security-credentials/
 * 内网端点被真实命中: 是，收到 1 次
 * 响应体: {"stolen":"SECRET", ...}
 * ```
 *
 * `fetch` 默认 `redirect: 'follow'`，且**不会**把重定向后的 URL 再过一次校验。
 * 所以「表面合规的域名 → 302 → 内网元数据服务」是一条完整的 SSRF 链。
 * 修复必须用 `redirect: 'manual'` 逐跳跟随、每跳复检（见 `fetchWithSafeRedirects`）。
 *
 * ### ② DNS 从不解析（字面量合法，解析结果可能是内网）
 *
 * `isSafeExternalUrl` 从不调用 DNS，所以下面这些一律放行：
 *
 * ```
 * http://localhost.attacker.example/pkg.zip     {"safe":true}
 * http://metadata.google.internal/pkg.zip       {"safe":true}
 * http://evil.example/latest/meta-data/         {"safe":true}
 * ```
 *
 * 攻击者让域名的 A 记录指向 `169.254.169.254`（云厂商元数据端点）即可绕过。
 * 修复方式是 fetch 前解析 DNS 并校验每个返回地址（见 `assertSafeResolvedAddresses`）。
 */

import dns from 'node:dns/promises';

/** 出站请求允许跟随的最大重定向跳数（RFC 7231 建议 20，取更保守值） */
export const MAX_SAFE_REDIRECTS = 5;

/**
 * 解析 hostname 并校验每个返回地址是否落在禁止段。
 *
 * 注意这是 **TOCTOU 缓解**而非根治：校验通过到真正建连之间，攻击者仍可能换掉
 * DNS 记录（rebinding）。彻底根治需要把已校验的 IP 固定到连接上
 * （`undici` Agent + 自定义 `lookup`，与本仓库 fetch 封装方式不兼容，
 * 且浏览器端无此能力）。当前实现挡住的是「静态指向内网」这一主流手法。
 *
 * @param hostname 纯主机名（不含方括号、不含端口）
 * @param lookupImpl 可注入的 DNS 实现（测试用）
 */
export async function assertSafeResolvedAddresses(
  hostname: string,
  lookupImpl: (hostname: string, opts: { all: true }) => Promise<Array<{ address: string }>> = (h, o) =>
    dns.lookup(h, o) as unknown as Promise<Array<{ address: string }>>,
): Promise<UrlSafetyResult> {
  // 字面量已是 IP 的情况在 isSafeExternalUrl 里判过，无需再解析。
  if (net.isIP(hostname) || hostname.startsWith('[')) return { safe: true };

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupImpl(hostname, { all: true });
  } catch (err: any) {
    // DNS 解析失败 —— 不放行。放行等于把「解析异常」当成「安全」。
    return { safe: false, reason: `DNS resolution failed: ${err?.code ?? err?.message ?? String(err)}` };
  }
  if (!addresses || addresses.length === 0) {
    return { safe: false, reason: 'DNS resolution returned no addresses' };
  }

  for (const { address } of addresses) {
    const verdict = isForbiddenAddress(address);
    if (verdict) {
      return {
        safe: false,
        reason: `Hostname resolves to a forbidden address (${address}): ${verdict}`,
      };
    }
  }
  return { safe: true };
}

/** 单个 IP 字面量是否落在禁止段；返回禁止原因，安全则返回 null */
function isForbiddenAddress(address: string): string | null {
  if (net.isIPv4(address)) {
    return isForbiddenIPv4(address.split('.').map(Number)) ? 'private, loopback or link-local IPv4' : null;
  }
  if (net.isIPv6(address)) {
    const expanded = expandIPv6(address);
    if (expanded) return isForbiddenIPv6(expanded) ? 'private or reserved IPv6' : null;
    return 'invalid IPv6 literal';
  }
  return `unparsable address (${address})`;
}

export interface SafeFetchOptions {
  /** 单请求超时 */
  timeoutMs?: number;
  /** 请求方法 */
  method?: string;
  /** 请求体 */
  body?: BodyInit | null;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 测试注入：DNS 实现 */
  lookupImpl?: (hostname: string, opts: { all: true }) => Promise<Array<{ address: string }>>;
  /** 测试注入：fetch 实现（必须支持 redirect:'manual'） */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** 已做过字面量校验的 URL，跳过重复校验（仅内部使用） */
  prevalidated?: boolean;
}

/**
 * 带 SSRF 防护的 fetch：字面量校验 + DNS 校验 + 逐跳复检的重定向跟随。
 *
 * 与直接 `fetch` 的差异：
 *  1. `redirect: 'manual'` —— 自己跟随，每一跳重新走全部校验
 *  2. 每一跳（含首跳）都做 DNS 解析校验
 *  3. 超时跳数上限，防止重定向环
 */
export async function fetchWithSafeRedirects(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const doLookup = options.lookupImpl;

  let current = url;
  for (let hop = 0; hop <= MAX_SAFE_REDIRECTS; hop++) {
    if (!options.prevalidated) {
      const literal = isSafeExternalUrl(current);
      if (!literal.safe) {
        throw new UrlSafetyError(`Blocked unsafe URL "${current}": ${literal.reason}`);
      }
      const resolved = await assertSafeResolvedAddresses(new URL(current).hostname, doLookup);
      if (!resolved.safe) {
        throw new UrlSafetyError(`Blocked unsafe URL "${current}": ${resolved.reason}`);
      }
    }

    const response = await fetchImpl(current, {
      redirect: 'manual',
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });

    // 3xx 且带 Location → 逐跳复检后跟随
    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers?.get?.('location');
    if (!isRedirect || !location) return response;

    if (hop === MAX_SAFE_REDIRECTS) {
      throw new UrlSafetyError(`Too many redirects (>${MAX_SAFE_REDIRECTS}) starting from "${url}"`);
    }

    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new UrlSafetyError(`Invalid redirect target "${location}" from "${current}"`);
    }
    // 下一跳必须重新走字面量 + DNS 校验 —— 这正是原实现缺的那一环
    options = { ...options, prevalidated: false };
    current = next;
  }

  throw new UrlSafetyError(`Too many redirects (>${MAX_SAFE_REDIRECTS}) starting from "${url}"`);
}

/** 出站 URL 被安全策略拦截时抛出。独立类型便于调用方区分「安全拦截」与「网络故障」。 */
export class UrlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlSafetyError';
  }
}
