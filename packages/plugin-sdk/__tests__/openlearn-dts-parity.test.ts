/**
 * openlearn.d.ts ↔ index.ts Token 一致性防回归测试。
 *
 * openlearn.d.ts 是手工维护的独立声明文件（build.mjs 直接复制为 dist/index.d.ts，
 * 即 npm 包的类型入口）。历史上曾多次出现"index.ts 新增 Token 但 d.ts 未同步"的漂移
 * （v0.3.22 审计时 d.ts 缺 14/33 个 Token，第三方插件按文档 import 直接 TS2305）。
 * 本测试静态解析两个文件，保证两者 Token 集合完全一致。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkDir = path.resolve(__dirname, '..');

/** 从 index.ts 的 value-export 块中提取所有 Token 导出名（不含 Token 类本身） */
function extractTokenExportsFromIndex(): Set<string> {
  const src = fs.readFileSync(path.join(sdkDir, 'index.ts'), 'utf-8');
  const names = new Set<string>();
  // 只匹配值导出 `export { ... } from '...'`（`export type {` 会被排除）
  for (const block of src.matchAll(/(?<!type\s)export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1].split(',')) {
      const name = raw.trim();
      // 排除 Token 类本身（'Token'.endsWith('Token') 为真）
      if (name.endsWith('Token') && name !== 'Token') names.add(name);
    }
  }
  return names;
}

/** 从 openlearn.d.ts 提取 declare const 的 Token 声明与 export 块导出的 Token */
function extractTokenSurfaceFromDts(): { declared: Set<string>; exported: Set<string> } {
  const src = fs.readFileSync(path.join(sdkDir, 'openlearn.d.ts'), 'utf-8');
  const declared = new Set<string>();
  for (const m of src.matchAll(/declare\s+const\s+(\w+Token)\s*:/g)) declared.add(m[1]);
  const exported = new Set<string>();
  for (const block of src.matchAll(/(?<!type\s)export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1].split(',')) {
      const name = raw.trim();
      // 排除 Token 类本身（以 declare class 声明，非 declare const）
      if (name.endsWith('Token') && name !== 'Token') exported.add(name);
    }
  }
  return { declared, exported };
}

describe('openlearn.d.ts ↔ index.ts Token parity', () => {
  const indexTokens = extractTokenExportsFromIndex();

  /**
   * 已收回对外承诺的 Token（D-2 / D-6 决策，SDK 3.8.0）。
   *
   * 这些 Token 在 `core/di/interfaces.ts` 里仍有声明、内核仍在 `kernel/index.ts`
   * 注册，但**零生产 resolve** —— 对外承诺一个零消费者的 API 比不承诺更糟。
   *
   * 下面三条「集合必须完全一致」的断言原本会把它们判为违规。这里显式列出，
   * 让门禁对「意外的幽灵 Token」保持严格，同时对这批已知撤回项放行。
   * 名单与 `packages/plugin-sdk/generate-dts.mjs` 的 `WITHDRAWN_FROM_SDK` 一一对应。
   *
   * 若将来接入真实消费者：删掉本名单，并把 export 加回 `index.ts`。
   */
  const WITHDRAWN_TOKENS = new Set([
    'ICapabilityGovernanceServiceToken', // M-9 / F-2：capability-governance 子系统整体零 resolve
    'IPluginRuntimeCompositionToken', // M-10 / F-3
    'IUnifiedExtensionRegistryToken', // M-10 / F-3
    'IPluginCapabilityGatewayToken', // M-10 / F-3
  ]);
  const { declared, exported } = extractTokenSurfaceFromDts();

  it('index.ts 导出的每个 Token 都必须在 openlearn.d.ts 中 declare', () => {
    const missing = [...indexTokens].filter((t) => !declared.has(t));
    expect(missing, `openlearn.d.ts 缺少以下 Token 声明（dist/index.d.ts 会缺失，插件 import 即 TS2305）`).toEqual([]);
  });

  it('index.ts 导出的每个 Token 都必须出现在 openlearn.d.ts 的 export 列表中', () => {
    const missing = [...indexTokens].filter((t) => !exported.has(t));
    expect(missing, `openlearn.d.ts 的 export 块缺少以下 Token`).toEqual([]);
  });

  it('openlearn.d.ts 不得声明 index.ts 未导出的幽灵 Token（撤回名单除外）', () => {
    const ghost = [...declared].filter((t) => !indexTokens.has(t) && !WITHDRAWN_TOKENS.has(t));
    expect(ghost, `openlearn.d.ts 声明了 index.ts 不存在的 Token（发布类型与运行时不符）`).toEqual([]);
  });

  it('撤回名单里的 Token 确实不在 index.ts 导出面（防止名单过期）', () => {
    // 若某个 Token 已被重新加回导出（例如补上了真实消费者），本名单就该删 ——
    // 否则下面的 parity 断言会一直为它开豁免，掩盖真实漂移。
    const reinstated = [...WITHDRAWN_TOKENS].filter((t) => indexTokens.has(t));
    expect(reinstated, '这些 Token 已在 index.ts 导出面 —— 若是有意恢复导出，请从三处撤回名单同步移除').toEqual([]);
  });

  it('撤回名单必须与实际撤回情况一致（不得多列）', () => {
    // 反向约束：名单里的名字若既不在 index.ts 导出、也不在 d.ts 声明，
    // 说明它根本不存在，纯属噪音。
    const { declared: dtsDeclared } = extractTokenSurfaceFromDts();
    const phantom = [...WITHDRAWN_TOKENS].filter((t) => !dtsDeclared.has(t));
    expect(phantom, '撤回名单里的 Token 在 openlearn.d.ts 中并无声明 —— 请清理名单').toEqual([]);
  });

  it('openlearn.d.ts 的 export 列表不得包含未声明的 Token', () => {
    const dangling = [...exported].filter((t) => !declared.has(t));
    expect(dangling).toEqual([]);
  });

  it('Token 导出集应与所有 DI Token 声明点完全一致（新增 Token 无需改魔法数字）', () => {
    // 此前此处硬编码 `toBe(33)`，新增 Token 时若忘记改数字就直接红灯
    // （v0.3.22 之后的 stage-guard 特性就踩过一次，漏改成 34）。
    // 改为断言「SDK 导出集 == 全部 Token 声明点」，让新增 Token 自动纳入比较，
    // 只有真的漏导出 / 幽灵导出才会失败。
    const sources = [
      path.resolve(sdkDir, '../core/di/interfaces.ts'),
      path.resolve(sdkDir, '../activity-ecosystem/index.ts'),
    ];
    const declared = new Set<string>();
    for (const src of sources) {
      const text = fs.readFileSync(src, 'utf-8');
      for (const m of text.matchAll(/^export const (\w+Token)\s*=/gm)) declared.add(m[1]);
    }

    const missing = [...declared].filter((t) => !indexTokens.has(t) && !WITHDRAWN_TOKENS.has(t));
    expect(missing, `以下 Token 已在 DI 中声明但 SDK 未导出（插件 import 即 TS2305）：\n${missing.join('\n')}`).toEqual(
      [],
    );

    const ghost = [...indexTokens].filter((t) => !declared.has(t));
    expect(ghost, `以下 Token 从未在任何 DI 声明点定义，属幽灵导出：\n${ghost.join('\n')}`).toEqual([]);

    // 保留总数断言作为「声明点数量」的回归提示，便于发现解析规则失效。
    // 注意这是 `声明点 - 撤回数`：`indexTokens` 只统计仍在导出面上的，
    // 而 `declared` 统计 DI 里的全部声明点，两者差值必须恰为撤回名单大小。
    expect(
      indexTokens.size,
      `SDK 导出 ${indexTokens.size} 个 / DI 声明 ${declared.size} 个 / 撤回 ${WITHDRAWN_TOKENS.size} 个`,
    ).toBe(declared.size - WITHDRAWN_TOKENS.size);
  });
});
