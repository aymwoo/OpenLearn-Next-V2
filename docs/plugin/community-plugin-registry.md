# 社区插件市场 (Community Plugin Registry)

<!-- doc-version: sdk=3.7.2 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.2`

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

| 字段                      | 必填   | 说明                                                                                                                                                                                         |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | ✅     | 插件逻辑 id，必须与插件 `manifest.json` 的 `id` 完全一致，用于识别「已安装 / 可更新」。允许 `@scope/name` 形式。                                                                             |
| `downloadUrl`             | ✅     | 插件 ZIP 包地址。**必须为公网 HTTP(S)**，否则整条记录被丢弃。服务端与浏览器均会访问该地址。                                                                                                  |
| `name`                    | —      | 展示名称，缺失时回落为 `id`。                                                                                                                                                                |
| `author`                  | —      | 作者，缺失时回落为 `Community`。                                                                                                                                                             |
| `version`                 | —      | 语义化版本。与本地已安装版本比较以决定是否显示「更新」。非 semver 的值仍会展示，但永不判定为可更新。                                                                                         |
| `icon`                    | —      | 图片 URL 或 emoji（如 `"📚"`）。                                                                                                                                                             |
| `homepage` / `repository` | —      | 仅接受公网 HTTP(S) 地址；不安全时置空但保留记录。                                                                                                                                            |
| `tags`                    | —      | 数组或逗号分隔字符串，最多保留 8 个标签，用于前端筛选。                                                                                                                                      |
| `capabilities`            | —      | 插件申请的权限，用于在卡片上提示权限数量（悬停查看完整列表）。                                                                                                                               |
| `downloads` / `stars`     | —      | 非负数字或数字字符串，用于展示与默认排序。                                                                                                                                                   |
| `integrity` / `signature` | 安装时 | `integrity` 是 ZIP 的 sha256 十六进制或 `sha256-` base64。`signature` 是对结构化元数据载荷（或哈希原文）的 Ed25519 签名（base64）。社区来源强制要求同时存在 `integrity` 与有效 `signature`。 |
| `publisher`               | —      | 发布者标识或公钥 ID，与签名元数据保持一致。                                                                                                                                                  |
| `verified` / `featured`   | —      | `featured` 仍由注册表布尔值决定。`verified` 会被服务端忽略，不再把条目标成已认证。                                                                                                           |

### 签名载荷与 SDK 签名工具

社区插件包要求使用 Ed25519 私钥签署。签名载荷遵循结构化绑定格式：

```text
openlearn-plugin-attestation-v2
<plugin-id>
<version>
<sha256-hex-or-base64>
```

插件开发者可通过 `@openlearn/plugin-sdk` CLI 一键完成打包并签名：

```bash
# 构建并直接签名打包
npx @openlearn/plugin-sdk build --key publisher-private.pem --publisher "Alice Dev"

# 为已有 ZIP 签署签名并注入 signature.json
npx @openlearn/plugin-sdk sign --key publisher-private.pem --publisher "Alice Dev" my-plugin.zip
```

执行后将输出计算得到的 `Integrity` 与 `Signature`，可直接填入注册表清单；同时 ZIP 根目录下会自动嵌入包含发布者身份信息的 `signature.json`。

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
  "executionMode": "process",
  "acknowledgeRisk": true,
  "approvePublicRoutes": false
}
```

`acknowledgeRisk` 必须为 JSON 布尔值 `true`。缺省或其它值在 URL 安全校验通过后返回 HTTP 400，`code` 为 `COMMUNITY_RISK_ACK_REQUIRED`，此时不会下载包。`approvePublicRoutes: true` 才会把清单里 `auth: false` 的路由记入 `plugin_public_routes`；默认不传则不公开。`approveCapabilities: true` 才会把 `capabilitiesProposed` 写入批准表。未列入 `OPENLEARN_TRUSTED_INLINE_PLUGINS`、且文件不在内置目录的插件，即使 id 以 `@openlearn/` 开头、即使传入 `executionMode: "worker"` 或 `"inline"`，实际仍为 `process`，响应带 `executionModeCoerced: true`。

处理流程：

1. 校验 `downloadUrl` 通过出站安全校验、`expectedId` 符合插件 id 规范；
2. 要求 `acknowledgeRisk === true`，否则 400 且不下载；
3. 要求 `OPENLEARN_COMMUNITY_INSTALL=1`，否则 403，`code` 为 `COMMUNITY_INSTALL_DISABLED`；
4. 要求请求体同时带 `integrity` 与 `signature`，否则 400，`code` 为 `COMMUNITY_ATTESTATION_REQUIRED`，此时不下载；
5. 服务端下载 ZIP。下载失败返回 HTTP 400 + `fallbackToClient: true`。下载成功后按 `OPENLEARN_COMMUNITY_PUBKEY` 验签，失败则删除临时包；
6. 若 `expectedId` 对应的插件已在本机安装 ⇒ 走 `updateFromZip`（`allowDowngrade` 默认 `false`）；否则走 `installFromZip`，并按受信策略落执行模式。

**错误码说明**：

| 错误代码                         | 说明                                                              |
| :------------------------------- | :---------------------------------------------------------------- |
| `COMMUNITY_INTEGRITY_REQUIRED`   | 社区插件包未声明 `integrity` (SHA-256)，被拒绝                    |
| `COMMUNITY_ATTESTATION_REQUIRED` | 社区包缺少 `signature` 或请求体/请求头缺少凭据                    |
| `COMMUNITY_PUBKEY_MISSING`       | 宿主未配置信任公钥 (`OPENLEARN_COMMUNITY_PUBKEY`)，拒绝安装社区包 |
| `COMMUNITY_INTEGRITY_MISMATCH`   | 完整性哈希与下载包不匹配（防网络损坏与中间人篡改）                |
| `COMMUNITY_SIGNATURE_INVALID`    | 签名无效、密钥不匹配或非受信发布者                                |

---

## 4. 前端界面

`src/components/plugin-center/sub-views/PluginCommunityPanel.tsx`，挂载于插件中心顶部的 **社区 (Community)** 标签页。

- **预览卡片**：图标、名称、作者、版本、认证/精选角标、描述、标签、权限数量、下载量与收藏数、源码与主页外链；
- **筛选与排序**：关键词搜索（名称/作者/标签/id）、高频标签芯片、推荐 / 下载最多 / 按名称排序、一键隐藏已安装；
- **安装反馈**：点击安装先打开风险说明（`data-testid="community-install-risk-dialog"`）。确认后请求体带 `acknowledgeRisk: true`；「同时批准公开路由」默认不勾。成功后卡片进入已安装态，并触发插件列表刷新（插件的前端贡献点在启动时注册，故安装完成后需要重新加载页面才会生效）；
- **状态覆盖**：骨架屏加载、可重试错误态、空注册表、筛选无结果、未配置注册表指引。

---

## 5. 相关实现

| 文件                                                              | 职责                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/core/security/plugin-signature.ts`                      | 统一非对称签名校验、Ed25519 载荷结构化绑定、多公钥 Keyring 解析与来源分级安全策略 |
| `packages/core/plugin-host/plugin-distribution-manager.ts`        | 插件分发与仓库管理，集成完整性与签名门禁                                          |
| `packages/plugin-sdk/cli.mjs`                                     | SDK CLI 打包构建与 `sign` 签名命令                                                |
| `server/services/community-attest.ts`                             | 社区包验签服务桥接                                                                |
| `server/utils/url-safety.ts`                                      | 共享出站 URL 安全校验（SSRF 防护）                                                |
| `server/routes/plugins.ts`                                        | `GET /api/plugins/community` 与 `POST /api/plugins/install-from-url`              |
| `src/components/plugin-center/sub-views/PluginCommunityPanel.tsx` | 社区页 UI 与安装交互                                                              |
| `server/__tests__/community-registry.test.ts`                     | 归一化 / 缓存 / 安全校验 / 下载限制单测                                           |
| `server/__tests__/community-routes.test.ts`                       | 路由鉴权与入参门禁契约测试                                                        |
| `src/components/__tests__/PluginCommunityPanel.test.tsx`          | 面板渲染 / 筛选 / 安装与回退路径测试                                              |
