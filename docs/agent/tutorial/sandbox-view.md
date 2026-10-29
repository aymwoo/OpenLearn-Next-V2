# 教程三：`view` 可视沙箱（用户真正看得见的界面）

前两篇的插件都没有**任何用户可见的界面**：`frontend.tsx` 跑在隐藏帧里，
只能注册数据型贡献点（图标 + 文案 + 命令）。
要在界面上放表单、图表、按钮，唯一通道是 `contributes[*].view` 指向你自己的 HTML 文件。

```{note}
双轨制的另一轨（React 内联组件）**只对受信任插件开放**：
需要 `manifest.id` 在 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 里，或插件位于内置目录 `packages/plugins`。
第三方 ZIP 一律被降级到 `process` 档，React 组件函数穿不过 RPC，
所以「轨 B」对 ZIP 交付的插件不可用。平台文档原话：
> 第三方 `process` 隔离模式插件可直接使用 HTML + `/plugin-sandbox/view-bridge.js` 编写原生白板卡片，
> **无需配置 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 白名单**。
```

---

## 1. 宿主渲染优先级

```
React 真实组件 ≻ DOM render 函数 ≻ 声明式沙箱视图 (view) ≻ 占位空态
```

`PluginCardRenderer` 取路径的写法是 `ext.slotProps?.view || ext.view`，
命中就走 `<PluginSandboxIframeView variant="panel" />`。
注意它在 `view` 之前会先判 `hasReactComponent`：
manifest 声明的贡献点组件是 `NullExtensionComponent`（`() => null` 占位），
源码注释说明了为什么要特判它 ——

> `NullExtensionComponent` 是 manifest 数据型贡献的占位组件（`() => null`），
> 否则 manifest 声明的 `view`（沙箱页面）永远走不到下面的分支。

---

## 2. `view` 只在 6 个槽位有效

`view: z.string().min(1).optional()` 只出现在这 6 个 schema 位置：

| 槽位                                    | 典型用途                     |
| :-------------------------------------- | :--------------------------- |
| `teacher.panel`（`teacherPanelSchema`） | 教师侧栏面板                 |
| `teacher.tab`                           | 教师标签页                   |
| `teacher.dashboard.widget`              | 教师看板小组件 / 白板卡片    |
| `student.view`                          | 学生视图                     |
| `student.lesson.tool`                   | 课堂工具浮层                 |
| `student.classroom.overlay`             | 课堂叠加层（由通用分支覆盖） |

```{danger}
### 往别的槽位写 `view`，它会被 zod 静默 strip

zod 的 object 默认丢弃未声明键。`schema-manifest.ts` 的注释原文：

> 此处必须显式列出 —— zod 的 object 默认 strip 未声明键，
> 漏声明会让 `view` 在 `parse()` 后被静默丢弃，
> 宿主便退回「占位空态」，插件作者看到的是空白面板且无任何报错。

这是回归测试逐槽位钉住的（`it.each([...])('keeps view for contributes["%s"]')`），
外加一条 `it('rejects empty view so a typo cannot silently disable the iframe')`：
**`view: ""` 会抛校验错**，而 `view: "stroage/typo.html"`（拼错目录名）只会 404 空白。

写之前对照 {doc}`../reference/contributes-slots` 确认槽位名。
```

---

## 3. HTML 放哪：`storage/` 前缀

安装端只把 ZIP 里 **`storage/` 前缀下**的条目落盘到插件目录：

```javascript
// 3. SEC-ZIPSLIP: 严密校验所有条目路径，防止通过 .. 实施 Zip Slip 穿越写任意文件
const storageEntries = Object.keys(zip.files).filter((name) => name.startsWith('storage/') && !zip.files[name].dir);
```

于是有效路径链条是：

```
ZIP:  storage/dashboard.html
落盘: <pluginsDir>/<安装 UUID>/storage/dashboard.html
URL :  /plugins/<安装 UUID>/storage/dashboard.html
声明:  "view": "storage/dashboard.html"
```

iframe 的 `src` 由宿主拼装：

```typescript
`/plugins/${encodeURIComponent(pluginId)}/${cleanView}`;
```

`pluginId` 是 **`plugins` 表的行 UUID**（也是插件目录名），由宿主从贡献点注册表带来，
**不是** `manifest.id`，也不需要你操心；`cleanView` 是 `sanitizeViewPath(rawView)` 的结果。

````{warning}
### SDK 的 build 不会把 `storage/` 装进 ZIP

`openlearn-plugin-sdk build` 只写 `index.js` / `manifest.json` / `frontend.js`（+ 可选 `signature.json`）。
所以多步构建里要**显式补一步**。推荐做法：在 `postbuild` 脚本里用 JSZip 重新组装，
把 `storage/**` 一并加入后**再签名**（Ed25519 签名覆盖整个 ZIP 的 SHA-256，
事后追加文件会让校验失败）。

```json
// 概念示意：真正落地时把 JSZip 作为 devDependency 在构建脚本里用
{
  "scripts": {
    "build": "openlearn-plugin-sdk build",
    "postbuild": "node scripts/attach-view-assets.mjs"
  }
}
```

`attach-view-assets.mjs` 要做的事：打开 `dist/<插件名>.zip` →
`zip.folder('storage')` 下逐条 `file(name, content)` → 重新 `generateAsync` →
覆盖写回 → 若启用签名，此时才调用签名。
**顺序不能反。**
````

`sanitizeViewPath` 的拒绝清单（命中即在界面显示「非法的插件视图路径」）：

| 规则                                 | 例子                     |
| :----------------------------------- | :----------------------- |
| 含 `://`                             | `http://x/y.html`        |
| 以 `//` 开头                         | `//evil/y.html`          |
| 以 `\` 开头                          | `\windows\path`          |
| 含 `..`                              | `storage/../secret.html` |
| 匹配 `/^(javascript\|data\|blob):/i` | `data:text/html,...`     |
| 空串                                 | `""`                     |

通过则去掉前导斜杠：`/storage/dashboard.html` → `storage/dashboard.html`。

```{important}
**目录穿越的防线在浏览器侧**，不在服务端：
`/plugins` 的 `express.static` 那段中间件里没有 `isPathInsideRoot` / `safeJoin` 调用。
所以 `sanitizeViewPath` 被绕过之前，防线只有一层。
不要在 HTML 里用 `fetch('../..')` 之类的相对路径猜测。
```

---

## 4. 一个可直接抄的 `storage/dashboard.html`

```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>课堂记录</title>
    <!-- 必须自己引入宿主统一提供的视图桥接脚本 -->
    <script src="/plugin-sandbox/view-bridge.js"></script>
    <style>
      body {
        margin: 0;
        padding: 12px;
        font:
          14px/1.5 system-ui,
          sans-serif;
        color: #1e293b;
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      input {
        flex: 1;
        padding: 6px 8px;
      }
      button {
        padding: 6px 12px;
      }
      #log {
        margin-top: 8px;
        white-space: pre-wrap;
        color: #475569;
      }
    </style>
  </head>
  <body>
    <div class="row">
      <input id="inp" placeholder="写一条记录" />
      <button id="go">提交</button>
    </div>
    <div id="ctx">上下文加载中…</div>
    <div id="log"></div>

    <script>
      const B = window.OpenLearnPluginBridge;
      const log = (t) => (document.getElementById('log').textContent += t + '\n');

      B.onInit(function (ctx) {
        document.getElementById('ctx').textContent =
          '课节 ' +
          (ctx.lessonId || '-') +
          ' / 班级 ' +
          (ctx.classId || '-') +
          ' / ' +
          (ctx.studentName || ctx.studentId || '未登录') +
          ' / ' +
          ctx.lang +
          ' / ' +
          ctx.theme;
        autoResize();
      });

      B.onContextUpdate(function (ctx) {
        document.getElementById('ctx').textContent = '上下文已更新：' + JSON.stringify(ctx);
      });

      document.getElementById('go').addEventListener('click', async function () {
        const input = document.getElementById('inp').value;
        try {
          const result = await B.invokeCommand('@myteam/record-helper.process', { input: input });
          log('ok: ' + JSON.stringify(result));
          await B.ui.toast('已提交', 'success');
        } catch (err) {
          log('fail: ' + err.message);
          await B.ui.toast(err.message, 'error');
        }
      });

      // 桥不会自动上报高度，不上报宿主就不知道要多高（floating 变体保底 180px）
      function autoResize() {
        const h = document.documentElement.scrollHeight;
        if (h > 0) B.ui.resize(h);
        new ResizeObserver(function () {
          B.ui.resize(document.documentElement.scrollHeight);
        }).observe(document.body);
      }
    </script>
  </body>
</html>
```

manifest 侧：

```json
{
  "contributes": {
    "teacher.panel": [{ "id": "record-helper-panel", "title": "课堂记录", "view": "storage/dashboard.html" }]
  }
}
```

```{warning}
### `commandType` 前缀规则在这里和别处不一样

- **manifest `contributes[*].commandType`**：宿主会调
  `resolvePluginCommandType(entry.commandType, manifestId)` **自动补前缀**，
  所以写裸名 `process` 与写 `@myteam/record-helper.process` 都命中同一个 handler。
- **运行期 `ui.registerExtensionPoint(...)`**（`frontend.tsx`）：**不补前缀**，必须写全限定名。
- **`view` HTML 里 `B.invokeCommand(type, payload)`**：请求打到
  `/api/plugins/<pluginId>/sandbox-command`，服务端同样按 `manifest.id` 补前缀。

上面示例写了全限定名，因为「已带前缀 → 原样返回」，三种规则下都安全。
```

---

## 5. `OpenLearnPluginBridge` 的确切成员

| 成员                             | 是否桥调用        | 落到哪个 op                                               |
| :------------------------------- | :---------------- | --------------------------------------------------------- |
| `onInit(cb)`                     | 否（注册回调）    | 宿主 `init`；**若上下文已就绪则立即触发**                 |
| `onContextUpdate(cb)`            | 否                | 宿主 `context-update`                                     |
| `getContext()`                   | 否，返回缓存      | —                                                         |
| `ui.toast(message, type)`        | 是                | `ui.toast`                                                |
| `ui.showToast(message, type)`    | 是（同上别名）    | `ui.toast`                                                |
| `ui.resize(height)`              | 是，但**不是 op** | 直接 `post({type:'resize', height: Number(height) \| 0})` |
| `invokeCommand(type, payload)`   | 是                | `command.invoke`                                          |
| `api.get/post/del(path[, body])` | 是                | `api.get` / `api.post` / `api.del`                        |
| `storage.get/set/delete(key)`    | 是                | `storage.get` / `storage.set` / `storage.delete`          |
| `CHANNEL`                        | —                 | `'ol-plugin-view'`                                        |

桥在脚本加载时自动 `post({type:'ready'})`，你不用手写握手。
`targetOrigin` 初始为 `'*'`，收到 `init` 后收紧为宿主源。

宿主侧只接受 **8 个 op**：`ui.toast`、`command.invoke`、`api.get`、`api.post`、`api.del`、
`storage.get`、`storage.set`、`storage.delete`。
其余回复 `Unsupported op "<op>"`（注意与帧通道的
`Unsupported sandbox bridge op "<op>"` **文案不同**，排查时别看错页面）。

`init` 载荷固定 8 个字段：

```typescript
{ channel, type: 'init', payload: { pluginId, slot, lessonId, classId, studentId, studentName, lang, theme } }
```

---

## 6. view 通道与 frame 通道的差异

```{danger}
### view 通道**完全没有** Barrier 3 方法级能力门禁

| 项 | frame（隐藏帧，`frontend.tsx`） | view（本教程的 HTML） |
| :--- | --- | --- |
| 未登记 op 报错文案 | `Unsupported sandbox bridge op "<op>"` | `Unsupported op "<op>"` |
| `api.*` 路径 | 原样透传 | 不以 `api/plugins/` 开头则自动前缀 `/api/plugins/<pluginId>/` |
| `api.*` 凭证 | `credentials: 'same-origin'` | `credentials: 'include'` |
| `command.invoke` 返回 | 整个 `{success,result,error}` 信封 | **拆包**：成功给 `json.result`，失败给 `json.error`，兜底 `Command failed with HTTP <status>` |
| `storage.*` 落点 | `edu_os_plugin:__app__:<manifest.id>:<key>` | `ol_pv_<pluginId>_<key>` |
| 能力门禁 | ✅ `checkMethodPolicy` | ❌ **没有** |
| `ui.toast` 的 type | 硬编码 `'info'` | 白名单 `success\|warning\|error`，否则 `'info'` |

最后一行是本页最重要的安全事实：**在 view HTML 里发 `api.del('/api/users/1')`
不会触发 `api:admin` 检查**，因为 view 通道根本没接 Barrier 3
（`api:write` / `api:admin` 只在 frame 通道的 `api.*` 上生效）。

这不是「你可以这么用」的许可 —— 服务端自己的鉴权仍在（`requireScopedAuth`、
路由级角色校验、插件 HTTP 路由的能力声明）。
但它意味着：**任何你放进 view 的输入都会以「带 cookie 的浏览器请求」形式直达服务端**。
所以：view 里绝不拼裸路径调平台管理端接口；一切写操作走 `invokeCommand`，
让内核的 `capabilityRequired` + 高危审批链条生效。
```

三个存储互不相通（帧通道 / view 通道 / 服务端 `ctx.services.storage`）的对照表见
{doc}`full-stack` §7.3。view 里写的 `storage.set('k', v)` **服务端读不到**，
跨端传数据只能靠 `invokeCommand` 或插件自己的 HTTP 路由。

---

## 7. 高度与外观

iframe 是 opaque origin（`sandbox` 里没有 `allow-same-origin`），
**宿主读不到你的文档高度**。

| 变体       | 未上报 `resize` 时                                                 |
| :--------- | :----------------------------------------------------------------- |
| `panel`    | 按容器铺满                                                         |
| `floating` | `height: ${iframeHeight ?? 180}px` —— **保底 180px**，超出部分被裁 |

所以 §4 里的 `autoResize()` 不是装饰：内容超过 180px 又不调用 `ui.resize`，
用户看到的是被裁掉的半截面板，且**无任何报错**。
宿主侧门禁为 `data.type === 'resize' && typeof data.height === 'number' && data.height > 0`，
`Number(height) | 0` 会把小数与字符串截成整数，别传 `'-1'` 以外的非法值（会被截成 `0` 而被丢弃）。

iframe 属性固定为 `sandbox="allow-scripts allow-forms allow-downloads"` + `referrerPolicy="no-referrer"`。

---

## 8. CSP 与鉴权（影响你能引什么资源）

服务端对 `.html` / `.htm` 响应头施加逐字 `PLUGIN_VIEW_CSP`，关键取值：

| 指令                         | 值                                                        | 对你的含义                                                                 |
| :--------------------------- | :-------------------------------------------------------- | :------------------------------------------------------------------------- |
| `sandbox`                    | `allow-scripts allow-forms allow-downloads`               | 没有 `allow-same-origin`、没有 `allow-popups`、没有 `allow-top-navigation` |
| `frame-ancestors`            | `'self'`                                                  | 只能被本平台页面嵌套                                                       |
| `default-src` / `script-src` | `'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:` | 可用内联脚本；**可引任意 `https:` 外部脚本**                               |
| `connect-src`                | `'self' blob: data: https:`                               | **可以从 view 直接 `fetch` 任意 https 端点**                               |
| `style-src`                  | `'self' 'unsafe-inline' data: blob: https:`               | 可内联样式、可外部样式                                                     |

```{warning}
这与 frame 通道的 `connect-src 'none'` 是**两套完全不同的策略**。
「沙箱里不能联网」只对隐藏帧成立；view HTML 能直连 https。
因此 view 里的出网**不经过** `plugin-net-preload.cjs` 与 `plugin_network_grants` 那套
服务端网络授权体系 —— 审计者看不到、`network.outbound` 能力也管不住。
需要被管控的出站请求，必须由服务端发起（见 {doc}`../reference/http-api` 与
{doc}`../reference/isolation-and-security`）。
```

鉴权中间件接受三种凭证（cookie / `?token=` / `Bearer`），
并且有一个**逃逸分支**：`sec-fetch-site === 'same-origin'`，
或 `sec-fetch-dest` 是非空且非 `document` 的字符串（即子资源请求）直接放行，不查会话。
所以 view HTML 里引同插件目录下的 CSS/JS 不需要任何 token；
而**顶层文档请求必须有有效会话**。

---

## 9. 验证清单

1. `npm run build` 后 **用 `unzip -l dist/<插件名>.zip` 确认 `storage/dashboard.html` 在里面**
   —— SDK 不会自动加，这一步最容易漏。
2. 装 ZIP 后先确认状态 `active`，再开对应界面（教师面板 / 标签页 / 白板卡片）。
3. 面板空白 → 依次查：
   - DevTools Network 看 `/plugins/<uuid>/storage/dashboard.html` 是 **404**（路径/落盘问题）、
     **401**（会话问题）还是 **200 但内容没显示**（`view` 被 strip 或槽位不支持）。
   - 「非法的插件视图路径」文字 → `sanitizeViewPath` 拒绝了（多半是 `..` 或协议前缀）。
   - Console 有 `Unsupported op "..."` → op 拼错或在用帧通道的 op 名。
4. `window.OpenLearnPluginBridge` 为 `undefined` → 忘了写那行 `<script src>`（宿主**不会自动注入**）。
5. 提交按钮无反应但服务端命令能跑 → `invokeCommand` 抛在 promise 里没 `catch`；
   view 通道的失败是以 **reject** 形式出现的（`err.message = json.error`），不是信封。
6. 内容被裁 → 没调 `ui.resize`。

更多症状对照：{doc}`../reference/frontend-sandbox` §14。

---

## 10. 提交前自检

- [ ] `view` 声明在 6 个受支持槽位之一，且值非空串
- [ ] `view` 路径以 `storage/` 开头，与 ZIP 内条目逐字一致
- [ ] ZIP 里真的有那个 HTML（`unzip -l` 验过）
- [ ] HTML 里显式 `<script src="/plugin-sandbox/view-bridge.js"></script>`
- [ ] 只使用 8 个已登记 op
- [ ] `invokeCommand` 用全限定名，且每个调用都 `try/catch`
- [ ] 写操作一律经 `invokeCommand`，不在 view 里拼 `api.del` 打到平台管理端
- [ ] 有 `ui.resize` 上报（含内容变化后的重报）
- [ ] 不假设能读到 `document.cookie` / `localStorage`（opaque origin 下与宿主不互通）
- [ ] 不依赖 view 与 `frontend.tsx` 或服务端共享 storage
- [ ] 没有把敏感出站请求放在 view 里（它绕过服务端网络授权体系）
- [ ] 若签名，签名发生在补齐 `storage/` 资源**之后**

## 取证

| 结论                                                                       | 位置                                                                                                                 |
| :------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `PLUGIN_VIEW_CSP` / `PLUGIN_VIEW_BRIDGE_JS` 全文                           | ``server/utils/plugin-view-bridge.ts`→`PLUGIN_VIEW_CSP`（L10） 起                                                    |
| 桥成员由 CI 钉住（含 `post({ type: 'ready' })`）                           | `server/__tests__/plugin-view-bridge.test.ts`，repomix L235013–L235044                                               |
| view 侧 8 个 op 与 `resize` 门禁                                           | ``src/components/PluginSandboxIframeView.tsx`→`iframe`（L112–L221）                                                  |
| `sanitizeViewPath` 与 iframe src 拼装                                      | 同文件，见 {doc}`../reference/frontend-sandbox` §5.2                                                                 |
| `view` 仅在 6 个 schema 位置；空串被拒                                     | `packages/core/esm-loader/manifest-schema.ts` v0.7.6 注释；测试 `it.each([...])('keeps view for contributes["%s"]')` |
| `storage/` 前缀才落盘 + Zip Slip 校验                                      | `packages/core/plugin-host/`（`installPluginFromZipExclusive`），repomix L108610–L108650                             |
| SDK 的 build 只写三件套（不写 `storage/`）                                 | ``packages/plugin-sdk/cli.mjs`→`ch`（L531–L535）                                                                     |
| 签名覆盖整个 ZIP 的 SHA-256（事后追加文件即失效）                          | 同文件 `signZip`，repomix L135030–L135077                                                                            |
| 安装只落盘 4 件套 + `storage/**` + `deploy.script`                         | `packages/core/plugin-host/`（`installPluginFromZipExclusive`），repomix L108604–L108650                             |
| 重启只补 `frontend.js`，不补 `storage/`                                    | `packages/core/plugin-host/`（restore 分支），repomix L112466–L112484                                                |
| `/plugins` 静态挂载与鉴权逃逸分支                                          | `server.ts`，repomix L422919–L422951                                                                                 |
| `getPluginsDir()` = `<dataDir>/plugins`，可被 `OPENLEARN_PLUGINS_DIR` 覆盖 | repomix L237606–L237613                                                                                              |
| 插件目录 = `pluginsDir/<pluginId>`                                         | ``packages/core/plugin-host/core.ts`→`baseRoute`（L198–L201）                                                        |
| `registerManifestContributions` 自动补 `commandType` 前缀、携带 `view`     | `src/plugin-host/*`，repomix L396149–L396215                                                                         |
| `PluginCardRenderer` 取 `slotProps?.view \|\| ext.view`                    | `src/features/whiteboard/widgets/PluginCardRenderer.tsx`，repomix L371896 起                                         |
| 双轨制（轨 A 无需白名单 / 轨 B 仅限受信任）与 `storage/*.html` 约定        | 平台文档 repomix L30386–L30410                                                                                       |
| 渲染优先级链与 `<script src="/plugin-sandbox/view-bridge.js">` 样例        | 平台文档 repomix L32795–L32820                                                                                       |
| `floating` 变体 180px 保底                                                 | `PluginSandboxIframeView.tsx`，见 {doc}`../reference/frontend-sandbox` §5.3                                          |
