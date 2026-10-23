/**
 * @vitest-environment node
 *
 * 待审批指令的生命周期与失效容错（Issue #195）。
 *
 * ## 背景
 *
 * 内核高危操作拦截器拦到无人工授权的指令后，把记录暂存进 `pending_commands` 等管理员审批。
 * 旧版审批端点有一个死循环缺陷：
 *
 * - 插件卸载后，它注册的命令描述符与 handler 都没了；
 * - 管理员点「批准」→ 派发被 default-deny 拒绝（403 `COMMAND_NOT_REGISTERED`）；
 * - **失败分支不删记录** → 这条指令从「待审批」变成「永远批不掉的死项」，
 *   列表里既批不动也删不掉，只能手工改库。
 *
 * 现在端点区分两类失败：
 * 1. **确定性失效**（命令/描述符已不存在）→ 清除记录并返回 410 + `cleared: true`；
 * 2. 其它执行错误（业务失败、临时故障）→ 保留记录，交由调用方重试或排查，
 *    绝不因为一次偶发失败就把审批单吞掉。
 *
 * 本文件把这两条以及「reject 仍然可用」固化成断言。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerProcessesRoutes } from '../routes/processes.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('待审批指令的失效清理', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const adminToken = 'tok-approval-admin';
  const adminId = 'usr-approval-admin';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}`, 'Content-Type': 'application/json' });

  const insertPending = (id: string, commandType: string) => {
    db.prepare(
      'INSERT INTO pending_commands (id, command_type, payload, actor_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, commandType, '{}', 'plugin:ghost-plugin', Date.now());
  };

  const pendingExists = (id: string) =>
    Boolean(db.prepare('SELECT 1 FROM pending_commands WHERE id = ?').get(id));

  beforeAll(async () => {
    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      adminToken,
      // Issue #226：管理员身份在 session.subRole 里（role 恒为 'teacher'，
      // 见 server/routes/roster.ts 的 staff 登录分支），不再是 username==='admin' 兜底。
      JSON.stringify({ userId: adminId, role: 'teacher', subRole: 'administrator', username: 'admin', name: '管理员' }),
      now,
      now + 3600_000,
    );

    const app = express();
    app.use(express.json());
    registerProcessesRoutes({ app } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    db.prepare('DELETE FROM pending_commands WHERE id LIKE ?').run('pc-stale-%');
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(adminToken);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('批准一条「指令已不存在」的审批单：清除记录并返回 410（而不是留下死项）', async () => {
    const id = `pc-stale-${Date.now()}`;
    // 这个命令类型从未注册过描述符 → Kernel 派发前 default-deny，报 COMMAND_NOT_REGISTERED。
    insertPending(id, 'ghost.command.never.registered');

    const res = await fetch(`${baseUrl}/api/approvals/${id}/approve`, { method: 'POST', headers: cookie(adminToken) });
    const body = (await res.json()) as { code?: string; cleared?: boolean };

    expect(res.status).toBe(410);
    expect(body.code).toBe('APPROVAL_STALE_CLEARED');
    expect(body.cleared).toBe(true);
    // 核心断言：死项必须被清掉，否则列表里永远挂着一条批不掉的记录。
    expect(pendingExists(id)).toBe(false);
  });

  it('非确定性失败（执行抛普通错误）不得吞掉审批单 —— 记录必须保留', async () => {
    const id = `pc-stale-boom-${Date.now()}`;
    insertPending(id, 'ghost.command.transient.failure');

    // 用 spy 模拟「命令存在、但这一次执行失败」：不是快照失效，重试才有意义。
    const bus = kernelContainer.commandBus as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = bus.execute;
    const spy = vi.spyOn(bus, 'execute').mockRejectedValueOnce(new Error('transient upstream failure'));

    try {
      const res = await fetch(`${baseUrl}/api/approvals/${id}/approve`, {
        method: 'POST',
        headers: cookie(adminToken),
      });
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(pendingExists(id)).toBe(true);
    } finally {
      spy.mockRestore();
      if (bus.execute !== original) bus.execute = original;
    }
  });

  it('reject 仍然删除记录（清除失效审批的既有路径不能被破坏）', async () => {
    const id = `pc-stale-reject-${Date.now()}`;
    insertPending(id, 'ghost.command.never.registered');

    const res = await fetch(`${baseUrl}/api/approvals/${id}/reject`, { method: 'POST', headers: cookie(adminToken) });

    expect(res.status).toBe(200);
    expect(pendingExists(id)).toBe(false);
  });

  it('批准不存在的审批单返回 404（不误删、不误报清除）', async () => {
    const res = await fetch(`${baseUrl}/api/approvals/pc-stale-does-not-exist/approve`, {
      method: 'POST',
      headers: cookie(adminToken),
    });
    expect(res.status).toBe(404);
  });
});
