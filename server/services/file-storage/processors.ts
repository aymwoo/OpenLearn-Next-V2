import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  FileAssetContext,
  FileProcessor,
  FileProcessorContext,
  FileProcessorResult,
  FileProcessorStage,
  IFileStorageExtensionRegistry,
} from '../../../packages/core/di/interfaces.js';
import { countPdfPages } from '../course-package-assets.js';

const execFileAsync = promisify(execFile);

const STAGE_MAX_TIMEOUT_MS: Record<FileProcessorStage, number> = {
  'before-store': 5_000,
  'after-store': 15_000,
  'before-serve': 2_000,
};

const RESERVED_SECURITY_HEADERS = new Set<string>([
  'content-type',
  'content-length',
  'content-security-policy',
  'x-content-type-options',
  'content-disposition',
  'cache-control',
  'etag',
  'access-control-allow-origin',
]);

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`FileProcessor "${label}" timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function matchesProcessor(
  processor: Pick<FileProcessor, 'match'>,
  input: { mime: string; purpose: string; originalName: string },
): boolean {
  const match = processor.match;
  if (!match) return true;

  if (match.purposes?.length && !match.purposes.includes(input.purpose)) {
    return false;
  }

  if (match.extensions?.length) {
    const ext = path.extname(input.originalName || '').toLowerCase();
    const normalized = match.extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`));
    if (!normalized.includes(ext)) return false;
  }

  if (match.mimes?.length) {
    const mimeLower = (input.mime || '').toLowerCase();
    const hit = match.mimes.some((pattern) => {
      const p = pattern.toLowerCase();
      if (p.endsWith('/*')) return mimeLower.startsWith(p.slice(0, -1));
      return mimeLower === p;
    });
    if (!hit) return false;
  }

  return true;
}

class BoundedAsyncSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/**
 * Built-in fail-open processor that extracts PDF page counts (`metadata.slideCount`)
 * using pure-JS buffer inspection first and falling back to `pdfinfo` if available.
 */
export function createBuiltinPdfPageCountProcessor(): FileProcessor {
  return {
    id: 'builtin:pdf-page-count',
    displayName: 'PDF 页数解析',
    stage: 'after-store',
    priority: 10,
    timeoutMs: 5_000,
    match: {
      extensions: ['.pdf'],
      mimes: ['application/pdf'],
    },
    async run(ctx: FileProcessorContext): Promise<FileProcessorResult> {
      let slideCount = 1;
      if (ctx.buffer) {
        slideCount = Math.max(1, countPdfPages(ctx.buffer));
      }
      if (slideCount <= 1 && ctx.localPath) {
        try {
          const { stdout } = await execFileAsync('pdfinfo', [ctx.localPath], { timeout: 4_000 });
          const match = stdout.match(/Pages:\s+(\d+)/);
          if (match) {
            const parsed = Number.parseInt(match[1], 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              slideCount = parsed;
            }
          }
        } catch {
          // pdfinfo is optional; keep pure-JS page count fallback cleanly
        }
      }
      return { metadataPatch: { slideCount } };
    },
  };
}

export class FileProcessorRunner {
  private readonly backgroundSemaphore: BoundedAsyncSemaphore;

  constructor(
    private readonly registry?: Pick<IFileStorageExtensionRegistry, 'listProcessors'>,
    maxBackgroundConcurrency = 4,
  ) {
    this.backgroundSemaphore = new BoundedAsyncSemaphore(maxBackgroundConcurrency);
  }

  private getStageProcessors(
    stage: FileProcessorStage,
    input: { mime: string; purpose: string; originalName: string },
  ): FileProcessor[] {
    if (!this.registry) return [];
    return this.registry
      .listProcessors(stage)
      .map((entry) => entry.processor)
      .filter((proc) => matchesProcessor(proc, input));
  }

  async runBeforeStore(state: {
    buffer: Buffer;
    originalName: string;
    mime: string;
    context: FileAssetContext;
    metadata: Record<string, unknown>;
  }): Promise<{
    buffer: Buffer;
    originalName: string;
    mime: string;
    metadata: Record<string, unknown>;
  }> {
    let buffer = state.buffer;
    let originalName = state.originalName;
    let mime = state.mime;
    const metadata: Record<string, unknown> = { ...state.metadata };

    const processors = this.getStageProcessors('before-store', {
      mime,
      purpose: state.context.purpose,
      originalName,
    });

    for (const proc of processors) {
      const timeoutMs = Math.min(
        proc.timeoutMs ?? STAGE_MAX_TIMEOUT_MS['before-store'],
        STAGE_MAX_TIMEOUT_MS['before-store'],
      );
      const res = await runWithTimeout(
        proc.run({
          stage: 'before-store',
          originalName,
          mime,
          sizeBytes: buffer.length,
          buffer,
          context: { ...state.context },
          metadata: { ...metadata },
        }),
        timeoutMs,
        proc.id,
      );
      if (res) {
        if (Buffer.isBuffer(res.buffer)) buffer = res.buffer;
        if (typeof res.originalName === 'string' && res.originalName.trim()) originalName = res.originalName;
        if (typeof res.mime === 'string' && res.mime.trim()) mime = res.mime;
        if (res.metadataPatch) Object.assign(metadata, res.metadataPatch);
      }
    }

    return { buffer, originalName, mime, metadata };
  }

  async runAfterStore(
    ctx: Omit<FileProcessorContext, 'stage'>,
    onBackgroundPatch?: (patch: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> {
    const metadataPatch: Record<string, unknown> = {};
    const processors = this.getStageProcessors('after-store', {
      mime: ctx.mime,
      purpose: ctx.context.purpose,
      originalName: ctx.originalName,
    });

    for (const proc of processors) {
      const timeoutMs = Math.min(
        proc.timeoutMs ?? STAGE_MAX_TIMEOUT_MS['after-store'],
        STAGE_MAX_TIMEOUT_MS['after-store'],
      );
      const execOne = async (): Promise<Record<string, unknown> | undefined> => {
        try {
          const res = await runWithTimeout(
            proc.run({
              ...ctx,
              stage: 'after-store',
              context: { ...ctx.context },
              metadata: { ...ctx.metadata, ...metadataPatch },
            }),
            timeoutMs,
            proc.id,
          );
          return res?.metadataPatch;
        } catch (err) {
          console.warn(
            `[FileProcessorRunner] after-store processor "${proc.id}" failed (fail-open):`,
            (err as Error).message,
          );
          return undefined;
        }
      };

      if (proc.background) {
        void this.backgroundSemaphore.run(async () => {
          const patch = await execOne();
          if (patch && Object.keys(patch).length > 0 && onBackgroundPatch) {
            onBackgroundPatch(patch);
          }
        });
      } else {
        const patch = await execOne();
        if (patch) Object.assign(metadataPatch, patch);
      }
    }

    return metadataPatch;
  }

  async runBeforeServe(ctx: Omit<FileProcessorContext, 'stage'>): Promise<Record<string, string>> {
    const safeHeaders: Record<string, string> = {};
    const processors = this.getStageProcessors('before-serve', {
      mime: ctx.mime,
      purpose: ctx.context.purpose,
      originalName: ctx.originalName,
    });

    for (const proc of processors) {
      const timeoutMs = Math.min(
        proc.timeoutMs ?? STAGE_MAX_TIMEOUT_MS['before-serve'],
        STAGE_MAX_TIMEOUT_MS['before-serve'],
      );
      try {
        const res = await runWithTimeout(
          proc.run({
            ...ctx,
            stage: 'before-serve',
            context: { ...ctx.context },
            metadata: { ...ctx.metadata },
          }),
          timeoutMs,
          proc.id,
        );
        if (res?.headers) {
          for (const [k, v] of Object.entries(res.headers)) {
            if (!RESERVED_SECURITY_HEADERS.has(k.toLowerCase()) && typeof v === 'string') {
              safeHeaders[k] = v;
            }
          }
        }
      } catch (err) {
        console.warn(
          `[FileProcessorRunner] before-serve processor "${proc.id}" failed (fail-open):`,
          (err as Error).message,
        );
      }
    }

    return safeHeaders;
  }
}
