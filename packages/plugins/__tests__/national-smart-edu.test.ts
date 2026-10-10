import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { NodeEsmLoader } from '../../core/esm-loader/index.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { NationalSmartEduPlugin, PRESET_SMART_EDU_RESOURCES } from '../national-smart-edu.js';
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

describe('NationalSmartEduPlugin (国家智慧教育平台连接器内核测试)', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let pluginsDir: string;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let capabilityGuard: CapabilityGuard;

  beforeEach(async () => {
    pluginsDir = createPluginsDir('smart-edu');
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
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        timeline TEXT,
        progress_mode TEXT DEFAULT 'manual',
        progress_conditions TEXT,
        creator_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS whiteboard_elements (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    serviceRegistry = new ServiceRegistry();
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
    actionRegistry = new ActionRegistry();
    capabilityGuard = new CapabilityGuard();

    serviceRegistry.register(ICommandBusServiceToken, commandBus);
    serviceRegistry.register(IEventBusServiceToken, eventBus);
    serviceRegistry.register(IActionRegistryServiceToken, actionRegistry);
    serviceRegistry.register(ICapabilityServiceToken, capabilityGuard);
    serviceRegistry.register(IDatabaseToken, db);

    // Register mocks for core required services
    serviceRegistry.register(IProcessServiceToken, {
      registerHandler: async () => {},
      unregisterHandler: async () => {},
      restore: async () => {},
    } as any);
    serviceRegistry.register(IStorageServiceToken, {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    } as any);
    serviceRegistry.register(IAIServiceToken, {
      generateText: async () => '',
    } as any);

    pluginHost = new PluginHost(serviceRegistry, new NodeEsmLoader(), db, pluginsDir);

    pluginHost.registerPreloadedPlugin('@openlearn/plugin-smart-edu', NationalSmartEduPlugin as any);
    await pluginHost.activatePlugin('@openlearn/plugin-smart-edu');
  });

  afterEach(() => {
    cleanupPluginsDir(pluginsDir);
    db.close();
  });

  it('检索国家智慧教育平台精品课资源 (smart_edu.search_resources)', async () => {
    const cmdAll = commandBus.createCommand('smart_edu.search_resources', {}, 'teacher', { approved: true });
    const resAll = await commandBus.execute(cmdAll);
    expect(resAll.success).toBe(true);
    expect(resAll.total).toBe(PRESET_SMART_EDU_RESOURCES.length);

    // 按学科过滤：信息科技
    const cmdIt = commandBus.createCommand(
      'smart_edu.search_resources',
      { subject: 'information_tech' },
      'teacher',
      { approved: true },
    );
    const resIt = await commandBus.execute(cmdIt);
    expect(resIt.success).toBe(true);
    expect(resIt.resources.length).toBeGreaterThanOrEqual(1);
    expect(resIt.resources[0].title).toContain('贪心策略');

    // 关键词搜索
    const cmdKw = commandBus.createCommand(
      'smart_edu.search_resources',
      { query: '动量守恒' },
      'teacher',
      { approved: true },
    );
    const resKw = await commandBus.execute(cmdKw);
    expect(resKw.resources.length).toBe(1);
    expect(resKw.resources[0].code).toBe('SED-2026-PHY-0142');
  });

  it('一键导入国家精品课为本地课程与白板图元 (smart_edu.import_course)', async () => {
    const target = PRESET_SMART_EDU_RESOURCES[0];
    const cmd = commandBus.createCommand(
      'smart_edu.import_course',
      { resourceId: target.id, creatorId: 'teacher_zhang' },
      'teacher_zhang',
      { approved: true },
    );

    const res = await commandBus.execute(cmd);
    expect(res.success).toBe(true);
    expect(res.lessonId).toMatch(/^lesson-smartedu-/);
    expect(res.awardLevel).toBe('national_gold');

    // 验证数据库 lessons 表
    const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(res.lessonId) as any;
    expect(row).toBeTruthy();
    expect(row.title).toBe(`【国家精品课】${target.title}`);
    expect(row.creator_id).toBe('teacher_zhang');

    // 验证 content 中的国家平台元数据
    const content = JSON.parse(row.content);
    expect(content.importedFrom).toBe('smartedu.cn');
    expect(content.smartEduMetadata.certified).toBe(true);
    expect(content.smartEduMetadata.code).toBe(target.code);
    expect(content.smartEduMetadata.awardLevel).toBe('national_gold');

    // 验证 timeline 步骤完整性
    const timeline = JSON.parse(row.timeline);
    expect(timeline.length).toBe(target.timeline.length);

    // 验证 whiteboard_elements 图元写入
    const elements = db.prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?').all(res.lessonId) as any[];
    expect(elements.length).toBe(target.whiteboardElements.length);
  });

  it('课堂学情数据上报并签发 CELTS-3 规范回执 (smart_edu.report_metrics)', async () => {
    let publishedEvent: any = null;
    eventBus.subscribe('smart_edu.metrics_reported', async (event) => {
      publishedEvent = event;
    });

    const cmd = commandBus.createCommand(
      'smart_edu.report_metrics',
      {
        lessonId: 'lesson-123',
        classId: 'class-456',
        reportData: {
          attendanceRate: '98.5%',
          interactionCount: 42,
          averageScore: 91.2,
        },
      },
      'teacher',
      { approved: true },
    );

    const receipt = await commandBus.execute(cmd);
    expect(receipt.success).toBe(true);
    expect(receipt.standard).toContain('CELTS-3');
    expect(receipt.receiptId).toMatch(/^CELTS-REC-/);
    expect(receipt.status).toBe('ACCEPTED');
    expect(publishedEvent).toBeTruthy();
    expect(publishedEvent.payload.receiptId).toBe(receipt.receiptId);
  });

  it('获取国家平台连接状态心跳 (smart_edu.get_status)', async () => {
    // 先导入一门课程
    const importCmd = commandBus.createCommand(
      'smart_edu.import_course',
      { resourceId: PRESET_SMART_EDU_RESOURCES[0].id },
      'teacher',
      { approved: true },
    );
    await commandBus.execute(importCmd);

    const statusCmd = commandBus.createCommand('smart_edu.get_status', {}, 'teacher', { approved: true });
    const status = await commandBus.execute(statusCmd);

    expect(status.success).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.channelStatus).toBe('HEALTHY');
    expect(status.rttMs).toBeLessThanOrEqual(50);
    expect(status.syncedCoursesCount).toBe(1);
  });
});
