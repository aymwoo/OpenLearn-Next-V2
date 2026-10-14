/**
 * 教学环节时长解析。
 *
 * 教案编辑器、课程向导和默认时间线把时长存成带单位的字符串（"5m"、"20m"、"90s"、"1h"）。
 * 互动课堂的一部分视图和测试又把 `duration` 当成数字秒（300 = 5 分钟）。
 * 旧数据还可能写在 `durationMinutes` / `durationMin` / `estimatedDurationSeconds` 等字段上。
 *
 * 直接对 "5m" 做加法会触发字符串拼接，`Math.round("5m" / 60)` 得到 NaN。
 * 这里把各种写法收成秒，调用方再换算成分钟。读不到时返回 null，由调用方决定降级，避免 NaN。
 */

export const DEFAULT_SEGMENT_SECONDS = 300;

export interface ResolvedSegmentDuration {
  /** 计划时长（秒）。无法识别时为 null。 */
  seconds: number | null;
  /** false 表示秒数来自调用方给的缺省值，或根本没有可读时长。 */
  known: boolean;
}

export interface ResolveSegmentDurationOptions {
  /**
   * 时长字段缺失（null / undefined / ""，且没有旧字段）时使用的秒数。
   * 不传或传 null：缺失也返回 null。
   * 显式写了但无法解析的值不会套用这个缺省，以免把乱码伪装成默认时长。
   */
  fallbackSeconds?: number | null;
}

const MINUTE_KEYS = [
  'durationMinutes',
  'duration_minutes',
  'durationMin',
  'duration_min',
  'minutes',
  'mins',
  'plannedMinutes',
  'plannedMin',
] as const;

const SECOND_KEYS = [
  'estimatedDurationSeconds',
  'estimated_duration_seconds',
  'durationSeconds',
  'duration_seconds',
  'durationSec',
] as const;

const DURATION_TOKEN =
  /(-?\d+(?:\.\d+)?)\s*(小时|分钟|秒钟|时|分|秒|hours|hour|hrs|hr|minutes|minute|mins|min|seconds|second|secs|sec|h|m|s)/gi;

type InterpretMode = 'auto' | 'minutes' | 'seconds';

interface InterpretResult {
  kind: 'missing' | 'invalid' | 'value';
  seconds: number | null;
}

function isHourUnit(unit: string): boolean {
  return (
    unit === '小时' ||
    unit === '时' ||
    unit === 'h' ||
    unit === 'hr' ||
    unit === 'hrs' ||
    unit === 'hour' ||
    unit === 'hours'
  );
}

function isMinuteUnit(unit: string): boolean {
  return (
    unit === '分钟' ||
    unit === '分' ||
    unit === 'm' ||
    unit === 'min' ||
    unit === 'mins' ||
    unit === 'minute' ||
    unit === 'minutes'
  );
}

/**
 * 把时长字符串换成秒。
 * 无单位的纯数字按分钟处理，与备课时间线（"10" 即 10 分钟）和课中倒计时一致。
 * 无法识别时返回 null。
 */
export function parseDurationStringToSeconds(input: string): number | null {
  const raw = input.trim().toLowerCase();
  if (!raw || raw === 'nan' || raw === 'null' || raw === 'undefined' || raw === '未设置' || raw === 'unset') {
    return null;
  }

  DURATION_TOKEN.lastIndex = 0;
  let total = 0;
  let matched = false;
  for (const match of raw.matchAll(DURATION_TOKEN)) {
    matched = true;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const unit = match[2] ?? '';
    if (isHourUnit(unit)) total += amount * 3600;
    else if (isMinuteUnit(unit)) total += amount * 60;
    else total += amount;
  }

  if (matched) {
    if (!Number.isFinite(total) || total < 0) return null;
    return total;
  }

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw) * 60;
  }
  return null;
}

function finiteNonNegative(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function interpret(value: unknown, mode: InterpretMode): InterpretResult {
  if (value == null || value === '') return { kind: 'missing', seconds: null };

  if (typeof value === 'number') {
    const seconds = finiteNonNegative(mode === 'minutes' ? value * 60 : value);
    return seconds == null ? { kind: 'invalid', seconds: null } : { kind: 'value', seconds };
  }

  if (typeof value === 'string') {
    if (mode === 'seconds' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
      const seconds = finiteNonNegative(Number(value.trim()));
      return seconds == null ? { kind: 'invalid', seconds: null } : { kind: 'value', seconds };
    }
    const seconds = parseDurationStringToSeconds(value);
    return seconds == null ? { kind: 'invalid', seconds: null } : { kind: 'value', seconds };
  }

  return { kind: 'invalid', seconds: null };
}

function readLegacy(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function withFallback(fallbackSeconds: number | null): ResolvedSegmentDuration {
  if (fallbackSeconds == null || !Number.isFinite(fallbackSeconds) || fallbackSeconds < 0) {
    return { seconds: null, known: false };
  }
  return { seconds: fallbackSeconds, known: false };
}

/**
 * 从一个环节对象上读取计划时长（秒）。
 * 优先 `duration`：数字按秒，字符串按单位（无单位按分钟）。
 * `duration` 缺失或无法解析时，再看分钟字段和秒字段。
 */
export function resolveSegmentDuration(
  segment: unknown,
  options?: ResolveSegmentDurationOptions,
): ResolvedSegmentDuration {
  const fallbackSeconds = options?.fallbackSeconds ?? null;
  if (!segment || typeof segment !== 'object') return withFallback(fallbackSeconds);

  const record = segment as Record<string, unknown>;
  const hasDuration = Object.prototype.hasOwnProperty.call(record, 'duration');
  const durationState = hasDuration ? interpret(record.duration, 'auto') : { kind: 'missing' as const, seconds: null };
  if (durationState.kind === 'value') return { seconds: durationState.seconds, known: true };

  const minuteValue = readLegacy(record, MINUTE_KEYS);
  if (minuteValue !== undefined) {
    const parsed = interpret(minuteValue, 'minutes');
    if (parsed.kind === 'value') return { seconds: parsed.seconds, known: true };
  }

  const secondValue = readLegacy(record, SECOND_KEYS);
  if (secondValue !== undefined) {
    const parsed = interpret(secondValue, 'seconds');
    if (parsed.kind === 'value') return { seconds: parsed.seconds, known: true };
  }

  if (durationState.kind === 'invalid') return { seconds: null, known: false };
  return withFallback(fallbackSeconds);
}

/** 计划分钟。没有可读时长时返回 0，不编造默认分钟，也不会是 NaN。 */
export function segmentPlannedMinutes(segment: unknown): number {
  const { seconds } = resolveSegmentDuration(segment);
  if (seconds == null || !Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.round(seconds / 60));
}

export function formatSegmentDuration(
  seconds: number | null,
  lang: 'zh' | 'en' = 'zh',
): { minutes: number | null; compact: string; prose: string } {
  if (seconds == null || !Number.isFinite(seconds)) {
    const unset = lang === 'zh' ? '未设置' : 'Unset';
    return { minutes: null, compact: unset, prose: unset };
  }
  const minutes = Math.max(0, Math.round(seconds / 60));
  return {
    minutes,
    compact: `${minutes}m`,
    prose: lang === 'zh' ? `${minutes} 分钟` : `${minutes} min`,
  };
}
