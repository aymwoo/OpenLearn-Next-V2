import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getActorId, requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';

/**
 * 审批单是否已**确定性失效**（再试多少次都不会成功）—— Issue #195。
 *
 * 典型场景：插件发的高危指令被拦下、进了 `pending_commands`，随后插件被卸载。
 * 它注册的命令描述符（`actionRegistry`）与 handler 都没了，因此：
 * - `Kernel` 会在派发前以 403 `COMMAND_NOT_REGISTERED` 拒绝（default-deny）；
 * - 若描述符还在但 handler 没了，`CommandBus` 抛 `No handler registered for command: …`。
 *
 * 这两种都是“快照已失效”而非“服务端故障”——重试无意义，必须把记录清掉，
 * 否则它会成为列表里既批不掉也删不掉的死项（旧版端点失败时不删记录）。
 */
function isStaleApprovalError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'COMMAND_NOT_REGISTERED' || code === 'COMMAND_HANDLER_NOT_REGISTERED') return true;
  const message = String((err as { message?: unknown } | null)?.message ?? '');
  if (/No handler registered for command/i.test(message)) return true;
  return /has no registered action descriptor/i.test(message);
}

export function registerProcessesRoutes(ctx: ServerContext) {
  const { app } = ctx;

  app.get('/api/approvals', requireAuth('administrator'), (req, res) => {
    try {
      const list = kernelContainer.db.prepare('SELECT * FROM pending_commands ORDER BY created_at DESC').all();
      res.json(list);
    } catch (e: any) {
      sendSafeError(res, e, 500);
    }
  });

  app.post('/api/approvals/:id/approve', requireAuth('administrator'), async (req, res) => {
    try {
      const pending: any = kernelContainer.db.prepare('SELECT * FROM pending_commands WHERE id = ?').get(req.params.id);
      if (!pending) return res.status(404).json({ error: 'Not found' });

      // SEC-FIX: 严禁允许外部客户端通过 payloadOverride 篡改审批单原始指令参数
      const payload = JSON.parse(pending.payload);
      const approverId = getActorId(req) || 'admin';

      const cmd = kernelContainer.commandBus.createCommand(pending.command_type, payload, approverId, {
        approved: true,
      });

      let result: unknown;
      try {
        result = await kernelContainer.commandBus.execute(cmd);
      } catch (execErr) {
        // 确定性失效（插件已卸载 / 命令已注销）：这条审批单永远批不掉。
        // 清掉它并向调用方说明“已清除”，避免前端只能看到一个无法消除的行（Issue #195）。
        if (isStaleApprovalError(execErr)) {
          kernelContainer.db.prepare('DELETE FROM pending_commands WHERE id = ?').run(pending.id);
          return res.status(410).json({
            success: false,
            code: 'APPROVAL_STALE_CLEARED',
            cleared: true,
            error:
              `指令 "${pending.command_type}" 已失效（对应的插件或命令已不存在），` +
              '该待审批记录已被自动清除。',
          });
        }
        throw execErr;
      }
      kernelContainer.db.prepare('DELETE FROM pending_commands WHERE id = ?').run(pending.id);

      res.json({ success: true, result });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/approvals/:id/reject', requireAuth('administrator'), async (req, res) => {
    try {
      kernelContainer.db.prepare('DELETE FROM pending_commands WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // Processes APIs
  app.get('/api/processes', requireAuth('administrator'), (req, res) => {
    try {
      // Only return currently active running processes to ensure real-time accuracy
      const list = kernelContainer.db
        .prepare(
          "SELECT id, name, status, created_at, updated_at FROM processes WHERE status = 'running' ORDER BY created_at DESC",
        )
        .all();
      res.json(list);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/processes/:id/logs', requireAuth('administrator'), (req, res) => {
    try {
      const dbRow = kernelContainer.db.prepare('SELECT logs FROM processes WHERE id = ?').get(req.params.id) as any;
      res.json(dbRow || { logs: '' });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // Seed example demo data for the Help Tour wizard.
  // Idempotent: uses stable demo IDs and reuses existing rows, so repeated
  // clicks (or a DB that already holds demo data) never throw UNIQUE errors.
}
