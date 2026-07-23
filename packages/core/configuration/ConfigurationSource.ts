/**
 * ConfigurationSource — low-level readers for configuration origins (PI-011).
 *
 * A source yields a nested configuration object. Concrete implementations:
 *  - `MemorySource`     — values held in memory.
 *  - `EnvironmentSource`— process environment variables (optionally prefixed).
 *  - `JsonFileSource`  — a JSON file on disk.
 *  - `YamlFileSource`  — a YAML file on disk (optional; requires the `yaml` package).
 */

import * as fs from 'node:fs';
import { ConfigurationError } from './ConfigurationError.js';
import type { ConfigurationSourceInit, ConfigurationSourceKind } from './types.js';
import { coerceEnvValue, setByPath } from './utils.js';

export abstract class ConfigurationSource {
  public readonly kind: ConfigurationSourceKind;
  public readonly id: string;

  public constructor(kind: ConfigurationSourceKind, id?: string) {
    this.kind = kind;
    this.id = id ?? `${kind}-source`;
  }

  public abstract read(): Promise<Record<string, unknown>>;
}

export class MemorySource extends ConfigurationSource {
  private readonly values: Record<string, unknown>;

  public constructor(values: Record<string, unknown>, id?: string) {
    super('memory', id ?? 'memory');
    this.values = values;
  }

  public async read(): Promise<Record<string, unknown>> {
    return JSON.parse(JSON.stringify(this.values)) as Record<string, unknown>;
  }
}

export class EnvironmentSource extends ConfigurationSource {
  private readonly prefix?: string;
  private readonly env: Record<string, string | undefined>;
  private readonly map?: (key: string, value: string) => [string, unknown] | null;

  public constructor(init: {
    prefix?: string;
    env?: Record<string, string | undefined>;
    map?: (key: string, value: string) => [string, unknown] | null;
    id?: string;
  }) {
    super('environment', init.id ?? 'environment');
    this.prefix = init.prefix;
    this.env = init.env ?? process.env;
    this.map = init.map;
  }

  public async read(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (value === undefined) continue;
      const mapped = this.map
        ? this.map(key, value)
        : defaultEnvMap(key, value, this.prefix);
      if (!mapped) continue;
      const [path, val] = mapped;
      setByPath(out, path, val);
    }
    return out;
  }
}

export class JsonFileSource extends ConfigurationSource {
  private readonly filePath: string;

  public constructor(filePath: string, id?: string) {
    super('json', id ?? `json:${filePath}`);
    this.filePath = filePath;
  }

  public async read(): Promise<Record<string, unknown>> {
    try {
      const text = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text);
      return (parsed ?? {}) as Record<string, unknown>;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigurationError(
        `Failed to read JSON config '${this.filePath}': ${message}`,
        'SOURCE_READ_FAILED',
        this.filePath,
      );
    }
  }
}

export class YamlFileSource extends ConfigurationSource {
  private readonly filePath: string;

  public constructor(filePath: string, id?: string) {
    super('yaml', id ?? `yaml:${filePath}`);
    this.filePath = filePath;
  }

  public async read(): Promise<Record<string, unknown>> {
    let text: string;
    try {
      text = await fs.promises.readFile(this.filePath, 'utf8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfigurationError(
        `Failed to read YAML config '${this.filePath}': ${message}`,
        'SOURCE_READ_FAILED',
        this.filePath,
      );
    }
    // Optional dependency: resolved dynamically so the module loads without it.
    const pkg = 'yaml';
    const mod: { parse?: (src: string) => unknown } = await import(pkg).catch(() => ({}));
    if (typeof mod.parse !== 'function') {
      throw new ConfigurationError(
        `YAML support requires the 'yaml' package (could not load it for '${this.filePath}').`,
        'SOURCE_READ_FAILED',
        this.filePath,
      );
    }
    return (mod.parse(text) ?? {}) as Record<string, unknown>;
  }
}

/** Default env-var → dotted-path mapping (strip prefix, split on `_`/`.`). */
function defaultEnvMap(
  key: string,
  value: string,
  prefix?: string,
): [string, unknown] | null {
  let name = key;
  if (prefix && name.startsWith(prefix)) name = name.slice(prefix.length);
  if (!name) return null;
  const path = name
    .toLowerCase()
    .split(/[_.]/)
    .filter(Boolean)
    .join('.');
  if (!path) return null;
  return [path, coerceEnvValue(value)];
}

/** Build a concrete source from a declarative {@link ConfigurationSourceInit}. */
export function buildSource(init: ConfigurationSourceInit): ConfigurationSource {
  switch (init.kind) {
    case 'memory':
      return new MemorySource(init.values ?? {}, init.id);
    case 'environment':
      return new EnvironmentSource({ prefix: init.prefix, env: init.env, map: init.map, id: init.id });
    case 'json':
      if (!init.path) {
        throw new ConfigurationError('JSON source requires a `path`.', 'INVALID_SOURCE');
      }
      return new JsonFileSource(init.path, init.id);
    case 'yaml':
      if (!init.path) {
        throw new ConfigurationError('YAML source requires a `path`.', 'INVALID_SOURCE');
      }
      return new YamlFileSource(init.path, init.id);
    default:
      throw new ConfigurationError(`Unknown source kind: ${(init as { kind: string }).kind}`, 'INVALID_SOURCE');
  }
}
