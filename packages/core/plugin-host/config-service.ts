/**
 * config-service.ts — plugin configuration service (V3.0，Issue #151 分层).
 *
 * Follows VS Code's JSON Schema approach: plugins declare settings in
 * manifest.json, values are stored per scope, validated against the schema,
 * with defaults from the declaration.
 *
 * ## 分层解析（Issue #151）
 *
 *   班级覆盖 (class, scope_id=<classId>)
 *     > 学校覆盖 (school, scope_id=<schoolId>)
 *       > 平台值 (platform, scope_id='')
 *         > manifest 默认值
 *
 * - 学校层需要多租户模型（Issue #149）落地后才会有自动的来源；在那之前
 *   调用方可以显式传 `schoolId`，解析逻辑已经就绪。
 * - 哪些配置项允许在哪一层覆盖由 manifest 声明：
 *   `configuration.properties.<key>.scope: ['platform', 'school', 'class']`。
 *   未声明时**只允许平台层** —— 老插件行为不变（它们原先只有一层）。
 *
 * ## Storage
 *
 * 新表 `plugin_config(plugin_id, scope_type, scope_id, key, value, updated_at)`
 * （迁移 037）。旧值在迁移时搬到平台层；新表缺行时仍会回退读
 * `plugin_storage` 的 `config:<key>`，保证「迁移未执行/手工恢复」的库也能读到旧配置。
 */

import type { Manifest } from '../esm-loader/manifest-schema.js';

// ── Types ────────────────────────────────────────────────────────────────

/** 配置作用域。`school` 预留，待多租户决策（Issue #149）接入。 */
export type ConfigScopeType = 'platform' | 'school' | 'class';

export const CONFIG_SCOPE_TYPES: readonly ConfigScopeType[] = ['platform', 'school', 'class'];

/** A single configuration property definition from manifest. */
export interface ConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'integer';
  default?: unknown;
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  /**
   * 允许覆盖该配置项的作用域。缺省为 `['platform']`（向后兼容：老插件只有一层）。
   * `platform` 始终隐含允许。
   */
  scope?: ConfigScopeType[];
}

/** 读取时的上下文：越具体的作用域优先级越高。 */
export interface ConfigReadOptions {
  classId?: string;
  /** 预留给多租户（Issue #149）。 */
  schoolId?: string;
}

/** 写入时指定作用域；缺省为平台层。 */
export interface ConfigWriteScope {
  scopeType?: ConfigScopeType;
  scopeId?: string;
}

/** The full configuration declaration from manifest. */
export type ConfigDeclaration = NonNullable<Manifest['configuration']>;

export type ConfigChangeCallback = (key: string, newValue: unknown, oldValue: unknown) => void;

/**
 * IConfigService — typed, validated plugin configuration accessor.
 *
 * Exposed on PluginContext as ctx.config.
 */
export interface IConfigService {
  /** Get a single config value by key, resolving class > school > platform > default. */
  get<T = unknown>(key: string, options?: ConfigReadOptions): T;

  /** Get all config values as a plain object (resolved for the given scope). */
  getAll(options?: ConfigReadOptions): Record<string, unknown>;

  /**
   * Set a config value at the given scope (default: platform).
   * Validates the value against the schema and the scope against the manifest declaration.
   */
  set(key: string, value: unknown, scope?: ConfigWriteScope): Promise<void>;

  /** Listen for config changes. Returns an unsubscribe function. */
  onChange(callback: ConfigChangeCallback): () => void;
}

// ── Implementation ───────────────────────────────────────────────────────

interface ScopedKey {
  scopeType: ConfigScopeType;
  scopeId: string;
  key: string;
}

function scopedId(scopeType: ConfigScopeType, scopeId: string, key: string): string {
  return `${scopeType}\u0000${scopeId}\u0000${key}`;
}

function normalizeWriteScope(scope?: ConfigWriteScope): { scopeType: ConfigScopeType; scopeId: string } {
  const scopeType = scope?.scopeType ?? 'platform';
  const scopeId = scope?.scopeId?.trim() ?? '';
  if (scopeType !== 'platform' && !scopeId) {
    throw new Error(`[ConfigService] scopeType="${scopeType}" 必须提供 scopeId`);
  }
  return { scopeType, scopeId: scopeType === 'platform' ? '' : scopeId };
}

export class ConfigService implements IConfigService {
  /** Schema from manifest.configuration.properties. */
  private schema: Record<string, ConfigProperty>;
  /** In-memory cache (scoped key → value). `null` 表示「明确没有值」，避免反复查询。 */
  private values = new Map<string, unknown>();
  /** Change listeners. */
  private listeners = new Set<ConfigChangeCallback>();
  /** DB reference for persistence. */
  private db: any;
  /** manifest.id for storage namespace. */
  private manifestId: string;
  private tableEnsured = false;

  static readonly KEY_PREFIX = 'config:';
  static readonly TABLE = 'plugin_config';

  constructor(db: any, manifest: Manifest) {
    this.db = db;
    this.manifestId = manifest.id;
    this.schema = (manifest.configuration?.properties as Record<string, ConfigProperty>) ?? {};
  }

  // ── Schema helpers ────────────────────────────────────────────────────

  /** Check if a config key is declared in the manifest. */
  hasKey(key: string): boolean {
    return key in this.schema;
  }

  /** Get the schema definition for a key. */
  getSchema(key: string): ConfigProperty | undefined {
    return this.schema[key];
  }

  /**
   * 该配置项允许覆盖的作用域（`platform` 始终允许）。
   *
   * 未声明 `scope` 的老插件保持「只有一层」的行为。
   */
  allowedScopes(key: string): ConfigScopeType[] {
    const declared = this.schema[key]?.scope;
    const allowed = new Set<ConfigScopeType>(['platform']);
    if (Array.isArray(declared)) {
      for (const scope of declared) {
        if (scope !== 'platform' && CONFIG_SCOPE_TYPES.includes(scope)) allowed.add(scope);
      }
    }
    return [...allowed];
  }

  // ── Value access ──────────────────────────────────────────────────────

  get<T = unknown>(key: string, options: ConfigReadOptions = {}): T {
    // 1. Cache / DB：从最具体到最宽泛
    for (const { scopeType, scopeId } of this.scopeChain(options)) {
      const resolved = this.readScoped(key, scopeType, scopeId);
      if (resolved.found) return resolved.value as T;
    }

    // 2. 老库回退：plugin_storage 的 config:<key> 视为平台层（迁移未执行时仍可读）
    const legacy = this.readLegacyPlatformValue(key);
    if (legacy.found) return legacy.value as T;

    // 3. Return default from schema
    const schema = this.schema[key];
    if (schema?.default !== undefined) return schema.default as T;

    // 4. No value
    return undefined as T;
  }

  getAll(options: ConfigReadOptions = {}): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(this.schema)) {
      result[key] = this.get(key, options);
    }
    return result;
  }

  /** 解析顺序：班级 > 学校 > 平台。 */
  private scopeChain(options: ConfigReadOptions): Array<{ scopeType: ConfigScopeType; scopeId: string }> {
    const chain: Array<{ scopeType: ConfigScopeType; scopeId: string }> = [];
    const classId = options.classId?.trim();
    const schoolId = options.schoolId?.trim();
    if (classId) chain.push({ scopeType: 'class', scopeId: classId });
    if (schoolId) chain.push({ scopeType: 'school', scopeId: schoolId });
    chain.push({ scopeType: 'platform', scopeId: '' });
    return chain;
  }

  private readScoped(key: string, scopeType: ConfigScopeType, scopeId: string): { found: boolean; value?: unknown } {
    const cacheKey = scopedId(scopeType, scopeId, key);
    if (this.values.has(cacheKey)) {
      const cached = this.values.get(cacheKey);
      return cached === null ? { found: false } : { found: true, value: cached };
    }

    const row = this.queryScoped(key, scopeType, scopeId);
    if (!row) {
      this.values.set(cacheKey, null);
      return { found: false };
    }
    try {
      const parsed = JSON.parse(row.value);
      this.values.set(cacheKey, parsed);
      return { found: true, value: parsed };
    } catch {
      this.values.set(cacheKey, row.value);
      return { found: true, value: row.value };
    }
  }

  private queryScoped(key: string, scopeType: ConfigScopeType, scopeId: string): { value: string } | undefined {
    try {
      return this.db
        .prepare(
          `SELECT value FROM ${ConfigService.TABLE}
           WHERE plugin_id = ? AND scope_type = ? AND scope_id = ? AND key = ?`,
        )
        .get(this.manifestId, scopeType, scopeId, key) as { value: string } | undefined;
    } catch {
      // 表尚未建立（旧库/测试夹具）—— 交给 legacy 回退。
      return undefined;
    }
  }

  private readLegacyPlatformValue(key: string): { found: boolean; value?: unknown } {
    const cacheKey = scopedId('platform', '', `legacy:${key}`);
    if (this.values.has(cacheKey)) {
      const cached = this.values.get(cacheKey);
      return cached === null ? { found: false } : { found: true, value: cached };
    }
    try {
      const row = this.db
        .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
        .get(this.manifestId, ConfigService.KEY_PREFIX + key) as { value: string } | undefined;
      if (!row) {
        this.values.set(cacheKey, null);
        return { found: false };
      }
      const parsed = JSON.parse(row.value);
      this.values.set(cacheKey, parsed);
      return { found: true, value: parsed };
    } catch {
      this.values.set(cacheKey, null);
      return { found: false };
    }
  }

  // ── Validation ────────────────────────────────────────────────────────

  private validate(key: string, value: unknown): void {
    const prop = this.schema[key];
    if (!prop) {
      throw new Error(`[ConfigService] Unknown config key: "${key}". Declare it in manifest.configuration.`);
    }

    const type = typeof value;
    switch (prop.type) {
      case 'string':
        if (type !== 'string') throw new Error(`[ConfigService] "${key}" must be string, got ${type}`);
        break;
      case 'number':
      case 'integer':
        if (type !== 'number') throw new Error(`[ConfigService] "${key}" must be number, got ${type}`);
        if (prop.type === 'integer' && !Number.isInteger(value as number)) {
          throw new Error(`[ConfigService] "${key}" must be integer`);
        }
        if (prop.minimum !== undefined && (value as number) < prop.minimum) {
          throw new Error(`[ConfigService] "${key}" minimum is ${prop.minimum}`);
        }
        if (prop.maximum !== undefined && (value as number) > prop.maximum) {
          throw new Error(`[ConfigService] "${key}" maximum is ${prop.maximum}`);
        }
        break;
      case 'boolean':
        if (type !== 'boolean') throw new Error(`[ConfigService] "${key}" must be boolean, got ${type}`);
        break;
    }

    if (prop.enum && !prop.enum.includes(value)) {
      throw new Error(`[ConfigService] "${key}" value not in allowed enum: ${prop.enum.join(', ')}`);
    }
  }

  private assertScopeAllowed(key: string, scopeType: ConfigScopeType): void {
    const allowed = this.allowedScopes(key);
    if (!allowed.includes(scopeType)) {
      throw new Error(
        `[ConfigService] "${key}" 不允许在 ${scopeType} 层覆盖（manifest 声明允许：${allowed.join(', ')}）。` +
          ' 在 configuration.properties.' +
          key +
          '.scope 中显式声明后才能写入。',
      );
    }
  }

  // ── Mutation ──────────────────────────────────────────────────────────

  async set(key: string, value: unknown, scope?: ConfigWriteScope): Promise<void> {
    this.setSync(key, value, scope);
  }

  /**
   * Synchronous version of set(), for use in sync REST handlers.
   */
  setSync(key: string, value: unknown, scope?: ConfigWriteScope): void {
    this.validate(key, value);
    const { scopeType, scopeId } = normalizeWriteScope(scope);
    this.assertScopeAllowed(key, scopeType);

    const cacheKey = scopedId(scopeType, scopeId, key);
    const previous = this.values.get(cacheKey);
    this.values.set(cacheKey, value);

    try {
      this.ensureTable();
      this.db
        .prepare(
          `INSERT INTO ${ConfigService.TABLE} (plugin_id, scope_type, scope_id, key, value, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(plugin_id, scope_type, scope_id, key)
           DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(this.manifestId, scopeType, scopeId, key, JSON.stringify(value), Date.now());
    } catch (e) {
      // Rollback cache on persistence failure
      if (previous === undefined) {
        this.values.delete(cacheKey);
      } else {
        this.values.set(cacheKey, previous);
      }
      throw e;
    }

    // 同 key 的其他作用域缓存可能仍有效，但清单/默认值没变；
    // 只有「本作用域」被改，无需全清。保留 legacy 与待覆盖层。

    for (const listener of this.listeners) {
      try {
        listener(key, value, previous === null ? undefined : previous);
      } catch {
        // silent — listener errors shouldn't break config writes
      }
    }
  }

  /** 懒建表：兼容未执行迁移 037 的旧库与单元测试夹具。 */
  private ensureTable(): void {
    if (this.tableEnsured) return;
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${ConfigService.TABLE} (
      plugin_id TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'platform',
      scope_id TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, scope_type, scope_id, key)
    )`);
    this.tableEnsured = true;
  }

  // ── Events ────────────────────────────────────────────────────────────

  onChange(callback: ConfigChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Preload all config values from DB into the in-memory cache.
   *
   * 同时加载所有作用域（平台/学校/班级）与旧 `plugin_storage` 行：
   * 插件在 `activate()` 里通常会马上读配置，提前填充避免每条配置一次查询。
   */
  loadFromDB(): void {
    try {
      const rows = this.db
        .prepare(`SELECT scope_type, scope_id, key, value FROM ${ConfigService.TABLE} WHERE plugin_id = ?`)
        .all(this.manifestId) as Array<{ scope_type: ConfigScopeType; scope_id: string; key: string; value: string }>;
      for (const row of rows) {
        const scopeType: ConfigScopeType = CONFIG_SCOPE_TYPES.includes(row.scope_type) ? row.scope_type : 'platform';
        this.values.set(scopedId(scopeType, row.scope_id ?? '', row.key), this.parseStored(row.value));
      }
    } catch {
      // 表尚不存在 —— 继续读 legacy。
    }

    try {
      const prefix = ConfigService.KEY_PREFIX;
      const rows = this.db
        .prepare(`SELECT key, value FROM plugin_storage WHERE plugin_id = ? AND key LIKE ?`)
        .all(this.manifestId, prefix + '%') as Array<{ key: string; value: string }>;
      for (const row of rows) {
        const key = row.key.slice(prefix.length);
        this.values.set(scopedId('platform', '', `legacy:${key}`), this.parseStored(row.value));
      }
    } catch {
      // plugin_storage 可能不存在 —— 全部走默认值
    }
  }

  private parseStored(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /** 测试/诊断：当前缓存里的作用域条目数。 */
  cachedEntryCount(): number {
    return this.values.size;
  }
}
