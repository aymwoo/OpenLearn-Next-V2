/**
 * 扩展点 slotProps 在宿主类型里是 Record<string, any>。
 * 消费端先收成 unknown，再按字段校验，避免把 any 漏进回调参数。
 */

export function readSlotRecord(slotProps: object | null | undefined): Readonly<Record<string, unknown>> {
  if (slotProps == null) return {};
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(slotProps)) {
    record[key] = Reflect.get(slotProps, key) as unknown;
  }
  return record;
}

export function readOptionalString(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function readStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry === 'string') list.push(entry);
  }
  return list.length > 0 ? list : undefined;
}

export function readPayload(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    payload[key] = Reflect.get(value, key) as unknown;
  }
  return payload;
}

export function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback;
  for (const option of allowed) {
    if (option === value) return option;
  }
  return fallback;
}
