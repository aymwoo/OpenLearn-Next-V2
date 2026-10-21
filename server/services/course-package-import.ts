/**
 * 课程包导入服务 —— 把一个课程包**整体**写成一节课程。
 *
 * ## 为什么要单开一个导入通道
 *
 * 现有的 CSV 批量导入（`src/services/bulkImportService.ts` → `POST /api/lessons`）
 * 只写 `lessons` 一张表的两列，而且逐条独立提交：中途失败会留下半截数据，
 * 也没有任何回滚（详见 `docs/audit/course-import-audit.md`）。
 *
 * 课程包导入把三件事放进**同一个事务**：
 *
 * 1. `lessons`             —— 课程本体 + 教学环节（timeline）
 * 2. `whiteboard_elements` —— 预设组件（演示文稿 / 测验 / 代码沙箱 / …）
 *
 * 课件附件（PDF / PPTX）不建库表，而是落盘到 `uploads/` 目录、再把真实 URL
 * 写进元素的 `data.fileUrl` —— 与教师在白板上传课件（`POST /api/upload`）
 * 走的是同一套存储约定，前端复用同一条加载路径。
 *
 * 任一步失败 → 整体回滚，数据库回到导入前的样子。
 *
 * 附件的**文件写入**发生在事务之外（文件系统不参与 SQLite 事务），
 * 因此失败时需要显式清理已落盘的文件，避免留下孤儿文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getUploadsDir } from '../utils/paths.js';
import { materializePackageAssets, resolveAssetPlaceholders, type MaterializedAsset } from './course-package-assets.js';
import type { CoursePackage } from './course-package.js';

/** 导入结果摘要（回给前端展示）。 */
export interface ImportCoursePackageResult {
  lessonId: string;
  title: string;
  /** 写入的教学环节数。 */
  segments: number;
  /** 写入的白板元素数。 */
  elements: number;
  /** 落盘的附件数。 */
  assets: number;
  /** 落盘附件的明细（文件名 + URL），供教师核对。 */
  assetFiles: Array<{ filename: string; fileUrl: string; fileType: string; slideCount: number }>;
}

/** 课程包元素类型白名单 —— 与 whiteboard.draw 的 KNOWN_ELEMENT_TYPES 对齐。 */
const KNOWN_ELEMENT_TYPES = new Set([
  'pen',
  'highlighter',
  'rectangle',
  'circle',
  'text',
  'quiz',
  'rollcall',
  'timer',
  'assignment',
  'hello-world',
  'html-applet',
  'code-sandbox',
  'math-graph',
  'presentation',
  'plugin',
  'page_meta',
]);

/**
 * 导入一个课程包。
 *
 * @param pkg 已通过 `parseCoursePackage` 校验的课程包
 * @param creatorId 创建者 id（写入 `lessons.creator_id`）
 */
export async function importCoursePackage(
  pkg: CoursePackage,
  options: { creatorId: string; db?: Database.Database },
): Promise<ImportCoursePackageResult> {
  const db = options.db ?? kernelContainer.db;
  const creatorId = options.creatorId || 'teacher';
  const now = Date.now();
  const lessonId = uuidv7();

  // ── 1. 附件落盘（在事务之外，失败需回滚文件）─────────────────────────────
  let materialized: Map<string, MaterializedAsset>;
  try {
    materialized = await materializePackageAssets(pkg.assets);
  } catch (err) {
    throw new Error(`课程包附件落盘失败：${(err as Error).message}`);
  }

  // ── 2. 组装待写入数据 ────────────────────────────────────────────────────
  const timeline = pkg.lesson.timeline.map((segment) => ({
    id: segment.id,
    title: segment.title,
    type: segment.type,
    duration: segment.duration ?? null,
    notes: segment.notes ?? '',
    color: segment.color ?? null,
    ...(segment.gates ? { gates: segment.gates } : {}),
  }));

  const insertLesson = db.prepare(
    'INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertElement = db.prepare(
    'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
  );

  let elements: Array<{ type: string; data: string }> = [];
  try {
    // ── 3. 组装白板元素 ───────────────────────────────────────────────────
    elements = pkg.elements.map((element) => {
      if (!KNOWN_ELEMENT_TYPES.has(element.type)) {
        throw new Error(`课程包包含不支持的白板元素类型：${element.type}`);
      }
      const data = resolveAssetPlaceholders(element.data, materialized) as Record<string, unknown>;
      // 定位与分页信息统一写进 data（与 whiteboard.draw 的补齐逻辑一致）
      if (element.x !== undefined) data.x = element.x;
      if (element.y !== undefined) data.y = element.y;
      if (element.width !== undefined) data.width = element.width;
      if (element.height !== undefined) data.height = element.height;
      if (element.segmentId !== undefined) data.segmentId = element.segmentId;
      if (element.pageId !== undefined) data.pageId = element.pageId;
      if (element.page !== undefined) data.page = element.page;
      if (data.page === undefined && data.pageId === undefined) data.page = 0;
      return { type: element.type, data: JSON.stringify(data) };
    });

    // ── 4. 单事务写入 ─────────────────────────────────────────────────────
    const write = db.transaction(() => {
      insertLesson.run(
        lessonId,
        pkg.lesson.title,
        pkg.lesson.content ?? '',
        JSON.stringify(timeline),
        pkg.lesson.progressMode ?? 'manual',
        creatorId,
        now,
        now,
      );
      for (const element of elements) {
        insertElement.run(uuidv7(), lessonId, element.type, element.data, now);
      }
    });

    write();
  } catch (err) {
    // 数据库回滚了（或根本没开始写），但文件已经落盘 —— 显式清理，
    // 避免 uploads 目录留下孤儿文件。
    cleanupMaterializedAssets(materialized);
    throw new Error(`课程包写入失败，已回滚：${(err as Error).message}`);
  }

  // ── 5. 广播课程创建事件（与 lesson.create 保持一致）──────────────────────
  try {
    await kernelContainer.eventBus.publish({
      id: uuidv7(),
      type: 'lesson.created',
      source: 'builtin.course_package',
      payload: {
        id: lessonId,
        title: pkg.lesson.title,
        creatorId,
        source: 'course-package',
        segments: timeline.length,
        elements: elements.length,
      },
      timestamp: now,
      correlationId: lessonId,
    });
  } catch (err) {
    // 事件广播失败不应让已经落库的导入变成失败 —— 记录告警即可。
    console.warn('[course-package] lesson.created 事件广播失败（已忽略）:', (err as Error).message);
  }

  return {
    lessonId,
    title: pkg.lesson.title,
    segments: timeline.length,
    elements: elements.length,
    assets: materialized.size,
    assetFiles: Array.from(materialized.values()).map((asset) => ({
      filename: asset.fileName,
      fileUrl: asset.fileUrl,
      fileType: asset.fileType,
      slideCount: asset.slideCount,
    })),
  };
}

/** 删除已落盘的附件文件（导入失败时的补偿动作）。 */
function cleanupMaterializedAssets(materialized: Map<string, MaterializedAsset>): void {
  const uploadsDir = getUploadsDir();
  for (const asset of materialized.values()) {
    const fileName = path.basename(asset.fileUrl);
    const target = path.join(uploadsDir, fileName);
    try {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    } catch (err) {
      console.warn(`[course-package] 清理孤儿附件失败：${target}`, (err as Error).message);
    }
  }
}
