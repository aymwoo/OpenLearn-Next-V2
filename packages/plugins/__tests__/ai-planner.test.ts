import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { NodeEsmLoader } from '../../core/esm-loader/index.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { AiPlannerPlugin } from '../ai-planner.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IDatabaseToken,
} from '../../core/di/interfaces.js';
import { CommandBus } from '../../core/command-bus/index.js';
import { EventBus } from '../../core/event-bus/index.js';
import { ActionRegistry } from '../../core/registry/index.js';
import { CapabilityGuard } from '../../core/capability/index.js';
import { createPluginsDir, cleanupPluginsDir } from '../../core/plugin-host/__tests__/helpers/plugins-dir.js';
import { applyGradeChange } from '../../core/db/assignment-grade-writer.js';

describe('AiPlannerPlugin', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let pluginsDir: string;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let capabilityGuard: CapabilityGuard;
  let mockProcessManager: any;

  beforeEach(async () => {
    pluginsDir = createPluginsDir('ai-planner');
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT,
        manifest TEXT,
        source_code TEXT,
        status TEXT,
        created_at INTEGER,
        loader_version TEXT,
      version TEXT,
        execution_mode TEXT
      );
      CREATE TABLE IF NOT EXISTS processes (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT,
        task_type TEXT,
        payload TEXT,
        state TEXT,
        logs TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        -- B-5 / migration 018：进程归属列。内联建表的测试夹具必须与
        -- migrations/018_processes_plugin_owner.sql 保持同步，否则
        -- ProcessManager.spawn 会报 "table processes has no column named plugin_id"。
        plugin_id TEXT
      );
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        creator_id TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        class_id TEXT,
        title TEXT,
        description TEXT,
        content TEXT,
        created_at INTEGER,
        academic_year TEXT
      );
      CREATE TABLE IF NOT EXISTS assignment_submissions (
        assignment_id TEXT,
        student_id TEXT,
        content TEXT,
        score REAL,
        feedback TEXT,
        submitted_at INTEGER,
        graded_at INTEGER,
        status TEXT,
        source TEXT,
        academic_year TEXT,
        graded_by TEXT,
        PRIMARY KEY (assignment_id, student_id)
      );
      CREATE TABLE IF NOT EXISTS assignment_grade_history (
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        old_score REAL,
        new_score REAL,
        old_status TEXT,
        new_status TEXT,
        old_source TEXT,
        new_source TEXT,
        actor_id TEXT,
        actor_role TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    serviceRegistry = new ServiceRegistry();
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
    actionRegistry = new ActionRegistry();
    capabilityGuard = new CapabilityGuard();

    mockProcessManager = {
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
      spawn: vi.fn().mockReturnValue('mock-process-id'),
    };

    serviceRegistry.register(IEventBusServiceToken, eventBus as any);
    serviceRegistry.register(ICommandBusServiceToken, commandBus as any);
    serviceRegistry.register(IActionRegistryServiceToken, actionRegistry as any);
    serviceRegistry.register(ICapabilityServiceToken, capabilityGuard as any);
    serviceRegistry.register(IDatabaseToken, db as any);
    serviceRegistry.register(IProcessServiceToken, mockProcessManager);

    // Register mocks for remaining services
    serviceRegistry.register(IStorageServiceToken, {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    } as any);
    serviceRegistry.register(IAIServiceToken, {
      generateText: async () => '',
    } as any);

    pluginHost = new PluginHost(serviceRegistry, new NodeEsmLoader(), db, pluginsDir);
  });

  afterEach(() => {
    cleanupPluginsDir(pluginsDir);
    db.close();
  });

  it('should successfully register, activate and run AI Planner commands', async () => {
    const pluginId = '@openlearn/plugin-ai-planner';
    pluginHost.registerPreloadedPlugin(
      pluginId,
      AiPlannerPlugin as unknown as Parameters<PluginHost['registerPreloadedPlugin']>[1],
    ); // strict: SDK/core PluginContext 可空性漂移，运行时此处非空

    // Setup initial DB entry
    db.prepare(
      'INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(pluginId, 'AI Planner', JSON.stringify(AiPlannerPlugin.manifest), '', 'installed', Date.now(), 'esm');

    await pluginHost.activatePlugin(pluginId);

    // Verify actions registered
    const actions = await actionRegistry.getAllActions();
    expect(actions.find((a) => a.commandType === 'ai.start_generation')).toBeDefined();
    expect(actions.find((a) => a.commandType === 'ai.apply_recommendation')).toBeDefined();
    expect(actions.find((a) => a.commandType === 'ai.apply_grade')).toBeDefined();

    // Verify process task handler registered
    // B-5：taskType 会被加上 `<pluginId>::` 命名空间前缀。修复前 ProcessManager.handlers
    // 是全局 Map、后者顶掉前者 —— 实测两个插件注册同名 taskType 后先注册者的 handler
    // 被调用 0 次。
    expect(mockProcessManager.registerHandler).toHaveBeenCalledWith(
      '@openlearn/plugin-ai-planner::ai_planner_task',
      expect.any(Function),
    );

    // Test: ai.start_generation command execution
    const spawnRes = await commandBus.execute({
      id: 'cmd-start-generation',
      type: 'ai.start_generation',
      actorId: 'system',
      timestamp: Date.now(),
      payload: {
        taskType: 'lesson_material',
        topic: 'AI Ethics',
        duration: 3,
      },
    });

    expect(spawnRes).toEqual({
      processId: 'mock-process-id',
      message: 'Process started in the background.',
    });
    // spawn 必须用与 registerHandler 相同的前缀，否则任务派发不到自己的 handler。
    // 第四参 ownerHint（B-5）：包装层显式携带调用方插件 id，进程归属不再依赖
    // 「激活期设置的单值 currentOwner」—— 插件运行期 spawn 也归属正确。
    expect(mockProcessManager.spawn).toHaveBeenCalledWith(
      'AI Generator: AI Ethics',
      '@openlearn/plugin-ai-planner::ai_planner_task',
      {
        taskType: 'lesson_material',
        topic: 'AI Ethics',
        classId: undefined,
        duration: 3,
      },
      '@openlearn/plugin-ai-planner',
    );
  });

  it('ai.apply_grade 保护教师手动分，教师显式 overrideManual 才覆盖', async () => {
    const pluginId = '@openlearn/plugin-ai-planner';
    pluginHost.registerPreloadedPlugin(
      pluginId,
      AiPlannerPlugin as unknown as Parameters<PluginHost['registerPreloadedPlugin']>[1],
    ); // strict: SDK/core PluginContext 可空性漂移，运行时此处非空
    db.prepare(
      'INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(pluginId, 'AI Planner', JSON.stringify(AiPlannerPlugin.manifest), '', 'installed', Date.now(), 'esm');
    await pluginHost.activatePlugin(pluginId);

    const assignmentId = 'ast-ai-audit';
    const studentId = 'stu-ai-audit';
    db.prepare('INSERT INTO assignments (id, class_id, title, created_at, academic_year) VALUES (?, ?, ?, ?, ?)').run(
      assignmentId,
      'cls-ai-audit',
      'AI 批改审计',
      Date.now(),
      '2025-2026',
    );
    db.prepare(
      `INSERT INTO assignment_submissions (assignment_id, student_id, content, submitted_at, status)
       VALUES (?, ?, ?, ?, 'submitted')`,
    ).run(assignmentId, studentId, '学生作答', Date.now());

    const apply = (actorId: string, score: number, overrideManual?: boolean) =>
      commandBus.execute({
        id: `cmd-ai-grade-${score}-${actorId}`,
        type: 'ai.apply_grade',
        actorId,
        timestamp: Date.now(),
        payload: { assignmentId, studentId, score, feedback: `AI ${score}`, overrideManual },
      });

    // 1. 系统 AI 批改未出分的提交：允许
    const applied = (await apply('system', 80)) as any;
    expect(applied.success).toBe(true);
    let row = db
      .prepare('SELECT score, source FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(assignmentId, studentId) as any;
    expect(row.score).toBe(80);
    expect(row.source).toBe('ai');

    // 2. 教师手动改分后，系统 AI 再次批改不得覆盖
    applyGradeChange(db, {
      assignmentId,
      studentId,
      score: 85,
      status: 'graded',
      source: 'manual',
      actorId: 'user:t1:teacher',
      reason: 'teacher-manual',
    });

    await expect(apply('system', 70)).rejects.toThrow(/教师已手动录入/);
    row = db
      .prepare('SELECT score FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(assignmentId, studentId) as any;
    expect(row.score).toBe(85);

    // 3. 教师显式确认改判：允许覆盖并留下审计
    const override = (await apply('user:t1:teacher', 70, true)) as any;
    expect(override.success).toBe(true);
    row = db
      .prepare('SELECT score, source, graded_by FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(assignmentId, studentId) as any;
    expect(row.score).toBe(70);
    expect(row.source).toBe('ai');
    expect(row.graded_by).toBe('user:t1:teacher');

    const history = db
      .prepare(
        `SELECT old_score, new_score, actor_id, reason FROM assignment_grade_history
         WHERE assignment_id = ? AND student_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(assignmentId, studentId) as any[];
    expect(history).toHaveLength(3);
    expect(history.map((h) => [h.old_score, h.new_score])).toEqual([
      [null, 80],
      [80, 85],
      [85, 70],
    ]);
    expect(history[2].actor_id).toBe('user:t1:teacher');
    expect(history[2].reason).toBe('ai-apply-grade');
  });
});
