/**
 * 升级回归（Issue #147）共用工具。
 *
 * 设计目标：用真实进程 + 真实 HTTP API 生成与校验「上一个正式版的数据库 + 已装插件」，
 * 而不是在单元测试里手工拼 schema —— 手工拼出来的库无法证明真实迁移链路可用。
 *
 * 三个使用方：
 * - `build-fixture.ts`：临时数据目录启动服务 → 安装第三方插件 → 写入样例数据 → 导出 fixture zip
 * - `verify-upgrade.ts`：恢复 fixture → 用当前代码启动 → 断言迁移、插件、数据、幂等
 * - `__tests__/upgrade-regression.test.ts`：只测本文件里的纯函数（快照/恢复、漂移比较、反向验证）
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { loadMigrationsFromDirectory, simpleChecksum } from '../../packages/core/db/migrator.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');

/** fixture 里记录的插件身份。用 manifestId 做匹配，DB UUID 会因安装环境不同而变。 */
export interface FixturePlugin {
  manifestId: string;
  dbId: string;
  version: string;
}

export interface FixtureMigration {
  name: string;
  checksum: string;
}

export interface FixtureMetadata {
  /** 平台版本或 release tag，便于人读。 */
  label: string;
  platformVersion: string;
  createdAt: string;
  /** 构库时已应用的迁移（名字 + checksum），升级后必须逐一保持不变。 */
  migrations: FixtureMigration[];
  /** 构库时存在的全部表；升级后必须仍然存在（允许新增）。 */
  tables: string[];
  plugins: FixturePlugin[];
  sample: {
    classId: string;
    className: string;
    studentIds: string[];
    studentNumbers: string[];
  };
  /** 插件数据标记：写在 plugin_storage 里，升级后必须原样读回。 */
  markerKey: string;
  markerValue: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  child: ChildProcess;
  dataDir: string;
  /** 已捕获的服务端日志（有上限，避免撑爆内存）。 */
  logs: () => string;
  stop: (signal?: NodeJS.Signals) => Promise<number | null>;
}

export interface StartServerOptions {
  /** 服务端代码所在目录；升级回退路径会指向旧 tag 的 worktree。 */
  serverCwd?: string;
  dataDir: string;
  port?: number;
  env?: Record<string, string | undefined>;
  /** 等待 /health 的超时（毫秒）。 */
  healthTimeoutMs?: number;
}

const MAX_CAPTURED_LOG_BYTES = 512 * 1024;

export function readPlatformVersion(repoRoot: string = REPO_ROOT): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 分配一个空闲端口：先 listen(0) 再立即关闭，交给被测服务复用。 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('无法分配端口')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export function createTempDir(prefix = 'ol-upgrade-regression-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildServerEnv(options: StartServerOptions, port: number): NodeJS.ProcessEnv {
  const dataDir = options.dataDir;
  return {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    OPENLEARN_DATA_DIR: dataDir,
    OPENLEARN_DB_PATH: path.join(dataDir, 'educational_os.db'),
    OPENLEARN_PLUGINS_DIR: path.join(dataDir, 'plugins'),
    BACKUP_DIR: path.join(dataDir, 'backups'),
    LOG_DIR: path.join(dataDir, 'logs'),
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    OPENLEARN_ADMIN_PASSWORD: process.env.OPENLEARN_ADMIN_PASSWORD || 'UpgradeFixture#Admin1',
    OPENLEARN_TEACHER_PASSWORD: process.env.OPENLEARN_TEACHER_PASSWORD || 'UpgradeFixture#Teach1',
    SENTRY_DSN: '',
    OPENLEARN_ERROR_DSN: '',
    // 升级路径必须在 checksum 漂移时硬失败，而不是只打印一行 error。
    MIGRATION_CHECKSUM_STRICT: 'true',
    ...options.env,
  };
}

/**
 * 选择启动方式。
 *
 * 优先用 CJS 产物 `dist/server.cjs`（生产实际运行形态）：旧版 `server.ts` 里存在
 * `const distPath = __dirname || ...`，在 `"type": "module"` + tsx 下 `__dirname`
 * 直接抛 ReferenceError，production 模式根本起不来。esbuild 打成 CJS 后
 * `__dirname` 恢复可用，同时避免为了建 fixture 去跑完整的 Vite 构建。
 *
 * 产物不存在时就地 esbuild 一个（约 1 秒）；esbuild 不可用才退回 tsx。
 */
function resolveServerLaunch(serverCwd: string): { command: string; args: string[] } {
  const distEntry = path.join(serverCwd, 'dist', 'server.cjs');
  if (!fs.existsSync(distEntry)) {
    const esbuildBin = path.join(serverCwd, 'node_modules', '.bin', 'esbuild');
    if (fs.existsSync(esbuildBin)) {
      fs.mkdirSync(path.dirname(distEntry), { recursive: true });
      execFileSync(
        esbuildBin,
        [
          'server.ts',
          '--bundle',
          '--platform=node',
          '--format=cjs',
          '--packages=external',
          '--sourcemap',
          `--outfile=${distEntry}`,
        ],
        { cwd: serverCwd, stdio: 'pipe' },
      );
      // worker 模式的网络前置脚本在部分版本里由构建脚本单独拷贝。
      const preload = path.join(serverCwd, 'packages', 'core', 'worker-runtime', 'plugin-net-preload.cjs');
      if (fs.existsSync(preload)) {
        fs.copyFileSync(preload, path.join(serverCwd, 'dist', 'plugin-net-preload.cjs'));
      }
    }
  }
  if (fs.existsSync(distEntry)) {
    return { command: process.execPath, args: [distEntry] };
  }
  return { command: 'pnpm', args: ['exec', 'tsx', 'server.ts'] };
}

/** 以真实进程启动平台（默认跑 CJS 产物，缺失时就地打包）。 */
export async function startServer(options: StartServerOptions): Promise<ServerHandle> {
  const port = options.port ?? (await getFreePort());
  const serverCwd = options.serverCwd ?? REPO_ROOT;
  const env = buildServerEnv(options, port);
  const launch = resolveServerLaunch(serverCwd);
  const child = spawn(launch.command, launch.args, {
    cwd: serverCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let captured = '';
  const capture = (chunk: Buffer) => {
    captured += chunk.toString();
    if (captured.length > MAX_CAPTURED_LOG_BYTES) {
      captured = captured.slice(captured.length - MAX_CAPTURED_LOG_BYTES);
    }
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  const url = `http://127.0.0.1:${port}`;
  let exitCode: number | null = null;
  const exitPromise = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      exitCode = code ?? 0;
      resolve(exitCode);
    });
  });

  const handle: ServerHandle = {
    url,
    port,
    child,
    dataDir: options.dataDir,
    logs: () => captured,
    stop: async (signal: NodeJS.Signals = 'SIGTERM') => {
      if (exitCode !== null) return exitCode;
      child.kill(signal);
      const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20_000));
      const result = await Promise.race([exitPromise, timeout]);
      if (result === 'timeout') {
        child.kill('SIGKILL');
        return exitPromise;
      }
      return result;
    },
  };

  try {
    await waitForHealth(handle, options.healthTimeoutMs ?? 120_000);
  } catch (error) {
    await handle.stop('SIGKILL');
    throw new Error(`服务启动失败：${(error as Error).message}\n--- server logs ---\n${captured}`);
  }
  return handle;
}

export async function waitForHealth(handle: ServerHandle, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt';
  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null) {
      throw new Error(`服务进程提前退出（exit=${handle.child.exitCode}）`);
    }
    try {
      const res = await fetch(`${handle.url}/health`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待 /health 超时（${timeoutMs}ms，最后错误：${lastError}）`);
}

/** 极简 cookie 会话；足够覆盖管理员登录 + 后续 API 调用。 */
export class HttpSession {
  private cookie = '';

  constructor(readonly baseUrl: string) {}

  async request(
    pathname: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let body: string | Buffer | undefined;
    if (init.body !== undefined) {
      if (Buffer.isBuffer(init.body)) {
        body = init.body;
      } else {
        headers['content-type'] = headers['content-type'] ?? 'application/json';
        body = JSON.stringify(init.body);
      }
    }
    const res = await fetch(`${this.baseUrl}${pathname}`, {
      method: init.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
    });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if (setCookies.length > 0) {
      this.cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON 响应保留原文 */
    }
    return { status: res.status, body: parsed };
  }

  async json<T = any>(
    pathname: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const res = await this.request(pathname, init);
    if (res.status >= 400) {
      throw new Error(`${init.method ?? 'GET'} ${pathname} 失败：HTTP ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as T;
  }
}

export async function loginAsAdmin(session: HttpSession): Promise<void> {
  const password = process.env.OPENLEARN_ADMIN_PASSWORD || 'UpgradeFixture#Admin1';
  const attempt = (candidate: string) =>
    session.request('/api/auth/login', {
      method: 'POST',
      body: { entrance: 'teacher', username: 'admin', password: candidate },
    });

  const primary = await attempt(password);
  if (primary.status < 400) return;
  if (primary.status !== 401) {
    throw new Error(`管理员登录失败：HTTP ${primary.status} ${JSON.stringify(primary.body)}`);
  }

  // 旧版本（如 v0.6.1）还不支持 OPENLEARN_ADMIN_PASSWORD，种子口令固定是 admin。
  // 用它登录后立刻改成目标口令：新版本登录成功即打 must_change_password，
  // 不改密后续写操作会被拦；同时 fixture 里也不该留默认口令。
  const seeded = await attempt('admin');
  if (seeded.status >= 400) {
    throw new Error(`管理员登录失败（已尝试环境变量口令与种子口令 admin）：HTTP ${seeded.status}`);
  }
  const changed = await session.request('/api/auth/change-password', {
    method: 'POST',
    body: { oldPassword: 'admin', newPassword: password },
  });
  if (changed.status >= 400) {
    // 老版本没有改密接口的额外约束时仍可继续；这里只提示，不阻断。
    console.warn(`[upgrade-regression] 默认口令改密失败（HTTP ${changed.status}），继续使用当前会话`);
    return;
  }
  const relogin = await attempt(password);
  if (relogin.status >= 400) {
    throw new Error(`改密后重新登录失败：HTTP ${relogin.status} ${JSON.stringify(relogin.body)}`);
  }
}

export interface InstalledPluginResponse {
  success: boolean;
  pluginId: string;
  manifest: { id: string; version?: string };
}

export async function installPluginZip(session: HttpSession, zipPath: string): Promise<InstalledPluginResponse> {
  const filename = path.basename(zipPath);
  return session.json<InstalledPluginResponse>('/api/plugins/upload-zip-raw', {
    method: 'POST',
    body: fs.readFileSync(zipPath),
    headers: {
      'content-type': 'application/zip',
      'x-filename': encodeURIComponent(filename),
      // 第三方插件声明的能力与公开路由在 fixture 里必须被批准，否则插件不会 ACTIVE，
      // 升级后「插件仍能激活」的断言就失去了意义。
      'x-approve-capabilities': 'true',
      'x-approve-public-routes': 'true',
    },
  });
}

export interface PluginListEntry {
  id: string;
  name: string;
  version: string;
  state?: string;
  status?: string;
  manifest?: string;
}

export async function listPlugins(session: HttpSession): Promise<PluginListEntry[]> {
  const list = await session.json<PluginListEntry[]>('/api/plugins');
  return Array.isArray(list) ? list : [];
}

export function pluginManifestId(plugin: PluginListEntry): string | null {
  if (typeof plugin.manifest === 'string') {
    try {
      const parsed = JSON.parse(plugin.manifest) as { id?: string };
      if (typeof parsed.id === 'string') return parsed.id;
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function isPluginActive(plugin: PluginListEntry | undefined): boolean {
  if (!plugin) return false;
  return plugin.state === 'active' || plugin.status === 'active';
}

// ── SQLite 读写 ────────────────────────────────────────────────────────────

export function openDb(dbPath: string, readonly = true): Database.Database {
  return new Database(dbPath, { readonly, fileMustExist: true });
}

export function readAppliedMigrations(db: Database.Database): FixtureMigration[] {
  return db.prepare('SELECT name, checksum FROM _migrations ORDER BY name').all() as FixtureMigration[];
}

export function readTableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

export function readPluginStorageMarker(db: Database.Database, pluginId: string, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?').get(pluginId, key) as
    { value?: string } | undefined;
  return row?.value;
}

export function writePluginStorageMarker(db: Database.Database, pluginId: string, key: string, value: string): void {
  db.prepare(
    `INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(pluginId, key, value, Date.now());
}

// ── 迁移比较（纯函数，单测直接覆盖）─────────────────────────────────────────

export interface MigrationComparison {
  /** 已应用但 checksum 变了 —— 已执行迁移被改写，升级必须失败。 */
  drift: Array<{ name: string; recorded: string; actual: string }>;
  /** 当前迁移目录里有、库里没应用过的。 */
  pending: string[];
  /** 库里记录了、当前迁移目录里不存在的 —— 旧版独有的迁移，允许存在但要可见。 */
  unknown: string[];
}

export function compareMigrations(
  applied: FixtureMigration[],
  current: Array<{ name: string; up: string }>,
): MigrationComparison {
  const byName = new Map(current.map((migration) => [migration.name, migration]));
  const appliedNames = new Set(applied.map((row) => row.name));
  const drift: MigrationComparison['drift'] = [];
  for (const row of applied) {
    const migration = byName.get(row.name);
    if (!migration) continue;
    const actual = simpleChecksum(migration.up);
    if (actual !== row.checksum) drift.push({ name: row.name, recorded: row.checksum, actual });
  }
  const pending = current.filter((migration) => !appliedNames.has(migration.name)).map((m) => m.name);
  const unknown = applied.filter((row) => !byName.has(row.name)).map((row) => row.name);
  return { drift, pending, unknown };
}

export function loadCurrentMigrations(migrationsDir: string = MIGRATIONS_DIR) {
  return loadMigrationsFromDirectory(migrationsDir);
}

/** fixture 自身完整性：库里的迁移记录必须与 metadata 完全一致（防止 fixture 被手改）。 */
export function fixtureIntegrityIssues(
  metadata: Pick<FixtureMetadata, 'migrations'>,
  applied: FixtureMigration[],
): string[] {
  const issues: string[] = [];
  if (applied.length !== metadata.migrations.length) {
    issues.push(`迁移条数不一致：库内 ${applied.length} / metadata ${metadata.migrations.length}`);
  }
  for (const expected of metadata.migrations) {
    const actual = applied.find((row) => row.name === expected.name);
    if (!actual) {
      issues.push(`缺少迁移记录：${expected.name}`);
      continue;
    }
    if (actual.checksum !== expected.checksum) {
      issues.push(`迁移 checksum 不一致：${expected.name}（${expected.checksum} → ${actual.checksum}）`);
    }
  }
  return issues;
}

// ── fixture 快照 / 恢复 ────────────────────────────────────────────────────

function addDirectoryToZip(zip: JSZip, sourceDir: string, zipPrefix: string): void {
  if (!fs.existsSync(sourceDir)) return;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const zipPath = `${zipPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, sourcePath, zipPath);
    } else if (entry.isFile()) {
      zip.file(zipPath, fs.readFileSync(sourcePath));
    }
  }
}

export interface SnapshotOptions {
  dataDir: string;
  outFile: string;
  metadata: FixtureMetadata;
}

/**
 * 把数据目录打包成 fixture。
 * DB 用 `VACUUM INTO` 生成一致快照 —— 直接 copy 主库会漏掉 WAL 里未 checkpoint 的页。
 */
export async function snapshotFixture(options: SnapshotOptions): Promise<void> {
  const dbPath = path.join(options.dataDir, 'educational_os.db');
  const vacuumTarget = path.join(options.dataDir, '__fixture_snapshot.db');
  fs.rmSync(vacuumTarget, { force: true });
  const db = openDb(dbPath, false);
  try {
    db.exec(`VACUUM INTO '${vacuumTarget.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const zip = new JSZip();
  zip.file('metadata.json', JSON.stringify(options.metadata, null, 2));
  zip.file('data/educational_os.db', fs.readFileSync(vacuumTarget));
  addDirectoryToZip(zip, path.join(options.dataDir, 'plugins'), 'data/plugins');
  addDirectoryToZip(zip, path.join(options.dataDir, 'storage'), 'data/storage');

  fs.mkdirSync(path.dirname(path.resolve(options.outFile)), { recursive: true });
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(options.outFile, buffer);
  fs.rmSync(vacuumTarget, { force: true });
}

export async function restoreFixture(fixtureFile: string, targetDir: string): Promise<FixtureMetadata> {
  const buffer = fs.readFileSync(fixtureFile);
  const zip = await JSZip.loadAsync(buffer);
  const metadataEntry = zip.file('metadata.json');
  if (!metadataEntry) throw new Error(`fixture 缺少 metadata.json：${fixtureFile}`);
  const metadata = JSON.parse(await metadataEntry.async('string')) as FixtureMetadata;

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (entryPath === 'metadata.json') continue;
    if (!entryPath.startsWith('data/')) continue;
    const destination = path.join(targetDir, entryPath.slice('data/'.length));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, await entry.async('nodebuffer'));
  }
  return metadata;
}

// ── 断言 ──────────────────────────────────────────────────────────────────

export interface VerificationReport {
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

export class VerificationError extends Error {
  constructor(readonly report: VerificationReport) {
    super(
      '升级回归校验失败：\n' +
        report.checks
          .filter((check) => !check.ok)
          .map((check) => `  ✗ ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
          .join('\n'),
    );
    this.name = 'VerificationError';
  }
}

export function record(report: VerificationReport, name: string, ok: boolean, detail?: string): void {
  report.checks.push({ name, ok, detail });
}

export function assertReport(report: VerificationReport): void {
  if (report.checks.some((check) => !check.ok)) throw new VerificationError(report);
}
