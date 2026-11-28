/**
 * 课件协议识别（纯函数）。
 *
 * 只在「上传/渲染」时读取包内清单文件，不解析课件运行时状态。
 * 识别优先级：H5P → xAPI → SCORM → 普通 HTML。
 * H5P 包通常也带 h5p.json 与 xAPI 语句，因此必须先于 xAPI 判定。
 */
import type {
  CoursewareProtocol,
  ManifestFileLike,
  ProtocolDetectionResult,
  SubmissionProtocolSource,
} from './types.js';

function normalizePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function baseName(value: string): string {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf('/');
  return (index >= 0 ? normalized.slice(index + 1) : normalized).toLowerCase();
}

/** 仅识别根目录或浅层目录里的清单文件，避免把子资源里的同名 JSON 误判。 */
function isShallow(path: string, maxDepth = 2): boolean {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  const depth = normalized.split('/').length - 1;
  return depth <= maxDepth;
}

/**
 * 从清单文件名（必要时含内容）识别协议。
 *
 * @example
 * detectProtocolFromManifestFiles([{ path: 'imsmanifest.xml', content: '<schemaversion>2004 4th Edition</schemaversion>' }])
 * // => { protocol: 'scorm-2004', evidence: ['imsmanifest.xml'] }
 */
export function detectProtocolFromManifestFiles(files: ManifestFileLike[]): ProtocolDetectionResult {
  const candidates = (Array.isArray(files) ? files : []).filter((file) => file && isShallow(file.path));

  const h5p = candidates.find((file) => baseName(file.path) === 'h5p.json');
  if (h5p) return { protocol: 'h5p', evidence: [normalizePath(h5p.path)] };

  const tinCan = candidates.find((file) => baseName(file.path) === 'tincan.xml');
  if (tinCan) return { protocol: 'xapi', evidence: [normalizePath(tinCan.path)] };

  const activity = candidates.find((file) => baseName(file.path) === 'activity.json');
  if (activity) return { protocol: 'xapi', evidence: [normalizePath(activity.path)] };

  const manifest = candidates.find((file) => baseName(file.path) === 'imsmanifest.xml');
  if (manifest) {
    return {
      protocol: detectScormVersion(manifest.content || ''),
      evidence: [normalizePath(manifest.path)],
    };
  }

  return { protocol: 'html', evidence: [] };
}

/**
 * 从 imsmanifest.xml 内容判定 SCORM 版本。
 *
 * 命中 2004 的典型标记：`<schemaversion>2004 ...`、`adlcp_v1p3`、`imsss`。
 * 其余（含 SCORM 1.2 的 `adlcp_rootv1p2`）一律按 1.2 处理。
 */
export function detectScormVersion(manifestContent: string): 'scorm-12' | 'scorm-2004' {
  const text = String(manifestContent || '').toLowerCase();
  if (!text) return 'scorm-12';
  const markers = ['<schemaversion>2004', '<schemaversion> 2004', 'adlcp_v1p3', 'imsss_v1p0', 'imsss'];
  for (const marker of markers) {
    if (text.includes(marker)) return 'scorm-2004';
  }
  return 'scorm-12';
}

/** 把外部/历史写入的协议标记收敛到受控枚举。 */
export function normalizeCoursewareProtocol(value: unknown): CoursewareProtocol {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === 'scorm-12' || text === 'scorm12' || text === 'scorm_1_2' || text === 'scorm1.2') return 'scorm-12';
  if (text === 'scorm-2004' || text === 'scorm2004' || text === 'scorm_2004' || text === 'scorm_2004_4th') {
    return 'scorm-2004';
  }
  if (text === 'xapi' || text === 'tincan' || text === 'tin-can') return 'xapi';
  if (text === 'h5p') return 'h5p';
  return 'html';
}

/** 该协议是否需要向课件注入适配器脚本。 */
export function needsProtocolAdapter(protocol: CoursewareProtocol): boolean {
  return protocol === 'scorm-12' || protocol === 'scorm-2004' || protocol === 'xapi' || protocol === 'h5p';
}

const SUBMISSION_PROTOCOLS: SubmissionProtocolSource[] = [
  'official-lms',
  'scorm-12',
  'scorm-2004',
  'xapi',
  'h5p',
  'watch',
  'hook',
  'dom-scrape',
  'unknown',
];

/**
 * 把「课件包协议」+「上报方自报协议」翻译成一条成绩样本的来源。
 *
 * 普通 HTML 没有外部标准，样本只能来自官方 SDK / 监视器 / Hook，
 * 因此缺省回落 official-lms；上报方显式给出的合法来源优先。
 */
export function toSubmissionProtocolSource(
  coursewareProtocol: CoursewareProtocol,
  reportedProtocol?: unknown,
): SubmissionProtocolSource {
  const reported = typeof reportedProtocol === 'string' ? reportedProtocol.trim().toLowerCase() : '';
  if (reported && (SUBMISSION_PROTOCOLS as string[]).includes(reported)) {
    return reported as SubmissionProtocolSource;
  }
  const normalized = normalizeCoursewareProtocol(coursewareProtocol);
  if (normalized === 'scorm-12') return 'scorm-12';
  if (normalized === 'scorm-2004') return 'scorm-2004';
  if (normalized === 'xapi') return 'xapi';
  if (normalized === 'h5p') return 'h5p';
  return 'official-lms';
}
