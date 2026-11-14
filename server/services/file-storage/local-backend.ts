import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FileStorageBackend } from '../../../packages/core/di/interfaces.js';
import { getDataDir } from '../../utils/paths.js';
import { isPathInsideRoot } from '../../utils/path-guard.js';
import { assertValidStorageKey } from './layout-policy.js';

function isMissingFile(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ENOENT');
}

export class LocalFileStorage implements FileStorageBackend {
  readonly id = 'local';
  readonly displayName = '本地磁盘存储 (Local Disk)';
  readonly description = 'Stores uploaded files under <OPENLEARN_DATA_DIR>/files using configured layout keys.';
  readonly capabilities = {
    supportsRange: true,
    supportsPresignedUrl: false,
    externalBacked: false,
  };

  readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = path.resolve(rootDir ?? path.join(getDataDir(), 'files'));
  }

  resolveLocalPath(key: string): string {
    const cleanKey = assertValidStorageKey(key);
    const target = path.resolve(this.rootDir, ...cleanKey.split('/'));
    if (!isPathInsideRoot(this.rootDir, target)) {
      throw new Error(`Resolved storage path escapes local root: ${key}`);
    }
    return target;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveLocalPath(key);
    const dir = path.dirname(target);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpPath = `${target}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    await fs.promises.writeFile(tmpPath, data);
    try {
      await fs.promises.rename(tmpPath, target);
    } catch (err) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const target = this.resolveLocalPath(key);
    try {
      await fs.promises.access(target, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    const target = this.resolveLocalPath(key);
    try {
      const st = await fs.promises.stat(target);
      if (!st.isFile()) return null;
      return { sizeBytes: st.size };
    } catch {
      return null;
    }
  }

  readStream(key: string, range?: { start: number; end: number }): NodeJS.ReadableStream {
    const target = this.resolveLocalPath(key);
    return fs.createReadStream(target, range ? { start: range.start, end: range.end } : undefined);
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const src = this.resolveLocalPath(fromKey);
    const dest = this.resolveLocalPath(toKey);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    const tmpPath = `${dest}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    await fs.promises.copyFile(src, tmpPath);
    try {
      await fs.promises.rename(tmpPath, dest);
    } catch (err) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveLocalPath(key);
    try {
      await fs.promises.unlink(target);
    } catch (err: unknown) {
      if (isMissingFile(err)) return;
      throw err;
    }
  }
}
