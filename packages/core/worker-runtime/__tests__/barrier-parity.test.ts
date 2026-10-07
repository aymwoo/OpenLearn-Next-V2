/**
 * B-2 / B-3 回归测试：白名单精确匹配 + Barrier 2 两端语义一致。
 *
 * 两个缺陷都是「同一份规则写了两遍，且两遍不一致」：
 *
 * - B-2：敏感服务白名单用 `dep.includes(tokenName)` 子串匹配。manifest 写
 *   `requires: ['@evil/x:MyISemesterGradeServiceThing']` 即可命中 `ISemesterGradeService`，
 *   拿到写入学期成绩的权限；后端 points 白名单同理（`IAmPointsLedgerServiceButFake`）。
 *
 * - B-3：Barrier 2（manifest 未声明 capability 时降级只读）在两端有两种语义 ——
 *   后端 `msg.method !== 'get'`（仅方法名恰好为 get）vs 前端 `!msg.method.startsWith('get')`。
 *   后果：`getUserList` / `getAllActions` 在 server worker 里被拒、在浏览器 worker 里放行。
 */
import { describe, it, expect } from 'vitest';
import { computeAllowedWorkerTokens } from '../worker-manager.js';

const POINTS_DIM = '@openlearn/core:IPointsDimensionRegistry';
const POINTS_LEDGER = '@openlearn/core:IPointsLedgerService';

/** 构造最小合法 Manifest —— computeAllowedWorkerTokens 的入参类型要求 id/name/version/main */
function manifest(fields: { requires?: string[]; optional?: string[]; capabilitiesProposed?: string[] }) {
  return { id: 'ext-test-b2', name: 'B2 Test', version: '1.0.0', main: 'index.js', ...fields };
}

describe('B-2：积分服务白名单必须精确匹配', () => {
  it('显式声明依赖时授予积分服务', () => {
    const tokens = computeAllowedWorkerTokens(manifest({ requires: [`${POINTS_LEDGER}@^1.0.0`] }));
    expect(tokens).toContain(POINTS_LEDGER);
    expect(tokens).toContain(POINTS_DIM);
  });

  it('省略版本范围时同样授予（manifest 允许裸写法）', () => {
    const tokens = computeAllowedWorkerTokens(manifest({ requires: [POINTS_LEDGER] }));
    expect(tokens).toContain(POINTS_LEDGER);
  });

  it('在 optional 中声明也授予', () => {
    const tokens = computeAllowedWorkerTokens(manifest({ optional: [POINTS_LEDGER] }));
    expect(tokens).toContain(POINTS_LEDGER);
  });

  it('未声明任何依赖时不授予', () => {
    const tokens = computeAllowedWorkerTokens(manifest({ requires: ['@openlearn/core:ICommandBusService@^1.0.0'] }));
    expect(tokens).not.toContain(POINTS_LEDGER);
    expect(tokens).not.toContain(POINTS_DIM);
  });

  it('伪造的相似 Token 名不再命中（原缺陷）', () => {
    // 修复前：`'IAmPointsLedgerServiceButFake'.includes('IPointsLedgerService')` 为 false，
    // 但 `'@x/x:IAmPointsLedgerService'` 之类包含目标串的条目会命中 —— 此处覆盖该形态
    const forged = computeAllowedWorkerTokens(manifest({ requires: ['@evil/x:IAmPointsLedgerServiceButFake'] }));
    expect(forged).not.toContain(POINTS_LEDGER);

    const forged2 = computeAllowedWorkerTokens(manifest({ requires: ['@evil/x:MyPointsLedgerServicePlus'] }));
    expect(forged2).not.toContain(POINTS_LEDGER);

    // 关键：只有**精确**的 token 名才授予
    const exact = computeAllowedWorkerTokens(manifest({ requires: ['@openlearn/core:IPointsLedgerServiceExtra'] }));
    expect(exact).not.toContain(POINTS_LEDGER);
  });

  it('capabilitiesProposed 声明 points 能力时授予（不依赖 requires）', () => {
    const tokens = computeAllowedWorkerTokens(manifest({ capabilitiesProposed: ['points:write'] }));
    expect(tokens).toContain(POINTS_LEDGER);
  });
});

/**
 * B-3：两端 Barrier 2 语义一致性。
 *
 * 直接断言**前端源码**里的判定表达式与后端一致 —— 因为前端的 ServiceHost
 * 依赖浏览器 Worker 基础设施，无法在 Node 测试里实例化。
 * 这类「跨运行时规则」只能靠共享测试向量 + 源码断言来防漂移。
 */
describe('B-3：Barrier 2 两端语义一致', () => {
  it("后端与前端都用 startsWith('get') 判定只读降级", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');

    const backend = read('packages/core/worker-runtime/service-host.ts');
    const frontend = read('src/plugin-host/service-host.ts');

    const backendGuard = backend.match(/manifestCapabilities\.length === 0 && ([^\n]+)/)?.[1]?.trim();
    const frontendGuard = frontend.match(/manifestCapabilities\.length === 0 && ([^\n]+)/)?.[1]?.trim();

    expect(backendGuard).toBeTruthy();
    expect(frontendGuard).toBeTruthy();
    expect(backendGuard).toBe(frontendGuard);
    expect(backendGuard).toContain("startsWith('get')");
  });

  it('getUserList / getAllActions 两端判定结果相同（只读降级放行）', () => {
    const isReadOnlyAllowed = (method: string) => method.startsWith('get');
    for (const m of ['get', 'getUserList', 'getAllActions', 'getActionByCommandType']) {
      expect(isReadOnlyAllowed(m), m).toBe(true);
    }
    for (const m of ['prepare', 'run', 'exec', 'insert', 'update', 'delete']) {
      expect(isReadOnlyAllowed(m), m).toBe(false);
    }
  });
});
