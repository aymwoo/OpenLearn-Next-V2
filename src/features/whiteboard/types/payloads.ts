/**
 * 白板图元 payload 类型（宿主对外契约）。
 *
 * 这里只保留**被白板之外模块引用**的类型。历史上这些类型住在
 * `canvas-model/types.ts`——该目录下的其余 8 个文件是未被任何生产代码调用的
 * 纸面架构（构建产物中不存在），已随 Phase 0 清理删除。
 */

export interface HtmlAppletPayload {
  title?: string;
  code?: string;
  coursewareUuid?: string;
  /** 系统资源库中的单 HTML / 文件夹资源 id（优先级介于 coursewareUuid 与 code 之间） */
  resourceId?: string;
  /** 插件自定义内容源类型（配合 coursewareSourceRegistry） */
  sourceType?: string;
  /** 插件自定义内容源 id（配合 coursewareSourceRegistry） */
  sourceId?: string;
}
