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
  const target = outputFile
    ? path.resolve(outputFile)
    : path.resolve(process.cwd(), `openlearn_backup_${timestamp}.db`);

  fs.mkdirSync(path.dirname(target), { recursive: true });

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
 * 数据安全回滚与还原
 * @param {string} sourceFile
 * @param {Object} [options]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runRestore(sourceFile, options = {}) {
  const log = options.silent ? () => {} : (msg) => console.log(`[openlearn-next] ${msg}`);
  if (!sourceFile) {
    const msg = '未指定待还原的备份文件。用法: npx openlearn-next restore <backup.db>';
    log(`✗ ${msg}`);
    return { ok: false, error: msg };
  }

  const src = path.resolve(sourceFile);
  if (!fs.existsSync(src)) {
    const msg = `指定的备份文件不存在: ${src}`;
    log(`✗ ${msg}`);
    return { ok: false, error: msg };
  }

  // 校验 SQLite 文件头 (Magic Header: "SQLite format 3\0")
  try {
    const fd = fs.openSync(src, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    const headerStr = buffer.toString('utf-8');
    if (!headerStr.startsWith('SQLite format 3')) {
      const msg = `文件并非有效的 SQLite 数据库备份: ${src}`;
      log(`✗ ${msg}`);
      return { ok: false, error: msg };
    }
  } catch (err) {
    log(`✗ 读取备份文件头失败: ${err.message}`);
    return { ok: false, error: err.message };
  }

  const dbPath = resolveDbPath(options.dbPath);
  const dbDir = path.dirname(dbPath);
  fs.mkdirSync(dbDir, { recursive: true });

  // 创建自动回滚副本
  if (fs.existsSync(dbPath)) {
    const bakFile = `${dbPath}.bak_${Date.now()}`;
    fs.copyFileSync(dbPath, bakFile);
    log(`ℹ 已为现有数据库创建安全回滚镜像: ${bakFile}`);
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
      db.prepare('INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`usr_admin_${Date.now()}`, 'admin', hash, 'administrator', 'System Admin', Date.now());
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
      console.log(`│ ${bold}Plugin ID${reset}${' '.repeat(37)}│ ${bold}Version${reset} │ ${bold}Status${reset}   │ ${bold}Mode${reset}     │`);
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
