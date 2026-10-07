/**
 * 前端 Worker 插件的方法 / 路径级调用策略 —— ServiceHost 的 Security Barrier 3。
 *
 * ## 这是什么
 *
 * 浏览器侧 `src/plugin-host/service-host.ts` 的 Barrier 3 判定入口。
 *
 * ## 为什么是 re-export（审计项 B-4）
 *
 * 策略原本只存在于本文件，后端 `packages/core/worker-runtime/service-host.ts`
 * 没有对应层 —— 两端对「插件能做什么」各写一套判定，规则漂移无从察觉。
 * 现已抽到 `packages/core/plugin-host/method-policy.ts`（纯数据 + 纯函数，
 * 不 import 任何一侧的运行时），本文件只负责：
 *
 *   1. 传入**浏览器侧**的 Token 名集合（`@openlearn/frontend:*`）
 *   2. 把旧的 4 参调用形态收敛成共享模块的入参对象
 *
 * 策略规则、路径表、capability 常量**均以共享模块为单一真理源**，改规则只改一处。
 *
 * @module
 */
import {
  // 具名导入与下方包装函数同名会互相遮蔽，故此处取别名再转出
  checkMethodPolicy as checkMethodPolicyShared,
  type MethodPolicyTokens,
  CAP_API_WRITE,
  CAP_API_ADMIN,
  CAP_GRADES_WRITE,
  HIGH_RISK_PATH_PREFIXES,
  IRREVERSIBLE_PATH_SUFFIXES,
} from '../../packages/core/plugin-host/method-policy.js';

import {
  FRONTEND_API_TOKEN,
  SOCKET_SERVICE_TOKEN,
  UI_SERVICE_TOKEN,
  STORAGE_SERVICE_TOKEN,
  SEMESTER_GRADE_SERVICE_TOKEN,
} from './types';

// 规则常量按原路径继续导出，保持既有 import 不破
export { CAP_API_WRITE, CAP_API_ADMIN, CAP_GRADES_WRITE, HIGH_RISK_PATH_PREFIXES, IRREVERSIBLE_PATH_SUFFIXES };

/** 浏览器侧的 Token 名集合（与后端命名空间不同，故分开声明） */
const BROWSER_TOKENS: MethodPolicyTokens = Object.freeze({
  frontendApi: FRONTEND_API_TOKEN,
  socketService: SOCKET_SERVICE_TOKEN,
  uiService: UI_SERVICE_TOKEN,
  storageService: STORAGE_SERVICE_TOKEN,
  semesterGradeService: SEMESTER_GRADE_SERVICE_TOKEN,
});

/**
 * 对一次服务调用做方法 / 路径级判定。
 *
 * @param token  被调用的服务 Token
 * @param method 被调用的方法名
 * @param args   调用参数（IFrontendAPI 的首个参数会被当作路径解析）
 * @param caps   插件 manifest 声明的 capabilitiesProposed
 * @returns 允许时返回 `null`；拒绝时返回**面向人的原因说明**
 */
export function checkMethodPolicy(
  token: string,
  method: string,
  args: unknown,
  caps: readonly string[] = [],
): string | null {
  return checkMethodPolicyShared({ token, method, args, caps, tokens: BROWSER_TOKENS });
}

// 具名导入与包装同名会遮蔽，故起别名再转出
