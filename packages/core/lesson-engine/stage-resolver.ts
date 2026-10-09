/**
 * OpenLearn Lesson Flow Engine - Stage & Resource Resolver
 *
 * 教学环节与资源（测验/作业/白板图元）双向关联解析器与物理准入门禁执行器。
 *
 * ## 设计目标（I-1 遗留局限落地 · 资源级物理强门禁）
 *
 * 此前服务端虽然提供了权威的 `POST /api/lessons/:id/stage-access` 门禁端点，
 * 但仅供客户端 UI 在点击环节时查询；底层数据协议中 timeline segment 与白板图元
 * 缺乏显式关联，导致学生绕过前端直接调用 `POST /api/lessons/:id/quiz-submit` 时，
 * 服务端无法反查该测验属于哪个环节，也就无法在「记录学习成果」物理动作上设卡。
 *
 * 本模块提供：
 * 1. `resolveElementStageId`：多层次解析图元所属的环节 ID（优先使用 element.data.segmentId，
 *    次选 lessons.timeline 中 segment.elementIds / segment.elementId）；
 * 2. `resolveAssignmentStageId`：解析作业所属的环节 ID；
 * 3. `enforceStageAccess`：在成果提交（测验/作业）前执行 StageGuardPipeline 强门禁，
 *    未放行则抛出 403 异常，中断物理写入。
 */

export interface StageAccessEnforceContext {
  studentId: string;
  lessonId: string;
  stageId: string;
  elementId?: string;
  action: 'quiz_submit' | 'assignment_submit' | string;
}

/**
 * 解析教学图元（测验、作业、白板对象）所属的环节 ID
 */
export function resolveElementStageId(
  db: any,
  lessonId: string,
  elementId: string,
  dataObj?: any,
): string | null {
  if (!db || !lessonId || !elementId) return null;

  // 1. 如果显式传入的 dataObj 中已标记 segmentId，直接返回
  if (dataObj && typeof dataObj === 'object') {
    const seg = (dataObj as any).segmentId;
    if (typeof seg === 'string' && seg.trim().length > 0) {
      return seg.trim();
    }
  }

  // 2. 从 whiteboard_elements 表查 data.segmentId
  try {
    const elRow = db
      .prepare('SELECT data FROM whiteboard_elements WHERE id = ? AND lesson_id = ?')
      .get(elementId, lessonId) as { data: string } | undefined;
    if (elRow?.data) {
      const parsed = typeof elRow.data === 'string' ? JSON.parse(elRow.data) : elRow.data;
      if (parsed && typeof parsed.segmentId === 'string' && parsed.segmentId.trim().length > 0) {
        return parsed.segmentId.trim();
      }
    }
  } catch {
    // 忽略异常
  }

  // 3. 从 lessons 表查 timeline 中的 segment.elementIds / segment.elementId
  try {
    const lessonRow = db
      .prepare('SELECT timeline FROM lessons WHERE id = ?')
      .get(lessonId) as { timeline: string | null } | undefined;
    if (lessonRow?.timeline) {
      const segments =
        typeof lessonRow.timeline === 'string' ? JSON.parse(lessonRow.timeline) : lessonRow.timeline;
      if (Array.isArray(segments)) {
        for (const seg of segments) {
          if (!seg || typeof seg !== 'object') continue;
          if (Array.isArray(seg.elementIds) && seg.elementIds.includes(elementId)) {
            return String(seg.id);
          }
          if (typeof seg.elementId === 'string' && seg.elementId === elementId) {
            return String(seg.id);
          }
        }
      }
    }
  } catch {
    // 忽略异常
  }

  return null;
}

/**
 * 解析作业所属的环节 ID
 */
export function resolveAssignmentStageId(
  db: any,
  lessonId: string,
  assignmentId: string,
  elementId?: string | null,
): string | null {
  if (!db || !lessonId || !assignmentId) return null;

  // 1. 若 assignment 带有 element_id，先按 element_id 解析所属环节
  if (elementId) {
    const stageFromElement = resolveElementStageId(db, lessonId, elementId);
    if (stageFromElement) return stageFromElement;
  }

  // 2. 查 timeline 中的 segment.assignmentIds 或 segment.elementIds 包含 assignmentId
  try {
    const lessonRow = db
      .prepare('SELECT timeline FROM lessons WHERE id = ?')
      .get(lessonId) as { timeline: string | null } | undefined;
    if (lessonRow?.timeline) {
      const segments =
        typeof lessonRow.timeline === 'string' ? JSON.parse(lessonRow.timeline) : lessonRow.timeline;
      if (Array.isArray(segments)) {
        for (const seg of segments) {
          if (!seg || typeof seg !== 'object') continue;
          if (Array.isArray(seg.assignmentIds) && seg.assignmentIds.includes(assignmentId)) {
            return String(seg.id);
          }
          if (Array.isArray(seg.elementIds) && seg.elementIds.includes(assignmentId)) {
            return String(seg.id);
          }
          if (seg.assignmentId === assignmentId) {
            return String(seg.id);
          }
        }
      }
    }
  } catch {
    // 忽略异常
  }

  return null;
}

/**
 * 物理资源级门禁执行：未满足条件时抛出 403 异常拒绝写入
 */
export async function enforceStageAccess(
  pipeline: any,
  ctx: StageAccessEnforceContext,
): Promise<void> {
  if (!pipeline || typeof pipeline.checkAccess !== 'function') return;

  const result = await pipeline.checkAccess({
    studentId: ctx.studentId,
    lessonId: ctx.lessonId,
    currentStageId: null,
    targetStageId: ctx.stageId,
    metadata: {
      elementId: ctx.elementId,
      action: ctx.action,
    },
  });

  if (!result.allowed) {
    const err = new Error(
      `Stage access denied: ${result.reason || '尚未满足进入该环节的前置条件'}`
    ) as any;
    err.status = 403;
    err.code = 'STAGE_ACCESS_DENIED';
    err.reason = result.reason;
    err.targetStageId = ctx.stageId;
    throw err;
  }
}
