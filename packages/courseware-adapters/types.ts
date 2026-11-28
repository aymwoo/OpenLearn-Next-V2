/**
 * 互动课件协议适配器的共享类型。
 *
 * 这些类型是「课件协议」这件事的唯一事实源：上传识别、渲染注入、
 * 成绩来源标注都必须从这里取枚举，禁止在路由或插件里另写字符串。
 */

/** 课件包自身声明的协议（由清单文件识别，未命中即普通 HTML）。 */
export type CoursewareProtocol = 'html' | 'scorm-12' | 'scorm-2004' | 'xapi' | 'h5p';

/** 一条成绩样本的真实来源，写入 submission_result.extra_json.protocol。 */
export type SubmissionProtocolSource =
  'official-lms' | 'scorm-12' | 'scorm-2004' | 'xapi' | 'h5p' | 'watch' | 'hook' | 'dom-scrape' | 'unknown';

/** 需要注入到课件 iframe 内部的一段适配器脚本。 */
export interface CoursewareAdapterScript {
  /** owner 内的唯一 id，用于注释与排查 */
  id: string;
  /** 该脚本服务的课件协议 */
  protocol: CoursewareProtocol;
  /** head = 课件自身脚本之前执行；body-end = DOM 就绪后执行 */
  position: 'head' | 'body-end';
  /** 可直接拼进 <script> 的源码 */
  source: string;
}

/** 上传/渲染时用于识别的清单文件切片。 */
export interface ManifestFileLike {
  /** 相对课件根目录的路径，统一使用 / 分隔 */
  path: string;
  /** 文本内容；仅清单文件需要读取 */
  content?: string;
}

export interface ProtocolDetectionResult {
  protocol: CoursewareProtocol;
  /** 命中的清单文件相对路径，便于上传结果与日志解释 */
  evidence: string[];
}
