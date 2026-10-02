/**
 * SessionService — 会话/站点级端点的纯 fetch 封装（C1-R1 从 App.tsx 迁出）。
 *
 * 约定：只做 fetch + res.ok 检查 + res.json()，返回 { ok, status?, data? }；
 * 分支判断、setState、toast 等 UI 逻辑全部留在调用方（App.tsx），保证行为
 * 与迁移前完全一致。同源 fetch 自动附带会话 cookie。
 */

export async function fetchLibraryResources(): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch('/api/resources');
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function fetchDbStatus(): Promise<{ ok: boolean; status: number; data?: any }> {
  const res = await fetch('/api/db-status');
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

export async function fetchAuthSession(): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch('/api/auth/session');
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function fetchSiteSettings(): Promise<{ ok: boolean; data?: any }> {
  const res = await fetch('/api/site-settings');
  if (!res.ok) return { ok: false };
  return { ok: true, data: await res.json() };
}

export async function postLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}
