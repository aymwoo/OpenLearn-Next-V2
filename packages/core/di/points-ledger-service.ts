import { IPointsLedgerService, PointLogItem } from './interfaces.js';
import type { Database } from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';

export class PointsLedgerService implements IPointsLedgerService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async addPoints(
    studentId: string,
    classId: string,
    dimensionId: string,
    deltaPoints: number,
    reason: string,
    pluginId?: string
  ): Promise<PointLogItem> {
    if (!studentId || !classId || !dimensionId) {
      throw new Error('studentId, classId, and dimensionId are required to log points');
    }

    const logItem: PointLogItem = {
      id: `pt_${uuidv7()}`,
      studentId,
      classId,
      dimensionId,
      pluginId: pluginId || null,
      deltaPoints,
      reason,
      createdAt: Date.now(),
    };

    this.db.prepare(`
      INSERT INTO student_point_logs (
        id, student_id, class_id, dimension_id, plugin_id, delta_points, reason, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logItem.id,
      logItem.studentId,
      logItem.classId,
      logItem.dimensionId,
      logItem.pluginId,
      logItem.deltaPoints,
      logItem.reason,
      logItem.createdAt
    );

    return logItem;
  }

  async getLogs(studentId: string, classId?: string): Promise<PointLogItem[]> {
    if (!studentId) return [];

    let query = 'SELECT * FROM student_point_logs WHERE student_id = ?';
    const params: any[] = [studentId];

    if (classId) {
      query += ' AND class_id = ?';
      params.push(classId);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      classId: r.class_id,
      dimensionId: r.dimension_id,
      pluginId: r.plugin_id,
      deltaPoints: r.delta_points,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }

  async getStudentTotalByDimension(studentId: string, classId: string, dimensionId: string): Promise<number> {
    const row = this.db.prepare(`
      SELECT SUM(delta_points) as total FROM student_point_logs
      WHERE student_id = ? AND class_id = ? AND dimension_id = ?
    `).get(studentId, classId, dimensionId) as { total: number | null } | undefined;

    return row?.total ?? 0;
  }

  async getStudentDimensionSummary(studentId: string, classId: string): Promise<Record<string, number>> {
    const rows = this.db.prepare(`
      SELECT dimension_id, SUM(delta_points) as total FROM student_point_logs
      WHERE student_id = ? AND class_id = ?
      GROUP BY dimension_id
    `).all(studentId, classId) as { dimension_id: string; total: number }[];

    const summary: Record<string, number> = {};
    rows.forEach((r) => {
      summary[r.dimension_id] = r.total;
    });

    return summary;
  }
}
