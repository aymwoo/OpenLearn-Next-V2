# Configuration Specification (配置规格)

> **Scope:** PI-011. Companion reference to
> [`Platform Configuration.md`](Platform Configuration.md). Documents the exact
> type shapes, descriptor fields, validation codes, and load-result contract.

---

## 1. Enumerations

### `ConfigurationScope`

```typescript
type ConfigurationScope = 'Platform' | 'Kernel' | 'Infrastructure' | 'Application';
```

`ALL_CONFIGURATION_SCOPES` is the frozen tuple of all four values. `Application`
is reserved for application bootstrap and is not populated by the platform
kernel itself.

### `ConfigurationValueType`

```typescript
type ConfigurationValueType = 'string' | 'number' | 'boolean' | 'array' | 'object';
```

### `ConfigurationSourceKind`

```typescript
type ConfigurationSourceKind = 'memory' | 'environment' | 'json' | 'yaml';
```

---

## 2. Source Initializers

### `ConfigurationSourceInit`

```typescript
interface ConfigurationSourceInit {
  kind: ConfigurationSourceKind;
  id?: string;
  // memory
  values?: Record<string, unknown>;
  // environment
  prefix?: string;
  env?: Record<string, string | undefined>;
  map?: (key: string, value: string) => [string, unknown] | null;
  // json | yaml
  path?: string;
}
```

`buildSource(init)` returns the matching `ConfigurationSource` subclass.

### `EnvironmentSource` coercion

`coerceEnvValue(raw)`:

- `"true"` → `true`, `"false"` → `false`
- numeric strings (`"9001"`, `"3.14"`) → `number`
- everything else → the original `string`

Key mapping (default `map`): strip optional `prefix`, lowercase, split on `_`
or `.`, join with `.` → dotted path. e.g. `APP_KERNEL_PORT` with prefix `APP_`
→ `kernel.port`.

---

## 3. Descriptors

### `ConfigurationDescriptorInit`

```typescript
interface ConfigurationDescriptorInit {
  path: string;                 // dotted path, e.g. 'kernel.port'
  scope?: ConfigurationScope;   // default 'Platform'
  type?: ConfigurationValueType;
  required?: boolean;           // default false
  default?: unknown;            // applied when missing, before validation
  min?: number;                 // numeric lower bound (inclusive)
  max?: number;                 // numeric upper bound (inclusive)
  enum?: ReadonlyArray<unknown>; // allowed value set
}
```

`ConfigurationDescriptor` is the immutable runtime form (fields frozen). The
constructor validates that `scope` is a member of
`ALL_CONFIGURATION_SCOPES`.

---

## 4. Provider Initializer

### `ConfigurationProviderInit`

```typescript
interface ConfigurationProviderInit {
  id: string;                                  // unique, non-empty
  scope: ConfigurationScope;
  priority?: number;                           // default 0 (higher wins)
  source: ConfigurationSource | ConfigurationSourceInit;
  descriptors?: ConfigurationDescriptorInit[];
  description?: string;
}
```

`ConfigurationProvider` normalizes `source` (accepts either an instance or an
init) and freezes `descriptors`.

---

## 5. Validation Report

### `ConfigurationValidationCode`

```typescript
type ConfigurationValidationCode =
  | 'REQUIRED'
  | 'TYPE'
  | 'RANGE_MIN'
  | 'RANGE_MAX'
  | 'ENUM';
```

### `ConfigurationValidationError`

```typescript
interface ConfigurationValidationError {
  code: ConfigurationValidationCode;
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}
```

### `ConfigurationValidationReport`

```typescript
interface ConfigurationValidationReport {
  isValid: boolean;
  errors: ConfigurationValidationError[];
  warnings: ConfigurationValidationError[];
}
```

Validation order per descriptor: `REQUIRED` → `TYPE` → `RANGE_MIN` →
`RANGE_MAX` → `ENUM`. A single descriptor reports at most the first failing
check.

---

## 6. Load Result

### `ConfigurationLoadResult`

```typescript
interface ConfigurationLoadResult {
  config: Record<string, unknown>;
  report: ConfigurationValidationReport;
  snapshot: ConfigurationSnapshot;
}
```

---

## 7. Snapshot (immutable read view)

`ConfigurationSnapshot` wraps a **deep-frozen** copy of the merged config.

| Method | Returns | Purpose |
|---|---|---|
| `get<T>(path)` | `T \| undefined` | Read a value (never throws). |
| `tryGet<T>(path, fallback?)` | `T \| undefined` | Read with fallback. |
| `exists(path)` | `boolean` | Presence check. |
| `toObject()` | `Record<string, unknown>` | Defensive deep clone of the data. |
| `list()` | `ReadonlyArray<string>` | Top-level keys. |
| `getTyped<T>(path, type)` | `T \| undefined` | Read + `typeMatches` guard. |

---

## 8. Error Type

`ConfigurationError extends Error` with:

- `code: string` — one of `INVALID_DESCRIPTOR`, `INVALID_SCOPE`,
  `PROVIDER_EXISTS`, `SOURCE_READ_FAILED`, `INVALID_SOURCE`, `NOT_FOUND`,
  `SCOPE_MISMATCH`.
- `path?: string`
- `scope?: ConfigurationScope`

`get(path)` throws `ConfigurationError` with code `NOT_FOUND` when the path is
absent (and `SCOPE_MISMATCH` semantics are handled by returning `undefined` for
scope-filtered reads, not by throwing).
