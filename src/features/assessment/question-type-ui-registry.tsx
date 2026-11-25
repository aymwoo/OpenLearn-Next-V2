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
import { useSyncExternalStore } from 'react';
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

/**
 * 结果页复盘组件拿到的 props。
 *
 * `answerKey` 仅在宿主允许展示解析（`showAnalysis` 且成绩可见）时出现；
 * 插件不得假设它一定存在。
 */
export interface QuestionReviewProps {
  config: Record<string, unknown>;
  answer: unknown;
  answerKey?: unknown;
  score?: number | null;
  isCorrect?: boolean | null;
  feedback?: string | null;
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
  /**
   * 结果页逐题复盘组件（可选）。缺省时结果页退回「作答 / 参考答案」文本。
   * 有它才能把连线题这类结构化作答画成逐对正误，而不是一串 JSON。
   */
  Review?: React.FC<QuestionReviewProps>;
  /** 新题默认配置（缺省时用 `{}`） */
  createDefaultConfig?: () => Record<string, unknown>;
  /** 新题默认标准答案（缺省时用 null） */
  createDefaultAnswerKey?: () => unknown;
}

type QuestionTypeOrigin = 'inline' | 'manifest';

interface QuestionTypeUiRecord {
  config: AssessmentQuestionTypeUi;
  pluginId: string;
  origin: QuestionTypeOrigin;
  /** inline 覆盖 manifest 时保留原声明，插件停用后可回退。 */
  manifestFallback?: AssessmentQuestionTypeUi;
}

interface RegistryState {
  items: Map<string, QuestionTypeUiRecord>;
  /**
   * 稳定快照：`useSyncExternalStore` 要求 `getSnapshot` 在状态未变时返回同一引用，
   * 否则每次渲染都新建数组会触发无限重渲染。
   */
  snapshot: AssessmentQuestionTypeUi[];
}

function withItems(state: RegistryState, items: Map<string, QuestionTypeUiRecord>): RegistryState {
  return { items, snapshot: [...items.values()].map((entry) => entry.config) };
}

export class AssessmentQuestionTypeUiRegistry {
  private store = createStore<RegistryState>(() => ({ items: new Map(), snapshot: [] }));

  /**
   * 注册题型 UI。
   *
   * 两条来源的优先级：inline（可信内建插件）> manifest（声明的 view 包装）。
   * - 同 owner 的 manifest → inline 升级：覆盖并保留 manifest fallback；
   * - 同 owner 的 inline → inline 重复：抛错（保留原有“幽灵覆盖”防护）；
   * - 跨 owner 的 manifest 冲突：跳过 + 告警（先到先得，不拖垮插件激活）；
   * - 跨 owner 的 inline 冲突：抛错（可信插件的问题应在激活期暴露）。
   */
  register(config: AssessmentQuestionTypeUi, pluginId?: string, options: { origin?: QuestionTypeOrigin } = {}): void {
    if (!config?.type || typeof config.type !== 'string' || !config.type.trim()) {
      throw new Error('[AssessmentQuestionTypeUiRegistry] type is required');
    }
    if (typeof config.Editor !== 'function') {
      throw new Error(`[AssessmentQuestionTypeUiRegistry] ${config.type}: Editor must be a component`);
    }
    const key = config.type.trim();
    const owner = pluginId || key;
    const origin = options.origin ?? 'inline';
    const nextConfig = { ...config, type: key };
    const existing = this.store.getState().items.get(key);

    if (existing) {
      if (existing.origin === 'manifest') {
        if (origin === 'manifest') {
          if (existing.pluginId !== owner) {
            console.warn(
              `[AssessmentQuestionTypeUiRegistry] question type "${key}" already declared by "${existing.pluginId}", skip "${owner}".`,
            );
            return;
          }
          // 同一插件重试/HMR：原地更新 manifest 声明。
          this.store.setState((state) => {
            const items = new Map(state.items);
            items.set(key, { ...existing, config: nextConfig });
            return withItems(state, items);
          });
          return;
        }
        // inline 覆盖 manifest：不同 owner 视为抢注，仍然抛错。
        if (existing.pluginId !== owner) {
          throw new Error(`[AssessmentQuestionTypeUiRegistry] duplicate question type: ${key}`);
        }
        this.store.setState((state) => {
          const items = new Map(state.items);
          items.set(key, {
            config: nextConfig,
            pluginId: owner,
            origin: 'inline',
            manifestFallback: existing.config,
          });
          return withItems(state, items);
        });
        return;
      }
      // 已存在 inline 注册
      if (origin === 'manifest') {
        console.warn(
          `[AssessmentQuestionTypeUiRegistry] question type "${key}" already registered inline, skip manifest declaration of "${owner}".`,
        );
        return;
      }
      throw new Error(`[AssessmentQuestionTypeUiRegistry] duplicate question type: ${key}`);
    }

    this.store.setState((state) => {
      const items = new Map(state.items);
      items.set(key, { config: nextConfig, pluginId: owner, origin });
      return withItems(state, items);
    });
  }

  /** 注销（带 pluginId 所有权校验，防止插件互删）；有 manifest fallback 时回退而非删除。 */
  unregister(type: string, pluginId?: string): boolean {
    const entry = this.store.getState().items.get(type);
    if (!entry) return false;
    if (pluginId !== undefined && entry.pluginId !== pluginId) return false;
    this.store.setState((state) => {
      const items = new Map(state.items);
      if (entry.manifestFallback) {
        items.set(type, {
          config: entry.manifestFallback,
          pluginId: entry.pluginId,
          origin: 'manifest',
        });
      } else {
        items.delete(type);
      }
      return withItems(state, items);
    });
    return true;
  }

  /**
   * 插件卸载/停用时按 pluginId 批量清理。
   *
   * `preserveManifest` 为真时（激活失败但仍保留声明式贡献）：
   * - manifest 条目保留；
   * - 被 inline 覆盖的 manifest 版本恢复。
   */
  clearOwned(pluginId: string, options: { preserveManifest?: boolean } = {}): number {
    const state = this.store.getState();
    const owned = [...state.items.entries()].filter(([, entry]) => entry.pluginId === pluginId);
    if (owned.length === 0) return 0;
    let removed = 0;
    this.store.setState((state) => {
      const items = new Map(state.items);
      for (const [type, entry] of owned) {
        if (options.preserveManifest && entry.origin === 'manifest') continue;
        removed += 1;
        if (options.preserveManifest && entry.manifestFallback) {
          items.set(type, {
            config: entry.manifestFallback,
            pluginId: entry.pluginId,
            origin: 'manifest',
          });
        } else {
          items.delete(type);
        }
      }
      return withItems(state, items);
    });
    return removed;
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
    return this.store.getState().snapshot;
  }
}

export const assessmentQuestionTypeUiRegistry = new AssessmentQuestionTypeUiRegistry();

/** React 侧订阅 hook：插件题型在激活后能立即出现在下拉/作答页。 */
export function useAssessmentQuestionTypes(): AssessmentQuestionTypeUi[] {
  return useSyncExternalStore(
    (listener) => assessmentQuestionTypeUiRegistry.subscribe(listener),
    () => assessmentQuestionTypeUiRegistry.getSnapshot(),
    () => assessmentQuestionTypeUiRegistry.getSnapshot(),
  );
}
