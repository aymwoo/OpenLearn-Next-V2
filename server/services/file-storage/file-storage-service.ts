import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { FileStorageExtensionRegistry } from '../../../packages/core/di/file-storage-extension-registry.js';
import type {
  FileAccessScope,
  FileStorageBackend,
  IEventBusService,
  IFileStorageExtensionRegistry,
} from '../../../packages/core/di/interfaces.js';
import {
  BUILTIN_LAYOUT_SCHEMES,
  LayoutValidationError,
  assertValidStorageKey,
  renderStorageKey,
  validateLayoutTemplate,
} from './layout-policy.js';
import { LocalFileStorage } from './local-backend.js';
import { FileProcessorRunner, createBuiltinPdfPageCountProcessor } from './processors.js';
import {
  DEFAULT_FILE_STORAGE_CONFIG,
  type FileAssetWithBlob,
  type FileLayoutScheme,
  type FileStorageConfig,
  type ReorgOptions,
  type ReorgPlanItem,
  type StoreFileInput,
  type StoreFileResult,
} from './types.js';

export class FileNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'FILE_NOT_FOUND';
}

export class FileStorageConfigError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_FILE_STORAGE_CONFIG';
}

const VALID_SCHEMES = new Set<FileLayoutScheme>(['flat', 'by-date', 'by-course', 'by-author', 'custom']);
const VALID_SCOPES = new Set<FileAccessScope>(['public', 'authenticated', 'assignment']);

/** Row shape of `file_assets` joined to `file_blobs` (optional window `rn` from reorg). */
interface FileAssetJoinRow {
  id: string;
  blob_id: string;
  original_name: string;
  mime: string;
  author_id: string | null;
  course_id: string | null;
  lesson_id: string | null;
  purpose: string;
  access_scope: string;
  metadata_json: string | null;
  deleted_at: string | null;
  created_at: string;
  backend_id: string;
  storage_key: string;
  sha256: string;
  size_bytes: number;
  ref_count: number;
  rn?: number;
}

export function normalizeLegacyAlias(alias: string): string {
  const clean = String(alias || '')
    .trim()
    .split(/[?#]/)[0]
    .replace(/\\/g, '/');
  if (!clean) return '';
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function parseMetadataJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class FileStorageService {
  readonly registry: IFileStorageExtensionRegistry;
  readonly localBackend: LocalFileStorage;
  private readonly processorRunner: FileProcessorRunner;

  constructor(
    private readonly db: Database.Database,
    private readonly options: {
      eventBus?: Pick<IEventBusService, 'publish'>;
      registry?: IFileStorageExtensionRegistry;
      localRootDir?: string;
      registerBuiltinPdfProcessor?: boolean;
    } = {},
  ) {
    this.registry = options.registry ?? new FileStorageExtensionRegistry();
    this.localBackend = new LocalFileStorage(options.localRootDir);
    if (!this.registry.getBackend('local')) {
      this.registry.registerBackend('kernel:file-storage', this.localBackend);
    }
    if (options.registerBuiltinPdfProcessor !== false) {
      const existing = this.registry
        .listProcessors('after-store')
        .find((entry) => entry.processor.id === 'builtin:pdf-page-count');
      if (!existing) {
        this.registry.registerProcessor('kernel:file-storage', createBuiltinPdfPageCountProcessor());
      }
    }
    this.processorRunner = new FileProcessorRunner(this.registry);
  }

  getConfig(): FileStorageConfig {
    try {
      const row = this.db.prepare("SELECT file_storage_config FROM site_settings WHERE id = 'global'").get() as
        { file_storage_config?: string | null } | undefined;
      if (row?.file_storage_config) {
        const parsed = JSON.parse(row.file_storage_config) as Partial<FileStorageConfig>;
        return this.normalizeConfig(parsed);
      }
    } catch {
      // Malformed config row falls back safely to defaults
    }
    return {
      layout: { ...DEFAULT_FILE_STORAGE_CONFIG.layout },
      defaultBackend: DEFAULT_FILE_STORAGE_CONFIG.defaultBackend,
      deduplicateByHash: DEFAULT_FILE_STORAGE_CONFIG.deduplicateByHash,
    };
  }

  private normalizeConfig(input: Partial<FileStorageConfig>): FileStorageConfig {
    const rawScheme = input?.layout?.scheme;
    const scheme: FileLayoutScheme =
      rawScheme && VALID_SCHEMES.has(rawScheme) ? rawScheme : DEFAULT_FILE_STORAGE_CONFIG.layout.scheme;
    const template =
      scheme === 'custom'
        ? (input?.layout?.template ?? BUILTIN_LAYOUT_SCHEMES['by-date'])
        : BUILTIN_LAYOUT_SCHEMES[scheme];
    const requestedBackend =
      typeof input?.defaultBackend === 'string' && input.defaultBackend.trim()
        ? input.defaultBackend.trim()
        : DEFAULT_FILE_STORAGE_CONFIG.defaultBackend;
    const defaultBackend = this.registry.getBackend(requestedBackend) ? requestedBackend : 'local';
    const deduplicateByHash =
      typeof input?.deduplicateByHash === 'boolean'
        ? input.deduplicateByHash
        : DEFAULT_FILE_STORAGE_CONFIG.deduplicateByHash;

    return {
      layout: { scheme, template },
      defaultBackend,
      deduplicateByHash,
    };
  }

  validateConfig(candidate: unknown): FileStorageConfig {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new FileStorageConfigError('file_storage_config must be an object');
    }
    const obj = candidate as Record<string, unknown>;
    const layoutObj = obj.layout as Record<string, unknown> | undefined;
    if (!layoutObj || typeof layoutObj !== 'object' || Array.isArray(layoutObj)) {
      throw new FileStorageConfigError('layout configuration object is required');
    }

    const scheme = layoutObj.scheme as FileLayoutScheme;
    if (!VALID_SCHEMES.has(scheme)) {
      throw new FileStorageConfigError(`Unsupported layout scheme: ${String(scheme)}`);
    }

    const template = scheme === 'custom' ? String(layoutObj.template ?? '') : BUILTIN_LAYOUT_SCHEMES[scheme];
    try {
      validateLayoutTemplate(template, this.registry.getLayoutTokenResolvers().keys());
    } catch (err) {
      if (err instanceof LayoutValidationError) {
        throw new FileStorageConfigError(err.message);
      }
      throw err;
    }

    const backendId =
      typeof obj.defaultBackend === 'string' && obj.defaultBackend.trim() ? obj.defaultBackend.trim() : 'local';
    if (!this.registry.getBackend(backendId)) {
      throw new FileStorageConfigError(`Unknown storage backend "${backendId}"`);
    }

    const deduplicateByHash = typeof obj.deduplicateByHash === 'boolean' ? obj.deduplicateByHash : true;

    return {
      layout: { scheme, template },
      defaultBackend: backendId,
      deduplicateByHash,
    };
  }

  updateConfig(candidate: unknown): FileStorageConfig {
    const validated = this.validateConfig(candidate);
    const json = JSON.stringify(validated);
    const row = this.db.prepare("SELECT id FROM site_settings WHERE id = 'global'").get();
    if (row) {
      this.db.prepare("UPDATE site_settings SET file_storage_config = ? WHERE id = 'global'").run(json);
    } else {
      this.db.prepare("INSERT INTO site_settings (id, file_storage_config) VALUES ('global', ?)").run(json);
    }
    return validated;
  }

  previewKey(input: {
    scheme: FileLayoutScheme;
    template?: string;
    context?: Partial<FileAssetWithBlob> & { purpose?: string; originalName?: string; assignmentId?: string };
  }): string {
    const template =
      input.scheme === 'custom'
        ? String(input.template ?? '')
        : (BUILTIN_LAYOUT_SCHEMES[input.scheme] ?? BUILTIN_LAYOUT_SCHEMES['by-date']);

    return renderStorageKey({
      config: { layout: { scheme: input.scheme, template } },
      context: {
        purpose: input.context?.purpose || 'lesson-asset',
        authorId: input.context?.authorId ?? 'usr_teacher_1',
        courseId: input.context?.courseId ?? 'crs_demo',
        lessonId: input.context?.lessonId ?? 'les_demo',
        assignmentId: input.context?.assignmentId ?? 'asgn_demo',
      },
      originalName: input.context?.originalName || '课件示例.pdf',
      assetId: '01950000-0000-7000-8000-00000000abcd',
      sha256: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890',
      customResolvers: this.registry.getLayoutTokenResolvers(),
    });
  }

  listBackendDescriptors(): Array<{
    id: string;
    displayName: string;
    description?: string;
    owner: string;
    capabilities: FileStorageBackend['capabilities'];
  }> {
    return this.registry.listBackends().map((entry) => ({
      id: entry.backend.id,
      displayName: entry.backend.displayName,
      description: entry.backend.description,
      owner: entry.owner,
      capabilities: entry.backend.capabilities ?? {},
    }));
  }

  private resolveBackend(backendId: string): FileStorageBackend {
    const found = this.registry.getBackend(backendId);
    if (found) return found;
    throw new FileStorageConfigError(`Storage backend "${backendId}" is not registered`);
  }

  async store(input: StoreFileInput): Promise<StoreFileResult> {
    if (!Buffer.isBuffer(input.buffer)) {
      throw new Error('FileStorageService.store requires a Buffer');
    }

    const config = this.getConfig();
    const backendId = input.backendId || config.defaultBackend;
    const backend = this.resolveBackend(backendId);

    const processed = await this.processorRunner.runBeforeStore({
      buffer: input.buffer,
      originalName: input.originalName || 'file',
      mime: input.mime || 'application/octet-stream',
      context: input.context,
      metadata: input.context.metadata ?? {},
    });

    const assetId = input.assetId || uuidv7();
    const nowIso = input.createdAt || new Date().toISOString();
    const nowDate = new Date(nowIso);
    const sha256 = crypto.createHash('sha256').update(processed.buffer).digest('hex');
    const sizeBytes = processed.buffer.length;
    const accessScope: FileAccessScope =
      input.context.accessScope && VALID_SCOPES.has(input.context.accessScope)
        ? input.context.accessScope
        : input.context.purpose === 'avatar'
          ? 'public'
          : input.context.purpose === 'assignment'
            ? 'assignment'
            : 'authenticated';

    let deduplicated = false;
    let blobId = '';
    let storageKey = '';
    let wroteNewBlob = false;

    if (config.deduplicateByHash && !input.skipDedup) {
      const existingBlob = this.db
        .prepare('SELECT id, storage_key FROM file_blobs WHERE backend_id = ? AND sha256 = ? LIMIT 1')
        .get(backendId, sha256) as { id: string; storage_key: string } | undefined;

      if (existingBlob && (await backend.exists(existingBlob.storage_key))) {
        blobId = existingBlob.id;
        storageKey = existingBlob.storage_key;
        deduplicated = true;
      }
    }

    if (!deduplicated) {
      blobId = uuidv7();
      storageKey = renderStorageKey({
        config,
        context: { ...input.context, accessScope },
        originalName: processed.originalName,
        assetId,
        sha256,
        now: Number.isNaN(nowDate.getTime()) ? new Date() : nowDate,
        customResolvers: this.registry.getLayoutTokenResolvers(),
      });
      assertValidStorageKey(storageKey);
      await backend.put(storageKey, processed.buffer, { contentType: processed.mime });
      wroteNewBlob = true;
    }

    const normalizedAliases = Array.from(new Set((input.aliases ?? []).map(normalizeLegacyAlias).filter(Boolean)));

    try {
      const insertTx = this.db.transaction(() => {
        if (deduplicated) {
          const updated = this.db.prepare('UPDATE file_blobs SET ref_count = ref_count + 1 WHERE id = ?').run(blobId);
          if (updated.changes === 0) {
            throw new Error(`Referenced blob ${blobId} disappeared during concurrent delete`);
          }
        } else {
          this.db
            .prepare(
              `INSERT INTO file_blobs (id, backend_id, storage_key, sha256, size_bytes, ref_count, created_at)
               VALUES (?, ?, ?, ?, ?, 1, ?)`,
            )
            .run(blobId, backendId, storageKey, sha256, sizeBytes, nowIso);
        }

        this.db
          .prepare(
            `INSERT INTO file_assets (
               id, blob_id, original_name, mime, author_id, course_id, lesson_id,
               purpose, access_scope, metadata_json, deleted_at, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          )
          .run(
            assetId,
            blobId,
            processed.originalName,
            processed.mime,
            input.context.authorId ?? null,
            input.context.courseId ?? null,
            input.context.lessonId ?? null,
            input.context.purpose || 'attachment',
            accessScope,
            Object.keys(processed.metadata).length > 0 ? JSON.stringify(processed.metadata) : null,
            nowIso,
          );

        for (const alias of normalizedAliases) {
          this.db.prepare('INSERT OR REPLACE INTO file_aliases (alias, asset_id) VALUES (?, ?)').run(alias, assetId);
        }
      });

      insertTx();
    } catch (err) {
      if (wroteNewBlob) {
        await backend.delete(storageKey).catch(() => {});
      }
      throw err;
    }

    const localPath = backend instanceof LocalFileStorage ? backend.resolveLocalPath(storageKey) : undefined;
    const afterPatch = await this.processorRunner.runAfterStore(
      {
        assetId,
        storageKey,
        backendId,
        originalName: processed.originalName,
        mime: processed.mime,
        sizeBytes,
        sha256,
        buffer: processed.buffer,
        localPath,
        context: { ...input.context, accessScope },
        metadata: processed.metadata,
      },
      (bgPatch) => this.mergeAssetMetadata(assetId, bgPatch),
    );

    const finalMetadata =
      Object.keys(afterPatch).length > 0 ? this.mergeAssetMetadata(assetId, afterPatch) : processed.metadata;

    this.options.eventBus?.publish({
      id: uuidv7(),
      type: 'file.stored',
      source: 'core.file-storage',
      timestamp: Date.now(),
      payload: {
        assetId,
        blobId,
        backendId,
        storageKey,
        purpose: input.context.purpose,
        mime: processed.mime,
        sizeBytes,
        sha256,
        deduplicated,
        authorId: input.context.authorId ?? null,
        courseId: input.context.courseId ?? null,
        lessonId: input.context.lessonId ?? null,
      },
    });

    return {
      assetId,
      blobId,
      backendId,
      storageKey,
      fileUrl: `/api/files/${assetId}`,
      sha256,
      sizeBytes,
      originalName: processed.originalName,
      mime: processed.mime,
      deduplicated,
      metadata: finalMetadata,
    };
  }

  private mergeAssetMetadata(assetId: string, patch: Record<string, unknown>): Record<string, unknown> {
    if (!patch || Object.keys(patch).length === 0) return {};
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT metadata_json FROM file_assets WHERE id = ?').get(assetId) as
        { metadata_json: string | null } | undefined;
      if (!row) return { ...patch };
      const merged = { ...parseMetadataJson(row.metadata_json), ...patch };
      this.db.prepare('UPDATE file_assets SET metadata_json = ? WHERE id = ?').run(JSON.stringify(merged), assetId);
      return merged;
    });
    return tx();
  }

  private mapAssetRow(row: FileAssetJoinRow | undefined): FileAssetWithBlob | null {
    if (!row) return null;
    return {
      id: row.id,
      blobId: row.blob_id,
      originalName: row.original_name,
      mime: row.mime,
      authorId: row.author_id ?? null,
      courseId: row.course_id ?? null,
      lessonId: row.lesson_id ?? null,
      purpose: row.purpose,
      accessScope: row.access_scope as FileAccessScope,
      metadata: parseMetadataJson(row.metadata_json),
      deletedAt: row.deleted_at ?? null,
      createdAt: row.created_at,
      backendId: row.backend_id,
      storageKey: row.storage_key,
      sha256: row.sha256,
      sizeBytes: Number(row.size_bytes),
      refCount: Number(row.ref_count),
    };
  }

  getAsset(assetId: string): FileAssetWithBlob | null {
    const row = this.db
      .prepare(
        `SELECT a.*, b.backend_id, b.storage_key, b.sha256, b.size_bytes, b.ref_count
         FROM file_assets a
         JOIN file_blobs b ON a.blob_id = b.id
         WHERE a.id = ? AND a.deleted_at IS NULL`,
      )
      .get(assetId) as FileAssetJoinRow | undefined;
    return this.mapAssetRow(row);
  }

  getAssetByAlias(alias: string): FileAssetWithBlob | null {
    const normalized = normalizeLegacyAlias(alias);
    if (!normalized) return null;
    const row = this.db
      .prepare(
        `SELECT a.*, b.backend_id, b.storage_key, b.sha256, b.size_bytes, b.ref_count
         FROM file_aliases al
         JOIN file_assets a ON al.asset_id = a.id
         JOIN file_blobs b ON a.blob_id = b.id
         WHERE al.alias = ? AND a.deleted_at IS NULL`,
      )
      .get(normalized) as FileAssetJoinRow | undefined;
    return this.mapAssetRow(row);
  }

  recordAlias(alias: string, assetId: string): void {
    const normalized = normalizeLegacyAlias(alias);
    if (!normalized) return;
    this.db.prepare('INSERT OR REPLACE INTO file_aliases (alias, asset_id) VALUES (?, ?)').run(normalized, assetId);
  }

  async openReadStream(
    asset: FileAssetWithBlob,
    range?: { start: number; end: number },
  ): Promise<{ stream: NodeJS.ReadableStream; backend: FileStorageBackend }> {
    const backend = this.resolveBackend(asset.backendId);
    const exists = await backend.exists(asset.storageKey);
    if (!exists) {
      throw new FileNotFoundError(`Physical blob missing for asset ${asset.id}`);
    }
    const stream = await backend.readStream(asset.storageKey, range);
    return { stream, backend };
  }

  async readBuffer(asset: FileAssetWithBlob): Promise<Buffer> {
    const { stream } = await this.openReadStream(asset);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async runBeforeServe(asset: FileAssetWithBlob): Promise<Record<string, string>> {
    const backend = this.registry.getBackend(asset.backendId);
    const localPath = backend instanceof LocalFileStorage ? backend.resolveLocalPath(asset.storageKey) : undefined;
    return this.processorRunner.runBeforeServe({
      assetId: asset.id,
      storageKey: asset.storageKey,
      backendId: asset.backendId,
      originalName: asset.originalName,
      mime: asset.mime,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      localPath,
      context: {
        purpose: asset.purpose,
        accessScope: asset.accessScope,
        authorId: asset.authorId,
        courseId: asset.courseId,
        lessonId: asset.lessonId,
        metadata: asset.metadata,
      },
      metadata: asset.metadata,
    });
  }

  softDelete(assetId: string, deletedAt = new Date().toISOString()): boolean {
    const res = this.db
      .prepare('UPDATE file_assets SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?')
      .run(deletedAt, assetId);
    return res.changes > 0;
  }

  async purgeAsset(assetId: string): Promise<{ deleted: boolean; blobDeleted: boolean }> {
    const txResult = this.db.transaction(
      (): { deleted: boolean; unreferenced?: { backendId: string; storageKey: string } } => {
        const row = this.db
          .prepare(
            `SELECT a.blob_id, b.backend_id, b.storage_key
           FROM file_assets a
           JOIN file_blobs b ON a.blob_id = b.id
           WHERE a.id = ?`,
          )
          .get(assetId) as { blob_id: string; backend_id: string; storage_key: string } | undefined;

        if (!row) return { deleted: false };

        this.db.prepare('DELETE FROM file_aliases WHERE asset_id = ?').run(assetId);
        this.db.prepare('DELETE FROM file_assets WHERE id = ?').run(assetId);
        this.db.prepare('UPDATE file_blobs SET ref_count = MAX(0, ref_count - 1) WHERE id = ?').run(row.blob_id);

        const blobAfter = this.db.prepare('SELECT ref_count FROM file_blobs WHERE id = ?').get(row.blob_id) as
          { ref_count: number } | undefined;

        if (blobAfter && blobAfter.ref_count <= 0) {
          const remainingRefs = this.db
            .prepare('SELECT COUNT(*) as cnt FROM file_assets WHERE blob_id = ?')
            .get(row.blob_id) as { cnt: number };
          if (remainingRefs.cnt === 0) {
            this.db.prepare('DELETE FROM file_blobs WHERE id = ?').run(row.blob_id);
            return {
              deleted: true,
              unreferenced: { backendId: row.backend_id, storageKey: row.storage_key },
            };
          }
        }

        return { deleted: true };
      },
    )();

    if (txResult.unreferenced) {
      const backend = this.registry.getBackend(txResult.unreferenced.backendId);
      if (backend) {
        await backend.delete(txResult.unreferenced.storageKey).catch(() => {});
      }
    }

    return {
      deleted: txResult.deleted,
      blobDeleted: Boolean(txResult.unreferenced),
    };
  }

  async purgeSoftDeletedOlderThan(cutoffIso: string): Promise<number> {
    const rows = this.db
      .prepare('SELECT id FROM file_assets WHERE deleted_at IS NOT NULL AND deleted_at < ?')
      .all(cutoffIso) as Array<{ id: string }>;
    let purged = 0;
    for (const row of rows) {
      const res = await this.purgeAsset(row.id);
      if (res.deleted) purged++;
    }
    return purged;
  }

  /**
   * Reorganize existing physical blobs to match the target layout/backend while preserving `file_assets.id`
   * and `file_aliases` so external URLs never break.
   */
  async reorgAssets(opts: ReorgOptions = {}): Promise<ReorgPlanItem[]> {
    const config = this.getConfig();
    const targetBackendId = opts.backendId || config.defaultBackend;
    const toBackend = this.resolveBackend(targetBackendId);
    const scheme = opts.scheme || config.layout.scheme;
    const template =
      scheme === 'custom'
        ? (opts.template ?? config.layout.template ?? BUILTIN_LAYOUT_SCHEMES['by-date'])
        : BUILTIN_LAYOUT_SCHEMES[scheme];
    validateLayoutTemplate(template, this.registry.getLayoutTokenResolvers().keys());

    // Pick canonical earliest active asset per blob so deduplicated blobs move once cleanly.
    const sqlLimit = typeof opts.limit === 'number' && opts.limit > 0 ? `LIMIT ${Math.floor(opts.limit)}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT a.*, b.backend_id, b.storage_key, b.sha256, b.size_bytes, b.ref_count,
                  ROW_NUMBER() OVER (PARTITION BY b.id ORDER BY a.created_at ASC, a.id ASC) AS rn
           FROM file_blobs b
           JOIN file_assets a ON a.blob_id = b.id
           WHERE a.deleted_at IS NULL
         ) WHERE rn = 1
         ORDER BY created_at ASC
         ${sqlLimit}`,
      )
      .all() as FileAssetJoinRow[];

    const plan: ReorgPlanItem[] = [];

    for (const raw of rows) {
      const asset = this.mapAssetRow(raw)!;
      const fromBackend = this.registry.getBackend(asset.backendId);
      const targetDate = new Date(asset.createdAt);
      const toKey = renderStorageKey({
        config: { layout: { scheme, template } },
        context: {
          purpose: asset.purpose,
          accessScope: asset.accessScope,
          authorId: asset.authorId,
          courseId: asset.courseId,
          lessonId: asset.lessonId,
          metadata: asset.metadata,
        },
        originalName: asset.originalName,
        assetId: asset.id,
        sha256: asset.sha256,
        now: Number.isNaN(targetDate.getTime()) ? new Date() : targetDate,
        customResolvers: this.registry.getLayoutTokenResolvers(),
      });

      if (asset.backendId === targetBackendId && asset.storageKey === toKey) {
        plan.push({
          blobId: asset.blobId,
          assetId: asset.id,
          fromBackend: asset.backendId,
          toBackend: targetBackendId,
          fromKey: asset.storageKey,
          toKey,
          status: 'unchanged',
        });
        continue;
      }

      if (!fromBackend || !(await fromBackend.exists(asset.storageKey))) {
        plan.push({
          blobId: asset.blobId,
          assetId: asset.id,
          fromBackend: asset.backendId,
          toBackend: targetBackendId,
          fromKey: asset.storageKey,
          toKey,
          status: 'error',
          reason: 'Source blob missing on disk/backend',
        });
        continue;
      }

      if (opts.dryRun) {
        plan.push({
          blobId: asset.blobId,
          assetId: asset.id,
          fromBackend: asset.backendId,
          toBackend: targetBackendId,
          fromKey: asset.storageKey,
          toKey,
          status: 'planned',
        });
        continue;
      }

      try {
        if (fromBackend.id === toBackend.id && typeof toBackend.copy === 'function') {
          await toBackend.copy(asset.storageKey, toKey);
        } else {
          const stream = await fromBackend.readStream(asset.storageKey);
          const chunks: Buffer[] = [];
          for await (const c of stream as AsyncIterable<Buffer | string>) {
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
          }
          await toBackend.put(toKey, Buffer.concat(chunks), { contentType: asset.mime });
        }

        const updated = this.db
          .prepare(
            'UPDATE file_blobs SET backend_id = ?, storage_key = ? WHERE id = ? AND backend_id = ? AND storage_key = ?',
          )
          .run(targetBackendId, toKey, asset.blobId, asset.backendId, asset.storageKey);

        if (updated.changes === 0) {
          await toBackend.delete(toKey).catch(() => {});
          plan.push({
            blobId: asset.blobId,
            assetId: asset.id,
            fromBackend: asset.backendId,
            toBackend: targetBackendId,
            fromKey: asset.storageKey,
            toKey,
            status: 'skipped',
            reason: 'Concurrent modification detected',
          });
          continue;
        }

        await fromBackend.delete(asset.storageKey).catch(() => {});
        plan.push({
          blobId: asset.blobId,
          assetId: asset.id,
          fromBackend: asset.backendId,
          toBackend: targetBackendId,
          fromKey: asset.storageKey,
          toKey,
          status: 'moved',
        });
      } catch (err) {
        await toBackend.delete(toKey).catch(() => {});
        plan.push({
          blobId: asset.blobId,
          assetId: asset.id,
          fromBackend: asset.backendId,
          toBackend: targetBackendId,
          fromKey: asset.storageKey,
          toKey,
          status: 'error',
          reason: (err as Error).message,
        });
      }
    }

    return plan;
  }
}

export function extractFileAssetIdFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/api\/files\/([A-Za-z0-9_-]+)(?:[?#].*)?$/);
  return match ? match[1] : null;
}
