// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ServiceHost } from '../service-host';
import { FrontendServiceRegistry } from '../service-registry';
import { computeAllowedWorkerTokens, BASE_FRONTEND_WORKER_SERVICE_TOKENS } from '../allowed-tokens';
import { SEMESTER_GRADE_SERVICE_TOKEN, FRONTEND_API_TOKEN } from '../types';
import type { IWorkerTransport } from '../../../packages/core/worker-runtime/types';

// ── Mock Transport ───────────────────────────────────────────────────────

function createMockTransport(): IWorkerTransport {
  return {
    id: 'test-transport',
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

/** 后端同款敏感服务 Token —— 前端容器中若存在也必须被白名单拒绝 */
const POINTS_LEDGER_TOKEN = '@openlearn/core:IPointsLedgerService';

// ── Tests ────────────────────────────────────────────────────────────────

describe('ServiceHost Token 白名单门禁 (Security Barrier 1)', () => {
  const TEST_ACTOR = 'plugin:test-plugin';
  // 插件已声明 capability —— 旧实现下可访问容器内任意服务
  const TEST_CAPS = ['test:read', 'test:write'];

  async function createHost(allowedTokens?: Iterable<string>) {
    const registry = new FrontendServiceRegistry();
    const transport = createMockTransport();

    const pointsService = {
      addPoints: vi.fn().mockResolvedValue({ ok: true }),
      getPoints: vi.fn().mockResolvedValue(999),
    };
    const frontendApi = { getData: vi.fn().mockResolvedValue({ items: [1, 2] }) };
    const gradeService = { saveSemesterGrade: vi.fn().mockResolvedValue(undefined) };

    // 敏感服务确实存在于容器中 —— 门禁必须先于 resolve 生效
    await registry.register(POINTS_LEDGER_TOKEN, pointsService);
    await registry.register(FRONTEND_API_TOKEN, frontendApi);
    await registry.register(SEMESTER_GRADE_SERVICE_TOKEN, gradeService);

    const host = new ServiceHost(registry, TEST_ACTOR, TEST_CAPS, undefined, allowedTokens);
    return { host, transport, pointsService, frontendApi, gradeService };
  }

  it('拒绝不在白名单内的 Token（@openlearn/core:IPointsLedgerService）', async () => {
    const { host, transport, pointsService } = await createHost([FRONTEND_API_TOKEN]);

    await host.handleInvoke(
      { type: 'invoke', invokeId: 'inv-1', token: POINTS_LEDGER_TOKEN, method: 'addPoints', args: [10] },
      transport,
    );

    const msg = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('WorkerCapabilityError');
    expect(msg.message).toContain(POINTS_LEDGER_TOKEN);
    expect(msg.message).toContain('not in worker allowedTokens');
    // 关键：门禁在 resolve/执行之前拦截，服务方法绝不能被调用
    expect(pointsService.addPoints).not.toHaveBeenCalled();
  });

  it('白名单内的 Token 正常解析并执行', async () => {
    const { host, transport, frontendApi } = await createHost([FRONTEND_API_TOKEN]);

    await host.handleInvoke(
      { type: 'invoke', invokeId: 'inv-2', token: FRONTEND_API_TOKEN, method: 'getData', args: [] },
      transport,
    );

    const msg = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.type).toBe('result');
    expect(msg.value).toEqual({ items: [1, 2] });
    expect(frontendApi.getData).toHaveBeenCalled();
  });

  it('白名单为 undefined 时保持向后兼容行为（不加白名单限制）', async () => {
    const { host, transport, pointsService } = await createHost(undefined);

    await host.handleInvoke(
      { type: 'invoke', invokeId: 'inv-3', token: POINTS_LEDGER_TOKEN, method: 'addPoints', args: [10] },
      transport,
    );

    const msg = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.type).toBe('result');
    expect(pointsService.addPoints).toHaveBeenCalledWith(10);
  });

  it('白名单拒绝优先于 manifest 能力检查（即使方法名以 get 开头）', async () => {
    const { host, transport, pointsService } = await createHost([FRONTEND_API_TOKEN]);

    await host.handleInvoke(
      { type: 'invoke', invokeId: 'inv-4', token: POINTS_LEDGER_TOKEN, method: 'getPoints', args: [] },
      transport,
    );

    const msg = (transport.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(msg.type).toBe('error');
    expect(pointsService.getPoints).not.toHaveBeenCalled();
  });
});

describe('computeAllowedWorkerTokens (前端等价实现)', () => {
  it('默认只授予基础服务，不含敏感领域服务', () => {
    const allowed = computeAllowedWorkerTokens();
    expect(allowed).toEqual([...BASE_FRONTEND_WORKER_SERVICE_TOKENS]);
    expect(allowed).not.toContain(SEMESTER_GRADE_SERVICE_TOKEN);
  });

  it('manifest 未声明 grades 权限时不授予写成绩服务', () => {
    const allowed = computeAllowedWorkerTokens({ capabilitiesProposed: ['whiteboard:write'] });
    expect(allowed).not.toContain(SEMESTER_GRADE_SERVICE_TOKEN);
  });

  it('manifest 在 requires 中显式依赖时授予写成绩服务', () => {
    const allowed = computeAllowedWorkerTokens({ requires: ['@openlearn/frontend:ISemesterGradeService'] });
    expect(allowed).toContain(SEMESTER_GRADE_SERVICE_TOKEN);
  });

  it('manifest 声明 grades capability（含 grades:* 与 *）时授予写成绩服务', () => {
    expect(computeAllowedWorkerTokens({ capabilitiesProposed: ['grades'] })).toContain(SEMESTER_GRADE_SERVICE_TOKEN);
    expect(computeAllowedWorkerTokens({ capabilitiesProposed: ['grades:write'] })).toContain(
      SEMESTER_GRADE_SERVICE_TOKEN,
    );
    expect(computeAllowedWorkerTokens({ capabilitiesProposed: ['*'] })).toContain(SEMESTER_GRADE_SERVICE_TOKEN);
  });

  it('requestedTokens 与授权集取交集（请求方无法越权放大）', () => {
    const allowed = computeAllowedWorkerTokens(
      { capabilitiesProposed: ['grades'] },
      [FRONTEND_API_TOKEN, POINTS_LEDGER_TOKEN],
    );
    expect(allowed).toEqual([FRONTEND_API_TOKEN]);
  });
});
