import { describe, it, expect, beforeEach } from 'vitest';
import betterSqlite3 from 'better-sqlite3';
import { PointsDimensionRegistry } from '../points-dimension-registry.js';
import { PointsLedgerService } from '../points-ledger-service.js';
import {
  IPointsDimensionRegistryToken,
  IPointsLedgerServiceToken,
  PointsDimensionSpec,
} from '../interfaces.js';
import { Token } from '../token.js';

describe('Student Points Ledger & Dimension Registry (Wave 1)', () => {
  it('should define DI Tokens correctly', () => {
    expect(IPointsDimensionRegistryToken).toBeInstanceOf(Token);
    expect(IPointsDimensionRegistryToken.name).toBe('@openlearn/core:IPointsDimensionRegistry');
    expect(IPointsLedgerServiceToken).toBeInstanceOf(Token);
    expect(IPointsLedgerServiceToken.name).toBe('@openlearn/core:IPointsLedgerService');
  });

  it('should initialize default built-in dimensions in registry', () => {
    const registry = new PointsDimensionRegistry();
    const dims = registry.listDimensions();

    expect(dims.length).toBeGreaterThanOrEqual(4);
    const ids = dims.map((d) => d.id);
    expect(ids).toContain('attendance');
    expect(ids).toContain('progress');
    expect(ids).toContain('assignment');
    expect(ids).toContain('exam');
  });

  it('should allow plugins to register custom points dimensions', () => {
    const registry = new PointsDimensionRegistry();
    const customDim: PointsDimensionSpec = {
      id: 'ai_practice',
      name: 'AI对话练习分',
      category: 'plugin',
      defaultWeight: 0.1,
      maxScore: 100,
      description: '完成 AI 授课助手的自主对话与随堂测验',
      pluginId: 'prov_openai',
    };

    registry.registerDimension(customDim);

    expect(registry.getDimension('ai_practice')).toEqual(customDim);
    expect(registry.listDimensions().length).toBe(5);
  });

  it('should throw error when registering invalid dimension', () => {
    const registry = new PointsDimensionRegistry();
    expect(() => registry.registerDimension({} as any)).toThrow();
  });
});

describe('PointsLedgerService Integration (Wave 2)', () => {
  let db: betterSqlite3.Database;
  let ledgerService: PointsLedgerService;

  beforeEach(() => {
    db = betterSqlite3(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_point_logs (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        class_id TEXT NOT NULL,
        dimension_id TEXT NOT NULL,
        plugin_id TEXT,
        delta_points REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    ledgerService = new PointsLedgerService(db);
  });

  it('should add points log items and retrieve history', async () => {
    const studentId = 'student-alice';
    const classId = 'class-101';

    const item1 = await ledgerService.addPoints(
      studentId,
      classId,
      'attendance',
      10,
      '全勤卡扣打卡奖励',
      'builtin'
    );
    const item2 = await ledgerService.addPoints(
      studentId,
      classId,
      'ai_practice',
      15,
      '完成 AI 对话强化练习',
      'prov_openai'
    );

    expect(item1.id).toBeDefined();
    expect(item1.deltaPoints).toBe(10);
    expect(item2.deltaPoints).toBe(15);

    const logs = await ledgerService.getLogs(studentId, classId);
    expect(logs.length).toBe(2);
    const dimIds = logs.map(l => l.dimensionId);
    expect(dimIds).toContain('ai_practice');
    expect(dimIds).toContain('attendance');
  });

  it('should calculate dimension summaries and totals correctly', async () => {
    const studentId = 'student-bob';
    const classId = 'class-101';

    await ledgerService.addPoints(studentId, classId, 'interactive_quiz', 20, '随堂抢答第一名', 'ext-quiz');
    await ledgerService.addPoints(studentId, classId, 'interactive_quiz', 15, '随堂测验答对满分', 'ext-quiz');
    await ledgerService.addPoints(studentId, classId, 'peer_review', 30, '提交高质量同行作业评审', 'assignment-eval');

    const quizTotal = await ledgerService.getStudentTotalByDimension(studentId, classId, 'interactive_quiz');
    expect(quizTotal).toBe(35);

    const summary = await ledgerService.getStudentDimensionSummary(studentId, classId);
    expect(summary['interactive_quiz']).toBe(35);
    expect(summary['peer_review']).toBe(30);
  });
});
