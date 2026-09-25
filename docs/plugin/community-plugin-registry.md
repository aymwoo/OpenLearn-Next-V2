# 社区插件市场 (Community Plugin Registry)

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0`

社区插件市场允许管理员从**运维自管的远端 JSON 注册表**中发现并一键安装第三方插件，无需用户手工下载 ZIP 再上传。

平台本身**不托管**任何社区插件包：它只负责「发现 + 安装」，插件包的下载与分发归属注册表运营方。

---

## 1. 配置注册表地址

注册表地址通过环境变量配置，**默认留空** —— 平台不会内置指向第三方域名的硬编码地址。

```bash
# .env
PLUGIN_COMMUNITY_REGISTRY_URL="https://example.com/community-plugins.json"
```

未配置时，插件中心「社区」页会展示明确的配置指引，而不是报错。修改该变量后需重启服务端进程。

地址必须通过出站安全校验（`server/utils/url-safety.ts` 的 `isSafeExternalUrl`）：

| 允许                        | 拒绝                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| 公网 `http://` / `https://` | `file:`、`ftp:` 等非 HTTP(S) 协议                                 |
| —                           | `localhost`、`*.localhost`、`*.local`、`0.0.0.0`、`::1`           |
| —                           | 私有网段 `10/8`、`172.16/12`、`192.168/16`、回环 `127/8`          |
| —                           | 链路本地 `169.254/16`（含云元数据端点）、`0.0.0.0/8`、多播/保留段 |

### 与「发现」页的区别

| 页面             | 数据来源                 | 作用                                     |
| ---------------- | ------------------------ | ---------------------------------------- |
| 发现 (Discover)  | 本地 SQLite `plugins` 表 | 管理**已安装**插件的启停、配置与版本更新 |
| 社区 (Community) | 环境变量指向的远端 JSON  | 发现并**安装**尚未安装的插件             |

---

## 2. 注册表 JSON 格式

推荐使用带信封的 v1 格式：

```json
{
  "version": 1,
  "updatedAt": "2026-02-01T00:00:00Z",
  "plugins": [
    {
      "id": "ext-homework-hub",
      "name": "作业中心",
      "description": "面向课堂的作业收发与批改面板",
      "author": "aymwoo",
      "version": "1.2.0",
      "downloadUrl": "https://plugins.example.com/ext-homework-hub/1.2.0.zip",
      "icon": "https://plugins.example.com/icons/homework-hub.png",
      "homepage": "https://example.com/homework-hub",
      "repository": "https://github.com/aymwoo/ext-homework-hub",
      "license": "MIT",
      "tags": ["作业", "评价"],
      "capabilities": ["student:read"],
      "minPlatformVersion": "0.3.0",
      "publishedAt": "2026-01-02T03:04:05Z",
      "downloads": 1200,
      "stars": 45,
      "verified": true,
      "featured": false
    }
  ]
}
```

同时兼容 `{ "items": [...] }` 与**裸数组** `[ {...} ]` 形式，便于手工维护极简清单。

### 字段说明

| 字段                      | 必填 | 说明                                                                                                             |
| ------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `id`                      | ✅   | 插件逻辑 id，必须与插件 `manifest.json` 的 `id` 完全一致，用于识别「已安装 / 可更新」。允许 `@scope/name` 形式。 |
| `downloadUrl`             | ✅   | 插件 ZIP 包地址。**必须为公网 HTTP(S)**，否则整条记录被丢弃。服务端与浏览器均会访问该地址。                      |
| `name`                    | —    | 展示名称，缺失时回落为 `id`。                                                                                    |
| `author`                  | —    | 作者，缺失时回落为 `Community`。                                                                                 |
| `version`                 | —    | 语义化版本。与本地已安装版本比较以决定是否显示「更新」。非 semver 的值仍会展示，但永不判定为可更新。             |
| `icon`                    | —    | 图片 URL 或 emoji（如 `"📚"`）。                                                                                 |
| `homepage` / `repository` | —    | 仅接受公网 HTTP(S) 地址；不安全时置空但保留记录。                                                                |
| `tags`                    | —    | 数组或逗号分隔字符串，最多保留 8 个标签，用于前端筛选。                                                          |
| `capabilities`            | —    | 插件申请的权限，用于在卡片上提示权限数量（悬停查看完整列表）。                                                   |
| `downloads` / `stars`     | —    | 非负数字或数字字符串，用于展示与默认排序。                                                                       |
| `verified` / `featured`   | —    | 布尔值（也接受 `"true"` / `1`）。`featured` 排序时优先置顶。                                                     |

### 归一化与容错策略

- 缺少 `id`、`id` 含非法字符、缺少 `downloadUrl`、或 `downloadUrl` 未通过出站安全校验 ⇒ **整条记录被丢弃**，并在响应中以 `skipped` 计数返回，前端提示「N 条记录被忽略」。
- 同名 `id` 重复 ⇒ 保留**首次出现**的记录，避免安装目标歧义。
- 单条记录字段超长、类型不符 ⇒ 字段级截断或回落，不影响同批复其他记录。
- 条目上限 500 条；响应体超过 5MB 直接拒绝解析。

---

## 3. 服务端接口

### `GET /api/plugins/community`

要求有效会话（教师及以上均可查看）。

| 查询参数    | 说明                            |
| ----------- | ------------------------------- |
| `refresh=1` | 跳过 5 分钟内存缓存，强制回源。 |

响应：

```json
{
  "success": true,
  "configured": true,
  "source": "https://example.com/community-plugins.json",
  "registryVersion": 1,
  "fetchedAt": 1767323045000,
  "cached": false,
  "plugins": [{ "id": "ext-homework-hub", "installedVersion": "1.0.0", "hasUpdate": true, "...": "..." }],
  "skipped": 0,
  "envVar": "PLUGIN_COMMUNITY_REGISTRY_URL"
}
```

- `installedVersion` / `hasUpdate` 由服务端对照本地 `plugins` 表中的 `manifest.id` 与版本填充，注册表**无需**提供这两个字段。
- 拉取失败（超时、非 2xx、JSON 非法）时返回 HTTP 200 + `error` 字段 + 空 `plugins`，前端渲染可重试的错误态；**失败结果不写入缓存**。
- 缓存按 `(注册表地址 + 已安装插件集合)` 维度隔离，TTL 5 分钟，容量上限 16 条。

### `POST /api/plugins/install-from-url`

**管理员专属** —— 服务端会下载并加载第三方代码，风险等级等同于 ZIP 上传安装。

```json
{
  "downloadUrl": "https://plugins.example.com/ext-homework-hub/1.2.0.zip",
  "expectedId": "ext-homework-hub",
  "allowDowngrade": false,
  "executionMode": "worker"
}
```

处理流程：

1. 校验 `downloadUrl` 通过出站安全校验、`expectedId` 符合插件 id 规范；
2. 服务端下载 ZIP（60 秒超时，`content-length` 或实际体积超过 200MB 直接拒绝，空包拒绝）；
3. 若 `expectedId` 对应的插件已在本机安装 ⇒ 走 `updateFromZip`（`allowDowngrade` 默认 `false`）；
4. 否则 ⇒ 走 `installFromZip` 全新安装。

**浏览器直传回退**：步骤 2 失败时返回 HTTP 400 + `fallbackToClient: true`，前端随即在浏览器中下载同一个 ZIP，并以 `Content-Type: application/octet-stream` 直传既有的 `POST /api/plugins/upload-zip-raw`（这是大包或服务端网络受限场景的兜底路径，与「一键热更新」保持同一策略）。

---

## 4. 前端界面

`src/components/plugin-center/sub-views/PluginCommunityPanel.tsx`，挂载于插件中心顶部的 **社区 (Community)** 标签页。

- **预览卡片**：图标、名称、作者、版本、认证/精选角标、描述、标签、权限数量、下载量与收藏数、源码与主页外链；
- **筛选与排序**：关键词搜索（名称/作者/标签/id）、高频标签芯片、推荐 / 下载最多 / 按名称排序、一键隐藏已安装；
- **安装反馈**：按钮在「安装 → 下载中 → 安装完成」之间切换，安装成功后卡片立即进入已安装态，并触发插件列表刷新（插件的前端贡献点在启动时注册，故安装完成后需要重新加载页面才会生效）；
- **状态覆盖**：骨架屏加载、可重试错误态、空注册表、筛选无结果、未配置注册表指引。

---

## 5. 相关实现

| 文件                                                              | 职责                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `server/services/community-registry.ts`                           | 注册表拉取、归一化、缓存、安装状态标注、ZIP 下载与体积上限           |
| `server/utils/url-safety.ts`                                      | 共享出站 URL 安全校验（SSRF 防护）                                   |
| `server/routes/plugins.ts`                                        | `GET /api/plugins/community` 与 `POST /api/plugins/install-from-url` |
| `src/components/plugin-center/sub-views/PluginCommunityPanel.tsx` | 社区页 UI 与安装交互                                                 |
| `server/__tests__/community-registry.test.ts`                     | 归一化 / 缓存 / 安全校验 / 下载限制单测                              |
| `server/__tests__/community-routes.test.ts`                       | 路由鉴权与入参门禁契约测试                                           |
| `src/components/__tests__/PluginCommunityPanel.test.tsx`          | 面板渲染 / 筛选 / 安装与回退路径测试                                 |
