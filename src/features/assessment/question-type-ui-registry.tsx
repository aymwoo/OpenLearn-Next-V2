/**
 * 题型 UI 注册表（Issue #100 / 子 issue #121）。
 *
 * 与 `src/features/teacher/assignment-question-registry.ts` 同构：
 * zustand vanilla store + `pluginId` 所有权 + `clearOwned`（插件卸载时批量清理）。
 * 与后端 `IAssessmentGraderRegistry` 共享同一个 `type` 字符串，因此插件只要在
 * activate 里注册一次（前端 `ctx.ui.registerAssessmentQuestionType` + 服务端
 * `registerQuestionType`），两端就都认识这个题型。
 *
 * 内置 5 种题型走同一注册路径；缺 UI 的题型（例如插件只提供了服务端 grader）
 * 在出题页会退化成「该题型暂无编辑器」，不会崩。
 */
import { createStore } from 'zustand/vanilla';
import type React from 'react';
import type { AssessmentKind, QuestionCategory } from '../../../packages/core/assessment/index.js';

/** 出题时编辑器拿到的配置（与 core 的题型 config 同一个对象）。 */
export interface QuestionEditorProps {
  config: Record<string, unknown>;
  answerKey: unknown;
  onChange: (next: { config: Record<string, unknown>; answerKey: unknown }) => void;
  lang: 'zh' | 'en';
  disabled?: boolean;
}

/** 学生作答组件拿到的 props。`value` 形状由题型决定（索引 / 索引数组 / 布尔 / 数组或对象）。 */
export interface QuestionAnswerProps {
  config: Record<string, unknown>;
  value: unknown;
  onChange: (next: unknown) => void;
  lang: 'zh' | 'en';
  readOnly?: boolean;
}

export interface AssessmentQuestionTypeUi {
  /** 与后端题型注册表一致的 type */
  type: string;
  label: { zh: string; en: string };
  category: QuestionCategory;
  supports: AssessmentKind[];
  /** 出题编辑器 */
  Editor: React.FC<QuestionEditorProps>;
  /**
   * 学生作答组件（Issue #122）。缺省时作答页退化成 JSON 文本框，
   * 这样"只有服务端 grader 的插件题型"也能被作答而不是被卡住。
   */
  Answer?: React.FC<QuestionAnswerProps>;
  /** 新题默认配置（缺省时用 `{}`） */
  createDefaultConfig?: () => Record<string, unknown>;
  /** 新题默认标准答案（缺省时用 null） */
  createDefaultAnswerKey?: () => unknown;
}

interface RegistryState {
  items: Map<string, { config: AssessmentQuestionTypeUi; pluginId?: string }>;
}

export class AssessmentQuestionTypeUiRegistry {
  private store = createStore<RegistryState>(() => ({ items: new Map() }));

  /** 注册题型 UI。重复 type 抛错（静默覆盖会让"插件题型被顶掉"变成幽灵 bug）。 */
  register(config: AssessmentQuestionTypeUi, pluginId?: string): void {
    if (!config?.type || typeof config.type !== 'string' || !config.type.trim()) {
      throw new Error('[AssessmentQuestionTypeUiRegistry] type is required');
    }
    if (typeof config.Editor !== 'function') {
      throw new Error(`[AssessmentQuestionTypeUiRegistry] ${config.type}: Editor must be a component`);
    }
    const key = config.type.trim();
    if (this.store.getState().items.has(key)) {
      throw new Error(`[AssessmentQuestionTypeUiRegistry] duplicate question type: ${key}`);
    }
    this.store.setState((state) => {
      const next = new Map(state.items);
      next.set(key, { config: { ...config, type: key }, pluginId: pluginId || key });
      return { items: next };
    });
  }

  /** 注销（带 pluginId 所有权校验，防止插件互删）。 */
  unregister(type: string, pluginId?: string): boolean {
    const entry = this.store.getState().items.get(type);
    if (!entry) return false;
    if (pluginId !== undefined && entry.pluginId !== pluginId) return false;
    this.store.setState((state) => {
      const next = new Map(state.items);
      next.delete(type);
      return { items: next };
    });
    return true;
  }

  /** 插件卸载时按 pluginId 批量清理。 */
  clearOwned(pluginId: string): number {
    const state = this.store.getState();
    const owned = [...state.items.entries()].filter(([, entry]) => entry.pluginId === pluginId);
    if (owned.length === 0) return 0;
    this.store.setState(() => {
      const next = new Map(state.items);
      for (const [type] of owned) next.delete(type);
      return { items: next };
    });
    return owned.length;
  }

  get(type: string): AssessmentQuestionTypeUi | undefined {
    return this.store.getState().items.get(type)?.config;
  }

  list(): AssessmentQuestionTypeUi[] {
    return [...this.store.getState().items.values()].map((entry) => entry.config);
  }

  /** React 侧订阅入口（出题页随注册表变化重渲染）。 */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  getSnapshot(): AssessmentQuestionTypeUi[] {
    return this.list();
  }
}

export const assessmentQuestionTypeUiRegistry = new AssessmentQuestionTypeUiRegistry();
