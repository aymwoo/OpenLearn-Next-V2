/**
 * CapabilityLogger 的内存与隐私约束测试（2026-10-03）。
 *
 * 背景：旧实现把完整 AI prompt / completion 无上限追加进内存，且生产代码零消费者。
 * 这里锁定三条不变量：有界、过期、默认不落全量载荷。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CapabilityLogger } from '../logging/capability-logger.js';
import type { CapabilityLogEntry } from '../types/index.js';

function entry(over: Partial<CapabilityLogEntry> = {}): CapabilityLogEntry {
  return {
    capabilityId: 'capability_completion',
    requestPayload: { prompt: '张同学的问题是：求导公式怎么记？', options: { temperature: 0.3 } },
    responsePayload: { result: '建议先理解定义再记公式……' },
    latencyMs: 12,
    providerId: 'provider_gateway',
    timestamp: Date.now(),
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.AI_CAPABILITY_LOG_MAX_ENTRIES;
  delete process.env.AI_CAPABILITY_LOG_TTL_MS;
  delete process.env.AI_CAPABILITY_LOG_CAPTURE_PAYLOAD;
});

describe('CapabilityLogger — 有界环形缓冲', () => {
  it('超过 maxEntries 后只保留最近的条目', () => {
    const logger = new CapabilityLogger({ maxEntries: 3, ttlMs: 0 });
    for (let i = 0; i < 10; i++) {
      logger.log(entry({ capabilityId: `cap_${i}`, latencyMs: i }));
    }
    const logs = logger.getLogs();
    expect(logs).toHaveLength(3);
    // 保留的是最新的三条
    expect(logs.map((l) => l.capabilityId)).toEqual(['cap_7', 'cap_8', 'cap_9']);
  });

  it('内存不会随调用次数无限增长（500 次调用后仍在上限内）', () => {
    const logger = new CapabilityLogger({ maxEntries: 50, ttlMs: 0 });
    for (let i = 0; i < 500; i++) logger.log(entry());
    expect(logger.size).toBe(50);
  });
});

describe('CapabilityLogger — TTL 过期', () => {
  it('超过 ttlMs 的条目在读取时被剔除', () => {
    vi.useFakeTimers();
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 1000 });
    logger.log(entry({ capabilityId: 'old' }));
    vi.advanceTimersByTime(1500);
    logger.log(entry({ capabilityId: 'new' }));
    const logs = logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.capabilityId).toBe('new');
  });

  it('ttlMs <= 0 表示不过期', () => {
    vi.useFakeTimers();
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0 });
    logger.log(entry());
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(logger.size).toBe(1);
  });
});

describe('CapabilityLogger — 默认不落全量载荷', () => {
  it('默认把 requestPayload 里的字符串替换为长度摘要，不保留原文', () => {
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0 });
    logger.log(entry());
    const stored = logger.getLogs()[0]!;
    const req = stored.requestPayload as Record<string, unknown>;
    // 原文不再存在
    expect(JSON.stringify(req)).not.toContain('张同学');
    expect(JSON.stringify(req)).not.toContain('求导公式');
    // 但形状信息仍可用于排障
    expect(req.prompt).toBe(`<string:${'张同学的问题是：求导公式怎么记？'.length}>`);
    expect((req.options as Record<string, unknown>).temperature).toBe(0.3);
  });

  it('默认同样不保留 responsePayload 原文', () => {
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0 });
    const raw = '建议先理解定义再记公式……';
    logger.log(entry({ responsePayload: { result: raw } }));
    const stored = logger.getLogs()[0]!;
    expect(JSON.stringify(stored.responsePayload)).not.toContain('建议先理解定义');
    const resp = stored.responsePayload as Record<string, unknown>;
    expect(resp.result).toBe(`<string:${raw.length}>`);
  });

  it('字符串载荷保留受限长度的 preview，便于粗略定位', () => {
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0, payloadPreviewChars: 5 });
    logger.log(entry({ requestPayload: 'abcdefghijklmnop' }));
    const stored = logger.getLogs()[0]!;
    expect(stored.requestPayload).toEqual({ __type: 'string', length: 16, preview: 'abcde' });
  });

  it('capturePayload: true 时保留完整载荷（显式开启）', () => {
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0, capturePayload: true });
    logger.log(entry());
    const stored = logger.getLogs()[0]!;
    expect(JSON.stringify(stored.requestPayload)).toContain('求导公式');
  });
});

describe('CapabilityLogger — 环境变量覆盖', () => {
  it('AI_CAPABILITY_LOG_CAPTURE_PAYLOAD=true 时记录完整载荷', () => {
    process.env.AI_CAPABILITY_LOG_CAPTURE_PAYLOAD = 'true';
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0 });
    logger.log(entry());
    expect(JSON.stringify(logger.getLogs()[0]!.requestPayload)).toContain('求导公式');
  });

  it('AI_CAPABILITY_LOG_MAX_ENTRIES 生效', () => {
    process.env.AI_CAPABILITY_LOG_MAX_ENTRIES = '2';
    const logger = new CapabilityLogger({ ttlMs: 0 });
    for (let i = 0; i < 5; i++) logger.log(entry({ capabilityId: `cap_${i}` }));
    expect(logger.size).toBe(2);
  });

  it('非法值回退到默认值而非抛错', () => {
    process.env.AI_CAPABILITY_LOG_MAX_ENTRIES = 'not-a-number';
    const logger = new CapabilityLogger({ ttlMs: 0 });
    for (let i = 0; i < 250; i++) logger.log(entry());
    expect(logger.size).toBe(200);
  });
});

describe('CapabilityLogger — 既有行为保持', () => {
  it('按 capabilityId 过滤仍然有效', () => {
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0, capturePayload: true });
    logger.log(entry({ capabilityId: 'a' }));
    logger.log(entry({ capabilityId: 'b' }));
    logger.log(entry({ capabilityId: 'a' }));
    expect(logger.getLogs('a')).toHaveLength(2);
    expect(logger.getLogs()).toHaveLength(3);
  });

  it('clear() 清空全部条目', () => {
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0 });
    logger.log(entry());
    logger.clear();
    expect(logger.size).toBe(0);
  });

  it('返回的数组是冻结的，调用方不能篡改内部状态', () => {
    const logger = new CapabilityLogger({ maxEntries: 0, ttlMs: 0 });
    logger.log(entry());
    const logs = logger.getLogs();
    expect(Object.isFrozen(logs)).toBe(true);
  });
});
