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

/** 把 IPv6 展开为 8 组 16 位段的数值数组；非法返回 null */
function expandIPv6(addr: string): Array<number> | null {
  if (!net.isIPv6(addr)) return null;
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

/** IPv4 数值私网/保留段判定（octets 已是 0~255） */
function isForbiddenIPv4(octets: Array<number>): boolean {
  return (
    octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254) ||
    octets[0] === 0 ||
    octets[0] >= 224
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
