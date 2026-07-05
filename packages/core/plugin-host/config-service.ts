/**
 * config-service.ts — plugin configuration service (V3.0).
 *
 * Follows VS Code's JSON Schema approach: plugins declare settings in
 * manifest.json, values are stored in plugin_storage, validated against
 * the schema, with defaults from the declaration.
 *
 * ## Architecture
 *
 *   manifest.json "configuration" section
 *         ↓ (parsed at install time)
 *   ConfigService (in-memory schema + DB-backed storage)
 *         ↓
 *   ctx.config.get('maxQuestions')  — typed, validated, defaulted
 *
 * ## Storage
 *
 * Reuses the existing plugin_storage table with a "config:" key prefix
 * to namespace config values alongside other plugin storage.
 */

import type { Manifest } from '../esm-loader/manifest-schema.js';

// ── Types ────────────────────────────────────────────────────────────────

/** A single configuration property definition from manifest. */
export interface ConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'integer';
  default?: unknown;
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
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
  /** Get a single config value by key, with schema validation and default. */
  get<T = unknown>(key: string): T;

  /** Get all config values as a plain object. */
  getAll(): Record<string, unknown>;

  /**
   * Set a config value. Validates against the schema before writing.
   * Throws if the key is not declared in manifest.configuration.
   */
  set(key: string, value: unknown): Promise<void>;

  /** Listen for config changes. Returns an unsubscribe function. */
  onChange(callback: ConfigChangeCallback): () => void;
}

// ── Implementation ───────────────────────────────────────────────────────

export class ConfigService implements IConfigService {
  /** Schema from manifest.configuration.properties. */
  private schema: Record<string, ConfigProperty>;
  /** In-memory values cache (key → value). */
  private values = new Map<string, unknown>();
  /** Change listeners. */
  private listeners = new Set<ConfigChangeCallback>();
  /** DB reference for persistence. */
  private db: any;
  /** manifest.id for storage namespace. */
  private manifestId: string;

  static readonly KEY_PREFIX = 'config:';

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

  // ── Value access ──────────────────────────────────────────────────────

  get<T = unknown>(key: string): T {
    // 1. Check cache
    if (this.values.has(key)) {
      return this.values.get(key) as T;
    }

    // 2. Try DB
    const storageKey = ConfigService.KEY_PREFIX + key;
    try {
      const row = this.db
        .prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
        .get(this.manifestId, storageKey) as { value: string } | undefined;
      if (row) {
        const parsed = JSON.parse(row.value);
        this.values.set(key, parsed);
        return parsed as T;
      }
    } catch {
      // DB read failed — fall through to default
    }

    // 3. Return default from schema
    const schema = this.schema[key];
    if (schema?.default !== undefined) {
      this.values.set(key, schema.default);
      return schema.default as T;
    }

    // 4. No value — return undefined
    return undefined as T;
  }

  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(this.schema)) {
      result[key] = this.get(key);
    }
    return result;
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

  // ── Mutation ──────────────────────────────────────────────────────────

  async set(key: string, value: unknown): Promise<void> {
    this.validate(key, value);

    const oldValue = this.values.get(key);
    this.values.set(key, value);

    // Persist to DB
    const storageKey = ConfigService.KEY_PREFIX + key;
    try {
      this.db.prepare(
        `INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(this.manifestId, storageKey, JSON.stringify(value), Date.now());
    } catch (e) {
      // Rollback cache on persistence failure
      if (oldValue === undefined) {
        this.values.delete(key);
      } else {
        this.values.set(key, oldValue);
      }
      throw e;
    }

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(key, value, oldValue);
      } catch {
        // ponytail: silent — listener errors shouldn't break config writes
      }
    }
  }

  // ── Events ────────────────────────────────────────────────────────────

  onChange(callback: ConfigChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Preload all config values from DB into the in-memory cache. */
  loadFromDB(): void {
    try {
      const prefix = ConfigService.KEY_PREFIX;
      const rows = this.db
        .prepare(
          `SELECT key, value FROM plugin_storage WHERE plugin_id = ? AND key LIKE ?`,
        )
        .all(this.manifestId, prefix + '%') as Array<{ key: string; value: string }>;

      for (const row of rows) {
        const key = row.key.slice(prefix.length);
        try {
          this.values.set(key, JSON.parse(row.value));
        } catch {
          this.values.set(key, row.value);
        }
      }
    } catch {
      // Table may not exist yet — fine, values will use defaults
    }
  }
}
