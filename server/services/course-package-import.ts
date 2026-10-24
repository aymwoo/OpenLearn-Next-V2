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
import { resolveCoursePackageIdentity, type CoursePackageIdentity } from './course-package-identity.js';
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
  /** 本次导入的课程包去重键（落库到 lessons.source_package_key）。 */
  packageKey: string;
  /** 内容哈希（落库到 lessons.source_package_hash）。 */
  packageHash: string;
  /** 包声明的 meta.id（可空）。 */
  packageId: string | null;
  /**
   * 是否为「强制导入的副本」。
   *
   * 命中去重时若教师明确选择「仍然导入副本」，本次导入照常落库，
   * 但该标记为 true —— 前端据此告知「已导入过一份，这是第 N 份副本」。
   */
  duplicate: boolean;
}

/**
 * 命中去重时抛出的业务错误。
 *
 * 用 `status = 409` 而非 500：这是「请求与现状冲突」而非「服务器坏了」。
 * `sendSafeError` 会透传 4xx 的 status 与 code，前端据此渲染冲突提示。
 */
export class CoursePackageDuplicateError extends Error {
  readonly status = 409;
  readonly code = 'COURSE_PACKAGE_DUPLICATE';
  /** 已存在的课程 id。 */
  readonly existingLessonId: string;
  /** 已存在的课程标题。 */
  readonly existingLessonTitle: string;
  /** 已存在课程的创建时间（毫秒时间戳）。 */
  readonly existingCreatedAt: number;
  /** 命中的去重键。 */
  readonly packageKey: string;
  /** 包是否声明了 meta.id（决定提示文案）。 */
  readonly hasDeclaredId: boolean;

  constructor(params: {
    existingLessonId: string;
    existingLessonTitle: string;
    existingCreatedAt: number;
    packageKey: string;
    hasDeclaredId: boolean;
  }) {
    super(
      params.hasDeclaredId
        ? `该课程包（id=${params.packageKey.replace(/^id:/, '')}）已导入为课程「${params.existingLessonTitle}」，` +
            `重复导入会产生两节内容相同的课程`
        : `该课程包已导入为课程「${params.existingLessonTitle}」，重复导入会产生两节内容相同的课程`,
    );
    this.name = 'CoursePackageDuplicateError';
    this.existingLessonId = params.existingLessonId;
    this.existingLessonTitle = params.existingLessonTitle;
    this.existingCreatedAt = params.existingCreatedAt;
    this.packageKey = params.packageKey;
    this.hasDeclaredId = params.hasDeclaredId;
  }
}

/** 导入选项。 */
export interface ImportCoursePackageOptions {
  /** 创建者 id（写入 lessons.creator_id，同时作为去重作用域）。 */
  creatorId: string;
  /** 覆盖数据库连接（测试用）。 */
  db?: Database.Database;
  /**
   * 强制导入：命中去重时不再报错，照常落库一份副本。
   *
   * 这是「幂等」的另一半 —— 幂等意味着**默认**不会产生重复，
   * 但教师有时确实想导两份（比如两个班各上一门），此时需要一个显式出口，
   * 而不是让幂等变成无法绕过的墙。
   */
  allowDuplicate?: boolean;
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
 * @param options 创建者 id（写入 `lessons.creator_id`，同时是去重作用域）、强制导入开关
 */
export async function importCoursePackage(
  pkg: CoursePackage,
  options: ImportCoursePackageOptions,
): Promise<ImportCoursePackageResult> {
  const db = options.db ?? kernelContainer.db;
  const creatorId = options.creatorId || 'teacher';
  const allowDuplicate = options.allowDuplicate === true;
  const now = Date.now();
  const lessonId = uuidv7();

  // ── 0. 幂等检查（G-06）：同一创建者已导入过同一个包 → 409 ──────────────────
  //
  // 放在附件落盘**之前**：命中重复时不应该先写一堆附件文件再回滚。
  //
  // 作用域是 creator_id：内置模板要能被每位教师各导一份，所以不做全局去重。
  const identity = resolveCoursePackageIdentity(pkg);
  const duplicateOf = findExistingImport(db, creatorId, identity);
  if (duplicateOf && !allowDuplicate) {
    throw new CoursePackageDuplicateError({
      existingLessonId: duplicateOf.id,
      existingLessonTitle: duplicateOf.title,
      existingCreatedAt: duplicateOf.created_at,
      packageKey: identity.key,
      hasDeclaredId: identity.hasDeclaredId,
    });
  }

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
    'INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at, ' +
      'source_package_key, source_package_hash, source_package_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
      // 事务内再查一次：前面的预检查与真正写入之间存在时间窗口，
      // 两个并发导入可能都通过了预检查。事务内这次才是权威判定。
      // （预检查的价值在于「命中重复时不白写一份附件文件」。）
      const inTxDuplicate = findExistingImport(db, creatorId, identity);
      if (inTxDuplicate && !allowDuplicate) {
        throw new CoursePackageDuplicateError({
          existingLessonId: inTxDuplicate.id,
          existingLessonTitle: inTxDuplicate.title,
          existingCreatedAt: inTxDuplicate.created_at,
          packageKey: identity.key,
          hasDeclaredId: identity.hasDeclaredId,
        });
      }

      insertLesson.run(
        lessonId,
        pkg.lesson.title,
        pkg.lesson.content ?? '',
        JSON.stringify(timeline),
        pkg.lesson.progressMode ?? 'manual',
        creatorId,
        now,
        now,
        identity.key,
        identity.hash,
        identity.packageId,
      );
      for (const element of elements) {
        insertElement.run(uuidv7(), lessonId, element.type, element.data, now);
      }
    });

    write();
  } catch (err) {
    // 事务内命中去重：原样抛出，保留 409 状态码与 code（外层 catch 会把它
    // 包成普通 Error，丢掉 409 → 前端就分不出「重复」与「写入失败」）。
    if (err instanceof CoursePackageDuplicateError) {
      cleanupMaterializedAssets(materialized);
      throw err;
    }
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
    packageKey: identity.key,
    packageHash: identity.hash,
    packageId: identity.packageId,
    duplicate: duplicateOf !== null,
  };
}

/**
 * 查同一创建者名下是否已导入过同一个课程包。
 *
 * 作用域限定 `creator_id`：内置课程模板要能被每位教师各导一份，
 * 若做全局去重，第二位教师就永远导不进模板。
 *
 * 键存在 `lessons` 行上 → 教师删课即释放该键，无需额外的清理链路。
 */
function findExistingImport(
  db: Database.Database,
  creatorId: string,
  identity: CoursePackageIdentity,
): { id: string; title: string; created_at: number } | null {
  const row = db
    .prepare(
      'SELECT id, title, created_at FROM lessons ' +
        'WHERE creator_id = ? AND source_package_key = ? LIMIT 1',
    )
    .get(creatorId, identity.key) as { id: string; title: string; created_at: number } | undefined;
  return row ?? null;
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
