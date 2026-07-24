# Core API Reference 系统 API 手册

本文档汇总 OpenLearn V2 底层核心服务接口与核心类方法规范。

---

## 1. `CommandBus` API

位于 `packages/core/command-bus/index.ts`：

- `register(type: string, handler: CommandHandler): () => void`: 注册指令处理函数。
- `dispatch(command: PlatformCommand): Promise<any>`: 执行指令。
- `hasHandler(type: string): boolean`: 检查指令是否有注册的处理句柄。

---

## 2. `EventBus` API

位于 `packages/core/event-bus/index.ts`：

- `subscribe(type: string, subscriber: EventSubscriber): () => void`: 订阅事件。
- `publish(event: PlatformEvent): void`: 广播事件。
- `clear(): void`: 清空所有订阅关系。

---

## 3. `StorageService` API

位于 `packages/core/di/storage-service.ts`：

- `get(key: string): Promise<any>`: 获取键值。
- `set(key: string, value: any): Promise<void>`: 设置键值。
- `delete(key: string): Promise<void>`: 删除键值。

---

## 4. `AIService` API

位于 `packages/core/di/ai-service.ts`：

- `generateCompletion(options: CompletionOptions): Promise<string>`: 生成补全文本。
- `generateStream(options: CompletionOptions, onChunk: (chunk: string) => void): Promise<void>`: 流式生成补全文本。
