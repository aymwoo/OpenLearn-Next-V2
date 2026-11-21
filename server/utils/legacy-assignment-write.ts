import type { Response } from 'express';

/**
 * 阶段 2：旧作业写端点统一 410。
 *
 * 读端点（GET /api/assignments*）保持不变；写端点全部迁到
 * `/api/learning-surface-assignments/*`，由统一 attempt 状态接管。
 * 返回 410（Gone）而不是 403，让调用方明确「接口已下线」并读取 replacement。
 */
export function rejectLegacyAssignmentWrite(res: Response, replacement: string): void {
  res.status(410).json({
    success: false,
    code: 'LEGACY_ASSIGNMENT_WRITE_DISABLED',
    error: 'This assignment write endpoint has been retired. Use the learning-surface assignment API instead.',
    replacement,
  });
}
