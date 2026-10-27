# 总线与事件流文档审计（2026-10-27）

审计范围：`packages/core/` 与 `src/` 下所有「总线 / 事件流」实现，逐个比对 `docs/`。

## 结论

全平台共 **12 个总线/事件流组件**（11 个总线 + 1 个事件流）、另有 2 个测试替身。**只有 4 个在文档里有实质说明**，其余 8 个要么只有一句话，要么在 `docs/` 里一次都没出现。

| 组件                              | 实现位置                                               | 生产引用 | 文档状态                                                                   | 判定                   |
| --------------------------------- | ------------------------------------------------------ | -------- | -------------------------------------------------------------------------- | ---------------------- |
| `CommandBus`                      | `packages/core/command-bus/index.ts`                   | 广泛     | `architecture/command-event-bus.md` 专章                                   | ⚠️ 计数漂移（见 P1-1） |
| `EventBus`                        | `packages/core/event-bus/index.ts`                     | 广泛     | 同上，专章最完整                                                           | ✅ 准确                |
| `CapabilityEventBus`              | `core/capability/event/`                               | 6 处     | `capability-gateway.md` §2 列全 6 事件 + `CapabilitySDK.watchCapability`   | ✅ 间接覆盖            |
| `RuntimeEventBus`                 | `core/classroom-runtime/event-bus.ts`                  | 6 处     | `classroom-runtime.md` 两处，含 envelope 与通配说明                        | ✅ 覆盖                |
| `AIEventBus`                      | `core/ai/event/ai-event-bus.ts`                        | 4 处     | `ai/ai-runtime.md` **一句**「统一分发 `ModelStarted`、`ModelFinished` 等」 | ❌ 不足                |
| `StreamingService`                | `core/ai/streaming/streaming-service.ts`               | 1 处     | **0 命中**                                                                 | ❌ 缺失                |
| `ServiceEventBus`                 | `core/service-registry/event/`                         | 2 处     | **0 命中**，连 `architecture/service-registry.md` 都没有                   | ❌ 缺失                |
| `PresenceEventBus`                | `core/presence-engine/presence-event-bus.ts`           | 8 处     | **0 命中**                                                                 | ❌ 缺失                |
| `CollaborationEventBus`           | `core/collaboration-engine/collaboration-event-bus.ts` | 2 处     | **0 命中**                                                                 | ❌ 缺失                |
| `EventStream`                     | `core/analytics-engine/event-stream.ts`                | 9 处     | **0 命中**，`docs/analytics/` 无提及                                       | ❌ 缺失                |
| `FrontendEventBus`                | `src/services/event-bus.ts`                            | 广泛     | 仅在 2 篇白板文档里被顺带提到                                              | ❌ 无参考页            |
| `CanvasEventBus`                  | `src/features/whiteboard/canvas-model/event/`          | **0**    | 0 命中                                                                     | ⚠️ 死代码              |
| `TeachingEventBus`                | `src/features/whiteboard/teaching-object/event/`       | **0**    | 0 命中                                                                     | ⚠️ 死代码              |
| `MockCommandBus` / `MockEventBus` | `packages/plugin-test-kit/index.ts`                    | 测试用   | 1 处（`MockCommandBus`）                                                   | 可接受                 |

---

## P0：三处会让人写出错代码的缺失

### P0-1　`ServiceEventBus`：8 个事件里 4 个从未发出

`packages/core/service-registry/types/index.ts` 声明了 8 个事件，实际只有 4 个有 `publish` 调用点：

| 事件                                                                          | 是否有 emit                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------- |
| `ServiceRegistered` / `ServiceReady` / `ServiceRemoved` / `ServiceReplaced`   | ✅ `platform-service-registry.ts`           |
| `ServiceStopped` / `ServiceDisposed` / `ServiceResolved` / `ResolutionFailed` | ❌ 全仓只有类型声明，**从没有代码发布它们** |

而且**全仓没有任何订阅者**（`grep 'eventBus.subscribe(' packages/core/service-registry/` 为空）。谁按文档去 `subscribe('ServiceResolved')` 等事件，会永久静默——这是最容易浪费半天的那种坑。

`architecture/service-registry.md` 里 `grep -n "事件\|event"` **零命中**：服务注册表有页面，但它的总线完全不在页面里。

### P0-2　`AIEventBus` + `StreamingService`：文档只有一句宣传语，且链路是「只发不收」

`ai/ai-runtime.md:10` 只有一条特性 bullet：「内置 `AIEventBus`，统一分发 `ModelStarted`、`ModelFinished` 等生命周期事件」。

实际有 **7 个事件**（`AIEventMap`）：`ModelStarted` / `ModelFinished` / `ToolCalled` / `PromptBuilt` / `StreamingStarted` / `StreamingFinished` / `ConversationCreated`。**7 个全部有 emit**（provider-gateway、tool-registry、prompt-registry、conversation-service、streaming-service），但文档只点名了 2 个，`ToolCalled` / `PromptBuilt` / `StreamingStarted` / `StreamingFinished` / `ConversationCreated` 在 `docs/` 里零命中。

更关键的事实文档没写：**这 7 个事件在生产代码里没有任何订阅者**（只有 `packages/core/__tests__/ai-runtime.test.ts` 订阅）。也就是说当前是纯遥测发射端，谁想「接到 AI 事件流上做统计」得自己先 `subscribe`，文档应当明说这一点，否则读者会以为已有现成的消费方。

`StreamingService` 则是完整的 0 命中：它的 `createStreamSession()` 返回 `{ streamId, finish(totalBytes) }`，`finish` 必须被调用才会发 `StreamingFinished`；漏调就只有开始没有结束。

### P0-3　5 个兄弟总线是 `EventBus` 的**降级版**，但没有任何文档提醒

`AIEventBus` / `CapabilityEventBus` / `ServiceEventBus` / `PresenceEventBus` / `CollaborationEventBus` 是同一份代码复制了 5 次，与 `EventBus` 的行为差异**全部未文档化**：

| 能力                              | `EventBus`                                         | 5 个兄弟总线                                        |
| --------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| 订阅者超时预算                    | ✅ 默认 2000ms                                     | ❌ 无（`grep handlerTimeout` = 0）                  |
| 防发布递归                        | ✅ `maxSameTypeDepth`（默认 3，AsyncLocalStorage） | ❌ 无                                               |
| 同一 handler 同时注册类型与 `'*'` | ✅ 去重，只跑一次                                  | ❌ **跑两次**（`[...channel, ...wildcard]` 未去重） |
| 订阅者异常                        | 记入 `outcomes`，可观测                            | ❌ 仅 `console.error` 后吞掉                        |
| 返回值                            | `publishDetailed()` → `DispatchResult`             | 返回 envelope                                       |
| 泄漏告警                          | ✅ >50 告警                                        | ❌ 无                                               |

一个订阅者抛错或卡住，在 `EventBus` 上是「被记录并跳过」，在兄弟总线上是「console.error 后静默」或「拖住整条 publish」。文档不说，读者会按 `EventBus` 的语义假设它们。

---

## P1：主文档的计数漂移与前端总线空白

### P1-1　`CommandBus`「公开方法共 6 个」→ 实际 7 个

`architecture/command-event-bus.md:11` 写「公开方法共 6 个」，列的是 `setInterceptor / registerHandler / registerLegacyHandler / unregisterHandler / execute / createCommand`。

`hasHandler(commandType)` 在 `1719e3c`（R-3 加固）就已加入——它是 `/api/plugins/execute-command` 做存在性预检的唯一公开入口（此前直接读私有 `handlers` Map），属于插件作者会用到的方法，但文档既没列也没在 §2 说明。

### P1-2　`FrontendEventBus` 没有任何参考页

`src/services/event-bus.ts` 是一个比内核 `EventBus` **更强**的实现，且语义不同：

- 支持**前缀通配** `'courseware.*'`（内核 `EventBus` 只支持 `'*'`，不解析前缀）；
- `subscribePayload(type, (payload, event) => …)`、`once()`、`listenerCount()`、`clear(type?)`；
- `emit(type, payload, source='frontend')` 自动补 `id` / `timestamp`；
- 异步 handler 的 rejection 被 `.catch` 兜住（不阻塞后续 handler）。

这些能力在 `docs/` 里只散落在白板文档的脚注中，**没有一处 API 参考**。同时 `src/types/events.ts` 的 `FrontendEventMap` 有 **13 个带类型的事件**，也没有任何目录页。

需要注意：`whiteboard-event-slot-contract.md` 已经明确写了「前端 `eventBus` 不暴露给插件」，这条结论是对的，但读者没有页面可以查总线本身怎么用。

---

## P2：文档薄弱的边缘项

1. **插件 SSE 流式路由**：`server/routes/plugin-api-gateway.ts` 支持 `text/event-stream`，带并发流配额（默认每 IP 5、全局 50，`streamConnectionTracker`）、`X-Accel-Buffering: no`、close 时释放配额。插件侧通过 `ctx.http.stream` + manifest 路由上 `streaming: true` 启用。`docs/` 里只有 `api/di-tokens.md` 一行注释「RESTful & SSE 流式路由」。
   - 附带缺陷：`manifest-schema.ts` **没有** `streaming` 字段，`http.ts:96` 用 `(r as any).streaming` 读——声明式字段游离在 schema 之外，写错了也没有校验。
2. **`EventStream`（analytics）**：有 `replay(windowMs)` / `filter()` / `window()` / `aggregate()`，是平台里唯一带**重放**能力的事件流。两个坑未文档化：`publish()` 是同步的，异步订阅者的 rejection **不会被捕获**（只 catch 同步抛错）；`events` 数组无上限，只有手动 `clear()` 才释放。
3. **`CanvasEventBus` / `TeachingEventBus`**：全仓除自身文件外零引用，属未接线的死代码。写文档没意义，建议在架构文档的「已知未启用模块」清单里登记，或直接删除。

---

## 为什么会漂（根因）

`audit-tools/run.sh` 现有五段门禁查的是：文件路径、文档内链、配置键、插件示例、扩展槽位。**没有任何一段关心「有没有一个总线/事件流实现没进文档」**——`symbol_hints=42` 只提示散落的符号名，不覆盖「整个类被漏掉」这种情况。

与本轮前一个审计（扩展槽位）同构：缺的不是统计，是**没有检查项**。区别在于总线数量少（12 个），适合用一张「组件清单 + 文档状态」的表格人工维护，而不是再写一个通用扫描器。

## 建议的修复顺序

| 优先级 | 动作                                                                                                          | 落点                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| P0     | 给 `ServiceEventBus` 补一节，写明 4 个死事件 + 无订阅者                                                       | `architecture/service-registry.md`                      |
| P0     | 把 `AIEventBus` 从 1 句扩成一节：7 事件表 + envelope + 无生产订阅者 + `StreamingService` 契约                 | `ai/ai-runtime.md`                                      |
| P0     | 在 `command-event-bus.md` 加一节「其它专用总线」：5 个兄弟总线的差异对照表（无超时/无防递归/重复分发/吞异常） | `architecture/command-event-bus.md`                     |
| P1     | `CommandBus` 6 → 7，补 `hasHandler` 说明                                                                      | 同上                                                    |
| P1     | 新增 `api/frontend-event-bus.md`：API + 前缀通配 + 13 个事件目录 + 不暴露给插件                               | 新文件 + `docs/index.md` 挂 toctree                     |
| P2     | 补插件 SSE 流式路由一节（含 `streaming: true` 与配额）                                                        | `plugin/plugin-manifest-spec.md` 或 plugin-architecture |
| P2     | `EventStream` 的重放能力与两个坑                                                                              | `analytics/learning-analytics-engine.md`                |
| P2     | 登记/清理 `CanvasEventBus`、`TeachingEventBus`                                                                | 架构文档「未启用模块」                                  |

## 复核命令

```bash
# 组件清单（应为 12 + 2 mock）
grep -rn "^export class \w*\(Bus\|Stream\)\b" packages/ src/ --include="*.ts"

# 每个组件的文档命中数
for n in AIEventBus StreamingService ServiceEventBus PresenceEventBus \
         CollaborationEventBus EventStream FrontendEventBus; do
  printf "%-24s docs:%s\n" "$n" "$(grep -rl "$n" docs/ | wc -l)"
done

# Service 事件里哪些从未 emit
grep -rn "publish('Service" packages/core/service-registry --include="*.ts"
```
