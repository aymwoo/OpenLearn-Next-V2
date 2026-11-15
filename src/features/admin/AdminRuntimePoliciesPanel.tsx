import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, Shield, Settings } from 'lucide-react';

type Lang = 'zh' | 'en';
type Mode = 'off' | 'errors' | 'all';
type Source = 'database' | 'env' | 'default';

interface HookTelemetryView {
  enabled: boolean;
  storedValue: boolean | null;
  configSource: Source;
  hasEnvFallback: boolean;
  envVar: string;
  effect: string;
}

interface HttpAccessLogView {
  mode: Mode;
  storedMode: Mode | null;
  modeSource: Source;
  hasModeEnvFallback: boolean;
  ignorePrefixes: string[];
  storedIgnore: string | null;
  ignoreSource: Source;
  slowMs: number;
  storedSlowMs: number | null;
  slowSource: Source;
  envVar: string;
  ignoreEnvVar: string;
  slowEnvVar: string;
  effect: string;
}

interface AllowUnsignedView {
  allowByDefault: boolean;
  storedValue: boolean | null;
  configSource: Source;
  hasEnvFallback: boolean;
  envVar: string;
  effect: string;
}

interface PoliciesPayload {
  hookTelemetry: HookTelemetryView;
  httpAccessLog: HttpAccessLogView;
  allowUnsigned: AllowUnsignedView;
}

interface ReservedEnv {
  key: string;
  reason: string;
}

const SOURCE_LABEL: Record<Source, { zh: string; en: string }> = {
  database: { zh: '管理员界面配置（覆盖环境变量）', en: 'Admin UI setting (overrides env)' },
  env: { zh: '环境变量回退（未在界面显式配置）', en: 'Environment fallback (no explicit UI value)' },
  default: { zh: '历史默认（未在界面或环境变量中显式配置）', en: 'Historical default (not set in UI or env)' },
};

function sourceText(source: Source, zh: boolean): string {
  return zh ? SOURCE_LABEL[source].zh : SOURCE_LABEL[source].en;
}

export function AdminRuntimePoliciesPanel({ lang }: { lang: Lang }) {
  const zh = lang === 'zh';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [policies, setPolicies] = useState<PoliciesPayload | null>(null);
  const [reserved, setReserved] = useState<ReservedEnv[]>([]);
  const [hookEnabled, setHookEnabled] = useState(true);
  const [logMode, setLogMode] = useState<Mode>('errors');
  const [logIgnore, setLogIgnore] = useState('');
  const [slowMs, setSlowMs] = useState(1000);
  const [allowUnsigned, setAllowUnsigned] = useState(true);

  const applyPayload = (body: { policies: PoliciesPayload; reservedEnvBoundaries?: ReservedEnv[] }) => {
    setPolicies(body.policies);
    setReserved(body.reservedEnvBoundaries ?? []);
    setHookEnabled(body.policies.hookTelemetry.enabled);
    setLogMode(body.policies.httpAccessLog.mode);
    setLogIgnore(body.policies.httpAccessLog.ignorePrefixes.join(','));
    setSlowMs(body.policies.httpAccessLog.slowMs);
    setAllowUnsigned(body.policies.allowUnsigned.allowByDefault);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/runtime-policies');
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        policies?: PoliciesPayload;
        reservedEnvBoundaries?: ReservedEnv[];
      } | null;
      if (!res.ok || !body?.policies) {
        throw new Error(
          res.status === 403
            ? zh
              ? '仅管理员可查看运行时策略'
              : 'Only administrators can view runtime policies'
            : body?.error || (zh ? '加载运行时策略失败' : 'Failed to load runtime policies'),
        );
      }
      applyPayload({ policies: body.policies, reservedEnvBoundaries: body.reservedEnvBoundaries });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Record<string, unknown>, clearField?: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/runtime-policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clearField ? { [clearField]: null } : patch),
      });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        policies?: PoliciesPayload;
        reservedEnvBoundaries?: ReservedEnv[];
      } | null;
      if (!res.ok || !body?.policies) {
        throw new Error(body?.error || (zh ? '保存运行时策略失败' : 'Failed to save runtime policies'));
      }
      applyPayload({ policies: body.policies, reservedEnvBoundaries: body.reservedEnvBoundaries });
      setNotice(
        zh ? '已保存，按各策略说明立即或在后续请求中生效。' : 'Saved. See each policy for when it takes effect.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetLabel = (hasEnv: boolean) =>
    hasEnv
      ? zh
        ? '清除界面覆盖，回退到环境变量'
        : 'Clear UI override and fall back to env'
      : zh
        ? '清除界面覆盖，回退到默认'
        : 'Clear UI override and fall back to default';

  return (
    <div className="mt-6 bg-white border border-gray-200 rounded-xl shadow-3xs overflow-hidden max-w-3xl">
      <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-amber-50/60">
        <div>
          <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
            <Shield size={18} className="text-amber-700" />
            {zh ? '运行时策略（管理员）' : 'Runtime Policies (Administrators)'}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            {zh
              ? '统一配置课件网络遥测、HTTP 访问日志与未签名本地插件策略。优先级为界面显式值（含显式关闭）> 未配置时环境变量回退 > 历史默认。保存不会改写真实 .env。此项不会把认证绕过或关闭沙箱做成普通按钮。'
              : 'Configure courseware hook telemetry, HTTP access logs, and unsigned local plugin policy. Explicit UI values (including explicit off) beat env fallback, then historical defaults. Saving does not rewrite the real .env. Auth-bypass and sandbox-off stay out of ordinary toggles.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          className="px-3 py-2 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-white disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {zh ? '刷新' : 'Refresh'}
        </button>
      </div>

      <div className="p-5 space-y-6 text-left">
        {error && (
          <p role="alert" className="text-xs text-rose-600 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="text-xs text-emerald-700">
            {notice}
          </p>
        )}

        {policies && (
          <>
            <section
              className="space-y-2 border border-gray-100 rounded-lg p-4"
              data-testid="runtime-policy-hook-telemetry"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-gray-800">
                    {zh ? '课件网络遥测总闸' : 'Courseware network telemetry'}
                  </h4>
                  <p className="text-xs text-gray-500 leading-relaxed mt-1">
                    {zh
                      ? '控制课件内 fetch/XHR/axios/beacon/form 是否向父窗口上报网络遥测。默认开启。关闭后新打开的课件不再注入上报，已打开的课件由宿主同步后停止后续上报；不影响成绩提交。'
                      : 'Controls whether courseware fetch/XHR/axios/beacon/form hooks report to the parent window. On by default. New sessions pick up the value immediately; already-open sessions stop after the host syncs. Score submission is unaffected.'}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    {zh ? `有效状态：${hookEnabled ? '已开启' : '已关闭'}` : `Effective: ${hookEnabled ? 'on' : 'off'}`}
                    {` · ${sourceText(policies.hookTelemetry.configSource, zh)}`}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{policies.hookTelemetry.effect}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hookEnabled}
                  aria-label={zh ? '课件网络遥测总闸' : 'Courseware network telemetry'}
                  disabled={saving}
                  onClick={() => void save({ hookTelemetryEnabled: !hookEnabled })}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ${hookEnabled ? 'bg-indigo-600' : 'bg-gray-300'} ${saving ? 'opacity-60' : 'cursor-pointer'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white ${hookEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>
              {policies.hookTelemetry.storedValue !== null && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save({}, 'hookTelemetryEnabled')}
                  className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 cursor-pointer"
                >
                  {resetLabel(policies.hookTelemetry.hasEnvFallback)}
                </button>
              )}
            </section>

            <section
              className="space-y-3 border border-gray-100 rounded-lg p-4"
              data-testid="runtime-policy-access-log"
            >
              <h4 className="text-sm font-semibold text-gray-800">
                {zh ? 'HTTP 访问日志策略' : 'HTTP access log policy'}
              </h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                {zh
                  ? '这不是简单开/关：可选仅记录异常与慢请求（默认 errors）、记录全部（all，正常请求为 debug）或关闭访问日志（off）。不会写入查询串或请求体，也不影响安全审计。保存后对后续请求立即生效。'
                  : 'This is not a boolean switch: errors (default) logs failures and slow requests, all logs everything (successful requests at debug), off disables access logs. Query strings and bodies are never logged. Security audits are unaffected. Takes effect on subsequent requests.'}
              </p>
              <p className="text-xs text-gray-600">
                {zh ? `有效模式：${logMode}` : `Effective mode: ${logMode}`}
                {` · ${sourceText(policies.httpAccessLog.modeSource, zh)}`}
              </p>
              <label className="block text-xs font-semibold text-gray-700">
                {zh ? '日志模式' : 'Log mode'}
                <select
                  value={logMode}
                  disabled={saving}
                  onChange={(e) => setLogMode(e.target.value as Mode)}
                  className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                >
                  <option value="errors">
                    {zh ? 'errors：仅异常与慢请求（默认）' : 'errors: failures and slow requests (default)'}
                  </option>
                  <option value="all">{zh ? 'all：全量（排障）' : 'all: everything (troubleshooting)'}</option>
                  <option value="off">{zh ? 'off：关闭访问日志' : 'off: disable access logs'}</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-gray-700">
                {zh ? '忽略前缀（逗号分隔，须以 / 开头）' : 'Ignore prefixes (comma-separated, must start with /)'}
                <input
                  type="text"
                  value={logIgnore}
                  disabled={saving}
                  onChange={(e) => setLogIgnore(e.target.value)}
                  placeholder="/api/vfs,/api/classroom/sessions/"
                  className="mt-1 w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono"
                />
              </label>
              <label className="block text-xs font-semibold text-gray-700">
                {zh ? '慢请求阈值（毫秒）' : 'Slow request threshold (ms)'}
                <input
                  type="number"
                  min={50}
                  max={60000}
                  value={slowMs}
                  disabled={saving}
                  onChange={(e) => setSlowMs(Number(e.target.value))}
                  className="mt-1 w-40 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void save({
                      httpAccessLogMode: logMode,
                      httpAccessLogIgnore: logIgnore,
                      httpSlowMs: slowMs,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {zh ? '保存访问日志策略' : 'Save access log policy'}
                </button>
                {(policies.httpAccessLog.storedMode !== null ||
                  policies.httpAccessLog.storedIgnore !== null ||
                  policies.httpAccessLog.storedSlowMs !== null) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void save({
                        httpAccessLogMode: null,
                        httpAccessLogIgnore: null,
                        httpSlowMs: null,
                      })
                    }
                    className="text-xs font-semibold text-indigo-700 cursor-pointer"
                  >
                    {resetLabel(
                      policies.httpAccessLog.hasModeEnvFallback ||
                        policies.httpAccessLog.ignoreSource === 'env' ||
                        policies.httpAccessLog.slowSource === 'env',
                    )}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400">{policies.httpAccessLog.effect}</p>
            </section>

            <section
              className="space-y-2 border border-amber-100 bg-amber-50/40 rounded-lg p-4"
              data-testid="runtime-policy-allow-unsigned"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-amber-900">
                    {zh ? '允许未签名本地插件默认放行' : 'Allow unsigned local plugins by default'}
                  </h4>
                  <p className="text-xs text-amber-900/80 leading-relaxed mt-1">
                    {zh
                      ? '高风险策略。开启（历史默认）时，未签名本地 ZIP 可安装/更新，审计记 unverified_local_acknowledged。关闭后必须在每次上传时显式确认。这不会绕过签名错误、公钥、网络限制、权限或沙箱，也不等于全信任或允许内联执行。'
                      : 'High risk. When on (historical default), unsigned local ZIPs may be installed or updated and are audited as unverified_local_acknowledged. When off, each upload requires explicit confirmation. This cannot bypass signature failures, public keys, network limits, permissions, or the sandbox, and is not full trust or inline execution.'}
                  </p>
                  <p className="text-xs text-gray-700 mt-1">
                    {zh
                      ? `有效状态：${allowUnsigned ? '默认放行' : '需逐次确认'}`
                      : `Effective: ${allowUnsigned ? 'allow by default' : 'require per-upload confirmation'}`}
                    {` · ${sourceText(policies.allowUnsigned.configSource, zh)}`}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{policies.allowUnsigned.effect}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allowUnsigned}
                  aria-label={zh ? '允许未签名本地插件默认放行' : 'Allow unsigned local plugins by default'}
                  disabled={saving}
                  onClick={() => void save({ allowUnsignedByDefault: !allowUnsigned })}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ${allowUnsigned ? 'bg-amber-600' : 'bg-gray-300'} ${saving ? 'opacity-60' : 'cursor-pointer'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white ${allowUnsigned ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </div>
              {policies.allowUnsigned.storedValue !== null && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save({}, 'allowUnsignedByDefault')}
                  className="text-xs font-semibold text-indigo-700 cursor-pointer"
                >
                  {resetLabel(policies.allowUnsigned.hasEnvFallback)}
                </button>
              )}
            </section>
          </>
        )}

        {reserved.length > 0 && (
          <section
            className="space-y-2 border border-gray-100 rounded-lg p-4"
            data-testid="runtime-policy-reserved-env"
          >
            <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
              <Settings size={14} />
              {zh ? '仍保留为环境变量的安全边界' : 'Security boundaries still reserved to environment variables'}
            </h4>
            <p className="text-xs text-gray-500">
              {zh
                ? '下列项目若做成普通按钮，可能绕过认证、关闭隔离或泄露密钥，因此仍由部署者通过环境变量配置，本页只列出理由。'
                : 'These remain deploy-time environment variables because exposing them as ordinary toggles could bypass auth, disable isolation, or leak secrets.'}
            </p>
            <ul className="text-xs text-gray-600 space-y-1.5">
              {reserved.map((item) => (
                <li key={item.key}>
                  <code className="font-mono text-gray-800">{item.key}</code>
                  {` — ${item.reason}`}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
