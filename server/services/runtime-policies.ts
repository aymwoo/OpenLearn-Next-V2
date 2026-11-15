/**
 * 管理员运行时策略：课件遥测、HTTP 访问日志、未签名本地插件。
 * 优先级：界面显式值（含显式关闭）> 未配置时环境变量回退 > 历史默认。
 * 列缺失或尚未配置时返回 stored=null，以免掩盖 ENV 回退。
 */
export type HttpAccessLogMode = 'off' | 'errors' | 'all';
export const DEFAULT_HTTP_SLOW_MS = 1000;
export const HOOK_TELEMETRY_ENV = 'BRIDGE_HOOK_TELEMETRY';
export const HTTP_ACCESS_LOG_ENV = 'HTTP_ACCESS_LOG';
export const HTTP_ACCESS_LOG_IGNORE_ENV = 'HTTP_ACCESS_LOG_IGNORE';
export const HTTP_SLOW_MS_ENV = 'HTTP_SLOW_MS';
export const ALLOW_UNSIGNED_ENV = 'OPENLEARN_ALLOW_UNSIGNED';
export const LOG_LEVEL_ENV = 'LOG_LEVEL';

function envHttpAccessLogMode(env: NodeJS.ProcessEnv): HttpAccessLogMode {
  const normalized = env[HTTP_ACCESS_LOG_ENV]?.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'errors' || normalized === 'all') return normalized;
  const level = env[LOG_LEVEL_ENV]?.trim().toLowerCase();
  if (level === 'debug' || level === 'trace') return 'all';
  return 'errors';
}

function envSlowMs(env: NodeJS.ProcessEnv): number {
  const raw = env[HTTP_SLOW_MS_ENV];
  if (!raw) return DEFAULT_HTTP_SLOW_MS;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HTTP_SLOW_MS;
}

export type PolicyConfigSource = 'database' | 'env' | 'default';

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
}

export interface HookTelemetryPolicy {
  enabled: boolean;
  storedValue: boolean | null;
  envOff: boolean;
  configSource: PolicyConfigSource;
  hasEnvFallback: boolean;
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
  hasModeEnvFallback: boolean;
  hasIgnoreEnvFallback: boolean;
  hasSlowEnvFallback: boolean;
}

export interface AllowUnsignedPolicy {
  /** true = 未签名本地包可默认放行（仍记审计，不是全信任/内联）。false = 必须逐次 x-allow-unsigned: true。 */
  allowByDefault: boolean;
  storedValue: boolean | null;
  envRestricts: boolean;
  configSource: PolicyConfigSource;
  hasEnvFallback: boolean;
}

export interface RuntimePoliciesSnapshot {
  hookTelemetry: HookTelemetryPolicy;
  httpAccessLog: HttpAccessLogPolicy;
  allowUnsigned: AllowUnsignedPolicy;
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
        `SELECT bridge_hook_telemetry, http_access_log_mode, http_access_log_ignore, http_slow_ms, allow_unsigned_plugins
         FROM site_settings WHERE id = ?`,
      )
      .get(GLOBAL_ID) as StoredRuntimePolicyRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/** 仅解析环境变量：只有显式 off 才关闭；未设置或 on 都开启（历史默认开启）。 */
export function hookTelemetryEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[HOOK_TELEMETRY_ENV] !== 'off';
}

/** 仅解析环境变量：只有 0/false 才收紧；未设置默认放行。 */
export function allowUnsignedByDefaultFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env[ALLOW_UNSIGNED_ENV] ?? '').toLowerCase();
  return !['0', 'false'].includes(raw);
}

export function resolveHookTelemetryPolicy(
  db: RuntimePolicyDbLike | null,
  env: NodeJS.ProcessEnv = process.env,
): HookTelemetryPolicy {
  const storedValue = db ? parseStoredBool(getStoredRuntimePolicyRow(db)?.bridge_hook_telemetry) : null;
  const envOff = env[HOOK_TELEMETRY_ENV] === 'off';
  const envEnabled = hookTelemetryEnabledFromEnv(env);
  if (storedValue === true || storedValue === false) {
    return {
      enabled: storedValue,
      storedValue,
      envOff,
      configSource: 'database',
      hasEnvFallback: envOff,
    };
  }
  return {
    enabled: envEnabled,
    storedValue: null,
    envOff,
    configSource: envOff ? 'env' : 'default',
    hasEnvFallback: envOff,
  };
}

export function resolveHttpAccessLogPolicy(
  db: RuntimePolicyDbLike | null,
  env: NodeJS.ProcessEnv = process.env,
): HttpAccessLogPolicy {
  const row = db ? getStoredRuntimePolicyRow(db) : null;
  const storedMode = parseStoredMode(row?.http_access_log_mode);
  const storedIgnore = typeof row?.http_access_log_ignore === 'string' ? row.http_access_log_ignore : null;
  const storedSlowMs =
    typeof row?.http_slow_ms === 'number' && Number.isInteger(row.http_slow_ms) ? row.http_slow_ms : null;

  const envModeRaw = env[HTTP_ACCESS_LOG_ENV]?.trim().toLowerCase();
  const hasModeEnv = envModeRaw === 'off' || envModeRaw === 'errors' || envModeRaw === 'all';
  const envMode = envHttpAccessLogMode(env);
  const mode = storedMode ?? envMode;
  let modeSource: PolicyConfigSource;
  if (storedMode) modeSource = 'database';
  else if (hasModeEnv) modeSource = 'env';
  else if (envMode === 'all')
    modeSource = 'env'; // LOG_LEVEL=debug|trace 回退
  else modeSource = 'default';

  const envIgnore = env[HTTP_ACCESS_LOG_IGNORE_ENV];
  const hasIgnoreEnv = Boolean(envIgnore && envIgnore.trim());
  const ignorePrefixes =
    storedIgnore !== null ? parseHttpAccessLogIgnoreInput(storedIgnore) : parseHttpAccessLogIgnoreInput(envIgnore);
  const ignoreSource: PolicyConfigSource = storedIgnore !== null ? 'database' : hasIgnoreEnv ? 'env' : 'default';

  const hasSlowEnv = Boolean(env[HTTP_SLOW_MS_ENV] && env[HTTP_SLOW_MS_ENV]!.trim());
  const slowMs = storedSlowMs ?? envSlowMs(env);
  const slowSource: PolicyConfigSource =
    storedSlowMs != null ? 'database' : hasSlowEnv ? 'env' : slowMs === DEFAULT_HTTP_SLOW_MS ? 'default' : 'env';

  return {
    mode,
    storedMode,
    ignorePrefixes,
    storedIgnore,
    slowMs,
    storedSlowMs,
    modeSource,
    ignoreSource,
    slowSource,
    hasModeEnvFallback: hasModeEnv,
    hasIgnoreEnvFallback: hasIgnoreEnv,
    hasSlowEnvFallback: hasSlowEnv,
  };
}

export function resolveAllowUnsignedPolicy(
  db: RuntimePolicyDbLike | null,
  env: NodeJS.ProcessEnv = process.env,
): AllowUnsignedPolicy {
  const storedValue = db ? parseStoredBool(getStoredRuntimePolicyRow(db)?.allow_unsigned_plugins) : null;
  const envRestricts = !allowUnsignedByDefaultFromEnv(env);
  const envAllows = allowUnsignedByDefaultFromEnv(env);
  if (storedValue === true || storedValue === false) {
    return {
      allowByDefault: storedValue,
      storedValue,
      envRestricts,
      configSource: 'database',
      hasEnvFallback: envRestricts,
    };
  }
  return {
    allowByDefault: envAllows,
    storedValue: null,
    envRestricts,
    configSource: envRestricts ? 'env' : 'default',
    hasEnvFallback: envRestricts,
  };
}

export function resolveRuntimePolicies(
  db: RuntimePolicyDbLike | null,
  env: NodeJS.ProcessEnv = process.env,
): RuntimePoliciesSnapshot {
  return {
    hookTelemetry: resolveHookTelemetryPolicy(db, env),
    httpAccessLog: resolveHttpAccessLogPolicy(db, env),
    allowUnsigned: resolveAllowUnsignedPolicy(db, env),
  };
}

export interface RuntimePolicyPatch {
  hookTelemetryEnabled?: boolean | null;
  httpAccessLogMode?: HttpAccessLogMode | null;
  httpAccessLogIgnore?: string | null;
  httpSlowMs?: number | null;
  allowUnsignedByDefault?: boolean | null;
}

function upsertColumn(db: RuntimePolicyDbLike, column: string, value: unknown): void {
  db.prepare(
    `INSERT INTO site_settings (id, ${column}) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET ${column} = excluded.${column}`,
  ).run(GLOBAL_ID, value);
}

export function setRuntimePolicies(
  db: RuntimePolicyDbLike,
  patch: RuntimePolicyPatch,
  env: NodeJS.ProcessEnv = process.env,
): RuntimePoliciesSnapshot {
  if (
    patch.hookTelemetryEnabled === undefined &&
    patch.httpAccessLogMode === undefined &&
    patch.httpAccessLogIgnore === undefined &&
    patch.httpSlowMs === undefined &&
    patch.allowUnsignedByDefault === undefined
  ) {
    throw new RuntimePolicyError('缺少要更新的运行时策略字段');
  }

  if (patch.hookTelemetryEnabled !== undefined) {
    if (patch.hookTelemetryEnabled !== null && typeof patch.hookTelemetryEnabled !== 'boolean') {
      throw new RuntimePolicyError('hookTelemetryEnabled 必须是布尔值或 null');
    }
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
    if (patch.allowUnsignedByDefault !== null && typeof patch.allowUnsignedByDefault !== 'boolean') {
      throw new RuntimePolicyError('allowUnsignedByDefault 必须是布尔值或 null');
    }
    upsertColumn(
      db,
      'allow_unsigned_plugins',
      patch.allowUnsignedByDefault === null ? null : patch.allowUnsignedByDefault ? 1 : 0,
    );
  }
  return resolveRuntimePolicies(db, env);
}

export function tryResolveRuntimePoliciesFromKernel(
  getDb: () => RuntimePolicyDbLike | null,
  env: NodeJS.ProcessEnv = process.env,
): RuntimePoliciesSnapshot {
  try {
    return resolveRuntimePolicies(getDb(), env);
  } catch {
    return resolveRuntimePolicies(null, env);
  }
}
