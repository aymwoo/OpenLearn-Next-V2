import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  loadMigrationsFromDirectory,
  runMigrations,
  getDefaultMigrationsDir,
} from './migrator.js';

const BCRYPT_ROUNDS = 10;

/** 使用 bcrypt 哈希密码 */
export function hashPassword(pwd: string): string {
  return bcrypt.hashSync(pwd, BCRYPT_ROUNDS);
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
 * 基于 migrations/ 目录执行全量版本化迁移，并播种必要的初始超级管理员和默认提供商数据。
 * 这是数据库结构创建与升级的单一真实来源 (SSOT)。
 */
export function initializeDatabase(instance: Database.Database): void {
  try {
    const migrationsDir = getDefaultMigrationsDir();
    const migrations = loadMigrationsFromDirectory(migrationsDir);
    if (migrations.length > 0) {
      runMigrations(instance, migrations);
    }
  } catch (err) {
    console.error('[DB SSOT] Failed to apply migrations during database initialization:', err);
    throw err;
  }

  // 种子数据：默认用户 (admin & teacher)
  try {
    const countObj = instance.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    if (countObj && countObj.cnt === 0) {
      const insertStmt = instance.prepare(
        'INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      insertStmt.run('usr_admin', 'admin', hashPassword('admin'), 'administrator', 'System Admin', Date.now());
      insertStmt.run('usr_teacher', 'teacher', hashPassword('teacher'), 'teacher', 'Regular Teacher', Date.now());
      console.warn(
        '[SECURITY WARNING] Default users initialized (admin/admin, teacher/teacher). In production environments, immediately change these passwords via POST /api/auth/change-password!',
      );
    }
  } catch (e) {
    console.error('Failed to seed default users:', e);
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
