/**
 * 题型注册表的**内核侧单例**（Issue #100 / #120）。
 *
 * 放在 `packages/core/assessment` 而不是 `server/` 的原因：
 * - 仓库的 canary 测试会枚举 `PLUGIN_RESOLVABLE_TOKENS` 里的每个 token，
 *   断言「内核启动后都能解析」。因此可被插件解析的服务必须由**内核**注册，
 *   否则每个自建 kernel 的环境（测试、canary、worker）都会缺provider。
 * - 它本身也不依赖 express / better-sqlite3，只有 Map 与纯判分函数。
 *
 * 服务端（route/service）直接用 `assessmentGraderRegistry`；
 * 插件通过 `ctx.resolve(IAssessmentGraderRegistryToken)` 拿到同一个对象。
 */
import type { IAssessmentGraderRegistry } from '../di/interfaces.js';
import { createQuestionTypeRegistry, type QuestionTypeRegistry } from './question-types/registry.js';
import type { QuestionTypeDefinition } from './question-types/types.js';
import { gradeItem as gradeItemWith } from './grading.js';
import type { GradeContext } from './question-types/types.js';
import type { AssessmentItemRecord, ItemGradeResult } from './types.js';

export class AssessmentGraderRegistry implements IAssessmentGraderRegistry {
  private readonly registry: QuestionTypeRegistry;

  constructor(registry: QuestionTypeRegistry = createQuestionTypeRegistry()) {
    this.registry = registry;
  }

  registerQuestionType(definition: QuestionTypeDefinition<any, any>, options: { pluginId?: string } = {}): void {
    this.registry.register(definition, options);
  }

  unregisterQuestionType(type: string, pluginId?: string): boolean {
    return this.registry.unregister(type, pluginId);
  }

  clearOwnedQuestionTypes(pluginId: string): number {
    return this.registry.clearOwned(pluginId);
  }

  getQuestionType(type: string): QuestionTypeDefinition<any, any> | undefined {
    return this.registry.get(type);
  }

  listQuestionTypes() {
    return this.registry.list().map(({ definition, pluginId }) => ({
      type: definition.type,
      label: definition.label,
      category: definition.category,
      supports: [...definition.supports],
      autoGradable: definition.autoGradable,
      pluginId,
    }));
  }

  gradeItem(item: AssessmentItemRecord, answer: unknown, ctx: Omit<GradeContext, 'maxScore'>): ItemGradeResult {
    return gradeItemWith(this.registry, item, answer, ctx);
  }

  /** 宿主内部（service / 单测）用的底层注册表：整卷判分需要它。 */
  get underlying(): QuestionTypeRegistry {
    return this.registry;
  }
}

/**
 * 进程内单例。
 *
 * 内核（`packages/core/kernel/index.ts`）与 `server/services/*` 必须共用同一个实例：
 * 否则插件经 `ctx.resolve` 注册的题型，判分时看不见（split-brain，与 stage-guard 同款坑）。
 */
export const assessmentGraderRegistry = new AssessmentGraderRegistry();
