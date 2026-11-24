/**
 * LearningSurface 渲染器对外契约（阶段 4）。
 *
 * 宿主只认 `SurfaceRenderer`：内置渲染器提供 React 组件，插件渲染器提供
 * sandbox 描述（pluginId + view）。渲染器通过 `onProgress / onSubmit`
 * 上报状态，不直接调用 attempt API，权限与幂等由宿主统一处理。
 */
import type { ComponentType } from 'react';

export interface LearningContentRef {
  rendererId: string;
  source: {
    kind: 'courseware' | 'resource' | 'assignment' | 'activity' | 'inline';
    id?: string;
  };
  config?: {
    title?: string;
    height?: number;
    aspectRatio?: string;
    maxAttempts?: number;
    /** presentation 的内联 Markdown（纯文本，不是可执行 HTML） */
    markdown?: string;
  };
}

export interface LearningSurfaceRow {
  id: string;
  lesson_id: string;
  kind: string;
  owner_id: string;
  content_ref_json: string;
  deleted_at: number | null;
}

export interface SurfaceAttempt {
  id: string;
  status: 'in_progress' | 'submitted' | 'graded';
  completion: number | null;
  auto_score: number | null;
  score: number | null;
  max_score: number | null;
  state_json: string | null;
}

export interface ProgressPatch {
  completion?: number;
  state?: unknown;
  autoScore?: number;
  maxScore?: number;
}

export interface SubmitPayload {
  autoScore?: number;
  maxScore?: number;
  data?: unknown;
}

export interface SurfaceRendererProps {
  surfaceId: string;
  contentRef: LearningContentRef;
  lessonId: string;
  hostId: string;
  preview: boolean;
  attempt: SurfaceAttempt | null;
  /** 已提交 / 已评分 / 达到尝试上限时为 true，渲染器应禁用交互。 */
  readOnly: boolean;
  onProgress: (patch: ProgressPatch) => void;
  onSubmit: (payload?: SubmitPayload) => void;
}

/**
 * attempt 写入方式：
 * - `surface`：宿主通过 `/api/learning-surface-attempts` 懒创建 / 续用；
 * - `bridge`：作业域的 attempt 已由桥接服务维护，渲染器走作业读 API；
 * - `none`：纯展示，不产生 attempt。
 */
export type AttemptMode = 'surface' | 'bridge' | 'none';

export interface SurfaceRenderer {
  id: string;
  execution: 'inline' | 'sandbox';
  attemptMode: AttemptMode;
  capabilities: string[];
  sourceKinds: string[];
  Component?: ComponentType<SurfaceRendererProps>;
  sandbox?: { pluginId: string; view?: string };
}

/** `GET /api/learning-surface-renderers` 返回的目录项。 */
export interface RendererDescriptor {
  id: string;
  label: string;
  execution: 'inline' | 'sandbox';
  capabilities: string[];
  sourceKinds: string[];
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };
  aspectRatio?: string;
  pluginId?: string;
  view?: string;
}
