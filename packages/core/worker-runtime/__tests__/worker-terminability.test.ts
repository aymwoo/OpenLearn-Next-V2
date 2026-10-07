/**
 * 插件 worker 的**可终止性**回归测试。
 *
 * ## 为什么需要这个文件
 *
 * 整改过程中曾把一条**错误结论**写进源码注释、台账与 CHANGELOG：
 * 「worker_threads 是协作式的，`terminate()` 对同步死循环 `while(true)` 无效，
 *   故同步死循环无法被强制终止，必须换隔离原语（子进程）。」
 *
 * 该结论的来源是一次**探针缺陷**：探针打印的「6s 未终止」测的是
 * `WorkerOptions.timeout` 选项**有没有触发**，之后才调 `terminate()`，
 * **从未单独验证 terminate 本身**。也就是说：验证的不是结论本身。
 *
 * 本文件把这个实测结论**固化进测试套件**，理由有三：
 *  1. 它是 L-1 立项提案里 P0「宿主侧 CPU 看门狗」的**可行性前提**——
 *     看门狗的全部价值就建立在「terminate 能杀掉卡死的 worker」之上。
 *     若哪天 Node 改了这个行为，这条测试会立刻红，而不是让 P0 静默失效。
 *  2. 它防止同一条错误断言再次被写进文档（本次已写进 3 处）。
 *  3. 它把「协作式」这个**似是而非的类比**钉死：worker 有独立 isolate，
 *     V8 销毁 isolate 不需要 JS 栈配合；这与 `Atomics.wait` 的协作式阻塞无关。
 *
 * ## 设计约束
 *
 * 这些用例会真的把 CPU 烧掉（每次 ~100ms），故：
 *  · 超时给足（vitest 默认 5s 可能不够，见下方 testTimeout）
 *  · 失败时必须 `process.exit`，否则一个逃逸的 `while(true)` worker 会挂住整个测试进程
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 每例新建、每例删除 —— 不能只在模块作用域建一次再在 afterEach 删，
 * 否则第 2 个用例往已删除的目录里写载荷会 ENOENT。
 */
let TMP_DIR = '';
beforeEach(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-terminate-probe-'));
});

/** 尚未确认退出的 worker —— afterEach 里强杀，防止挂住测试进程 */
const liveWorkers = new Set<Worker>();

function track(w: Worker): Worker {
  liveWorkers.add(w);
  return w;
}

/** 把死循环载荷写成真实的 .mjs 文件（不用 eval，避免与被测行为混淆） */
function writeLoop(name: string, body: string): string {
  const file = path.join(TMP_DIR, name);
  fs.writeFileSync(file, body, 'utf-8');
  return file;
}

/**
 * 起一个 worker、等它进入死循环、再 terminate，然后断言它在预算内退出。
 *
 * 返回 'exited' 或 'TIMEOUT' —— **不抛异常**，让调用方决定如何断言，
 * 这样一次运行能把所有轮次的结果都看到，而不是第一轮失败就中断。
 */
async function terminateProbe(file: string, waitMs: number, budgetMs: number): Promise<string> {
  const w = track(new Worker(new URL(`file://${file}`), { eval: false }));
  await new Promise((r) => setTimeout(r, waitMs)); // 确保已进入死循环
  const t0 = Date.now();
  w.terminate();
  const outcome = await Promise.race([
    new Promise<string>((r) => w.once('exit', (code) => r(`exit code=${code}@${Date.now() - t0}ms`))),
    new Promise<string>((r) => setTimeout(() => r(`TIMEOUT(>${budgetMs}ms 未终止)`), budgetMs)),
  ]);
  liveWorkers.delete(w);
  return outcome;
}

afterEach(() => {
  // 兜底：任何漏网的 worker 一律强杀，否则 while(true) 会挂住 vitest worker
  for (const w of liveWorkers) {
    void w.terminate();
  }
  liveWorkers.clear();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('插件 worker 可终止性（L-1 提案 P0 的可行性前提）', () => {
  it('terminate() 能终止模块体直接死循环的 worker', { timeout: 30_000 }, async () => {
    const file = writeLoop('sync-top-level.mjs', 'while (true) {}');
    const r = await terminateProbe(file, 300, 3000);
    expect(r, '模块体 while(true) 的 worker 未被 terminate 终止 —— P0 看门狗将失效').toMatch(/^exit code=/);
  });

  it('terminate() 能终止定时器回调内死循环的 worker', { timeout: 30_000 }, async () => {
    // 与上一条同构但触发路径不同：定时器内 → 事件循环已 yield 过一次
    const file = writeLoop('sync-in-timer.mjs', 'setTimeout(() => { while (true) {} }, 20);');
    const r = await terminateProbe(file, 300, 3000);
    expect(r, '定时器内 while(true) 的 worker 未被 terminate 终止').toMatch(/^exit code=/);
  });

  it('terminate() 反复有效（不是偶发）', { timeout: 60_000 }, async () => {
    const file = writeLoop('sync-repeat.mjs', 'while (true) {}');
    const rounds = [
      await terminateProbe(file, 250, 3000),
      await terminateProbe(file, 250, 3000),
      await terminateProbe(file, 250, 3000),
    ];
    for (const [i, r] of rounds.entries()) {
      expect(r, `第 ${i + 1} 轮未终止：${r}`).toMatch(/^exit code=/);
    }
  });

  it('死循环 worker 存活期间主线程仍可响应（terminate 的前提）', { timeout: 30_000 }, async () => {
    // 若 worker 与宿主共享事件循环且不可抢占，主线程会被一起卡住，
    // 宿主就永远发不出 terminate —— 这才是「协作式」担忧的真正形态。
    const file = writeLoop('sync-main-thread.mjs', 'while (true) {}');
    const w = track(new Worker(new URL(`file://${file}`), { eval: false }));
    await new Promise((r) => setTimeout(r, 300));

    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    await new Promise((r) => setTimeout(r, 300));
    clearInterval(timer);

    expect(
      ticks,
      `主线程在 worker 死循环期间只完成 ${ticks} 次 tick —— 宿主被阻塞，无法治理卡死的 worker`,
    ).toBeGreaterThan(10);
    await w.terminate();
    liveWorkers.delete(w);
  });
});
