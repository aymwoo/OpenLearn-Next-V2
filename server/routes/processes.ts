import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getActorId, requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';

export function registerProcessesRoutes(ctx: ServerContext) {
  const { app } = ctx;

  app.get('/api/approvals', requireAuth('administrator'), (req, res) => {
    try {
      const list = kernelContainer.db.prepare('SELECT * FROM pending_commands ORDER BY created_at DESC').all();
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/approvals/:id/approve', requireAuth('administrator'), async (req, res) => {
    try {
      const pending: any = kernelContainer.db.prepare('SELECT * FROM pending_commands WHERE id = ?').get(req.params.id);
      if (!pending) return res.status(404).json({ error: 'Not found' });

      // SEC-FIX: 严禁允许外部客户端通过 payloadOverride 篡改审批单原始指令参数
      const payload = JSON.parse(pending.payload);
      const approverId = getActorId(req) || 'admin';

      const cmd = kernelContainer.commandBus.createCommand(
        pending.command_type,
        payload,
        approverId,
        { approved: true }
      );

      const result = await kernelContainer.commandBus.execute(cmd);
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
      const list = kernelContainer.db.prepare("SELECT id, name, status, created_at, updated_at FROM processes WHERE status = 'running' ORDER BY created_at DESC").all();
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
