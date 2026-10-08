/**
 * L-2：bootstrap 内联实现与宿主模块的**行为一致性**。
 *
 * ## 为什么需要这个测试
 *
 * Worker/子进程的 bootstrap 是**动态生成的代码字符串**，沙箱不能 import 宿主模块
 * —— 那正是隔离的意义。于是纯逻辑函数必须在沙箱里有一份**拷贝**。
 *
 * 这份拷贝会漂移，而且漂移是**静默**的：本文件要守的那次漂移就是
 * `resolvePluginCommandType` 少了 UUID v7 短路（宿主侧有、沙箱侧无）。
 * 当时之所以没暴露，纯粹是因为两边碰巧都传 `manifest.id` ——
 * 「两边参数一致」是调用点的巧合，不是不变量。
 *
 * ## 这个测试干什么
 *
 * 把沙箱里那份实现**原样取出并执行**，与宿主模块的真实现跑同一组用例，逐例比对。
 * 漂移 ⇒ 变红。
 *
 * 它不能防止「有人同时改坏两边」，但能防止**单边修改** —— 那才是实际发生的形态。
 */

import { describe, it, expect } from 'vitest';
import { resolvePluginCommandType } from '../../plugin-host/plugin-namespace.js';
import { composeBootstrapCode } from '../bootstrap/index.js';

/**
 * 从生成的 bootstrap 里切出 `resolvePluginCommandType` 的源码文本。
 *
 * 按 `{` / `}` 配平扫描，而不是用正则 —— 函数体里的正则字面量含有 `{`？没有，
 * 但函数体本身有嵌套的 if 块，只按首个 `}` 截断会得到残缺代码。
 */
function extractBootstrapImpl(code: string): string {
  const start = code.indexOf('function resolvePluginCommandType');
  if (start === -1) throw new Error('bootstrap 里找不到 resolvePluginCommandType');

  // 跳过签名部分的第一个 '{'，然后配平扫描函数体
  let depth = 0;
  let i = code.indexOf('{', start);
  const bodyStart = i;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`resolvePluginCommandType 的大括号在行 ${bodyStart} 起不配平 —— bootstrap 结构可能已变`);
}

/** 组装出的 bootstrap 里那份实现（真的会被执行的那段文本） */
const BOOTSTRAP_CODE = composeBootstrapCode('/host/package.json');

/** 在隔离作用域里执行切出的实现，拿到可调用的真函数 */
const bootstrapImpl = new Function(`return (${extractBootstrapImpl(BOOTSTRAP_CODE)});`)() as (
  type: string,
  pluginId: string,
) => string;

interface Case {
  type: string;
  pluginId: string;
  /** 这个用例为什么存在 —— 失败时能看出是哪条不变量被破坏 */
  why: string;
}

const CASES: Case[] = [
  {
    type: 'courseware.query',
    pluginId: '@courseware-hub/plugin',
    why: '普通命令：应加前缀',
  },
  {
    type: '@courseware-hub/plugin.courseware.query',
    pluginId: '@courseware-hub/plugin',
    why: '已带前缀：应原样返回（不加二次前缀）',
  },
  {
    type: 'listUsers',
    pluginId: '@my-scope/hello',
    why: '无点号的命令：应加前缀',
  },
  {
    type: '@scope-a/plugin.createItem',
    pluginId: '@scope-b/plugin',
    why: '跨插件命令：应被本插件前缀覆盖（防跨插件撞名）',
  },
  {
    // ★ 这条就是当初漂移的那一例
    type: '019f6029-884d-71dd-a4f1-31f815fa9698.create',
    pluginId: '019f6029-884d-71dd-a4f1-31f815fa9698',
    why: 'DB UUID 前缀：已是完全限定键，应原样返回（宿主侧有 UUID 短路，沙箱侧曾经没有）',
  },
  {
    type: '019f6029-884d-71dd-a4f1-31f815fa9698.doThing',
    pluginId: '@author/plug',
    why: '类型是 UUID 但前缀是 manifest.id：仍应加前缀（UUID 短路只看 type，不看 pluginId）',
  },
  {
    type: 'A1B2C3D4-884D-71DD-A4F1-31F815FA9698.x',
    pluginId: 'p',
    why: '大写十六进制 UUID：正则带 /i，应同样短路',
  },
  {
    type: '',
    pluginId: '@a/b',
    why: '空命令：应得到纯前缀（不崩）',
  },
];

describe('L-2 · 沙箱内联实现与宿主模块的一致性', () => {
  it('resolvePluginCommandType：两侧对每组用例结果一致', () => {
    const mismatches: string[] = [];
    for (const c of CASES) {
      const host = resolvePluginCommandType(c.type, c.pluginId);
      const sandbox = bootstrapImpl(c.type, c.pluginId);
      if (host !== sandbox) {
        mismatches.push(
          `type=${JSON.stringify(c.type)} pluginId=${JSON.stringify(c.pluginId)}\n` +
            `    宿主侧 → ${JSON.stringify(host)}\n` +
            `    沙箱侧 → ${JSON.stringify(sandbox)}\n` +
            `    （${c.why}）`,
        );
      }
    }
    expect(
      mismatches,
      `bootstrap 里的拷贝已与 plugin-namespace.ts 漂移：\n${mismatches.join('\n')}\n\n` +
        '两份实现必须同步修改；测试存在的原因就是「靠约定」曾经失效过。',
    ).toEqual([]);
  });

  it('宿主侧真模块自身满足这些用例的预期（防止用例表写错）', () => {
    // 如果只测「两侧一致」，两份实现同时写错也会绿。所以再钉一组绝对预期。
    expect(resolvePluginCommandType('courseware.query', '@p/h')).toBe('@p/h.courseware.query');
    expect(resolvePluginCommandType('@p/h.x', '@p/h')).toBe('@p/h.x');
    const uuid = '019f6029-884d-71dd-a4f1-31f815fa9698';
    expect(resolvePluginCommandType(`${uuid}.create`, uuid)).toBe(`${uuid}.create`);
  });

  it('bootstrap 里确实存在这一份拷贝（防止有人把它悄悄删掉）', () => {
    expect(BOOTSTRAP_CODE).toContain('function resolvePluginCommandType');
  });
});
