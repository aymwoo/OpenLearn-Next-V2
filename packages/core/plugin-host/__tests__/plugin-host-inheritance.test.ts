/**
 * L-2 阶段 2：PluginHost 继承链的结构守卫。
 *
 * ## 为什么需要这个测试
 *
 * 把 3401 行的类拆成 `Base → Core → Http → Lifecycle → Reload → Install` 之后，
 * 继承链带来一条**纯结构性**的脆弱点：TS 解析一个类时看不到**子类**的成员声明。
 * 于是一次看似无害的改动会让编译通过，但行为在运行时出错 —— 比如把某个方法
 * 从 Lifecycle 挪到 Install，同时它被 Core 里的方法调用。
 *
 * 更糟的是：这种错误在 tsc 里表现为「找不到方法」，在**没挪错**时完全无声。
 * 所以这里把「继承链的偏序约束」显式钉成断言 —— 靠测试维持，不靠「改的时候记得」。
 *
 * ## 第二个职责：拦住「为了塞进模块而复制代码」
 *
 * 拆分时最容易发生的腐化是：某个方法在两个模块里各留一份实现（改一处忘另一处）。
 * 下面断言每个方法**恰好存在一个**定义处。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), 'packages/core/plugin-host');

/** 继承链顺序即 index.ts 里 PluginHost 逐层向上追溯的顺序 */
const CHAIN = [
  { file: 'base.ts', cls: 'PluginHostBase' },
  { file: 'core.ts', cls: 'PluginHostCore' },
  { file: 'http.ts', cls: 'PluginHostHttp' },
  { file: 'lifecycle.ts', cls: 'PluginHostLifecycle' },
  { file: 'reload.ts', cls: 'PluginHostReload' },
  { file: 'install.ts', cls: 'PluginHostInstall' },
] as const;

const src = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf-8');

/** 抽取某文件里的方法名（2 空格缩进的类成员声明） */
function methodNames(code: string): string[] {
  const out: string[] = [];
  for (const l of code.split('\n')) {
    const m =
      /^ {2}(?:(?:private|public|protected)\s+)?(?:(?:static|async)\s+)?(?:(?:get|set)\s{1,2})?([A-Za-z_$][\w$]*)\s*[(<=:]/.exec(
        l,
      );
    if (!m) continue;
    const n = m[1]!;
    if (['if', 'for', 'while', 'switch', 'catch', 'return', 'constructor', 'new', 'await'].includes(n)) continue;
    out.push(n);
  }
  return out;
}

describe('L-2 阶段 2 · PluginHost 继承链结构', () => {
  it('每个类都声明了正确的父类，且链条首尾相接', () => {
    for (let i = 1; i < CHAIN.length; i++) {
      const { cls } = CHAIN[i]!;
      const parent = CHAIN[i - 1]!.cls;
      expect(src(CHAIN[i]!.file), `${cls} 应继承 ${parent}`).toMatch(
        new RegExp(`export abstract class ${cls} extends ${parent} \\{`),
      );
    }
    // 基类没有父类
    expect(src('base.ts')).toMatch(/export abstract class PluginHostBase \{/);
  });

  it('每个类都 import 了自己的父类', () => {
    // 漏掉会导致父类成了未解析类型，继承成员**全部**消失（实测 1050 个 TS2339）
    for (let i = 1; i < CHAIN.length; i++) {
      const { file, cls } = CHAIN[i]!;
      const parent = CHAIN[i - 1]!.cls;
      const parentFile = CHAIN[i - 1]!.file.replace(/\.ts$/, '.js');
      expect(src(file), `${file} 必须 import 父类 ${parent}`).toContain(`import { ${parent} } from './${parentFile}';`);
    }
  });

  it('index.ts 的 PluginHost 继承链末端', () => {
    const idx = src('index.ts');
    expect(idx).toContain(`import { PluginHostInstall } from './install.js';`);
    expect(idx).toMatch(/export class PluginHost extends PluginHostInstall \{\}/);
  });

  it('⚠️ 没有方法在两层里重复定义（防止"复制一份塞进模块"这种腐化）', () => {
    const seen = new Map<string, string[]>();
    for (const { file } of CHAIN) {
      for (const n of methodNames(src(file))) {
        seen.set(n, [...(seen.get(n) ?? []), file]);
      }
    }
    const dupes = [...seen].filter(([, fs_]) => fs_.length > 1);
    expect(
      dupes.map(([n, f]) => `${n}（${f.join(' + ')}）`),
      '同名方法出现在多层里 —— 子类会遮蔽父类实现，且改一处忘另一处时毫无提示',
    ).toEqual([]);
  });

  it('每个模块的方法数与规模都在合理区间（防单文件再次膨胀）', () => {
    const sizes = CHAIN.map(({ file }) => ({
      file,
      lines: src(file).split('\n').length,
      methods: methodNames(src(file)).length,
    }));
    // eslint-disable-next-line no-console
    console.log('[PluginHost 继承链规模] ' + sizes.map((s) => `${s.file} ${s.lines}行/${s.methods}方法`).join(' | '));
    for (const s of sizes) {
      expect(s.methods, `${s.file} 没有方法`).toBeGreaterThan(0);
      expect(s.lines, `${s.file} 超过 1200 行 —— 拆分失去了意义`).toBeLessThan(1200);
    }
  });

  it('静态路由归一化已抽为可 import 的纯函数（测试不再需要字符串手术）', () => {
    // 原先是 private static，测试只能从源码文本里切函数体再用 new Function 求值。
    // 类外既不能 import private 成员，也无法继承 private static —— 抽取是唯一出路。
    expect(src('static-route.ts')).toMatch(/export function normalizeStaticRoute\(route: string\): string \{/);
    expect(src('core.ts'), '类上的静态方法应委托给纯函数，而不是留一份实现').toMatch(
      /protected static normalizeStaticRoute\(route: string\): string \{\s*return normalizeStaticRoute\(route\);/,
    );
  });
});
