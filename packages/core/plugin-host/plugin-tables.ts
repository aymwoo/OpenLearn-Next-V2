/**
 * 插件私有表的唯一前缀。
 *
 * 建表（inline 上下文、子进程 bootstrap）和卸载删表统一使用安装主键标识（scopeId / pluginId），
 * 即 plugins 表的主键：
 * 1. 内置插件使用其规范标识（如 @openlearn/plugin-vfs → plugin__openlearn_plugin_vfs_），语义清晰；
 * 2. 外部上传插件使用安装生成的唯一 UUID，实现严密的存储物理隔离与防冲突；
 * 3. 卸载插件时，确保所有该实例自建表能被准确识别并彻底清理。
 */

export function pluginTablePrefix(scopeId: string, _manifestId?: string): string {
  return `plugin_${scopeId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;
}

/**
 * 获取插件可能使用的所有合法私有表前缀集合（含历史兼容前缀）。
 * 用于 SQL 守卫与卸载清理，确保平滑过渡。
 */
export function listAllowedPluginTablePrefixes(
  scopeId: string,
  manifestId?: string,
  includeLegacyManifest = false,
): string[] {
  const prefixes = new Set<string>();
  if (scopeId) {
    prefixes.add(`plugin_${scopeId.replace(/[^a-zA-Z0-9_]/g, '_')}_`);
  }
  if (scopeId && manifestId) {
    prefixes.add(pluginTablePrefix(scopeId, manifestId));
  }
  if (includeLegacyManifest && manifestId) {
    prefixes.add(`plugin_${manifestId.replace(/[^a-zA-Z0-9_]/g, '_')}_`);
  }
  return [...prefixes].filter(isSafePluginTablePrefix);
}

/** 标识符只允许字母数字下划线，避免把前缀拼进 SQL 时带出别的语句。 */
export function isSafePluginTablePrefix(prefix: string): boolean {
  return /^plugin_[A-Za-z0-9_]+_$/.test(prefix);
}
