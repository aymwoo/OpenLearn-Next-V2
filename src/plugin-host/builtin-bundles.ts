/**
 * 内置扩展包清单 —— 宿主随包发布、不经过安装链路的扩展包注册表。
 *
 * 单一事实源：熔断器（extension-point-renderer 触发降级时需要把内置包写入
 * 停用表）、管理卡片（BuiltinExtensionBundlesCard）与装配模块
 * （smart-edu-plugin）共用，避免三处各写一份 id 漂移。
 */

export const BUILTIN_BUNDLE_IDS: readonly string[] = ['ext-national-smart-edu'];
