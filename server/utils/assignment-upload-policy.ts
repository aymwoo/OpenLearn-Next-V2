/**
 * 作业文件上传策略（单一事实来源）
 *
 * L2: 上传白名单 / 大小上限 / 配额等策略集中在此，供服务端路由与
 * 测试（含「前后端白名单同步守护」测试）共同引用，避免手抄漂移。
 * 前端 AssignmentSubmitDialog 的 ACCEPT_EXT 仍为静态副本（浏览器无法
 * import 服务端模块），由 server/__tests__ 的同步守护测试保证一致。
 */

/** 作业文件白名单：文档 / 表格 / 演示 / 图片 / 压缩包 / 纯文本与代码 */
export const ALLOWED_ASSIGNMENT_EXT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.rtf',
  '.odt',
  '.odp',
  '.ods',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.heic',
  '.zip',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sql',
  '.json',
  '.xml',
  '.html',
  '.css',
  '.ino',
]);

/** ZIP 容器族（magic bytes 为 PK\x03\x04），用于补强 .docx/.xlsx 等无独立签名的格式 */
export const ZIP_CONTAINER_EXT = new Set(['.zip', '.pptx', '.docx', '.xlsx', '.odt', '.odp', '.ods', '.epub']);

/** 单文件硬上限（宿主 express.raw 上限与之对齐） */
export const ASSIGNMENT_MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * M3: 单个学生在「全部作业」下的存储配额（软删除文件不计入）。
 * 防止单账号堆放海量附件拖垮磁盘；教师不受限（作业量由教师自控）。
 */
export const STUDENT_ASSIGNMENT_QUOTA_BYTES = 200 * 1024 * 1024;

/**
 * 解析 plugin_assignments.allowed_ext（逗号/分号分隔的扩展名列表）。
 * 空字符串 / 解析为空 → 未配置，回落全局白名单。
 * 返回值一律为小写（含前导点）。
 */
export function parseAllowedExt(raw: string | null | undefined): Set<string> | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const set = new Set(
    raw
      .split(/[,;，；\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && ALLOWED_ASSIGNMENT_EXT.has(e.startsWith('.') ? e : `.${e}`))
      .map((e) => (e.startsWith('.') ? e : `.${e}`)),
  );
  return set.size > 0 ? set : null;
}
