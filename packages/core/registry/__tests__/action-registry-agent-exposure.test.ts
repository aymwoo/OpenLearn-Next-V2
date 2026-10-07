/**
 * G-1 / D-5 回归测试：
 *  1. `exposeToAgent === false` 的 action 不进入 `getAgentTools()`；
 *  2. 未显式设置 `exposeToAgent` 的 action 保持历史行为（进入工具箱）—— 保证 additive 兼容；
 *  3. `exposeToAgent` 不影响鉴权/审批路径（即不改变 `getAllActions` / `getActionByToolName`）。
 *
 * 背景：`getAgentTools()` 此前**不过滤**全部 action，因此「补 action descriptor」等价于
 * 「把该命令加进 AI 工具箱」。这是 D-5 决策引入 `exposeToAgent` 的直接原因。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRegistry } from '../index.js';

function descriptor(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    commandType: id,
    description: `desc ${id}`,
    inputSchema: { type: 'OBJECT', properties: {}, required: [] },
    capabilityRequired: 'lesson:read',
    ...extra,
  };
}

describe('ActionRegistry — exposeToAgent（D-5）', () => {
  let registry: ActionRegistry;

  beforeEach(() => {
    registry = new ActionRegistry();
  });

  /** 从 getAgentTools() 结果里抽出全部 functionDeclarations 的 name */
  function agentToolNames(): string[] {
    const tools = registry.getAgentTools();
    if (tools.length === 0) return [];
    const [first] = tools as Array<{ functionDeclarations?: Array<{ name: string }> }>;
    return (first?.functionDeclarations ?? []).map((d) => d.name);
  }

  it('exposeToAgent: false 的 action 不出现在 AI 工具箱', () => {
    registry.register(descriptor('a_visible'));
    registry.register(descriptor('b_hidden', { exposeToAgent: false }));

    const names = agentToolNames();
    expect(names).toContain('a_visible');
    expect(names).not.toContain('b_hidden');
  });

  it('未设置 exposeToAgent 的 action 保持历史行为（默认进入工具箱）', () => {
    registry.register(descriptor('legacy_style'));
    expect(agentToolNames()).toContain('legacy_style');
  });

  it('exposeToAgent: true 显式进入工具箱', () => {
    registry.register(descriptor('explicit_true', { exposeToAgent: true }));
    expect(agentToolNames()).toContain('explicit_true');
  });

  it('exposeToAgent: false 只影响工具箱，不影响 getAllActions（程序化仍可达）', () => {
    registry.register(descriptor('b_hidden', { exposeToAgent: false }));

    // 程序化可达性不受影响 —— 这是「仅 AI 不可见」的语义保证
    expect(registry.getAllActions().map((a) => a.id)).toContain('b_hidden');
    expect(registry.getActionByCommandType('b_hidden')).toBeDefined();
    expect(registry.getActionByToolName('b_hidden')).toBeDefined();
  });

  it('全部 action 都隐藏时，getAgentTools() 返回空数组而非空壳', () => {
    registry.register(descriptor('hidden_1', { exposeToAgent: false }));
    registry.register(descriptor('hidden_2', { exposeToAgent: false }));
    expect(agentToolNames()).toEqual([]);
    expect(registry.getAgentTools()).toEqual([]);
  });

  it('isHighRisk 不影响工具箱暴露（两者正交，防止误以为 isHighRisk 能挡 AI）', () => {
    registry.register(descriptor('high_risk_visible', { isHighRisk: true }));
    expect(agentToolNames()).toContain('high_risk_visible');
  });
});