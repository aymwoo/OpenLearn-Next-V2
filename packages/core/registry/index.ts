export interface ActionDescriptor {
  readonly id: string;
  readonly commandType: string;
  readonly description: string;
  readonly inputSchema: any; // JSON Schema directly matching GenAI tool parameters
  readonly capabilityRequired: string;
  readonly isHighRisk?: boolean;
  /**
   * 是否暴露为 AI Agent 的工具。默认 `true`（历史行为）。
   *
   * 设`false` 表示该命令仅程序化可达（HTTP 路由 / commandBus / 插件 ctx.invokeCommand），
   * 但**不出现在 `getAgentTools()` 返回的 functionDeclarations 中**。
   *
   * 与 `isHighRisk` 正交，不可互相替代：
   * - `isHighRisk` 只决定是否需要人工审批，**不影响是否出现在 AI 工具箱**；
   * - `exposeToAgent` 只决定是否出现在 AI 工具箱，**不影响鉴权与审批**。
   *
   * 典型用例：`courseware.save_score_config` 会改写成绩计算规则（满分/权重/多次尝试取哪次），
   * 这类命令不应交给 agent 自主决策。
   */
  readonly exposeToAgent?: boolean;
}

export class ActionRegistry {
  private actions = new Map<string, ActionDescriptor>();

  public register(descriptor: ActionDescriptor): void {
    if (this.actions.has(descriptor.id)) {
      throw new Error(`Action ${descriptor.id} is already registered.`);
    }
    this.actions.set(descriptor.id, descriptor);
  }

  public unregister(id: string): void {
    this.actions.delete(id);
  }

  public getAllActions(): ActionDescriptor[] {
    return Array.from(this.actions.values());
  }

  // Returns tools formatted for @google/genai
  public getAgentTools(): any[] {
    const functionDeclarations = Array.from(this.actions.values())
      // `exposeToAgent === false` 的 action 仅程序化可达，不进入 agent 工具箱
      .filter((a) => a.exposeToAgent !== false)
      .map((action) => {
        // Safely replace non-word chars with underscore for function names
        const SafeName = action.commandType.replace(/[^a-zA-Z0-9_\-]/g, '_');

        return {
          name: SafeName,
          description: action.description,
          parameters: action.inputSchema,
        };
      });

    if (functionDeclarations.length === 0) return [];

    return [
      {
        functionDeclarations,
      },
    ];
  }

  public getActionByToolName(toolName: string): ActionDescriptor | undefined {
    return Array.from(this.actions.values()).find((a) => a.commandType.replace(/[^a-zA-Z0-9_\-]/g, '_') === toolName);
  }

  public getActionByCommandType(commandType: string): ActionDescriptor | undefined {
    return Array.from(this.actions.values()).find((a) => a.commandType === commandType);
  }
}
