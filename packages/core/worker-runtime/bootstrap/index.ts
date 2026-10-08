/**
 * Worker / 子进程 bootstrap 的组装（L-2 阶段 1）。
 *
 * ## 为什么要拆
 *
 * 拆分前 `generateBootstrapCode()` 是**一个 881 行的模板字面量**，占
 * `worker-manager.ts` 的 44%。它带来三个具体问题，不是「文件太大」这种泛泛的抱怨：
 *
 * 1. **可验证性被结构性限制。** 遮蔽逻辑要测，只能靠哨兵标记在整段模板里做字符串
 *    手术（当时的 `extractProcessMaskingBlock()` 就住在 `worker-manager.ts` 里，
 *    对着 881 行 blob 切）。拆成 section 后，手术范围缩到一段，且入口跟着代码走。
 * 2. **改动风险不透明。** 五个逻辑层（运行时 shim / 遮蔽 / RPC / 路由 / 消息处理）
 *    混在一个字面量里，改任何一层都无法判断会不会碰到另一层。
 * 3. **评审不可行。** 无法对「消息处理器的改动」单独做 diff 评审。
 *
 * ## 拆分方式与安全性
 *
 * 机械提取，**零行为变更**。切分前已核实两个前提，否则这个拆分会静默损坏：
 *
 * - 模板体内**零反引号** → 放进新的模板字面量不会被提前截断；
 * - 模板体内**仅 1 处 `${}` 插值**（在 header 的 `requirePath`）→ section 可做成
 *   完全无插值的字符串常量。
 *
 * section 顺序即拼接顺序，**不可调换**：消息处理器引用了前面各段定义的
 * `createServiceProxies` / `createPluginHttpRouter` / `parentPort`。
 */

import { RUNTIME_SHIM_SECTION } from './sections/runtime-shim.js';
import { PROCESS_MASKING_SECTION, extractProcessMaskingBlock } from './sections/process-masking.js';
import { RPC_PROXY_SECTION } from './sections/rpc-proxy.js';
import { HTTP_ROUTER_SECTION } from './sections/http-router.js';
import { MESSAGE_HANDLER_SECTION } from './sections/message-handler.js';

export { extractProcessMaskingBlock };

/**
 * 组装出完整的 bootstrap 源码。
 *
 * @param requirePath - `createRequire` 的基址。必须是**宿主**的 `package.json` 路径：
 *   共享模块（`PLUGIN_SHARED_MODULES`：recharts / jspdf / exceljs …）从仓库
 *   `node_modules` 解析，不在插件自己的目录内。
 */
export function composeBootstrapCode(requirePath: string): string {
  // 首个换行来自模板字面量自身：拆分前的原始模板也是这样以换行开头的
  // （`return \`\nimport { createRequire }…`）。保留它，逐字节等价。
  const header = `
import { createRequire } from 'node:module';
const requireFn = createRequire('${requirePath}');`;

  // 用 '\n\n' 而不是 '\n'：各 section 提取时已剥掉首尾空行，原模板在 section
  // 边界处各有一个空行。逐字节保持与拆分前一致，这样「重构零行为变更」就是
  // 可验证的事实，而不是口头声明。
  const parts = [
    header,
    RUNTIME_SHIM_SECTION,
    PROCESS_MASKING_SECTION,
    RPC_PROXY_SECTION,
    HTTP_ROUTER_SECTION,
    MESSAGE_HANDLER_SECTION,
  ];

  return parts.join('\n\n');
}

/** 按拼接顺序列出各 section —— 供测试断言顺序未被改动 */
export const BOOTSTRAP_SECTION_NAMES = [
  'runtime-shim',
  'process-masking',
  'rpc-proxy',
  'http-router',
  'message-handler',
] as const;
