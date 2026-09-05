import type { HtmlAppletPayload } from '../canvas-model/types';

/**
 * 课件内容源 loader —— 允许第三方插件为 html-applet 接入自定义内容后端。
 *
 * 例如：OAuth 授权的第三方课件平台、私有资源网关等。插件在 `activate(ctx)`
 * 内通过 `ctx.ui.registerCoursewareSource(loader)` 注册；`HtmlAppletFrame`
 * 在渲染时会依次询问所有已注册 loader，返回第一个非空 URL 作为 iframe src。
 *
 * 优先级：coursewareUuid > resourceId > 自定义内容源 > code(srcDoc)。
 */
export interface CoursewareSourceLoader {
  /** 全局唯一 id（建议使用插件命名空间前缀，如 `ext-moodle/courseware`） */
  id: string;
  /** 解析 data 为 iframe src URL；无法处理时返回 null */
  resolve(data: HtmlAppletPayload, context: { lessonId: string }): string | null;
}

class CoursewareSourceRegistry {
  private loaders = new Map<string, { impl: CoursewareSourceLoader; pluginId?: string }>();

  register(loader: CoursewareSourceLoader, pluginId?: string): void {
    this.loaders.set(loader.id, { impl: loader, pluginId });
  }

  /** 仅允许插件注销自己的 loader（带 pluginId 时校验所有权） */
  unregister(id: string, pluginId?: string): void {
    const entry = this.loaders.get(id);
    if (!entry) return;
    if (pluginId && entry.pluginId !== pluginId) return;
    this.loaders.delete(id);
  }

  /** 清理某插件注册的所有 loader（生命周期兜底） */
  unregisterPlugin(pluginId: string): void {
    for (const [id, entry] of this.loaders) {
      if (entry.pluginId === pluginId) this.loaders.delete(id);
    }
  }

  resolve(data: HtmlAppletPayload, context: { lessonId: string }): string | null {
    for (const { impl } of this.loaders.values()) {
      try {
        const url = impl.resolve(data, context);
        if (url) return url;
      } catch {
        // 忽略异常 loader，继续尝试下一个
      }
    }
    return null;
  }
}

export const coursewareSourceRegistry = new CoursewareSourceRegistry();
