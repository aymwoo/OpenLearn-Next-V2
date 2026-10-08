/**
 * L-2 · bootstrap section 的**静态**结构 lint。
 *
 * ## 为什么必须独立成一个不 import bootstrap 的文件
 *
 * 这里要防的两种破坏，**表现形式恰恰是模块加载失败**：
 *
 * - section 里出现反引号 → 模板字面量被提前截断 → 该 `.ts` 文件 parse error
 * - section 里出现 `${}` → 加载期 ReferenceError
 *
 * 如果这个测试 `import` 了 section 模块（哪怕只是为了断言「内容非空」），
 * 那么注入违规后**它自己会先崩掉**，整个文件变成 `no tests` ——
 * 精心写好的诊断信息一条都显示不出来，排查者只看到一个不透明的加载失败。
 *
 * 所以本文件**只读磁盘文本，零 import**。这样一个「不能被它所检查的东西打败」
 * 的 lint 才成立。已实测：把违规注入 section 后，本文件仍能正常执行并报出
 * 是哪一段、为什么；而把它们放在会 import 的文件里，只会得到 `no tests`。
 *
 * 行为层面的检查（组装顺序、遮蔽段可切出等）在 `bootstrap-composition.test.ts`。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SECTIONS_DIR = path.resolve(process.cwd(), 'packages/core/worker-runtime/bootstrap/sections');
const INDEX_FILE = path.resolve(process.cwd(), 'packages/core/worker-runtime/bootstrap/index.ts');

/** 从源文件文本切出模板字面量的**体**（`= \`` 与结尾 `` `; `` 之间） */
function sectionBody(name: string): string {
  const src = fs.readFileSync(path.join(SECTIONS_DIR, `${name}.ts`), 'utf-8');
  const start = src.indexOf('= `');
  const end = src.lastIndexOf('`;');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`section ${name} 的模板字面量边界异常（start=${start}, end=${end}）—— 文件结构可能已变`);
  }
  // 去掉注释：注释里提到反引号 / ${} 是合理的（本文档就有），不算违规
  return src
    .slice(start + 3, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 磁盘上的 section 文件（kebab-case，去掉 .ts） */
function sectionFilesOnDisk(): string[] {
  return fs
    .readdirSync(SECTIONS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

const NAMES = sectionFilesOnDisk();

describe('L-2 · bootstrap section 静态 lint（零 import，故不会被检查对象打败）', () => {
  it('section 目录非空', () => {
    expect(NAMES.length, 'bootstrap/sections/ 下没有 section 文件').toBeGreaterThan(0);
  });

  it('⚠️ section 模板体内不得含反引号', () => {
    const offenders = NAMES.filter((n) => sectionBody(n).includes('`'));
    expect(
      offenders,
      `这些 section 的模板体含反引号：${offenders.join(', ')}。\n` +
        '后果：模板字面量被提前截断，其后的 section 整段丢失，生成的 bootstrap 语法不完整 —— ' +
        '而 tsc 与 eslint 都不检查字符串内容，报不出问题。\n' +
        '要写字符串请用单引号拼接。',
    ).toEqual([]);
  });

  it('⚠️ section 模板体内不得含 ${} 插值（section 设计为纯常量）', () => {
    const offenders = NAMES.filter((n) => sectionBody(n).includes('${'));
    expect(
      offenders,
      `这些 section 的模板体含 \${}：${offenders.join(', ')}。\n` +
        '后果：加载期 ReferenceError，或把 undefined 字面量塞进 bootstrap，同样不被 tsc/eslint 发现。\n' +
        '确需注入值时，请把参数经 composeBootstrapCode() 显式传入，而不是在 section 里插值。',
    ).toEqual([]);
  });

  it('每个 section 体非空', () => {
    for (const n of NAMES) {
      expect(sectionBody(n).trim().length, `section ${n} 为空`).toBeGreaterThan(50);
    }
  });

  it('每个 section 的花括号配平（拼接后语法完整）', () => {
    const broken: string[] = [];
    for (const n of NAMES) {
      const body = sectionBody(n);
      // 粗略计数即可：目的是抓「少写一个 }」这类手误，不追求 JS 解析级精确
      const open = (body.match(/\{/g) ?? []).length;
      const close = (body.match(/\}/g) ?? []).length;
      if (open !== close) broken.push(`${n}: { ×${open} vs } ×${close}`);
    }
    expect(broken, `花括号不配平：${broken.join('; ')}`).toEqual([]);
  });

  it('index.ts 引用了磁盘上的**每一个** section（防止新增 section 却忘了拼接）', () => {
    const index = fs.readFileSync(INDEX_FILE, 'utf-8');
    const missing = NAMES.filter((n) => !index.includes(`sections/${n}.js`));
    expect(
      missing,
      `这些 section 在 index.ts 里没有被引用：${missing.join(', ')}。\n` +
        '后果：文件写了但从未进入 bootstrap，逻辑静默失效。',
    ).toEqual([]);
  });

  it('index.ts 声明的拼接顺序与磁盘文件顺序一致（顺序错乱会导致 bootstrap 无法运行）', () => {
    const index = fs.readFileSync(INDEX_FILE, 'utf-8');
    const declared = [...index.matchAll(/BOOTSTRAP_SECTION_NAMES = \[([^\]]*)\]/gs)]
      .flatMap((m) => m[1]!.match(/'([^']+)'/g) ?? [])
      .map((s) => s.replace(/'/g, ''));
    expect(declared.length, '未能从 index.ts 解析出 BOOTSTRAP_SECTION_NAMES').toBeGreaterThan(0);
    expect([...declared].sort(), 'BOOTSTRAP_SECTION_NAMES 与磁盘上的 section 文件不一致').toEqual(NAMES);
  });
});
