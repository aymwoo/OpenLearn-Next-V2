# OpenLearnV2 — Educational OS

插件驱动的在线教学平台（LMS），基于命令-事件总线架构设计，支持 AI Agent 辅助教学。

## 技术栈

**前端：** React 19 · Vite 6 · TailwindCSS 4 · TypeScript 5.8 · Zustand · Konva  
**后端：** Express 4 · better-sqlite3 · Socket.IO · Node.js Worker Threads  
**AI：** Gemini / OpenAI 兼容 API  
**部署：** PM2 + Nginx + Docker  

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
echo "GEMINI_API_KEY=你的密钥" > .env

# 启动开发服务
./dev.sh
# 或：npm run dev

# 访问
open http://localhost:9000
```

默认账号：`admin` / `admin`（管理员），`teacher` / `teacher`（教师）

## 生产部署

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本自动完成：构建 → 生成 Nginx 配置 → 配置 PM2 → 生成加密密钥。  
访问 `http://服务器IP` 或通过 Nginx 反向代理。

## 项目结构

```
├── server.ts                    # Express + Socket.IO + API 路由
├── packages/
│   ├── core/                    # OS 内核
│   │   ├── kernel/              # 内核容器，组装子系统
│   │   ├── command-bus/         # 命令总线（注册 handler，执行命令）
│   │   ├── event-bus/           # 事件总线（发布/订阅，审计日志）
│   │   ├── registry/            # AI Agent 工具注册表
│   │   ├── capability-system/   # 权限守卫（RBAC）
│   │   ├── plugin-host/         # 插件生命周期 + 上下文构建
│   │   ├── worker-runtime/      # Worker Thread 隔离执行
│   │   ├── esm-loader/          # ESM 动态加载（data: URL）
│   │   ├── di/                  # Token 依赖注入容器
│   │   ├── db/                  # SQLite 数据库（30+ 表）
│   │   └── process-manager/     # 后台进程/定时任务
│   └── plugins/                 # 内置插件
│       ├── builtin.ts           # 课程·白板·课件·插件管理
│       ├── management.ts        # 班级·学生·作业·排课·考勤
│       ├── vfs.ts               # 虚拟文件系统
│       ├── process.ts           # 进程管理
│       ├── ai-planner.ts        # AI 自动规划
│       ├── ai-submit-injector.ts # LMS SDK 注入课件
│       └── assignment-eval.ts   # 作业提交·互评·评分
├── src/
│   ├── App.tsx                  # 主应用组件
│   ├── components/              # UI 组件（24 个）
│   ├── features/                # 业务模块（白板·课件）
│   ├── services/                # 前端服务（EventBus·Socket·API）
│   ├── store/                   # Zustand 状态管理
│   └── hooks/                   # 自定义 Hooks
├── server/                      # 服务端模块（自 v5.0）
│   ├── middleware/auth.ts       # 认证中间件
│   ├── routes/auth.ts           # 认证路由
│   └── utils/                   # 工具（加密·迁移·日志·上传）
├── nginx.conf                   # Nginx 配置模板
├── deploy.sh                    # 一键部署脚本
├── ecosystem.config.cjs         # PM2 配置
├── Dockerfile
└── docker-compose.yml
```

## 核心架构

### OS 内核

`Kernel` 是全局单例，组装 10 个子系统：

| 层 | 子系统 | 职责 |
|----|--------|------|
| L0 | EventBus | 发布/订阅，通配符匹配，自动审计日志 |
| L0 | CapabilityGuard | 字符串 RBAC（`lesson:write`、`*:*:*`） |
| L0 | ServiceRegistry | Token DI 容器（拓扑排序，循环检测） |
| L1 | CommandBus | 命令执行管线 + 拦截器链（权限 + 高危审批） |
| L1 | ActionRegistry | AI Agent 工具注册表 |
| L2 | ProcessManager | 后台进程/定时任务 |
| L2 | EsmLoader | ESM 动态加载（Node.js data: URL） |
| L2 | PluginHost | 插件生命周期管理 + 热重载 |
| L3 | WorkerManager | Worker Thread 隔离 + RPC 代理 |
| — | DB | SQLite WAL 模式，30+ 张表 |

### 插件系统

插件以 ZIP 包分发，通过 PluginCenter 上传安装：

```
ext-exam.zip
├── manifest.json     # id, name, version, capabilitiesProposed, classroomTools
├── server/index.js   # activate(ctx) → 注册 CommandHandler + Action
└── frontend/         # React 组件（挂载到 Extension Slot）
```

**插件能力（v5.1）：**
- 命令注册 + AI Agent 工具注册
- 事件发布/订阅 + 审计日志
- 自建数据库表（`ctx.db.ensureTable()`）
- 共享依赖引用（`ctx.require('recharts')`）
- 前端 Extension Slot（`teacher.panel` 等 8 个）
- Worker Thread 隔离执行

**已安装的课堂工具：** 选择题测验 · 专业测验 · 随机点名 · 思维导图 · 计时器 · 代码沙箱 · 数学图形

### 事件通信

```
教师操作白板
  ├─ 实时绘制（高频）→ Socket.IO 直连（< 500ms）
  └─ 结构操作        → frontendEventBus → SocketBridge → server EventBus
                        ├─ SQLite events 表（审计）
                        └─ io.to(room).emit()（其他客户端）
```

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务 |
| `npm run build` | 生产构建（Vite + esbuild） |
| `npm start` | 运行生产构建 |
| `npm test` | 运行测试 |
| `npm run lint` | TypeScript 类型检查 |

## 环境变量

| 变量 | 必需 | 说明 |
|------|:--:|------|
| `GEMINI_API_KEY` | ✅ | 默认 AI 服务密钥（也可在管理面板配置第三方 AI） |
| `ENCRYPTION_KEY` | ✅ | 64 位 hex，AI Provider API Key 加密密钥（`deploy.sh` 自动生成） |
| `LOG_LEVEL` | — | 日志级别（debug / info / warn / error），默认 info |
| `ALLOWED_ORIGINS` | — | CORS 白名单，逗号分隔 |
