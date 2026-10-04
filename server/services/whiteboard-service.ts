/**
 * 白板元素领域服务 (WhiteboardService)
 *
 * 承载白板元素查询与首次访问自动快照备份、事务级快照原子回滚与重置（DATA-INT-01）、
 * 以及通过 CommandBus 派发元素绘制、更新、删除与清空指令。
 * 独立于 Express HTTP 传输层，可直接注入 mock/db 进行无状态单元测试。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';

export interface WhiteboardElementItem {
  id: string;
  lesson_id: string;
  type: string;
  data: string;
  created_at: number;
}

export interface ResetWhiteboardResult {
  success: boolean;
  message: string;
}

export class WhiteboardService {
  constructor(
    private readonly db: Database.Database = kernelContainer.db,
    private readonly commandBus: any = kernelContainer.commandBus,
  ) {}

  // ── 1. 白板元素检索与自动快照 ────────────────────────────────────────────────

  /**
   * 获取课节所有白板元素（若首次加载且无快照，自动创建快照备份）
   */
  public getWhiteboardElements(lessonId: string): WhiteboardElementItem[] {
    const elements = this.db
      .prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?')
      .all(lessonId) as WhiteboardElementItem[];

    // 首次访问时自动生成快照（排除作业白板与快照自身）
    if (!lessonId.startsWith('assignment-') && !lessonId.startsWith('snapshot-')) {
      try {
        const snapshotId = `snapshot-${lessonId}`;
        const markerCheck = this.db
          .prepare('SELECT count(*) as count FROM whiteboard_elements WHERE lesson_id = ?')
          .get(snapshotId) as { count: number } | undefined;

        const count = markerCheck ? markerCheck.count : 0;
        if (count === 0 && elements.length > 0) {
          const insertStmt = this.db.prepare(
            'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
          );

          // 事务写入快照
          const snapshotTx = this.db.transaction(() => {
            insertStmt.run(`marker-${lessonId}-${Date.now()}`, snapshotId, 'snapshot_marker', '{}', Date.now());
            for (const el of elements) {
              insertStmt.run(`snapshot-${el.id}`, snapshotId, el.type, el.data, el.created_at);
            }
          });
          snapshotTx();
        }
      } catch (err: any) {
        console.warn('[WhiteboardService] Failed to create whiteboard snapshot:', err?.message);
      }
    }

    return elements;
  }

  // ── 2. 白板状态重置与快照回滚 ────────────────────────────────────────────────

  /**
   * 重置白板（作业白板清空，常规课堂优先回滚到快照并带事务原子保护）
   */
  public resetWhiteboard(lessonId: string): ResetWhiteboardResult {
    // 1. 若为作业白板，重置即清空
    if (lessonId.startsWith('assignment-')) {
      this.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
      return { success: true, message: 'Assignment whiteboard reset to empty' };
    }

    const snapshotId = `snapshot-${lessonId}`;
    const hasSnapshot = this.db
      .prepare('SELECT count(*) as count FROM whiteboard_elements WHERE lesson_id = ?')
      .get(snapshotId) as { count: number } | undefined;

    const count = hasSnapshot ? hasSnapshot.count : 0;

    if (count > 0) {
      // 2. 存在快照：事务级原子回滚（DATA-INT-01）
      const revertTx = this.db.transaction(() => {
        // 清除现有元素
        this.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);

        // 提取快照备份（剔除标记）
        const snapshotElements = this.db
          .prepare("SELECT * FROM whiteboard_elements WHERE lesson_id = ? AND type != 'snapshot_marker'")
          .all(snapshotId) as WhiteboardElementItem[];

        // 还原插入
        const insertStmt = this.db.prepare(
          'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
        );
        for (const el of snapshotElements) {
          const originalId = el.id.startsWith('snapshot-') ? el.id.substring('snapshot-'.length) : el.id;
          insertStmt.run(originalId, lessonId, el.type, el.data, el.created_at);
        }
      });
      revertTx();
      return { success: true, message: 'Lesson whiteboard reset to start state' };
    }

    // 3. 无快照则直接清空
    this.db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
    return { success: true, message: 'Lesson whiteboard cleared (no snapshot)' };
  }

  // ── 3. 命令总线代理操作 (Command Execution) ──────────────────────────────────

  /**
   * 绘制/新增白板元素
   */
  public async drawElement(params: {
    lessonId: string;
    type: string;
    data: any;
    actorId?: string;
  }): Promise<any> {
    const { lessonId, type, data, actorId = 'user-frontend' } = params;
    const cmd = this.commandBus.createCommand(
      'whiteboard.draw',
      {
        lessonId,
        type,
        data: typeof data === 'string' ? data : JSON.stringify(data),
      },
      actorId,
      { approved: true },
    );
    return this.commandBus.execute(cmd);
  }

  /**
   * 更新白板元素
   */
  public async updateElement(params: {
    lessonId: string;
    elementId: string;
    data: any;
    actorId?: string;
  }): Promise<any> {
    const { lessonId, elementId, data, actorId = 'user-frontend' } = params;
    const cmd = this.commandBus.createCommand(
      'whiteboard.update',
      {
        lessonId,
        elementId,
        data: typeof data === 'string' ? data : JSON.stringify(data),
      },
      actorId,
      { approved: true },
    );
    return this.commandBus.execute(cmd);
  }

  /**
   * 清空课节所有白板元素
   */
  public async clearWhiteboard(lessonId: string, actorId = 'user-frontend'): Promise<any> {
    const cmd = this.commandBus.createCommand(
      'whiteboard.clear',
      { lessonId },
      actorId,
      { approved: true },
    );
    return this.commandBus.execute(cmd);
  }

  /**
   * 删除指定白板元素
   */
  public async deleteElement(lessonId: string, elementId: string, actorId = 'user-frontend'): Promise<any> {
    const cmd = this.commandBus.createCommand(
      'whiteboard.delete',
      { lessonId, elementId },
      actorId,
      { approved: true },
    );
    return this.commandBus.execute(cmd);
  }
}

export const whiteboardService = new WhiteboardService();
