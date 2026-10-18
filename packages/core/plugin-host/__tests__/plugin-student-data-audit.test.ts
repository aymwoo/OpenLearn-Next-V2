import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildContext } from '../context-builder.js';
import { ResourceTracker } from '../resource-tracker.js';
import { ServiceRegistry } from '../../di/service-registry.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IPointsLedgerServiceToken,
  IPointsDimensionRegistryToken,
  type IPointsLedgerService,
} from '../../di/interfaces.js';
import { CAP_STUDENT_DATA_READ, CAP_STUDENT_DATA_WRITE } from '../method-policy.js';
import { setAuditSinkForTests, type AuditRecord } from '../../observability/audit-log.js';
import { ServiceHost } from '../../worker-runtime/service-host.js';
import type { IWorkerTransport, InvokeMessage } from '../../worker-runtime/types.js';

describe('Plugin Student Data Privacy & Audit (Issue #145)', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let tracker: ResourceTracker;
  let auditLogs: AuditRecord[] = [];
  let mockLedger: IPointsLedgerService;

  beforeEach(async () => {
    auditLogs = [];
    setAuditSinkForTests((rec) => auditLogs.push(rec));

    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        correlationId TEXT
      );
      CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, key)
      );
    `);

    serviceRegistry = new ServiceRegistry();
    tracker = new ResourceTracker();

    await serviceRegistry.register(ICommandBusServiceToken, {
      execute: vi.fn(),
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
      createCommand: vi.fn(),
      setInterceptor: vi.fn(),
    } as any);
    await serviceRegistry.register(IEventBusServiceToken, {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as any);
    await serviceRegistry.register(IActionRegistryServiceToken, {
      register: vi.fn(),
      unregister: vi.fn(),
      getAllActions: vi.fn().mockResolvedValue([]),
      getAgentTools: vi.fn().mockResolvedValue([]),
    } as any);
    await serviceRegistry.register(ICapabilityServiceToken, {
      grant: vi.fn(),
      revokeAll: vi.fn(),
      check: vi.fn().mockResolvedValue(true),
    } as any);
    await serviceRegistry.register(IProcessServiceToken, {
      spawn: vi.fn(),
      kill: vi.fn(),
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
      registerInterval: vi.fn(),
      restore: vi.fn(),
      getProcessOwner: vi.fn().mockReturnValue(undefined),
    } as any);
    await serviceRegistry.register(IStorageServiceToken, {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    } as any);
    await serviceRegistry.register(IAIServiceToken, {
      generateText: vi.fn(),
    } as any);

    mockLedger = {
      addPoints: vi.fn(async (studentId, classId, dim, delta, reason, pluginId) => ({
        id: 'pt-1',
        studentId,
        classId,
        dimensionId: dim,
        deltaPoints: delta,
        reason,
        pluginId,
        createdAt: Date.now(),
      })),
      getLogs: vi.fn(async (studentId) => [
        {
          id: 'log-1',
          studentId,
          classId: 'c-1',
          dimensionId: 'dim-1',
          deltaPoints: 10,
          reason: 'good job',
          createdAt: Date.now(),
        },
      ]),
      getStudentTotalByDimension: vi.fn(async () => 50),
      getStudentDimensionSummary: vi.fn(async () => ({ 'dim-1': 50 })),
    };

    await serviceRegistry.register(IPointsLedgerServiceToken, mockLedger);
  });

  afterEach(() => {
    setAuditSinkForTests(null);
    db.close();
  });

  describe('Inline Plugin PointsLedger Wrapping', () => {
    it('当插件声明 student-data:read 能力时，访问学生积分数据记录审计且无 migrationWarning', async () => {
      const manifest: any = {
        id: 'test-audit-plugin',
        name: 'Test Audit Plugin',
        version: '1.0.0',
        main: 'index.js',
        capabilitiesProposed: [CAP_STUDENT_DATA_READ],
      };

      const ctx = await buildContext(serviceRegistry, tracker, 'test-audit-plugin', manifest, db);
      const ledger = ctx.services.pointsLedger as IPointsLedgerService;
      expect(ledger).toBeDefined();

      const logs = await ledger.getLogs('stu-101', 'class-1');
      expect(logs).toHaveLength(1);
      expect(mockLedger.getLogs).toHaveBeenCalledWith('stu-101', 'class-1');

      const audit = auditLogs.find((r) => r.event === 'plugin.student_data_access');
      expect(audit).toBeDefined();
      expect(audit?.pluginId).toBe('test-audit-plugin');
      expect(audit?.studentId).toBe('stu-101');
      expect(audit?.method).toBe('getLogs');
      expect(audit?.operation).toBe('read');
      expect(audit?.hasCapability).toBe(true);
      expect(audit?.migrationWarning).toBeUndefined();
    });

    it('当插件未声明 student-data:read 能力时，放行读取，输出警告并标记 migrationWarning: true', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manifest: any = {
        id: 'test-legacy-plugin',
        name: 'Legacy Plugin',
        version: '1.0.0',
        main: 'index.js',
        capabilitiesProposed: [], // 未声明能力
      };

      const ctx = await buildContext(serviceRegistry, tracker, 'test-legacy-plugin', manifest, db);
      const ledger = ctx.services.pointsLedger as IPointsLedgerService;

      const summary = await ledger.getStudentDimensionSummary('stu-202', 'class-1');
      expect(summary).toEqual({ 'dim-1': 50 });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('without declaring "student-data:read"'),
      );

      const audit = auditLogs.find((r) => r.event === 'plugin.student_data_access');
      expect(audit).toBeDefined();
      expect(audit?.studentId).toBe('stu-202');
      expect(audit?.method).toBe('getStudentDimensionSummary');
      expect(audit?.operation).toBe('read');
      expect(audit?.hasCapability).toBe(false);
      expect(audit?.migrationWarning).toBe(true);

      warnSpy.mockRestore();
    });

    it('当插件调用 addPoints 写入数据时，按 student-data:write 鉴权并记录 write 操作审计', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const manifest: any = {
        id: 'test-writer-plugin',
        name: 'Writer Plugin',
        version: '1.0.0',
        main: 'index.js',
        capabilitiesProposed: [CAP_STUDENT_DATA_READ], // 只有 read，没有 write
      };

      const ctx = await buildContext(serviceRegistry, tracker, 'test-writer-plugin', manifest, db);
      const ledger = ctx.services.pointsLedger as IPointsLedgerService;

      await ledger.addPoints('stu-303', 'class-1', 'dim-1', 5, '课堂表现优秀');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('without declaring "student-data:write"'),
      );

      const audit = auditLogs.find((r) => r.event === 'plugin.student_data_access' && r.operation === 'write');
      expect(audit).toBeDefined();
      expect(audit?.studentId).toBe('stu-303');
      expect(audit?.method).toBe('addPoints');
      expect(audit?.hasCapability).toBe(false);
      expect(audit?.migrationWarning).toBe(true);

      warnSpy.mockRestore();
    });
  });

  describe('Worker Mode ServiceHost PointsLedger RPC Intercept', () => {
    it('Worker 插件通过 RPC 调用 PointsLedger 时，记录统一审计日志', async () => {
      const postedMessages: unknown[] = [];
      const mockTransport = {
        postMessage: vi.fn((msg) => postedMessages.push(msg)),
      } as unknown as IWorkerTransport;
      const mockCapGuard: any = { check: vi.fn().mockReturnValue(true) };

      const serviceHost = new ServiceHost(
        serviceRegistry,
        mockCapGuard,
        'plugin:ext-worker-hub',
        [CAP_STUDENT_DATA_READ],
        undefined,
        undefined,
        'ext-worker-hub',
        undefined,
        new Set(['@openlearn/core:IPointsLedgerService']),
      );

      const invokeMsg: InvokeMessage = {
        type: 'invoke',
        invokeId: 'inv-1',
        token: '@openlearn/core:IPointsLedgerService',
        method: 'getLogs',
        args: ['stu-worker-1', 'class-1'],
      };

      await serviceHost.handleInvoke(invokeMsg, mockTransport);

      const audit = auditLogs.find((r) => r.event === 'plugin.student_data_access');
      expect(audit).toBeDefined();
      expect(audit?.pluginId).toBe('ext-worker-hub');
      expect(audit?.studentId).toBe('stu-worker-1');
      expect(audit?.method).toBe('getLogs');
      expect(audit?.operation).toBe('read');
      expect(audit?.hasCapability).toBe(true);
      expect(audit?.migrationWarning).toBeUndefined();

      expect(postedMessages).toContainEqual(
        expect.objectContaining({
          type: 'result',
          invokeId: 'inv-1',
        }),
      );
    });

    it('Worker 插件未声明能力调用写入时，放行并记录 migrationWarning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const postedMessages: unknown[] = [];
      const mockTransport = {
        postMessage: vi.fn((msg) => postedMessages.push(msg)),
      } as unknown as IWorkerTransport;
      const mockCapGuard: any = { check: vi.fn().mockReturnValue(true) };

      const serviceHost = new ServiceHost(
        serviceRegistry,
        mockCapGuard,
        'plugin:ext-worker-unauthorized',
        ['grades:read'], // 没有 student-data:write
        undefined,
        undefined,
        'ext-worker-unauthorized',
        undefined,
        new Set(['@openlearn/core:IPointsLedgerService']),
      );

      const invokeMsg: InvokeMessage = {
        type: 'invoke',
        invokeId: 'inv-2',
        token: '@openlearn/core:IPointsLedgerService',
        method: 'addPoints',
        args: ['stu-worker-2', 'class-1', 'dim-1', 10, 'bonus'],
      };

      await serviceHost.handleInvoke(invokeMsg, mockTransport);

      const audit = auditLogs.find((r) => r.event === 'plugin.student_data_access' && r.studentId === 'stu-worker-2');
      expect(audit).toBeDefined();
      expect(audit?.operation).toBe('write');
      expect(audit?.hasCapability).toBe(false);
      expect(audit?.migrationWarning).toBe(true);

      warnSpy.mockRestore();
    });
  });
});
