/**
 * L-2 阶段 1：bootstrap 拆分后的结构守卫。
 *
 * ## 为什么需要
 *
 * 拆分把一个 881 行的模板字面体变成 5 个 section 模块。拆分当时用脚本做过了
 * **逐字节等价**验证（31939 字节完全一致），但那是**一次性**的 —— 脚本不会
 * 跟着未来某次手改继续生效。
 *
 * 本文件只做**需要真正执行**的检查：组装结果、顺序、遮蔽段可切出性。
 *
 * 「section 里不得含反引号 / `${}`」这类**静态文本**规则放在
 * `bootstrap-section-lint.test.ts`。分工的理由不是代码整洁，而是可达性：
 * 那两种违规的表现形式恰恰是**模块加载失败**（parse error / ReferenceError），
 * 若断言写在会 import section 的文件里，它自己会先崩掉，
 * 于是只剩一句不透明的 `no tests`。零 import 的 lint 才能真正报出原因。
 */

import { describe, it, expect } from 'vitest';
import { composeBootstrapCode, BOOTSTRAP_SECTION_NAMES, extractProcessMaskingBlock } from '../bootstrap/index.js';
import { RUNTIME_SHIM_SECTION } from '../bootstrap/sections/runtime-shim.js';
import { PROCESS_MASKING_SECTION } from '../bootstrap/sections/process-masking.js';
import { RPC_PROXY_SECTION } from '../bootstrap/sections/rpc-proxy.js';
import { HTTP_ROUTER_SECTION } from '../bootstrap/sections/http-router.js';
import { MESSAGE_HANDLER_SECTION } from '../bootstrap/sections/message-handler.js';

const SECTIONS: Record<(typeof BOOTSTRAP_SECTION_NAMES)[number], string> = {
  'runtime-shim': RUNTIME_SHIM_SECTION,
  'process-masking': PROCESS_MASKING_SECTION,
  'rpc-proxy': RPC_PROXY_SECTION,
  'http-router': HTTP_ROUTER_SECTION,
  'message-handler': MESSAGE_HANDLER_SECTION,
};

const CODE = composeBootstrapCode('/host/package.json');

// ⚠️ 本文件只做**需要执行**的检查。反引号 / `${}` 那两条静态规则放在
// bootstrap-section-lint.test.ts —— 那个文件零 import，故不会被检查对象打败。
describe('L-2 · bootstrap section 结构', () => {
  it('五个 section 都非空', () => {
    for (const name of BOOTSTRAP_SECTION_NAMES) {
      expect(SECTIONS[name].trim().length, `section ${name} 为空`).toBeGreaterThan(50);
    }
  });

  it('header 正确注入了 requirePath', () => {
    expect(CODE).toContain("const requireFn = createRequire('/host/package.json');");
  });

  it('section 顺序固定：shim → 遮蔽 → RPC → 路由 → 消息处理', () => {
    // 顺序不可调换：消息处理器引用了前面各段定义的 createServiceProxies /
    // createPluginHttpRouter / parentPort。调换会产出无法运行的 bootstrap。
    const positions = BOOTSTRAP_SECTION_NAMES.map((n) => CODE.indexOf(SECTIONS[n]));
    for (const [i, pos] of positions.entries()) {
      expect(pos, `section ${BOOTSTRAP_SECTION_NAMES[i]} 未出现在 bootstrap 中`).toBeGreaterThan(-1);
      if (i > 0) expect(pos, 'section 顺序与 BOOTSTRAP_SECTION_NAMES 不一致').toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('遮蔽段标记完整，且能被测试入口切出（沙箱约束测试靠它拿到可执行文本）', () => {
    expect(PROCESS_MASKING_SECTION).toContain('/* __PROCESS_MASKING_START__ */');
    expect(PROCESS_MASKING_SECTION).toContain('/* __PROCESS_MASKING_END__ */');
    const block = extractProcessMaskingBlock();
    expect(block.length).toBeGreaterThan(200);
    // 遮蔽块的关键语义必须落在切出的文本里，否则测试是在测一段空壳
    expect(block).toContain("Object.defineProperty(process, 'env'");
    expect(block).toContain('process.exit = function');
  });

  it('遮蔽段仍在消息处理器之前（先遮蔽再让插件代码有机会跑）', () => {
    expect(CODE.indexOf(PROCESS_MASKING_SECTION)).toBeLessThan(CODE.indexOf(MESSAGE_HANDLER_SECTION));
  });
});
