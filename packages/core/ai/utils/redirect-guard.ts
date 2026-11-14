/**
 * AI 出站地址校验与重定向复检（配置保存 / 连接测试 / 对话 / 批改 / 课表 / Provider Gateway）。
 *
 * 放在 packages/core 内，供前端、后端路由、领域服务与 fetchWithRetry 共享。不得反向依赖 server/。
 * 首跳允许用户/管理员显式配置的公网、回环与私网地址（如本机 Ollama、内网推理），
 * 一律禁止链路本地（169.254/16、fe80::/10）、云元数据主机名、未指定/组播/保留地址及嵌入凭据，
 * 并在重定向时挡住从公网或不同主机跳往回环/私网以防 Bearer 凭据泄漏。
 */

export interface AiHopDecision {
  allowed: boolean;
  reason?: string;
}

/** 每一跳（含首跳）的判定。previousUrl 缺省表示这是用户/管理员配置的首跳。 */
export type AiHopCheck = (url: string, previousUrl?: string) => AiHopDecision;

export type AiProviderUrlErrorCode =
  | 'EMPTY_URL'
  | 'MISSING_PROTOCOL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'INVALID_URL'
  | 'INVALID_HOST'
  | 'CREDENTIALS_NOT_ALLOWED'
  | 'BLOCKED_LINK_LOCAL'
  | 'BLOCKED_METADATA'
  | 'BLOCKED_RESERVED';

export type HostKind = 'public' | 'loopback' | 'private' | 'link-local' | 'metadata' | 'blocked' | 'invalid';

export interface AiProviderUrlValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  hostKind?: HostKind;
  code?: AiProviderUrlErrorCode;
  reason?: string;
}

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog']);

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
  if (groups.every((g) => g === 0)) return 'blocked';
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return 'loopback';
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const ipv4Compatible = groups.slice(0, 6).every((g) => g === 0);
  if (mapped || ipv4Compatible) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    return classifyIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]) ?? 'invalid';
  }
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

const VALIDATION_ERROR_MESSAGES: Record<AiProviderUrlErrorCode, { zh: string; en: string }> = {
  EMPTY_URL: {
    zh: 'API 端点 URL 不能为空。',
    en: 'API endpoint URL is required.',
  },
  MISSING_PROTOCOL: {
    zh: 'API 端点 URL 必须以 http:// 或 https:// 开头（例如 http://192.168.1.10:11434/v1 或 https://api.deepseek.com/v1）。',
    en: 'API endpoint URL must start with http:// or https:// (e.g. http://192.168.1.10:11434/v1 or https://api.deepseek.com/v1).',
  },
  UNSUPPORTED_PROTOCOL: {
    zh: '仅支持 http:// 或 https:// 协议。',
    en: 'Only http:// and https:// protocols are allowed.',
  },
  INVALID_URL: {
    zh: 'URL 格式无效，请检查协议、主机名/IP、端口与路径。',
    en: 'Invalid URL format. Please check the protocol, host/IP, port, and path.',
  },
  INVALID_HOST: {
    zh: 'URL 中包含无效的主机名或 IP 地址。',
    en: 'URL contains an invalid hostname or IP address.',
  },
  CREDENTIALS_NOT_ALLOWED: {
    zh: '安全策略禁止在 API URL 中直接携带用户名或密码凭据。',
    en: 'Security policy forbids embedding username/password credentials in the API URL.',
  },
  BLOCKED_LINK_LOCAL: {
    zh: '安全策略禁止访问链路本地地址（如 169.254.x.x、fe80::）。',
    en: 'Security policy forbids link-local addresses (e.g. 169.254.x.x, fe80::).',
  },
  BLOCKED_METADATA: {
    zh: '安全策略禁止访问云元数据服务主机名。',
    en: 'Security policy forbids cloud metadata hostnames.',
  },
  BLOCKED_RESERVED: {
    zh: '安全策略禁止访问未指定、组播或保留网段地址（如 0.0.0.0、::、224.0.0.0/4）。',
    en: 'Security policy forbids unspecified, multicast, or reserved network addresses (e.g. 0.0.0.0, ::, 224.0.0.0/4).',
  },
};

export function formatAiProviderUrlError(result: AiProviderUrlValidationResult, lang: 'zh' | 'en' = 'zh'): string {
  if (result.code && VALIDATION_ERROR_MESSAGES[result.code]) {
    return VALIDATION_ERROR_MESSAGES[result.code][lang];
  }
  return result.reason || VALIDATION_ERROR_MESSAGES.INVALID_URL[lang];
}

/**
 * 校验 AI Provider 配置 URL（前端、保存接口、测试接口与实际调用共用同一策略）。
 * 允许公网域名/IP、内网私网 IP（10/8、172.16/12、192.168/16、100.64/10、fc00::/7、.local）及本机回环（127/8、localhost、::1），
 * 支持自定义端口与基础路径（如 /v1、/api/v1、/chat/completions）。
 */
export function validateAiProviderUrl(urlStr: string): AiProviderUrlValidationResult {
  const trimmed = typeof urlStr === 'string' ? urlStr.trim() : '';
  if (!trimmed) {
    return { valid: false, code: 'EMPTY_URL', reason: VALIDATION_ERROR_MESSAGES.EMPTY_URL.en };
  }
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
    return { valid: false, code: 'MISSING_PROTOCOL', reason: VALIDATION_ERROR_MESSAGES.MISSING_PROTOCOL.en };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, code: 'INVALID_URL', reason: VALIDATION_ERROR_MESSAGES.INVALID_URL.en };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, code: 'UNSUPPORTED_PROTOCOL', reason: VALIDATION_ERROR_MESSAGES.UNSUPPORTED_PROTOCOL.en };
  }
  if (!parsed.hostname) {
    return { valid: false, code: 'INVALID_HOST', reason: VALIDATION_ERROR_MESSAGES.INVALID_HOST.en };
  }
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      code: 'CREDENTIALS_NOT_ALLOWED',
      reason: VALIDATION_ERROR_MESSAGES.CREDENTIALS_NOT_ALLOWED.en,
    };
  }
  const kind = classifyHostname(parsed.hostname);
  if (kind === 'link-local') {
    return { valid: false, code: 'BLOCKED_LINK_LOCAL', reason: VALIDATION_ERROR_MESSAGES.BLOCKED_LINK_LOCAL.en };
  }
  if (kind === 'metadata') {
    return { valid: false, code: 'BLOCKED_METADATA', reason: VALIDATION_ERROR_MESSAGES.BLOCKED_METADATA.en };
  }
  if (kind === 'blocked') {
    return { valid: false, code: 'BLOCKED_RESERVED', reason: VALIDATION_ERROR_MESSAGES.BLOCKED_RESERVED.en };
  }
  if (kind === 'invalid') {
    return { valid: false, code: 'INVALID_HOST', reason: VALIDATION_ERROR_MESSAGES.INVALID_HOST.en };
  }
  return { valid: true, normalizedUrl: trimmed, hostKind: kind };
}

/** 将 AI Provider 基准地址归一化为 OpenAI `/chat/completions` 请求地址（保留自定义路径、端口与查询参数）。 */
export function buildOpenAIChatUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = cleanPath.endsWith('/chat/completions') ? cleanPath : `${cleanPath}/chat/completions`;
    return parsed.toString();
  } catch {
    if (!trimmed.endsWith('/chat/completions')) {
      return trimmed.endsWith('/') ? `${trimmed}chat/completions` : `${trimmed}/chat/completions`;
    }
    return trimmed;
  }
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
