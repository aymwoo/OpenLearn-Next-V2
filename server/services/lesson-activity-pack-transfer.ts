/**
 * 学案包导入导出（Gitee IKVO15 P1）。
 *
 * 包内结构：manifest.json + activities.json + blocks.json + assets/<id>/<filename>。
 * 不导出学生进度或成绩。导入时重新生成活动 / 区块 ID，关联的测验 / 作业 /
 * 课件若在目标实例不存在则保留原 ID 并记入警告，避免误造成绩入口。
 */
import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import JSZip from 'jszip';
import {
  materializePackageAssets,
  resolveAssetPlaceholders,
  type PackageAssetType,
  PACKAGE_ASSET_TYPES,
} from './course-package-assets.js';
import { getUploadsDir } from '../utils/paths.js';
import { randomId } from '../utils/id.js';
import {
  LessonActivityError,
  LessonActivityService,
  type ActivityType,
  type CreateActivityInput,
  type LessonActivityBlockRecord,
  type LessonActivityRecord,
  type UnresolvedActivityBinding,
  isActivityType,
  isBlockType,
} from './lesson-activity-service.js';

export const ACTIVITY_PACK_FORMAT = 'openlearn.lesson-activity-pack';
export const ACTIVITY_PACK_VERSION = 1;
export const ACTIVITY_PACK_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ACTIVITY_PACK_IMPORT_PATH = '/api/lesson-activity-packs/import';
export const ACTIVITY_PACK_IMPORT_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

export interface ActivityPackManifest {
  format: typeof ACTIVITY_PACK_FORMAT;
  version: number;
  name: string;
  sourceLessonTitle: string;
  exportedAt: number;
  activityCount: number;
  blockCount: number;
  assetCount: number;
}

interface PackagedActivity {
  type: ActivityType;
  title: string;
  config: Record<string, unknown>;
  required: boolean;
  visible: boolean;
  peerReview: boolean;
  groupMode: boolean;
  submissionType: string | null;
  rubric: unknown;
  releaseAt: number | null;
  dueAt: number | null;
}

interface PackagedBlock {
  blockType: string;
  content: Record<string, unknown>;
}

interface PackagedAsset {
  id: string;
  filename: string;
  contentType: PackageAssetType;
  base64: string;
}

const UPLOAD_URL_PATTERN = /(?:https?:\/\/[A-Za-z0-9.:[\]_-]+)?\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export class LessonActivityPackTransferService {
  constructor(private readonly db: Database.Database) {}

  async exportPack(lessonId: string): Promise<{ filename: string; buffer: Buffer }> {
    const service = new LessonActivityService(this.db);
    const pack = service.getTeacherPack(lessonId);
    const lesson = this.db.prepare('SELECT title FROM lessons WHERE id = ?').get(lessonId) as
      { title: string } | undefined;
    if (!lesson) throw new LessonActivityError(404, 'Lesson not found');

    const usedAssets = new Map<string, PackagedAsset>();
    const activities = pack.activities.map((activity) => ({
      type: activity.type,
      title: activity.title,
      config: this.replaceUploadsWithPlaceholders(activity.config, usedAssets) as Record<string, unknown>,
      required: activity.required,
      visible: activity.visible,
      peerReview: activity.peerReview,
      groupMode: activity.groupMode,
      submissionType: activity.submissionType,
      rubric: activity.rubric,
      releaseAt: activity.releaseAt,
      dueAt: activity.dueAt,
    }));
    const blocks = pack.blocks.map((block) => ({
      blockType: block.blockType,
      content: this.replaceUploadsWithPlaceholders(block.content, usedAssets) as Record<string, unknown>,
    }));

    const manifest: ActivityPackManifest = {
      format: ACTIVITY_PACK_FORMAT,
      version: ACTIVITY_PACK_VERSION,
      name: `${lesson.title} 学案包`,
      sourceLessonTitle: lesson.title,
      exportedAt: Date.now(),
      activityCount: activities.length,
      blockCount: blocks.length,
      assetCount: usedAssets.size,
    };

    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('activities.json', JSON.stringify(activities, null, 2));
    zip.file('blocks.json', JSON.stringify(blocks, null, 2));
    for (const asset of usedAssets.values()) {
      const safeName = path.basename(asset.filename) || `${asset.id}.bin`;
      zip.file(`assets/${asset.id}/${safeName}`, Buffer.from(asset.base64, 'base64'));
    }
    const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    return { filename: buildExportFilename(lesson.title), buffer };
  }

  async importPack(
    lessonId: string,
    zipBuffer: Buffer,
    opts: { authorId?: string; replace?: boolean } = {},
  ): Promise<{
    activities: LessonActivityRecord[];
    blocks: LessonActivityBlockRecord[];
    warnings: string[];
    unresolvedBindings: UnresolvedActivityBinding[];
  }> {
    if (zipBuffer.length > ACTIVITY_PACK_MAX_FILE_BYTES) {
      throw new LessonActivityError(413, '学案包超过 20MB 上限');
    }
    const service = new LessonActivityService(this.db);
    service.assertLesson(lessonId);
    const unpacked = await this.readZip(zipBuffer);
    const warnings: string[] = [];

    const materialized =
      unpacked.assets.length > 0
        ? await materializePackageAssets(unpacked.assets, {
            authorId: opts.authorId ?? null,
            lessonId,
          })
        : new Map();

    const replace = opts.replace !== false;
    if (replace) {
      for (const existing of service.listActivities(lessonId, { includeHidden: true })) {
        service.deleteActivity(existing.id);
      }
    }

    const created: LessonActivityRecord[] = [];
    for (const item of unpacked.activities) {
      if (!isActivityType(item.type)) {
        warnings.push(`已跳过不支持的活动类型：${String(item.type)}`);
        continue;
      }
      const config = resolveAssetPlaceholders(item.config, materialized) as Record<string, unknown>;
      this.collectMissingRefs(item.type, config, warnings);
      const input: CreateActivityInput = {
        type: item.type,
        title: item.title || '未命名活动',
        config,
        required: item.required,
        visible: false, // 导入后默认未发布，避免把未复核内容直接给学生
        peerReview: item.peerReview,
        groupMode: item.groupMode,
        submissionType: item.submissionType,
        rubric: item.rubric,
        releaseAt: null,
        dueAt: item.dueAt,
      };
      created.push(service.createActivity(lessonId, input));
    }

    const blockInputs = unpacked.blocks
      .filter((block) => isBlockType(block.blockType))
      .map((block) => ({
        blockType: block.blockType as LessonActivityBlockRecord['blockType'],
        content: resolveAssetPlaceholders(block.content, materialized) as Record<string, unknown>,
      }));
    const blocks = service.replaceBlocks(lessonId, blockInputs);
    const unresolvedBindings = service.listUnresolvedBindings(lessonId, created);
    return { activities: created, blocks, warnings, unresolvedBindings };
  }

  private collectMissingRefs(type: ActivityType, config: Record<string, unknown>, warnings: string[]): void {
    if (type === 'courseware' && config.coursewareId) {
      const ok = this.db
        .prepare('SELECT 1 AS ok FROM courseware WHERE id = ? OR uuid = ? LIMIT 1')
        .get(String(config.coursewareId), String(config.coursewareId)) as { ok: number } | undefined;
      if (!ok) warnings.push(`课件 ${String(config.coursewareId)} 在本实例不存在，导入后需重新关联`);
    }
    if (type === 'quiz') {
      const assessmentId = String(config.assessmentId || '');
      const assignmentId = String(config.assessmentAssignmentId || '');
      if (assessmentId) {
        const ok = this.tableExists('assessments')
          ? this.db.prepare('SELECT 1 AS ok FROM assessments WHERE id = ?').get(assessmentId)
          : null;
        if (!ok) warnings.push(`测验 ${assessmentId} 在本实例不存在，导入后需重新关联`);
      }
      if (assignmentId) {
        const ok = this.tableExists('assessment_assignments')
          ? this.db.prepare('SELECT 1 AS ok FROM assessment_assignments WHERE id = ?').get(assignmentId)
          : null;
        if (!ok) warnings.push(`测验布置 ${assignmentId} 在本实例不存在，导入后需重新关联`);
      }
    }
    if (type === 'submission' && config.assignmentId) {
      const ok = this.db.prepare('SELECT 1 AS ok FROM assignments WHERE id = ?').get(String(config.assignmentId)) as
        { ok: number } | undefined;
      if (!ok) warnings.push(`作业 ${String(config.assignmentId)} 在本实例不存在，导入后需重新关联`);
    }
  }

  private tableExists(name: string): boolean {
    return !!this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  }

  private replaceUploadsWithPlaceholders(value: unknown, assets: Map<string, PackagedAsset>): unknown {
    if (typeof value === 'string') {
      return value.replace(UPLOAD_URL_PATTERN, (_full, storedName: string) => {
        const asset = this.readUploadAsset(storedName, assets);
        return asset ? `\${asset:${asset.id}}` : _full;
      });
    }
    if (Array.isArray(value)) return value.map((item) => this.replaceUploadsWithPlaceholders(item, assets));
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.replaceUploadsWithPlaceholders(child, assets);
      }
      return result;
    }
    return value;
  }

  private readUploadAsset(storedName: string, assets: Map<string, PackagedAsset>): PackagedAsset | null {
    const filePath = resolveUploadsPath(storedName);
    if (!filePath) return null;
    const ext = path.extname(storedName).slice(1).toLowerCase();
    const contentType = (ext === 'jpeg' ? 'jpg' : ext) as PackageAssetType;
    if (!(PACKAGE_ASSET_TYPES as readonly string[]).includes(contentType)) return null;
    const digest = createHash('sha1').update(storedName).digest('hex').slice(0, 12);
    const id = `asset-${digest}`;
    const existing = assets.get(id);
    if (existing) return existing;
    const buffer = fs.readFileSync(filePath);
    const asset: PackagedAsset = {
      id,
      filename: storedName,
      contentType,
      base64: buffer.toString('base64'),
    };
    assets.set(id, asset);
    return asset;
  }

  private async readZip(buffer: Buffer): Promise<{
    manifest: ActivityPackManifest;
    activities: PackagedActivity[];
    blocks: PackagedBlock[];
    assets: PackagedAsset[];
  }> {
    const zip = await JSZip.loadAsync(buffer);
    const manifestRaw = await readZipJson(zip, 'manifest.json');
    if (!manifestRaw || manifestRaw.format !== ACTIVITY_PACK_FORMAT) {
      throw new LessonActivityError(400, '不是有效的学案包（manifest.format 不匹配）');
    }
    const activities = (await readZipJson(zip, 'activities.json')) as PackagedActivity[] | null;
    const blocks = (await readZipJson(zip, 'blocks.json')) as PackagedBlock[] | null;
    if (!Array.isArray(activities) || !Array.isArray(blocks)) {
      throw new LessonActivityError(400, '学案包缺少 activities.json 或 blocks.json');
    }
    const assets: PackagedAsset[] = [];
    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) continue;
      const normalized = entry.name.replace(/\\/g, '/');
      if (normalized.includes('..')) throw new LessonActivityError(400, '学案包包含非法路径');
      const match = /^assets\/([^/]+)\/([^/]+)$/.exec(normalized);
      if (!match) continue;
      const data = await entry.async('nodebuffer');
      const ext = path.extname(match[2]).slice(1).toLowerCase();
      const contentType = (ext === 'jpeg' ? 'jpg' : ext) as PackageAssetType;
      if (!(PACKAGE_ASSET_TYPES as readonly string[]).includes(contentType)) continue;
      assets.push({
        id: match[1],
        filename: match[2],
        contentType,
        base64: Buffer.from(data).toString('base64'),
      });
    }
    return {
      manifest: manifestRaw as ActivityPackManifest,
      activities,
      blocks,
      assets,
    };
  }
}

async function readZipJson(zip: JSZip, name: string): Promise<any | null> {
  const file = zip.file(name);
  if (!file) return null;
  const text = await file.async('string');
  try {
    return JSON.parse(text);
  } catch {
    throw new LessonActivityError(400, `${name} 不是合法 JSON`);
  }
}

function resolveUploadsPath(storedName: string): string | null {
  const uploadsDir = path.resolve(getUploadsDir());
  if (path.basename(storedName) !== storedName) return null;
  const target = path.resolve(uploadsDir, storedName);
  if (path.dirname(target) !== uploadsDir) return null;
  try {
    return fs.statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

export function buildExportFilename(title: string): string {
  const safe = (title || 'lesson-pack').replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40);
  return `${safe || 'lesson-pack'}-activity-pack.zip`;
}
