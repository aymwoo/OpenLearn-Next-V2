import type { ClassroomFlowController } from '../../../plugin-host/types';

const SEGMENT_ERROR = '学生不能更改全班当前环节';
const STAGE_ERROR = '学生不能更改全班课堂阶段';

/**
 * 学生页上的 flow：可以发自己的学案消息、刷新自己的数据。
 * 改全班环节和阶段直接拒绝，不发请求，也不改本地指针。
 * 环节对齐只来自课堂会话轮询（教师推进）。门禁仍由 lesson-engine 决定。
 */
export function guardStudentFlow(flow: ClassroomFlowController): ClassroomFlowController {
  return {
    ...flow,
    setActiveSegment() {
      throw new Error(SEGMENT_ERROR);
    },
    advanceStage() {
      throw new Error(STAGE_ERROR);
    },
  };
}

export const STUDENT_SEGMENT_GUARD_ERROR = SEGMENT_ERROR;
export const STUDENT_STAGE_GUARD_ERROR = STAGE_ERROR;
