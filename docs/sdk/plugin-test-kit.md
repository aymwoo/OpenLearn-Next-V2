# `@openlearn/plugin-test-kit` 插件测试套件

`@openlearn/plugin-test-kit` 是 OpenLearn V2 官方为插件开发者提供的轻量级、零真实平台依赖的单元测试工具包。通过 `createMockContext()` 测试桩，开发者可以在 Vitest 或 Jest 中离线运行、模拟和断言插件的全部生命周期与业务逻辑。

---

## 1. 安装与快速开始

在插件开发项目根目录下安装测试套件与测试运行器：

```bash
pnpm add -D @openlearn/plugin-test-kit vitest
```

在测试文件中引入：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';
import myPlugin from '../src/index.js';

describe('My Plugin Unit Tests', () => {
  it('should activate cleanly', async () => {
    const ctx = createMockContext({ pluginId: 'ext-demo' });
    await myPlugin.activate(ctx);

    expect(ctx.pluginId).toBe('ext-demo');
  });
});
```

---

## 2. `createMockContext(options)` 核心功能

`createMockContext()` 自动为插件构造了全套隔离的 Mock 上下文对象，包括：

| 上下文属性 | 类型 | 测试功能与行为 |
| :--- | :--- | :--- |
| `ctx.pluginId` | `string` | 插件唯一标识（默认 `'test-plugin'`，可通过参数指定） |
| `ctx.manifest` | `Manifest` | 模拟的 Manifest 元数据 |
| `ctx.services` | `Record<string, any>` | 内核 7 大服务 Mock 桩（支持 `commandBus`, `eventBus`, `storage`, `ai` 等） |
| `ctx.db` | `PluginDatabaseAPI` | 内存 SQLite / 模拟数据库（支持 `ensureTable`, `table`, `migrate`） |
| `ctx.log` | `IPluginLogger` | 内存日志捕获（`debug`, `info`, `warn`, `error`），可断言日志输出 |
| `ctx.http` | `PluginHttpRouter` | **内置 RESTful 路由器（v0.3.11 新增）**，无需启动 HTTP 服务即可离线测试 HTTP 接口 |
| `ctx.resolve` | `Function` | DI 服务解析模拟（可通过 `ctx.provide` 事先注入） |
| `ctx.provide` | `Function` | DI 自定义服务提供 |

---

## 3. 单元测试实战演练

### 3.1 测试命令处理逻辑 (Command Handlers)

验证插件在 `activate` 中注册的命令逻辑：

```typescript
import { describe, it, expect } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';

describe('Command Tests', () => {
  it('should register and execute poll.create command', async () => {
    const ctx = createMockContext({ pluginId: 'ext-poll' });

    // 插件注册命令
    ctx.services.commandBus.registerHandler('poll.create', async (cmd: any) => {
      return { pollId: 'poll-101', title: cmd.payload.title };
    });

    // 模拟调度执行
    const result = await ctx.services.commandBus.execute({
      type: 'poll.create',
      payload: { title: '今天理解了吗？' }
    });

    expect(result).toEqual({ pollId: 'poll-101', title: '今天理解了吗？' });
  });
});
```

### 3.2 测试事件发布与订阅 (Events)

断言插件是否在业务完成后正确发布了业务事件：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';

describe('Event Tests', () => {
  it('should publish poll.created event', async () => {
    const ctx = createMockContext();
    const eventHandler = vi.fn();

    // 订阅事件
    ctx.services.eventBus.subscribe('poll.created', eventHandler);

    // 触发插件发布逻辑
    await ctx.services.eventBus.publish({
      type: 'poll.created',
      payload: { pollId: 'poll-101' },
      timestamp: Date.now()
    });

    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'poll.created' })
    );
  });
});
```

### 3.3 测试插件 RESTful API 路由 (`ctx.http`)（v0.3.11 新增）

在 `v0.3.11` 中，`createMockContext` 默认内置了真实的 `PluginHttpRouter` 实例。开发者可直接使用 `ctx.http.handle()` 派发模拟请求，测试端点响应、参数提取与错误处理：

```typescript
import { describe, it, expect } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';

// 待测插件
const feedbackPlugin = {
  activate: async (ctx: any) => {
    ctx.http.get('/students/:id/summary', async (req: any) => {
      return {
        studentId: req.params.id,
        term: req.query.term || '2026-spring',
        reviewer: req.actor.username
      };
    });

    ctx.http.post('/feedback', async (req: any) => {
      if (!req.body?.content) {
        return { status: 400, body: { error: 'Content required' } };
      }
      return { status: 201, body: { created: true } };
    });
  }
};

describe('RESTful API Tests', () => {
  it('should handle GET with dynamic params and actor context', async () => {
    const ctx = createMockContext({ pluginId: 'ext-feedback' });
    await feedbackPlugin.activate(ctx);

    // 模拟客户端发起 GET 请求
    const res = await ctx.http.handle({
      method: 'GET',
      path: '/students/stu_007/summary',
      params: {},
      query: { term: '2026-autumn' },
      headers: {},
      body: null,
      ip: '127.0.0.1',
      actor: { actorId: 'user:1', username: 'teacher_li', role: 'teacher' }
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      studentId: 'stu_007',
      term: '2026-autumn',
      reviewer: 'teacher_li'
    });
  });

  it('should return 400 when body validation fails', async () => {
    const ctx = createMockContext({ pluginId: 'ext-feedback' });
    await feedbackPlugin.activate(ctx);

    const res = await ctx.http.handle({
      method: 'POST',
      path: '/feedback',
      params: {},
      query: {},
      headers: {},
      body: {}, // 缺少 content
      ip: '127.0.0.1',
      actor: { actorId: 'anon', role: 'anonymous' }
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Content required' });
  });

  it('should return 404 for unregistered routes', async () => {
    const ctx = createMockContext();
    await feedbackPlugin.activate(ctx);

    const res = await ctx.http.handle({
      method: 'GET',
      path: '/not-exists',
      params: {},
      query: {},
      headers: {},
      body: null,
      ip: '127.0.0.1',
      actor: { actorId: 'anon', role: 'anonymous' }
    });

    expect(res.status).toBe(404);
  });
});
```

---

## 4. 最佳实践建议

1. **测试隔离**：在每个测试用例中使用 `beforeEach` 重新调用 `createMockContext()`，防止状态在用例间产生交叉污染。
2. **生命周期对齐**：若插件实现了 `deactivate`，在用例的 `afterEach` 或测试末尾调用 `await plugin.deactivate()` 验证资源释放。
3. **断言日志安全**：可通过检查 `ctx.log` 的记录，验证插件未泄露敏感信息或在异常分支正确记录了警告日志。

