/**
 * PluginNetworkGrantsPanel — 已安装插件的出站域名授权视图（审计 R-02）。
 *
 * ## 为什么需要它
 *
 * `docs/trust-boundary-hardening-audit-2026-10-14.md` R-02 的原始描述是「安装/启用 UI
 * 尚未突出展示『该插件将能访问哪些域名』」。安装向导已经覆盖了「装的时候看得见」，
 * 但**已安装**插件的管理员仍然无处查看与撤销 —— 而撤销恰恰是授权机制最该有的另一半。
 *
 * ## 三个列表分开显示，不合并
 *
 * - **已批准**：运行时真正放行的域名（`plugin_network_grants` 表的唯一真相源）；
 * - **已申请**：清单 `network.outbound` 里声明、且可通过归一化的域名（未批准前不生效）；
 * - **不可批准**：回环/私有/保留地址、通配符、带协议或端口的写法 —— **带原因**。
 *
 * 合并成一个列表会制造最危险的那种误解：把「清单写了」当成「已经能访问」。
 *
 * ## 权限
 *
 * 端点仅 administrator。非管理员打开时后端返回 403，本组件不报错、不显示空面板，
 * 而是整块隐藏 —— 一个「你没有权限」的红框对教师毫无意义。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Loader2, ShieldCheck, ShieldOff, AlertTriangle, Plus, Trash2 } from 'lucide-react';

interface RejectedHost {
  host: string;
  reason?: string;
}

interface GrantsResponse {
  proposed: string[];
  approved: string[];
  rejected: RejectedHost[];
}

interface PluginNetworkGrantsPanelProps {
  pluginId: string;
  lang: string;
}

export function PluginNetworkGrantsPanel({ pluginId, lang }: PluginNetworkGrantsPanelProps) {
  const zh = lang === 'zh';
  const t = (cn: string, en: string) => (zh ? cn : en);

  const [data, setData] = useState<GrantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** 403 / 网络失败都当作「不显示」，而不是把错误抛给用户。 */
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endpoint = `/api/plugins/${encodeURIComponent(pluginId)}/network-grants`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      if (res.status === 403 || res.status === 404) {
        setHidden(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        setHidden(true);
        return;
      }
      setData({
        proposed: Array.isArray(body.proposed) ? body.proposed : [],
        approved: Array.isArray(body.approved) ? body.approved : [],
        rejected: Array.isArray(body.rejected) ? body.rejected : [],
      });
      setHidden(false);
    } catch {
      setHidden(true);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = useCallback(
    async (host: string) => {
      setBusy(host);
      setError(null);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hosts: [host] }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success !== true) {
          setError(body?.error || t('批准失败', 'Approval failed'));
        }
      } catch (e: any) {
        setError(e?.message || t('批准失败', 'Approval failed'));
      } finally {
        setBusy(null);
        await load();
      }
    },
    [endpoint, load, t],
  );

  const revoke = useCallback(
    async (host: string) => {
      setBusy(host);
      setError(null);
      try {
        const res = await fetch(`${endpoint}?host=${encodeURIComponent(host)}`, { method: 'DELETE' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success !== true) {
          setError(body?.error || t('撤销失败', 'Revoke failed'));
        }
      } catch (e: any) {
        setError(e?.message || t('撤销失败', 'Revoke failed'));
      } finally {
        setBusy(null);
        await load();
      }
    },
    [endpoint, load, t],
  );

  // 既没有申请也没有授权 → 整块不渲染（绝大多数插件就是这样，不该占版面）
  const hasAnything = data && (data.approved.length > 0 || data.proposed.length > 0 || data.rejected.length > 0);
  if (hidden || (!loading && !hasAnything)) return null;

  if (loading) {
    return (
      <div className="py-4 flex items-center gap-2 text-xs text-gray-400" data-testid="network-grants-loading">
        <Loader2 size={14} className="animate-spin" />
        {t('正在读取出站域名授权…', 'Loading outbound grants…')}
      </div>
    );
  }

  const pendingProposals = (data?.proposed ?? []).filter((h) => !(data?.approved ?? []).includes(h));

  return (
    <div className="pt-4 mt-2 border-t border-gray-100" data-testid="network-grants-panel">
      <div className="flex items-center gap-2 mb-2">
        <Globe size={15} className="text-gray-500" />
        <h4 className="text-sm font-medium text-gray-700">{t('出站网络域名', 'Outbound network hosts')}</h4>
        <span className="text-[10px] font-mono text-gray-400 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
          {data?.approved.length ?? 0} {t('已批准', 'approved')}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">
        {t(
          '清单声明的域名只是申请，只有「已批准」的才会被运行时放行。回环、私有与保留地址永远不会被批准。',
          'Hosts declared in the manifest are requests only; the runtime allows just the approved ones. Loopback, private and reserved addresses are never granted.',
        )}
      </p>

      {error && (
        <div
          className="mb-2 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* 已批准 —— 有撤销入口 */}
      <div className="mb-3">
        <div className="text-[11px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1">
          <ShieldCheck size={12} />
          {t('已批准（运行时放行）', 'Approved (allowed at runtime)')}
        </div>
        {data && data.approved.length > 0 ? (
          <ul className="space-y-1">
            {data.approved.map((host) => (
              <li
                key={host}
                className="flex items-center justify-between gap-2 bg-emerald-50/60 border border-emerald-100 rounded-lg px-2.5 py-1.5"
              >
                <code className="text-xs text-emerald-900 font-mono truncate">{host}</code>
                <button
                  type="button"
                  onClick={() => void revoke(host)}
                  disabled={busy === host}
                  data-testid={`revoke-${host}`}
                  className="text-[11px] font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                >
                  {busy === host ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  {t('撤销', 'Revoke')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400 italic" data-testid="no-approved">
            {t(
              '尚未批准任何域名 —— 该插件无法发起出站请求。',
              'No host approved yet — this plugin cannot make outbound requests.',
            )}
          </p>
        )}
      </div>

      {/* 已申请未批准 —— 逐条批准 */}
      {pendingProposals.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-bold text-amber-700 mb-1.5 flex items-center gap-1">
            <AlertTriangle size={12} />
            {t('清单申请中（未生效）', 'Requested by manifest (not active)')}
          </div>
          <ul className="space-y-1">
            {pendingProposals.map((host) => (
              <li
                key={host}
                className="flex items-center justify-between gap-2 bg-amber-50/60 border border-amber-100 rounded-lg px-2.5 py-1.5"
              >
                <code className="text-xs text-amber-900 font-mono truncate">{host}</code>
                <button
                  type="button"
                  onClick={() => void approve(host)}
                  disabled={busy === host}
                  data-testid={`approve-${host}`}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                >
                  {busy === host ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  {t('批准', 'Approve')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 永不可批准 —— 只说清楚为什么，不给按钮 */}
      {data && data.rejected.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-rose-700 mb-1.5 flex items-center gap-1">
            <ShieldOff size={12} />
            {t('不可批准', 'Not approvable')}
          </div>
          <ul className="space-y-1" data-testid="rejected-hosts">
            {data.rejected.map((item) => (
              <li key={`${item.host}-${item.reason ?? ''}`} className="text-xs text-gray-500 leading-relaxed">
                <code className="font-mono text-rose-700 line-through">{item.host}</code>
                {item.reason ? <span className="ml-1.5 text-gray-400">— {item.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
