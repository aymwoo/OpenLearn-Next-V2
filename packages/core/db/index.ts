import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { writeFileSync } from 'fs';
import bcrypt from 'bcryptjs';
import { loadMigrationsFromDirectory, runMigrations, getDefaultMigrationsDir } from './migrator.js';
import { applyStartupDataMigrations } from './class-passcode-crypto.js';
import { purgeExpiredEvents } from './event-retention.js';
import { purgeAllExpiredData } from './retention-policy.js';
import { encryptStoredPlaintextApiKeys, logEncryptionKeyStartupWarning } from '../di/api-key-crypto.js';

const BCRYPT_ROUNDS = 10;

/** 使用 bcrypt 哈希密码 */
export function hashPassword(pwd: string): string {
  return bcrypt.hashSync(pwd, BCRYPT_ROUNDS);
}

const SEED_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 生成不含易混字符、且同时含字母与数字的初始口令。 */
export function generateUnambiguousPassword(length = 20): string {
  const size = Math.max(12, length);
  const bytes = crypto.randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i++) out += SEED_PASSWORD_ALPHABET[bytes[i] % SEED_PASSWORD_ALPHABET.length];
  if (!/[A-Za-z]/.test(out) || !/[0-9]/.test(out)) {
    return `${out.slice(0, size - 2)}a7`;
  }
  return out;
}

export interface SeedCredential {
  password: string;
  mustChange: boolean;
  generated: boolean;
}

/**
 * 种子口令。
 * - allowWellKnown：仅测试运行器（PLAYWRIGHT_TEST）保留与用户名相同的口令。
 * - 显式环境变量：使用调用方提供的值；若仍等于用户名，则必须改密。
 * - 否则随机生成，并要求首次登录后修改。
 */
export function resolveSeedCredential(
  username: string,
  options?: { envValue?: string | null; allowWellKnown?: boolean; vitestFallback?: boolean },
): SeedCredential {
  if (options?.allowWellKnown) {
    return { password: username, mustChange: false, generated: false };
  }
  const envValue = options?.envValue?.trim();
  if (envValue) {
    return { password: envValue, mustChange: envValue === username, generated: false };
  }
  if (options?.vitestFallback) {
    return { password: `Vitest-${username}-NotDefault9`, mustChange: false, generated: false };
  }
  return { password: generateUnambiguousPassword(20), mustChange: true, generated: true };
}

/**
 * 种子口令文件目录。与 server/utils/paths.ts 的 getStorageDir() 使用同一套优先级，
 * 避免容器把库挂在一处、口令文件却写到进程工作目录的另一个卷。
 */
export function resolveBootstrapCredentialDir(): string {
  if (process.env.OPENLEARN_DATA_DIR?.trim()) {
    return path.join(path.resolve(process.env.OPENLEARN_DATA_DIR.trim()), 'storage');
  }
  if (process.env.OPENLEARN_DB_PATH?.trim()) {
    return path.join(path.dirname(path.resolve(process.env.OPENLEARN_DB_PATH.trim())), 'storage');
  }
  return path.join(process.cwd(), 'storage');
}

function persistGeneratedSeedCredentials(lines: string[]): void {
  const banner =
    '[SECURITY] 已生成种子账号初始口令（首次登录后必须修改，明文只写这一次）：\n' +
    lines.map((line) => `  ${line}`).join('\n');
  console.warn(banner);
  const filePath = path.join(resolveBootstrapCredentialDir(), 'bootstrap-credentials.txt');
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
    console.warn(`[SECURITY] 初始口令已写入 ${filePath}（权限 600）。登录后请修改并删除该文件。`);
  } catch (err) {
    console.warn(`[SECURITY] 无法写入 ${filePath}，请从上方日志抄录初始口令。`, err);
  }
}

/** 验证密码（支持 bcrypt 和旧 SHA-256 双模式） */
export function verifyPassword(pwd: string, storedHash: string): { valid: boolean; needsUpgrade: boolean } {
  // bcrypt 哈希以 $2a$ / $2b$ / $2y$ 开头
  if (storedHash.startsWith('$2')) {
    return { valid: bcrypt.compareSync(pwd, storedHash), needsUpgrade: false };
  }
  // 旧 SHA-256 哈希
  const sha256Hash = crypto.createHash('sha256').update(pwd).digest('hex');
  if (sha256Hash === storedHash) {
    return { valid: true, needsUpgrade: true };
  }
  return { valid: false, needsUpgrade: false };
}

// Use import.meta.url directly — it's available at module scope in tsx ESM.
let dbPath: string;
if (process.env.OPENLEARN_DB_PATH) {
  dbPath = process.env.OPENLEARN_DB_PATH;
  mkdirSync(path.dirname(dbPath), { recursive: true });
} else if (process.env.VITEST) {
  const poolId = process.env.VITEST_POOL_ID || process.pid;
  const testDbDir = path.join(os.tmpdir(), 'openlearn_test_dbs');
  mkdirSync(testDbDir, { recursive: true });
  dbPath = path.join(testDbDir, `openlearn_test_${poolId}.db`);
} else {
  if (typeof __dirname !== 'undefined') {
    dbPath = path.join(__dirname, 'educational_os.db');
  } else {
    try {
      if (typeof import.meta !== 'undefined' && import.meta.url) {
        const __filename = fileURLToPath(import.meta.url);
        const __dir = path.dirname(__filename);
        dbPath = path.join(__dir, 'educational_os.db');
      } else {
        dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
      }
    } catch {
      dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
    }
  }
}

/** 配置主写连接 Pragma 性能参数（WAL 模式、64MB 缓存、5s 超时重试、内存临时存储） */
export function applyPragmas(instance: Database.Database): void {
  instance.pragma('journal_mode = WAL');
  instance.pragma('synchronous = NORMAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 5000');
  instance.pragma('cache_size = -64000'); // 64MB 专用缓存页
  instance.pragma('temp_store = MEMORY'); // 临时表与排序在内存中执行
  try {
    instance.pragma('mmap_size = 268435456'); // 256MB 内存映射 I/O
  } catch {
    // 忽略受限环境下的 mmap 异常
  }
}

/** 配置只读连接 Pragma 参数 */
export function applyReadPragmas(instance: Database.Database): void {
  instance.pragma('query_only = ON');
  instance.pragma('busy_timeout = 5000');
  instance.pragma('cache_size = -32000'); // 32MB 只读缓存
  instance.pragma('temp_store = MEMORY');
  try {
    instance.pragma('mmap_size = 268435456');
  } catch {
    // 忽略受限环境下的 mmap 异常
  }
}

export function getDbPath(): string {
  return dbPath;
}

/**
 * 端到端开关的两个字面量。与种子口令处的判断一致：
 * Playwright 配置写 `1`，历史调用也可能写 `true`。
 */
function isPlaywrightTestFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/**
 * 生产进程不得带着 PLAYWRIGHT_TEST 启动。
 *
 * 该变量会跳过默认口令门禁，并放宽登录、写入和 AI 限流。注释要求生产环境不要设置，
 * 但此前启动路径只读取它、不拒绝它。这里在迁移和监听之前抛出，进程不会进入服务。
 *
 * 只在 NODE_ENV 精确等于 `production` 时拒绝。未设置 NODE_ENV 的容器保持原行为，
 * 避免把开发或测试进程误判为生产。Vitest（NODE_ENV=test）和 Playwright 开发服务器不受影响。
 */
export function assertPlaywrightTestNotInProduction(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!isPlaywrightTestFlag(process.env.PLAYWRIGHT_TEST)) return;
  const message =
    '[SECURITY] FATAL: NODE_ENV=production 时禁止设置 PLAYWRIGHT_TEST=1 或 true。' +
    '该变量会关闭默认口令门禁并放宽限流。请从生产环境的 .env 与 PM2 ecosystem 中删除 PLAYWRIGHT_TEST 后重启。';
  console.error(message);
  throw new Error(message);
}

/**
 * 打包后的入口会先执行依赖初始化，再执行 server 里的 dotenv.config()。
 * 因此模块求值时进程环境里可能还没有 .env。nextTick 排在入口同步体之后、
 * startServer 第一次 await 恢复之前，监听尚未开始。
 * 测试运行器会自己改环境变量，不在这里登记延迟复查，避免误伤 Vitest。
 */
export function armPlaywrightProductionRecheck(): void {
  process.nextTick(() => {
    try {
      assertPlaywrightTestNotInProduction();
    } catch {
      process.exit(1);
    }
  });
}

/**
 * 基于 migrations/ 目录执行全量版本化迁移，并播种必要的初始超级管理员和默认提供商数据。
 * 这是数据库结构创建与升级的单一真实来源 (SSOT)。
 */
export function initializeDatabase(instance: Database.Database): void {
  assertPlaywrightTestNotInProduction();
  try {
    const migrationsDir = getDefaultMigrationsDir();
    const migrations = loadMigrationsFromDirectory(migrationsDir);
    if (migrations.length === 0) {
      throw new Error(`[DB SSOT] FATAL: 迁移目录 ${migrationsDir} 里没有 .sql 文件。拒绝在没有 schema 的库上启动。`);
    }
    runMigrations(instance, migrations);
    applyStartupDataMigrations(instance);
    // 结构迁移完成、对外提供解密之前：把历史明文 API Key 密封。
    // 逐行提交，崩溃后下次启动会补上剩余明文。
    const apiKeyMigration = encryptStoredPlaintextApiKeys(instance);
    if (apiKeyMigration.updated > 0) {
      console.log(
        `[Migration] 已加密 ${apiKeyMigration.updated} 条仍为明文的 AI Provider API Key（跳过已是密文 ${apiKeyMigration.skipped} 条）`,
      );
    }
    if (!process.env.VITEST) logEncryptionKeyStartupWarning();
    console.log(`[DB SSOT] 迁移已就绪（${migrations.length} 个文件，目录 ${migrationsDir}）`);
  } catch (err) {
    console.error('[DB SSOT] FATAL: 数据库迁移失败，进程将退出，不会在半迁移的库上提供服务。');
    console.error(err);
    throw err;
  }

  // 种子数据：管理员与教师。不再写入人人皆知的 admin/admin、teacher/teacher
  // （PLAYWRIGHT_TEST 除外，供既有端到端套件登录）。
  try {
    const countObj = instance.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    const allowWellKnown = isPlaywrightTestFlag(process.env.PLAYWRIGHT_TEST);
    const vitestFallback = Boolean(process.env.VITEST) && !allowWellKnown;
    if (countObj && countObj.cnt === 0) {
      const adminCred = resolveSeedCredential('admin', {
        envValue: process.env.OPENLEARN_ADMIN_PASSWORD,
        allowWellKnown,
        vitestFallback,
      });
      const teacherCred = resolveSeedCredential('teacher', {
        envValue: process.env.OPENLEARN_TEACHER_PASSWORD,
        allowWellKnown,
        vitestFallback,
      });
      const insertStmt = instance.prepare(
        'INSERT INTO users (id, username, password_hash, role, name, created_at, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      insertStmt.run(
        'usr_admin',
        'admin',
        hashPassword(adminCred.password),
        'administrator',
        'System Admin',
        Date.now(),
        adminCred.mustChange ? 1 : 0,
      );
      insertStmt.run(
        'usr_teacher',
        'teacher',
        hashPassword(teacherCred.password),
        'teacher',
        'Regular Teacher',
        Date.now(),
        teacherCred.mustChange ? 1 : 0,
      );
      const generated: string[] = [];
      if (adminCred.generated) generated.push(`admin ${adminCred.password}`);
      if (teacherCred.generated) generated.push(`teacher ${teacherCred.password}`);
      if (generated.length > 0) persistGeneratedSeedCredentials(generated);
    } else if (!allowWellKnown) {
      const seeded = instance
        .prepare('SELECT id, username, password_hash FROM users WHERE username IN (?, ?)')
        .all('admin', 'teacher') as { id: string; username: string; password_hash: string }[];
      for (const user of seeded) {
        if (!verifyPassword(user.username, user.password_hash).valid) continue;
        instance.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);
        console.warn(`[SECURITY] 账号 ${user.username} 仍是众所周知的默认口令。登录后只能改密或登出，直到密码被修改。`);
      }
    }
  } catch (e) {
    console.error('[DB SSOT] FATAL: 种子账号写入失败，拒绝启动。', e);
    throw e;
  }

  // 种子数据：默认 AI Providers
  try {
    const countObj = instance.prepare('SELECT COUNT(*) as cnt FROM ai_providers').get() as { cnt: number };
    if (countObj && countObj.cnt === 0) {
      const insertStmt = instance.prepare(
        'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      insertStmt.run(
        'prov_deepseek',
        'Deepseek',
        'https://api.deepseek.com/v1',
        '',
        'deepseek-chat',
        Date.now(),
        Date.now(),
      );
      insertStmt.run(
        'prov_minimax',
        'Minimax',
        'https://api.minimax.chat/v1',
        '',
        'abab6.5-chat',
        Date.now(),
        Date.now(),
      );
    }
  } catch (e) {
    console.error('Failed to seed default AI Providers:', e);
  }

  // 数据按多类别保留策略在启动时自动执行清理（0 表示禁用）。
  try {
    purgeAllExpiredData(instance);
  } catch (err) {
    console.error('[DB SSOT] 数据保留期自动清理异常:', err);
  }
}

export function createDatabase(customPath?: string): Database.Database {
  const targetPath = customPath || dbPath;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const instance = new Database(targetPath);
  applyPragmas(instance);
  initializeDatabase(instance);
  return instance;
}

export * from './backup-manager.js';
export * from './migrator.js';

export const db = new Database(dbPath);

// 应用高并发 WAL 与性能优化 Pragma
applyPragmas(db);

// 基于 migrations/ 执行单一来源数据库初始化
initializeDatabase(db);

// 入口的 dotenv / NODE_ENV 回落发生在本模块求值之后，这里再查一次，仍在 listen 之前。
if (!process.env.VITEST) {
  armPlaywrightProductionRecheck();
}

console.log('Database initialized at', dbPath);

// ============================================================================
// 读写分离连接池与并发 I/O 隔离设施 (P1-1)
// ============================================================================

export interface ReadPoolOptions {
  size?: number;
}

export class ReadConnectionPool {
  private pool: Database.Database[] = [];
  private rrIndex = 0;
  private readonly targetPath: string;
  private readonly poolSize: number;

  constructor(targetPath: string, options?: ReadPoolOptions) {
    this.targetPath = targetPath;
    const cpuCount = typeof os.cpus === 'function' ? os.cpus().length : 2;
    const defaultSize = Math.min(4, Math.max(2, cpuCount || 2));
    this.poolSize = options?.size ?? defaultSize;
  }

  /** 获取只读数据库连接实例（基于轮询调度复用池化连接） */
  public getConnection(): Database.Database {
    // 延迟初始化连接
    if (this.pool.length < this.poolSize) {
      try {
        const conn = new Database(this.targetPath, { readonly: true, fileMustExist: true });
        applyReadPragmas(conn);
        this.pool.push(conn);
        return conn;
      } catch {
        // 如果文件未就绪或受限，优雅回退到主连接
        return db;
      }
    }

    const activeConns = this.pool.filter((c) => c.open);
    if (activeConns.length === 0) {
      try {
        const conn = new Database(this.targetPath, { readonly: true, fileMustExist: true });
        applyReadPragmas(conn);
        this.pool = [conn];
        return conn;
      } catch {
        return db;
      }
    }

    const conn = activeConns[this.rrIndex % activeConns.length];
    this.rrIndex = (this.rrIndex + 1) % activeConns.length;
    return conn;
  }

  /** 关闭池内所有只读连接 */
  public closeAll(): void {
    for (const conn of this.pool) {
      try {
        if (conn.open) conn.close();
      } catch {
        // 忽略关闭异常
      }
    }
    this.pool = [];
  }

  /** 当前活跃连接数 */
  public get size(): number {
    return this.pool.filter((c) => c.open).length;
  }

  /** 连接池容量 */
  public get capacity(): number {
    return this.poolSize;
  }
}

/** 全局只读连接池单例 */
export const readPool = new ReadConnectionPool(dbPath);

/**
 * 获取只读数据库连接（从连接池轮询分配）
 * 适合用于只读查询，避免占用主写连接的排他句柄
 */
export function getReadDb(): Database.Database {
  return readPool.getConnection();
}

/**
 * 快速执行只读查询（返回列表），无锁并发不阻塞写事务
 */
export function queryRead<T = any>(sql: string, ...params: any[]): T[] {
  const readConn = getReadDb();
  return readConn.prepare(sql).all(...params) as T[];
}

/**
 * 快速执行只读单行查询
 */
export function queryReadOne<T = any>(sql: string, ...params: any[]): T | undefined {
  const readConn = getReadDb();
  return readConn.prepare(sql).get(...params) as T | undefined;
}

export type CheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE';

export interface CheckpointResult {
  busy: number;
  log: number;
  checkpointed: number;
}

/**
 * 手动或定期触发 WAL 日志刷盘（Checkpoint）
 * @param mode 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE'
 */
export function checkpoint(mode: CheckpointMode = 'PASSIVE'): CheckpointResult {
  try {
    const res = db.pragma(`wal_checkpoint(${mode})`) as any[];
    if (Array.isArray(res) && res.length > 0) {
      return {
        busy: res[0].busy ?? 0,
        log: res[0].log ?? 0,
        checkpointed: res[0].checkpointed ?? 0,
      };
    }
    return { busy: 0, log: 0, checkpointed: 0 };
  } catch {
    return { busy: 1, log: -1, checkpointed: -1 };
  }
}

/**
 * 安全关闭所有连接并对 WAL 文件执行归约截断
 */
export function closeDatabase(): void {
  try {
    checkpoint('TRUNCATE');
  } catch {
    // 忽略异常
  }
  readPool.closeAll();
  if (db.open) {
    db.close();
  }
}

/**
 * 大批量写操作微批切片执行器（Micro-batching）
 * 自动将大事务拆分成小批次事务并在批次间让出 Node.js 事件循环（setImmediate），
 * 防止持续占用排他写锁导致其他读写请求超时以及 Socket.IO 心跳卡顿。
 */
export async function batchExecute<T, R = void>(
  items: T[],
  batchSize: number,
  handler: (batch: T[]) => R,
  delayMs = 0,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const tx = db.transaction(() => handler(chunk));
    results.push(tx());
    if (i + batchSize < items.length) {
      await new Promise<void>((resolve) => {
        if (delayMs > 0) {
          setTimeout(resolve, delayMs);
        } else {
          setImmediate(resolve);
        }
      });
    }
  }
  return results;
}

// 生产环境下挂载退出时优雅刷盘
if (!process.env.VITEST) {
  process.once('exit', () => {
    try {
      closeDatabase();
    } catch {}
  });
}

export {
  purgeAllExpiredData,
  purgeExpiredEvents,
  purgeExpiredAttendance,
  purgeExpiredNotifications,
  purgeExpiredRollcalls,
  purgeExpiredSessions,
  resolveRetentionDecision,
  DEFAULT_RETENTION_DAYS,
} from './retention-policy.js';
