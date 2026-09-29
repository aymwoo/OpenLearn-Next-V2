/**
 * WidgetFullscreenStage — 全屏内容的画布承载层
 *
 * 存在的原因：`renderElement` 返回的是 konva 节点（`<Group>` / `<Html>` 等），
 * 而 konva 的 reconciler 依赖 `<Stage>` 提供的 FiberProvider 上下文。把它直接
 * 放在普通 DOM 容器里会抛 `useFiber must be called within a <FiberProvider />`
 * —— 真机上表现为进入全屏瞬间整页白屏。
 *
 * 所以「全屏时渲染真实组件」不能只写一个 div，必须给全屏内容一个自己的
 * `<Stage>`。这里抽出这一层，好处是浏览器全屏与白板全屏共用同一套承载逻辑，
 * 两者的差别收敛为「容器多宽高、是否铺满」。
 *
 * 为什么不用插件 fullscreenRendererRegistry：
 * 那条路径要求每种组件类型各自注册一个渲染器（历史上无人注册，全部落到
 * DefaultFullscreenRenderer 的字段预览兜底），既逐类型重复，又必然与画布内
 * 的真实渲染漂移。复用 renderElement 才能保证「全屏里看到的就是它本来的样子」。
 */
import React from 'react';
import { Stage, Layer } from 'react-konva';

export interface WidgetFullscreenStageProps {
  width: number;
  height: number;
  children: React.ReactNode;
}

export function WidgetFullscreenStage({ width, height, children }: WidgetFullscreenStageProps) {
  // 尺寸为 0 时不挂载：konva 对 0 尺寸 Stage 的行为未定义，且此时本就没有可见内容
  if (width <= 0 || height <= 0) return null;

  return (
    <Stage
      data-testid="widget-fullscreen-stage"
      width={width}
      height={height}
      // 透明背景：全屏容器的底色由外层负责，这里只是承载 konva 节点
      style={{ backgroundColor: 'transparent' }}
    >
      <Layer>{children}</Layer>
    </Stage>
  );
}

export default WidgetFullscreenStage;
