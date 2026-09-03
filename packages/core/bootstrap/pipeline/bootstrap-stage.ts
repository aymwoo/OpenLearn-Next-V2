/**
 * OpenLearn Platform Kernel - Bootstrap Stage Contract (PI-003)
 *
 * 兼容层：`IBootstrapStage` 的权威定义位于 `../types/index.js`。本文件保留
 * `./bootstrap-stage.js` 的导入路径以便历史代码继续工作，但不重复定义接口，
 * 避免 TS2308（重导出歧义）和 TS2416（不兼容类型赋值）。
 *
 * 如需扩展实现，请继承 `../types/index.js` 中的 `IBootstrapStage`：
 *
 *   import type { IBootstrapStage } from '../types/index.js';
 *   export class MyStage implements IBootstrapStage { ... }
 */

import type { IBootstrapStage as IBootstrapStageContract } from '../types/index.js';

export type IBootstrapStage = IBootstrapStageContract;
