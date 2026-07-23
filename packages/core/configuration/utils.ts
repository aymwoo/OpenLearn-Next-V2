/**
 * Internal helpers for the Platform Configuration System (PI-011).
 *
 * Utilities for dotted-path access, deep merge/clone, and value coercion.
 * Kept dependency-free so the configuration module stays self-contained.
 */

import type { ConfigurationValueType } from './types.js';

/** Read a nested value by dotted path (`a.b.c`). Returns `undefined` if absent. */
export function getByPath(root: Record<string, unknown>, path: string): unknown {
  if (!root) return undefined;
  const segments = path.split('.');
  let current: unknown = root;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Write a nested value by dotted path, creating intermediate objects. */
export function setByPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = current[seg];
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/** Deep clone of plain objects / arrays / primitives. */
export function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepClone(v);
    return out as unknown as T;
  }
  return value;
}

/** Deep merge `source` into `target` (plain objects merge; arrays/scalars replace). */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out = deepClone(target);
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = deepClone(value);
    }
  }
  return out;
}

/** Deeply freeze a plain object so snapshots are truly immutable. */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
  } else if (isPlainObject(value)) {
    Object.values(value).forEach(deepFreeze);
  }
  return Object.freeze(value);
}

/** Coerce an environment-variable string into a typed primitive. */
export function coerceEnvValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
}

/** Validate a runtime value against an expected configuration value type. */
export function typeMatches(value: unknown, type: ConfigurationValueType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value != null && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}
