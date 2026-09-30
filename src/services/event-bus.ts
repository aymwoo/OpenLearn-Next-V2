/**
 * 前端轻量级 EventBus
 *
 * **本总线仅限当前浏览器进程内**，不与任何其他端通信。
 *
 * 历史包袱：这里曾有一个 `setSocketBridge()` 注入点，声称会把
 * `whiteboard.` / `courseware.` / `quiz.` / `rollcall.` 前缀的事件转发到服务端。
 * 但该注入点**从未被调用**（全仓库零 `setSocketBridge(...)` 调用），
 * 于是那段转发是死代码，却让读代码的人（包括 AI 助手）误以为这些事件会跨端传播。
 * 随机点名「教师端已抽中、学生端不同步」的排查正是被它误导的先例，故已删除。
 *
 * 需要真正跨端的信号，走下面两条**已接线**的通路：
 * - 状态变更 → REST/命令总线（如 `PUT /api/lessons/:id/whiteboard/:elementId`
 *   → `whiteboard.update` 命令 → 服务端 `eventBus` → `setupRealtimeBridge` 广播）
 * - 即时通知 → 直接用 socket（插件可用 `ctx.services.socketService`）
 *
 * Step 1 - v5.0 架构重构
 */
import type { PlatformEvent } from '../../packages/core/event-bus';

type EventHandler = (event: PlatformEvent) => void;

class FrontendEventBus {
  private handlers = new Map<string, Set<EventHandler>>();

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
    // 仅通知本进程内的订阅者
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
  }
}

export const frontendEventBus = new FrontendEventBus();
