/**
 * P2 插件前端熔断器 —— 独立模块（从 extension-point-renderer 抽出）。
 *
 * 抽出的原因：激活路径（plugin-host.ts）需要在插件成功激活时**复位**该插件的
 * 熔断状态（v0.6.1 审计 C-2：此前 resetPluginBreaker 是零调用方的死代码，
 * blown 标志永驻 —— 重新激活/重新启用后扩展点重注册却被 isPluginBlown
 * 全部跳过，「重新激活可恢复」承诺不成立）。而 renderer 与 plugin-host
 * 之间存在既有依赖方向，熔断状态必须落在两者共同的下游模块以避免循环导入。
 *
 * 同一插件连续崩溃达到阈值后自动停用（降级），防止坏插件反复崩溃拖垮宿主。
 * 窗口内成功渲染（CrashResetProbe 复位）会清零计数。
 */

export const CRASH_BREAKER_THRESHOLD = 3;
export const CRASH_BREAKER_WINDOW_MS = 5 * 60 * 1000;

interface CrashRecord {
  count: number;
  lastAt: number;
  blown: boolean;
}

/** pluginId → 熔断记录（模块级，跨渲染周期持久） */
const pluginCrashRegistry = new Map<string, CrashRecord>();

/** 记录一次插件前端崩溃；达到阈值返回 true（调用方应停用该插件） */
export function recordPluginCrash(pluginId: string): { shouldBreak: boolean; count: number } {
  const now = Date.now();
  const rec = pluginCrashRegistry.get(pluginId);
  if (!rec || now - rec.lastAt > CRASH_BREAKER_WINDOW_MS) {
    pluginCrashRegistry.set(pluginId, { count: 1, lastAt: now, blown: false });
    return { shouldBreak: false, count: 1 };
  }
  rec.count += 1;
  rec.lastAt = now;
  const shouldBreak = rec.count >= CRASH_BREAKER_THRESHOLD;
  if (shouldBreak) rec.blown = true;
  return { shouldBreak, count: rec.count };
}

/** 渲染成功（子组件真实提交）时清零该插件的连续崩溃计数 */
export function resetPluginCrash(pluginId: string): void {
  pluginCrashRegistry.delete(pluginId);
}

/** 查询某插件是否已被熔断（停用降级中） */
export function isPluginBlown(pluginId: string): boolean {
  return pluginCrashRegistry.get(pluginId)?.blown ?? false;
}

/** 清除熔断状态（插件激活成功/内置包重新启用时调用） */
export function resetPluginBreaker(pluginId: string): void {
  pluginCrashRegistry.delete(pluginId);
}
