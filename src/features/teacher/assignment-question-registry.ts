/**
 * AssignmentQuestionRendererRegistry — 作业题型渲染器注册表 (P1)
 *
 * 打破作业题型单体硬编码：第三方插件可注册学科专属题型
 * （如在线代码沙箱运行题 / 口语发音评分题 / 动态几何作图题）。
 *
 * 匹配规则：作业 `content` 以 `{"quizType":"<quizType>"` 开头即命中
 * 对应渲染器；内置 `mcq_learning_objectives` 与纯 Markdown 内容
 * 保持宿主原有渲染路径，不受影响。
 *
 * 前端注册：`ctx.ui.registerAssignmentQuestionRenderer(config)`
 * （activate() 内调用；注销带 pluginId 所有权校验）
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface AssignmentQuestionContext {
  /** 作业实体（含 content/quizType 等） */
  assignment: any;
  /** 学生作答状态（按题收集，键为题号/题 id） */
  answers: any;
  setAnswers: (updater: (prev: any) => any) => void;
  lang: 'zh' | 'en';
}

export interface AssignmentQuestionRendererConfig {
  /** quizType 标识：作业 content 的 `{"quizType":"<quizType>"` 匹配此值 */
  quizType: string;
  /** 题型标题（面板头部展示，如「代码运行题」） */
  label: string;
  /** 题型描述（提交引导文案） */
  description?: string;
  /**
   * 渲染题目并收集作答（替代内置题型的题目区渲染）
   * 返回 React 节点；作答数据写入 answers
   */
  render: (ctx: AssignmentQuestionContext) => React.ReactNode;
  /**
   * 提交前校验（可选）：返回错误文案则阻止提交
   */
  validate?: (ctx: AssignmentQuestionContext) => string | null;
  /**
   * 构建提交载荷（可选）：替代默认 JSON.stringify(answers)
   */
  buildSubmission?: (ctx: AssignmentQuestionContext) => string;
}

interface RegistryState {
  items: Map<string, { config: AssignmentQuestionRendererConfig; pluginId?: string }>;
}

export class AssignmentQuestionRendererRegistry {
  private store = createStore<RegistryState>(() => ({
    items: new Map(),
  }));

  /** 注册第三方插件贡献的题型渲染器 */
  register(config: AssignmentQuestionRendererConfig, pluginId?: string): void {
    if (!config?.quizType || !config.quizType.trim()) {
      throw new Error('[AssignmentQuestionRendererRegistry] quizType is required');
    }
    if (typeof config.render !== 'function') {
      throw new Error('[AssignmentQuestionRendererRegistry] render must be a function');
    }
    const key = config.quizType.trim();
    this.store.setState((state) => {
      const next = new Map(state.items);
      next.set(key, { config: { ...config, quizType: key }, pluginId: pluginId || config.quizType });
      return { items: next };
    });
  }

  /**
   * 注销（带 pluginId 所有权校验 —— 防止插件互删）
   */
  unregister(quizType: string, pluginId?: string): void {
    const key = quizType.trim();
    const entry = this.store.getState().items.get(key);
    if (entry && pluginId && entry.pluginId !== pluginId) return;
    this.store.setState((state) => {
      const next = new Map(state.items);
      next.delete(key);
      return { items: next };
    });
  }

  /**
   * 根据作业 content 匹配已注册的题型渲染器。
   * 返回 null 表示无插件渲染器命中（走宿主内置路径）。
   */
  match(content: string | null | undefined): { config: AssignmentQuestionRendererConfig } | null {
    if (!content || !content.startsWith('{')) return null;
    try {
      const quizType = String(JSON.parse(content).quizType ?? '').trim();
      if (!quizType || quizType === 'mcq_learning_objectives') return null;
      const entry = this.store.getState().items.get(quizType);
      return entry ? { config: entry.config } : null;
    } catch {
      return null;
    }
  }

  /**
   * 插件卸载时按所有权清理其注册的全部题型渲染器
   */
  clearOwned(pluginId: string | undefined): void {
    if (!pluginId) return;
    this.store.setState((state) => {
      const next = new Map(state.items);
      for (const [key, entry] of next) {
        if (entry.pluginId === pluginId) next.delete(key);
      }
      return { items: next };
    });
  }

  /** 调试/管理面板：列出全部已注册题型 */
  list(): AssignmentQuestionRendererConfig[] {
    return Array.from(this.store.getState().items.values()).map((e) => e.config);
  }

  clear(): void {
    this.store.setState(() => ({ items: new Map() }));
  }
}

export const assignmentQuestionRendererRegistry = new AssignmentQuestionRendererRegistry();
