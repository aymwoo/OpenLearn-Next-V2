# 前端沙箱（iframe / postMessage 桥 / 可视视图）

> **权威源码**：`server/utils/plugin-sandbox-frame.ts`、`server/utils/plugin-view-bridge.ts`、
> `server.ts`（`app.get('/plugin-sandbox/frame')`）、`src/plugin-host/plugin-host.ts`、
> `src/plugin-host/sandbox-frame.ts`、`src/components/PluginSandboxIframeView.tsx`、
> `src/plugin-host/{plugin-host-store,extension-breaker,extension-point-renderer,host-action-dispatcher,browser-worker-manager}.ts`

---

## 0. 先分清两个沙箱

ZIP 插件的前端**同时只可能有一个是「你的代码在跑」**，但很多教程把它们混为一谈：

|                | **逻辑沙箱**（frame 通道）                                    | **可视沙箱**（view 通道）                                     |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| 承载内容       | 你的 `frontend.js` 模块                                       | manifest `contributes[*].view` 指向的 `x.html`                |
| iframe `src`   | `/plugin-sandbox/frame`（全站同一份静态 HTML）                | `/plugins/<pluginId>/<view 相对路径>`                         |
| `sandbox` 属性 | `allow-scripts`（**没有** `allow-forms` / `allow-downloads`） | `allow-scripts allow-forms allow-downloads`                   |
| 可见性         | `display: none`，永远不可见                                   | 可见，尺寸由插件自己上报                                      |
| 有无网络       | ❌ CSP `connect-src 'none'`                                   | ✅ CSP `connect-src 'self' blob: data: https:`                |
| 有无 DOM       | 有**自己的** document，但拿不到宿主 DOM                       | 有，完整的自己的 document                                     |
| 通道常量       | `PLUGIN_FRAME_CHANNEL = 'ol-plugin-frame'`                    | `PLUGIN_VIEW_CHANNEL = 'ol-plugin-view'`                      |
| 允许的 op 数   | **10**                                                        | **8**                                                         |
| 推送方向       | 宿主只发 `load` / `reply` / `deactivate`                      | 宿主发 `init` / `context-update` / `reply`，插件可发 `resize` |

```{danger}
### 「逻辑沙箱里不能显示任何东西」是硬结论，不是配置问题

`server/utils/plugin-sandbox-frame.ts` 的头注释原文：

> `sandbox` 只有 `allow-scripts`，没有 `allow-same-origin`，因此文档源是 **opaque origin**。
> 它不能带上宿主 cookie，也不能读父页面 DOM。插件源码由父页面经 postMessage 送入，
> 再在 iframe 里用 blob URL import。本页 CSP 禁止 connect，iframe 自己不能发请求。

`docs/plugin/plugin-security-migration.md` 补了一句：iframe 是**不透明源**且**隐藏**
（`display: none`）：插件代码不能访问宿主 DOM，也**不能渲染任何用户可见内容**。
可见 UI 只能来自 manifest 声明式贡献，由宿主用自己的 React 渲染。

所以「在 `activate()` 里 `document.body.appendChild(...)`」「用 `ctx.ui.showToast`
之外的方式弹自定义界面」这两类写法在第三方插件上**永远不会生效** ——
它们操作的是那个不可见的 opaque-origin 文档，用户看不见。
```

---

## 1. 帧文档与 CSP

### 1.1 路由

```typescript
app.get('/plugin-sandbox/frame', (req, res) => {
  const token = getCookieToken(req);
  const session = token ? getValidSession(token) : null;
  if (!session) return res.status(401).type('text/plain').send('Authentication required');
  res.setHeader('Content-Security-Policy', '<见下>');
  return res.type('html').send(PLUGIN_SANDBOX_FRAME_HTML);
});
```

- 路由**不带 pluginId、不带资源路径**：所有插件共用同一份 HTML，
  身份与源码都在之后经 `postMessage` 的 `load` 消息注入；
- 逐字 CSP：

```
default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; style-src 'none'; img-src 'none'; frame-ancestors 'self'
```

```{warning}
`style-src 'none'` 与 `img-src 'none'` 意味着逻辑沙箱里
**注入 `<style>`、`<img src>` 都会被浏览器拦掉**（无报错，元素存在但不生效）。
`script-src` 允许 `blob:` 只是为了让加载器 `import()` 插件自己的模块，
不构成任何对外能力。

其他响应头由全局 helmet 决定：`xFrameOptions: { action: 'sameorigin' }`、
`crossOriginOpenerPolicy: false`（**平台全局就不发 COOP 头**，不只是这个路由）、
`crossOriginResourcePolicy: { policy: 'cross-origin' }`，
后者的注释原文：`// 允许沙箱 iframe（opaque origin）加载静态资源`。
```

### 1.2 加载器契约（帧内脚本）

```typescript
const blob = new Blob([data.source], { type: 'text/javascript' });
const url = URL.createObjectURL(blob);
try {
  mod = await import(url);
} finally {
  URL.revokeObjectURL(url);
}
if (typeof plugin.activate !== 'function') throw new Error('missing activate function');
// 激活竞速：setTimeout(..., 5000) → new Error('Activation timeout (5000ms)')
```

```{important}
`missing activate function` 与 `Activation timeout (5000ms)` 是**帧内**抛出的，
经 `reply`/`activate-error` 回传宿主。
`ACTIVATION_TIMEOUT_MS = 5000` / `DEACTIVATION_TIMEOUT_MS = 5000` 是共享常量，
不是各自魔法数。宿主侧另有同值的 `window.setTimeout(..., 5000)` 兜底。
```

### 1.3 二次导航熔断

```typescript
let loadCount = 0;
// ...
if (loadCount > 1) {
  console.error(`[PluginSandbox] Plugin "${pluginId}" attempted unauthorized navigation. Destroying sandbox.`);
  // destroySandboxFrame + updatePluginState(pluginId, PluginState.ERROR)
}
```

```{danger}
### 变更日志里提到的防护**并不存在于代码**

changelog 声称有 `location.replace` / `location.assign` / `window.open` 拦截钩子
外加 crash-probe 心跳。在 `server/utils/plugin-sandbox-frame.ts` 与
`src/plugin-host/plugin-host.ts` 里 grep 这三者与 heartbeat：**not found**。
实际落地的只有上面这一条 `loadCount > 1` 保险丝。

写插件时不要以为「平台会替我拦住弹窗」；
读日志时不要去找那条不存在的心跳告警。
```

### 1.4 三个不同的 CSP，别当成一个

| 场景                           | 路径                                                                  | CSP 关键差异                                                                                      |
| ------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 逻辑沙箱页                     | `/plugin-sandbox/frame`                                               | `default-src 'none'`，**无** `sandbox` 指令（靠 iframe 属性）                                     |
| 插件自带 HTML 视图             | `/plugins/<id>/**`（`view`）                                          | 见 §5.1，**含 `unsafe-eval`**，`connect-src` 放开到 `https:`                                      |
| 服务端插件声明的 `staticRoute` | `createPluginStaticMiddleware`（`packages/core/plugin-host/base.ts`） | 含 CSP `sandbox allow-scripts allow-forms allow-downloads; ...`，**注释明写「移除 unsafe-eval」** |

```{note}
第三条有测试守着：`server/__tests__/sprint1_security.test.ts` 的
`C-3: packages/core/plugin-host 静态沙箱中间件 CSP 中不包含 unsafe-eval`
直接读源码文本做正则匹配断言。
也就是说 `/plugins/*`（view）带 `unsafe-eval` 是**已知且未收敛**的差异，
不是笔误 —— 别把两套 CSP 互相「 corrections」。
```

---

## 2. opaque origin 的实际后果

| 你以为能用                                            | 实际                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `document`                                            | ✅ 有（自己的文档），`<!doctype html>...<body>` 完整                          |
| `window.parent` / 宿主 DOM                            | ❌ 读不到                                                                     |
| `window.HostSharedDeps`                               | ❌ `undefined`（realm 独立）                                                  |
| `fetch` / `XMLHttpRequest` / `WebSocket`              | ❌ CSP `connect-src 'none'`                                                   |
| `localStorage` / `sessionStorage` / `document.cookie` | ❌ opaque origin 下访问即抛 `SecurityError`；平台没有为插件沙箱做 cookie mock |
| 内联 `<style>` / `<img>`                              | ❌ `style-src 'none'` / `img-src 'none'`                                      |
| `<form>` 提交、下载                                   | ❌ 帧的 `sandbox` 无 `allow-forms` / `allow-downloads`                        |

```{warning}
`HostSharedDeps` 缺失会被宿主翻译成一句人话：
`'插件依赖缺失：宿主未提供共享运行时（React 等）'`（`describeActivationError`）。
看到这句话的含义是：**你在 sandbox 里 import 了 react**，
而不是宿主漏注入了 —— 前端共享模块只在 inline 路径可用，见 §9。
```

`plugin-host.ts` 自己也假定有 DOM：
`if (typeof document === 'undefined') throw new Error(\`Cannot sandbox plugin "${pluginId}" outside a browser document\`)`
—— 所以沙箱逻辑**无法在 Node/测试环境直接跑**，测试要 jsdom。

---

## 3. frame 通道协议

### 3.1 消息形状

```typescript
// 插件 → 宿主
{ channel: 'ol-plugin-frame', type: 'call', callId, op, args }
// callId = Math.random().toString(16).slice(2)

// 宿主 → 插件
{ channel: 'ol-plugin-frame', type: 'reply', callId, ok, value, error }
// 插件侧：if (!ok) reject(new Error(data.error || 'bridge call failed'))

// 宿主 → 插件（生命周期）：type: 'load' | 'deactivate'
// 插件 → 宿主（生命周期）：type: 'ready' | 'activated' | 'activate-error' | 'deactivated'
```

````{danger}
### host → frame 一律 `targetOrigin: '*'`，安全靠 `event.source`

帧内：`let targetOrigin = '*'; ... parent.postMessage({...msg}, targetOrigin)`；
收到 `load` 后才收紧：
`targetOrigin = event.origin && event.origin !== 'null' ? event.origin : '*'`。

宿主侧：`frame.contentWindow?.postMessage({...}, '*')` —— **永远是 `'*'`**。

真正的收束在**入站校验用 `event.source` 而非 origin**：

```typescript
// 帧内
if (!data || data.channel !== CHANNEL || event.source !== parent) return;
// 宿主
if (event.source !== frame.contentWindow || !isPluginFrameMessage(event.data)) return;
```

`isPluginFrameMessage` 的判据只有**一条**：`data.channel === 'ol-plugin-frame'`。
宿主侧还有一道门：`if (data.type !== 'call' || !data.callId || !data.op) return;`
—— 缺字段的消息被**静默丢弃**，不报错。
````

### 3.2 10 个 op 全表

判定是 if/else 链，**没有 allow-list 数组**；兜底：
`throw new Error(\`Unsupported sandbox bridge op "${op}"\`)`。

| op                                               | 宿主实现                                                                                                                                                     | 备注                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `api.get` / `api.post` / `api.del`               | 先 `checkMethodPolicy(FRONTEND_API_TOKEN, op.slice(4), args, ctx.caps)`，拒绝即 `throw new Error(denied)`；再走父页面 `fetch`（`credentials:'same-origin'`） | **返回整个 `{success, result, error}` 信封**，不拆包 |
| `storage.get` / `storage.set` / `storage.delete` | key 拼成 `` `${ctx.manifest.id}:${String(args[0])}` `` 后交给宿主 `IStorageService`                                                                          | 落父页面 localStorage，见 §6                         |
| `command.invoke`                                 | `ctx.frontendApi.post('/api/plugins/<pluginId>/sandbox-command', {type, payload})`                                                                           | 见 §7                                                |
| `ui.register`                                    | `registerExtensionPoint(slot, {...config, pluginId, origin:'runtime'})`                                                                                      | **只能注册数据型配置**，见 §8                        |
| `ui.toast`                                       | `ctx.uiService?.showToast(message, message, 'info')`                                                                                                         | 标题与正文**是同一个字符串**，type 硬编码 `'info'`   |
| `context.get`                                    | `{ lessonId: state.selectedLesson, classId: state.liveClassSelectedClassId }`                                                                                | 快照，**不推送变化**                                 |

```{important}
`api.*` 走的是**父页面**的 fetch，带着宿主的完整会话 Cookie。
这就是为什么 Barrier 3（方法级策略）在这条路径上必须生效 ——
沙箱内的代码没有任何网络能力，一旦允许它自己 fetch，
就等于把「任意的、带管理员会话的」请求交给了第三方代码。

注意 `method = op.slice(4)`：`'api.get'.slice(4) === 'get'`，
因此传给策略的是裸动词。`isReadOnlyMethod` 认为 `get` / `get*` 只读，
非只读需要 `api:write`，高危路径需要 `api:admin`。
```

### 3.3 沙箱内 `ctx` 的确切成员

帧内 `makeCtx(pluginId, manifest)` 构造的对象直接传给 `activate(ctx)`，
**不挂任何全局**（没有 `window.OpenLearn`，也没有 `window.__ol` —— 二者都不存在）：

| 插件侧写法                                    | 映射 op                                          |
| --------------------------------------------- | ------------------------------------------------ |
| `ctx.pluginId` / `ctx.manifest`               | —                                                |
| `ctx.services.frontendApi.get/post/del`       | `api.get` / `api.post` / `api.del`               |
| `ctx.services.storageService.get/set/delete`  | `storage.get` / `storage.set` / `storage.delete` |
| `ctx.ui.registerExtensionPoint(slot, config)` | `ui.register`                                    |
| `ctx.ui.showToast(message)`                   | `ui.toast`                                       |
| `ctx.invokeCommand(type, payload)`            | `command.invoke`                                 |
| `ctx.context.get()`                           | `context.get`                                    |

```{danger}
### 沙箱 ctx 里**没有** `socketService`、没有 `uiService.showModal`、没有 `navigation`、没有 `dispatcher`、没有 `i18n`

`docs/tutorials/plugin-frontend-guide.md` 原文一句：
> 沙箱**没有** `socketService`、`uiService.showModal`、`navigation`。

这与 inline 前端插件的 `FrontendPluginContext`（见本页 §10 的对照）**是两套 API**。
按 inline 的写法移植到 ZIP 插件，得到的是
`Cannot read properties of undefined (reading 'emit')` 之类的运行时错误，
而不是激活失败。
```

---

## 4. 只有轮询，没有推送

````{important}
`src/plugin-host/plugin-host.ts`、`server/utils/plugin-sandbox-frame.ts`、
`server/utils/plugin-view-bridge.ts`、`src/components/PluginSandboxIframeView.tsx`
里 **`setInterval` 出现 0 次**。所有定时器都是 `setTimeout(..., 5000)` 超时兜底。

宿主发给帧的消息只有三种：`load` / `reply` / `deactivate`。
**没有事件推送通道。**

官方边界文档的原话（`docs/plugin/frontend-sandbox-capability-boundary.md` §3.2.1
「网络与实时性：iframe 内没有网络，实时性只能轮询」）：

> **因此「实时同步」只能轮询**（建议 2–5 秒，按命令成本权衡）
>
> ```js
> const timer = setInterval(tick, 3000);
> // activate 的返回值不会被沙箱回收，定时器必须在 deactivate() 里清掉
> ```
>
> 请先在架构上接受「轮询 + 宿主代发」这一前提，而不是事后把它当 bug 排查。
````

```{warning}
`activate` 的**返回值不会被沙箱回收**，`ResourceTracker` 也管不到 iframe 里的定时器。
唯一正确写法是把它挂到 `ctx` 上并在 `deactivate()` 里 `clearInterval`。
忘了清 = 插件停用后仍在每 3 秒打一次 `command.invoke`，
而宿主侧看不出来（`processes` 表里没有它，审计里也没有它）。
```

view 通道是例外：宿主**会**推 `context-update`（课堂/班级/语言/主题变动），
插件**可以**推 `resize`。这是整套沙箱里仅有的两处真实双向推送。

---

## 5. 可视沙箱（`contributes[*].view`）

### 5.1 服务端

`/plugins` 静态挂载（`server.ts`）：

```typescript
const dest = req.headers['sec-fetch-dest'];
const site = req.headers['sec-fetch-site'];
if (site === 'same-origin' || (typeof dest === 'string' && dest !== '' && dest !== 'document')) return next();
// else 401 { error: 'Authentication required' }
express.static(root, {
  index: false,
  dotfiles: 'ignore',
  fallthrough: false,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.htm'))
      res.setHeader('Content-Security-Policy', PLUGIN_VIEW_CSP);
  },
});
```

逐字 `PLUGIN_VIEW_CSP`：

```
sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'self'; default-src 'self' 'unsafe-inline' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' data: blob: https:; style-src-attr 'unsafe-inline'; connect-src 'self' blob: data: https:;
```

```{warning}
三个反直觉点：

1. **认证接受三种凭证**：cookie、`req.query.token`、`Bearer` 头。
   iframe 的文档请求带 cookie 即可；但 `sec-fetch-dest` 逃逸意味着
   **子资源请求（`dest` 为 `script`/`style`/`image` 等）直接放行**，不查会话。
2. `index: false` + `fallthrough: false`：目录访问与缺失文件都是 404，不回落 SPA。
3. **`/plugins` 路径上没有 `isPathInsideRoot` / `safeJoin` 调用** ——
   `server/utils/path-guard.ts` 的两个守卫与 `install-utils.ts` 的 `isInsideRoot`
   都没用在这里。目录穿越防线在**浏览器侧**（§5.2）。
```

另外注意 `express.json({ limit: '2mb' })` 是全局 body 上限，
`OPENLEARN_MAX_ZIP_SIZE` 默认 `300 * 1024 * 1024` 是 ZIP 上限；
**沙箱路径上没有任何 HTML/JS 资源体积上限** —— `frontend.js` 是
`await res.text()` 全量读入，无截断。

### 5.2 客户端 `sanitizeViewPath`

```typescript
export function sanitizeViewPath(rawView: string): string | null;
```

拒绝：含 `://`、以 `//` 开头、以 `\` 开头、含 `..`、匹配 `/^(javascript|data|blob):/i`、空串。
通过则去掉前导斜杠（`'/views/sub/page.html'` → `'views/sub/page.html'`）。
拒绝时界面显示 **`'非法的插件视图路径'`** / `'Invalid Plugin View Path'`。

iframe 实际 src：`` `/plugins/${encodeURIComponent(pluginId)}/${cleanView}` ``，
属性 `sandbox="allow-scripts allow-forms allow-downloads"`、`referrerPolicy="no-referrer"`。

### 5.3 桥脚本 `OpenLearnPluginBridge`

服务端模板字符串 `PLUGIN_VIEW_BRIDGE_JS`，经
`GET /plugin-sandbox/view-bridge.js`（`Cache-Control: public, max-age=3600`）分发。
你的 `x.html` 里要自己写 `<script src="/plugin-sandbox/view-bridge.js"></script>`。

**SDK 里没有这个桥**（`packages/plugin-sdk/` 无 bridge 模块，
scaffold 模板里也没有任何 `.html` 视图文件、没有那行 `<script src>`）——
这是文档最容易缺的一块：模板不教你怎么连桥。

| `window.OpenLearnPluginBridge` 成员 | 映射                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `onInit(cb)`                        | 宿主 `init` 回调；若已有上下文**立即触发**                        |
| `onContextUpdate(cb)`               | 宿主 `context-update` 回调                                        |
| `getContext()`                      | 返回缓存的上下文，**不发桥调用**                                  |
| `ui.toast(message, type)`           | op `ui.toast`                                                     |
| `ui.showToast(message, type)`       | 同上的别名                                                        |
| `ui.resize(height)`                 | **不是 op**：`post({type:'resize', height: Number(height) \| 0})` |
| `invokeCommand(type, payload)`      | op `command.invoke`                                               |
| `api.get/post/del(path[, body])`    | op `api.get` / `api.post` / `api.del`                             |
| `storage.get/set/delete(key)`       | op `storage.*`                                                    |
| `CHANNEL`                           | `'ol-plugin-view'`                                                |

宿主侧允许的 8 个 op 与两处语义差异：

```{danger}
### view 通道的 op 语义与 frame 通道**不一致**

| 项 | frame（`allow-scripts` 隐藏帧） | view（可见 HTML） |
| --- | --- | --- |
| 未登记 op | `Unsupported sandbox bridge op "<op>"` | `Unsupported op "<op>"` |
| `api.*` 路径 | 原样透传 | 若不以 `api/plugins/` 开头，**自动前缀** `/api/plugins/<pluginId>/` |
| `api.*` 凭证 | `credentials: 'same-origin'` | `credentials: 'include'` |
| `command.invoke` 返回 | 整个 `{success,result,error}` 信封 | **拆包**：成功给 `json.result`，失败给 `json.error`，再兜底 `Command failed with HTTP <status>` |
| `storage.*` 落点 | `edu_os_plugin:__app__:<manifest.id>:<key>` | `ol_pv_<pluginId>_<key>` |
| 能力门禁 | ✅ `checkMethodPolicy` | ❌ **完全没有** |
| `ui.toast` type | 硬编码 `'info'` | 白名单 `success|warning|error`，否则 `'info'` |

最后一行是本页最重要的安全不对称：
**在 view HTML 里 `api.del('/api/users/...')` 不会触发 `api:admin` 检查**，
因为 view 通道根本没接 Barrier 3。
`api:write` / `api:admin` 只在 frame 通道的 `api.*` 上起作用。
```

`init` 载荷固定为：

```typescript
{ channel, type: 'init', payload: { pluginId, slot, lessonId, classId, studentId, studentName, lang, theme } }
```

`resize` 的门禁：`data.type === 'resize' && typeof data.height === 'number' && data.height > 0`。
不上报就没有自适应 —— 宿主无法读取 opaque-origin 文档的高度，
`panel` 变体按容器铺满，`floating` 变体默认保底 **180px**
（`height: \`${iframeHeight ?? 180}px\``）。

---

## 6. 三个互不相通的存储

```{danger}
同一个 `storage.set('pref', ...)` 调用，在三个位置落到三个不同的地方。
从 A 界面写、到 B 界面读，会读到 `null` 且不报错。

| 写入方 | 最终 key | 位置 |
| --- | --- | --- |
| frame 通道 `ctx.services.storageService.set('k', v)` | `edu_os_plugin:__app__:<manifest.id>:k` | **父页面** localStorage（宿主 `StorageService` 构造时传的是 `'__app__'`，不是插件 id） |
| view 通道 `OpenLearnPluginBridge.storage.set('k', v)` | `ol_pv_<pluginId>_k` | **父页面** localStorage（值为 `JSON.stringify` 后的字符串，读时 `JSON.parse`） |
| 服务端 `ctx.services.storage.set('k', v)` | `plugin_storage` 表的行 | **数据库**，按 `plugin_id` 列隔离，写入的是 **`manifest.id`** |

第二条与第三条的 `pluginId` 取值也可能不同：view 桥用的是宿主传入的
`init.payload.pluginId`。测试固定了行为：
`expect(localStorage.getItem(\`ol_pv_${PLUGIN_ID}_user_pref\`)).toBe(JSON.stringify({ color: 'blue' }))`。
```

前端两条都在父页面 localStorage，因此**共享同一份 origin 配额**，
且都**不跨设备**；要持久化到服务端只能走 `command.invoke`。

---

## 7. `command.invoke` 的服务端落点

```
POST /api/plugins/:id(*)/sandbox-command
```

`server/routes/plugins.ts` 的注释原文：

> 沙箱前端专用命令通道：强制使用插件自身 actor (`plugin:<manifestId>`)，杜绝 Confused Deputy

行为：`requireScopedAuth('authenticated')` → `pluginActorIdFor(manifestId, pluginId)` →
`bus.createCommand(resolvedType, payload ?? {}, pluginActor)`。

| 情况                 | 响应                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| 缺 `type`            | `400 'Missing command type'`                                                   |
| 插件行找不到         | `404 \`Plugin "<targetId>" not found\``                                        |
| 命令类型没有 handler | `` 404 `No handler registered for command type "<resolvedType>".` ``           |
| 能力不足             | 由内核 `ActionDescriptor.capabilityRequired` 裁决（见 {doc}`token-reference`） |

```{important}
**actor 被强制覆写为 `plugin:<manifestId>`，与点击它的用户无关。**
所以沙箱前端发起的命令，其权限来自**插件的能力集**，
而不是当前会话用户的角色；同时插件也**不能**冒充学生或教师。
想让命令以用户身份执行，只能经服务端 HTTP 路由（{doc}`http-api` 的 `req.actor`）
或宿主 `host-action-dispatcher`，没有第三条路。

`:id(*)` 通配段是为了 `@scope/name` 形式的 manifest id。
```

---

## 8. 可见 UI 的交付路径与 `view` 被静默 strip

```{danger}
### zod 默认 strip 未声明键：漏一个字段 = 空白面板且无报错

`packages/core/esm-loader/manifest-schema.ts` 的注释原文：

> v0.7.6 双轨制 UI：第三方 ZIP 插件在 process 模式下无法传 React 组件，
> 只能声明可视沙箱 HTML 的相对路径。**此处必须显式列出** —— zod 的 object
> 默认 strip 未声明键，漏声明会让 `view` 在 `parse()` 后被静默丢弃，
> 宿主便退回「占位空态」，插件作者看到的是空白面板且无任何报错。

`view: z.string().min(1).optional()` 目前只出现在 **6 个** schema 位置：
`teacherPanelSchema`、`contributesSchema['teacher.tab']`、
`['teacher.dashboard.widget']`、`['student.view']`、`['student.lesson.tool']`
（以及注释里点名但由通用分支覆盖的 `student.classroom.overlay`）。

**你往别的槽位写 `view`，它会被 strip 掉。** 这是回归测试
`manifest-schema.test.ts` 的 `it.each([...])('keeps view for contributes["%s"]')`
逐槽位钉住的那 6 个，外加一条
`it('rejects empty view so a typo cannot silently disable the iframe')`（`view: ''` 抛错）。
```

### 8.1 注册：`registerManifestContributions`

遍历所有数组型 `contributes` 条目，注册：

```typescript
{ ...label/icon/commandType/route/slotProps 等数据...,
  view: typeof entry.view === 'string' ? entry.view : undefined,
  component: NullExtensionComponent,   // export const NullExtensionComponent = () => null;
  pluginId, origin: 'manifest' }
```

```{warning}
manifest 路径**永远**带 `component: NullExtensionComponent`，宿主从不读 `entry.component`。
`manifest.json` 是 JSON，本来也装不下函数。
全仓库**没有任何**关于「你声明了 component 但被忽略」的告警 —— grep 无果。

因此 ZIP 插件在 contributes 里写 `"component": "Something"` 的结果是：
被 strip、无告警、渲染器判定 `isReact === false`，然后走 `view` 分支；
若 `view` 也没有，就返回 `null`（什么都不渲染）。
```

### 8.2 渲染优先级（4 个挂载点，两条链）

`PluginTabPanel.tsx` 的注释原文：

> 优先级：真实组件 > render 渲染函数 > 声明式沙箱视图 (view) > 占位项
> （至少保留 label 与错误态语义）。

`extension-point-renderer.tsx` 的三态判定：

```typescript
const isReact = typeof activeExt.component === 'function' && activeExt.component !== NullExtensionComponent;
const isDOM = typeof activeExt.render === 'function';
const hasView = Boolean(activeExt.slotProps?.view || activeExt.view);
if (!isReact && !isDOM && !hasView) return null; // ← 静默
```

`PluginCardRenderer.tsx` 额外警告了顺序陷阱：
`NullExtensionComponent` 必须先排除，「否则 manifest 声明的 view（沙箱页面）永远走不到下面的分支」。
`viewPath` 的取值同样是 `slotProps?.view || view` —— **`slotProps.view` 优先**。

空态文案（无 `view` 无组件时）：`'此插件未提供页面组件'` / `'This plugin has no page component'`。

`floating` 变体由槽位决定：

```typescript
const FLOATING_VIEW_SLOTS = new Set<string>(['student.classroom.overlay']);
// 新增浮层型槽位时请加到这里，不要让它落到 panel 分支。
```

多个 floating 扩展会横向错位：
`style={ viewVariantFor(slot) === 'floating' && index > 0 ? { left: \`calc(1.5rem + ${index * 316}px)\` } : undefined }`
—— **316px 是硬编码步长**，不是配置。

### 8.1 全班专注锁定与沙箱视图拦截契约

`ExtensionPointRenderer` 接受可选的 `locked?: boolean` 属性（由课堂状态机在全班专注锁定 `mode: 'full'` 时下发）：

- **panel 槽位**：沙箱视图上方覆盖半透明拦截遮罩，提示「全班专注锁定中，插件视图已暂停交互」；
- **floating 槽位**（如 `student.classroom.overlay`）：浮层卡片自动下滑折叠收起，原位保留展开提示徽标；
- **沙箱生命周期**：iframe 容器在锁定期间保持挂载，不触发组件卸载，未提交的内部临时输入或状态不丢失。

---

## 9. 扩展点注册与 store

### 9.1 `plugin-host-store.ts` 的形状

| state 键              | 类型                                  |
| --------------------- | ------------------------------------- |
| `activePlugins`       | `FrontendPluginInfo[]`                |
| `extensionPoints`     | `Map<string, ExtensionPointConfig[]>` |
| `services`            | `FrontendServiceRegistry \| null`     |
| `initialized`         | `boolean`                             |
| `dashboardVisibility` | `Map<string, boolean>`                |
| `pluginErrors`        | `Map<string, string>`                 |

action：`initialize` `addPlugin` `removePlugin` `updatePluginState`
`registerExtensionPoint` `unregisterExtensionPoint` `unregisterPluginExtensionPoints`
`unregisterPluginRuntimeExtensionPoints` `getExtensions` `setDashboardVisibility`
`setPluginError` `clearPluginError` `setDashboardVisibilityBatch`。

`dashboardVisibility` 持久化到 localStorage key `'openlearn:dashboardVisibility'`，
并监听 `window` 的 `storage` 事件做跨标签页同步。

### 9.2 排序、去重、越权拒绝

```{important}
- 排序：`[...list].sort((a, b) => (a.position ?? 100) - (b.position ?? 100))`，**默认 100**；
  同 `position` 保持注册顺序（`Array.prototype.sort` 稳定）。
- 同 `(slot, id)` 且**同插件** → 覆盖（HMR / 重装换了 DB UUID 也能更新）；
- 同 `(slot, id)` 但**不同插件** → 拒绝并打印：
  `[PluginHost] Extension point "<slot>/<id>" is owned by plugin "<owner>"; registration from "<you>" was rejected (cross-plugin overwrite).`
  （v0.6.1 审计 R-2）
- `unregisterExtensionPoint` 同样校验归属：
  `Plugin "<owner>" cannot unregister extension point ...`
```

````{danger}
### `rolesAllowed` 与 `group` / `badge` 是**没有消费者的字段**

`ExtensionPointConfig` 声明了：

```typescript
group?: 'teaching' | 'management' | 'analytics' | 'extension' | string;
badge?: number | string;
rolesAllowed?: ('admin' | 'teacher' | 'student')[];
```

但 `getExtensions` **从不读 `rolesAllowed`**，渲染器与所有消费方也都不读
`group` / `badge`（grep 无消费者）。

后果：`rolesAllowed: ['teacher']` 给不出任何保护 —— 学生照样看得到该扩展。
**显隐必须自己在组件/HTML 里按当前角色判断**（从 `init`/`context.get` 的上下文推），
不要把它当访问控制。`origin: 'manifest'` 的贡献更是连插件前端崩溃时都会保留。
````

`origin` 的语义（`ExtensionPointConfig.origin` 注释原文要点）：

| 值           | 来源                                     | 前端崩溃时                                                                                                                |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `'manifest'` | `contributes` / `classroomTools`         | **必须保留**（贡献本体是数据，执行在后端；摘掉会让 Tab「闪现后消失」，用户无从得知插件出了什么事 —— v0.7.0 熔断越权修复） |
| `'runtime'`  | `ctx.ui.registerExtensionPoint` 等命令式 | 随插件前端健康度生死                                                                                                      |

缺省视为 `'runtime'`。`unregisterPluginRuntimeExtensionPoints` 只删 `runtime` 项；
某 slot 数组清空后**删除该 slot 键**。

---

## 10. 渲染器与熔断器

### 10.1 `resolveExtensionComponent` 与 `__isLazyFactory`

```{danger}
### lazy 工厂必须打标记，否则整条防线全部失效

`ExtensionPointConfig.component` 的注释原文：

> lazy 工厂 `() => Promise<{ default: Comp }>` —— 仅远程/代码分割扩展使用，
> 且**必须**在工厂函数上设置 `__isLazyFactory = true` 标记，否则会被当作直接组件渲染：
> React 拿到返回的 Promise 会**永久悬挂最近的 Suspense 边界且不抛错**，
> ErrorBoundary 与熔断器全部失效（v0.6.0 smart-edu 事故）。

现在多了一道**一次性探针**（审计 R-1）：临时把 React 内部调度器置空
（`__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`、
`__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current`）
再 `fn()`：

- 返回 thenable → 自动 `React.lazy(fn)` 包一层，并
  `console.error('[ExtensionPoint] Detected an UNMARKED lazy factory (function returned a Promise). React would suspend forever without throwing. Auto-wrapping with React.lazy; please set \`__isLazyFactory = true\` ...')`
- 抛错 → 判为直接组件；
- 非函数 → `() => null`。

结果缓存在 `const resolvedComponentCache = new WeakMap<Function, React.ComponentType<any>>()`。
**探针只跑一次**，所以「第一次渲染才报错」的现象是设计使然。
```

包裹层次（顺序是审计结论，不能调换）：

```
ExtensionErrorBoundary key=`${pluginId}/${id}`
  └─ Suspense fallback=<LoadingSkeleton/>
       └─ CrashResetProbe          ← 必须在 Suspense 内部（R-4 / R-5）
            └─ React 组件 | DOMExtensionWrapper | PluginSandboxIframeView
```

- `R-4`：`CrashResetProbe` 放在 `Suspense` 外会稀释熔断计数；
- `R-5`：原先在 `componentDidMount` 里重置计数，导致阈值永远够不到；
- `DOMExtensionWrapper` 调 `ext.render(container, { route, ...slotProps })`，
  并在 `JSON.stringify(slotProps)` 变化时**重跑**（即：slotProps 必须可 JSON 序列化，
  含函数/循环引用会退化）；
- 熔断触发日志：`[ExtensionBreaker] Plugin "<pid>" frontend crash #<count>/3`、
  `[ExtensionBreaker] Plugin "<pid>" 已熔断（连续崩溃 ≥3 次），跳过渲染。重新激活插件可恢复。`；
- ErrorBoundary 兜底文案：`'扩展组件加载失败'` / `'Extension failed to load'`；
- 重试按钮 `data-testid={\`plugin-retry-btn-${pluginId}\`}`。

### 10.2 slotProps 注入差异

| 挂载点       | 注入内容                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 通用槽位循环 | `{ route: ext.route \|\| route, lessonId: selectedLesson, classId: liveClassSelectedClassId, dispatcher, ...ext.slotProps, ...slotProps }` —— **渲染器 props 覆盖 ext.slotProps** |
| Tab 面板分支 | `{ ...activeExt.slotProps, ...extraProps, dispatcher }`                                                                                                                           |

`dispatcher` 默认是 `createScopedDispatcher(ext.pluginId)`，除非 `slotProps.dispatcher` 覆盖。

### 10.3 特殊匹配规则

| 槽位                      | 额外逻辑                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whiteboard.renderer`     | `targetType` 依次对比 `et.targetType` / `ext.id` / `ext.route` / `` `${pluginId}/${id}` `` / `slotProps.elementType` / `slotProps.targetType`，命中 `slotProps.elementType` 才渲染 |
| `assignment.file.preview` | 按声明的 `extensions` / `mimeTypes` 过滤（`matchesDeclaredExtension`）                                                                                                             |
| `anchor:*`                | 按 `placement` 过滤，**默认 `'after'`**                                                                                                                                            |

```{warning}
**未知/未登记的槽位名 → 静默 `null`。**
`if (!host) return fallback ?? null;`、`if (extensions.length === 0) return null;`

而 `AnyExtensionSlot = ExtensionSlot | AnchorSlot | (string & {})`
意味着 TypeScript **不会拦你**：`ExtensionSlot` 有 120 个字面量，
但 `string & {}` 让任何字符串都能通过类型检查。
拼错 `'classroom.topbar.action'` 为 `'classroom.topbar.actions'`
不会报错、不会告警、不会渲染 —— 只会让面板空空如也。
```

### 10.4 熔断器参数

| 常量                      | 值                                                                          |
| ------------------------- | --------------------------------------------------------------------------- |
| `CRASH_BREAKER_THRESHOLD` | `3`                                                                         |
| `CRASH_BREAKER_WINDOW_MS` | `5 * 60 * 1000`                                                             |
| 状态                      | 模块级 `Map<string, {count, lastAt, blown}>`，**仅内存**，不落 localStorage |

`recordPluginCrash` 返回 `{shouldBreak, count}`：无记录或超窗 → 重置为 `{count:1, blown:false}`；
否则 `count += 1`，`shouldBreak = count >= 3` 且置 `blown = true`。

重置点：激活成功、`unregisterPluginResources`（除非 `keepBreakerState: true`）、
内置包重新启用。`suspendPlugin` 走 `{preserveManifestContributions:true, keepBreakerState:true}`，
并写错误 `'插件前端连续崩溃，已自动降级'`（仅在尚无错误时）。

`C-2` 修复前 `resetPluginBreaker` 是死代码（renderer ↔ plugin-host 循环依赖，
故抽成 `extension-breaker.ts`），`blown` 一旦置位就**永久**；
`N-6` 修复前卸载不回收崩溃记录。

---

## 11. `ctx.dispatcher`（宿主受控动作）

```{important}
`export const defaultHostActionDispatcher = new HostActionDispatcher();` 是**模块级单例**，
所有插件、所有宿主实例共用一张 handler 表。

内置处理器（`registerBuiltinHandlers`）共 6 类：

| type | 结果 |
| --- | --- |
| `host:refresh` | 按 `target`（`classes`/`lessons`/`students`/`all`）调 `appStore.getState().load*`，返回 `{success:true, refreshed}` |
| `host:modal:confirm` | 受控确认框，返回 `{confirmed}` |
| `host:modal:open` | 受控弹窗，返回 `{actionId?, closed}` |
| `host:modal:close` | 关闭 |
| `host:toast` | `type \|\| 'info'`，返回 `{delivered:true}` |
| `host:navigate` | `setTeacherTab`，返回 `{navigated:true}` |

其余 `CustomHostAction<TType, TPayload>` 任意 type 也可派发。
```

| 行为             | 事实                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correlationId`  | `'act_' + Math.random().toString(36).slice(2, 10)`                                                                                                                    |
| 弹窗/Toast id    | `'modal_confirm_'` / `'modal_open_'` / `'toast_'` + `Math.random().toString(36).slice(2,9)`                                                                           |
| 中间件顺序       | `executeCore` 在所有 `middlewares` **之后**，按 `use()` 压入顺序串联                                                                                                  |
| 重入             | `next() called multiple times in middleware`                                                                                                                          |
| 多处理器         | `Map<string, Set<handler>>`；1 个 → 直接返回其结果；N 个 → `Promise.all`，仅 `host:refresh` 的 `refreshed` 数组合并去重，**其余「最后一个赢」**                       |
| 无处理器         | `return undefined as any` —— **静默 no-op，不报错**                                                                                                                   |
| 超时             | `if (options?.timeoutMs && options.timeoutMs > 0)` 才生效，消息 `Action "<type>" timed out after <ms>ms`。**没有默认超时**                                            |
| 错误             | **原样 rethrow 给调用方**，本层不序列化                                                                                                                               |
| `subscribe('*')` | 普通键；先通知类型专属监听，再通知 `'*'`，每个回调收 `(envelope, result?, error?)`，在 settle 之后；监听器抛错只打印 `[HostActionDispatcher] Subscriber threw error:` |
| 审计             | 本层**不内置**审计日志，审计靠中间件在测试里演示                                                                                                                      |

```{danger}
### `dispatcher.registerHandler` 注册的处理器**不会被自动清理**

`unregisterPluginResources` 清理的是被 `trackDisposer` 登记的资源
（`disposers` map，审计 E-5）、沙箱帧与监听器、扩展点、
`fullscreenRendererRegistry` / `propertyEditorRegistry` / `coursewareSourceRegistry` /
`paletteItemRegistry` 的 `.unregisterPlugin`、`unregisterPluginSegmentTypes`、
`assignmentQuestionRendererRegistry.clearOwned`、`assessmentQuestionTypeUiRegistry.clearOwned`、
`unregisterPluginLocales`、`resetPluginBreaker`。

**不在**清理范围：`ctx.dispatcher.registerHandler` 的处理器（返回的 `Disposable`
要你自己存）、`socketService.on` 监听器、已弹出的 toast 与打开的 modal、
插件自己创建的定时器与 DOM、`this.sourceCodes` / `this.manifests`
（失败时**故意**保留 manifest 以便重试）。

叠加「dispatcher 是全局单例」+「无处理器时静默返回 `undefined`」，
后果是：插件被卸载后，它的 `host:refresh` 处理器仍在表里，
别的插件派发同一动作时仍会调到已死代码。
```

`ISocketService` 的 `disconnect` / `destroy` 在 Barrier 3 里是
**任何能力都解锁不了**的硬拒绝（`插件无权调用 <method>()——断开课堂实时通道会中断正在进行的教学`）。

---

## 12. 前端 worker 模式（第三种运行方式）

| 常量 / 行为             | 值                                                          |
| ----------------------- | ----------------------------------------------------------- |
| `MAX_WORKERS`           | `32`（`T-09-09` / `T-05-09`）                               |
| `ACTIVATE_TIMEOUT_MS`   | `10000`                                                     |
| `DEACTIVATE_TIMEOUT_MS` | `3000`                                                      |
| 已存在                  | `Worker already exists for plugin "<id>"`                   |
| 超限                    | `Cannot create Worker: maximum active Workers (32) reached` |
| 激活超时                | `Worker activation timed out after 10000ms`                 |
| 停用超时                | `Deactivate timeout for "<id>"`                             |
| 创建失败                | `Failed to create Worker for plugin "<id>": ...`            |

- RPC 用 `Proxy` 实现：任意属性访问都变成
  `{type:'invoke', invokeId: crypto.randomUUID(), token, method, args}`；
- 回包错误复活为 `new Error(msg.message)`，并带 `err.name = msg.code || 'RpcError'`、`err.stack = msg.stack`；
- **没有 per-invoke 超时** —— 主线程丢掉消息时 `pendingCalls` 条目**永不过期**（ Promise 永久悬挂）；
- worker 模式激活**不会**调 `resetPluginBreaker`（与 inline / sandbox 两条路径不同）；
- `activateWorkerPlugin` 合成的 manifest 必须带 `capabilitiesProposed`，
  否则触发 Barrier 2 只读降级；其 `activate` 是 `async () => {}`（注释 `Already activated via Worker bootstrap`）。

前端 `ServiceHost` 的三道闸（`src/plugin-host/service-host.ts`）：

| Barrier        | 消息                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1 Token 白名单 | `Access to service token '<token>' denied: not in worker allowedTokens for <actorId>`（`name = 'WorkerCapabilityError'`） |
| 2 空能力降级   | `Capability denied for actor <id>: empty manifestCapabilities, only 'get' methods allowed`                                |
| 3 方法级策略   | `Call denied for actor <id>: <token>.<method>() — <reason>`                                                               |
| 未登记方法     | `Method "<method>" not found on service "<token>"`                                                                        |

`handleMessage` **从不抛错**，未知消息类型被静默忽略。
回包 `{type:'result', invokeId, value}` / `{type:'error', invokeId, message, code, stack}`，
`STACK_CAP = 4096`。socket 事件转发时把参数包成
`{id:'', type, source:'socket', payload, timestamp}`。

`service-registry.ts` 是扁平 Map：`register` 重复即 `Service already registered: <token>`（`T-09-01`），
`resolve` 缺失即 `No provider registered for token: <token>`；`D-17` 注明**没有依赖图**。

前端 Token 与允许集合见 {doc}`platform-services` §5 与 {doc}`token-reference` §7。

---

## 13. 前端共享模块（与后端**不同**）

```typescript
const SHARED_MODULE_MAP = {
  react: 'window.HostSharedDeps.React',
  'react-dom': 'window.HostSharedDeps.ReactDOM',
  'react-dom/client': '(window.HostSharedDeps.ReactDOMClient || window.HostSharedDeps.ReactDOM)',
  'react/jsx-runtime': 'window.HostSharedDeps.jsxRuntime',
  recharts: 'window.HostSharedDeps.Recharts',
  'lucide-react': 'window.HostSharedDeps.LucideReact',
};
```

只有 **6 项**。`window.HostSharedDeps` 在 `src/main.tsx` 注入，
除上述点号键外还挂了同名别名（`react`、`react-dom`、`react-dom/client`、
`react/jsx-runtime`、`recharts`、`lucide-react`）以及 `window.React` / `window.ReactDOM`。

```{important}
`E-3` 注释原文：这张表**刻意不等于**后端 `PLUGIN_SHARED_MODULES` ——
`jspdf` / `exceljs` / `uuid` / `react-markdown` 是服务端专用，**不要加进来**。
后端那张表（7 项）见 {doc}`token-reference` 8.1。

即：`jspdf` 在服务端 `ctx` 里能 import，在前端 bundle 里 import 会失败。
```

改写规则（`transformBareModuleImports`）：

- 只在 `if ((window as any).HostSharedDeps)` 为真时执行；
- 只改写 `import ... from '...'` 与副作用 `import 'react'`
  （后者变成注释 `/* [HostSharedDeps] import "react"; */`）；
- 覆盖 5 种 import 从句形态（默认+命名空间、默认+具名、`* as X`、仅具名、仅默认），
  `as` 归一为 `:`，`type` 从句被剥离，注释被移除；
- **不匹配的描述符原样返回** —— 裸标识符活到 Blob 模块里，
  由浏览器在 `import()` 时抛 `Failed to resolve module specifier`；
- `export` 改写、`import.meta` 改写：**not found**（不支持）。

---

## 14. 症状 → 原因 → 动作

| 症状                                                    | 原因                                                 | 动作                                                         |
| ------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| 面板一片空白，无报错                                    | `view` 被 zod strip（槽位不在那 6 个里）/ 槽位名拼错 | 核对 {doc}`contributes-slots`；用被测试钉住的 6 个槽位之一   |
| `'此插件未提供页面组件'`                                | 既无组件又无 `view`                                  | 加 `view`，或改用 `render`                                   |
| `'非法的插件视图路径'`                                  | `view` 含 `..` / `://` / `//` / `\` / `javascript:`  | 改成包内相对路径                                             |
| `Unsupported sandbox bridge op "xxx"`                   | 沙箱里调了不存在的 op（如 `api.put`）                | 10 个 op 之外没有别的；写操作走 `command.invoke`             |
| `Unsupported op "xxx"`                                  | view 侧调了 frame 独有的 op（如 `ui.register`）      | view 只有 8 个 op                                            |
| `Cannot read properties of undefined (reading 'React')` | 在 frame 沙箱里 import react                         | 用 view HTML 渲染，或改 inline                               |
| `'插件依赖缺失：宿主未提供共享运行时（React 等）'`      | 同上，被 `describeActivationError` 翻译              | 同上                                                         |
| `'插件激活超时（5 秒）'`                                | `activate()` 里 await 了不返回的东西                 | 把耗时操作挪进 `processManager` 任务                         |
| `missing activate function`                             | `frontend.js` 没导出 `activate`                      | 契约测试 `scaffold-frontend-contract.test.ts` 逐字钉住了判据 |
| `Failed to fetch frontend.js for plugin "x": HTTP 404`  | 包里缺 `frontend.js` 或插件 id 含斜杠未编码          | 检查 ZIP 产物与 `manifest.id`                                |
| `[PluginSandbox] ... attempted unauthorized navigation` | 沙箱文档被二次 `load`                                | 不要在 `activate` 里改 `location`                            |
| `写操作（post）需要 manifest 声明 'api:write' 能力`     | frame 侧 `api.post` 无能力                           | manifest 加 `api:write`                                      |
| `写入高危路径 '/api/users' 需要 ... 'api:admin'`        | 命中 8 个前缀之一                                    | 加 `api:admin`，或改走服务端命令                             |
| action 注册成功但界面没出现                             | 熔断 `blown`                                         | 重新激活插件（`retryPlugin`）可清计数                        |
| 插件卸载后别的功能异常                                  | dispatcher 处理器未清理                              | 保存 `Disposable` 并在 `deactivate()` 里 `dispose()`         |
| `host:xxx` 派发返回 `undefined`                         | 没有处理器，静默 no-op                               | 检查 type 拼写；`subscribe('*')` 观察                        |
| 前端 worker 调用永不返回                                | 无 per-invoke 超时 + 消息丢失                        | 自己加 `Promise.race` 超时                                   |
| iframe 高度只有 180px                                   | 没上报 `resize`（floating 保底）                     | 内容变化时调 `ui.resize(h)`                                  |

---

## 15. 提交前自查

1. 需要可见界面 → manifest `contributes[<那 6 个槽位之一>].view`，且路径为包内相对路径；
2. `x.html` 里手动引入 `/plugin-sandbox/view-bridge.js`（模板不会替你写）；
3. view 页面在每次内容高度变化后调 `OpenLearnPluginBridge.ui.resize(h)`；
4. 沙箱代码只用 10 个 op；`api.*` 只想到 `get/post/del`（没有 `put`、没有 `patch`）；
5. 实时性需求降级为 2–5 秒轮询，并在 `deactivate()` 里 `clearInterval`；
6. 不假设 `socketService` / `showModal` / `navigation` / `dispatcher` / `i18n` 存在；
7. 不在 frame 沙箱里 import `react`（共享运行时只在 inline 可用）；
8. 不依赖 `rolesAllowed` 做显隐，自己在上下文里判断角色；
9. 需要 lazy 工厂时显式设 `__isLazyFactory = true`；
10. `dispatcher.registerHandler` / `socketService.on` 的 `Disposable` 自己保存并在 `deactivate()` 释放；
11. 跨界面共享数据走 `command.invoke` + 服务端，不要指望 frame 与 view 的 storage 互通；
12. 前端 `api.del` 需要 `api:write`，实体级三段删除需要 `api:admin`；
13. 沙箱 UI 出问题时先确认熔断（`[ExtensionBreaker] ... 已熔断`）而不是代码逻辑；
14. 断言 iframe 属性时用逐字值：`allow-scripts`（frame）/ `allow-scripts allow-forms allow-downloads`（view）。

---

## 16. 取证

| 断言                                                            | 来源（repomix 行）                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 帧路由与 401 分支、逐字帧 CSP                                   | `server.ts` L422960–422971                                                                          |
| `PLUGIN_SANDBOX_FRAME_HTML` 与 opaque origin 注释               | `server/utils/plugin-sandbox-frame.ts` L237625–237720（注释 L237628–237630）                        |
| blob import / `missing activate function` / 5000ms              | `server/utils/plugin-sandbox-frame.ts`（L75–L84）                                                   |
| `targetOrigin` 锁定与 `event.source` 校验                       | `server/utils/plugin-sandbox-frame.ts`（L15）/237643/237677/237698                                  |
| 4 个沙箱常量                                                    | ``src/plugin-host/sandbox-frame.ts`→`PLUGIN_FRAME_CHANNEL`（L6–L9）；`isPluginFrameMessage` L397487 |
| `mountSandboxFrame` 属性与 `display:none`                       | ``src/plugin-host/plugin-host.ts`→`frame`（L474–L503）                                              |
| `loadCount > 1` 熔断与日志原文                                  | `src/plugin-host/plugin-host.ts`（L488–L499）                                                       |
| 10 个 op 与 `Unsupported sandbox bridge op`                     | 同上 `answerSandboxCall` L396568–396613                                                             |
| `api.*` 的 `checkMethodPolicy` 与 `op.slice(4)`                 | `src/plugin-host/plugin-host.ts`（L605–L607）                                                       |
| storage key 前缀 `${manifest.id}:`                              | `src/plugin-host/plugin-host.ts`（L614）                                                            |
| `command.invoke` → `/sandbox-command`                           | `src/plugin-host/plugin-host.ts`（L624–L627）                                                       |
| `ui.register` 强制 `origin:'runtime'`                           | `src/plugin-host/plugin-host.ts`（L635）                                                            |
| `ui.toast(message, message, 'info')`                            | `src/plugin-host/plugin-host.ts`（L641–L643）                                                       |
| `context.get` 返回两个字段                                      | `src/plugin-host/plugin-host.ts`（L646–L647）                                                       |
| `makeCtx` 成员表                                                | 同上 L237651–237673（帧内）                                                                         |
| changelog 声称的 `location.*`/心跳不存在                        | grep `location.replace`/`window.open`/heartbeat → not found                                         |
| `isInline` 取自服务端求值                                       | `src/plugin-host/plugin-host.ts`（L703）；POC 断言 L96045                                           |
| `describeActivationError` 的 5 条中文文案                       | `src/plugin-host/plugin-host.ts`（L146）ff                                                          |
| `unregisterPluginResources` 清理清单与不清理项                  | `src/plugin-host/plugin-host.ts`（L1063） / L397110                                                 |
| `PluginSandboxIframeView` 全流程                                | `src/components/PluginSandboxIframeView.tsx` L266332–266646                                         |
| `sanitizeViewPath` 与 7 条拒绝规则                              | `src/components/PluginSandboxIframeView.tsx`（L39–L55）；测试 L246107–246372                        |
| view 逐字 CSP、`sec-fetch-dest` 放行、`setHeaders`              | ``server/utils/plugin-view-bridge.ts`→`PLUGIN_VIEW_CSP`（L10）；`server.ts` L422921–422950          |
| `PLUGIN_VIEW_BRIDGE_JS` 成员表与 `window.OpenLearnPluginBridge` | `server/utils/plugin-view-bridge.ts`（L13–L143）                                                    |
| view 8 个 op 与 `Unsupported op`                                | ``src/components/PluginSandboxIframeView.tsx`→`reply`（L149–L220）                                  |
| view 无 Barrier 3（与 frame 不对称）                            | 同上（该文件内无 `checkMethodPolicy` 调用）                                                         |
| `ol_pv_<pluginId>_<key>` 与 JSON 往返                           | `src/components/PluginSandboxIframeView.tsx`（L203）/266543/266548；测试断言 L246107ff              |
| 轮询结论与原文                                                  | ``docs/plugin/frontend-sandbox-capability-boundary.md`（L62–L100）                                  |
| `setInterval` 在沙箱代码中 0 次                                 | 四个沙箱文件全量 grep                                                                               |
| zod strip 注释与 6 处 `view` 声明                               | ``packages/core/esm-loader/manifest-schema.ts`→`teacherPanelSchema`（L498–L501）、L82122–82158      |
| `view` 回归测试与空串抛错                                       | ``packages/core/esm-loader/**tests**/manifest-schema.test.ts`→`manifest`（L292–L335）               |
| `NullExtensionComponent` 与 `registerManifestContributions`     | ``src/plugin-host/plugin-host.ts`→`NullExtensionComponent`（L142）、L396149–396225                  |
| 渲染优先级链与空态文案                                          | ``src/components/PluginTabPanel.tsx`→`effectiveActive`（L33–L78）                                   |
| 三态判定 `isReact/isDOM/hasView`                                | ``src/plugin-host/extension-point-renderer.tsx`→`isReact`（L506–L549）、L394771–394853              |
| `FLOATING_VIEW_SLOTS` 与 316px 步长                             | `src/plugin-host/extension-point-renderer.tsx`（L52–L54）                                           |
| `__isLazyFactory` 与探针告警原文                                | `src/plugin-host/extension-point-renderer.tsx`（L332–L347）ff；types.ts L398170ff                   |
| 包裹层次与 R-4/R-5                                              | `src/plugin-host/extension-point-renderer.tsx`（L237）、L394047                                     |
| 熔断常量与状态结构                                              | `src/plugin-host/extension-breaker.ts` L393743–393800（C-2 注释 L393748）                           |
| store 形状、排序、跨插件拒绝文案、origin 语义                   | `src/plugin-host/plugin-host-store.ts` L395684–395964（R-2 L395839/395868）                         |
| `rolesAllowed`/`group`/`badge` 无消费者                         | 全 `src/` grep 无读取点                                                                             |
| dispatcher 单例、6 内置、无默认超时、last-wins                  | `src/plugin-host/host-action-dispatcher.ts` L394865–L395286                                         |
| worker 常量与错误文案                                           | `src/plugin-host/browser-worker-manager.ts` L393209–L393651                                         |
| 前端 ServiceHost 三道闸消息                                     | `src/plugin-host/service-host.ts` L397492–L397834                                                   |
| `SHARED_MODULE_MAP` 6 项与 E-3 注释                             | ``src/plugin-host/plugin-host.ts`→`slot`（L1323–L1331）                                             |
| `transformBareModuleImports` 覆盖面                             | 同上；测试 `__tests__/transform-imports.test.ts` L392432                                            |
| `window.HostSharedDeps` 注入点                                  | ``src/main.tsx`（L16）                                                                              |
| `/plugins` 与 `/plugin-sandbox/frame` 行为被 POC 钉住           | ``packages/core/plugin-host/**tests**/plugin-audit-poc.test.ts`→`gateway`（L571–L607）              |
| e2e 显式跳过槽位断言及原因                                      | ``e2e/canary-ui.spec.ts`→`LOG_DIR`（L397–L450）                                                     |
| 无测试钉住帧 CSP / 10-op 表 / `Unsupported ... op`              | 全量 grep `PLUGIN_SANDBOX_FRAME_HTML` → 无测试引用                                                  |
