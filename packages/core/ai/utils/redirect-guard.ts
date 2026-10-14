/**
 * AI 出站地址复检（对话 / 批改 / 课表 / Provider Gateway）。
 *
 * 放在 packages/core 内，供 fetchWithRetry 使用。不得反向依赖 server/。
 * 社区安装与「测试提供商」仍走 server 侧带 DNS 的 fetchWithSafeRedirects；
 * 这里只做字面量复检，挡住重定向把已解密的 Bearer 送到回环、私网或链路本地。
 */

export interface AiHopDecision {
  allowed: boolean;
  reason?: string;
}

/** 每一跳（含首跳）的判定。previousUrl 缺省表示这是管理员配置的首跳。 */
export type AiHopCheck = (url: string, previousUrl?: string) => AiHopDecision;

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog']);

type HostKind = 'public' | 'loopback' | 'private' | 'link-local' | 'metadata' | 'blocked' | 'invalid';

function stripBrackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1);
  return hostname;
}

function classifyIpv4(octets: number[]): HostKind | null {
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  const c = octets[2] ?? -1;
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private';
  if (a === 0) return 'blocked';
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return 'blocked';
  if (a === 198 && (b === 18 || b === 19)) return 'blocked';
  if (a === 198 && b === 51 && c === 100) return 'blocked';
  if (a === 203 && b === 0 && c === 113) return 'blocked';
  if (a >= 224) return 'blocked';
  return 'public';
}

/** 展开 IPv6 为 8 组 16 位整数。非法返回 null。 */
function expandIpv6(addr: string): number[] | null {
  let bare = stripBrackets(addr).toLowerCase();
  const lastColon = bare.lastIndexOf(':');
  const tail = lastColon >= 0 ? bare.slice(lastColon + 1) : '';
  if (tail.includes('.')) {
    const v4 = tail.split('.').map((part) => Number(part));
    const kind = classifyIpv4(v4);
    if (!kind) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    bare = `${bare.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - rest.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array.from({ length: missing }, () => '0'), ...rest];
  if (groups.length !== 8) return null;
  const nums = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return nums;
}

function classifyIpv6(addr: string): HostKind {
  const groups = expandIpv6(addr);
  if (!groups) return 'invalid';
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    return classifyIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]) ?? 'invalid';
  }
  if (groups.every((g) => g === 0)) return 'blocked';
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return 'loopback';
  const first = groups[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return 'private';
  if ((first & 0xffc0) === 0xfe80) return 'link-local';
  if ((first & 0xff00) === 0xff00) return 'blocked';
  return 'public';
}

function classifyHostname(hostname: string): HostKind {
  const host = stripBrackets(hostname).toLowerCase().replace(/\.$/, '');
  if (!host) return 'invalid';
  if (METADATA_HOSTS.has(host)) return 'metadata';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback';
  if (host.endsWith('.local')) return 'private';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return classifyIpv4(host.split('.').map((part) => Number(part))) ?? 'invalid';
  }
  if (host.includes(':')) return classifyIpv6(host);
  return 'public';
}

function sameHost(left: URL, right: URL): boolean {
  return left.hostname.toLowerCase() === right.hostname.toLowerCase() && left.port === right.port;
}

function blockedReason(kind: HostKind): string {
  if (kind === 'link-local') return 'link-local host';
  if (kind === 'metadata') return 'metadata host';
  if (kind === 'invalid') return 'invalid host';
  return 'non-public host';
}

/**
 * 首跳允许管理员显式配置的回环 / 私网（本机 Ollama、内网推理）。
 * 重定向只有两种可以跟随：公网 http(s)，或与上一跳同一主机的回环 / 私网
 * （尾斜杠一类的同主机跳转）。链路本地、元数据主机名、组播和文档地址一律拒绝。
 */
export function assessAiProviderHop(urlStr: string, previousUrl?: string): AiHopDecision {
  let next: URL;
  try {
    next = new URL(urlStr);
  } catch {
    return { allowed: false, reason: 'invalid URL' };
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') {
    return { allowed: false, reason: 'only http and https are allowed' };
  }
  if (next.username || next.password) {
    return { allowed: false, reason: 'credentials in the URL are not allowed' };
  }

  const kind = classifyHostname(next.hostname);
  if (kind === 'link-local' || kind === 'metadata' || kind === 'blocked' || kind === 'invalid') {
    return { allowed: false, reason: blockedReason(kind) };
  }

  if (!previousUrl) return { allowed: true };

  let previous: URL;
  try {
    previous = new URL(previousUrl);
  } catch {
    return { allowed: false, reason: 'invalid URL' };
  }
  if (kind !== 'public' && !sameHost(previous, next)) {
    return { allowed: false, reason: 'redirect to a private or loopback host' };
  }
  return { allowed: true };
}
