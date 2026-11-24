import { PluginSandboxIframeView } from '../../../components/PluginSandboxIframeView';
import type { SurfaceRenderer, SurfaceRendererProps } from '../types';

const MAX_STATE_BYTES = 64 * 1024;

function normalizeCompletion(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value > 1) return Math.min(1, Math.max(0, value / 100));
  return Math.max(0, Math.min(1, value));
}

function nonNegative(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * 插件 sandbox 渲染器（阶段 4，方案 A）。
 *
 * 插件只通过 `bridge.surface.progress / submit` 上报意图；宿主负责：
 *   - 校验事件形状 / 数值范围 / 64KB 上限（PluginSandboxIframeView 已挡来源与体积）；
 *   - 走统一 attempt API 写入，插件不接触 attempt id 或 HTTP；
 *   - 通过 `state.patch` 把恢复状态回灌给插件。
 */
export function SandboxSurfaceRenderer({
  renderer,
  props,
}: {
  renderer: SurfaceRenderer;
  props: SurfaceRendererProps;
}) {
  const { surfaceId, contentRef, lessonId, hostId, attempt, readOnly, onProgress, onSubmit } = props;
  const pluginId = renderer.sandbox?.pluginId;
  const view = renderer.sandbox?.view;

  if (!pluginId || !view) {
    return (
      <div className="w-full h-full flex items-center justify-center p-6 text-center text-xs text-gray-400 bg-slate-50 rounded-xl">
        插件渲染器缺少 view 声明，无法加载
      </div>
    );
  }

  const handleEvent = ({ event, payload }: { event: 'progress' | 'submit'; payload: Record<string, unknown> }) => {
    if (readOnly) return;

    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      return;
    }
    if (serialized.length > MAX_STATE_BYTES) return;

    if (event === 'progress') {
      onProgress({
        completion: normalizeCompletion(payload.completion ?? payload.progress),
        state: payload.state,
        autoScore: nonNegative(payload.autoScore ?? payload.score),
        maxScore: nonNegative(payload.maxScore ?? payload.total),
      });
      return;
    }

    onSubmit({
      autoScore: nonNegative(payload.autoScore ?? payload.score),
      maxScore: nonNegative(payload.maxScore ?? payload.total),
      data: payload.data ?? payload,
    });
  };

  return (
    <div
      data-testid="learning-surface-sandbox"
      data-suppress-autosave="true"
      data-surface-scope={hostId}
      tabIndex={0}
      role="group"
      aria-label={contentRef.config?.title || renderer.id}
      className="w-full h-full min-h-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary-theme/50"
    >
      <PluginSandboxIframeView
        pluginId={pluginId}
        view={view}
        label={contentRef.config?.title ?? renderer.id}
        slot="learning.surface"
        lessonId={lessonId}
        surfaceId={surfaceId}
        surfaceRendererId={contentRef.rendererId}
        surfaceStateJson={attempt?.state_json ?? undefined}
        onSurfaceEvent={handleEvent}
        className="w-full h-full"
      />
      {/* hostId 只用于调试定位：插件不感知宿主元素 id */}
      <span data-surface-host-id={hostId} className="hidden" />
    </div>
  );
}

export default SandboxSurfaceRenderer;
