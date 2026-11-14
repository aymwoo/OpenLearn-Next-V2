import type {
  FileAccessScope,
  FileAssetContext,
  FileLayoutTokenResolver,
  FileProcessor,
  FileProcessorStage,
  FilePurpose,
  FileStorageBackend,
  IFileStorageExtensionRegistry,
} from '../../../packages/core/di/interfaces.js';

export type {
  FileAccessScope,
  FileAssetContext,
  FileLayoutTokenResolver,
  FileProcessor,
  FileProcessorStage,
  FilePurpose,
  FileStorageBackend,
  IFileStorageExtensionRegistry,
};

export type FileLayoutScheme = 'flat' | 'by-date' | 'by-course' | 'by-author' | 'custom';

export interface FileStorageConfig {
  layout: {
    scheme: FileLayoutScheme;
    template?: string;
  };
  defaultBackend: string;
  deduplicateByHash: boolean;
}

export const DEFAULT_FILE_STORAGE_CONFIG: FileStorageConfig = {
  layout: {
    scheme: 'by-date',
    template: '{yyyy}/{MM}/{dd}/{purpose}/{safeName}',
  },
  defaultBackend: 'local',
  deduplicateByHash: true,
};

export interface FileBlobRecord {
  id: string;
  backendId: string;
  storageKey: string;
  sha256: string;
  sizeBytes: number;
  refCount: number;
  createdAt: string;
}

export interface FileAssetRecord {
  id: string;
  blobId: string;
  originalName: string;
  mime: string;
  authorId: string | null;
  courseId: string | null;
  lessonId: string | null;
  purpose: string;
  accessScope: FileAccessScope;
  metadata: Record<string, unknown>;
  deletedAt: string | null;
  createdAt: string;
}

export interface FileAssetWithBlob extends FileAssetRecord {
  backendId: string;
  storageKey: string;
  sha256: string;
  sizeBytes: number;
  refCount: number;
}

export interface StoreFileInput {
  buffer: Buffer;
  originalName: string;
  mime: string;
  context: FileAssetContext;
  /** Optional explicit asset ID (defaults to UUIDv7). */
  assetId?: string;
  /** Optional legacy aliases (e.g. `/uploads/1234-abc.pdf`). */
  aliases?: string[];
  /** Override active backend ID for this write (defaults to configured defaultBackend). */
  backendId?: string;
  /** Override createdAt ISO timestamp (mainly for backfill/migration). */
  createdAt?: string;
  /** Skip content-hash deduplication so the asset gets a dedicated physical blob. */
  skipDedup?: boolean;
}

export interface StoreFileResult {
  assetId: string;
  blobId: string;
  backendId: string;
  storageKey: string;
  fileUrl: string;
  sha256: string;
  sizeBytes: number;
  originalName: string;
  mime: string;
  deduplicated: boolean;
  metadata: Record<string, unknown>;
}

export interface ReorgOptions {
  dryRun?: boolean;
  backendId?: string;
  scheme?: FileLayoutScheme;
  template?: string;
  limit?: number;
}

export interface ReorgPlanItem {
  blobId: string;
  assetId: string;
  fromBackend: string;
  toBackend: string;
  fromKey: string;
  toKey: string;
  status: 'unchanged' | 'planned' | 'moved' | 'skipped' | 'error';
  reason?: string;
}
