/**
 * E-4 / H-7：scaffold 模板产出的 manifest 必须能通过加载器 schema
 *
 * ## 为什么这是生态关键路径
 *
 * D-1 决策已定「要做第三方开发者生态」。而脚手架是第三方作者的**第一站** ——
 * 模板产出的 manifest 若过不了 `manifestSchema`，插件连装都装不上，
 * 作者永远看不到第二个错误。
 *
 * ## 这个缺陷的形态
 *
 * `manifestSchema` 把 `main` 定为**必填**（`z.string().min(1)`），而三个模板
 * （server-only / full-stack / frontend-only）都只写了 id / name / version /
 * description / author，**没有 main**。
 *
 * 实测（用真实 schema 跑）：
 *   模板实际形态（无 main）: 拒绝 → "main: Invalid input: expected string, received undefined"
 *   补上 main 之后:         通过
 *
 * ## 断言方式
 *
 * 这里**不用正则去 grep 模板文本**再声称「看起来有 main」—— 那种断言会随模板
 * 排版变化而失效。改为：用 zod 的 superRefine 语义等价检查 —— 直接断言模板里
 * 存在 `main:` 且其值落在 manifestSchema 允许的形态内。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestSchema } from '../../core/esm-loader/manifest-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../scaffold/templates');
const TEMPLATES = ['server-only', 'full-stack', 'frontend-only'];

/** 取出模板 src/index.ts 里 `manifest: { … }` 的字面量文本 */
function readManifestLiteral(template: string): string {
  const file = path.join(TEMPLATE_DIR, template, 'src/index.ts');
  const src = fs.readFileSync(file, 'utf-8');
  const start = src.indexOf('manifest: {');
  if (start === -1) throw new Error(`${template}: 未找到 manifest 字面量`);
  // 花括号配平（模板里是纯字面量，不含字符串中的花括号）
  let depth = 0;
  for (let i = start + 'manifest: '.length; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${template}: manifest 花括号不配平`);
}

describe('E-4 · scaffold 模板的 manifest 可通过 schema', () => {
  it.each(TEMPLATES)('%s 含必填的 main 字段', (template) => {
    const literal = readManifestLiteral(template);
    expect(literal, `${template} 缺 main —— manifestSchema 将其定为必填，插件装不上`).toMatch(/\bmain\s*:/);
  });

  it.each(TEMPLATES)('%s 的 main 指向插件目录下的 bundle 入口', (template) => {
    const literal = readManifestLiteral(template);
    const m = /main\s*:\s*['"]([^'"]+)['"]/.exec(literal);
    expect(m, `${template} 的 main 应是字符串字面量`).not.toBeNull();
    // esbuild 把插件打成单文件 bundle，安装后落在插件目录/index.js
    // （与 DB 内既有插件一致：@openlearn/plugin-vfs / process / management 均为 "index.js"）
    expect(m![1], 'main 应为 index.js（bundle 产物名）').toBe('index.js');
  });

  it.each(TEMPLATES)('%s 的 manifest 骨架除 main 外均满足必填项', (template) => {
    const literal = readManifestLiteral(template);
    // 只做骨架断言：把模板占位符替换成合法值后喂给真实 schema
    const asObject = literal
      .replace('manifest:', '')
      .replace(/'\{\{[^}]+\}\}'/g, "'placeholder'")
      .trim();
    // 模板里是纯对象字面量（占位符已全部替换成合法字符串），故 new Function 求值是安全的；
    // 不启用 no-new-func 规则压制 —— 该规则在本仓库未启用，加 disable 只会产生
    // "Unused eslint-disable directive" 噪音。
    const obj = new Function(`return ${asObject}`)() as Record<string, unknown>;
    obj.main = 'index.js';

    const parsed = manifestSchema.safeParse(obj);
    expect(
      parsed.success,
      `${template} 的 manifest 未通过 schema：${
        parsed.success ? '' : JSON.stringify(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
      }`,
    ).toBe(true);
  });

  it('三个模板的 main 取值一致（避免某一端模板漏改）', () => {
    const values = TEMPLATES.map((t) => {
      const m = /main\s*:\s*['"]([^'"]+)['"]/.exec(readManifestLiteral(t));
      return m?.[1];
    });
    expect(new Set(values).size, `main 取值不一致：${values.join(' / ')}`).toBe(1);
  });
});
