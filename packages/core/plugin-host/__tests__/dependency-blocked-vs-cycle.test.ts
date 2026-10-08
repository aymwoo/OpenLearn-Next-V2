/**
 * H-5 回归测试：区分「缺依赖阻塞」与「循环依赖」（H-5 / 原始编号 M-11）。
 *
 * ## 缺陷的两个面
 *
 * **① 缺依赖的插件被误报为循环依赖**
 * Kahn 算法里，被阻塞的插件因为其依赖节点永不进 queue，入度就永远不归零 ——
 * 数值上与成环完全无法区分。实测（修复前）：`A 依赖 B、B 未激活`
 * 得到 `cycles: [["ext-a"]]`。**单节点的「环」在结构上不可能是真环**
 * （真环要么 ≥2 节点，要么是显式自环），这就是判据错误的直接证据。
 *
 * 后果：运维把「依赖没装」当成「依赖成环」，排查方向完全跑偏。
 *
 * **② 缺依赖的插件被强行激活**
 * `restoreActivePlugins` 里 `for (const b of blocked) orderedIds.push(b.pluginId)`
 * 把它们与成环插件一视同仁地 best-effort 激活。缺依赖的插件在 `activate()` 里
 * 撞 MODULE_NOT_FOUND，状态机打成 ERROR ⇒ DB 里出现一批「ERROR 状态的插件」，
 * 而真实原因是「依赖压根没装」。重启一次复现一次，且现象与病因不在一处。
 *
 * 成环的插件功能上通常仍可用（只是无序保证），所以**仍**激活；
 * 缺依赖的插件一定不可用，**不**激活。
 *
 * **③ 修 ① 时引入的新缺口（也已补）**
 * 只把阻塞节点排除出 cycles 还不够：那样它们会从 `sorted` / `blocked` / `cycles`
 * 三份结果里同时消失，变成**静默丢弃** —— 比误报更难排查，因为没有任何诊断信息。
 * 故补了传递性归因：`A 依赖 B、B 被阻塞` ⇒ `A` 也报 blocked，原因写明「B (blocked)」。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { topologicalSort } from '../dependency-resolver.js';

// L-2 阶段 2：PluginHost 已拆成抽象类继承链，restoreActivePlugins 的激活队列在 reload.ts。
const SRC = fs.readFileSync(path.resolve(process.cwd(), 'packages/core/plugin-host/reload.ts'), 'utf-8');

/**
 * 切出 `restoreActivePlugins` 里激活队列构造那一段源码。
 *
 * ## 为什么不能直接 `indexOf('const orderedIds = [...sorted];')`
 *
 * 那段代码上方的**注释里**原样引用了修复前的代码：
 *   //   const orderedIds = [...sorted];
 *   //   for (const b of blocked) orderedIds.push(b.pluginId);
 * 而 `indexOf` 返回的是**第一次**出现 —— 即注释里的那份。
 * 于是「不应再 push blocked」的断言去匹配注释，自然失败；
 * 「应有 Skipping 日志」的断言又因为窗口落在注释段而落空。
 *
 * 这与本轮在 `worker-manager.ts` 遮蔽块上踩过的坑同源：
 * **同名字面量先出现在注释里，切片就会切错地方。**
 * 故这里用带行首锚定的正则，只匹配真正的语句（行首是缩进、非注释符）。
 */
function activationQueueSource(windowChars = 1200): string {
  const m = /^\s*const orderedIds = \[\.\.\.sorted\];$/m.exec(SRC);
  expect(m, '未找到激活队列构造语句（源码结构变了？）').not.toBeNull();
  return SRC.slice(m!.index, m!.index + windowChars);
}

describe('H-5 · 缺依赖 ≠ 循环依赖', () => {
  it('A 依赖未激活的 B：B 报 blocked，A 不得被误报为 cycle', () => {
    const r = topologicalSort(new Map([['ext-a', ['ext-b']]]), ['ext-a', 'ext-b'], new Set(['ext-a']));

    expect(r.cycles.flat(), 'A 不应出现在 cycles 里 —— 它的失败原因是「依赖未激活」，不是「成环」').not.toContain(
      'ext-a',
    );
    expect(r.cycles, '单节点的 cycle 在结构上不可能是真环').toEqual([]);
  });

  it('传递性归因：A 的 blocked 原因应指向上游 B', () => {
    const r = topologicalSort(new Map([['ext-a', ['ext-b']]]), ['ext-a', 'ext-b'], new Set(['ext-a']));

    const a = r.blocked.find((b) => b.pluginId === 'ext-a');
    expect(a, 'A 不应被静默丢弃 —— 三份结果里都没有它等于没有任何诊断信息').toBeDefined();
    expect(a!.missingDeps.join(','), '归因应指向上游被阻塞的 B').toMatch(/ext-b/);
  });

  it('真循环 A↔B 仍被正确识别为 cycle，且**不**同时报 blocked', () => {
    const r = topologicalSort(
      new Map([
        ['ext-a', ['ext-b']],
        ['ext-b', ['ext-a']],
      ]),
      ['ext-a', 'ext-b'],
      new Set(['ext-a', 'ext-b']),
    );

    expect(r.cycles, '成环插件功能上通常仍可用，必须继续被识别为 cycle').toEqual([['ext-a', 'ext-b']]);
    // 回归防护：曾因 cyclicIds 用 Set.add(...component) 收集失败（add 只收 1 个参数，
    // 多余实参被静默丢弃）导致 ext-b 漏标、又被当成「被阻塞」重复上报。
    const inCycle = new Set(r.cycles.flat());
    const alsoBlocked = r.blocked.filter((b) => inCycle.has(b.pluginId)).map((b) => b.pluginId);
    expect(alsoBlocked, '环内节点不得同时出现在 blocked —— 一个插件只能有一种失败原因').toEqual([]);
  });

  it('显式自环（插件声明依赖自己）仍算真环', () => {
    const r = topologicalSort(new Map([['ext-self', ['ext-self']]]), ['ext-self'], new Set(['ext-self']));
    expect(r.cycles, '自环是真实的依赖环，不该被「单节点不算环」的规则误杀').toEqual([['ext-self']]);
  });

  it('缺未安装依赖的插件：blocked，不进 cycles', () => {
    const r = topologicalSort(new Map([['ext-c', ['ext-d']]]), ['ext-c'], new Set(['ext-c']));
    expect(r.cycles).toEqual([]);
    expect(r.blocked.map((b) => b.pluginId)).toContain('ext-c');
  });

  it('依赖齐备时正常拓扑排序，不产生任何 blocked/cycles', () => {
    const r = topologicalSort(
      new Map([
        ['ext-a', ['ext-b']],
        ['ext-b', []],
      ]),
      ['ext-a', 'ext-b'],
      new Set(['ext-a', 'ext-b']),
    );
    // A 依赖 B ⇒ B 必须排在 A 之前
    expect(r.sorted.indexOf('ext-b')).toBeLessThan(r.sorted.indexOf('ext-a'));
    expect(r.blocked).toEqual([]);
    expect(r.cycles).toEqual([]);
  });

  it('三份结果互斥：任一插件至多属于其中一类（sorted / blocked / cycles）', () => {
    // 构造一个混合场景：无序 A←B←C、缺依赖的 D、真循环 E↔F
    const graph = new Map<string, string[]>([
      ['ext-a', ['ext-b']],
      ['ext-b', ['ext-c']],
      ['ext-c', []],
      ['ext-d', ['ext-missing']],
      ['ext-e', ['ext-f']],
      ['ext-f', ['ext-e']],
    ]);
    const r = topologicalSort(graph, ['ext-a', 'ext-b', 'ext-c', 'ext-d', 'ext-e', 'ext-f'], undefined);

    const sets = {
      sorted: new Set(r.sorted),
      blocked: new Set(r.blocked.map((b) => b.pluginId)),
      cycles: new Set(r.cycles.flat()),
    };
    // 不要求全覆盖（只要求互斥）：被阻塞/成环的插件确实不会进 sorted
    const overlaps: string[] = [];
    for (const [x, xs] of Object.entries(sets)) {
      for (const [y, ys] of Object.entries(sets)) {
        if (x >= y) continue;
        for (const id of xs) if (ys.has(id)) overlaps.push(`${id}(${x}&${y})`);
      }
    }
    expect(overlaps, '同一插件同时被归为两类会让运维无法判断该查哪一头').toEqual([]);
  });
});

describe('H-5 · 缺依赖的插件不被强行激活', () => {
  it('restoreActivePlugins 不把 blocked 塞进激活队列', () => {
    const window = activationQueueSource(500);

    expect(
      window,
      'blocked 仍被 push 进激活队列 —— 缺依赖的插件会被强行激活，' +
        '在 activate() 里撞 MODULE_NOT_FOUND 后被状态机打成 ERROR，' +
        '把「依赖没装」伪装成「插件自身报错」',
    ).not.toMatch(/for\s*\(\s*const\s+b\s+of\s+blocked\s*\)\s*orderedIds\.push/);
  });

  it('成环插件仍进入激活队列（best-effort，保留无序激活能力）', () => {
    const window = activationQueueSource(500);
    expect(window, 'cycles 仍应参与激活 —— 成环插件功能上通常可用，只缺顺序保证').toMatch(
      /for\s*\(\s*const\s+cycle\s+of\s+cycles\s*\)\s*orderedIds\.push/,
    );
  });

  it('对被阻塞插件给出可操作的日志（说明原因与后果）', () => {
    const window = activationQueueSource(900);
    expect(window, '跳过激活时应说明「为什么跳过」以及「强行激活会怎样」').toMatch(/Skipping activation/);
    expect(window).toMatch(/missingDeps|dependency not satisfied/);
  });

  it('兜底剔除：即便 blocked 混入 orderedIds 也会被移除', () => {
    const window = activationQueueSource(1200);
    expect(window, '缺一道剔除兜底 —— 将来新增路径若又把 blocked 混进来，缺陷会复发').toMatch(
      /blockedIds\.has\(orderedIds\[i\]\)/,
    );
  });
});
