/**
 * 守护「课堂倒计时广播」不会被静默禁用。
 *
 * ## 为什么需要这个测试
 *
 * `server/routes/classroom.ts` 曾把广播写成：
 *
 * ```ts
 * void emitClassroomEvent; // NEGATIVE-CONTROL: 广播已临时停用
 * ```
 *
 * 即**保留调用、去掉实际发送**。这行残留在提交 `2c9d5a2` 里长期存活，
 * 原因是**零测试覆盖**。
 *
 * 它的隐蔽性来自三点，恰好都是静态检查抓不到的：
 *   1. `void emitClassroomEvent;` 是**完全合法**的 JS —— 取函数引用后丢弃；
 *   2. 类型检查通过（`emitClassroomEvent` 确实被「使用」了）；
 *   3. 运行时不报错，只是事件不发出去。
 *
 * 现场表现也不是「彻底坏掉」：前端 `useStageDisplayFeed` 有**对账轮询兜底**
 * （源码注释原文：「Socket 漏事件时的兜底」），所以倒计时只是「偶尔要多等几秒
 * 才更新」。这种程度的故障最容易长期存活。
 *
 * ## 本测试能证明什么、不能证明什么
 *
 * **能**：源码里不存在「只取引用不调用」的模式；事件名附近的语句确实是调用。
 * **不能**：不能证明运行时事件真的抵达客户端 —— 那需要搭完整鉴权 + 真实
 * socket 才能测，为守护这一处残留而写 ~80 行鉴权脚手架不划算。
 * 真正的端到端保障应由 `e2e/` 下的 Playwright 用例承担。
 *
 * 这里刻意**不假装**自己能做端到端验证。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(process.cwd(), 'server/routes/classroom.ts'), 'utf-8');

/** 剥掉注释后再做源码断言 —— 否则注释里提到函数名会被当成代码 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 去掉 import 行，避免把导入当成「引用」 */
function stripImports(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*import\b/.test(l))
    .join('\n');
}

const CODE = stripImports(stripComments(SRC));

describe('课堂倒计时广播 · 不存在「只引用不调用」的负对照残留', () => {
  it('没有任何 `void emitXxx;` 形式（保留引用但不发事件）', () => {
    const offenders = CODE.split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /void\s+emit[A-Z]\w*\s*[;,)]/.test(l));

    expect(
      offenders.map(([ln, l]) => `classroom.ts:${ln}: ${l.trim()}`),
      '发现 `void emitXxx` 形式：函数被引用但未被调用，广播实际不会发出。' + '这正是课堂倒计时广播曾被静默禁用的写法。',
    ).toEqual([]);
  });

  it('countdown_updated 的广播点是真实调用，而非仅提及事件名', () => {
    const at = CODE.indexOf("'classroom:countdown_updated'");
    expect(at, '未找到 countdown_updated 的广播点').toBeGreaterThan(-1);

    // 广播点前 200 字符内应能看到 emitClassroomEvent( 的调用
    const before = CODE.slice(Math.max(0, at - 220), at);
    expect(
      before,
      'countdown_updated 之前没有 emitClassroomEvent 的调用 —— ' + '事件名还在但发送被去掉了（这正是历史缺陷的特征）',
    ).toMatch(/emitClassroomEvent\s*\(/);
  });

  it('每个 classroom:* 事件名旁边都有对应的实际发送', () => {
    // 找出所有 classroom: 事件名，逐个检查其前面 200 字符内有 emit 调用
    const eventNames = [...new Set([...CODE.matchAll(/'(classroom:[a-z_]+)'/g)].map((m) => m[1]))];
    expect(eventNames.length, '未找到任何 classroom 事件名').toBeGreaterThan(3);

    const orphan = eventNames.filter((name) => {
      const at = CODE.indexOf(`'${name}'`);
      return !/emit[A-Z]\w*\s*\(/.test(CODE.slice(Math.max(0, at - 220), at));
    });

    expect(
      orphan,
      `这些事件名附近没有对应的发送调用：${orphan.join(', ')}。` +
        '事件名存在但实际不发，是「只留痕迹不留功能」的典型形态。',
    ).toEqual([]);
  });
});

describe('课堂倒计时广播 · 消费端确实存在', () => {
  it('前端仍订阅 classroom:countdown_updated', () => {
    const hookPath = path.resolve(process.cwd(), 'src/features/classroom/stage-display/useStageDisplayFeed.ts');
    const hook = fs.readFileSync(hookPath, 'utf-8');
    expect(hook, '前端不再订阅 classroom:countdown_updated —— 若是有意移除，请同步删除广播代码与本测试').toContain(
      'classroom:countdown_updated',
    );
  });

  it('前端有对账轮询兜底（说明漏事件的表现是「延迟」而非「失效」）', () => {
    // 这不是断言「应该有兜底」，而是记录该事实：
    // 正因为有兜底，漏广播才极难被发现 —— 倒计时只是「慢几秒」而非「不动」。
    const hook = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/classroom/stage-display/useStageDisplayFeed.ts'),
      'utf-8',
    );
    expect(hook).toMatch(/对账|轮询|reconcile|poll/i);
  });
});
