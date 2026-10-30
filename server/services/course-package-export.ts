/**
 * 课程包导出服务 —— 把平台里已有的课程**逆向**打包成自包含的课程包 JSON。
 *
 * 导入服务（course-package-import.ts）把 `${asset:<id>}` 解析成本机 `/uploads/xxx`；
 * 导出则做相反的事：扫描课程正文与白板元素里引用的 `/uploads/xxx` 文件，
 * 读盘、base64 内联进 `assets[]`，再把 URL 替换回 `${asset:<id>}` 占位符。
 *
 * 这样导出的文件可以在任意实例上导入（不依赖导出方机器上的 uploads 目录），
 * 也就实现了教师之间的教案交换与个人备课备份。
 *
 * ## 导出结果必须能重新导入
 *
 * 导出不是「原样 dump 数据库」：`lessons.timeline` / `whiteboard_elements.data`
 * 里存在历史数据与渲染期字段（空字符串、null、缺失 id、重复 id、快照标记…），
 * 而导入端有严格的 zod 校验。因此这里做一次**规范化**：
 *
 * - 缺失 id 的环节补 `seg-<n>`，重复 id 加后缀并同步重映射元素的 segmentId；
 * - `null` 的可选字段直接省略；
 * - 快照标记（snapshot_marker）与导入端不认识的自定义元素类型不导出；
 * - 最后用 `parseCoursePackage` 自检 —— 导出的包必须能通过导入端的校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getUploadsDir } from '../utils/paths.js';
import { validateMagicBytes } from '../utils/upload.js';
import {
  COURSE_PACKAGE_FORMAT,
  COURSE_PACKAGE_VERSION,
  COURSE_PACKAGE_MAX_FILE_BYTES,
  isSupportedElementType,
  parseCoursePackage,
  type CoursePackage,
  type CoursePackageAsset,
  type CoursePackageElement,
  type CoursePackageSegment,
} from './course-package.js';
import { isTextAssetType, PACKAGE_ASSET_TYPES, type PackageAssetType } from './course-package-assets.js';

/** 导出失败的业务错误（路由据此返回对应的 HTTP 状态）。 */
export class CoursePackageExportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'COURSE_PACKAGE_EXPORT_FAILED') {
    super(message);
    this.name = 'CoursePackageExportError';
    this.status = status;
    this.code = code;
  }
}

/** 导出结果（stats 供路由/测试观察，不写进课程包）。 */
export interface ExportCoursePackageResult {
  package: CoursePackage;
  stats: {
    /** 内联进课程包的附件数。 */
    assets: number;
    /** 被跳过的引用（文件不存在 / 类型不支持 / 签名不符）。 */
    skipped: Array<{ url: string; reason: string }>;
    /** 因类型不受支持而未导出的白板元素数（快照标记不计入）。 */
    skippedElements: number;
  };
}

/** `/uploads/<文件名>` 引用 —— 允许带站点前缀（绝对 URL）与查询串（匹配到 `?` 为止）。 */
const UPLOAD_URL_PATTERN = /(?:https?:\/\/[A-Za-z0-9.:[\]_-]+)?\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/** 扩展名 → 课程包资产类型（与 PACKAGE_ASSET_TYPES 对齐，jpeg 归一为 jpg）。 */
const EXT_TO_ASSET_TYPE: Record<string, PackageAssetType> = {
  '.pdf': 'pdf',
  '.pptx': 'pptx',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.zip': 'zip',
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.md': 'md',
  '.txt': 'txt',
  '.csv': 'csv',
};

/** 课程行（只取导出需要的列）。 */
interface LessonRow {
  id: string;
  title: string;
  content: string | null;
  timeline: string | null;
  progress_mode: string | null;
  creator_id: string | null;
  source_package_id: string | null;
}

/** 白板元素行。 */
interface ElementRow {
  type: string;
  data: string;
}

/** 一个待内联的附件。 */
interface PendingAsset {
  id: string;
  filename: string;
  contentType: PackageAssetType;
  buffer: Buffer;
  /** 该文件在 /uploads 下的唯一文件名（去重键）。 */
  storedName: string;
}

/**
 * 导出指定课程为课程包。
 *
 * @param lessonId 课程 id
 * @param options.db 覆盖数据库连接（测试用）
 */
export async function exportLessonAsCoursePackage(
  lessonId: string,
  options: { db?: Database.Database } = {},
): Promise<ExportCoursePackageResult> {
  const db = options.db ?? kernelContainer.db;

  const lesson = db
    .prepare(
      'SELECT id, title, content, timeline, progress_mode, creator_id, source_package_id FROM lessons WHERE id = ?',
    )
    .get(lessonId) as LessonRow | undefined;
  if (!lesson) {
    throw new CoursePackageExportError('课程不存在或已被删除', 404, 'LESSON_NOT_FOUND');
  }

  // 快照标记不是教学内容，且导入端不认识这个类型 —— 不导出。
  const elementRows = db
    .prepare(
      "SELECT type, data FROM whiteboard_elements WHERE lesson_id = ? AND type != 'snapshot_marker' " +
        'ORDER BY created_at ASC, rowid ASC',
    )
    .all(lessonId) as ElementRow[];

  const rawTimeline = safeJsonParse(lesson.timeline);
  const { timeline, idRemap } = normalizeTimeline(rawTimeline);

  const stats: ExportCoursePackageResult['stats'] = { assets: 0, skipped: [], skippedElements: 0 };

  // ── 1. 白板元素：解析 JSON、收集 /uploads 引用 ─────────────────────────────
  const elements: CoursePackageElement[] = [];
  /** url → 元素里记录的原文件名（比 uploads 的随机文件名更友好）。 */
  const preferredFilenames = new Map<string, string>();

  for (const row of elementRows) {
    if (!isSupportedElementType(row.type)) {
      stats.skippedElements += 1;
      continue;
    }
    const data = safeJsonParse(row.data);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      stats.skippedElements += 1;
      continue;
    }
    const elementData = data as Record<string, unknown>;
    collectPreferredFilenames(elementData, preferredFilenames);
    elements.push({
      type: row.type,
      ...liftElementGeometry(elementData),
      data: elementData,
    });
  }

  // ── 2. 收集正文与元素里引用的 /uploads 文件 ────────────────────────────────
  const referenced = new Set<string>();
  collectUploadReferences(lesson.content ?? '', referenced);
  for (const element of elements) collectUploadReferences(element.data, referenced);

  // ── 3. 读盘 + 内联（base64），并记录可替换的占位符 ─────────────────────────
  const pending: PendingAsset[] = [];
  /** 存储文件名 → 占位符。 */
  const placeholderByStoredName = new Map<string, string>();
  let totalBytes = 0;
  const usedIds = new Set<string>();

  for (const storedName of referenced) {
    const ext = path.extname(storedName).toLowerCase();
    const contentType = EXT_TO_ASSET_TYPE[ext];
    if (!contentType || !(PACKAGE_ASSET_TYPES as readonly string[]).includes(contentType)) {
      stats.skipped.push({ url: `/uploads/${storedName}`, reason: `不支持的文件类型：${ext || '(无扩展名)'}` });
      continue;
    }

    const filePath = resolveUploadsPath(storedName);
    if (!filePath) {
      stats.skipped.push({ url: `/uploads/${storedName}`, reason: '文件不存在' });
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (err) {
      stats.skipped.push({ url: `/uploads/${storedName}`, reason: `读取失败：${(err as Error).message}` });
      continue;
    }
    if (buffer.length === 0) {
      stats.skipped.push({ url: `/uploads/${storedName}`, reason: '文件为空' });
      continue;
    }
    if (!isTextAssetType(contentType) && !validateMagicBytes(buffer, `asset.${contentType}`)) {
      stats.skipped.push({ url: `/uploads/${storedName}`, reason: '文件签名与扩展名不符' });
      continue;
    }
    if (isTextAssetType(contentType) && buffer.includes(0)) {
      stats.skipped.push({ url: `/uploads/${storedName}`, reason: '文本文件包含二进制内容' });
      continue;
    }

    totalBytes += buffer.length;
    if (totalBytes > COURSE_PACKAGE_MAX_FILE_BYTES) {
      throw new CoursePackageExportError(
        `课程引用的附件合计超过 ${COURSE_PACKAGE_MAX_FILE_BYTES / (1024 * 1024)}MB，` +
          '导出后无法再被导入。请精简教案中的大文件后重试。',
        413,
        'COURSE_PACKAGE_EXPORT_TOO_LARGE',
      );
    }

    const assetId = buildAssetId(storedName, usedIds);
    pending.push({
      id: assetId,
      filename: preferredFilenames.get(storedName) || storedName,
      contentType,
      buffer,
      storedName,
    });
    placeholderByStoredName.set(storedName, `\${asset:${assetId}}`);
  }

  // ── 4. 把引用替换为占位符 ──────────────────────────────────────────────────
  const content = replaceUploadReferences(lesson.content ?? '', placeholderByStoredName) as string;
  const validSegmentIds = new Set(timeline.map((segment) => segment.id));
  const resolvedElements = elements.map((element) => {
    const { segmentId: rawSegmentId, ...rest } = element;
    // 环节 id 可能被规范化重命名；指向不存在环节的元素会挂到任何环节都不可见，
    // 且导出包无法通过导入端校验 —— 这类引用直接丢弃。
    const segmentId = rawSegmentId ? (idRemap.get(rawSegmentId) ?? rawSegmentId) : undefined;
    return {
      ...rest,
      ...(segmentId && validSegmentIds.has(segmentId) ? { segmentId } : {}),
      data: replaceUploadReferences(element.data, placeholderByStoredName) as Record<string, unknown>,
    };
  });

  const assets: CoursePackageAsset[] = pending.map((asset) => ({
    id: asset.id,
    filename: asset.filename,
    contentType: asset.contentType,
    base64: asset.buffer.toString('base64'),
  }));
  stats.assets = assets.length;

  const pkg: CoursePackage = {
    format: COURSE_PACKAGE_FORMAT,
    version: COURSE_PACKAGE_VERSION,
    meta: {
      // 从课程包导入来的课程沿用原包身份；自行创建的课程用 lesson id ——
      // 改了标题再导出，身份不变（导入端去重仍然认得「同一个包」）。
      id: lesson.source_package_id || lesson.id,
      name: lesson.title,
      description: `由 OpenLearn 课程「${lesson.title}」导出：包含教学环节、白板元素与 ${assets.length} 个内联附件。`,
      author: lesson.creator_id ?? '',
      tags: ['导出', '课程包'],
    },
    lesson: {
      title: lesson.title,
      content,
      progressMode: lesson.progress_mode || 'manual',
      timeline,
    },
    assets,
    elements: resolvedElements,
  };

  // 自检：导出的包必须能通过导入端的校验，否则教师拿到的是一个导不回去的文件。
  const parsed = parseCoursePackage(pkg);
  if (!parsed.ok) {
    throw new CoursePackageExportError(`导出的课程包未通过结构校验：${parsed.error}`, 500, 'EXPORT_INVALID_PACKAGE');
  }

  return { package: parsed.package, stats };
}

/** 把课程标题转成安全的下载文件名（保留中文，去掉路径/控制字符）。 */
export function buildExportFilename(title: string): string {
  const safe = Array.from(title)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${safe || 'course'}.openlearn-package.json`;
}

/** 递归收集字符串中的 `/uploads/<文件名>` 引用。 */
function collectUploadReferences(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(UPLOAD_URL_PATTERN)) {
      out.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUploadReferences(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectUploadReferences(item, out);
  }
}

/** 递归替换 `/uploads/<文件名>` 引用为占位符；未内联的引用保持原样。 */
function replaceUploadReferences(value: unknown, placeholders: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(UPLOAD_URL_PATTERN, (match, storedName: string) => placeholders.get(storedName) ?? match);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceUploadReferences(item, placeholders));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = replaceUploadReferences(item, placeholders);
    }
    return out;
  }
  return value;
}

/**
 * 从元素数据里收集 `fileUrl` + `fileName` 配对。
 *
 * uploads 目录里的文件名是「时间戳-随机串.ext」，直接写进课程包会让教师
 * 看到一串无意义的字符；「课件演示」元素本身记录了原文件名，优先采用它。
 */
function collectPreferredFilenames(value: unknown, out: Map<string, string>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectPreferredFilenames(item, out);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.fileUrl === 'string' && typeof obj.fileName === 'string' && obj.fileName.trim()) {
    for (const match of obj.fileUrl.matchAll(UPLOAD_URL_PATTERN)) {
      if (!out.has(match[1])) out.set(match[1], obj.fileName.trim());
    }
  }
  for (const item of Object.values(obj)) collectPreferredFilenames(item, out);
}

/**
 * 把元素 data 里的坐标/分页字段提升为课程包的顶层字段（导入端会重新合回 data）。
 *
 * 提升后从 data 里删除，避免导出包出现两份同名字段 —— 其中一份还可能是
 * 被重命名过的旧环节 id。
 */
function liftElementGeometry(data: Record<string, unknown>): Partial<CoursePackageElement> {
  const lifted: Partial<CoursePackageElement> = {};
  const take = (key: string): unknown => {
    const value = data[key];
    delete data[key];
    return value;
  };

  const segmentId = take('segmentId');
  if (typeof segmentId === 'string' && segmentId) lifted.segmentId = segmentId;
  const page = take('page');
  if (typeof page === 'number' && Number.isInteger(page) && page >= 0) lifted.page = page;
  const pageId = take('pageId');
  if (typeof pageId === 'string' && pageId) lifted.pageId = pageId;
  const x = take('x');
  if (typeof x === 'number' && Number.isFinite(x)) lifted.x = x;
  const y = take('y');
  if (typeof y === 'number' && Number.isFinite(y)) lifted.y = y;
  const width = take('width');
  if (typeof width === 'number' && width > 0) lifted.width = width;
  const height = take('height');
  if (typeof height === 'number' && height > 0) lifted.height = height;
  return lifted;
}

/**
 * 规范化教学环节。
 *
 * 返回重映射表：重复 / 缺失的环节 id 在导出时被改写，白板元素里的
 * `segmentId` 必须同步跟上，否则元素会挂到一个不存在的环节上。
 */
function normalizeTimeline(raw: unknown): { timeline: CoursePackageSegment[]; idRemap: Map<string, string> } {
  const idRemap = new Map<string, string>();
  if (!Array.isArray(raw)) return { timeline: [], idRemap };

  const timeline: CoursePackageSegment[] = [];
  const seen = new Set<string>();

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const source = item as Record<string, unknown>;

    const originalId = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : '';
    let id = originalId || `seg-${index + 1}`;
    if (seen.has(id)) {
      let suffix = 2;
      while (seen.has(`${id}-${suffix}`)) suffix += 1;
      id = `${id}-${suffix}`;
    }
    if (originalId && originalId !== id) idRemap.set(originalId, id);
    seen.add(id);

    const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : `环节 ${index + 1}`;
    const type = typeof source.type === 'string' && source.type.trim() ? source.type.trim() : 'lecture';

    const segment: CoursePackageSegment = { id, title, type };
    if (typeof source.duration === 'string' && source.duration.trim()) segment.duration = source.duration.trim();
    if (typeof source.notes === 'string') segment.notes = source.notes;
    if (typeof source.color === 'string' && source.color.trim()) segment.color = source.color.trim();

    if (Array.isArray(source.gates)) {
      const gates = source.gates.filter(
        (gate): gate is { id?: string; type: string; params?: Record<string, unknown> } =>
          Boolean(gate) && typeof gate === 'object' && typeof (gate as Record<string, unknown>).type === 'string',
      );
      if (gates.length > 0) segment.gates = gates;
    }

    timeline.push(segment);
  });

  return { timeline, idRemap };
}

/** 在 /uploads 目录内解析文件路径 —— 只接受纯文件名，挡掉路径穿越。 */
function resolveUploadsPath(storedName: string): string | null {
  const uploadsDir = path.resolve(getUploadsDir());
  if (path.basename(storedName) !== storedName) return null;
  const target = path.resolve(uploadsDir, storedName);
  if (path.dirname(target) !== uploadsDir) return null;
  try {
    const stat = fs.statSync(target);
    return stat.isFile() ? target : null;
  } catch {
    return null;
  }
}

/** 生成稳定、符合占位符语法的资产 id（文件名本身唯一，取哈希即可）。 */
function buildAssetId(storedName: string, used: Set<string>): string {
  const digest = createHash('sha1').update(storedName).digest('hex').slice(0, 12);
  let id = `asset-${digest}`;
  let suffix = 2;
  while (used.has(id)) {
    id = `asset-${digest}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function safeJsonParse(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
