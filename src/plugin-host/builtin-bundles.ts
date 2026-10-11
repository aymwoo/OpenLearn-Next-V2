/**
 * 内置扩展包清单 —— 宿主随包发布、不经过安装链路的扩展包注册表。
 *
 * 单一事实源：熔断器（extension-point-renderer 触发降级时需要把内置包写入
 * 覆盖表）、管理卡片（BuiltinExtensionBundlesCard）与装配模块
 * （smart-edu-plugin）共用，避免三处各写一份 id 漂移。
 *
 * `defaultEnabled` 决定「用户从未做过启停选择」时的初始态：
 * - 国家平台连接器默认 **停用**（v0.6.1 用户决策）：国家平台不提供公开的
 *   第三方网关，未配置 SMARTEDU_API_BASE 时它只会在备课界面呈现「未配置」
 *   提示——与其让教师看到无效入口，不如默认不出现，管理员在 Plugin Center
 *   显式启用后再配套配置网关。
 */

export interface BuiltinBundleMeta {
  id: string;
  defaultEnabled: boolean;
}

export const BUILTIN_BUNDLES: readonly BuiltinBundleMeta[] = [
  { id: 'ext-national-smart-edu', defaultEnabled: false },
];

export const isBuiltinBundleDefaultEnabled = (id: string): boolean =>
  BUILTIN_BUNDLES.find((b) => b.id === id)?.defaultEnabled ?? false;

export const isBuiltinBundleId = (id: string): boolean => BUILTIN_BUNDLES.some((b) => b.id === id);
