/**
 * 宿主代发插件的 HTTP 请求。子进程自己的 socket 已被入口脚本封死。
 */

import type { ChildProcess } from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import { isPrivateOrReservedHost } from '../plugin-host/plugin-grants.js';

export interface NetProxyRequest {
  type: 'ol-net-proxy';
  id: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
}

// 移除 'authorization'，允许插件携带第三方 API Token（如 OpenAI Bearer 鉴权）正常转发
const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'cookie']);

const MAX_REQUEST_BODY_BASE64 = 14 * 1024 * 1024; // ~10MB binary
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB limit

export function isNetProxyRequest(msg: unknown): msg is NetProxyRequest {
  return !!msg && typeof msg === 'object' && (msg as { type?: string }).type === 'ol-net-proxy';
}

export async function handleNetProxy(
  child: ChildProcess,
  msg: NetProxyRequest,
  approvedHosts: ReadonlySet<string>,
): Promise<void> {
  const reply = (payload: Record<string, unknown>) => {
    try {
      child.send({ type: 'ol-net-proxy-result', id: msg.id, ...payload });
    } catch {
      /* 子进程已经退出 */
    }
  };

  let target: URL;
  try {
    target = new URL(String(msg.url || ''));
  } catch {
    reply({ ok: false, error: 'invalid proxy url' });
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    reply({ ok: false, error: 'only http(s) can be proxied' });
    return;
  }
  const hostname = target.hostname.toLowerCase();
  if (isPrivateOrReservedHost(hostname)) {
    reply({ ok: false, error: `host ${target.hostname} is blocked (loopback/private/metadata address)` });
    return;
  }
  if (!approvedHosts.has(hostname)) {
    reply({ ok: false, error: `host ${target.hostname} is not approved` });
    return;
  }

  // DNS 预解析校验：若域名解析到内网/环回/链路本地地址，立即阻断（防御 DNS Rebinding / 内网 A 记录）
  if (!net.isIP(hostname) && !hostname.startsWith('[')) {
    try {
      const resolved = await dns.lookup(hostname, { all: true });
      for (const entry of resolved) {
        if (isPrivateOrReservedHost(entry.address)) {
          reply({
            ok: false,
            error: `host ${target.hostname} resolves to forbidden private/internal address (${entry.address})`,
          });
          return;
        }
      }
    } catch {
      // 离线单测（mock fetch）或 DNS 故障交由下游 fetch 处理
    }
  }

  if (msg.bodyBase64 && msg.bodyBase64.length > MAX_REQUEST_BODY_BASE64) {
    reply({ ok: false, error: 'Request body exceeded maximum size limit of 10MB' });
    return;
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(msg.headers || {})) {
    if (typeof value !== 'string' || HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key.toLowerCase()] = value;
  }

  try {
    const timeoutSignal = AbortSignal.timeout(30_000);
    const response = await fetch(target, {
      method: (msg.method || 'GET').toUpperCase(),
      headers,
      body: msg.bodyBase64 ? (Buffer.from(msg.bodyBase64, 'base64') as unknown as BodyInit) : undefined,
      redirect: 'manual',
      signal: timeoutSignal,
    });

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_RESPONSE_BYTES) {
              await reader.cancel('Response exceeded maximum size limit of 10MB');
              throw new Error('Response exceeded maximum size limit of 10MB');
            }
            chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = Buffer.concat(chunks);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    reply({
      ok: true,
      status: response.status,
      headers: responseHeaders,
      bodyBase64: bytes.toString('base64'),
    });
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
