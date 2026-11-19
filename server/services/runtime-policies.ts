/**
 * 管理员运行时策略与产品功能开关。
 * 设置是唯一来源：未配置（NULL）时使用历史默认，不再读取环境变量。
 * 列缺失时按未配置处理，避免旧库在迁移完成前改变默认行为。
 */
export type HttpAccessLogMode = 'off' | 'errors' | 'all';
export const DEFAULT_HTTP_SLOW_MS = 1000;

export type PolicyConfigSource = 'database' | 'default';

export interface RuntimePolicyDbLike {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

export interface StoredRuntimePolicyRow {
  bridge_hook_telemetry?: number | boolean | null;
  http_access_log_mode?: string | null;
  http_access_log_ignore?: string | null;
  http_slow_ms?: number | null;
  allow_unsigned_plugins?: number | boolean | null;
  mode_packs_enabled?: number | boolean | null;
  mode_pack_show_xuean_tab?: number | boolean | null;
}

export interface HookTelemetryPolicy {
  enabled: boolean;
  storedValue: boolean | null;
  configSource: PolicyConfigSource;
}

export interface HttpAccessLogPolicy {
  mode: HttpAccessLogMode;
  storedMode: HttpAccessLogMode | null;
  ignorePrefixes: string[];
  storedIgnore: string | null;
  slowMs: number;
  storedSlowMs: number | null;
  modeSource: PolicyConfigSource;
  ignoreSource: PolicyConfigSource;
  slowSource: PolicyConfigSource;
}

export interface AllowUnsignedPolicy {
  /** true = 未签名本地包可默认放行（仍记审计，不是全信任/内联）。false = 必须逐次 x-allow-unsigned: true。 */
  allowByDefault: boolean;
  storedValue: boolean | null;
  configSource: PolicyConfigSource;
}

export interface ModePackPolicy {
  /** 历史默认关闭。 */
  enabled: boolean;
  storedValue: boolean | null;
  configSource: PolicyConfigSource;
  /** Mode Pack 开启时是否显示学生平行学案页。历史默认关闭（隐藏）。 */
  showXueanTab: boolean;
  storedShowXueanTab: boolean | null;
  showXueanTabSource: PolicyConfigSource;
}

export interface RuntimePoliciesSnapshot {
  hookTelemetry: HookTelemetryPolicy;
  httpAccessLog: HttpAccessLogPolicy;
  allowUnsigned: AllowUnsignedPolicy;
  modePacks: ModePackPolicy;
}

const GLOBAL_ID = 'global';

function parseStoredBool(raw: number | boolean | null | undefined): boolean | null {
  if (raw === 1 || raw === true) return true;
  if (raw === 0 || raw === false) return false;
  return null;
}

function parseStoredMode(raw: string | null | undefined): HttpAccessLogMode | null {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'errors' || normalized === 'all') return normalized;
  return null;
}

export function parseHttpAccessLogIgnoreInput(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeHttpAccessLogIgnoreInput(raw: string): string {
  const prefixes = parseHttpAccessLogIgnoreInput(raw);
  for (const prefix of prefixes) {
    if (!prefix.startsWith('/') || prefix.includes('://') || prefix.includes('?') || prefix.includes('#')) {
      throw new RuntimePolicyError('HTTP 访问日志忽略前缀必须以 / 开头，且不能包含协议、查询串或片段');
    }
    if (prefix.length > 256) {
      throw new RuntimePolicyError('HTTP 访问日志忽略前缀过长');
    }
  }
  if (prefixes.length > 32) {
    throw new RuntimePolicyError('HTTP 访问日志忽略前缀最多 32 条');
  }
  return prefixes.join(',');
}

export function normalizeHttpSlowMs(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < 50 || value > 60_000) {
    throw new RuntimePolicyError('慢请求阈值必须是 50–60000 之间的整数（毫秒）');
  }
  return value;
}

export class RuntimePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimePolicyError';
  }
}

export function getStoredRuntimePolicyRow(db: RuntimePolicyDbLike): StoredRuntimePolicyRow | null {
  try {
    const row = db
      .prepare(
        `SELECT bridge_hook_telemetry, http_access_log_mode, http_access_log_ignore, http_slow_ms,
                allow_unsigned_plugins, mode_packs_enabled, mode_pack_show_xuean_tab
         FROM site_settings WHERE id = ?`,
      )
      .get(GLOBAL_ID) as StoredRuntimePolicyRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function boolPolicy(
  storedValue: boolean | null,
  fallback: boolean,
): { enabled: boolean; configSource: PolicyConfigSource } {
  if (storedValue === true || storedValue === false) {
    return { enabled: storedValue, configSource: 'database' };
  }
  return { enabled: fallback, configSource: 'default' };
}

export function resolveHookTelemetryPolicy(db: RuntimePolicyDbLike | null): HookTelemetryPolicy {
  const storedValue = db ? parseStoredBool(getStoredRuntimePolicyRow(db)?.bridge_hook_telemetry) : null;
  const resolved = boolPolicy(storedValue, true);
  return { enabled: resolved.enabled, storedValue, configSource: resolved.configSource };
}

export function resolveHttpAccessLogPolicy(db: RuntimePolicyDbLike | null): HttpAccessLogPolicy {
  const row = db ? getStoredRuntimePolicyRow(db) : null;
  const storedMode = parseStoredMode(row?.http_access_log_mode);
  const storedIgnore = typeof row?.http_access_log_ignore === 'string' ? row.http_access_log_ignore : null;
  const storedSlowMs =
    typeof row?.http_slow_ms === 'number' && Number.isInteger(row.http_slow_ms) ? row.http_slow_ms : null;

  const mode = storedMode ?? 'errors';
  const ignorePrefixes = storedIgnore !== null ? parseHttpAccessLogIgnoreInput(storedIgnore) : [];
  const slowMs = storedSlowMs ?? DEFAULT_HTTP_SLOW_MS;

  return {
    mode,
    storedMode,
    ignorePrefixes,
    storedIgnore,
    slowMs,
    storedSlowMs,
    modeSource: storedMode ? 'database' : 'default',
    ignoreSource: storedIgnore !== null ? 'database' : 'default',
    slowSource: storedSlowMs != null ? 'database' : 'default',
  };
}

export function resolveAllowUnsignedPolicy(db: RuntimePolicyDbLike | null): AllowUnsignedPolicy {
  const storedValue = db ? parseStoredBool(getStoredRuntimePolicyRow(db)?.allow_unsigned_plugins) : null;
  const resolved = boolPolicy(storedValue, true);
  return { allowByDefault: resolved.enabled, storedValue, configSource: resolved.configSource };
}

export function resolveModePackPolicy(db: RuntimePolicyDbLike | null): ModePackPolicy {
  const row = db ? getStoredRuntimePolicyRow(db) : null;
  const storedValue = parseStoredBool(row?.mode_packs_enabled);
  const storedShowXueanTab = parseStoredBool(row?.mode_pack_show_xuean_tab);
  const enabled = boolPolicy(storedValue, false);
  const showXueanTab = boolPolicy(storedShowXueanTab, false);
  return {
    enabled: enabled.enabled,
    storedValue,
    configSource: enabled.configSource,
    showXueanTab: showXueanTab.enabled,
    storedShowXueanTab,
    showXueanTabSource: showXueanTab.configSource,
  };
}

export function resolveRuntimePolicies(db: RuntimePolicyDbLike | null): RuntimePoliciesSnapshot {
  return {
    hookTelemetry: resolveHookTelemetryPolicy(db),
    httpAccessLog: resolveHttpAccessLogPolicy(db),
    allowUnsigned: resolveAllowUnsignedPolicy(db),
    modePacks: resolveModePackPolicy(db),
  };
}

export interface RuntimePolicyPatch {
  hookTelemetryEnabled?: boolean | null;
  httpAccessLogMode?: HttpAccessLogMode | null;
  httpAccessLogIgnore?: string | null;
  httpSlowMs?: number | null;
  allowUnsignedByDefault?: boolean | null;
  modePacksEnabled?: boolean | null;
  modePackShowXueanTab?: boolean | null;
}

function upsertColumn(db: RuntimePolicyDbLike, column: string, value: unknown): void {
  db.prepare(
    `INSERT INTO site_settings (id, ${column}) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET ${column} = excluded.${column}`,
  ).run(GLOBAL_ID, value);
}

function assertBoolOrNull(value: unknown, name: string): asserts value is boolean | null {
  if (value !== null && typeof value !== 'boolean') {
    throw new RuntimePolicyError(`${name} 必须是布尔值或 null`);
  }
}

export function setRuntimePolicies(db: RuntimePolicyDbLike, patch: RuntimePolicyPatch): RuntimePoliciesSnapshot {
  const keys = Object.keys(patch) as (keyof RuntimePolicyPatch)[];
  if (keys.length === 0 || keys.every((key) => patch[key] === undefined)) {
    throw new RuntimePolicyError('缺少要更新的运行时策略字段');
  }

  if (patch.hookTelemetryEnabled !== undefined) {
    assertBoolOrNull(patch.hookTelemetryEnabled, 'hookTelemetryEnabled');
    upsertColumn(
      db,
      'bridge_hook_telemetry',
      patch.hookTelemetryEnabled === null ? null : patch.hookTelemetryEnabled ? 1 : 0,
    );
  }
  if (patch.httpAccessLogMode !== undefined) {
    if (patch.httpAccessLogMode !== null && !['off', 'errors', 'all'].includes(patch.httpAccessLogMode)) {
      throw new RuntimePolicyError('httpAccessLogMode 必须是 off、errors、all 或 null');
    }
    upsertColumn(db, 'http_access_log_mode', patch.httpAccessLogMode);
  }
  if (patch.httpAccessLogIgnore !== undefined) {
    if (patch.httpAccessLogIgnore !== null && typeof patch.httpAccessLogIgnore !== 'string') {
      throw new RuntimePolicyError('httpAccessLogIgnore 必须是字符串或 null');
    }
    const stored =
      patch.httpAccessLogIgnore === null ? null : normalizeHttpAccessLogIgnoreInput(patch.httpAccessLogIgnore);
    upsertColumn(db, 'http_access_log_ignore', stored === '' ? '' : stored);
  }
  if (patch.httpSlowMs !== undefined) {
    if (patch.httpSlowMs !== null) {
      upsertColumn(db, 'http_slow_ms', normalizeHttpSlowMs(patch.httpSlowMs));
    } else {
      upsertColumn(db, 'http_slow_ms', null);
    }
  }
  if (patch.allowUnsignedByDefault !== undefined) {
    assertBoolOrNull(patch.allowUnsignedByDefault, 'allowUnsignedByDefault');
    upsertColumn(
      db,
      'allow_unsigned_plugins',
      patch.allowUnsignedByDefault === null ? null : patch.allowUnsignedByDefault ? 1 : 0,
    );
  }
  if (patch.modePacksEnabled !== undefined) {
    assertBoolOrNull(patch.modePacksEnabled, 'modePacksEnabled');
    upsertColumn(db, 'mode_packs_enabled', patch.modePacksEnabled === null ? null : patch.modePacksEnabled ? 1 : 0);
  }
  if (patch.modePackShowXueanTab !== undefined) {
    assertBoolOrNull(patch.modePackShowXueanTab, 'modePackShowXueanTab');
    upsertColumn(
      db,
      'mode_pack_show_xuean_tab',
      patch.modePackShowXueanTab === null ? null : patch.modePackShowXueanTab ? 1 : 0,
    );
  }
  return resolveRuntimePolicies(db);
}

export function tryResolveRuntimePoliciesFromKernel(getDb: () => RuntimePolicyDbLike | null): RuntimePoliciesSnapshot {
  try {
    return resolveRuntimePolicies(getDb());
  } catch {
    return resolveRuntimePolicies(null);
  }
}
