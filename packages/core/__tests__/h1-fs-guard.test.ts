/**
 * 验证 H-1 的全局守卫**确实在生效**。
 *
 * ## 为什么需要这个文件
 *
 * `vitest.setup.ts` 里的守卫是靠 monkey-patch `node:fs` 实现的。这类守卫有个
 * 特有风险：**它可能静默失效** —— 只要哪天 vite 改成内联 `node:fs`（不再与被测
 * 源码共享同一个模块对象），patch 就不再传播，守卫变成一段什么都不做的代码，
 * 而所有测试依然全绿。工作树会重新开始堆积孤儿目录，且没有任何信号。
 *
 * 所以守卫本身需要被断言。这个文件就是那个断言。
 *
 * 它断言两件事，缺一不可：
 *   ① patch 传播到了测试文件的 `fs` 命名空间（marker 可见）
 *   ② patch 后的函数真的替换掉了原函数（行为拦截生效，而非只设了个标记）
 *
 * 只断言 ① 是不够的 —— 我在设计阶段就踩过这个坑：当时的探针同时检查了 marker
 * 与「mkdirSync 是否抛 FORBIDDEN」，正是 ② 把「标记设了但函数没换」这种情况揪了出来。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const FORBIDDEN_ROOT = path.resolve(process.cwd(), 'plugins');

describe('H-1 全局守卫 · 禁止测试写入仓库 plugins/', () => {
  it('fs 模块已被 setup.ts 打过补丁（patch 传播到了测试命名空间）', () => {
    // 守卫没有暴露公开 marker，用「函数源码里含自己的名字」作为等价信号：
    // 原生 fs.mkdirSync 的 toString 不含 'guarded'。
    const src = fs.mkdirSync.toString();
    expect(src, 'fs.mkdirSync 未被替换 —— patch 未传播，守卫已静默失效').toContain('guarded');
  });

  it('写入仓库 plugins/ 会被拦截（同步写）', () => {
    const target = path.join(FORBIDDEN_ROOT, '__guard_probe_should_never_exist__');
    let msg = '';
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg, 'mkdirSync 未被拦截').toContain('[H-1 守卫]');
    expect(fs.existsSync(target), '拦截失败：目录真的被创建了').toBe(false);
  });

  it('写入仓库 plugins/ 会被拦截（writeFileSync）', () => {
    const target = path.join(FORBIDDEN_ROOT, 'probe.js');
    let msg = '';
    try {
      fs.writeFileSync(target, '// probe', 'utf-8');
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain('[H-1 守卫]');
    expect(fs.existsSync(target), '拦截失败：文件真的被写入了').toBe(false);
  });

  it('删除仓库 plugins/ 也会被拦截（rmSync 同样会造成工作树变更）', () => {
    let msg = '';
    try {
      fs.rmSync(path.join(FORBIDDEN_ROOT, 'whatever'), { recursive: true, force: true });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg, 'rmSync 未被拦截 —— 测试可以随意删掉工作树里的东西').toContain('[H-1 守卫]');
  });

  it('拦截消息包含修法（避免只报错不给出路）', () => {
    let msg = '';
    try {
      fs.mkdirSync(path.join(FORBIDDEN_ROOT, 'probe2'), { recursive: true });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain('pluginsDir');
    expect(msg, '修法指引里应给出临时目录的创建方式').toMatch(/mkdtempSync/);
  });

  it('env 覆盖已生效（Kernel 构造时必须拿得到 pluginsDir）', () => {
    const v = process.env.OPENLEARN_PLUGINS_DIR;
    expect(v, 'OPENLEARN_PLUGINS_DIR 未设置 —— Kernel 会回退到 cwd/plugins 并污染工作树').toBeTruthy();
    expect(v).not.toBe(path.resolve(process.cwd(), 'plugins'));
  });

  it('【顺序约束】env 赋值必须在 ensureTestSchema() 之前', () => {
    // 这条防的是本轮真实踩到的坑：`ensureTestSchema()` 会构造 Kernel，
    // 而 Kernel 构造时要读 OPENLEARN_PLUGINS_DIR。env 赋值一度位于文件末尾，
    // 于是**所有 server 测试**拿到的都是 undefined、静默回落到 cwd/plugins。
    //
    // 症状极隐蔽：测试全绿、`git status` 干净，只有 plugins/ 在涨。
    // `resolvePluginsDirOverride()` 现在在 Vitest 下直接抛错，等于第二道防线；
    // 本条是第一道 —— 直接盯住源码顺序。
    const setupSrc = fs.readFileSync(path.resolve(process.cwd(), 'vitest.setup.ts'), 'utf-8');
    const assignAt = setupSrc.indexOf('process.env.OPENLEARN_PLUGINS_DIR = runDir;');
    const ensureAt = setupSrc.indexOf('ensureTestSchema();');
    expect(assignAt, 'vitest.setup.ts 里找不到 env 赋值').toBeGreaterThan(-1);
    expect(ensureAt, 'vitest.setup.ts 里找不到 ensureTestSchema 调用').toBeGreaterThan(-1);
    expect(
      assignAt,
      'env 赋值被移到了 ensureTestSchema() 之后 —— Kernel 会先于赋值被构造，' +
        '所有 server 测试会静默回退到 cwd/plugins',
    ).toBeLessThan(ensureAt);
  });

  it('临时目录（os.tmpdir）不受拦截 —— 否则守卫无法自我验证', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-guard-selftest-'));
    try {
      expect(() => fs.writeFileSync(path.join(tmp, 'ok.txt'), 'x', 'utf-8')).not.toThrow();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
