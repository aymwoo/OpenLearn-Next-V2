/**
 * OpenLearn AI Capability Layer - Telemetry Logger
 * Logs Capability execution requests, responses, latency, provider IDs, tokens, and errors.
 *
 * ── 内存与隐私约束（2026-10-03 修正）────────────────────────────────────
 * 本 logger 在内核生命周期内是**单例常驻**的：`AICapabilityKernel.dispose()` 才会
 * 调 `clear()`，而服务端运行期几乎不会走到 dispose。此前实现把完整的
 * `requestPayload` / `responsePayload`（含 AI prompt 与 completion 全文）无上限地
 * 追加进内存数组，且生产代码中**没有任何消费者**读取它 —— 属于"只写不读"的
 * 无限增长 + PII 滞留。
 *
 * 修正后：
 * 1. **有界环形缓冲**：默认只保留最近 `maxEntries` 条，旧条目自动挤出。
 * 2. **TTL 过期**：默认 `ttlMs` 后过期，读取与写入时惰性清理。
 * 3. **默认不落全量载荷**：仅记录载荷的"形状摘要"（类型键名与长度），不记录
 *    值本身。需要全文时显式开启 `capturePayload`（或设环境变量）。
 *
 * 环境变量覆盖：
 * - `AI_CAPABILITY_LOG_MAX_ENTRIES`  整数，默认 200
 * - `AI_CAPABILITY_LOG_TTL_MS`       整数，默认 1800000（30 分钟）；<=0 表示不过期
 * - `AI_CAPABILITY_LOG_CAPTURE_PAYLOAD`  `true` / `1` 时记录完整载荷（默认 false）
 */

import { CapabilityLogEntry } from '../types/index.js';

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 分钟
const DEFAULT_PAYLOAD_PREVIEW_CHARS = 120;

export interface CapabilityLoggerOptions {
  /** 最多保留的日志条数（环形缓冲）。<=0 表示不限制（不推荐）。 */
  maxEntries?: number;
  /** 条目存活时长（毫秒）。<=0 表示不过期（不推荐）。 */
  ttlMs?: number;
  /** 是否记录完整载荷。默认 false —— 只记录形状摘要。 */
  capturePayload?: boolean;
  /** capturePayload 为 false 时，摘要中每个字符串值保留的字符数。 */
  payloadPreviewChars?: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

/**
 * 生成载荷的"形状摘要"：保留键名与体积信息，去掉值本身。
 *
 * 这样仍能回答"这次调用传了哪些字段、payload 多大"这类排障问题，
 * 但不会把学生姓名、答题内容、生成文本等原文长期留在内存里。
 */
function summarizePayload(value: unknown, previewChars: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return { __type: 'string', length: value.length, preview: value.slice(0, previewChars) };
  }
  if (Array.isArray(value)) {
    return { __type: 'array', length: value.length };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || typeof v !== 'object') {
        out[k] = typeof v === 'string' ? `<string:${v.length}>` : v;
      } else {
        out[k] = summarizePayload(v, previewChars);
      }
    }
    return out;
  }
  return value;
}

export class CapabilityLogger {
  private logs: CapabilityLogEntry[] = [];

  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly capturePayload: boolean;
  private readonly payloadPreviewChars: number;

  constructor(options: CapabilityLoggerOptions = {}) {
    this.maxEntries = options.maxEntries ?? envInt('AI_CAPABILITY_LOG_MAX_ENTRIES', DEFAULT_MAX_ENTRIES);
    this.ttlMs = options.ttlMs ?? envInt('AI_CAPABILITY_LOG_TTL_MS', DEFAULT_TTL_MS);
    this.capturePayload =
      options.capturePayload ?? envBool('AI_CAPABILITY_LOG_CAPTURE_PAYLOAD', false);
    this.payloadPreviewChars = options.payloadPreviewChars ?? DEFAULT_PAYLOAD_PREVIEW_CHARS;
  }

  public log(entry: CapabilityLogEntry): void {
    const stored: CapabilityLogEntry = this.capturePayload
      ? Object.freeze(entry)
      : Object.freeze({
          ...entry,
          requestPayload: summarizePayload(entry.requestPayload, this.payloadPreviewChars),
          responsePayload: summarizePayload(entry.responsePayload, this.payloadPreviewChars),
        });

    this.logs.push(stored);
    this.evict();
  }

  /** 惰性清理：先剔除过期条目，再按环形缓冲挤出最旧的条目。 */
  private evict(): void {
    if (this.ttlMs > 0) {
      const cutoff = Date.now() - this.ttlMs;
      let drop = 0;
      while (drop < this.logs.length && this.logs[drop]!.timestamp < cutoff) drop++;
      if (drop > 0) this.logs.splice(0, drop);
    }
    if (this.maxEntries > 0 && this.logs.length > this.maxEntries) {
      this.logs.splice(0, this.logs.length - this.maxEntries);
    }
  }

  public getLogs(capabilityId?: string): ReadonlyArray<CapabilityLogEntry> {
    this.evict();
    if (capabilityId) {
      return Object.freeze(this.logs.filter((l) => l.capabilityId === capabilityId));
    }
    return Object.freeze([...this.logs]);
  }

  public get size(): number {
    this.evict();
    return this.logs.length;
  }

  public clear(): void {
    this.logs = [];
  }
}
