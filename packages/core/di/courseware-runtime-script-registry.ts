/**
 * CoursewareRuntimeScriptRegistry — 「课件运行时脚本扩展点」的默认实现。
 *
 * ## 为什么需要这个注册点
 *
 * 互动课件运行在 `credentialless` + `sandbox="allow-scripts allow-forms allow-downloads"`
 * 的 iframe 中（没有 `allow-same-origin`，即 opaque origin）。这意味着：
 * - 父窗口（宿主 React 页面）**读不到**课件内部的任何变量；
 * - 插件无法在运行期把脚本“注入”进去；
 * - 平台唯一能在课件里执行代码的位置，是服务端渲染课件 HTML 时的字符串拼接
 *   （`server/routes/shared.ts` 的 `injectLmsSdk()`）。
 *
 * 在引入本注册点之前，所有需要跑在课件内部的平台代码都被硬编码在
 * `server/utils/bridge-sdk.ts` 的 `BRIDGE_SDK_CODE` 模板字符串里，插件无法扩展。
 * 本服务把该位置开放为注册点：插件在 `activate()` 时注册脚本，宿主在渲染课件时读取并拼接。
 *
 * ## 生命周期
 *
 * 脚本按 `owner`（通常为 `pluginId`）归属，插件停用时应调用 `clear(owner)`；
 * 注册点本身不持有任何外部资源，也不会抛出可传播的异常路径。
 */
import type {
  CoursewareRuntimeScript,
  ICoursewareRuntimeScriptRegistry,
  IRegisteredCoursewareRuntimeScript,
} from './interfaces.js';

/** 默认执行顺序（数字越小越先执行） */
const DEFAULT_PRIORITY = 100;
/** 默认注入位置：Bridge SDK 之后 */
const DEFAULT_POSITION: 'head' | 'body-end' = 'body-end';

export class CoursewareRuntimeScriptRegistry implements ICoursewareRuntimeScriptRegistry {
  /** key = `${owner}::${id}`，保证不同插件可以使用相同的脚本 id */
  private readonly scripts = new Map<string, IRegisteredCoursewareRuntimeScript>();

  private static key(owner: string, id: string): string {
    return `${owner}::${id}`;
  }

  /**
   * 注册（或覆盖）一个课件运行时脚本。
   *
   * @param owner - 注册方，通常是 `ctx.pluginId`
   * @param script - 脚本描述；同一 owner 下相同 id 视为覆盖
   */
  register(owner: string, script: CoursewareRuntimeScript): void {
    if (!owner) throw new Error('CoursewareRuntimeScriptRegistry.register: owner is required');
    if (!script || !script.id) throw new Error('CoursewareRuntimeScriptRegistry.register: script.id is required');
    if (typeof script.source !== 'string' || !script.source.trim()) {
      throw new Error('CoursewareRuntimeScriptRegistry.register: script.source must be a non-empty string');
    }
    this.scripts.set(CoursewareRuntimeScriptRegistry.key(owner, script.id), {
      ...script,
      owner,
      priority: typeof script.priority === 'number' ? script.priority : DEFAULT_PRIORITY,
      position: script.position === 'head' ? 'head' : DEFAULT_POSITION,
    });
  }

  /** 注销某个 owner 下的单个脚本 */
  unregister(owner: string, id: string): void {
    this.scripts.delete(CoursewareRuntimeScriptRegistry.key(owner, id));
  }

  /**
   * 清理脚本。
   *
   * @param owner - 省略时清空所有 owner（谨慎使用，仅用于测试或平台重置）
   */
  clear(owner?: string): void {
    if (!owner) {
      this.scripts.clear();
      return;
    }
    const prefix = `${owner}::`;
    for (const key of [...this.scripts.keys()]) {
      if (key.startsWith(prefix)) this.scripts.delete(key);
    }
  }

  /**
   * 列出对目标课件生效的脚本（已按 priority 升序排序）。
   *
   * @param courseware - 目标课件的 `id` / `uuid`；省略时只返回「全局脚本」（两者均未限定者）
   */
  list(courseware?: { id?: string; uuid?: string }): IRegisteredCoursewareRuntimeScript[] {
    const matched: IRegisteredCoursewareRuntimeScript[] = [];
    for (const entry of this.scripts.values()) {
      if (this.matches(entry, courseware)) matched.push(entry);
    }
    return matched
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.priority - b.entry.priority || a.index - b.index)
      .map((item) => item.entry);
  }

  /** 列出当前所有注册方（便于诊断与测试） */
  listOwners(): string[] {
    return [...new Set([...this.scripts.values()].map((entry) => entry.owner))];
  }

  /**
   * 判定脚本是否对目标课件生效。
   *
   * - 未限定 `coursewareId` 也未限定 `coursewareUuid` → 全局脚本，对所有课件生效；
   * - 限定了任一者 → 需要与传入的 `courseware` 对应字段精确相等（两者都命中任一即算命中）。
   */
  private matches(
    entry: IRegisteredCoursewareRuntimeScript,
    courseware?: { id?: string; uuid?: string },
  ): boolean {
    const scopedById = typeof entry.coursewareId === 'string' && entry.coursewareId.length > 0;
    const scopedByUuid = typeof entry.coursewareUuid === 'string' && entry.coursewareUuid.length > 0;
    if (!scopedById && !scopedByUuid) return true;
    if (!courseware) return false;
    if (scopedById && courseware.id && entry.coursewareId === courseware.id) return true;
    if (scopedByUuid && courseware.uuid && entry.coursewareUuid === courseware.uuid) return true;
    return false;
  }
}
