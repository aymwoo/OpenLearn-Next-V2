# `ctx.http` — 插件 RESTful / SSE API

> **命名空间**：`@openlearn/core:IPluginHttpRouter`
> **挂载点**：宿主 Express `app.all('/api/plugins/:pluginId/*')`（`server/routes/plugin-api-gateway.ts`）
> **本文口径**：以 `packages/core/plugin-host/http-router.ts`、`packages/core/plugin-host/http.ts`、`packages/core/plugin-host/public-routes.ts`、`server/routes/plugin-api-gateway.ts` 四份源码为准，文档与源码冲突时以源码为准。

---

## 1. 一句话心智模型

插件用 `ctx.http.get('/x', handler)` 把路由**注册进插件自己的内存路由表**；
外部请求走 `/api/plugins/<manifest.id>/x`，由**宿主网关**先做鉴权/限流/清洗，再把一个**纯 DTO**
（`PluginApiRequest`）派发给插件，插件返回 `PluginApiResponse` 或写 SSE 流。

```
浏览器 fetch('/api/plugins/my-plugin/health')
   │
   ▼
Express  ── pluginApiGatewayMiddleware                ← server/routes/plugin-api-gateway.ts
   │  ① 保留动作避让 ② 多段 id 重组 ③ 路径遍历拦截
   │  ④ 插件存在性 ⑤ Payload≤1MB ⑥ 身份提取
   │  ⑦ manifest RBAC ⑧ 限流 ⑨ DTO 组装
   ▼
PluginHost.dispatchHttpRequest(pluginId, reqDto, 5000) ← packages/core/plugin-host/http.ts
   │  inline → withInlineTimeout；worker → RPC
   ▼
PluginHttpRouter.handle(req)                            ← packages/core/plugin-host/http-router.ts
   │  match() → 补 params → 调用 handler → 自动包装响应
   ▼
你的 handler(req) => ...
```

```{important}
插件内**不要**再拼 `/api/plugins/<id>` 前缀。`ctx.http` 注册的路径是**相对子路径**
（`/health`），宿主已经带了命名空间；前端调用时才写全路径 `/api/plugins/<manifest.id>/health`。
```

---

## 2. `IPluginHttpRouter` 完整接口

```typescript
interface IPluginHttpRouter {
  route<TBody = unknown, TRes = unknown>(
    method: string, // 'GET' | 'POST' | ... 会被 toUpperCase()
    path: string,
    handler: PluginApiHandler<TBody, TRes>,
    options?: PluginRouteOptions, // { scope?: PluginRouteScope }
  ): void;

  get<TRes>(path, handler, options?): void;
  post<TBody, TRes>(path, handler, options?): void;
  put<TBody, TRes>(path, handler, options?): void;
  patch<TBody, TRes>(path, handler, options?): void; // ⚠ 只有 patch，没有 all
  delete<TRes>(path, handler, options?): void; // ⚠ 方法名是 delete，不是 del

  stream(path, handler): void; // 重载 A：双注册 GET + POST
  stream(method, path, handler): void; // 重载 B：单动词

  isStream(method: string, path: string): boolean;
  match(method, path): { handler?; streamHandler?; isStream?; params } | null;
  handle(req: PluginApiRequest): Promise<PluginApiResponse>;
  handleStream(req: PluginApiRequest, stream: PluginStreamResponse): Promise<void>;

  getRegisteredRoutes(): Array<{ method: string; pattern: string; isStream?: boolean; scope?: PluginRouteScope }>;
  getUnscopedRoutes(): Array<{ method: string; pattern: string }>;
  clear(): void;
}
```

```{danger}
### 与 LLM 先验冲突

| 你可能想写的 | 实际有没有 | 正确写法 |
| --- | --- | --- |
| `ctx.http.del(...)` | ❌ 无 | `ctx.http.delete(...)` |
| `ctx.http.all(...)` | ❌ 无 | 每个动词各注册一条；`manifest.api.routes` 也**不支持 `ALL`** |
| `ctx.http.head(...)` / `options(...)` | ❌ 无 | 不支持 |
| `ctx.use('/api/x', ...)`（Express 风格） | ❌ 完全不同的东西 | `ctx.use` 是 DI Token 解析（见 [`PluginContext`（服务端 `ctx`）全集](plugin-context.md) §4） |
| `res.json(...)` / `res.status(200).send()` | ❌ handler 拿不到 Express 的 `res` | `return { status, headers, body }` 或直接 `return 数据` |
```

`delete` 是 JS 保留字风格的对象方法名，TS 里合法（`obj.delete()`），但生成代码时模型高频写成 `del`；
这属于**编译期就报错**的类型（不是静默失效），相对安全。真正会静默的是 §5 的 scope 和 §7 的 `auth:false`。

---

## 3. 路径模板语法：`compileRoutePattern`

源码逐行行为（`http-router.ts`）：

```typescript
export function compileRoutePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const normalized = pattern.startsWith('/') ? pattern : '/' + pattern;
  const paramNames: string[] = [];
  const regexStr = normalized
    .replace(/:([a-zA-Z0-9_]+)/g, (_m, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    })
    .replace(/\*/g, () => {
      paramNames.push('wildcard');
      return '(.*)';
    });
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}
```

| 语法            | 转换结果              | 捕获内容             | 落到 `req.params` 的键                    |
| --------------- | --------------------- | -------------------- | ----------------------------------------- |
| `/students/:id` | `^/students/([^/]+)$` | 单段，不含 `/`       | `params.id`                               |
| `/assets/*`     | `^/assets/(.*)$`      | 剩余全部（可为空串） | `params.wildcard` ← **固定叫 `wildcard`** |
| `/a/:x/b/*`     | `^/a/([^/]+)/b/(.*)$` | 混合                 | `params.x`、`params.wildcard`             |

```{warning}
三条容易踩的规则：

1. **`:param` 不跨斜杠**。`/files/:path` 匹配不到 `/files/a/b`，要匹配多段必须用 `*`。
2. **通配符键名不可自定义**。`:name` 会取名字，`*` 永远只能叫 `wildcard`；写 `/x/*` 然后读
   `req.params.x` 会得到 `undefined`（静默，不报错）。
3. **锚定全匹配**（`^...$`）。`/health` 注册后，请求 `/health/`（尾部斜杠）**匹配不上** ⇒ 404。
   归一化只补前导 `/`，不裁尾随 `/`。
```

路径参数值经过 `decodeURIComponent`：

```typescript
for (let i = 0; i < entry.paramNames.length; i++) {
  params[entry.paramNames[i]] = decodeURIComponent(match[i + 1] || '');
}
```

所以 `/students/%E5%BC%A0%E4%B8%89` 里 handler 会拿到已解码的 `张三`。

---

## 4. 匹配顺序：**先注册者胜**

`match()` 是一个线性 `for` 循环，命中第一条即返回，**不比较 specificity**：

```typescript
for (const entry of this.routes) {
  if (entry.method !== upperMethod) continue;
  const match = normalized.match(entry.regex);
  if (match) { /* ... */ return { ... }; }
}
return null;
```

````{danger}
路由**没有「静态优先于通配」**这种 Express 式最优匹配。注册顺序决定一切：

```typescript
ctx.http.get('/users/*', h1);      // 先注册
ctx.http.get('/users/me', h2);     // 后注册 —— 永远不可达！
```

`/users/me` 会被 `h1` 吃掉。**必须把更具体的路径先注册。**
这也是插件里最常见的「代码没问题但接口行为不对」的原因之一，且**不会报任何错**。
````

同一 `method + pattern` 重复注册**不报错**，只是两条都在表里，第一条生效。
想重置用 `ctx.http.clear()`（通常只在测试里用）。

---

## 5. `PluginApiRequest` / `PluginApiResponse` 契约

### 5.1 请求 DTO

```typescript
interface PluginApiRequest {
  method: string; // 已大写
  path: string; // 归一化后的子路径，如 '/health'
  params: Record<string, string>; // 网关给 {}，由 router.handle() 用模板结果覆盖
  query: Record<string, string | string[]>;
  headers: Record<string, string>; // 白名单裁剪后的
  body: unknown; // Express 已解析
  ip: string;
  actor: {
    actorId: string;
    userId?: string;
    username?: string;
    role: string; // 'anonymous' | 'student' | 'teacher' | 'administrator'
    permissions?: string[];
  };
}
```

````{important}
### 只有 5 个请求头能进插件

```typescript
const ALLOWED_REQUEST_HEADERS = ['content-type', 'accept', 'user-agent', 'x-request-id', 'accept-language'];
```

`Authorization`、`Cookie` **不在其中**。所以：

- ❌ `req.headers.authorization` 恒为 `undefined` —— **不要**在插件里自己解 JWT；
- ✅ 身份一律读 `req.actor`（`role` / `userId` / `permissions` 由网关从会话解析后注入）；
- ✅ 需要追踪 ID 用 `req.headers['x-request-id']`。

这是设计如此，不是 bug。想拿原始头没有合法途径。
````

`req.params` 的**双重来源**容易混淆：网关组装 DTO 时硬写 `params: {}`，注释说明
「由 PluginHttpRouter 在内部根据路由模板动态补全」；`handle()` 里做的是

```typescript
const requestWithParams: PluginApiRequest = { ...req, params: { ...req.params, ...matched.params } };
```

即**模板参数覆盖同名键**。测试里手动塞 `params` 是可行的（会被模板结果覆盖同名项）。

### 5.2 响应：三种返回形态

`handle()` 用 `'body' in result` 判定你返回的是「响应对象」还是「裸数据」：

```typescript
if (
  rawResult !== null &&
  typeof rawResult === 'object' &&
  'body' in (rawResult as any) &&
  (typeof (rawResult as any).status === 'number' || (rawResult as any).status === undefined)
) {
  return { status: resp.status ?? 200, headers: resp.headers, body: resp.body };
}
return { status: 200, body: rawResult }; // 默认包装
```

```typescript
// 形态 1：裸数据 → 自动 200 + application/json
ctx.http.get('/health', () => ({ ok: true }));

// 形态 2：完整响应对象
ctx.http.post('/items', async (req) => ({ status: 201, headers: { 'X-Total': '1' }, body: { id: 1 } }));

// 形态 3：显式返回 undefined → status 200, body undefined → 网关发空串
ctx.http.delete('/x', () => undefined);
```

````{danger}
**形态判定的坑**：如果你的业务数据**本身就叫 `body`**，会被当成响应对象误解包。

```typescript
ctx.http.get('/raw', () => ({ body: 'hello', status: 200 }));
// ↑ 被识别成 PluginApiResponse，客户端收到的是 "hello"，不是 {"body":"hello","status":200}
```

规避：需要返回包含 `body` 键的原始数据时，显式包一层 `{ status: 200, body: yourData }` —— 这时
`yourData` 是内层的 `body` 值，键名冲突不再影响解析。

另外注意第二个条件：`{ body: x, status: 'ok' }`（status 是字符串）**不满足**判定，会被整体当裸数据返回。
````

网关侧最终落地：

```typescript
const status =
  typeof response.status === 'number' && response.status >= 100 && response.status <= 599 ? response.status : 200; // 非法 status → 静默降为 200
res.status(status).send(response.body !== undefined ? response.body : '');
```

### 5.3 内置错误响应形状

| 场景                                   | status | body                                                                           |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| 路由表无匹配                           | `404`  | `{ error: "Cannot GET /xxx" }`                                                 |
| 匹配到但是流式路由，却走普通派发       | `400`  | `{ error: "/xxx is a streaming route, please use SSE or ctx.http.stream" }`    |
| 匹配到但 `handler` 为空                | `404`  | `{ error: "Cannot GET /xxx" }`                                                 |
| 插件实例不存在且状态 ≠ ACTIVE          | `503`  | `{ error: "Plugin \"x\" is currently <state>" }`                               |
| 插件实例不存在且无状态记录             | `404`  | `{ error: "Plugin \"x\" not found or not active" }`                            |
| 插件 ACTIVE 但从未注册过任何 http 路由 | `404`  | `{ error: "Plugin \"x\" has no HTTP router registered" }`                      |
| handler 超时                           | `504`  | `{ success: false, error: "Gateway Timeout: Plugin did not respond in time" }` |

注意最后一条的**形状不同**：前 6 条是插件/派发层的 `{ error }`，网关自身的错误统一是
`{ success: false, error }`。前端做统一错误处理时要兼容两种。

---

## 6. 数据范围声明：`scope`（Issue #140）

```typescript
type PluginRouteScope = 'authenticated' | 'self' | 'class-member' | 'class-staff' | 'admin';
```

| scope           | 语义                                              | handler 仍必须做的事                                      |
| --------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `authenticated` | 任意已登录用户                                    | 只返回全局目录/元数据，**不得**含个人或班级归属数据       |
| `self`          | 仅本人数据                                        | 按 `req.actor.userId` 做归属校验                          |
| `class-member`  | 班级成员（管理员 / 班级 owner 教师 / 已选课学生） | 用 `authorizeClass(..., 'member')` 或等价逻辑校验班级归属 |
| `class-staff`   | 班级管理者                                        | 同上，角色下限更严                                        |
| `admin`         | 仅管理员                                          | 二次确认                                                  |

```typescript
ctx.http.get(
  '/attendance/:classId',
  async (req) => {
    /* ... */
  },
  { scope: 'class-member' },
);
```

```{warning}
### 迁移期：**只是告警，不拦截**

未声明 scope 时，注册当场打印：

```

[RouteScope] 插件 <pluginId> 路由 GET /attendance/:classId 未声明数据范围（迁移期仅告警）

```

**请求照常放行。** scope 目前纯粹是**声明与审计元数据**，宿主不会因为漏写而拒绝请求，
也不会因为写了 `scope:'admin'` 而替你鉴权 —— 除 `authenticated`（网关已保证登录）外，
**其余四档的对象级校验责任 100% 在 handler 里**。写 `scope: 'admin'` 但不检查
`req.actor.role === 'administrator'`，就是一个真实的越权漏洞。
```

```{note}
**别和平台侧同名机制搞混。** 仓库里有两套并行的 RouteScope：

| | 面向 | 类型 | 定义位置 |
| --- | --- | --- | --- |
| `PluginRouteScope` | **插件** `ctx.http` 注册的路由 | 5 档（无 `public`） | `packages/core/plugin-host/http-router.ts` |
| `DataScope` | **平台自己**的 `server/routes/*.ts` | 6 档（多一个 `public`） | `server/security/route-scope.ts` |

平台那套由 `requireScopedAuth(scope)` 中间件承担角色下限拦截，并在启动期
`assertRouteDataScopes(app, { enforce: process.env.ROUTE_SCOPE_ENFORCE === 'true' })` 审计。
插件开发者碰不到也无需碰它；两者告警前缀都是 `[RouteScope]`，看日志时容易误判归属。
```

自检工具：`ctx.http.getUnscopedRoutes()` 返回所有未声明 scope 的路由，适合在 `activate()`
末尾打印，或在 CI 里断言长度为 0。

---

## 7. 公开端点：`manifest.api.routes[].auth: false` **不等于**放行

````{danger}
这是本页最重要的安全语义纠正。

旧文档常写成「`auth: false` ⇒ 允许未认证访问」。**源码不是这样实现的。**

`server/routes/plugin-api-gateway.ts` 第 6.1 步：

```typescript
let publicApproved = false;
if (matchedRule?.auth === false) {
  publicApproved = isPublicRouteApproved(
    kernelContainer.db,
    [pluginId, resolvedUuid].filter(...),   // manifest.id 与 DB UUID 都作为 plugin_key 查
    matchedRule.method,
    matchedRule.path,
  );
}
const requiresAuth = !publicApproved;
if (requiresAuth && !auth.isAuthenticated) {
  res.status(401).json({ success: false, error: 'Authentication required' });
  return;
}
```

即 manifest 里的 `auth: false` 只是**申请**，还需要数据库里存在一条管理员批准记录才真正匿名可达。
````

批准记录落在表 `plugin_public_routes(plugin_key, method, path, approved_at)`，两个写入口：

1. 安装时 `approvePublicRoutes: true`（安装向导勾选「同时批准公开路由」）；
2. 运行期 `POST /api/plugins/:id/public-routes`（管理员，需登录态）。

卸载时 `clearPublicRouteApprovals` 清理。`method` / `path` **按 manifest 原样字符串比较**，
所以 `"/public-status"` 与 `"/public-status/"` 是两条不同记录。

**对插件作者的三条实际后果**：

- 你的公开端点在本地能通（可能装的时候勾了批准），在客户环境会 **401**；
- 调试「匿名访问 401」时，先查 `plugin_public_routes` 有没有对应行，别改代码；
- 交付文档里要显式写明「本插件需要管理员在安装向导批准以下公开路由：…」，否则运维会当成 bug 提给你。

（审计编号 H-4。）

---

## 8. `manifest.api` 与代码注册的关系

```json
{
  "api": {
    "routes": [
      { "method": "GET", "path": "/public-status", "auth": false },
      {
        "method": "POST",
        "path": "/submissions/:id/grade",
        "auth": true,
        "roles": ["teacher", "administrator"],
        "rateLimit": { "max": 60, "windowMs": 60000 }
      }
    ]
  }
}
```

| 字段                 | 类型     | 默认    | 作用                                               |
| -------------------- | -------- | ------- | -------------------------------------------------- |
| `method`             | string   | 必填    | `GET/POST/PUT/DELETE/PATCH`；**不支持 `ALL`**      |
| `path`               | string   | 必填    | 相对子路径，支持 `:param` 与 `*`                   |
| `auth`               | boolean  | `true`  | 见 §7，是**申请**不是许可                          |
| `roles`              | string[] | `[]`    | 角色白名单；空则仅需登录。`administrator` 恒定放行 |
| `rateLimit.max`      | number   | `120`   | 窗口内单 IP 最大请求数                             |
| `rateLimit.windowMs` | number   | `60000` | 窗口时长                                           |
| `streaming`          | boolean  | `false` | 声明该路由为 SSE；见 §9                            |
| `baseRoute`          | string   | —       | ⚠ **无任何作用**，见下                             |

```{danger}
### `api.baseRoute` 是历史遗留字段，不改变真实路径

`apiSchema` 接受 `baseRoute`，但**全仓没有任何代码按它挂载或匹配路由**。
真实路径**恒为**：

```

/api/plugins/<manifest.id>/<子路径>

```

写 `"baseRoute": "/api/exam-bank"` 之后，端点**还是** `/api/plugins/<manifest.id>/...`，
你按 `baseRoute` 拼出来的 URL 会 404，且**没有任何警告**。
（对照：`[manifest 规范](manifest.md)` 里也标注了这条。历史文档/示例里出现过 `baseRoute`，照抄就会中招。）
```

```{warning}
### `manifest.api.routes` 与 `ctx.http.get(...)` 是两件事，必须成对写

| | `manifest.api.routes` | `ctx.http.get(...)` |
| --- | --- | --- |
| 作用 | 网关**前置**鉴权/限流/RBAC 规则 + 声明 `streaming` | 真正的 handler 注册 |
| 只在 manifest 声明、代码没注册 | 网关规则空转 | 派发时 404 `has no HTTP router registered`（若无任何路由） |
| 只在代码注册、manifest 没声明 | **仍然可访问**（默认 `auth:true` + 默认限流 120/60s） | ✅ 生效 |

所以「不写 manifest 就没这个端点」是错的 —— 代码注册的路由默认就是登录可访问的受保护端点。
manifest 声明只在三种情况下**必须**写：需要 `auth:false`、需要 `roles` 白名单、需要 `streaming`。

反过来，只在 manifest 写了却没在 `activate()` 里注册 handler ⇒ 404。
```

---

## 9. 派发语义：超时、状态、隔离模式

### 9.1 签名

```typescript
dispatchHttpRequest(pluginIdOrManifestId: string, req: PluginApiRequest, timeoutMs = 5000): Promise<PluginApiResponse>
dispatchHttpStream(pluginIdOrManifestId: string, req: PluginApiRequest, stream: PluginStreamResponse, maxLifetimeMs = 300000): Promise<void>
isStreamRoute(pluginIdOrManifestId: string, method: string, path: string): boolean
```

第一个参数 **manifest.id 或 DB UUID 都可**：

```typescript
const resolvedId = this.resolvePluginUuid(pluginIdOrManifestId);
const instance = this.pluginInstances.get(resolvedId) ?? this.pluginInstances.get(pluginIdOrManifestId);
```

### 9.2 5000ms 超时（审计 R-1）

**inline 与 worker 都受约束**，但机制不同：

```typescript
// inline
return this.withInlineTimeout(
  (instance.context.http as PluginHttpRouter).handle(req),
  pluginIdOrManifestId, timeoutMs,
);

private withInlineTimeout<T>(operation: Promise<T>, pluginId: string, timeoutMs: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PluginDispatchTimeoutError(pluginId, timeoutMs)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}
```

```{important}
`Promise.race` **取消不了已经开始的执行**。注释写得很清楚：
「JS 协作式调度，没有 preemption」。超时的效果只有两个 ——
网关立刻回 504（连接不再被占死）+ 错误语义与 worker 路径一致。

**你的 handler 还在跑。** 一个 `while(true)` 的 inline handler 超时后照样把宿主主线程卡住，
504 只是给了客户端一个答复。**inline 插件里禁止同步长任务。**
真正需要后台执行请走 `ctx.services.processManager`（`spawn` / `registerInterval`，
见 [配置服务与后台任务](background-and-config.md)）。**`PluginContext` 上没有 `ctx.background`
也没有 `ctx.processes`** —— 唯一成员列表见 [PluginContext 参考](plugin-context.md)。

历史成因：修复前 inline 分支直接 `handle(req)`，网关传入的 `timeoutMs` **被静默丢弃**，
一个不 resolve 的 handler 会永久占住 Express 连接。
```

网关捕获：

```typescript
if (err.name === 'GatewayTimeoutError' || err.message?.includes('timed out')) {
  res.status(504).json({ success: false, error: 'Gateway Timeout: Plugin did not respond in time' });
}
```

> 匹配靠 `err.name === 'GatewayTimeoutError'` **或** 错误消息含 `'timed out'`。
> `PluginDispatchTimeoutError` 的 message 必须保留 `timed out` 字样，否则 504 会退化成 `sendSafeError` 的 500。
> 你若在 handler 里自己抛一个 message 含 `"timed out"` 的异常，客户端会拿到 504 而不是你的 500 —— 别用这个词。

### 9.3 五种执行模式下的 http 能力

| `executionMode` | 路由在哪跑                                                                                                      | 事务/其他限制                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `inline`        | 宿主主线程 `PluginHttpRouter` 实例                                                                              | 无沙箱；一个卡住的 handler 拖垮全平台                                                   |
| `worker`        | Worker 线程内独立 `PluginHttpRouter`，网关侧经 `serviceHost.dispatchHttpRequest(transport, req, timeoutMs)` RPC | 见 [隔离与信任边界（执行模式 / 环境 / 权限模型 / SQL 守卫）](isolation-and-security.md) |
| `process`       | 子进程                                                                                                          | 同上经 IPC                                                                              |

**插件代码不需要为模式写分支** —— `ctx.http` API 完全一致，差异只在宿主侧派发路径。
但 `ctx.db.transaction()` 只在 inline 可用（worker 会静默降级），这条差异要防（见 [数据库访问与迁移](database.md) §6）。

### 9.4 指标埋点

`dispatchHttpRequest` 是**所有**插件 REST 网关请求的唯一汇合点（Issue #150），
在外层统一计时：

```typescript
try { const response = await this.dispatchHttpRequestInner(...); recordPluginHttp(pluginIdOrManifestId, response.status ?? 200, Date.now() - startedAt); ... }
catch (error) { recordPluginHttp(pluginIdOrManifestId, 500, Date.now() - startedAt); throw error; }
```

即：**任何派发异常在指标里都记为 500**，即使网关最终对外是 504。看监控时别把这类 500 当成插件抛给客户端的状态码。

---

## 10. SSE 流式端点

### 10.1 注册

```typescript
// 重载 A：不写 method ⇒ **同时注册 GET 和 POST** 两条
ctx.http.stream('/events', async (req, stream) => { ... });

// 重载 B：指定单动词
ctx.http.stream('GET', '/events', async (req, stream) => { ... });
```

````{warning}
重载 A 会往路由表塞**两条**记录（GET + POST），源码：

```typescript
if (typeof pathOrHandler === 'function') {
  this.registerStream('GET', path, handler);
  this.registerStream('POST', path, handler);
}
```

所以 `getRegisteredRoutes()` 里同一个 pattern 出现两次是正常的，不是重复注册 bug。
EventSource 只支持 GET，但保留 POST 是为了让插件能用 body 驱动流。
````

```{danger}
`registerStream()` **不调用 `warnIfUnscoped()`**，`RouteEntry.scope` 对流式路由永远是 `undefined`。

后果：流式路由**不会**打印未声明 scope 的告警，也**不会**出现在 `getUnscopedRoutes()` 结果里
（该方法过滤 `!r.scope`，流式条目本就没 scope，会**全部**出现在列表里 —— 注意方向：
`getUnscopedRoutes()` 会把所有流式路由列为「未声明」，无法通过声明消除，因为 `stream()` 没有
`options` 参数）。

流式端点的数据范围**只能自己在 handler 里校验 `req.actor`**。别指望 scope 系统。
```

### 10.2 `PluginStreamResponse`

```typescript
interface PluginStreamResponse {
  write(data: string | Record<string, any>, event?: string, id?: string): boolean;
  end(): void;
  error(err: Error | string): void;
  readonly isClosed: boolean;
  onClose(callback: () => void): void;
}
```

网关实现的 SSE 帧格式（顺序固定：`id` → `event` → `data`）：

```typescript
write(data, event?, id?): boolean {
  if (this.isClosed) return false;
  let sse = '';
  if (id) sse += `id: ${id}\n`;
  if (event) sse += `event: ${event}\n`;
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data);
  for (const line of text.split('\n')) sse += `data: ${line}\n`;   // 多行 → 多个 data:
  sse += '\n';
  return res.write(sse);
}
```

| 方法          | 行为                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `write()`     | 已关闭返回 `false`（**不抛错**）；对象自动 `JSON.stringify`；含 `\n` 的字符串拆成多条 `data:` 行 |
| `error(err)`  | 写一帧 `event: error` + `data: {"error":"<msg>"}`，然后 `end()`                                  |
| `end()`       | 幂等；`streamEnded` 已为 true 时直接返回                                                         |
| `isClosed`    | `streamEnded \|\| res.writableEnded \|\| res.destroyed`，或 `res.socket && !res.socket.writable` |
| `onClose(cb)` | 已关闭 ⇒ **立即同步调用** `cb()`；否则加入集合，`res.on('close')` 时逐个 try/catch 调用          |

````{important}
`write()` 返回 `false` 是**唯一的客户端断开信号，且不抛异常**。
必须在循环里检查返回值并主动 break，否则你的生成循环会一直跑（浪费 CPU / 数据库连接），
直到 300s 强制上限才停：

```typescript
ctx.http.stream('/events', async (req, stream) => {
  while (!stream.isClosed) {
    const tick = await nextTick();
    if (!stream.write(tick, 'tick')) break;      // ← 返回值必须处理
    await sleep(1000);
  }
});
```

`onClose` 用来释放订阅/定时器，`isClosed` 用来退出轮询，两者都要写。
````

### 10.3 网关侧 SSE 行为

响应头（写死，插件不可改）：

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` 是给 Nginx 的禁用缓冲指令 —— 自建反代时若剥掉此头，SSE 会「看起来卡住」
（攒够缓冲区才吐），这属于部署问题，不是插件 bug。

**流并发额度**（防慢速长连接 DoS）：

| 维度   | 上限                                      | 可配             |
| ------ | ----------------------------------------- | ---------------- |
| 单 IP  | `rateLimit.maxConcurrentStreams` ?? **5** | ✅ manifest 可调 |
| 单插件 | **50**                                    | ❌ 硬编码        |

超了直接 `429` + `{ success:false, error: "Too many concurrent stream connections for this IP (max 5)" }`。

**最长存活 300000ms（5 分钟）**：`dispatchHttpStream(..., maxLifetimeMs = 300000)`。
inline 路径用 `Promise.race`，超时后 `stream.error(new PluginDispatchTimeoutError(...))`（即写一帧
`event: error` 再关闭）。**插件无法配置这个上限**，长任务不要做成一个流。

### 10.4 「是不是流式」的三级判定

网关第 9 步：

```typescript
const isStream =
  (matchedRule as any)?.streaming === true ||                     // ① manifest 声明
  pluginHost.isStreamRoute(pluginId, method, normalizedSubPath) || // ② 路由表 isStream
  (req.headers.accept?.includes('text/event-stream') && pluginHost.isStreamRoute(...)); // ③（与②重复）
```

而 `isStreamRoute()` 内部顺序：先扫 `manifest.api.routes[].streaming === true`（用
`compileRoutePattern` 匹配），再查实例路由表（inline 直接问 router；worker 用 Worker 上报的路由表）。

```{warning}
两个后果：

1. **manifest 写 `streaming: true` 而代码用 `ctx.http.get()` 注册** ⇒ 网关按 SSE 处理，
   先发 SSE 头刷出 200，然后 `handleStream()` 找不到 `streamHandler`：
   `stream.error(new Error("Cannot GET /x (Stream route not found)"))` ——
   客户端收到一个 `event: error` 帧，**HTTP 状态码是 200**。排障时别看状态码。
2. 反过来 **代码用 `ctx.http.stream()` 而 manifest 没写 `streaming`** ⇒ 正常工作
   （判定 ② 命中）。manifest 的 `streaming` 只是「让网关在插件实例还没就绪时也能判对」的提前声明，
   不是必要条件。但建议成对写，语义更清晰。
```

---

## 11. 网关纵深防御清单（8 道）

`plugin-api-gateway.ts` 文件头列了 8 条防线，按执行顺序：

| #   | 防线            | 具体实现                                                                                                                                                  | 触发响应                                                             |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | 命名空间隔离    | 只拦 `/api/plugins/:pluginId/*`                                                                                                                           | 其他路径不进网关                                                     |
| 2   | 保留端点避让    | `RESERVED_ACTIONS = {config, toggle, contributions, check-update, one-click-update, public-routes}`，**子路径恰好单段且全等**时 `next()` 交给平台核心路由 | ⚠ 见下                                                               |
| 3   | 路径遍历防御    | `rawSubPath.includes('..')` 或 `toLowerCase().includes('%2e%2e')`；再 `path.posix.normalize('/'+raw)` 后仍含 `..`                                         | `400 Path traversal attempt detected`                                |
| 4   | 插件合法性/状态 | `resolvePluginUuid` + `getPluginManifest`                                                                                                                 | 见 §5.3                                                              |
| 5   | Payload 硬限制  | `MAX_PAYLOAD_BYTES = 1024*1024`，只看 `content-length` 头                                                                                                 | `413 Payload too large. Maximum allowed size is 1024KB`              |
| 6   | 认证与 RBAC     | `resolveAuthContext()` + §7 公开路由批准 + `roles` 白名单                                                                                                 | `401 Authentication required` / `403 Forbidden. Required roles: ...` |
| 7   | 限流            | 键 `ip:pluginUuid:METHOD:path`，窗口默认 60s / 120 次                                                                                                     | `429` + `Retry-After: <秒>`                                          |
| 8   | 响应头清洗      | 见下表                                                                                                                                                    | 静默丢弃                                                             |

````{danger}
### 坑 2：`config` / `toggle` / ... 是**平台保留字**

单段子路径恰好命中 `RESERVED_ACTIONS` 时，请求**不会进插件**，被 `next()` 转交平台路由。

```typescript
ctx.http.get('/config', handler);   // ← 你的 handler 永远收不到 GET /api/plugins/<id>/config
```

平台确有 `GET /api/plugins/:id/config`。同理 `/toggle`、`/contributions`、`/check-update`、
`/one-click-update`、`/public-routes` 五个词在**单段**形态下不可用作插件子路径。

规避：加前缀 —— `/settings`、`/plugin-config`、`/x/config`（多段不触发避让）。
**这类失效不产生任何错误**，是本页最难发现的一条。
````

```{warning}
### 坑 5：413 依赖 `content-length` 头

检查是 `parseInt(req.headers['content-length'] || '0', 10)`。
**分块传输（`Transfer-Encoding: chunked`）没有 content-length**，`|| '0'` 让这道检查直接放行。
实际兜底落在 Express body parser 自己的 limit 上。不要指望 1MB 这条一定按 manifest 语义生效。
```

### 响应头危险黑名单（8 项，静默剥离）

```typescript
const FORBIDDEN_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'content-security-policy',
  'x-frame-options',
  'transfer-encoding',
  'connection',
  'host',
]);
```

大小写不敏感（`k.toLowerCase()`）。插件想自管 CORS 或种 Cookie —— **做不到，且不报错**，
只是头不见了。跨域请让前端走同源 `/api/plugins/...`。

### 请求头白名单（5 项）

`content-type`、`accept`、`user-agent`、`x-request-id`、`accept-language`。

---

## 12. `sessionToken`：SSO 会话桥（唯一能设 Cookie 的通道）

普通 `Set-Cookie` 被剥离，但存在一条**受控**例外：

```typescript
if (
  allowsSessionBridge &&
  response.sessionToken &&
  typeof response.sessionToken === 'string' &&
  response.sessionToken.startsWith('token_')
) {
  res.setHeader(
    'Set-Cookie',
    `edu_os_token=${response.sessionToken}; Path=/; HttpOnly; ${sameSite}; Max-Age=604800${secureFlag}`,
  );
} else if (response.sessionToken && !allowsSessionBridge) {
  console.warn(
    `[PluginApiGateway:SECURITY] Plugin '${pluginId}' attempted to return sessionToken without declaring IAuthSessionBridgeService in manifest.requires. Cookie rejected.`,
  );
}
```

四个条件**全部**满足才会写 Cookie：

1. **manifest `requires` 声明了会话桥**，且判定方式是「去掉版本后缀后 Token 名**全等**」：

   ```typescript
   const expected = IAuthSessionBridgeToken.name; // '@openlearn/core:IAuthSessionBridgeService'
   return requires.some((entry) => typeof entry === 'string' && parseRequiresEntry(entry).tokenName === expected);
   ```

   ```{warning}
   注释点名了原因：**子串匹配会放行 `NotReallyIAuthSessionBridgeServiceX` 这类仿冒声明**。
   所以 `"@openlearn/core:IAuthSessionBridgeService"` 必须**逐字符精确**（不含多余前后缀、
   大小写敏感）。解析复用 `parseRequiresEntry`：第一个 `@` 是 scope，`/` 之后的第二个 `@`
   才是版本范围起点 —— 与 [manifest 规范](manifest.md) 的 `requires` 语法一致。
   ```

2. 响应里有 `sessionToken` 且是 `string`；
3. 以 **`token_`** 开头（不满足则**静默**忽略）；
4. 走的是**非流式** REST 派发（`dispatchHttpRequest` 分支内）。

Cookie 属性固定：`Path=/; HttpOnly; Max-Age=604800`（7 天）；
`SameSite=None; Secure`（当 `req.secure` 或 `x-forwarded-proto==='https'` 或
（`NODE_ENV==='production'` 且 `ENABLE_HTTPS==='true'`）），否则 `SameSite=Lax`。

> 典型用途：LTI / 外部工具对接，插件后端换到一个短期令牌后希望浏览器带上平台会话。
> 这是特权能力，需要 `requires` 显式声明 —— 声明本身也是给运维看的信号。

---

## 13. 多段 `manifest.id` 与 URL 编码（审计 F-2）

`manifest.id` **没有格式约束**（`manifest-schema.ts` 的 `id` 只要求非空字符串），
社区市场的 `PLUGIN_ID_PATTERN` 明确允许 `/` 与 `@` ⇒ `@scope/name` 形式的 id 合法且可安装。

而网关路由 `app.all('/api/plugins/:pluginId/*')` 的 `:pluginId` 是**单段**参数：
对 `/api/plugins/@scope/name/health`，Express 切出 `pluginId='@scope'`、`subPath='name/health'`
⇒ 解析不到插件 ⇒ 这类插件的 REST 端点**全部不可达**。

修复：`resolveScopedPluginId()` 用**完整路径**匹配**最长**的已安装 manifest.id 前缀
（取最长是因为一个 id 可能是另一个的前缀，短匹配会把归属判错）：

```typescript
export function resolveScopedPluginId(pluginHost, fullPath) {
  const normalized = fullPath.replace(/^\/+/g, '').replace(/\/+$/g, '');
  let best = null;
  for (const id of pluginHost.listInstalledPluginIds()) {
    if (normalized === id || normalized.startsWith(`${id}/`)) {
      if (best === null || id.length > best.length) best = id;
    }
  }
  if (!best) return null;
  return { manifestId: best, subPath: normalized === best ? '' : normalized.slice(best.length + 1) };
}
```

只在单段解析失败时才走（fast path 不受影响）；命中后**鉴权规则匹配、限流键、派发全部基于修正值**。

**给插件作者的建议**：

- 前端调用**优先 `encodeURIComponent(manifest.id)`**（`%40scope%2Fname`），未编码形态靠 F-2 兜底；
- 新插件 id **避免用 `@scope/name`** —— `^[a-z][a-z0-9-]*$` 更省事（见 [快速开始](agent-quickstart.md) 的插件名规则）；
- 排查「插件装好了但所有 REST 都 404」时，先确认 id 是否含 `/`。

---

## 14. 完整可运行示例

```typescript
import type { Manifest } from '@openlearn/plugin-sdk';

export const manifest: Manifest = {
  id: 'grade-export',
  name: '成绩导出',
  version: '1.0.0',
  api: {
    routes: [
      { method: 'GET', path: '/health' },
      {
        method: 'GET',
        path: '/report/:classId',
        roles: ['teacher', 'administrator'],
        rateLimit: { max: 30, windowMs: 60000 },
      },
      { method: 'POST', path: '/stream-report' },
      { method: 'GET', path: '/public-status', auth: false }, // 仍需管理员批准，见 §7
    ],
  },
};

export default {
  async activate(ctx) {
    // 1. 裸数据 → 自动 200
    ctx.http.get('/health', () => ({ ok: true, at: Date.now() }));

    // 2. 带 scope + 自行做对象级校验（scope 不会替你鉴权）
    ctx.http.get<{ limit?: string }, unknown>(
      '/report/:classId',
      async (req) => {
        if (req.actor.role !== 'administrator' && req.actor.role !== 'teacher') {
          return { status: 403, body: { error: 'teacher only' } };
        }
        const rows = await ctx.services.commandBus.execute({
          type: 'grade:read',
          payload: { classId: req.params.classId },
        });
        return { status: 200, headers: { 'X-Row-Count': String(rows.length) }, body: rows };
      },
      { scope: 'class-staff' },
    );

    // 3. 流式：必须处理 write() 返回值 + onClose
    ctx.http.stream('/stream-report', async (req, stream) => {
      const abort = new AbortController();
      stream.onClose(() => abort.abort());
      for (let page = 0; page < 100 && !stream.isClosed; page++) {
        const chunk = await fetchPage(page, abort.signal);
        if (!stream.write(chunk, 'page', String(page))) break;
      }
      stream.end();
    });

    // 4. CI 自检：把保留字与未声明 scope 的路径一次性暴露出来
    const RESERVED = ['config', 'toggle', 'contributions', 'check-update', 'one-click-update', 'public-routes'];
    const hit = ctx.http
      .getRegisteredRoutes()
      .filter((r) => r.pattern.split('/').filter(Boolean).length === 1 && RESERVED.includes(r.pattern.slice(1)));
    if (hit.length) ctx.log.error('保留了字，路由不可达：', hit);
    const unscoped = ctx.http.getUnscopedRoutes();
    if (unscoped.length) ctx.log.warn('未声明 scope：', unscoped);
  },
};
```

前端调用：

```typescript
const res = await fetch(`/api/plugins/${encodeURIComponent('grade-export')}/report/cls_1`, {
  credentials: 'include',
  headers: { 'x-request-id': crypto.randomUUID() },
});
const data = await res.json();
```

---

## 15. 交付自检清单

- [ ] 路径**不含** 6 个保留字（单段形态）：`config` / `toggle` / `contributions` / `check-update` / `one-click-update` / `public-routes`
- [ ] 更具体的路由**注册在前**（先注册者胜，不比较 specificity）
- [ ] 通配符读的是 `req.params.wildcard`，不是自己起的名字
- [ ] 模板参数不跨 `/`；需要多段用 `*`
- [ ] 不依赖尾部斜杠兼容（`/x` 注册后 `/x/` 是 404）
- [ ] 身份只读 `req.actor`，**没有**尝试读 `Authorization` / `Cookie`
- [ ] 每条非流式路由都声明了 `scope`，且 handler 内**自己做了**对象级校验
- [ ] `auth: false` 的端点：交付文档写明需管理员批准 `plugin_public_routes`
- [ ] **没有**使用 `api.baseRoute`（无作用）
- [ ] 返回对象若含 `body` 键，显式包 `{ status, body }`
- [ ] SSE：检查 `write()` 返回值、注册 `onClose`、单流时长 < 5 分钟
- [ ] SSE 的 scope 自行校验（`stream()` 无 `options` 参数）
- [ ] manifest `streaming` 与 `ctx.http.stream()` 成对写
- [ ] handler 内无同步长任务（504 不取消执行，只释放连接）
- [ ] 抛错 message **不含** `"timed out"`（会被误判成 504）
- [ ] 不试图设置 `Set-Cookie` / CORS / CSP 头（会被静默剥离）
- [ ] 需要 SSO 会话桥时，`requires` 里逐字符精确写 `@openlearn/core:IAuthSessionBridgeService`
- [ ] 插件 id 尽量不含 `/`；若含，前端调用一律 `encodeURIComponent`

---

## 16. 取证

| 论断                                                          | 源码位置                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 网关挂载 `/api/plugins/:pluginId/*` 与 8 道防线列表           | `server/routes/plugin-api-gateway.ts` 文件头注释 `@module`                                       |
| `RESERVED_ACTIONS` 6 项与 `next()` 避让                       | 同上，中间件第 1 步                                                                              |
| `FORBIDDEN_RESPONSE_HEADERS` 10 项                            | 同上                                                                                             |
| `ALLOWED_REQUEST_HEADERS` 5 项                                | 同上，第 8 步                                                                                    |
| `MAX_PAYLOAD_BYTES = 1024*1024`、413 文案                     | 同上，第 4 步                                                                                    |
| 路径遍历两道检查与 400 文案                                   | 同上，第 3 步                                                                                    |
| `auth:false` 需 `isPublicRouteApproved`                       | 同上，第 6.1 步；`packages/core/plugin-host/public-routes.ts`                                    |
| `roles` 白名单与 `administrator` 恒定放行                     | 同上，第 6.2 步                                                                                  |
| 限流键 `ip:uuid:METHOD:path`、默认 120/60s、`Retry-After`     | 同上，第 7 步；`PluginRateLimiter.consume`                                                       |
| `PluginApiRequest` DTO 组装（`params: {}` + 注释）            | 同上，第 8 步                                                                                    |
| SSE 响应头、`X-Accel-Buffering: no`                           | 同上，第 9.2 步                                                                                  |
| `write/end/error/isClosed/onClose` 实现                       | 同上，`streamResponse` 字面量                                                                    |
| 流并发 maxIp ?? 5 / maxPlugin 50                              | 同上，第 9.1 步 + `StreamConnectionTracker.tryAcquire`                                           |
| 504 判定（`GatewayTimeoutError` 或含 `timed out`）            | 同上，第 10 步 catch                                                                             |
| `sessionToken` → `edu_os_token` Cookie 四条件                 | 同上，第 10 步                                                                                   |
| `manifestDeclaresAuthSessionBridge` 全等而非子串              | 同上，函数 + 注释                                                                                |
| `resolveScopedPluginId` 最长前缀与 F-2 成因                   | 同上，函数 + 注释                                                                                |
| `PluginRouteScope` 5 档定义与语义                             | `packages/core/plugin-host/http-router.ts`；`server/security/route-scope.ts` 的 `DataScope` 注释 |
| `warnIfUnscoped` 告警原文                                     | `http-router.ts`                                                                                 |
| `compileRoutePattern` 全文                                    | `http-router.ts`                                                                                 |
| `get/post/put/patch/delete/route`，无 `del`/`all`             | `http-router.ts` 类方法列表                                                                      |
| `stream()` 双注册重载                                         | `http-router.ts` `stream` 实现                                                                   |
| `registerStream` 不调 `warnIfUnscoped`                        | `http-router.ts` `registerStream` 与 `route` 对比                                                |
| `match()` 先注册者胜                                          | `http-router.ts` `match` 的 `for` + `return`                                                     |
| `handle()` 404/400/自动 200 与 `'body' in` 判定               | `http-router.ts` `handle`                                                                        |
| `handleStream()` 路由缺失文案                                 | `http-router.ts` `handleStream`                                                                  |
| `getRegisteredRoutes`/`getUnscopedRoutes`/`clear`             | `http-router.ts`                                                                                 |
| `dispatchHttpRequest` 5000ms 默认值与 503/404 三态            | `packages/core/plugin-host/http.ts`                                                              |
| `withInlineTimeout` 与 R-1 注释（不取消执行）                 | `http.ts` `withInlineTimeout`                                                                    |
| `dispatchHttpStream` 300000ms 默认值                          | `http.ts`                                                                                        |
| `isStreamRoute` 三级顺序（manifest → inline → worker 上报表） | `http.ts`                                                                                        |
| `recordPluginHttp` 异常记 500（Issue #150）                   | `http.ts` `dispatchHttpRequest`                                                                  |
| `api.routes` 字段表与「不支持 ALL」                           | `docs_plugin_guide` §api（`repomix-output.xml` L21206–L21241）                                   |
| `baseRoute` 无作用、真实路径恒定                              | `[manifest 规范](manifest.md)` §api；网关未引用 `baseRoute`                                      |
| `PluginState` 503 文案                                        | `http.ts` + `packages/core/plugin-host/types.ts`                                                 |
