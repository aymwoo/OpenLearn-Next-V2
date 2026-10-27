/**
 * `resolveFrontendExecutionMode` —— 前端选取执行档的唯一入口。
 *
 * 这里是踩过的坑：`GET /api/plugins` 同时返回两个长得像的字段
 * （`packages/core/plugin-host/core.ts` 的 `listPlugins()`）：
 *
 * - `execution_mode`：历史字段，实际值是**加载器代际** `esm` / `legacy`；
 * - `isolation_mode`：服务端求值后的**实际沙箱档** `inline` / `worker` / `process`。
 *
 * 读错字段不会报错 —— 只会让受信 inline 插件永远落回沙箱（全都变成 `process`）。
 * 这几例把字段优先级与回退方向一起钉住。
 */
import { describe, it, expect } from 'vitest';
import { resolveFrontendExecutionMode } from '../useClassroomSlice';

describe('resolveFrontendExecutionMode', () => {
  it('以 isolation_mode 为准（不受 execution_mode 的 esm/legacy 干扰）', () => {
    expect(resolveFrontendExecutionMode({ isolation_mode: 'inline', execution_mode: 'esm' })).toBe('inline');
    expect(resolveFrontendExecutionMode({ isolation_mode: 'worker', execution_mode: 'esm' })).toBe('worker');
    expect(resolveFrontendExecutionMode({ isolation_mode: 'process', execution_mode: 'esm' })).toBe('process');
  });

  it('只有 isolation_mode 时直接采用', () => {
    expect(resolveFrontendExecutionMode({ isolation_mode: 'inline' })).toBe('inline');
  });

  it('isolation_mode 缺失（旧服务端）时回退 execution_mode，但仍只接受已知档位', () => {
    expect(resolveFrontendExecutionMode({ execution_mode: 'inline' })).toBe('inline');
    // `esm` 是加载器代际而非沙箱档 —— 必须收窄成沙箱，不能当作 inline 放行
    expect(resolveFrontendExecutionMode({ execution_mode: 'esm' })).toBe('process');
    // `legacy` 存量 store 取值仍透传（只为渲染黄色徽章）；vm 时代没有 frontend
    // bundle，永远走不到 activateRemotePlugin，不会因此进父页面。
    expect(resolveFrontendExecutionMode({ execution_mode: 'legacy' })).toBe('legacy');
  });

  it('都缺失或无法识别时回退 process（宁可多套一层沙箱）', () => {
    expect(resolveFrontendExecutionMode({})).toBe('process');
    expect(resolveFrontendExecutionMode({ isolation_mode: 'worker-thread' })).toBe('process');
  });
});
