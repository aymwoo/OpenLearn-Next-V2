/**
 * 作业中心（Assignment Hub）路由
 *
 * 读路由已抽到 `assignment-read.ts`，与 `/api/learning-surface-assignments/*`
 * 共用同一份鉴权与读取逻辑。本文件保留白板作业对象入口的旧写端点（统一 410）
 * 与附件 GC 调度。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import type { ServerContext } from '../context.js';
import { rejectLegacyAssignmentWrite } from '../utils/legacy-assignment-write.js';
import { AssignmentService } from '../services/assignment-service.js';
import { registerAssignmentReadRoutes } from './assignment-read.js';

/**
 * M4: 物理清理已软删除超过保留期的附件文件（导出供单测使用，委托至 AssignmentService）。
 */
export function gcSoftDeletedAssignmentFiles(
  db: Database.Database = kernelContainer.db,
  retentionMs: number = 7 * 24 * 60 * 60 * 1000,
): number {
  return new AssignmentService(db).gcSoftDeletedAssignmentFiles(retentionMs);
}

/** GC 调度：注册路由时执行一次 + 每 24h 一次（unref 不阻塞退出） */
function scheduleAssignmentFileGC(service: AssignmentService): void {
  try {
    service.gcSoftDeletedAssignmentFiles();
  } catch {
    /* 首次执行失败不影响路由注册 */
  }
  const timer = setInterval(
    () => {
      try {
        const removed = service.gcSoftDeletedAssignmentFiles();
        if (removed > 0) console.log(`[assignment-hub] GC removed ${removed} soft-deleted files`);
      } catch (e) {
        console.warn('[assignment-hub] file GC failed:', e);
      }
    },
    24 * 60 * 60 * 1000,
  );
  timer.unref?.();
}

export function registerAssignmentHubRoutes(ctx: ServerContext) {
  const { app } = ctx;
  const assignmentService = new AssignmentService();

  // M4: 启动软删除文件物理 GC（立即一次 + 每 24h）
  scheduleAssignmentFileGC(assignmentService);

  // 读路由：与本文件的写端点分开维护，新旧路径共用 `assignment-read.ts`。
  registerAssignmentReadRoutes(app, {
    basePath: '/api/assignments',
    successorBasePath: '/api/learning-surface-assignments',
  });

  // ── 旧写端点：统一 410，指向 learning-surface 通道 ───────────────────────
  app.post('/api/assignments', requireAuth('teacher', 'administrator'), (_req, res) => {
    rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments');
  });

  app.post('/api/assignments/:assignmentId/files', requireScopedAuth('class-member'), (_req, res) => {
    rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/:assignmentId/files');
  });

  app.delete('/api/assignments/:assignmentId/files/:fileId', requireScopedAuth('class-member'), (_req, res) => {
    rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/:assignmentId/files/:fileId');
  });

  app.post('/api/assignments/:assignmentId/submit', requireScopedAuth('class-member'), (_req, res) => {
    rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/:assignmentId/submit');
  });

  app.post('/api/assignments/:assignmentId/peer-review', requireScopedAuth('class-member'), (_req, res) => {
    rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/:assignmentId/peer-review');
  });

  app.post(
    '/api/assignments/:assignmentId/assign-peer-reviews',
    requireAuth('teacher', 'administrator'),
    (_req, res) => {
      rejectLegacyAssignmentWrite(res, '/api/learning-surface-assignments/:assignmentId/assign-peer-reviews');
    },
  );
}
