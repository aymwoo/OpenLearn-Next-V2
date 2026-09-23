/**
 * 出站 URL 安全校验（SSRF 防护）。
 *
 * 该逻辑原本内联在 `server/routes/plugins.ts` 中，被插件一键更新与 AI 供应商
 * 连通性测试复用。社区插件市场同样需要对「注册表地址」与「插件包下载地址」
 * 做同等校验，故提取为共享工具，保证全平台只有一处实现、一处修规则。
 */

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
}

/**
 * 判断一个 URL 是否允许服务端发起出站请求。
 *
 * 拒绝：非 HTTP(S)、回环/本地域名、私有网段与链路本地 IPv4、多播/保留网段。
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
      if (
        octets[0] === 127 ||
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 169 && octets[1] === 254) ||
        octets[0] === 0 ||
        octets[0] >= 224
      ) {
        return { safe: false, reason: 'Access to private or link-local IP addresses is forbidden' };
      }
    }
    return { safe: true };
  } catch (e: any) {
    return { safe: false, reason: `Invalid URL format: ${e.message}` };
  }
}
