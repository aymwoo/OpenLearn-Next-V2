/**
 * 前端 Worker 插件服务 Token 白名单计算 —— ServiceHost 的 Token 级能力沙箱。
 *
 * ## 与后端实现的对应关系（安全修复，两端必须同步）
 *
 * | 语义         | 后端（权威实现）                                          | 前端（本文件）                        |
 * | ------------ | --------------------------------------------------------- | ------------------------------------- |
 * | 基础白名单   | `worker-manager.ts` → `BASE_WORKER_SERVICE_TOKENS`          | `BASE_FRONTEND_WORKER_SERVICE_TOKENS` |
 * | 动态计算     | `worker-manager.ts` → `computeAllowedWorkerTokens()`        | `computeAllowedWorkerTokens()`         |
 * | 门禁校验     | `service-host.ts` → `handleInvoke` Security Barrier 1        | `service-host.ts` → `handleInvoke` Barrier 1 |
 * | 注入点       | `worker-manager.ts:1299` 传给 `new ServiceHost(..., allowedTokens)` | `browser-worker-manager.ts` 传给 `new ServiceHost(..., allowedTokens)` |
 *
 * 之所以在此重新实现而**不**直接 import 后端函数：后端 `worker-manager.ts`
 * 依赖 `node:worker_threads` / `fs` / `path` / `better-sqlite3` 等 Node 专有模块，
 * 浏览器打包会直接失败。故前端保持同名常量、同名函数与相同判定规则；
 * 规则变更时必须两端同步修改。
 *
 * ## 威胁模型
 *
 * T-FE-01: 浏览器端插件只要在 manifest 声明任意一条 capability，
 *          就能 `ctx.resolve()` 到容器内任意服务并调用其任意方法
 *          （包括写成绩等敏感领域服务）。Token 白名单在 RPC 入口
 *          （ServiceHost.handleInvoke 的最前面）拦截，未命中即拒绝。
 *
 * @module
 */

import {
  FRONTEND_API_TOKEN,
  SOCKET_SERVICE_TOKEN,
  UI_SERVICE_TOKEN,
  STORAGE_SERVICE_TOKEN,
  SEMESTER_GRADE_SERVICE_TOKEN,
} from './types';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * 基础 Worker 服务白名单 —— 无需任何额外声明，所有 Worker 插件默认可用。
 *
 * 对应后端 `BASE_WORKER_SERVICE_TOKENS` 的 9 个核心基础设施 Token 的前端子集：
 * 均为 UI / 事件 / 本地存储类基础设施服务，不含任何业务写操作。
 */
export const BASE_FRONTEND_WORKER_SERVICE_TOKENS: readonly string[] = Object.freeze([
  FRONTEND_API_TOKEN,
  SOCKET_SERVICE_TOKEN,
  UI_SERVICE_TOKEN,
  STORAGE_SERVICE_TOKEN,
]);

/**
 * 敏感领域服务白名单 —— 必须由 manifest 显式声明才授予。
 *
 * 对应后端 `computeAllowedWorkerTokens` 中对
 * `IPointsDimensionRegistry` / `IPointsLedgerService` 的按需授权；
 * 前端的对等领域服务是 `ISemesterGradeService`（写入学期成绩）。
 */
export const SENSITIVE_FRONTEND_SERVICE_TOKENS: readonly string[] = Object.freeze([SEMESTER_GRADE_SERVICE_TOKEN]);

/** 能授予敏感领域服务的 capability 前缀/字面量（与后端 points 的判定同构）。 */
const SENSITIVE_CAPABILITY_NAMES: readonly string[] = Object.freeze(['grades']);

/**
 * 规范化依赖条目，用于**精确比较**。
 *
 * manifest 里的依赖写法为 `@openlearn/core:ISemesterGradeService@^1.0.0`
 * （域:服务名@版本范围），而白名单常量只到服务名、不含版本范围。
 * 此处剥掉版本范围后做全等比较，从而避免 `includes` 子串匹配可被
 * `MyISemesterGradeServiceThing` 之类伪造条目命中。
 */
function normalizeDepEntry(entry: string): string {
  const slash = entry.indexOf('/');
  if (slash === -1) return entry;
  const versionAt = entry.indexOf('@', slash);
  return versionAt === -1 ? entry : entry.slice(0, versionAt);
}

// ── Manifest 形状（只取白名单计算所需字段） ───────────────────────────────────

/**
 * 白名单计算所需的最小 Manifest 形状。
 * `FrontendPluginManifest` 结构上兼容本接口，另额外容忍后端 Manifest 的
 * `requires` / `optional` 依赖声明字段（可能来自上传插件的原始 manifest）。
 */
export interface AllowedTokensManifestLike {
  capabilitiesProposed?: string[];
  requires?: string[];
  optional?: string[];
}

// ── Token allowlist computation ─────────────────────────────────────────────

/**
 * 根据插件 Manifest 声明动态计算该 Worker 允许访问的 Service Token 白名单。
 *
 * 规则（与后端 `computeAllowedWorkerTokens` 一致）：
 * 1. 起点是 {@link BASE_FRONTEND_WORKER_SERVICE_TOKENS}；
 * 2. 敏感领域服务仅当 manifest 在 `requires` / `optional` 中显式依赖该服务，
 *    或在 `capabilitiesProposed` 中声明了对应 capability（`grades` / `grades:*` / `*`）时才授予；
 * 3. 传入 `requestedTokens` 时取交集，调用方能请求的永远只是授权集的子集。
 *
 * @param manifest - 插件 manifest（可为 undefined，表示无任何额外声明）
 * @param requestedTokens - 调用方请求代理的 Token 列表，可选
 * @returns 授权的 Token 名称数组
 */
export function computeAllowedWorkerTokens(
  manifest?: AllowedTokensManifestLike,
  requestedTokens?: Iterable<string>,
): string[] {
  const allowed = new Set<string>(BASE_FRONTEND_WORKER_SERVICE_TOKENS);

  if (manifest) {
    const reqs = Array.isArray(manifest.requires) ? manifest.requires : [];
    const opts = Array.isArray(manifest.optional) ? manifest.optional : [];
    const allDeclared = [...reqs, ...opts];
    const caps = Array.isArray(manifest.capabilitiesProposed) ? manifest.capabilitiesProposed : [];

    // 敏感领域服务：仅在显式依赖或显式声明能力时授予
    //
    // B-2：原先用 `dep.includes(tokenName)` 做**子串匹配**，可被伪造绕过：
    // manifest 写 `requires: ['@evil/x:MyISemesterGradeServiceThing']` 即命中
    // `ISemesterGradeService`，从而拿到写入学期成绩的权限。
    // 改为对依赖条目做**精确 Token 匹配**（规范化后全等比较）。
    const normalizedDeclared = new Set(
      allDeclared.filter((d): d is string => typeof d === 'string').map(normalizeDepEntry),
    );
    const hasSensitiveDep = SENSITIVE_FRONTEND_SERVICE_TOKENS.some((token) =>
      normalizedDeclared.has(normalizeDepEntry(token)),
    );
    const hasSensitiveCap = caps.some(
      (c) =>
        typeof c === 'string' &&
        SENSITIVE_CAPABILITY_NAMES.some((name) => c === name || c.startsWith(`${name}:`) || c === '*'),
    );

    if (hasSensitiveDep || hasSensitiveCap) {
      for (const token of SENSITIVE_FRONTEND_SERVICE_TOKENS) {
        allowed.add(token);
      }
    }
  }

  if (requestedTokens) {
    const requestedSet = new Set(requestedTokens);
    return Array.from(allowed).filter((t) => requestedSet.has(t));
  }

  return Array.from(allowed);
}
