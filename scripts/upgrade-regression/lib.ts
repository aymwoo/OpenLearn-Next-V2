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
import { createRequire } from 'node:module';
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
      // 这些 ZIP 由本仓库 build-plugin-fixtures 现场生成、没有 Ed25519 签名；
      // 签名门禁（B2 安全基线，server/routes/plugins.ts）要求未签名包必须由管理员
      // 显式声明 x-allow-unsigned 才放行。本地自建 fixture 正是门禁所述的
      // 「本地可信插件」场景，不涉及任何外部来源的包。
      // 对尚无此门禁的旧 tag 服务端，该头会被忽略，向后兼容。
      'x-allow-unsigned': 'true',
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
    // symlink（isDirectory/isFile 均为 false）刻意不打包：plugins 下唯一的 symlink 是
    // 宿主为插件建的 SDK 解析链接，target 是构库机器的绝对路径，打进 fixture 恢复后也是
    // 悬空链接，还会挡住恢复时重建（见 ensurePluginSdkSymlink）。插件代码本体都是普通
    // 文件，不受影响；链接由恢复侧按当前机器的宿主 SDK 重建。
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

  // 恢复后必须把 DB 里的绝对路径重定位到新的数据目录（见 rebasePluginPaths）。
  const rebased = rebasePluginPaths(path.join(targetDir, 'educational_os.db'), targetDir);
  if (rebased > 0) {
    console.log(`[restore-fixture] 已把 ${rebased} 个插件的 file_path 重定位到 ${targetDir}`);
  }
  // fixture 不携带 SDK 解析链接（zip 跳过 symlink），恢复后按当前机器的宿主 SDK 重建，
  // 否则 worker 模式加载插件会 ERR_MODULE_NOT_FOUND（见 ensurePluginSdkSymlink）。
  const sdkLink = ensurePluginSdkSymlink(targetDir);
  if (sdkLink) {
    console.log(`[restore-fixture] 已建立插件 SDK 解析链接：${sdkLink}`);
  }
  return metadata;
}

/**
 * 在恢复出的数据目录里重建 `plugins/node_modules/@openlearn/plugin-sdk` 解析链接。
 *
 * 为什么必须做：插件打包时 SDK 是 external，运行时靠这个链接解析到宿主 SDK
 * （平台侧见 `packages/core/plugin-host/core.ts` 的 `ensureHostSdkResolution`，
 * 但只有 inline 加载路径会调它；v0.6.1 之后第三方插件默认跑 worker 模式，那条路
 * 不建链接）。构库时链接确实存在（v0.6.1 inline 激活建的），可 zip 打包跳过
 * symlink，fixture 里没有它 —— 恢复后 worker 导入 `<pluginsDir>/<id>/index.js`
 * 时 Node 向上找不到 `@openlearn/plugin-sdk`，抛 ERR_MODULE_NOT_FOUND，插件全部
 * `state=error`。真实升级不受影响（用户磁盘上的链接随数据目录保留），这是校验工具
 * 搬家后必须自己补上的环境件。
 *
 * 已存在且可用的链接原样保留；挡路的悬空链接 / 被解引用的空目录先清掉再建
 * （直接 symlinkSync 会 EEXIST）。
 *
 * @returns 链接路径；解析不到宿主 SDK 时返回 null（调用方记日志，不静默）。
 */
export function ensurePluginSdkSymlink(targetDataDir: string): string | null {
  const linkPath = path.join(targetDataDir, 'plugins', 'node_modules', '@openlearn', 'plugin-sdk');
  const sdkDir = resolveHostSdkDir();
  if (!sdkDir) return null;

  // 已是可用链接（symlink 且 target 存在）→ 幂等返回
  try {
    if (fs.lstatSync(linkPath).isSymbolicLink() && fs.existsSync(linkPath)) return linkPath;
  } catch {
    /* 不存在，往下走 */
  }

  // 清掉挡路条目：悬空 symlink（构库机器的链接若被某种工具保留）、解引用出来的
  // 目录/文件。symlinkSync 对已存在路径一律 EEXIST，必须先移除。
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isDirectory()) fs.rmSync(linkPath, { recursive: true, force: true });
    else fs.unlinkSync(linkPath);
  } catch {
    /* 不存在，往下走 */
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // junction：Windows 下无需提权即可创建目录链接，POSIX 下等价为普通软链
  fs.symlinkSync(sdkDir, linkPath, 'junction');
  return linkPath;
}

/** 定位仓库内的 @openlearn/plugin-sdk 目录（与平台侧 resolveHostSdkDir 同策略）。 */
function resolveHostSdkDir(): string | null {
  try {
    const req = createRequire(import.meta.url);
    return path.dirname(req.resolve('@openlearn/plugin-sdk/package.json'));
  } catch {
    return null;
  }
}

/**
 * 把 `plugins.file_path` 从「构库机器的绝对路径」重定位到恢复后的数据目录。
 *
 * 为什么必须做：ZIP 安装时 `file_path` 落库的是绝对路径
 * （`<dataDir>/plugins/<pluginId>/index.js`），插件代码文件本身随 fixture 一起搬家，
 * 但 DB 里那一列仍指回构库机器的临时目录。升级校验在**另一个**临时目录里启动，
 * 于是 `loadPluginModule` 发现 `fs.existsSync(file_path) === false`，而 ZIP 插件的
 * `source_code` 是空串 —— 直接 `PluginActivateError: no source code available`，
 * 三个插件全被打成 `state=error`。
 *
 * 这是校验工具的重定位问题，不是产品升级回归：真实升级用的是同一个数据目录。
 * 但方向不能反 —— 若哪天产品真的只认库里的绝对路径（数据目录搬迁即失效），
 * 这个门禁也不会再误报成「插件升级后全挂」。
 *
 * @returns 实际被改写的行数。
 */
export function rebasePluginPaths(dbPath: string, targetDataDir: string): number {
  if (!fs.existsSync(dbPath)) return 0;
  const db = openDb(dbPath, false);
  try {
    const rows = db
      .prepare("SELECT id, file_path FROM plugins WHERE file_path IS NOT NULL AND file_path != ''")
      .all() as Array<{ id: string; file_path: string }>;
    const update = db.prepare('UPDATE plugins SET file_path = ? WHERE id = ?');
    let rebased = 0;
    for (const row of rows) {
      const next = rebaseUnderPluginsDir(row.file_path, targetDataDir);
      if (!next || next === row.file_path) continue;
      update.run(next, row.id);
      rebased += 1;
    }
    return rebased;
  } catch {
    // 老到没有 plugins 表 / file_path 列的 fixture 不该因此失败，交给后续断言报告。
    return 0;
  } finally {
    db.close();
  }
}

/**
 * 取 `…/plugins/<相对路径>` 中的相对部分，拼到目标数据目录下。
 *
 * 用「最后一个 /plugins/ 段」而不是前缀匹配：构库与校验的数据目录都在临时目录里，
 * 前缀本身就不一样，能复用的只有安装时的相对结构。Windows 构库的 fixture 在
 * Linux 上恢复也要能处理，故两种分隔符都归一化。
 */
function rebaseUnderPluginsDir(storedPath: string, targetDataDir: string): string | undefined {
  const normalized = storedPath.replace(/\\/g, '/');
  const marker = normalized.lastIndexOf('/plugins/');
  if (marker < 0) return undefined;
  const relative = normalized.slice(marker + '/plugins/'.length);
  if (!relative || relative.split('/').includes('..')) return undefined;
  return path.join(targetDataDir, 'plugins', ...relative.split('/'));
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
