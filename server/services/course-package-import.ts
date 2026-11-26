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
import crypto from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getUploadsDir } from '../utils/paths.js';
import { getFileStorageService } from './file-storage/index.js';
import {
  ASSET_PLACEHOLDER_PATTERN,
  materializePackageAssets,
  resolveAssetPlaceholders,
  isEmbeddableAssetType,
  type MaterializedAsset,
} from './course-package-assets.js';
import { resolveCoursePackageIdentity, type CoursePackageIdentity } from './course-package-identity.js';
import {
  isSupportedElementType,
  type CoursePackage,
  type CoursePackageActivity,
  type CoursePackageBlock,
} from './course-package.js';
import { upsertLearningSurface, validateLearningContentRef } from './learning-surface-service.js';
import { xueanActivityTypeForSegment } from '../../packages/core/plugin-host/course-delivery-mode.js';
import { BUILTIN_XUEAN_MODE_PACK_ID } from '../../packages/core/plugin-host/mode-pack.js';

/** 导入结果摘要（回给前端展示）。 */
export interface ImportCoursePackageResult {
  lessonId: string;
  title: string;
  /** 落库的交付模式（`whiteboard` / `xuean`）。 */
  deliveryMode: string;
  /** 写入的教学环节数。 */
  segments: number;
  /** 写入的白板元素数。 */
  elements: number;
  /** 写入的学案活动数。 */
  activities: number;
  /** 写入的学案首页块数。 */
  blocks: number;
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

/** 与 CoursewareService.saveInlineCourseware 相同的命名 / 去重规则（导入事务内直接写）。 */
function saveInlineHtml(db: Database.Database, code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
  const id = `inline-${hash}`;
  db.prepare('INSERT OR IGNORE INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    'index.html',
    'html',
    code,
    Date.now(),
  );
  return id;
}

/**
 * 课程包里的 `html-applet` 元素在导入时直接落成 `learning_surface` 元素 + Surface。
 *
 * 包格式 v2 直接携带 contentRef；v1 的 `html-applet` 仍按内容引用转换，
 * 保证旧课程包继续可导入。
 */
function toLearningSurfaceElement(
  db: Database.Database,
  lessonId: string,
  element: { type: string; data: string },
): { id: string; type: string; data: string } {
  const elementId = uuidv7();

  // 包格式 v2：原生 Surface，data.contentRef → 新建 Surface（surfaceId 不可跨环境复用）。
  if (element.type === 'learning_surface') {
    let raw: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(element.data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { id: elementId, type: element.type, data: element.data };
      }
      raw = parsed as Record<string, unknown>;
    } catch {
      return { id: elementId, type: element.type, data: element.data };
    }

    const contentRef = validateLearningContentRef(raw.contentRef);
    if (!contentRef.ok) {
      return { id: elementId, type: element.type, data: element.data };
    }
    const result = upsertLearningSurface(db, {
      lessonId,
      kind: 'whiteboard_element',
      ownerId: elementId,
      contentRef: contentRef.value,
    });
    if (!result.ok) {
      return { id: elementId, type: element.type, data: element.data };
    }
    const next: Record<string, unknown> = { ...raw, surfaceId: result.surface.id };
    delete next.contentRef;
    return { id: elementId, type: 'learning_surface', data: JSON.stringify(next) };
  }

  if (element.type !== 'html-applet') {
    return { id: elementId, type: element.type, data: element.data };
  }

  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(element.data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { id: elementId, type: element.type, data: element.data };
    }
    raw = parsed as Record<string, unknown>;
  } catch {
    return { id: elementId, type: element.type, data: element.data };
  }

  const coursewareUuid = typeof raw.coursewareUuid === 'string' ? raw.coursewareUuid : null;
  const resourceId = typeof raw.resourceId === 'string' ? raw.resourceId : null;
  const inlineId = !coursewareUuid && !resourceId && typeof raw.code === 'string' ? saveInlineHtml(db, raw.code) : null;

  const sourceKind = resourceId ? 'resource' : 'courseware';
  const sourceId = coursewareUuid ?? resourceId ?? inlineId;
  if (!sourceId) {
    return { id: elementId, type: element.type, data: element.data };
  }

  const result = upsertLearningSurface(db, {
    lessonId,
    kind: 'whiteboard_element',
    ownerId: elementId,
    contentRef: {
      rendererId: 'html_courseware',
      source: { kind: sourceKind, id: sourceId },
      ...(typeof raw.title === 'string' && raw.title ? { config: { title: raw.title } } : {}),
    },
  });
  if (!result.ok) {
    return { id: elementId, type: element.type, data: element.data };
  }

  const next: Record<string, unknown> = { ...raw, surfaceId: result.surface.id };
  delete next.coursewareUuid;
  delete next.resourceId;
  delete next.code;
  delete next.sourceType;
  delete next.sourceId;
  return { id: elementId, type: 'learning_surface', data: JSON.stringify(next) };
}

/**
 * 课程包里的学案活动。
 *
 * 包内显式声明 `lesson.activities` 时原样使用；学案包缺省时按 timeline 自动生成
 * （`xuean:preview` → 阅读、`xuean` → 作品提交、`xuean:drill` → 测验），
 * 与课程向导「环节即活动」的行为一致 —— 否则导入得到的是一节没有任何活动的空学案。
 *
 * 自动生成时把课程正文塞进阅读活动：学案学生端不渲染 `lessons.content`，
 * 不这么做的话「CSV / 精简课程包只有正文」会变成一节学生什么都看不到的课。
 */
function resolvePackageActivities(pkg: CoursePackage): CoursePackageActivity[] {
  if (pkg.lesson.activities.length > 0) return pkg.lesson.activities;
  if (pkg.lesson.deliveryMode !== 'xuean') return [];
  const content = (pkg.lesson.content ?? '').trim();
  return pkg.lesson.timeline.map((segment) => {
    const type = xueanActivityTypeForSegment(segment.type);
    if (type === 'reading' && content) {
      return { type, title: segment.title, config: { content } };
    }
    if (type === 'submission') {
      return { type, title: segment.title, config: { acceptText: true, acceptLink: true } };
    }
    return { type, title: segment.title };
  });
}

/**
 * 学案首页块的内容约束。
 *
 * 与 `/api/lessons/:lessonId/blocks` 的 `parseBlock` 保持同一口径 —— 课程包导入
 * 是另一条写库通道，不能因为它绕过了路由校验就放宽约束：`backgroundImage`
 * 只接受本实例的上传文件 URL，`intro` 截断到 2000 字符。
 */
function normalizeBlockContent(
  blockType: string,
  content: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (blockType !== 'xuean_home') return content;
  const raw = content ?? {};
  const intro = typeof raw.intro === 'string' ? raw.intro.trim().slice(0, 2000) : '';
  const rawBackground = typeof raw.backgroundImage === 'string' ? raw.backgroundImage.trim() : '';
  const backgroundImage = /^(\/api\/files\/|\/uploads\/)/.test(rawBackground) ? rawBackground.slice(0, 500) : '';
  return { intro, backgroundImage };
}

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

  const deliveryMode = pkg.lesson.deliveryMode ?? 'whiteboard';
  // 学案课缺省绑定内置学案包，保证 `mode_pack_id` 优先读取时仍走学案工作区；
  // 白板课保持 NULL（旧课兼容），除非课程包显式声明了模式包。
  const modePackId = pkg.lesson.modePackId ?? (deliveryMode === 'xuean' ? BUILTIN_XUEAN_MODE_PACK_ID : null);

  const insertLesson = db.prepare(
    'INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at, ' +
      'source_package_key, source_package_hash, source_package_id, delivery_mode, mode_pack_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertElement = db.prepare(
    'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertActivity = db.prepare(
    'INSERT INTO lesson_activities ' +
      '(id, lesson_id, order_index, type, title, config_json, required, visible, peer_review, ' +
      'group_mode, submission_type, rubric_json, release_at, due_at, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertBlock = db.prepare(
    'INSERT INTO lesson_activity_blocks (id, lesson_id, block_type, order_index, content_json, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  // 活动 / 首页块在 `try` 内组装：`config` 里的 `${asset:<id>}` 占位符
  // 与元素、正文走同一套解析，引用缺失资产时同样整体失败并清理已落盘文件。
  let activities: CoursePackageActivity[] = [];
  let blocks: CoursePackageBlock[] = [];

  let elements: Array<{ type: string; data: string }> = [];
  try {
    // ── 3. 组装白板元素 ───────────────────────────────────────────────────
    elements = pkg.elements.map((element) => {
      if (!isSupportedElementType(element.type)) {
        throw new Error(`课程包包含不支持的白板元素类型：${element.type}`);
      }
      const data = resolveAssetPlaceholders(element.data, materialized) as Record<string, unknown>;

      // ── 非可内联渲染的附件：把「课件演示」元素降级成下载卡片 ──────────────
      //
      // 课程包现在可以带 docx/xlsx/zip/png/md… 这类没有内联渲染器的附件
      // （审计最后一项：白板元素侧缺少对任意文件的引用机制）。
      // 元素里存的仍是占位符解析后的真实 `/uploads/...`，但 `fileType` 必须
      // 从「pdf/pptx」改成 `file` —— 否则渲染器会拿 zip 的字节去喂 PowerPointViewer，
      // 表现为「一直解析中」而不是一张可下载的卡片。
      if (element.type === 'presentation' && typeof data.fileUrl === 'string') {
        const referenced = findReferencedAsset(element.data, materialized);
        if (referenced && !isEmbeddableAssetType(referenced.fileType)) {
          data.fileType = 'file';
          data.fileName = referenced.fileName;
          data.slideCount = 0;
        }
      }
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
    //
    // 课程正文（Markdown 大纲）里的 `${asset:<id>}` 同样要解析成落盘后的 URL ——
    // 教师可以在大纲里写 `![示意图](${asset:img-1})` 或 `[参考讲义](${asset:doc-1})`。
    // 此前这里直接写入原始占位符，导入后图片与下载链接都是坏的。
    const lessonContent = resolveAssetPlaceholders(pkg.lesson.content ?? '', materialized) as string;

    // 学案活动 / 首页块：与正文、元素一样解析 `${asset:<id>}`（阅读材料里的
    // 图片、首页背景图都可能是内嵌附件），再按块类型收敛首页块内容。
    activities = resolvePackageActivities(pkg).map((activity) => {
      const next: CoursePackageActivity = { ...activity };
      if (activity.config) {
        next.config = resolveAssetPlaceholders(activity.config, materialized) as Record<string, unknown>;
      }
      if (activity.rubric) {
        next.rubric = resolveAssetPlaceholders(activity.rubric, materialized) as Record<string, unknown>;
      }
      return next;
    });
    blocks = (pkg.lesson.blocks ?? []).map((block) => {
      const content = block.content
        ? (resolveAssetPlaceholders(block.content, materialized) as Record<string, unknown>)
        : undefined;
      const normalized = normalizeBlockContent(block.blockType, content);
      return { blockType: block.blockType, ...(normalized ? { content: normalized } : {}) };
    });

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
        lessonContent,
        JSON.stringify(timeline),
        pkg.lesson.progressMode ?? 'manual',
        creatorId,
        now,
        now,
        identity.key,
        identity.hash,
        identity.packageId,
        deliveryMode,
        modePackId,
      );
      for (const element of elements) {
        const converted = toLearningSurfaceElement(db, lessonId, element);
        insertElement.run(converted.id, lessonId, converted.type, converted.data, now);
      }
      activities.forEach((activity, index) => {
        insertActivity.run(
          uuidv7(),
          lessonId,
          index,
          activity.type,
          activity.title,
          activity.config === undefined ? null : JSON.stringify(activity.config),
          activity.required === false ? 0 : 1,
          activity.visible === false ? 0 : 1,
          activity.peerReview ? 1 : 0,
          activity.groupMode ?? 'none',
          activity.submissionType ?? null,
          activity.rubric === undefined ? null : JSON.stringify(activity.rubric),
          activity.releaseAt ?? null,
          activity.dueAt ?? null,
          now,
          now,
        );
      });
      blocks.forEach((block, index) => {
        insertBlock.run(uuidv7(), lessonId, block.blockType, index, JSON.stringify(block.content ?? {}), now, now);
      });
    });

    write();
  } catch (err) {
    // 事务内命中去重：原样抛出，保留 409 状态码与 code（外层 catch 会把它
    // 包成普通 Error，丢掉 409 → 前端就分不出「重复」与「写入失败」）。
    if (err instanceof CoursePackageDuplicateError) {
      await cleanupMaterializedAssets(materialized);
      throw err;
    }
    // 数据库回滚了（或根本没开始写），但文件已经落盘 —— 显式清理，
    // 避免留下孤儿文件。
    await cleanupMaterializedAssets(materialized);
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
    deliveryMode,
    segments: timeline.length,
    elements: elements.length,
    activities: activities.length,
    blocks: blocks.length,
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
    .prepare('SELECT id, title, created_at FROM lessons ' + 'WHERE creator_id = ? AND source_package_key = ? LIMIT 1')
    .get(creatorId, identity.key) as { id: string; title: string; created_at: number } | undefined;
  return row ?? null;
}

/**
 * 从元素原始数据里找出它引用的课程包资产。
 *
 * 元素数据里存的是 `${asset:<id>}` 占位符，解析后就只剩 URL 了 —— 而我们需要
 * 「这个 URL 对应的资产类型是否能内联渲染」。这里按占位符回查，避免再去比对 URL。
 */
function findReferencedAsset(rawData: unknown, assets: Map<string, MaterializedAsset>): MaterializedAsset | null {
  const seen = new Set<string>();
  const walk = (value: unknown): MaterializedAsset | null => {
    if (typeof value === 'string') {
      ASSET_PLACEHOLDER_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ASSET_PLACEHOLDER_PATTERN.exec(value)) !== null) {
        const id = match[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const asset = assets.get(id);
        if (asset) return asset;
      }
      return null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }
    return null;
  };
  return walk(rawData);
}

/** 删除已落盘的附件文件（导入失败时的补偿动作）。 */
async function cleanupMaterializedAssets(materialized: Map<string, MaterializedAsset>): Promise<void> {
  const uploadsDir = getUploadsDir();
  const fileStorage = getFileStorageService();
  for (const asset of materialized.values()) {
    if (asset.assetId) {
      try {
        await fileStorage.purgeAsset(asset.assetId);
      } catch (err) {
        console.warn(`[course-package] 清理孤儿资产失败：${asset.assetId}`, (err as Error).message);
      }
      continue;
    }
    if (asset.fileUrl.startsWith('/uploads/')) {
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
}
