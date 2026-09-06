import { existsSync, readdirSync, rmSync, unlinkSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import os from 'node:os';

/**
 * 安全清理 openlearn-next 在本地的各类运行与包缓存
 *
 * @param {Object} options
 * @param {boolean} [options.all]   是否全量清理（NPX 缓存 + 运行缓存 + 重置数据库）
 * @param {boolean} [options.npx]   是否仅清理 NPX 缓存
 * @param {boolean} [options.db]    是否仅清理/重置本地数据库
 * @param {string}  [options.customDataDir] 自定义数据目录（可选，主要供测试用）
 * @param {string}  [options.customNpxDir]  自定义 NPX 缓存目录（可选，主要供测试用）
 * @param {boolean} [options.silent] 是否静默输出
 * @returns {{ npxCleaned: number, dbReset: boolean, tempCleaned: string[] }}
 */
export function runClean(options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  const results = {
    npxCleaned: 0,
    dbReset: false,
    tempCleaned: [],
  };

  const isAll = Boolean(options.all);
  const isOnlyNpx = Boolean(options.npx) && !isAll;
  const isOnlyDb = Boolean(options.db) && !isAll;
  const isDefault = !isOnlyNpx && !isOnlyDb && !isAll;

  // ── 1. 清理 NPX 历史包缓存 ─────────────────────────────────────────────
  if (isAll || isOnlyNpx || isDefault) {
    const npxDir = options.customNpxDir ? resolve(options.customNpxDir) : join(os.homedir(), '.npm', '_npx');
    if (existsSync(npxDir)) {
      try {
        const entries = readdirSync(npxDir);
        for (const entry of entries) {
          const entryPath = join(npxDir, entry);
          try {
            if (statSync(entryPath).isDirectory()) {
              const targetPackage = join(entryPath, 'node_modules', 'openlearn-next');
              if (existsSync(targetPackage)) {
                let ver = 'unknown';
                try {
                  const pkgData = JSON.parse(readFileSync(join(targetPackage, 'package.json'), 'utf-8'));
                  ver = pkgData.version || 'unknown';
                } catch {
                  // ignore JSON parse error
                }
                rmSync(entryPath, { recursive: true, force: true });
                results.npxCleaned++;
                log(`✓ 已清理 NPX 旧版缓存: ~/.npm/_npx/${entry} (openlearn-next@${ver})`);
              }
            }
          } catch (err) {
            // 单个目录清理失败不阻断整体流程
          }
        }
      } catch (err) {
        log(`⚠ 读取 NPX 缓存目录失败: ${err.message}`);
      }
    }
    if (results.npxCleaned === 0 && !options.silent) {
      log(`ℹ 未发现残留的 openlearn-next NPX 包缓存。`);
    }
  }

  // ── 2. 清理本地运行与数据库缓存 ─────────────────────────────────────────
  if (isAll || isOnlyDb || isDefault) {
    const dataDir = options.customDataDir
      ? resolve(options.customDataDir)
      : (process.env.OPENLEARN_DB_PATH
          ? dirname(resolve(process.env.OPENLEARN_DB_PATH))
          : join(os.homedir(), 'openlearn-next'));

    const dbPath = process.env.OPENLEARN_DB_PATH
      ? resolve(process.env.OPENLEARN_DB_PATH)
      : join(dataDir, 'data.db');

    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;

    if (existsSync(dataDir)) {
      // (a) 数据库重置模式
      if (isAll || isOnlyDb) {
        if (existsSync(dbPath)) {
          unlinkSync(dbPath);
          results.dbReset = true;
          log(`✓ 已重置本地数据库: ${dbPath}`);
        }
        if (existsSync(walPath)) {
          unlinkSync(walPath);
          log(`✓ 已清理 SQLite 预写日志: ${walPath}`);
        }
        if (existsSync(shmPath)) {
          unlinkSync(shmPath);
          log(`✓ 已清理 SQLite 共享内存: ${shmPath}`);
        }
        log(`ℹ 数据库已重置，下次启动将全新自动初始化。`);
      } else {
        // (b) 默认安全清理：清理 WAL 与临时运行日志，保留主库数据
        if (existsSync(walPath)) {
          unlinkSync(walPath);
          results.tempCleaned.push(walPath);
          log(`✓ 已清理 SQLite 临时预写日志: ${walPath}`);
        }
        if (existsSync(shmPath)) {
          unlinkSync(shmPath);
          results.tempCleaned.push(shmPath);
          log(`✓ 已清理 SQLite 临时共享内存: ${shmPath}`);
        }
        if (!options.silent) {
          log(`ℹ 本地数据库核心数据已保留 (${dbPath})。如需完全重置数据库，请添加 --db 或 --all 参数。`);
        }
      }

      // (c) 清理临时子目录
      const tempFolders = ['temp', 'scratch', 'cache'];
      for (const folder of tempFolders) {
        const folderPath = join(dataDir, folder);
        if (existsSync(folderPath)) {
          rmSync(folderPath, { recursive: true, force: true });
          results.tempCleaned.push(folderPath);
          log(`✓ 已清理临时数据目录: ${folderPath}`);
        }
      }
    }
  }

  log(`缓存清理完成。`);
  return results;
}
