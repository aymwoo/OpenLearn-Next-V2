/**
 * @openlearn/plugin-test-kit — 插件单元测试工具包（V2.5）
 *
 * 提供 createMockContext() 函数和所有内核服务的 mock 实现，
 * 使插件开发者无需启动完整 Kernel 即可进行单元测试。
 *
 * 用法：
 *   import { createMockContext } from '@openlearn/plugin-test-kit';
 *
 *   const ctx = createMockContext({ pluginId: 'ext-test' });
 *   await myPlugin.activate(ctx);
 *   // 断言 ctx.services.commandBus.registerHandler 被调用等
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  PluginContext,
  Manifest,
  IPluginLogger,
  ICommandBusService,
  IEventBusService,
  IActionRegistryService,
  ICapabilityService,
  IProcessService,
  IStorageService,
  IAIService,
  Token,
  ActionDescriptor,
  PlatformCommand,
  CommandHandler,
  PluginStreamResponse,
} from '@openlearn/plugin-sdk';
import { PluginHttpRouter } from '@openlearn/plugin-sdk';

// ── Options ──────────────────────────────────────────────────────────────

export interface CreateMockContextOptions {
  /** 插件 manifest.id（默认 'ext-test'） */
  pluginId?: string;
  /** 插件 manifest（默认使用最小 manifest） */
  manifest?: Partial<Manifest>;
  /** 要预授权的 capabilities（默认 []） */
  capabilities?: string[];
  /** 自定义 Token → 实例映射（用于 resolve()） */
  customTokens?: Record<string, unknown>;
  /** 替换默认 mock 实现 */
  overrides?: {
    commandBus?: Partial<ICommandBusService>;
    eventBus?: Partial<IEventBusService>;
    actionRegistry?: Partial<IActionRegistryService>;
    capability?: Partial<ICapabilityService>;
    processManager?: Partial<IProcessService>;
    storage?: Partial<IStorageService>;
    ai?: Partial<IAIService>;
  };
}

// ── Mock: ICommandBusService ─────────────────────────────────────────────

export class MockCommandBus implements ICommandBusService {
  /** 已注册的 handler，按 commandType 索引 */
  handlers = new Map<string, CommandHandler>();
  /** execute 调用历史 */
  executeCalls: PlatformCommand[] = [];

  async registerHandler(commandType: string, handler: CommandHandler): Promise<void> {
    this.handlers.set(commandType, handler);
  }

  async unregisterHandler(commandType: string): Promise<void> {
    this.handlers.delete(commandType);
  }

  async execute<T extends PlatformCommand>(command: T): Promise<unknown> {
    this.executeCalls.push(command);
    const handler = this.handlers.get(command.type);
    if (handler) {
      return handler.execute(command);
    }
    return undefined;
  }

  async createCommand<T>(type: string, payload: T, actorId: string, metadata?: any): Promise<PlatformCommand<T>> {
    return {
      id: crypto.randomUUID?.() ?? `cmd-${Date.now()}`,
      type,
      actorId,
      payload,
      timestamp: Date.now(),
      metadata,
    } as PlatformCommand<T>;
  }

  async setInterceptor(_interceptor: (command: PlatformCommand) => Promise<void>): Promise<void> {
    // no-op
  }
}

// ── Mock: IEventBusService ───────────────────────────────────────────────

export class MockEventBus implements IEventBusService {
  /** 已订阅的事件，按 eventType 索引 */
  subscribers = new Map<string, Set<Function>>();
  /** publish 调用历史 */
  publishCalls: any[] = [];

  async publish(event: any): Promise<void> {
    this.publishCalls.push(event);
    const subs = this.subscribers.get(event.type);
    if (subs) {
      for (const sub of subs) {
        await Promise.resolve(sub(event));
      }
    }
    // 通配符订阅者
    const wildcard = this.subscribers.get('*');
    if (wildcard) {
      for (const sub of wildcard) {
        await Promise.resolve(sub(event));
      }
    }
  }

  async subscribe(eventType: string, subscriber: Function): Promise<void> {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(subscriber);
  }

  async unsubscribe(eventType: string, subscriber: Function): Promise<void> {
    this.subscribers.get(eventType)?.delete(subscriber);
  }
}

// ── Mock: IActionRegistryService ─────────────────────────────────────────

export class MockActionRegistry implements IActionRegistryService {
  /** 已注册的 action，按 id 索引 */
  actions = new Map<string, ActionDescriptor>();

  async register(descriptor: ActionDescriptor): Promise<void> {
    this.actions.set(descriptor.id, descriptor);
  }

  async unregister(id: string): Promise<void> {
    this.actions.delete(id);
  }

  async getAllActions(): Promise<ActionDescriptor[]> {
    return Array.from(this.actions.values());
  }

  async getAgentTools(): Promise<unknown[]> {
    const declarations = Array.from(this.actions.values()).map((a) => ({
      name: a.commandType.replace(/[^a-zA-Z0-9_-]/g, '_'),
      description: a.description,
      parameters: a.inputSchema,
    }));
    return declarations.length > 0 ? [{ functionDeclarations: declarations }] : [];
  }

  async getActionByToolName(toolName: string): Promise<ActionDescriptor | undefined> {
    return Array.from(this.actions.values()).find((a) => a.commandType.replace(/[^a-zA-Z0-9_-]/g, '_') === toolName);
  }

  async getActionByCommandType(commandType: string): Promise<ActionDescriptor | undefined> {
    return Array.from(this.actions.values()).find((a) => a.commandType === commandType);
  }
}

// ── Mock: ICapabilityService ─────────────────────────────────────────────

export class MockCapability implements ICapabilityService {
  /** actorId → Set<capability> */
  private caps = new Map<string, Set<string>>();

  constructor(initialCaps?: string[]) {
    if (initialCaps && initialCaps.length > 0) {
      // 授予给默认 actorId（由 createMockContext 设置）
    }
  }

  async grant(actorId: string, cap: string): Promise<void> {
    if (!this.caps.has(actorId)) {
      this.caps.set(actorId, new Set());
    }
    this.caps.get(actorId)!.add(cap);
  }

  async revokeAll(actorId: string): Promise<void> {
    this.caps.delete(actorId);
  }

  async check(actorId: string, requiredCap: string): Promise<boolean> {
    const caps = this.caps.get(actorId);
    if (!caps) return false;
    // 支持通配符匹配
    if (caps.has(requiredCap)) return true;
    for (const cap of caps) {
      if (cap.endsWith('*')) {
        const prefix = cap.slice(0, -1);
        if (requiredCap.startsWith(prefix)) return true;
      }
    }
    return false;
  }
}

// ── Mock: IProcessService ───────────────────────────────────────────────

export class MockProcessManager implements IProcessService {
  /** 已注册的 task handler，按 taskType 索引 */
  handlers = new Map<string, Function>();
  /** 已生成的进程 ID 列表 */
  processes: string[] = [];
  private nextPid = 1;

  async spawn(_name: string, _taskType: string, _payload: unknown): Promise<string> {
    const pid = `proc-${this.nextPid++}`;
    this.processes.push(pid);
    return pid;
  }

  async kill(_processId: string): Promise<void> {
    // no-op
  }

  async registerHandler(taskType: string, handler: Function): Promise<void> {
    this.handlers.set(taskType, handler);
  }

  async unregisterHandler(taskType: string): Promise<void> {
    this.handlers.delete(taskType);
  }

  async registerInterval(
    _name: string,
    _intervalMs: number,
    _tickFn: (log: (msg: string) => void) => void,
  ): Promise<string> {
    const pid = `interval-${this.nextPid++}`;
    this.processes.push(pid);
    return pid;
  }

  async restore(): Promise<void> {
    // no-op
  }
}

// ── Mock: IStorageService ────────────────────────────────────────────────

export class MockStorage implements IStorageService {
  private store = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ── Mock: IAIService ─────────────────────────────────────────────────────

export class MockAI implements IAIService {
  /** 可配置的响应生成函数，默认返回空字符串 */
  generateTextFn: (prompt: string, options?: any) => string = () => '';

  async generateText(prompt: string, options?: { systemInstruction?: string; temperature?: number }): Promise<string> {
    return this.generateTextFn(prompt, options);
  }
}

// ── Mock: IPluginLogger ──────────────────────────────────────────────────

export class MockLogger implements IPluginLogger {
  messages: Array<{ level: string; message: string; meta?: Record<string, unknown> }> = [];

  debug(message: string, meta?: Record<string, unknown>): void {
    this.messages.push({ level: 'debug', message, meta });
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.messages.push({ level: 'info', message, meta });
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.messages.push({ level: 'warn', message, meta });
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.messages.push({ level: 'error', message, meta });
  }
}

// ── createMockContext ───────────────────────────────────────────────────

/**
 * 创建一个 mock PluginContext 用于单元测试。
 *
 * 所有服务均为 mock 实现，可通过 `overrides` 替换。
 * `db` 使用真实的内存 SQLite 数据库。
 *
 * @example
 * ```typescript
 * const ctx = createMockContext({
 *   pluginId: 'ext-my-plugin',
 *   capabilities: ['lesson:read'],
 *   overrides: {
 *     ai: { generateText: async () => 'mocked response' }
 *   }
 * });
 *
 * await myPlugin.activate(ctx);
 *
 * // 验证：插件注册了某个命令
 * const handler = (ctx.services.commandBus as MockCommandBus)
 *   .handlers.get('my.command');
 * expect(handler).toBeDefined();
 * ```
 */
export function createMockContext(opts: CreateMockContextOptions = {}): PluginContext {
  const pluginId = opts.pluginId ?? 'ext-test';

  // 构建默认 manifest
  const manifest: Manifest = {
    id: pluginId,
    name: opts.manifest?.name ?? 'Test Plugin',
    version: opts.manifest?.version ?? '1.0.0',
    main: opts.manifest?.main ?? 'index.js',
    capabilitiesProposed: opts.capabilities ?? [],
  };

  // 创建 mock 实例（允许 overrides 合并）
  const mockCommandBus = new MockCommandBus();
  const mockEventBus = new MockEventBus();
  const mockActionRegistry = new MockActionRegistry();
  const mockCapability = new MockCapability();
  const mockProcessManager = new MockProcessManager();
  const mockStorage = new MockStorage();
  const mockAI = new MockAI();
  const mockLogger = new MockLogger();

  // 应用 overrides（浅合并到实例属性）
  if (opts.overrides?.commandBus) Object.assign(mockCommandBus, opts.overrides.commandBus);
  if (opts.overrides?.eventBus) Object.assign(mockEventBus, opts.overrides.eventBus);
  if (opts.overrides?.actionRegistry) Object.assign(mockActionRegistry, opts.overrides.actionRegistry);
  if (opts.overrides?.capability) Object.assign(mockCapability, opts.overrides.capability);
  if (opts.overrides?.processManager) Object.assign(mockProcessManager, opts.overrides.processManager);
  if (opts.overrides?.storage) Object.assign(mockStorage, opts.overrides.storage);
  if (opts.overrides?.ai) Object.assign(mockAI, opts.overrides.ai);

  // 授予初始 capabilities
  for (const cap of opts.capabilities ?? []) {
    mockCapability.grant(`plugin:${pluginId}`, cap);
  }

  // 内存数据库
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, key)
    );
    CREATE TABLE IF NOT EXISTS plugin_migrations (
      plugin_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    );
  `);

  // 插件自建表 API
  const tablePrefix = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;

  const dbApi = {
    async ensureTable(tableName: string, schema: string) {
      const fullName = tablePrefix + tableName;
      db.exec(`CREATE TABLE IF NOT EXISTS ${fullName} (${schema})`);
    },
    table(tableName: string) {
      return tablePrefix + tableName;
    },
    async dropAllTables() {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?`)
        .all(tablePrefix + '%') as { name: string }[];
      for (const t of tables) {
        db.exec(`DROP TABLE IF EXISTS ${t.name}`);
      }
    },
    async migrate(targetVersion: number, upgradeFn: (d: any) => Promise<void> | void) {
      const row = db.prepare(`SELECT version FROM plugin_migrations WHERE plugin_id = ?`).get(pluginId) as
        { version: number } | undefined;
      const currentVersion = row ? row.version : 0;
      if (currentVersion < targetVersion) {
        db.exec('BEGIN IMMEDIATE');
        try {
          await upgradeFn(db);
          db.prepare(`INSERT OR REPLACE INTO plugin_migrations (plugin_id, version) VALUES (?, ?)`).run(
            pluginId,
            targetVersion,
          );
          db.exec('COMMIT');
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {}
          throw err;
        }
      }
    },
  };

  // Token 映射表
  const tokenMap: Record<string, unknown> = {
    '@openlearn/core:ICommandBusService': mockCommandBus,
    '@openlearn/core:IEventBusService': mockEventBus,
    '@openlearn/core:IActionRegistryService': mockActionRegistry,
    '@openlearn/core:ICapabilityService': mockCapability,
    '@openlearn/core:IProcessService': mockProcessManager,
    '@openlearn/core:IStorageService': mockStorage,
    '@openlearn/core:IAIService': mockAI,
    '@openlearn/core:IDatabase': db,
  };

  // 合并自定义 tokens
  if (opts.customTokens) {
    Object.assign(tokenMap, opts.customTokens);
  }

  return {
    services: {
      commandBus: mockCommandBus,
      eventBus: mockEventBus,
      actionRegistry: mockActionRegistry,
      capability: mockCapability,
      processManager: mockProcessManager,
      storage: mockStorage,
      ai: mockAI,
      pointsDimension: null,
      pointsLedger: null,
    } as any,
    pluginId,
    manifest,
    // Issue #148：i18n 是 PluginContext 的必填项。测试夹具不需要真实词条，
    // 直接回显默认值或 key（与宿主「找不到词条时回退」的行为一致）。
    i18n: {
      t: (key: string, defaultValueOrParams?: string | Record<string, any>) =>
        typeof defaultValueOrParams === 'string' ? defaultValueOrParams : key,
      getLanguage: () => 'zh',
    },
    resolve: async <T>(token: Token<T>): Promise<T> => {
      const inst = tokenMap[token.name];
      if (inst === undefined) {
        throw new Error(`[MockContext] No provider registered for token: ${token.name}`);
      }
      return inst as T;
    },
    db: dbApi,
    log: mockLogger,
    provide: async <T>(token: Token<T>, instance: T): Promise<void> => {
      tokenMap[token.name] = instance;
    },
    config: {
      get: <T = unknown>(_key: string): T => undefined as T,
      getAll: (): Record<string, unknown> => ({}),
      set: async (_key: string, _value: unknown): Promise<void> => {},
      onChange:
        (_cb: (key: string, newValue: unknown, oldValue: unknown) => void): (() => void) =>
        () => {},
    },
    contributions: {
      list: () => [],
    },
    http: new PluginHttpRouter(),
    require: (moduleName: string): any => {
      throw new Error(
        `[MockContext] require("${moduleName}") is not available in test context. Use customTokens to inject mock modules.`,
      );
    },
  };
}

export interface MockStreamResult {
  stream: PluginStreamResponse;
  getChunks: () => Array<{ data: string | Record<string, any>; event?: string; id?: string }>;
  getErrors: () => Array<Error | string>;
  isEnded: () => boolean;
  simulateClose: () => void;
}

/**
 * 创建用于测试插件流式输出 (SSE) 的 Mock 响应写入器
 */
export function createMockStreamResponse(): MockStreamResult {
  const chunks: Array<{ data: string | Record<string, any>; event?: string; id?: string }> = [];
  const errors: Array<Error | string> = [];
  let ended = false;
  let closed = false;
  const closeCallbacks: Array<() => void> = [];

  const stream: PluginStreamResponse = {
    get isClosed() {
      return closed || ended;
    },
    write(data, event, id) {
      if (this.isClosed) return false;
      chunks.push({ data, event, id });
      return true;
    },
    end() {
      ended = true;
    },
    error(err) {
      errors.push(err);
      ended = true;
    },
    onClose(cb) {
      if (this.isClosed) {
        cb();
      } else {
        closeCallbacks.push(cb);
      }
    },
  };

  return {
    stream,
    getChunks: () => chunks,
    getErrors: () => errors,
    isEnded: () => ended,
    simulateClose: () => {
      closed = true;
      for (const cb of closeCallbacks) {
        try {
          cb();
        } catch {}
      }
    },
  };
}

// ── Declarative Migration Test Helpers ─────────────────────────────────────

export interface RunTestPluginMigrationsOptions {
  tablePrefix?: string;
}

/**
 * 辅助函数：在单元测试中为指定插件运行其 migrations 目录下的声明式 SQL 迁移。
 *
 * 适用于插件开发者测试「从历史数据/低版本迁移升级至新版本」的升级演进逻辑。
 *
 * @param db SQLite 数据库实例
 * @param pluginId 插件 ID
 * @param migrationsDir 迁移文件所在的目录绝对路径
 * @param options 执行选项（如自定义表名前缀）
 */
export function runTestPluginMigrations(
  db: Database.Database,
  pluginId: string,
  migrationsDir: string,
  options: RunTestPluginMigrationsOptions = {},
): { appliedCount: number; appliedNames: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plugin_declared_migrations (
      plugin_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, name)
    );
  `);

  if (!fs.existsSync(migrationsDir)) {
    return { appliedCount: 0, appliedNames: [] };
  }

  const prefix = options.tablePrefix ?? `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const appliedRows = db
    .prepare('SELECT name, version FROM plugin_declared_migrations WHERE plugin_id = ?')
    .all(pluginId) as Array<{ name: string; version: number }>;
  const appliedSet = new Set(appliedRows.map((r) => r.name));

  const appliedNames: string[] = [];

  for (const file of files) {
    const baseName = file.replace(/\.sql$/, '');
    if (appliedSet.has(baseName)) continue;

    const fullPath = path.join(migrationsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    // 解析 -- UP
    const upMatch = content.match(/--\s*UP([\s\S]*?)(?=--\s*DOWN|$)/i);
    const downMatch = content.match(/--\s*DOWN([\s\S]*)$/i);
    const up = upMatch ? upMatch[1].trim() : downMatch ? content.slice(0, downMatch.index).trim() : content.trim();

    const sqlToRun = up.replace(/\{\{\s*prefix\s*\}\}/g, prefix).replace(/\{\{\s*table_prefix\s*\}\}/g, prefix);

    // 解析版本号
    const vMatch = baseName.match(/^(\d+)/);
    const version = vMatch ? parseInt(vMatch[1], 10) : 0;

    const tx = db.transaction(() => {
      const stmts = sqlToRun
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);
      for (const stmt of stmts) {
        db.exec(stmt);
      }
      db.prepare(`
        INSERT INTO plugin_declared_migrations (plugin_id, version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(pluginId, version, baseName, 'test-checksum', Date.now());
    });

    tx();
    appliedNames.push(baseName);
  }

  return { appliedCount: appliedNames.length, appliedNames };
}

