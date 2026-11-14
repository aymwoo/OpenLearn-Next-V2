import path from 'node:path';
import type { Request, Response } from 'express';
import {
  extensionOf,
  isInlineSafeContentType,
  resolveContentType,
} from '../../packages/core/assignment/file-preview-policy.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import type { ServerContext } from '../context.js';
import { getCookieToken, getValidSession } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { authorizeClass } from '../services/class-access.js';
import { canUserAccessAssignmentFile } from '../services/assignment-service.js';
import {
  BUILTIN_LAYOUT_SCHEMES,
  FileNotFoundError,
  FileStorageConfigError,
  LayoutValidationError,
  getFileStorageService,
  type FileAssetWithBlob,
  type FileLayoutScheme,
} from '../services/file-storage/index.js';
import { sendSafeError } from '../utils/error-handler.js';

const EXTRA_SAFE_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
});

function resolveSafeServeContentType(originalName: string): { contentType: string; isMedia: boolean } {
  const mapped = resolveContentType(originalName);
  if (mapped !== 'application/octet-stream') {
    return { contentType: mapped, isMedia: false };
  }
  const ext = extensionOf(originalName);
  const media = EXTRA_SAFE_MEDIA_TYPES[ext];
  if (media) {
    return { contentType: media, isMedia: true };
  }
  return { contentType: 'application/octet-stream', isMedia: false };
}

function buildContentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const safeBase = path.basename(String(filename || 'download')).replace(/[\r\n"]/g, '_') || 'download';
  const asciiFallback = safeBase.replace(/[^\x20-\x7e]/g, '_') || 'download';
  const encoded = encodeURIComponent(safeBase);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function authorizeAssignmentAsset(
  asset: FileAssetWithBlob,
  session: NonNullable<ReturnType<typeof getValidSession>>,
): boolean {
  if (session.role === 'administrator') return true;
  const db = kernelContainer.db;
  const linked = db
    .prepare('SELECT id, assignment_id, student_id FROM plugin_assignment_files WHERE asset_id = ? LIMIT 1')
    .get(asset.id) as { id: string; assignment_id: string; student_id: string } | undefined;

  if (linked) {
    const assignment = db
      .prepare('SELECT id, class_id FROM plugin_assignments WHERE id = ?')
      .get(linked.assignment_id) as { id: string; class_id: string | null } | undefined;

    const isPrivileged =
      session.role === 'teacher' &&
      (!assignment?.class_id || authorizeClass(db, session, assignment.class_id, 'staff').ok);

    return canUserAccessAssignmentFile(
      db,
      linked.assignment_id,
      linked.id,
      linked.student_id,
      session.userId ?? null,
      isPrivileged,
    );
  }

  // Fallback for direct assignment-scoped assets not attached to plugin_assignment_files
  if (session.role === 'teacher') {
    const classId = typeof asset.metadata?.classId === 'string' ? asset.metadata.classId : null;
    return classId ? authorizeClass(db, session, classId, 'staff').ok : true;
  }
  return asset.authorId === session.userId;
}

export async function serveFileAsset(req: Request, res: Response, asset: FileAssetWithBlob): Promise<void> {
  if (asset.accessScope !== 'public') {
    const token = getCookieToken(req);
    const session = token ? getValidSession(token) : null;
    if (!session) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (asset.accessScope === 'assignment' && !authorizeAssignmentAsset(asset, session)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }

  const fileStorage = getFileStorageService();
  const etag = `"sha256-${asset.sha256}"`;
  if (asset.accessScope !== 'assignment' && req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  let opened: Awaited<ReturnType<typeof fileStorage.openReadStream>>;
  try {
    opened = await fileStorage.openReadStream(asset);
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    throw err;
  }

  const extraHeaders = await fileStorage.runBeforeServe(asset);
  const { contentType, isMedia } = resolveSafeServeContentType(asset.originalName);
  const forceDownload = req.query.download === '1' || req.query.download === 'true';
  const allowInline =
    !forceDownload && (isInlineSafeContentType(contentType) || (isMedia && asset.accessScope !== 'assignment'));

  for (const [k, v] of Object.entries(extraHeaders)) {
    res.setHeader(k, v);
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(asset.sizeBytes));
  res.setHeader(
    'Content-Disposition',
    buildContentDisposition(allowInline ? 'inline' : 'attachment', asset.originalName),
  );

  if (asset.accessScope === 'assignment') {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', 'sandbox');
  } else if (asset.accessScope === 'public') {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', etag);
    if (!isMedia) {
      res.setHeader('Content-Security-Policy', 'sandbox');
    }
  } else {
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('ETag', etag);
    if (!isMedia) {
      res.setHeader('Content-Security-Policy', 'sandbox');
    }
  }

  opened.stream.on('error', (streamErr) => {
    if (!res.headersSent) {
      res.status(404).json({ error: 'File stream error' });
    } else {
      res.destroy(streamErr);
    }
  });
  opened.stream.pipe(res);
}

export function registerFilesRoutes(ctx: Pick<ServerContext, 'app'>): void {
  const { app } = ctx;

  // Read gateway for unified file assets; enforces scope-based authorization & strict security headers.
  app.get('/api/files/:assetId', async (req: Request, res: Response) => {
    try {
      const assetId = String(req.params.assetId || '').trim();
      if (!assetId || assetId.length > 128) {
        return res.status(404).json({ error: 'File not found' });
      }
      const asset = getFileStorageService().getAsset(assetId);
      if (!asset) {
        return res.status(404).json({ error: 'File not found' });
      }
      await serveFileAsset(req, res, asset);
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // Admin-only file storage configuration (never exposed via public /api/site-settings).
  app.get('/api/admin/file-storage/config', requireScopedAuth('admin'), (_req: Request, res: Response) => {
    try {
      const fileStorage = getFileStorageService();
      res.json({
        success: true,
        config: fileStorage.getConfig(),
        backends: fileStorage.listBackendDescriptors(),
        builtInSchemes: BUILTIN_LAYOUT_SCHEMES,
      });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/admin/file-storage/config', requireScopedAuth('admin'), (req: Request, res: Response) => {
    try {
      const fileStorage = getFileStorageService();
      const updated = fileStorage.updateConfig(req.body);
      res.json({ success: true, config: updated });
    } catch (e) {
      if (e instanceof FileStorageConfigError || e instanceof LayoutValidationError) {
        return res.status(400).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e);
    }
  });

  app.post('/api/admin/file-storage/preview', requireScopedAuth('admin'), (req: Request, res: Response) => {
    try {
      const scheme = (req.body?.scheme || 'by-date') as FileLayoutScheme;
      const template = typeof req.body?.template === 'string' ? req.body.template : undefined;
      const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : undefined;
      const previewKey = getFileStorageService().previewKey({ scheme, template, context });
      res.json({ success: true, previewKey });
    } catch (e) {
      if (e instanceof LayoutValidationError || e instanceof FileStorageConfigError) {
        return res.status(400).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e);
    }
  });

  app.get('/api/admin/file-storage/stats', requireScopedAuth('admin'), (_req: Request, res: Response) => {
    try {
      const db = kernelContainer.db;
      const assets = db
        .prepare(
          'SELECT COUNT(*) as total, SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as active FROM file_assets',
        )
        .get() as { total: number; active: number | null };
      const blobs = db
        .prepare('SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as totalBytes FROM file_blobs')
        .get() as { count: number; totalBytes: number };
      const logical = db
        .prepare(
          `SELECT COALESCE(SUM(b.size_bytes), 0) as logicalBytes
           FROM file_assets a JOIN file_blobs b ON a.blob_id = b.id
           WHERE a.deleted_at IS NULL`,
        )
        .get() as { logicalBytes: number };
      const aliases = db.prepare('SELECT COUNT(*) as count FROM file_aliases').get() as { count: number };

      res.json({
        success: true,
        stats: {
          activeAssets: assets.active ?? 0,
          totalAssets: assets.total ?? 0,
          uniqueBlobs: blobs.count ?? 0,
          physicalBytes: blobs.totalBytes ?? 0,
          logicalBytes: logical.logicalBytes ?? 0,
          savedBytes: Math.max(0, (logical.logicalBytes ?? 0) - (blobs.totalBytes ?? 0)),
          legacyAliases: aliases.count ?? 0,
        },
      });
    } catch (e) {
      sendSafeError(res, e);
    }
  });
}
