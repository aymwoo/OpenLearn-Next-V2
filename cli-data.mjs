import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);

/**
 * 加载迁移器（`pnpm build` 产出的 `dist/cli-migrator.cjs`）。
 *
 * ## 为什么不再直接 `import('./packages/core/db/migrator.js')`
 *
 * 那条路径**在任何环境都不存在**：源码检出里只有 `migrator.ts`，发布包的 `files`
 * 清单里也只有 `dist/*` 与几个 `cli-*.mjs`。于是 `openlearn-next migrate status` /
 * `migrate rollback` 一旦走到加载点就抛 MODULE_NOT_FOUND —— 两条帮助里宣传的命令
 * 实际从未可用（`_migrations` 表不存在时会在更早的分支提前返回，把这个缺陷藏住了）。
 *
 * 现在与 `env-validation` 同法：构建期打成独立 CJS，运行时用 createRequire 载入
 * （而不是 `await import('...')`，后者会被 Vite/Vitest 在转换期静态解析）。
 *
 * 产物缺失时给出**可操作**的报错，而不是让用户对着 MODULE_NOT_FOUND 猜。
 */
export function loadCliMigrator() {
  const artifact = path.join(__dirname, 'dist', 'cli-migrator.cjs');
  if (!fs.existsSync(artifact)) {
    const error = new Error(
      `迁移器构建产物缺失：${artifact}\n` +
        '  源码检出请先执行 `pnpm build`（或 `bash scripts/build-cli-artifacts.sh`）；\n' +
        '  若你安装的是发布包，这属于打包缺陷，请反馈。',
    );
    error.code = 'CLI_MIGRATOR_ARTIFACT_MISSING';
    throw error;
  }
  return requireFromHere(artifact);
}

/**
 * 解析本地目标数据库路径
 * @param {string} [customPath]
 * @returns {string}
 */
export function resolveDbPath(customPath) {
  if (customPath) return path.resolve(customPath);
  if (process.env.OPENLEARN_DB_PATH) return path.resolve(process.env.OPENLEARN_DB_PATH);
  return path.join(os.homedir(), 'openlearn-next', 'data.db');
}

/**
 * 一键数据冷备
 * @param {string} [outputFile]
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, targetFile?: string, error?: string }>}
 */
export async function runBackup(outputFile, options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  const dbPath = resolveDbPath(options.dbPath);

  if (!fs.existsSync(dbPath)) {
    const msg = `数据库文件未找到: ${dbPath}`;
    log(`✗ 备份失败: ${msg}`);
    return { ok: false, error: msg };
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const isFull = Boolean(options.full);
  const defaultExt = isFull ? '.zip' : '.db';
  const target = outputFile
    ? path.resolve(outputFile)
    : path.resolve(process.cwd(), `openlearn_${isFull ? 'full_backup' : 'backup'}_${timestamp}${defaultExt}`);

  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (isFull) {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // 1. 内存/临时备份 SQLite 数据库
      const Database = (await import('better-sqlite3')).default;
      const tempDbPath = path.join(os.tmpdir(), `openlearn_temp_backup_${Date.now()}.db`);
      const db = new Database(dbPath, { readonly: true });
      await db.backup(tempDbPath);
      db.close();
      const dbBuffer = fs.readFileSync(tempDbPath);
      try {
        fs.unlinkSync(tempDbPath);
      } catch {}
      zip.file('data.db', dbBuffer);

      // 2. 递归打包 uploads 与 storage 目录
      const dataDir = process.env.OPENLEARN_DATA_DIR || path.dirname(dbPath);
      const uploadsDir = path.join(dataDir, 'uploads');
      const storageDir = path.join(dataDir, 'storage');

      const addDirToZip = (dir, prefix) => {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const itemPath = path.join(dir, item.name);
          const zipRel = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.isDirectory()) {
            addDirToZip(itemPath, zipRel);
          } else if (item.isFile()) {
            zip.file(zipRel, fs.readFileSync(itemPath));
          }
        }
      };

      addDirToZip(uploadsDir, 'uploads');
      addDirToZip(storageDir, 'storage');

      // 3. 元数据信息
      zip.file(
        'metadata.json',
        JSON.stringify(
          {
            version: '0.6.0',
            type: 'openlearn-full-backup',
            timestamp: Date.now(),
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      fs.writeFileSync(target, zipBuffer);
      const stat = fs.statSync(target);
      const sizeKb = Math.round(stat.size / 1024);
      log(`✓ 系统全量整包备份完成（数据库 + 课件 uploads + 作业 storage）！`);
      log(`  全量归档文件: ${target} (${sizeKb} KB)`);
      return { ok: true, targetFile: target };
    } catch (fullErr) {
      log(`✗ 全量备份生成失败: ${fullErr.message}`);
      return { ok: false, error: fullErr.message };
    }
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });
    await db.backup(target);
    db.close();

    const stat = fs.statSync(target);
    const sizeKb = Math.round(stat.size / 1024);
    log(`✓ 数据库冷备完成！`);
    log(`  快照文件: ${target} (${sizeKb} KB)`);
    return { ok: true, targetFile: target };
  } catch (err) {
    // 降级为物理文件复制
    try {
      fs.copyFileSync(dbPath, target);
      const stat = fs.statSync(target);
      const sizeKb = Math.round(stat.size / 1024);
      log(`✓ 数据库文件冷备完成（直接镜像模式）：${target} (${sizeKb} KB)`);
      return { ok: true, targetFile: target };
    } catch (copyErr) {
      log(`✗ 备份写入失败: ${copyErr.message}`);
      return { ok: false, error: copyErr.message };
    }
  }
}

/**
 * 数据安全回滚与还原（支持 .db 镜像与 .zip 全量整包）
 * @param {string} sourceFile
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
/**
 * 读取 SQLite 快照的完整性信息。
 *
 * 迁移失败后的 `pre_migration_*.db` 与 `backup` 产物都是普通 SQLite 镜像：
 * 直接覆盖主库前必须确认它真的能打开、`integrity_check` 通过，否则「恢复」
 * 会用一个坏文件替掉还能用的库。
 *
 * @param {string} filePath
 * @returns {Promise<{ ok: boolean, error?: string, migrations: string[] }>}
 */
async function inspectSqliteSnapshot(filePath) {
  const Database = (await import('better-sqlite3')).default;
  let db;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    if (String(integrity).toLowerCase() !== 'ok') {
      return { ok: false, error: `快照完整性校验失败: ${integrity}`, migrations: [] };
    }
    let migrations = [];
    try {
      migrations = db
        .prepare('SELECT name FROM _migrations ORDER BY name')
        .all()
        .map((row) => String(row.name));
    } catch {
      // 极早期/非平台数据库没有 _migrations —— 交给迁移兼容性检查给出明确提示。
      migrations = [];
    }
    return { ok: true, migrations };
  } catch (err) {
    return { ok: false, error: `无法打开快照（不是有效的 SQLite 数据库？）: ${err.message}`, migrations: [] };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** 当前代码自带的迁移文件（用于判断快照是否来自「未来版本」）。 */
function listCurrentMigrationNames(migrationsDir) {
  try {
    // DB 里 `_migrations.name` 存的是**去扩展名**的迁移名（migrator 的约定）。
    return fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.replace(/\.sql$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 迁移兼容性预检。
 *
 * - 快照里有当前代码不认识的迁移 → 快照来自更新版本，恢复后再启动会触发
 *   checksum/结构不匹配。默认拒绝，`--force` 显式放行（管理员可能就是要回滚）。
 * - 当前代码有快照没有的迁移 → 正常升级路径，下次启动会补上。
 */
function checkMigrationCompatibility(snapshotMigrations, migrationsDir) {
  const current = new Set(listCurrentMigrationNames(migrationsDir));
  const unknown = snapshotMigrations.filter((name) => current.size > 0 && !current.has(name));
  const pending = [...current].filter((name) => !snapshotMigrations.includes(name));
  return { unknown, pending };
}

/** 用 VACUUM INTO 生成一致性安全副本（直接 copy 会漏掉 WAL 里未 checkpoint 的页）。 */
async function createSafetySnapshot(dbPath, backupsDir) {
  const Database = (await import('better-sqlite3')).default;
  fs.mkdirSync(backupsDir, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const target = path.join(backupsDir, `pre_restore_${stamp}.db`);
  const db = new Database(dbPath, { readonly: true });
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return target;
}

/**
 * 安全还原（Issue #150 加固）。
 *
 * 与旧实现的区别：
 * 1. 先校验快照（SQLite 头 + `PRAGMA integrity_check`）再动主库；
 * 2. 迁移兼容性预检：快照来自更新版本时默认拒绝（`force: true` 放行）；
 * 3. 安全副本用 `VACUUM INTO` 生成，落在 `BACKUP_DIR`（默认 `<dbDir>/backups`），
 *    失败时可原路恢复；
 * 4. 原子替换：先写临时文件再 `rename`，避免半截库；替换后清理 `-wal`/`-shm`。
 *
 * 停服仍是操作者的责任：SQLite 文件被运行中的进程持有替换会得到旧句柄。
 *
 * @param {string} [sourceFile] `.db` 快照 / 全量 `.zip` 备份
 * @param {Object} [options]
 * @param {string} [options.dbPath]
 * @param {boolean} [options.force] 允许恢复「快照迁移比当前代码更新」的库
 * @param {string} [options.migrationsDir]
 * @param {string} [options.backupsDir]
 * @param {boolean} [options.silent]
 */
export async function runRestore(sourceFile, options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  if (!sourceFile) {
    const msg =
      '未指定待还原的备份文件。用法: npx openlearn-next restore <backup.db|backup.zip|--snapshot pre_migration_xxx.db>';
    log(`✗ ${msg}`);
    return { ok: false, error: msg };
  }

  const src = path.resolve(sourceFile);
  if (!fs.existsSync(src)) {
    const msg = `指定的备份文件不存在: ${src}`;
    log(`✗ ${msg}`);
    return { ok: false, error: msg };
  }

  const dbPath = resolveDbPath(options.dbPath);
  const dbDir = path.dirname(dbPath);
  const migrationsDir = options.migrationsDir || path.resolve(process.cwd(), 'migrations');
  const backupsDir = options.backupsDir || process.env.BACKUP_DIR || path.join(dbDir, 'backups');
  fs.mkdirSync(dbDir, { recursive: true });

  // 识别文件类型：校验头字节（PK 为 Zip 压缩包，SQLite 为数据库镜像）
  let isZip = false;
  try {
    const fd = fs.openSync(src, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      isZip = true;
    } else if (!buffer.toString('utf-8').startsWith('SQLite format 3')) {
      const msg = `文件既非 SQLite 数据库镜像亦非合法的 OpenLearn 备份 ZIP: ${src}`;
      log(`✗ ${msg}`);
      return { ok: false, error: msg };
    }
  } catch (err) {
    log(`✗ 读取备份文件头失败: ${err.message}`);
    return { ok: false, error: err.message };
  }

  // ── 1. 把待恢复的数据库落到临时文件并校验 ───────────────────────────────
  const stagePath = path.join(dbDir, `.restore_stage_${process.pid}_${Date.now()}.db`);
  let extraction = null;
  try {
    if (isZip) {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(fs.readFileSync(src));
      const dbEntry = zip.file('data.db');
      if (!dbEntry) throw new Error('ZIP 归档中未找到 data.db 数据库主体');
      fs.writeFileSync(stagePath, await dbEntry.async('nodebuffer'));
      extraction = zip;
    } else {
      fs.copyFileSync(src, stagePath);
    }

    const inspection = await inspectSqliteSnapshot(stagePath);
    if (!inspection.ok) {
      const msg = inspection.error || '快照校验失败';
      log(`✗ ${msg}`);
      return { ok: false, error: msg };
    }

    // ── 2. 迁移兼容性预检 ────────────────────────────────────────────────
    const { unknown, pending } = checkMigrationCompatibility(inspection.migrations, migrationsDir);
    if (unknown.length > 0) {
      const msg =
        `快照包含当前代码不认识的迁移（来自更新版本？）：${unknown.join(', ')}。` +
        '恢复后再启动会触发结构与 checksum 不匹配；确认要回滚请加 --force。';
      if (!options.force) {
        log(`✗ ${msg}`);
        return { ok: false, error: msg, unknownMigrations: unknown };
      }
      log(`⚠ ${msg}（--force 已放行）`);
    }
    if (pending.length > 0) {
      log(`ℹ 快照缺少 ${pending.length} 条当前迁移，恢复后首次启动会自动补齐`);
    }

    // ── 3. 安全副本 ─────────────────────────────────────────────────────
    let safetyBackup;
    if (fs.existsSync(dbPath)) {
      safetyBackup = await createSafetySnapshot(dbPath, backupsDir);
      log(`ℹ 已创建恢复前安全副本: ${safetyBackup}`);
    }

    // ── 4. 原子替换 + 清理 WAL/SHM ──────────────────────────────────────
    fs.renameSync(stagePath, dbPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${suffix}`;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }

    // zip 备份里的 uploads/ 与 storage/ 一并还原（沿用旧行为）
    if (extraction) {
      const dataDir = process.env.OPENLEARN_DATA_DIR || dbDir;
      let extractedCount = 0;
      for (const [relPath, file] of Object.entries(extraction.files)) {
        if (file.dir) continue;
        if (relPath.startsWith('uploads/') || relPath.startsWith('storage/')) {
          const dest = path.join(dataDir, relPath);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, await file.async('nodebuffer'));
          extractedCount++;
        }
      }
      log(`✓ 全量整包还原成功！数据库与 ${extractedCount} 个资源文件已写入 ${dataDir}`);
    } else {
      log(`✓ 数据库还原成功！已切换为 ${src} 的数据。`);
    }

    return {
      ok: true,
      restoredFrom: src,
      safetyBackup,
      migrations: inspection.migrations.length,
      pendingMigrations: pending.length,
    };
  } catch (err) {
    log(`✗ 还原失败: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    if (fs.existsSync(stagePath)) {
      try {
        fs.unlinkSync(stagePath);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 命令行一键重置管理员 (admin) 密码
 * @param {string} [newPassword='admin']
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function generateResetPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  if (!/[A-Za-z]/.test(out) || !/[0-9]/.test(out)) out = `${out.slice(0, 18)}a7`;
  return out;
}

export async function runResetAdmin(newPassword, options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  const dbPath = resolveDbPath(options.dbPath);
  const generated = newPassword === undefined || newPassword === null || String(newPassword).length === 0;
  const password = generated ? generateResetPassword() : String(newPassword);

  if (!fs.existsSync(dbPath)) {
    const msg = `数据库尚未初始化 (${dbPath})。请先启动一次平台，口令来自环境变量或 storage/bootstrap-credentials.txt。`;
    log(`ℹ ${msg}`);
    return { ok: false, error: msg };
  }

  try {
    let hash;
    try {
      const bcrypt = (await import('bcryptjs')).default;
      hash = bcrypt.hashSync(password, 10);
    } catch {
      const nodeCrypto = await import('node:crypto');
      hash = nodeCrypto.createHash('sha256').update(password).digest('hex');
    }

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);

    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!tableCheck) {
      const msg = `数据库尚未初始化 users 数据表 (${dbPath})。请先启动一次平台初始化数据表。`;
      log(`ℹ ${msg}`);
      db.close();
      return { ok: false, error: msg };
    }

    const hasMustChange = db
      .prepare('PRAGMA table_info(users)')
      .all()
      .some((col) => col.name === 'must_change_password');
    const mustChange = password === 'admin' || generated ? 1 : 0;
    const updateSql = hasMustChange
      ? 'UPDATE users SET password_hash = ?, must_change_password = ? WHERE username = ?'
      : 'UPDATE users SET password_hash = ? WHERE username = ?';
    const updateArgs = hasMustChange ? [hash, mustChange, 'admin'] : [hash, 'admin'];
    const updateRes = db.prepare(updateSql).run(...updateArgs);

    if (updateRes.changes === 0) {
      if (hasMustChange) {
        db.prepare(
          'INSERT INTO users (id, username, password_hash, role, name, created_at, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(`usr_admin_${Date.now()}`, 'admin', hash, 'administrator', 'System Admin', Date.now(), mustChange);
      } else {
        db.prepare(
          'INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(`usr_admin_${Date.now()}`, 'admin', hash, 'administrator', 'System Admin', Date.now());
      }
      log(`✓ 管理员账号不存在，已新建管理员账号 admin。口令：${password}`);
    } else {
      log(`✓ 管理员 (admin) 口令已重置。口令：${password}`);
    }
    if (mustChange) {
      log('  该口令登录后必须立即修改。不要把口令设成用户名 admin。');
    }

    db.close();
    return { ok: true };
  } catch (err) {
    log(`✗ 重置密码失败: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * 命令行插件状态速查
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, plugins?: Array<any>, error?: string }>}
 */
export async function runPluginsList(options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  const dbPath = resolveDbPath(options.dbPath);

  if (!fs.existsSync(dbPath)) {
    log(`数据库文件尚未创建 (${dbPath})，暂无插件安装记录。`);
    return { ok: true, plugins: [] };
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    // 检查 plugins 表是否存在
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugins'").get();
    if (!tableCheck) {
      log(`未检测到 plugins 数据表，平台尚未加载插件体系。`);
      db.close();
      return { ok: true, plugins: [] };
    }

    const rows = db.prepare('SELECT * FROM plugins ORDER BY id ASC').all();
    db.close();

    const plugins = rows.map((p) => {
      let version = '1.0.0';
      if (p.manifest) {
        try {
          const parsed = JSON.parse(p.manifest);
          if (parsed.version) version = parsed.version;
        } catch {}
      }
      return {
        id: p.id,
        name: p.name,
        version,
        status: p.status,
        loader_version: p.loader_version || p.execution_mode || 'inline',
      };
    });

    if (!options.silent) {
      const bold = '\x1b[1m';
      const green = '\x1b[32m';
      const yellow = '\x1b[33m';
      const cyan = '\x1b[36m';
      const reset = '\x1b[0m';

      console.log(`\n${bold}${cyan}已安装插件清单 (${plugins.length} 个):${reset}`);
      console.log(`┌──────────────────────────────────────────────┬─────────┬──────────┬──────────┐`);
      console.log(
        `│ ${bold}Plugin ID${reset}${' '.repeat(37)}│ ${bold}Version${reset} │ ${bold}Status${reset}   │ ${bold}Mode${reset}     │`,
      );
      console.log(`├──────────────────────────────────────────────┼─────────┼──────────┼──────────┤`);

      for (const p of plugins) {
        const idCol = p.id.padEnd(44);
        const verCol = (p.version || '1.0.0').padEnd(7);
        const statusColor = p.status === 'active' ? green : yellow;
        const statusCol = `${statusColor}${p.status.padEnd(8)}${reset}`;
        const modeCol = (p.loader_version || 'inline').padEnd(8);
        console.log(`│ ${idCol} │ ${verCol} │ ${statusCol} │ ${modeCol} │`);
      }
      console.log(`└──────────────────────────────────────────────┴─────────┴──────────┴──────────┘\n`);
    }

    return { ok: true, plugins };
  } catch (err) {
    log(`✗ 查询插件失败: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * 查看数据库迁移状态清单 (已应用 / 待应用)
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, applied?: Array<any>, pending?: Array<any>, error?: string }>}
 */
export async function runMigrateStatus(options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  const dbPath = resolveDbPath(options.dbPath);

  if (!fs.existsSync(dbPath)) {
    log(`✗ 数据库文件未找到: ${dbPath}`);
    return { ok: false, error: 'Database file not found' };
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true });

    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'").get();
    if (!tableCheck) {
      log(`ℹ 数据库尚未执行过版本化迁移 (_migrations 表未建立)。`);
      db.close();
      return { ok: true, applied: [], pending: [] };
    }

    const appliedRows = db.prepare('SELECT name, applied_at, checksum FROM _migrations ORDER BY applied_at ASC').all();
    db.close();

    const { loadMigrationsFromDirectory, getDefaultMigrationsDir } = loadCliMigrator();
    const allMigrations = loadMigrationsFromDirectory(getDefaultMigrationsDir());
    const appliedSet = new Set(appliedRows.map((r) => r.name));
    const pending = allMigrations.filter((m) => !appliedSet.has(m.name));

    if (!options.silent) {
      const bold = '\x1b[1m';
      const green = '\x1b[32m';
      const yellow = '\x1b[33m';
      const cyan = '\x1b[36m';
      const reset = '\x1b[0m';

      console.log(`\n${bold}${cyan}数据库迁移版本化状态 (总计 ${allMigrations.length} 个迁移脚本):${reset}`);
      console.log(`  ${green}✓ 已应用 (${appliedRows.length} 个):${reset}`);
      for (const row of appliedRows) {
        const time = new Date(row.applied_at).toLocaleString();
        console.log(`    ${green}●${reset} ${row.name.padEnd(35)} (应用时间: ${time})`);
      }
      if (pending.length > 0) {
        console.log(`\n  ${yellow}○ 待应用 (${pending.length} 个):${reset}`);
        for (const m of pending) {
          console.log(`    ${yellow}○${reset} ${m.name}`);
        }
      } else {
        console.log(`\n  ${green}✓ 架构版本全部对齐，无待执行的增量迁移。${reset}\n`);
      }
    }

    return { ok: true, applied: appliedRows, pending };
  } catch (err) {
    log(`✗ 查询迁移状态失败: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * 安全回滚最近一次应用的单项迁移 (按 -- DOWN 逆操作)
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, rolledBack?: string, error?: string }>}
 */
export async function runMigrateRollback(options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  const dbPath = resolveDbPath(options.dbPath);

  if (!fs.existsSync(dbPath)) {
    log(`✗ 数据库文件未找到: ${dbPath}`);
    return { ok: false, error: 'Database file not found' };
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);

    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'").get();
    if (!tableCheck) {
      log(`✗ 数据库中未找到 _migrations 元表，无法执行回滚。`);
      db.close();
      return { ok: false, error: 'No _migrations table' };
    }

    const lastRow = db.prepare('SELECT name FROM _migrations ORDER BY applied_at DESC LIMIT 1').get();
    if (!lastRow) {
      log(`ℹ 数据库中当前暂无已应用的迁移记录可供回滚。`);
      db.close();
      return { ok: true };
    }

    const { loadMigrationsFromDirectory, getDefaultMigrationsDir, rollbackMigration } = loadCliMigrator();
    const allMigrations = loadMigrationsFromDirectory(getDefaultMigrationsDir());
    const targetMigration = allMigrations.find((m) => m.name === lastRow.name);

    if (!targetMigration) {
      log(`✗ 未在本地 migrations 目录中找到 "${lastRow.name}.sql"，无法获取 DOWN 段执行回滚。`);
      db.close();
      return { ok: false, error: `Migration file ${lastRow.name} not found` };
    }

    rollbackMigration(db, targetMigration);
    db.close();
    log(`✓ 成功回滚迁移: ${targetMigration.name} (已执行 DOWN 逆操作并清理 _migrations 记录)`);
    return { ok: true, rolledBack: targetMigration.name };
  } catch (err) {
    log(`✗ 回滚迁移失败: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
