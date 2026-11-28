/**
 * 白板元素领域服务 (WhiteboardService)
 *
 * 承载白板元素查询与首次访问自动快照备份、事务级快照原子回滚与重置（DATA-INT-01）、
 * 以及通过 CommandBus 派发元素绘制、更新、删除与清空指令。
 * 独立于 Express HTTP 传输层，可直接注入 mock/db 进行无状态单元测试。
 */
import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { upsertLearningSurface, type LearningContentRef } from './learning-surface-service.js';

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

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * 白板元素更新载荷合并（纯函数，供单测覆盖）。
 *
 * 规则见 {@link WhiteboardService.updateElement} 的合并写说明：双方均为普通对象时
 * 顶层浅合并（incoming 优先）；任一方不是普通对象时保持旧的整包替换语义 ——
 * 字符串原样透传，对象/数组序列化。
 */
export function mergeWhiteboardElementData(existingData: unknown, incomingData: unknown): string {
  const existingValue = parseMaybeJson(existingData);
  const incomingValue = parseMaybeJson(incomingData);

  if (isPlainJsonObject(existingValue) && isPlainJsonObject(incomingValue)) {
    return JSON.stringify({ ...existingValue, ...incomingValue });
  }
  if (typeof incomingData === 'string') return incomingData;
  return JSON.stringify(incomingValue ?? {});
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
      .prepare('SELECT id, lesson_id, type, data, created_at FROM whiteboard_elements WHERE lesson_id = ?')
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
          .prepare(
            "SELECT id, lesson_id, type, data, created_at FROM whiteboard_elements WHERE lesson_id = ? AND type != 'snapshot_marker'",
          )
          .all(snapshotId) as WhiteboardElementItem[];

        // 还原插入
        const insertStmt = this.db.prepare(
          'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
        );
        for (const el of snapshotElements) {
          const originalId = el.id.startsWith('snapshot-') ? el.id.substring('snapshot-'.length) : el.id;
          // 阶段 5：快照里的 learning_surface 持有快照专属 surfaceId（owner=snapshot-*）。
          // 恢复后元素 id 变回原 id，surfaceId 必须指向主元素的 Surface，
          // 否则 attempt 会写到快照副本上，与主元素成绩分裂。
          let data = el.data;
          try {
            const parsed = JSON.parse(el.data) as Record<string, unknown>;
            const surfaceId = typeof parsed.surfaceId === 'string' ? parsed.surfaceId : '';
            if (surfaceId.startsWith('lsm_wb_snapshot-')) {
              parsed.surfaceId = `lsm_wb_${originalId}`;
              data = JSON.stringify(parsed);
            }
          } catch {
            // 非 JSON data 保持原样（历史元素）
          }
          insertStmt.run(originalId, lessonId, el.type, data, el.created_at);
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
   * 把已废弃的 `html-applet` 创建请求转成 `learning_surface`（阶段 6）。
   *
   * AI Agent / 旧插件仍可能传 html-applet；服务端在命令入口统一转换，
   * 元素 id 预先生成并随命令下发，保证 Surface.owner_id 与元素 id 一致。
   */
  private convertLegacyHtmlApplet(
    lessonId: string,
    rawData: unknown,
  ): { elementId: string; data: Record<string, unknown> } | null {
    let data: Record<string, unknown>;
    try {
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      data = parsed as Record<string, unknown>;
    } catch {
      return null;
    }

    const coursewareUuid = typeof data.coursewareUuid === 'string' ? data.coursewareUuid : null;
    const resourceId = typeof data.resourceId === 'string' ? data.resourceId : null;
    const code = typeof data.code === 'string' ? data.code : '';
    const inlineId = !coursewareUuid && !resourceId && code.trim() ? this.saveInlineHtml(code) : null;
    const sourceId = coursewareUuid ?? resourceId ?? inlineId;
    if (!sourceId) return null;

    const elementId = uuidv7();
    const contentRef: LearningContentRef = {
      rendererId: 'html_courseware',
      source: { kind: resourceId ? 'resource' : 'courseware', id: sourceId },
      ...(typeof data.title === 'string' && data.title ? { config: { title: data.title } } : {}),
    };
    const result = upsertLearningSurface(this.db, {
      lessonId,
      kind: 'whiteboard_element',
      ownerId: elementId,
      contentRef,
    });
    if (!result.ok) return null;

    const next: Record<string, unknown> = { ...data, surfaceId: result.surface.id };
    delete next.coursewareUuid;
    delete next.resourceId;
    delete next.code;
    delete next.sourceType;
    delete next.sourceId;
    return { elementId, data: next };
  }

  /** 与 CoursewareService.saveInlineCourseware 相同的命名 / 去重规则。 */
  private saveInlineHtml(code: string): string {
    const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
    const id = `inline-${hash}`;
    this.db
      .prepare('INSERT OR IGNORE INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'index.html', 'html', code, Date.now());
    return id;
  }

  /**
   * 绘制/新增白板元素
   */
  public async drawElement(params: { lessonId: string; type: string; data: any; actorId?: string }): Promise<any> {
    const { lessonId, actorId = 'user-frontend' } = params;
    let type = params.type;
    let data = params.data;
    let elementId: string | undefined;

    // 阶段 6：html-applet 已废弃，统一转换为 learning_surface 后写入。
    if (type === 'html-applet') {
      const converted = this.convertLegacyHtmlApplet(lessonId, data);
      if (!converted) {
        const err: any = new Error(
          'html-applet 已废弃：请提供 coursewareUuid / resourceId / code，或改用 learning_surface。',
        );
        err.status = 400;
        throw err;
      }
      type = 'learning_surface';
      data = converted.data;
      elementId = converted.elementId;
    }

    const cmd = this.commandBus.createCommand(
      'whiteboard.draw',
      {
        lessonId,
        type,
        data: typeof data === 'string' ? data : JSON.stringify(data),
        ...(elementId ? { elementId } : {}),
      },
      actorId,
      { approved: true },
    );
    return this.commandBus.execute(cmd);
  }

  /**
   * 更新白板元素（合并写）
   *
   * 两条浏览器持久化路径（授课视图直接 PUT、备课编辑器 800ms 防抖 autosave）都以
   * 「组件内存里的元素数据快照」作为 PUT body。快照从写入到落库再到下次拉取之间存在
   * 秒级窗口，期间任何**其它字段**的变化（如演示文稿翻页 `slideX`、放映同步
   * `isFullscreenForced`）都会被下一发携带过期快照的整包 PUT 静默回滚 —— 表现为
   * 「教师端已改、学生端卡在旧状态」（Issue IKYMW8：PPTX 进放映时 viewer 异步回报
   * slideCount，其整包写把刚写入的页码与放映标志一起打掉）。
   *
   * 因此 HTTP 入口在此做**顶层浅合并**：incoming 是普通对象且库内现存 data 也是
   * 普通对象时，按 `{...existing, ...incoming}` 合并落库，让浏览器写入天然成为
   * 语义增量 —— 过期快照只更新它真正改动的字段，不再回滚并发字段。
   *
   * 语义边界：
   * - 顶层键整体替换（数组、嵌套对象作为单键值原样覆盖），与既有「无删键语义」
   *   的写入方完全兼容（清空字段均为空串写入，不依赖删除键）。
   * - 任何一方不是普通对象（非法 JSON / 数组 / 标量）时保持旧的整包替换语义，
   *   命令总线的 `whiteboard.update`（AI Agent 等程序化调用方）不经此处，仍是全量写。
   */
  public async updateElement(params: {
    lessonId: string;
    elementId: string;
    data: any;
    actorId?: string;
  }): Promise<any> {
    const { lessonId, elementId, data, actorId = 'user-frontend' } = params;
    let existingData: unknown;
    try {
      const row = this.db
        .prepare('SELECT data FROM whiteboard_elements WHERE id = ? AND lesson_id = ?')
        .get(elementId, lessonId) as { data?: string } | undefined;
      existingData = row?.data;
    } catch {
      // 读取失败时退回整包替换，保持可用性优先
      existingData = undefined;
    }
    const cmd = this.commandBus.createCommand(
      'whiteboard.update',
      {
        lessonId,
        elementId,
        data: mergeWhiteboardElementData(existingData, data),
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
    const cmd = this.commandBus.createCommand('whiteboard.clear', { lessonId }, actorId, { approved: true });
    return this.commandBus.execute(cmd);
  }

  /**
   * 删除指定白板元素
   */
  public async deleteElement(lessonId: string, elementId: string, actorId = 'user-frontend'): Promise<any> {
    const cmd = this.commandBus.createCommand('whiteboard.delete', { lessonId, elementId }, actorId, {
      approved: true,
    });
    return this.commandBus.execute(cmd);
  }
}

export const whiteboardService = new WhiteboardService();
