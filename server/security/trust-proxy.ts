/**
 * Express `trust proxy` 解析。
 *
 * 未设置、空串、`false`、`0` 都不信任 X-Forwarded-*（直连部署的安全默认值）。
 * 反代之后必须显式配置，例如 `TRUST_PROXY=1` 或 `TRUST_PROXY=loopback`。
 */
export function resolveTrustProxy(raw: string | undefined | null): boolean | number | string {
  if (raw === undefined || raw === null) return false;
  const value = String(raw).trim();
  if (value === '' || value === 'false' || value === '0') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
