/**
 * 演示数据管理路由（DEMO-SEED-01）
 *
 * 为 Demo 演示与功能验收提供一键播种 / 一键清理。
 *
 * 安全边界：
 * - 全部端点 `requireAuth('administrator')`
 * - 清理只删除 `demo_data_registry` 登记的行，**不依赖任何命名约定**
 * - 管理员账号（`users.role='administrator'`）永不被删除
 * - 播种幂等，重复调用返回同一批 ID
 *
 * @module
 */

import type { ServerContext } from '../context.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';
import {
  cleanupDemoData,
  getDemoDataStatus,
  seedDemoData,
  DEMO_TEACHER,
  DEMO_IDS,
  DEMO_TAG,
} from '../services/demo-data.js';

export function registerDemoDataRoutes(_ctx: ServerContext) {
  const app = _ctx.app;
  const db = () => kernelContainer.db;

  /** 当前状态：是否已播种、各类实体数量、演示教师是否存在。 */
  app.get('/api/demo-data/status', requireAuth('administrator'), (_req, res) => {
    try {
      const status = getDemoDataStatus(db());
      res.json({ success: true, result: { ...status, credentials: DEMO_TEACHER } });
    } catch (e: unknown) {
      sendSafeError(res, e);
    }
  });

  /**
   * 一键初始化演示数据。
   *
   * 已播种时是幂等空操作（返回现有数据），不会产生第二份。
   * 需 `?reset=true` 时先清理再重新播种。
   */
  app.post('/api/demo-data/seed', requireAuth('administrator'), (req, res) => {
    try {
      const reset = req.query?.reset === 'true' || req.query?.reset === '1';
      if (reset) cleanupDemoData(db());
      const status = seedDemoData(db());
      res.json({ success: true, result: { ...status, credentials: DEMO_TEACHER } });
    } catch (e: unknown) {
      sendSafeError(res, e);
    }
  });

  /**
   * 一键清理演示数据。
   *
   * 需显式传 `confirm: 'PURGE_DEMO_DATA'`，避免误触。
   * 响应中 `skippedAdministrators` 是审计信号，正常恒为 0。
   */
  app.post('/api/demo-data/cleanup', requireAuth('administrator'), (req, res) => {
    try {
      if (req.body?.confirm !== 'PURGE_DEMO_DATA') {
        res.status(400).json({
          success: false,
          error: '需要显式确认：请在请求体传入 confirm: "PURGE_DEMO_DATA"',
        });
        return;
      }
      const before = getDemoDataStatus(db());
      const report = cleanupDemoData(db());
      const after = getDemoDataStatus(db());
      res.json({
        success: true,
        result: { before, report, after },
        message:
          report.totalRemoved === 0
            ? '当前没有已播种的演示数据，无需清理。'
            : `已清理 ${report.totalRemoved} 条演示数据，系统本身未受影响。`,
      });
    } catch (e: unknown) {
      sendSafeError(res, e);
    }
  });
}

/** 供 /api/admin/seed-demo 复用（保持向后兼容，见 routes/admin.ts）。 */
export const DEMO_COMPAT = { DEMO_IDS, DEMO_TAG };
