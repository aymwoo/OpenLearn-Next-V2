/**
 * 宿主代发插件的 HTTP 请求。子进程自己的 socket 已被入口脚本封死。
 */

import type { ChildProcess } from 'node:child_process';

export interface NetProxyRequest {
  type: 'ol-net-proxy';
  id: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
}

const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'cookie', 'authorization']);

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
  if (!approvedHosts.has(target.hostname.toLowerCase())) {
    reply({ ok: false, error: `host ${target.hostname} is not approved` });
    return;
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(msg.headers || {})) {
    if (typeof value !== 'string' || HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key] = value;
  }

  try {
    const response = await fetch(target, {
      method: (msg.method || 'GET').toUpperCase(),
      headers,
      body: msg.bodyBase64 ? (Buffer.from(msg.bodyBase64, 'base64') as unknown as BodyInit) : undefined,
      redirect: 'manual',
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    reply({
      ok: true,
      status: response.status,
      headers: responseHeaders,
      bodyBase64: bytes.subarray(0, 1024 * 1024).toString('base64'),
    });
  } catch (error) {
    reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
