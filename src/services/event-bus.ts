/**
 * 前端轻量级 EventBus
 *
 * 供白板等核心模块使用。支持：
 * - 内存级 publish/subscribe（模块间解耦通信）
 * - 通过 SocketBridge 将白板事件转发到服务端 EventBus（审计日志 + 广播）
 * - 自动生成事件 ID 和时间戳
 *
 * Step 1 - v5.0 架构重构
 */
import type { PlatformEvent } from '../../packages/core/event-bus';

type EventHandler = (event: PlatformEvent) => void;

const SOCKET_FORWARD_PREFIXES = [
  'whiteboard.',
  'courseware.',
  'quiz.',
  'rollcall.',
];

class FrontendEventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private socketBridge?: (event: PlatformEvent) => void;

  /** 由外部（App.tsx）注入 Socket 转发逻辑。幂等：重复调用会覆盖之前的桥接。 */
  setSocketBridge(fn: (event: PlatformEvent) => void): void {
    this.socketBridge = fn;
  }

  /** 检查是否已设置桥接 */
  hasSocketBridge(): boolean {
    return !!this.socketBridge;
  }

  subscribe(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  async publish(event: PlatformEvent): Promise<void> {
    // 本地订阅者通知
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (e) {
          console.error('[FrontendEventBus] handler error:', e);
        }
      }
    }

    // 转发到服务端（白板等模块的结构化事件）
    if (this.socketBridge && SOCKET_FORWARD_PREFIXES.some((p) => event.type.startsWith(p))) {
      this.socketBridge(event);
    }
  }
}

export const frontendEventBus = new FrontendEventBus();
