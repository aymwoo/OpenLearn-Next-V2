/**
 * 启动前守卫（**模块求值期**执行）。
 *
 * ## 为什么单独一个模块
 *
 * 运行时检查必须在 `packages/core/db/index.ts` 求值**之前**跑完 —— 那个模块顶层
 * `import Database from 'better-sqlite3'`，原生绑定在模块求值期就加载；ABI 不匹配
 * 时进程会在 `startServer()` 被调用之前就抛异常退出，写在 startServer 里的检查
 * 根本没机会执行。
 *
 * ESM 的依赖求值顺序是「按 import 语句出现顺序深度优先」，因此只要本模块是
 * `server.ts` 的**第一个 import**，它的模块体就一定先于内核 / DB 模块求值。
 * esbuild 打成 CJS 后同样保持这个顺序（模块体按依赖顺序落盘）。
 *
 * 拆成独立模块还有两个好处：
 * - 纯逻辑（判定、消息）在 `runtime-check.ts` 里，可被单测逐条覆盖；
 *   本模块只负责「在恰当的时机把纯逻辑跑起来」。
 * - 单测不会误触发副作用 —— 导入 `runtime-check.ts` 不会退出进程。
 */
import { assertRuntimeEnvironment } from './runtime-check.js';

assertRuntimeEnvironment();
