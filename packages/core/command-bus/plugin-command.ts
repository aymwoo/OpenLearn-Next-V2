/**
 * 插件发起的命令不能自带身份，也不能自批高危操作。
 * 宿主把 actor 改写成插件自己的 actor，并丢掉 metadata.approved。
 */

export function bindPluginCommand(command: unknown, pluginActorId: string): Record<string, unknown> {
  const actor = typeof pluginActorId === 'string' ? pluginActorId.trim() : '';
  if (!actor) {
    throw new Error('[Security] Refusing to dispatch a plugin command without a host-assigned actor');
  }
  const raw = command && typeof command === 'object' ? { ...(command as Record<string, unknown>) } : {};
  const metadata =
    raw.metadata && typeof raw.metadata === 'object' ? { ...(raw.metadata as Record<string, unknown>) } : {};
  delete metadata.approved;
  return { ...raw, actorId: actor, metadata };
}

export function pluginActorIdFor(manifestId: string | undefined, pluginId: string): string {
  const id = (manifestId || pluginId || '').trim();
  if (!id) {
    throw new Error('[Security] Refusing to dispatch a plugin command without a host-assigned actor');
  }
  return id.startsWith('plugin:') ? id : `plugin:${id}`;
}
