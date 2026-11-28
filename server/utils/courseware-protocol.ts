/**
 * 课件协议解析（服务端）。
 *
 * 把「课件行 → 存储目录 → 协议」收敛成单一入口，供：
 * - `/runtime`、`/api/courseware/:id` 渲染时选择适配器；
 * - 提交/日志时把 `protocol` 写入 submission_result.extra_json；
 * - `courseware.list` 返回协议给前端展示。
 */
import path from 'path';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getStorageDir } from './paths.js';
import {
  normalizeCoursewareProtocol,
  toSubmissionProtocolSource,
  type CoursewareProtocol,
  type SubmissionProtocolSource,
} from '../../packages/courseware-adapters/index.js';
import { resolveProtocolForStorageDir } from '../../packages/courseware-adapters/node.js';

export interface CoursewareProtocolInfo {
  id: string;
  uuid: string;
  name?: string;
  type?: string | null;
}

/** 课件在磁盘上的存储根目录（ZIP 解包后相对 /runtime 的根）。 */
export function coursewareStorageDir(uuid: string): string {
  return path.resolve(getStorageDir(), 'courseware', uuid);
}

/** 解析课件协议：旁车优先 → 现场扫描清单 → html。 */
export function resolveCoursewareProtocol(courseware: CoursewareProtocolInfo): CoursewareProtocol {
  const uuid = courseware?.uuid || courseware?.id;
  if (!uuid) return 'html';
  return resolveProtocolForStorageDir(coursewareStorageDir(uuid));
}

/** 按课件 id / uuid 查库后解析协议；查不到按 html。 */
export function resolveCoursewareProtocolById(idOrUuid: string): CoursewareProtocol {
  if (!idOrUuid) return 'html';
  try {
    const row = kernelContainer.db
      .prepare('SELECT id, uuid, name, type FROM courseware WHERE id = ? OR uuid = ? LIMIT 1')
      .get(idOrUuid, idOrUuid) as CoursewareProtocolInfo | undefined;
    return row ? resolveCoursewareProtocol(row) : 'html';
  } catch {
    return 'html';
  }
}

/**
 * 把课件包协议翻译成「一条成绩样本的来源」。
 *
 * 普通 HTML 课件没有外部标准，样本只能来自官方 SDK / 监视器 / Hook，
 * 因此 default 回落 official-lms；具体来源可由上报 payload 的 `protocol` 覆盖。
 */
export function toSubmissionProtocol(
  coursewareProtocol: CoursewareProtocol,
  reportedProtocol?: unknown,
): SubmissionProtocolSource {
  return toSubmissionProtocolSource(normalizeCoursewareProtocol(coursewareProtocol), reportedProtocol);
}
