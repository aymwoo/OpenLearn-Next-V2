import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { NodeEsmLoader } from '../../core/esm-loader/index.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { NationalSmartEduPlugin } from '../national-smart-edu.js';
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

/**
 * 网关契约测试基座：
 * - 通过 vi.stubGlobal('fetch') 模拟国家平台数据网关（docs/plugin/smart-edu-gateway.md）；
 * - 通过 SMARTEDU_API_BASE 等 env 控制连接器配置态；
 * - 断言连接器只走真实 HTTP 路径，未配置/失败时不产生任何编造数据。
 */

const GATEWAY_BASE = 'https://gateway.test/smart-edu';

const GATEWAY_RESOURCE = {
  id: 'res-it-001',
  code: 'SED-2026-IT-0089',
  title: '算法与程序设计：贪心策略在资源排程中的应用',
  subject: 'information_tech',
  grade: 'high_1',
  edition: 'zhejiang',
  awardLevel: 'national_gold',
  teacherName: '张敏 老师',
  schoolName: '杭州高级中学',
  summary: '基于机房时序调度冲突的贪心策略探究课。',
  tags: ['计算思维', '区间贪心'],
  timeline: [
    { id: 'seg-1', title: '情境引入', type: 'discussion', duration: 8, description: '排程冲突工单分析' },
    { id: 'seg-2', title: '算法建模', type: 'lecture', duration: 15, description: '贪心选择性质推导' },
  ],
  whiteboardElements: [
    { type: 'markdown', data: { title: '区间排程定义', content: '### 活动选择问题', x: 40, y: 40, width: 520, height: 280 } },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('NationalSmartEduPlugin (国家平台网关真实对接测试)', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let pluginsDir: string;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let capabilityGuard: CapabilityGuard;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    pluginsDir = createPluginsDir('smart-edu');
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT, status TEXT,
        created_at INTEGER, loader_version TEXT, version TEXT, execution_mode TEXT
      );
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT, timeline TEXT,
        progress_mode TEXT DEFAULT 'manual', progress_conditions TEXT, creator_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS whiteboard_elements (
        id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
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
    serviceRegistry.register(IAIServiceToken, { generateText: async () => '' } as any);

    pluginHost = new PluginHost(serviceRegistry, new NodeEsmLoader(), db, pluginsDir);
    pluginHost.registerPreloadedPlugin('@openlearn/plugin-smart-edu', NationalSmartEduPlugin as any);
    await pluginHost.activatePlugin('@openlearn/plugin-smart-edu');

    vi.stubGlobal('fetch', fetchMock);
    process.env.SMARTEDU_API_BASE = GATEWAY_BASE;
    delete process.env.SMARTEDU_APP_KEY;
    delete process.env.SMARTEDU_APP_SECRET;
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SMARTEDU_API_BASE;
    delete process.env.SMARTEDU_APP_KEY;
    delete process.env.SMARTEDU_APP_SECRET;
    cleanupPluginsDir(pluginsDir);
    db.close();
  });

  it('未配置网关时如实返回 configured:false，且不发起任何 HTTP 请求', async () => {
    delete process.env.SMARTEDU_API_BASE;

    const search = await commandBus.execute(
      commandBus.createCommand('smart_edu.search_resources', { query: '贪心' }, 'user:1:teacher'),
    );
    expect(search.success).toBe(false);
    expect(search.configured).toBe(false);
    expect(search.resources).toBeUndefined();

    const status = await commandBus.execute(
      commandBus.createCommand('smart_edu.get_status', {}, 'user:1:teacher'),
    );
    expect(status.success).toBe(true);
    expect(status.configured).toBe(false);
    expect(status.connected).toBe(false);

    const report = await commandBus.execute(
      commandBus.createCommand('smart_edu.report_metrics', { lessonId: 'l-1' }, 'user:1:teacher'),
    );
    expect(report.success).toBe(false);
    expect(report.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('检索走真实网关 GET 并透传过滤参数 (smart_edu.search_resources)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [GATEWAY_RESOURCE] }));

    const res = await commandBus.execute(
      commandBus.createCommand(
        'smart_edu.search_resources',
        { query: '贪心', subject: 'information_tech' },
        'user:1:teacher',
      ),
    );

    expect(res.success).toBe(true);
    expect(res.configured).toBe(true);
    expect(res.total).toBe(1);
    expect(res.resources[0].title).toContain('贪心策略');
    expect(res.resources[0].awardLevel).toBe('national_gold');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${GATEWAY_BASE}/resources/search?query=%E8%B4%AA%E5%BF%83&subject=information_tech`);
    expect(init.method).toBe('GET');
  });

  it('网关不可用时不编造资源——错误如实上抛', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'upstream down' }, 503));

    await expect(
      commandBus.execute(
        commandBus.createCommand('smart_edu.search_resources', {}, 'user:1:teacher'),
      ),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('导入从网关拉取资源详情并事务落库 (smart_edu.import_course)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(GATEWAY_RESOURCE));

    const res = await commandBus.execute(
      commandBus.createCommand(
        'smart_edu.import_course',
        { resourceId: GATEWAY_RESOURCE.id, creatorId: 'teacher_zhang' },
        'teacher_zhang',
      ),
    );

    expect(res.success).toBe(true);
    expect(res.lessonId).toMatch(/^lesson-smartedu-/);

    const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(res.lessonId) as any;
    expect(row).toBeTruthy();
    expect(row.title).toBe(`【国家精品课】${GATEWAY_RESOURCE.title}`);
    expect(row.creator_id).toBe('teacher_zhang');

    const content = JSON.parse(row.content);
    expect(content.importedFrom).toBe(GATEWAY_BASE);
    expect(content.smartEduMetadata.code).toBe(GATEWAY_RESOURCE.code);
    expect(content.smartEduMetadata.certified).toBe(true);

    const timeline = JSON.parse(row.timeline);
    expect(timeline.length).toBe(GATEWAY_RESOURCE.timeline.length);

    const elements = db.prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?').all(res.lessonId) as any[];
    expect(elements.length).toBe(GATEWAY_RESOURCE.whiteboardElements.length);

    // 详情请求命中网关
    expect(fetchMock.mock.calls[0][0]).toBe(`${GATEWAY_BASE}/resources/${GATEWAY_RESOURCE.id}`);
  });

  it('学情上报提交真实 SHA-256 校验哈希并回传平台回执 (smart_edu.report_metrics)', async () => {
    let publishedEvent: any = null;
    eventBus.subscribe('smart_edu.metrics_reported', async (event) => {
      publishedEvent = event;
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ receiptId: 'GW-REC-1', status: 'ACCEPTED' }));

    const payload = {
      lessonId: 'lesson-123',
      classId: 'class-456',
      reportData: { attendanceRate: '98.5%', interactionCount: 42, averageScore: 91.2 },
    };
    const receipt = await commandBus.execute(
      commandBus.createCommand('smart_edu.report_metrics', payload, 'user:1:teacher'),
    );

    expect(receipt.success).toBe(true);
    expect(receipt.status).toBe('ACCEPTED');
    expect(receipt.receiptId).toBe('GW-REC-1');
    expect(publishedEvent?.payload?.receiptId).toBe('GW-REC-1');

    // validationHash 必须是对真实提交体的 SHA-256，经 X-SE-Payload-Hash 头提交（无随机数伪装）
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    const expectedHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    expect(init.headers['X-SE-Payload-Hash']).toBe(expectedHash);
    expect(receipt.validationHash).toBe(`SHA256:${expectedHash}`);
    // metricsReceived 如实回显提交的指标（不编造）
    expect(receipt.metricsReceived.attendanceRate).toBe('98.5%');
  });

  it('上报缺省指标时如实置 null，不编造数值 (smart_edu.report_metrics)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ACCEPTED' }));

    const receipt = await commandBus.execute(
      commandBus.createCommand('smart_edu.report_metrics', { lessonId: 'lesson-789' }, 'user:1:teacher'),
    );

    expect(receipt.success).toBe(true);
    expect(receipt.metricsReceived.attendanceRate).toBeNull();
    expect(receipt.metricsReceived.interactionCount).toBeNull();
    expect(receipt.metricsReceived.averageScore).toBeNull();
  });

  it('健康探测测量真实 RTT，失败时如实报告 UNREACHABLE (smart_edu.get_status)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 'HEALTHY' }));

    const status = await commandBus.execute(
      commandBus.createCommand('smart_edu.get_status', {}, 'user:1:teacher'),
    );
    expect(status.success).toBe(true);
    expect(status.configured).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.endpoint).toBe(GATEWAY_BASE);
    expect(status.channelStatus).toBe('HEALTHY');
    expect(typeof status.rttMs).toBe('number');
    expect(fetchMock.mock.calls[0][0]).toBe(`${GATEWAY_BASE}/health`);

    // 网关宕机 → 离线 + 原因，绝不返回 connected:true
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const down = await commandBus.execute(
      commandBus.createCommand('smart_edu.get_status', {}, 'user:1:teacher'),
    );
    expect(down.connected).toBe(false);
    expect(down.channelStatus).toBe('UNREACHABLE');
    expect(down.error).toBeTruthy();
  });

  it('启用签名凭据时请求携带 HMAC-SHA256 鉴权头', async () => {
    process.env.SMARTEDU_APP_KEY = 'test-app-key';
    process.env.SMARTEDU_APP_SECRET = 'test-app-secret';
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [] }));

    await commandBus.execute(commandBus.createCommand('smart_edu.search_resources', {}, 'user:1:teacher'));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-SE-App-Key']).toBe('test-app-key');
    expect(init.headers['X-SE-Timestamp']).toBeTruthy();
    expect(init.headers['X-SE-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });
});
