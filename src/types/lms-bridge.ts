/**
 * LMS ↔ 课件（courseware）桥接共享类型。
 *
 * 课件运行在严格沙箱 iframe（`sandbox="allow-scripts allow-forms allow-downloads"`，
 * 无 `allow-same-origin`）内，通过 `window.LMS` / `__LMS_STUDENT__` /
 * `__LMS_COURSEWARE__` 与宿主通信。
 *
 * 这些类型同时供：
 * - 宿主侧（`src/services/lms-bridge.ts`、`server/routes/shared.ts`）引用；
 * - 课件作者 / 插件开发者编写交互课件时获得类型提示（后续经 @openlearn/plugin-sdk 导出）。
 */

export interface LmsStudentContext {
  student_id: string;
  student_name: string;
  class_id: string;
  attempt_id: string;
}

export interface LmsCoursewareContext {
  uuid: string;
  name: string;
}

export interface LmsBridgeApi {
  /** 提交最终成绩（宿主写入 courseware_attempt，status=submitted） */
  submit(data: Record<string, unknown>): void;
  /** 保存进度（宿主写入 courseware_attempt，status=inprogress） */
  saveProgress(data: Record<string, unknown>): void;
  /** 标记完成 */
  finish(data: Record<string, unknown>): void;
  /** 遥测日志 */
  log(event: string, data?: Record<string, unknown>): void;
  getStudent(): LmsStudentContext;
  getCourseware(): LmsCoursewareContext;
  /** 订阅宿主下发的指令；返回取消订阅函数 */
  on(event: string, callback: (payload: unknown) => void): () => void;
  off(event: string, callback: (payload: unknown) => void): void;
  /** 向宿主上报配置/元数据 */
  setConfig(config: Record<string, unknown>): void;
  /** 向宿主请求恢复上次保存的进度 */
  getProgress(): Promise<Record<string, unknown> | null>;
}

declare global {
  interface Window {
    LMS: LmsBridgeApi;
    __LMS_STUDENT__: LmsStudentContext;
    __LMS_COURSEWARE__: LmsCoursewareContext;
  }
}
