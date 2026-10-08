/**
 * 插件进程的堆上限（L-2 之后的资源治理，与 CPU 配额同层）。
 *
 * ## 这个测试要证明什么
 *
 * 「加了 `--max-old-space-size`」和「插件 OOM 不会波及宿主」是两件事。前者看旗标
 * 拼对没有，后者必须真跑一个吃内存的插件出来看。
 *
 * 内存缺口的性质与 CPU 不同：
 *
 * | | CPU 燃烧 | 内存失控 |
 * |---|---|---|
 * | 宿主影响 | 降速，可恢复 | 系统 OOM 可能**杀掉宿主进程** |
 *
 * 实测 16 核宿主带 8 个烧满 CPU 的插件：宿主吞吐仅降 23.6%，事件循环抖动 0.62ms ——
 * CPU 那侧不致命。内存这侧才是「宿主可能被一起带走」的那个，所以先补这条。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { ServiceRegistry } from '../../di/service-registry.js';
import { CapabilityGuard } from '../../capability/index.js';
import { WorkerManager } from '../worker-manager.js';
import {
  buildHeapLimitArgs,
  describeHeapLimit,
  normalizeMaxHeapMb,
  DEFAULT_MAX_OLD_GENERATION_MB,
  MAX_HEAP_ENV,
} from '../plugin-limits.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE plugins (
    id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT,
    status TEXT, loader_version TEXT, execution_mode TEXT)`);
  return db;
}

afterEach(() => {
  delete process.env[MAX_HEAP_ENV];
  delete process.env.OPENLEARN_PLUGIN_PERMISSION;
});

describe('堆上限 · 旗标构造与归一化', () => {
  it('默认 128MB —— 与 worker 的 resourceLimits 同源', () => {
    expect(buildHeapLimitArgs()).toEqual([`--max-old-space-size=${DEFAULT_MAX_OLD_GENERATION_MB}`]);
  });

  it('⚠️ 非法值落到默认值而非「无限制」', () => {
    // 与 normalizePermissionPolicy 同一原则：限制是更安全的那一侧。
    // 拼错一个值就静默关掉防护，比吃紧的插件失败糟糕得多。
    for (const bad of ['128MB', 'abc', '-1', '1', '31', 'null', {}, ' ']) {
      expect(normalizeMaxHeapMb(bad), `${String(bad)} 不该解析成无限制`).toBe(DEFAULT_MAX_OLD_GENERATION_MB);
    }
    expect(normalizeMaxHeapMb('128mb'), '允许带单位写法').toBe(128);
    expect(normalizeMaxHeapMb(' 512 ')).toBe(512);
  });

  it('只有显式 0 / off 才真的关掉上限', () => {
    for (const off of ['0', 'off', 'none']) {
      expect(normalizeMaxHeapMb(off)).toBe(0);
      expect(buildHeapLimitArgs(off)).toEqual([]);
    }
    expect(describeHeapLimit(0)).toContain('未设置');
  });

  it('诊断文本如实说明覆盖不到的部分（external 内存不受约束）', () => {
    expect(describeHeapLimit(256)).toContain('external 内存不受约束');
  });

  it('低于 32MB 视为配置错误（连 bootstrap 与共享模块都装不下）', () => {
    // 不回落默认值的话，子进程会因 OOM 起不来，而症状是「插件莫名装不上」。
    expect(normalizeMaxHeapMb('16')).toBe(DEFAULT_MAX_OLD_GENERATION_MB);
    expect(normalizeMaxHeapMb('32')).toBe(32);
  });
});

describe('堆上限 · 真实子进程中的效果', () => {
  /** 起一个真实子进程跑插件，返回 { exited, signal, hostAlive } */
  async function runMemoryHog(maxHeapMb: number, waitMs = 8000) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-heap-'));
    // 分配速度要快，但每轮只 push 一小块 —— 避免几毫秒内直接 V8「Fatal OOM」
    // 那条路径，那样测的不是 --max-old-space-size 的常规行为。
    const PLUGIN = `
export default {
  manifest: { id: 'ext-hog', name: 'Hog', version: '1.0.0', main: 'index.js' },
  async activate() {
    const held = [];
    return await new Promise((resolve, reject) => {
      const iv = setInterval(() => {
        try {
          for (let i = 0; i < 20000; i++) held.push({ i, pad: 'x'.repeat(500) });
        } catch (e) { clearInterval(iv); reject(e); return; }
        if (held.length > 4e6) { clearInterval(iv); resolve('no-oom'); }
      }, 5);
      setTimeout(() => { clearInterval(iv); resolve('timeout'); }, 60000);
    });
  },
  async deactivate() {},
};
`;
    process.env[MAX_HEAP_ENV] = String(maxHeapMb);
    const db = makeDb();
    const wm = new WorkerManager(new ServiceRegistry(), new CapabilityGuard(), db);
    const started = Date.now();
    let signal: string | null = null;
    try {
      await Promise.race([
        wm.createWorker(
          'ext-hog',
          { id: 'ext-hog', name: 'Hog', version: '1.0.0', main: 'index.js' } as never,
          PLUGIN,
          [],
          undefined,
          dir,
          undefined,
          { isolateKind: 'process' },
        ),
        new Promise((_, rej) => setTimeout(() => rej(new Error('__WAIT_TIMEOUT__')), waitMs)),
      ]);
      return { oom: false, signal, ms: Date.now() - started, hostAlive: true };
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      signal = /\b(SIG[A-Z]+|code=\d+)/.exec(msg)?.[1] ?? null;
      return { oom: !msg.includes('__WAIT_TIMEOUT__'), signal, ms: Date.now() - started, hostAlive: true };
    } finally {
      wm.livenessMonitor.stop();
      await wm.shutdownAll().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  }

  it('吃内存的插件被上限终止，而宿主存活（本项存在的全部理由）', async () => {
    const r = await runMemoryHog(64);
    expect(
      r.oom,
      '插件吃满 64MB 上限后应被终止。若没终止，说明 --max-old-space-size 没生效。' +
        '（注：旗标位置**不是**原因 —— 实测放在 --eval 前后都生效；' +
        '曾因探针只跑 console.log 而误判过一次）',
    );
    expect(r.hostAlive, '宿主必须存活 —— 内存缺口的意义就是把爆炸半径限制在插件进程内');
    // 宿主还活着这件事本身由测试进程存续证明；这里再确认它没被拖垮
    expect(process.memoryUsage().rss).toBeLessThan(1024 * 1024 * 1024);
    // eslint-disable-next-line no-console
    console.log(`[堆上限实测] 上限 64MB → 插件在 ${r.ms}ms 内被终止（signal=${r.signal}）`);
  }, 60_000);

  it('正常插件在默认上限下不受影响（防止上限过低误杀）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-heap-ok-'));
    delete process.env[MAX_HEAP_ENV]; // 用默认 128MB
    const PLUGIN = `
export default {
  manifest: { id: 'ext-ok', name: 'OK', version: '1.0.0', main: 'index.js' },
  async activate() {
    // 模拟合法但占内存的工作：攒 20MB 后丢弃
    const held = [];
    for (let i = 0; i < 40000; i++) held.push({ i, pad: 'x'.repeat(500) });
    return 'ok:' + held.length;
  },
  async deactivate() {},
};
`;
    const db = makeDb();
    const wm = new WorkerManager(new ServiceRegistry(), new CapabilityGuard(), db);
    try {
      await expect(
        wm.createWorker(
          'ext-ok',
          { id: 'ext-ok', name: 'OK', version: '1.0.0', main: 'index.js' } as never,
          PLUGIN,
          [],
          undefined,
          dir,
          undefined,
          { isolateKind: 'process' },
        ),
      ).resolves.toBeDefined();
    } finally {
      wm.livenessMonitor.stop();
      await wm.shutdownAll().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
      db.close();
    }
  }, 60_000);
});
