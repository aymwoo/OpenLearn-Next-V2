/**
 * 插件私有表的唯一前缀。
 *
 * 建表（inline 上下文、子进程 bootstrap）和卸载删表必须用同一个安装标识，
 * 也就是插件行的主键（ZIP 安装是 UUID，预加载内置插件是它自己的 id）。
 * 不再用 manifest id 另起一套前缀：那会让卸载删不掉子进程建出来的表。
 */
export function pluginTablePrefix(scopeId: string): string {
  return `plugin_${scopeId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;
}

/** 标识符只允许字母数字下划线，避免把前缀拼进 SQL 时带出别的语句。 */
export function isSafePluginTablePrefix(prefix: string): boolean {
  return /^plugin_[A-Za-z0-9_]+_$/.test(prefix);
}
