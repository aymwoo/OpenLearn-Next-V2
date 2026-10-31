/**
 * U-11 回归测试：`resource.*` 4 条命令必须**同时**具备 commandBus handler 与
 * actionRegistry descriptor。
 *
 * 背景：`server/routes/resources.ts` 早期只注册了 handler（`RESOURCE_HANDLERS` 循环），
 * 没有任何 `actionRegistry.register()`。kernel 的 commandBus interceptor 是
 * **default-deny**（`packages/core/kernel/index.ts` L372-400）：descriptor 缺失
 * ⇒ 派发前直接 403 `COMMAND_NOT_REGISTERED`。于是这 4 条命令对插件与 AI 是
 * 「注册了但永久不可用」—— 功能不缺（REST 路由独立工作），命令面全死。
 *
 * 本测试锁死三件事，任何一件回退都会红：
 *   1. 4 条 descriptor 存在，且 capability / isHighRisk / inputSchema 与 handler 的参数契约一致；
 *   2. 教师 actor 派发不再被 403（default-deny 分支不再命中）；
 *   3. 能力与审批两条闸门在该命名空间上仍然有效（学生拒绝、删除需人工审批）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { registerResourcesRoutes } from '../routes/resources.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';

const db = kernelContainer.db as any;
const TEACHER = 'user:res-cmd-teacher:teacher';
const STUDENT = 'user:res-cmd-student:student';
const ADMIN = 'role:administrator';

const createdIds: string[] = [];

const dispatch = (type: string, payload: unknown, actorId: string, metadata?: Record<string, unknown>) =>
  kernelContainer.commandBus.execute(kernelContainer.commandBus.createCommand(type, payload, actorId, metadata));

async function captureError(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected command to reject, but it resolved');
}

describe('resource.* 命令描述符（U-11）', () => {
  beforeAll(() => {
    ensureTestSchema();
    const app = express();
    app.use(express.json());
    registerResourcesRoutes({ app } as any);
  });

  afterAll(() => {
    for (const id of createdIds) {
      db.prepare('DELETE FROM system_resources WHERE id = ?').run(id);
    }
  });

  it('4 条命令都有对应的 ActionDescriptor，且能力标注为 management:*', () => {
    const expected: Array<{ commandType: string; capability: string; highRisk: boolean }> = [
      { commandType: 'resource.list', capability: 'management:read', highRisk: false },
      { commandType: 'resource.get', capability: 'management:read', highRisk: false },
      { commandType: 'resource.create', capability: 'management:write', highRisk: false },
      { commandType: 'resource.delete', capability: 'management:write', highRisk: true },
    ];

    for (const e of expected) {
      const action = kernelContainer.actionRegistry.getActionByCommandType(e.commandType);
      expect(action, `missing ActionDescriptor for ${e.commandType}`).toBeTruthy();
      expect(action!.capabilityRequired).toBe(e.capability);
      expect(action!.isHighRisk === true).toBe(e.highRisk);
      // handler 与 descriptor 必须成对：缺 handler 的命令会暴露成 AI 工具但派发必失败
      expect(kernelContainer.commandBus.hasHandler(e.commandType)).toBe(true);
    }
  });

  it('教师派发 resource.list 不再命中 default-deny（payload 必须是对象）', async () => {
    const result = await dispatch('resource.list', {}, TEACHER);
    expect(Array.isArray(result.resources)).toBe(true);
  });

  it('payload 省略（undefined）会被 inputSchema 拒绝 —— 无参命令也要传 {}', async () => {
    const err = await captureError(() => dispatch('resource.list', undefined, TEACHER));
    expect(String(err.message)).toMatch(/PayloadValidationError/);
  });

  it('create → get 往返，content 原样落库', async () => {
    const html = '<html><head></head><body>u11</body></html>';
    const created = await dispatch('resource.create', { name: 'u11-demo.html', type: 'html', content: html }, TEACHER);
    expect(created.success).toBe(true);
    createdIds.push(created.id);

    const got = await dispatch('resource.get', { id: created.id }, TEACHER);
    expect(got.resource.name).toBe('u11-demo.html');
    expect(got.resource.content).toBe(html);
  });

  it('不存在的资源返回 { error: not_found } 而不是抛错', async () => {
    const got = await dispatch('resource.get', { id: 'res_does_not_exist' }, TEACHER);
    expect(got).toEqual({ error: 'not_found' });
  });

  it('学生 actor 被能力闸门拒绝（403 COMMAND_CAPABILITY_DENIED）', async () => {
    const err = await captureError(() => dispatch('resource.list', {}, STUDENT));
    expect(err.status).toBe(403);
    expect(err.code).toBe('COMMAND_CAPABILITY_DENIED');
  });

  it('resource.delete 是高危命令：非管理员触发人工审批而不是直接执行', async () => {
    const created = await dispatch(
      'resource.create',
      { name: 'u11-delete.html', type: 'html', content: '<html></html>' },
      TEACHER,
    );
    createdIds.push(created.id);

    const before = db.prepare('SELECT COUNT(*) AS n FROM pending_commands').get().n;
    const err = await captureError(() => dispatch('resource.delete', { id: created.id }, TEACHER));
    expect(String(err.message)).toMatch(/requires human approval/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pending_commands').get().n).toBe(before + 1);

    // 审批单在，资源还在 —— 高危命令不会偷偷生效
    expect(db.prepare('SELECT id FROM system_resources WHERE id = ?').get(created.id)).toBeTruthy();

    // 管理员携带 approved 元数据可以执行（审批后重放走的就是这条路径）
    const result = await dispatch('resource.delete', { id: created.id }, ADMIN, { approved: true });
    expect(result.success).toBe(true);
    expect(db.prepare('SELECT id FROM system_resources WHERE id = ?').get(created.id)).toBeUndefined();

    // 清掉本次产生的审批单，避免污染其它用例
    db.prepare("DELETE FROM pending_commands WHERE command_type = 'resource.delete'").run();
  });
});
