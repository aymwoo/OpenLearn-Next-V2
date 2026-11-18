/**
 * Host → Mode Pack 白板画布桥。
 *
 * LiveClassroom / StudentLesson 在 flag 开启时提供画布 props 与 ref；
 * WhiteboardModeWorkspace 只消费本桥，避免把宿主细节塞进通用 slotProps。
 */
import { createContext, useContext, type ReactNode, type Ref } from 'react';
import type { WhiteboardHandle } from '../../whiteboard/InteractiveWhiteboard';

/** LazyWhiteboard 透传 props（宿主组装，包内不解析语义） */
export type WhiteboardHostCanvasProps = Record<string, unknown>;

export type WhiteboardHostBridgeValue = {
  canvasProps: WhiteboardHostCanvasProps;
  whiteboardRef?: Ref<WhiteboardHandle | null>;
};

const WhiteboardHostBridgeContext = createContext<WhiteboardHostBridgeValue | null>(null);

export function WhiteboardHostBridgeProvider({
  value,
  children,
}: {
  value: WhiteboardHostBridgeValue | null;
  children: ReactNode;
}) {
  return <WhiteboardHostBridgeContext.Provider value={value}>{children}</WhiteboardHostBridgeContext.Provider>;
}

export function useWhiteboardHostBridge(): WhiteboardHostBridgeValue | null {
  return useContext(WhiteboardHostBridgeContext);
}
