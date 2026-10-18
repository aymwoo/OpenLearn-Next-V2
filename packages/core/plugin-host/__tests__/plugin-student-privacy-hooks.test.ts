import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PluginHost } from '../index.js';
import { ServiceRegistry } from '../../di/service-registry.js';
import { EsmLoader } from '../../esm-loader/esm-loader.js';
import { RosterService } from '../../../../server/services/roster-service.js';
import { setAuditSinkForTests, type AuditRecord } from '../../observability/audit-log.js';
import type { IWorkerTransport } from '../../worker-runtime/types.js';

import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../../di/interfaces.js';

describe('Plugin Student Privacy Hooks & GDPR Integration (Issue #145)', () => {
  let db: Database.Database;
  let pluginHost: PluginHost;
  let auditLogs: AuditRecord[] = [];

  beforeEach(async () => {
    auditLogs = [];
    setAuditSinkForTests((rec) => auditLogs.push(rec));

    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        manifest TEXT NOT NULL,
        source_code TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
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
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        student_number TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        password TEXT,
        avatar TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS class_students (class_id TEXT, student_id TEXT);
      CREATE TABLE IF NOT EXISTS student_lesson_progress (student_id TEXT, lesson_id TEXT, completed INTEGER, progress_percent REAL, assigned_at INTEGER);
      CREATE TABLE IF NOT EXISTS assignment_submissions (assignment_id TEXT, student_id TEXT, score REAL, submitted_at INTEGER);
      CREATE TABLE IF NOT EXISTS attendance (schedule_id TEXT, student_id TEXT, status TEXT, recorded_at INTEGER);
      CREATE TABLE IF NOT EXISTS exam_scores (exam_id TEXT, student_id TEXT, score REAL, recorded_at INTEGER);
      CREATE TABLE IF NOT EXISTS student_semester_reports (id TEXT, student_id TEXT, class_id TEXT, semester_name TEXT, attendance_score REAL, progress_score REAL, assignment_score REAL, exam_score REAL, total_score REAL, grade_level TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS student_rollcalls (id TEXT, student_id TEXT, class_id TEXT, picked_time INTEGER);
      CREATE TABLE IF NOT EXISTS plugin_submissions (id TEXT, lesson_id TEXT, student_id TEXT, file_path TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS plugin_peer_reviews (id TEXT, submission_id TEXT, reviewer_id TEXT, score REAL, created_at INTEGER);
      CREATE TABLE IF NOT EXISTS student_seats (class_id TEXT, student_id TEXT, lab_id TEXT, row_idx INTEGER, col_idx INTEGER);
      CREATE TABLE IF NOT EXISTS student_read_notifications (student_id TEXT, notification_id TEXT, created_at INTEGER);
      CREATE TABLE IF NOT EXISTS student_point_logs (id TEXT PRIMARY KEY, student_id TEXT, class_id TEXT, dimension_id TEXT, delta_points REAL, reason TEXT, plugin_id TEXT, created_at INTEGER);
    `);

    const registry = new ServiceRegistry();
    await registry.register(ICommandBusServiceToken, {
      execute: vi.fn(),
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
      createCommand: vi.fn(),
    } as any);
    await registry.register(IEventBusServiceToken, {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as any);
    await registry.register(IActionRegistryServiceToken, {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
    } as any);
    await registry.register(ICapabilityServiceToken, {
      register: vi.fn(),
      unregister: vi.fn(),
      hasCapability: vi.fn(),
    } as any);
    await registry.register(IProcessServiceToken, {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
    } as any);
    await registry.register(IStorageServiceToken, {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as any);
    await registry.register(IAIServiceToken, {
      chat: vi.fn(),
      complete: vi.fn(),
    } as any);

    const mockLoader: EsmLoader = {
      load: vi.fn(),
    } as unknown as EsmLoader;

    pluginHost = new PluginHost(registry, mockLoader, db);
  });

  afterEach(() => {
    setAuditSinkForTests(null);
    db.close();
  });

  describe('exportStudentDataFromPlugins', () => {
    it('正确聚合活跃插件的导出的数据，未实现的标记 not_implemented，抛错的标记 error', async () => {
      // 1. 插件 A：实现了 onStudentExport
      pluginHost.registerPreloadedPlugin('plugin-a', {
        manifest: { id: 'plugin-a', name: 'Plugin A', version: '1.0.0', main: 'index.js' },
        activate: async () => {},
        onStudentExport: async (sid) => ({ homeworkNotes: [`Note for ${sid}`] }),
      });

      // 2. 插件 B：未实现 onStudentExport
      pluginHost.registerPreloadedPlugin('plugin-b', {
        manifest: { id: 'plugin-b', name: 'Plugin B', version: '1.0.0', main: 'index.js' },
        activate: async () => {},
      });

      // 3. 插件 C：导出时抛错
      pluginHost.registerPreloadedPlugin('plugin-c', {
        manifest: { id: 'plugin-c', name: 'Plugin C', version: '1.0.0', main: 'index.js' },
        activate: async () => {},
        onStudentExport: async () => {
          throw new Error('Database locked');
        },
      });

      await pluginHost.activatePlugin('plugin-a');
      await pluginHost.activatePlugin('plugin-b');
      await pluginHost.activatePlugin('plugin-c');

      const results = await pluginHost.exportStudentDataFromPlugins('stu-999');

      expect(results['plugin-a']).toEqual({
        status: 'ok',
        data: { homeworkNotes: ['Note for stu-999'] },
      });
      expect(results['plugin-b']).toEqual({
        status: 'not_implemented',
      });
      expect(results['plugin-c']).toEqual({
        status: 'error',
        error: 'Database locked',
      });
    });

    it('支持 Worker 隔离模式下的异步消息导出', async () => {
      let messageHandler: ((msg: unknown) => void) | null = null;
      const mockTransport: IWorkerTransport = {
        postMessage: vi.fn((msg: any) => {
          if (msg.type === 'student-export-request') {
            setTimeout(() => {
              messageHandler?.({
                type: 'student-export-response',
                invokeId: msg.invokeId,
                status: 'ok',
                data: { workerExamScore: 98 },
              });
            }, 10);
          }
        }),
        on: vi.fn((_evt, handler) => {
          messageHandler = handler;
        }),
      } as any;

      (pluginHost as any).pluginInstances.set('plugin-worker', {
        manifest: { id: 'plugin-worker', name: 'Worker Plugin', version: '1.0.0' },
        workerRef: { transport: mockTransport, serviceHost: {} as any },
      });

      const results = await pluginHost.exportStudentDataFromPlugins('stu-worker-88');

      expect(results['plugin-worker']).toEqual({
        status: 'ok',
        data: { workerExamScore: 98 },
      });
    });
  });

  describe('deleteStudentDataFromPlugins', () => {
    it('调度各活跃插件的 onStudentDelete 钩子', async () => {
      const deletedStudentsA: string[] = [];
      pluginHost.registerPreloadedPlugin('plugin-del-a', {
        manifest: { id: 'plugin-del-a', name: 'Plugin Del A', version: '1.0.0', main: 'index.js' },
        activate: async () => {},
        onStudentDelete: async (sid) => {
          deletedStudentsA.push(sid);
        },
      });

      pluginHost.registerPreloadedPlugin('plugin-del-b', {
        manifest: { id: 'plugin-del-b', name: 'Plugin Del B', version: '1.0.0', main: 'index.js' },
        activate: async () => {},
      });

      await pluginHost.activatePlugin('plugin-del-a');
      await pluginHost.activatePlugin('plugin-del-b');

      const results = await pluginHost.deleteStudentDataFromPlugins('stu-del-123');

      expect(deletedStudentsA).toEqual(['stu-del-123']);
      expect(results['plugin-del-a']).toEqual({ success: true });
      expect(results['plugin-del-b']).toEqual({ success: true });
    });
  });

  describe('RosterService GDPR End-to-End Cascade & Export', () => {
    it('deleteStudentCascade 应清理内置 13 张表（包括 student_point_logs）并触发插件删除和安全审计', async () => {
      const pluginDeletedList: string[] = [];
      pluginHost.registerPreloadedPlugin('plugin-roster-test', {
        manifest: { id: 'plugin-roster-test', name: 'Roster Test Plugin', version: '1.0.0', main: 'index.js' },
        activate: async () => {},
        onStudentDelete: async (sid) => {
          pluginDeletedList.push(sid);
        },
      });
      await pluginHost.activatePlugin('plugin-roster-test');

      const rosterService = new RosterService(db, db, pluginHost);

      // 插入测试学生及关联数据
      const sid = 'stu-cascade-full';
      const now = Date.now();
      db.prepare('INSERT INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
        sid,
        'STU_001',
        '王测试',
        now,
      );
      db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run('c-1', sid);
      db.prepare('INSERT INTO student_point_logs (id, student_id, delta_points, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'pt-1',
        sid,
        15,
        '课堂积分',
        now,
      );

      const delResult = await rosterService.deleteStudentCascade(sid);

      expect(delResult.pluginsCleaned['plugin-roster-test']).toEqual({ success: true });
      expect(pluginDeletedList).toContain(sid);

      // 验证 SQLite 中数据全部被删
      expect(db.prepare('SELECT id FROM students WHERE id = ?').get(sid)).toBeUndefined();
      expect(db.prepare('SELECT * FROM class_students WHERE student_id = ?').all(sid)).toHaveLength(0);
      expect(db.prepare('SELECT * FROM student_point_logs WHERE student_id = ?').all(sid)).toHaveLength(0);

      // 验证记录了安全审计
      const audit = auditLogs.find((r) => r.event === 'student.gdpr_deleted');
      expect(audit).toBeDefined();
      expect(audit?.studentId).toBe(sid);
      expect((audit?.pluginsCleaned as any)?.['plugin-roster-test']?.success).toBe(true);
    });

    it('exportStudentData 导出的数据应包含 pointLogs 以及 pluginData', async () => {
      pluginHost.registerPreloadedPlugin('plugin-export-demo', {
        manifest: { id: 'plugin-export-demo', name: 'Export Demo', version: '1.0.0', main: 'index.js' },
        activate: async () => {},
        onStudentExport: async (sid) => ({ achievements: [`Gold badge for ${sid}`] }),
      });
      await pluginHost.activatePlugin('plugin-export-demo');

      const rosterService = new RosterService(db, db, pluginHost);

      const sid = 'stu-export-demo';
      const now = Date.now();
      db.prepare('INSERT INTO students (id, student_number, name, created_at) VALUES (?, ?, ?, ?)').run(
        sid,
        'STU_002',
        '赵测试',
        now,
      );
      db.prepare('INSERT INTO student_point_logs (id, student_id, delta_points, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'pt-exp-1',
        sid,
        25,
        '测试积分',
        now,
      );

      const exportReport = await rosterService.exportStudentData(sid);

      expect(exportReport.student.name).toBe('赵测试');
      expect(exportReport.pointLogs).toHaveLength(1);
      expect(exportReport.pointLogs[0].delta_points).toBe(25);
      expect(exportReport.pluginData['plugin-export-demo']).toEqual({
        status: 'ok',
        data: { achievements: ['Gold badge for stu-export-demo'] },
      });
    });
  });
});
