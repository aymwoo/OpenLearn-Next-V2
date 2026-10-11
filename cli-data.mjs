import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
export async function runRestore(sourceFile, options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  if (!sourceFile) {
    const msg = '未指定待还原的备份文件。用法: npx openlearn-next restore <backup.db|backup.zip>';
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
    } else {
      const headerStr = buffer.toString('utf-8');
      if (!headerStr.startsWith('SQLite format 3')) {
        const msg = `文件既非 SQLite 数据库镜像亦非合法的 OpenLearn 备份 ZIP: ${src}`;
        log(`✗ ${msg}`);
        return { ok: false, error: msg };
      }
    }
  } catch (err) {
    log(`✗ 读取备份文件头失败: ${err.message}`);
    return { ok: false, error: err.message };
  }

  // 创建自动回滚副本
  if (fs.existsSync(dbPath)) {
    const bakFile = `${dbPath}.bak_${Date.now()}`;
    fs.copyFileSync(dbPath, bakFile);
    log(`ℹ 已为现有数据库创建安全回滚镜像: ${bakFile}`);
  }

  if (isZip) {
    try {
      const JSZip = (await import('jszip')).default;
      const zipData = fs.readFileSync(src);
      const zip = await JSZip.loadAsync(zipData);

      const dbEntry = zip.file('data.db');
      if (!dbEntry) {
        throw new Error('ZIP 归档中未找到 data.db 数据库主体');
      }

      const dbBuffer = await dbEntry.async('nodebuffer');
      fs.writeFileSync(dbPath, dbBuffer);

      // 解压 uploads 与 storage 目录
      const dataDir = process.env.OPENLEARN_DATA_DIR || path.dirname(dbPath);
      let extractedCount = 0;

      for (const [relPath, file] of Object.entries(zip.files)) {
        if (file.dir) continue;
        if (relPath.startsWith('uploads/') || relPath.startsWith('storage/')) {
          const dest = path.join(dataDir, relPath);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, await file.async('nodebuffer'));
          extractedCount++;
        }
      }

      // 清理旧的 WAL 与 SHM
      const wal = `${dbPath}-wal`;
      const shm = `${dbPath}-shm`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);

      log(`✓ 全量整包还原成功！数据库与 ${extractedCount} 个资源文件已成功写入 ${dataDir}`);
      return { ok: true };
    } catch (zipErr) {
      log(`✗ 解压还原归档失败: ${zipErr.message}`);
      return { ok: false, error: zipErr.message };
    }
  }

  try {
    fs.copyFileSync(src, dbPath);
    // 清理旧的 WAL 与 SHM
    const wal = `${dbPath}-wal`;
    const shm = `${dbPath}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);

    log(`✓ 数据库还原成功！当前主库已切换为 ${src} 的数据。`);
    return { ok: true };
  } catch (err) {
    log(`✗ 覆盖写入数据库失败: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/**
 * 命令行一键重置管理员 (admin) 密码
 * @param {string} [newPassword='admin']
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runResetAdmin(newPassword = 'admin', options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  const dbPath = resolveDbPath(options.dbPath);

  if (!fs.existsSync(dbPath)) {
    const msg = `数据库尚未初始化 (${dbPath})。请直接启动一次平台即可生成默认 admin/admin 账号。`;
    log(`ℹ ${msg}`);
    return { ok: false, error: msg };
  }

  try {
    let hash;
    try {
      const bcrypt = (await import('bcryptjs')).default;
      hash = bcrypt.hashSync(newPassword, 10);
    } catch {
      const crypto = await import('node:crypto');
      hash = crypto.createHash('sha256').update(newPassword).digest('hex');
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

    const updateRes = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'admin');

    if (updateRes.changes === 0) {
      // 若数据库中无 admin 用户，则插入
      db.prepare(
        'INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(`usr_admin_${Date.now()}`, 'admin', hash, 'administrator', 'System Admin', Date.now());
      log(`✓ 管理员账号不存在，已新建管理员账号: admin (密码: ${newPassword})`);
    } else {
      log(`✓ 管理员 (admin) 密码已成功重置为: ${newPassword}`);
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

    const { loadMigrationsFromDirectory, getDefaultMigrationsDir } = await import('./packages/core/db/migrator.js');
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

    const { loadMigrationsFromDirectory, getDefaultMigrationsDir, rollbackMigration } = await import(
      './packages/core/db/migrator.js'
    );
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
