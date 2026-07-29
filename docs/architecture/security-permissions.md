# Security & Permissions 安全与权限模型

OpenLearn V2 的安全体系涵盖用户鉴权、基于角色的访问控制（RBAC）、插件沙箱隔离（Worker Thread Sandbox）、Prompt 注入防护及加密防篡改机制。

---

## 1. 身份认证与 RBAC 权限矩阵

平台用户划分为三种核心角色（`Admin`, `Teacher`, `Student`）：

- **JWT + Secure Cookie**: 登录成功后发放 HttpOnly JWT Cookie（`getCookieToken`）。
- **权限校验中间件**: `checkIsTeacherOrAdmin` 拦截敏感 API（如修改课程、发布作业、修改系统配置）。

| 操作 / API | Admin | Teacher | Student | Plugin |
|---|---|---|---|---|
| 创建/修改课程 | ✅ | ✅ | ❌ | 依赖 Manifest 授权 |
| 查看全班学习分析 | ✅ | ✅ | 仅查看个人 | 依赖 Manifest 授权 |
| 访问 SQLite 数据库 | ✅ | ❌ | ❌ | ❌ (只能用 Plugin DB) |
| 修改系统密钥配置 | ✅ | ❌ | ❌ | ❌ |

---

## 2. Worker Thread 沙箱隔离

插件在独立 Worker Thread 中运行：
- **无 DOM 访问**: 插件线程中无 `window`, `document` 对象。
- **IPC 通信网关**: 所有 API 调用必须通过序列化的 MessageChannel 进行。
- **资源限额**: 监控 CPU 与内存占用，超限自动挂起（State 置为 `ERROR` / `PAUSED`）。

---

## 3. Prompt 注入防护与 API Key 加密

针对 AI 能力集成提供额外的安全层（`server/utils/crypto.ts`）：
- **Prompt Injection Detection**: 自动检测注入攻击指令（如 `"ignore previous instructions"`）。
- **API Key Masking & AES Encryption**: 所有大模型 API Keys 在 SQLite 中均通过 AES-256-GCM 加密存储，在 UI 中提供掩码展示。

---

## 4. iframe Courseware Security

- **Helmet CSP `frame-src` configuration**: The server's Content Security Policy `frame-src` directive is configured to allow `'self'`, `blob:`, `data:`, `http://localhost`, `http://127.0.0.1`, `http:`, and `https:` origins for iframe courseware embedding.
- **iframe sandbox attribute**: Courseware is sandboxed using the `sandbox` attribute (`allow-scripts allow-forms allow-downloads` without `allow-same-origin`) to ensure strict cross-origin isolation.
- **Bridge SDK Proxy pattern**: Cross-origin `postMessage` normalization is securely handled via the Bridge SDK utilizing the `Object.defineProperty + Proxy` pattern to shadow `window.parent` and `window.top` on cross-origin WindowProxies.
