/**
 * 题型注册表（Issue #100 / #120）。
 *
 * 与 `src/features/teacher/assignment-question-registry.ts` 同构（Map + pluginId 所有权），
 * 区别是粒度从「整份作业」下沉到「单题」，且**服务端也用同一份**——判分不能放前端。
 *
 * 内置题型走同一个 `register()`，不是"宿主特权"：插件题型除了 `pluginId` 之外与内置题型
 * 没有任何差别，避免出现二等公民。
 */
import { BUILTIN_QUESTION_TYPES } from './builtin.js';
import type { QuestionTypeDefinition, QuestionTypeRegistration } from './types.js';

/** 插件题型必须带 `<pluginId>:` 前缀，避免与内置题型或其他插件撞名。 */
export function isValidPluginQuestionType(type: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9_-]*$/i.test(type);
}

export class QuestionTypeRegistry {
  private readonly registrations = new Map<string, QuestionTypeRegistration>();

  /** 注册题型。重复 type 抛错（静默覆盖会让"插件题型被顶掉"变成幽灵 bug）。 */
  register(definition: QuestionTypeDefinition<any, any>, options: { pluginId?: string } = {}): void {
    if (!definition || typeof definition.type !== 'string' || !definition.type.trim()) {
      throw new Error('[QuestionTypeRegistry] definition.type is required');
    }
    if (typeof definition.grade !== 'function') {
      throw new Error(`[QuestionTypeRegistry] ${definition.type}: grade must be a function`);
    }
    const pluginId = options.pluginId?.trim() || undefined;
    if (pluginId && !isValidPluginQuestionType(definition.type)) {
      throw new Error(
        `[QuestionTypeRegistry] plugin question type "${definition.type}" must be namespaced as "<pluginId>:<name>"`,
      );
    }
    if (!pluginId && isValidPluginQuestionType(definition.type)) {
      throw new Error(
        `[QuestionTypeRegistry] builtin question type "${definition.type}" must not use a plugin namespace`,
      );
    }
    if (this.registrations.has(definition.type)) {
      throw new Error(`[QuestionTypeRegistry] duplicate question type: ${definition.type}`);
    }
    this.registrations.set(definition.type, { definition, pluginId });
  }

  /** 注销。带 `pluginId` 时必须与注册者一致，防止插件卸掉别人的题型。 */
  unregister(type: string, pluginId?: string): boolean {
    const current = this.registrations.get(type);
    if (!current) return false;
    if (pluginId !== undefined && current.pluginId !== pluginId) return false;
    return this.registrations.delete(type);
  }

  /** 插件卸载时按 pluginId 批量清理（与 `clearOwned` 同语义）。 */
  clearOwned(pluginId: string): number {
    let removed = 0;
    for (const [type, registration] of [...this.registrations]) {
      if (registration.pluginId === pluginId) {
        this.registrations.delete(type);
        removed++;
      }
    }
    return removed;
  }

  get(type: string): QuestionTypeDefinition<any, any> | undefined {
    return this.registrations.get(type)?.definition;
  }

  has(type: string): boolean {
    return this.registrations.has(type);
  }

  /** 列出全部题型定义（含归属信息），供前端出题页与 manifest 校验使用。 */
  list(): Array<{ definition: QuestionTypeDefinition<any, any>; pluginId?: string }> {
    return [...this.registrations.values()];
  }

  /** 插件可见的题型标识清单。 */
  types(): string[] {
    return [...this.registrations.keys()];
  }
}

/** 建一个已装好 5 种内置题型的注册表。 */
export function createQuestionTypeRegistry(): QuestionTypeRegistry {
  const registry = new QuestionTypeRegistry();
  for (const definition of BUILTIN_QUESTION_TYPES) {
    registry.register(definition);
  }
  return registry;
}
