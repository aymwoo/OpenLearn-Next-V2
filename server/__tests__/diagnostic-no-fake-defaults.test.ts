import { describe, it, expect, beforeAll } from 'vitest';
import { DiagnosticService } from '../services/diagnostic-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

/**
 * Issue #244 回归：课前诊断不得编造默认值。
 * - 无 classId / 班级无名单 → totalStudents = 0（不再凭空回退 32）
 * - averageTimeSpentMins 恒为 null（白板事件流没有真实用时来源，不再写死 15）
 */
describe('getPreClassDiagnostic 无编造默认值（Issue #244）', () => {
  const db = kernelContainer.db as any;
  let diagService: DiagnosticService;

  beforeAll(() => {
    ensureTestSchema();
    diagService = new DiagnosticService(db, undefined as any);
    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('les-diag-244', '诊断假默认值回归课', 't-244', now, now);
  });

  it('无 classId 时分母为 0，平均用时为 null', () => {
    const report = diagService.getPreClassDiagnostic('les-diag-244');
    expect(report.prepSummary.totalStudents).toBe(0);
    expect(report.prepSummary.completedCount).toBe(0);
    expect(report.prepSummary.completionRate).toBe(0);
    expect(report.prepSummary.averageTimeSpentMins).toBeNull();
  });

  it('classId 指向空班级时分母同样为 0', () => {
    const now = Date.now();
    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      'cls-diag-244-empty',
      '空名单班',
      't-244',
      now,
    );
    const report = diagService.getPreClassDiagnostic('les-diag-244', 'cls-diag-244-empty');
    expect(report.prepSummary.totalStudents).toBe(0);
    expect(report.prepSummary.averageTimeSpentMins).toBeNull();
  });

  it('有真实名单时完成率使用真实分母，平均用时仍为 null', () => {
    const now = Date.now();
    db.prepare('INSERT OR REPLACE INTO classes (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)').run(
      'cls-diag-244-real',
      '真实名单班',
      't-244',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      'cls-diag-244-real',
      'stu-diag-244-a',
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      'cls-diag-244-real',
      'stu-diag-244-b',
      now,
    );
    const report = diagService.getPreClassDiagnostic('les-diag-244', 'cls-diag-244-real');
    expect(report.prepSummary.totalStudents).toBe(2);
    expect(report.prepSummary.averageTimeSpentMins).toBeNull();
  });
});
