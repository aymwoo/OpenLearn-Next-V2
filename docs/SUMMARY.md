# OpenLearnV2 文档汇总

> 本文件汇总 `docs/` 下全部文档：
> - `installation-guide.md` — 安装与使用指南
> - `architecture_review_report.md` — 核心架构与设计
> - `plugin-development-tutorial.md` — 插件开发完全指南
> - `scaffold.md` — 插件脚手架开发指南
>
> 汇总时间：2026-07-17

## 总目录

- [第 1 章 安装与使用指南](#第-1-章-安装与使用指南)
- [第 2 章 核心架构与设计](#第-2-章-核心架构与设计)
- [第 3 章 插件开发完全指南](#第-3-章-插件开发完全指南)
- [第 4 章 插件脚手架开发指南](#第-4-章-插件脚手架开发指南)

---

# 第 1 章 安装与使用指南

## 目录

1. [系统需求](#1-系统需求)
2. [快速开始](#2-快速开始)
3. [环境变量](#3-环境变量)
4. [首次登录与账户管理](#4-首次登录与账户管理)
5. [系统界面与导航](#5-系统界面与导航)
6. [教学流程](#6-教学流程)
7. [插件管理](#7-插件管理)
8. [AI Agent 使用](#8-ai-agent-使用)
9. [生产部署](#9-生产部署)
10. [常见问题](#10-常见问题)

---

## 1. 系统需求

### 硬件要求

| 环境 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| 开发 / 个人使用 | 2 核+ | 2 GB+ | 1 GB+ |
| 生产部署（30 人并发） | 4 核+ | 4 GB+ | 10 GB+ |

### 软件要求

- **Node.js** ≥ 18.x（推荐 20.x LTS 或更高）
- **npm** ≥ 9.x（随 Node.js 提供）
- **操作系统**：Linux（推荐）、macOS、Windows（WSL2 推荐）

验证安装：

```bash
node --version   # 应输出 v18.0.0 或更高
npm --version    # 应输出 9.0.0 或更高
```

---

## 2. 快速开始

### 方式一：npx 一键启动（推荐）

无需 clone 项目，首次运行时自动下载安装：

```bash
# 默认端口 9000
npx openlearn-next

# 自定义端口
npx openlearn-next -p 3000

# 自定义数据库路径（默认 ~/openlearn-next/data.db）
OPENLEARN_DB_PATH=./my.db npx openlearn-next
```

启动后访问 `http://localhost:9000` 即可进入系统。

### 方式二：npm 全局安装

```bash
npm install -g openlearn-next
openlearn-next
```

更新到最新版：

```bash
npm update -g openlearn-next
```

### 方式三：本地开发环境

适合需要修改源码或开发插件的场景：

```bash
# 克隆仓库
git clone <仓库地址> openlearnv2
cd openlearnv2

# 安装依赖
npm install

# 配置 AI API 密钥
echo "GEMINI_API_KEY=你的密钥" > .env

# 启动开发服务（Express + Vite HMR）
./dev.sh
# 或：npm run dev

# 访问
open http://localhost:9000
```

---

## 3. 环境变量

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```bash
# .env
GEMINI_API_KEY=your-gemini-api-key
PORT=9000
ENCRYPTION_KEY=your-64-char-hex-key
LOG_LEVEL=info
ALLOWED_ORIGINS=http://localhost:5173
```

| 变量 | 必需 | 说明 |
|------|:--:|------|
| `GEMINI_API_KEY` | ✅ | Gemini API 密钥，可从 [Google AI Studio](https://aistudio.google.com/) 免费获取 |
| `PORT` | — | 服务端口，默认 `9000` |
| `ENCRYPTION_KEY` | ✅ | 64 位 hex，用于加密 AI Provider API Key。`deploy.sh` 可自动生成 |
| `OPENLEARN_DB_PATH` | — | SQLite 数据库路径。npx 默认 `~/openlearn-next/data.db`，本地开发默认项目目录 |
| `LOG_LEVEL` | — | 日志级别：`debug` / `info` / `warn` / `error`，默认 `info` |
| `ALLOWED_ORIGINS` | — | CORS 白名单，逗号分隔 |

> **提示**：可在管理面板中配置第三方 AI 服务（OpenAI 兼容 API），无需修改 `.env` 即可切换模型。

---

## 4. 首次登录与账户管理

### 默认账户

系统预置两个角色账户，初次使用时可直接登录：

| 用户名 | 密码 | 角色 | 权限范围 |
|--------|------|------|----------|
| `admin` | `admin` | 系统管理员 | 全部功能：用户管理、插件管理、系统配置 |
| `teacher` | `teacher` | 教师 | 课程管理、班级管理、课堂直播、课件分发 |

> **安全提醒**：首次登录后请立即修改默认密码。

### 注册新账户

1. 在登录页点击「注册账号」
2. 填写用户名、密码，选择角色（教师/学生）
3. 管理员可通过用户管理面板审核和管理注册用户

### 角色说明

```
┌─────────────────────────────────────────────────┐
│                  角色体系                       │
├──────────┬──────────────────────────────────────┤
│ 管理员   │ 系统配置、用户管理、插件安装/卸载、   │
│          │ 全局数据管理                         │
├──────────┼──────────────────────────────────────┤
│ 教师     │ 课程创建、班级管理、课堂直播、       │
│          │ 课件分发、AI Agent 辅助教学、        │
│          │ 作业批改、考勤统计                   │
├──────────┼──────────────────────────────────────┤
│ 学生     │ 查看课程、参与直播课堂、             │
│          │ 完成作业/课件、查看成绩              │
└──────────┴──────────────────────────────────────┘
```

---

## 5. 系统界面与导航

### 主界面布局

登录后进入主工作台，界面采用**侧边栏 + 内容区**布局：

- **顶部栏**：系统标题、当前用户信息、快捷操作入口
- **左侧边栏**：功能导航（课程管理、班级管理、插件中心、系统设置）
- **中央区域**：当前模块的操作内容

### 主要功能模块

| 模块 | 路径 | 说明 |
|------|------|------|
| 课程管理 | 侧边栏 → 课程 | 创建/编辑课程、排课、课件上传 |
| 班级管理 | 侧边栏 → 班级 | 创建班级、添加学生、查看班级数据 |
| 直播课堂 | 课程 → 进入课堂 | 实时白板、互动工具、学生管理 |
| 插件中心 | 侧边栏 → 插件 | 浏览/安装/卸载插件 |
| 用户管理 | 管理面板 | 用户列表、角色分配、权限设置 |
| AI Agent | 右下角浮动按钮 | 自然语言控制教学操作 |

---

## 6. 教学流程

### 教师操作全流程

以下是一个完整的教学操作流程：

#### 6.1 创建课程

1. 点击侧边栏「课程管理」
2. 点击「新建课程」，填写课程名称、描述
3. 为课程添加**教学环节**（Segments），定义每个环节的标题和时长

示例课程结构：

```
计算机网络基础
├── 环节1: 课程导入（5m）
├── 环节2: 核心讲解（20m）
├── 环节3: 课堂测验（10m）
└── 环节4: 总结答疑（5m）
```

#### 6.2 创建班级

1. 点击侧边栏「班级管理」
2. 点击「新建班级」，填写班级名称
3. 将学生添加到班级中

#### 6.3 进入直播课堂

1. 进入课程详情页
2. 选择要授课的班级，点击「进入课堂」
3. 课堂界面分为三栏：
   - **左侧**：教学环节列表 + 环节计时器
   - **中央**：实时白板（支持手写/文字/图形/课件）
   - **右侧**：互动工具面板 + 学生提交数据

#### 6.4 使用课堂工具

在直播课堂中，教师可使用以下**课堂互动工具**：

| 工具 | 说明 |
|------|------|
| 课件管理 | 上传 HTML 课件，自动分发到学生端，实时采集成绩 |
| 选择题测验 | 创建单选题/多选题，实时统计正确率 |
| 随机点名 | 从班级中随机选取学生回答问题 |
| 思维导图 | 协作编辑思维导图 |
| 计时器 | 设定倒计时，同步广播至所有学生端 |
| 代码沙箱 | 在线编程练习环境 |
| 数学图形 | 几何图形绘制与演示 |

#### 6.5 课件管理

通过「课件管理」工具，教师可以：

1. **上传课件**：上传交互式 HTML 课件，系统自动注入成绩采集 SDK
2. **发布课件**：发布后学生端可见，学生完成课件后成绩自动回传
3. **查看成绩**：查看每个学生的成绩分布和通过率
4. **版本管理**：同一课件支持多版本，新版本上传后旧版本自动归档

---

## 7. 插件管理

### 浏览与安装插件

1. 以管理员身份登录
2. 点击侧边栏「插件中心」
3. 浏览可用插件列表，查看插件详情（功能说明、所需权限）
4. 点击「安装」按钮上传 ZIP 插件包
5. 安装后可在「已安装」列表中启用/停用插件

### 插件权限管理

安装插件时，系统会展示该插件请求的**能力声明**（Capabilities），例如：

- `courseware:read` / `courseware:write` — 课件数据读写权限
- `lesson:read` — 课程数据读取权限
- `vfs:read` / `vfs:write` — 虚拟文件系统读写权限

管理员可以在安装时授予或拒绝特定能力。

### 开发自己的插件

参见 [第 3 章 插件开发完全指南](#第-3-章-插件开发完全指南) 和 [第 4 章 插件脚手架开发指南](#第-4-章-插件脚手架开发指南)。

---

## 8. AI Agent 使用

### 什么是 AI Agent

AI Agent 是 OpenLearnV2 的智能助手，通过自然语言即可控制教学操作。它基于 Gemini / OpenAI 模型，将自然语言指令转换为系统命令。

### 使用方式

1. 点击右下角的 **AI Agent 浮动按钮**
2. 在弹出的对话框中输入自然语言指令
3. AI Agent 自动解析意图并执行操作

### 指令示例

| 指令类型 | 示例 |
|----------|------|
| 课程管理 | 「帮我创建一个名为 Python 入门的课程」 |
| 班级管理 | 「把张三、李四添加到计算机网络班」 |
| 课件操作 | 「上传这份 HTML 课件，标题叫数据结构演示」 |
| 数据查询 | 「计算机网络班的测验平均分是多少」 |
| 课堂操作 | 「开始课堂测验，题目是...」 |

> **提示**：AI Agent 的能力取决于已安装的插件。每个插件可以注册自己的 AI 工具（Action），安装更多插件可以扩展 AI Agent 的操作能力。

---

## 9. 生产部署

### 一键部署脚本

项目提供 `deploy.sh` 脚本，自动完成构建和配置：

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本自动完成：

1. 安装依赖并构建生产包
2. 生成 Nginx 反向代理配置
3. 配置 PM2 进程管理
4. 生成 `ENCRYPTION_KEY` 加密密钥
5. 启动服务

### 手动部署步骤

```bash
# 1. 构建
npm run build

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填写 GEMINI_API_KEY 和 ENCRYPTION_KEY

# 3. 启动服务
npm start
```

### PM2 进程管理

```bash
# 使用 PM2 启动
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status

# 查看日志
pm2 logs openlearn

# 设置开机自启
pm2 save
pm2 startup
```

### Nginx 反向代理

`deploy.sh` 会自动生成 Nginx 配置。手动配置示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Docker 部署

```bash
# 构建镜像
docker build -t openlearnv2 .

# 使用 docker-compose 启动
docker-compose up -d
```

> **注意**：Docker 部署时，数据存储在容器内的 SQLite 文件中。建议挂载 volume 以持久化数据：`docker run -v ./data:/app/data openlearnv2`。

---

## 10. 常见问题

### Q: 启动后无法访问？

- 检查端口是否被占用：`lsof -i :9000`
- 检查防火墙是否放行端口
- 确认 `.env` 文件中 `GEMINI_API_KEY` 已正确配置

### Q: AI Agent 功能不可用？

- 确认 `GEMINI_API_KEY` 已正确设置
- 可在管理面板中切换 AI 提供商（Gemini / OpenAI 兼容接口）
- 检查网络是否能访问 AI API 地址

### Q: 插件安装后不显示？

- 确认插件状态为「已启用」
- 检查插件所需的权限是否已授予
- 刷新页面后重试
- 查看服务端日志：`npm run dev` 模式下终端可见，PM2 模式用 `pm2 logs`

### Q: 如何备份数据？

OpenLearnV2 使用 SQLite 数据库存储所有数据。备份只需复制数据库文件：

```bash
# 查找数据库路径
# 本地开发：项目根目录下的 educational_os.db
# npx 安装：~/openlearn-next/data.db

# 备份
cp educational_os.db educational_os.db.backup.$(date +%Y%m%d)
```

### Q: 如何重置系统？

```bash
# 停止服务后删除数据库文件
rm educational_os.db

# 重新启动，系统会自动创建新数据库并预置默认账户
npm run dev
```

---

# 第 2 章 核心架构与设计

## 目录

1. [设计理念](#1-设计理念-1)
2. [系统架构总览](#2-系统架构总览)
3. [核心子系统](#3-核心子系统)
4. [插件生命周期管理](#4-插件生命周期管理)
5. [命令-事件-Action 三件套](#5-命令-事件-action-三件套)
6. [依赖注入体系](#6-依赖注入体系)
7. [Worker Thread 隔离模式](#7-worker-thread-隔离模式)
8. [前端插件系统](#8-前端插件系统)
9. [安全与权限模型](#9-安全与权限模型)
10. [数据存储方案](#10-数据存储方案)

---

## 1. 设计理念

OpenLearnV2 采用 **插件驱动的命令-事件总线架构**（Plugin-Driven Command-Event Bus Architecture）。灵感来源于操作系统内核设计：一个精简的核心内核（Kernel）提供基础能力，所有业务功能——包括课程管理、白板交互、AI 规划、作业评估——全部通过插件实现。

核心设计原则：

- **内核只做转发，不做业务**：Kernel 提供 CommandBus、EventBus、ServiceRegistry、PluginHost 等基础子系统，不包含任何领域逻辑。
- **一切皆插件**：课程管理（builtin）、虚拟文件系统（vfs）、AI 规划器（ai-planner）、作业评估（assignment-eval）等均为插件，享有相同的生命周期和权限模型。
- **Command → Event → Audit**：所有数据写入通过 CommandBus 进行，执行完毕后由 EventBus 发布事件，事件自动写入 SQLite 审计日志，形成完整的因果链。
- **安全纵深防御**：Worker Thread 隔离 + CapabilityGuard 权限控制 + 高危操作审批网关 + 命名空间防欺骗，四层安全防护。

---

## 2. 系统架构总览

```
+--------------------------------------------------------------------+
| OpenLearnV2 Kernel                                                 |
|                                                                    |
|  +------------------------------------------------------+          |
|  | AI Agent (Shell)                                             |  |
|  | Gemini / OpenAI 兼容模型作为智能控制器                       |  |
|  +----------------------+-------------------------------+          |
|                       | 自然语言 => functionCall                   |
|  +----------------------+-------------------------------+          |
|  | CommandBus (内核管线)                                        |  |
|  | interceptor -> JSON Schema 校验 -> CapabilityGuard           |  |
|  | -> 高危审批闸门 -> Handler 执行                              |  |
|  +--+----------+----------+----------+----------+---------+        |
|     |          |          |          |          |                  |
|  +--+--+  +---+--+  +---+--+  +---+--+  +---+--------+             |
|  |builtin|  | VFS  |  |管理  |  | AI   |  | 第三方插件  |          |
|  | 插件  |  | 插件 |  | 插件 |  |规划器|  | (Plugin)   |           |
|  +--+--+  +--+--+  +--+--+  +--+--+  +------+------+               |
|     |        |        |        |              |                    |
|  +--+--------+--------+--------+--------------+------+             |
|  | EventBus                                                     |  |
|  | 所有事件写入 SQLite 审计日志表                               |  |
|  +----------------------+-------------------------------+          |
|                       |                                            |
|  +----------------------+-------------------------------+          |
|  | SQLite Database (30+ 表)                                     |  |
|  +------------------------------------------------------+          |
|                                                                    |
|  +------------------------------------------------------+          |
|  | ServiceRegistry (依赖注入容器)                               |  |
|  | Token 驱动 | DAG | 依赖验证 | SemVer 版本检查                |  |
|  +------------------------------------------------------+          |
+--------------------------------------------------------------------+
```

Kernel 通过 lazy-evaluated Proxy 暴露全局单例 `kernelContainer`，避免测试导入时的瞬时创建。所有子系统间不存在循环依赖——WorkerManager 通过 setter 注入到 PluginHost 以打破循环。

**系统启动流程**（`bootstrapSystemPlugins()`）:

1. `migratePluginsToFilesystem()` — 将数据库中存有 source_code 的旧插件迁移到文件系统（幂等）
2. 按优先级顺序启动系统插件——关键插件失败则硬崩溃退出：
   - VFS → Process → Management → Builtin（关键，失败即 `process.exit(1)`）
   - AI Planner → AI Submit Injector → Assignment Eval（非关键，失败仅警告）
3. `restoreActivePlugins()` — 恢复数据库中标记为 active 的第三方 ESM 插件
4. 开发模式（`NODE_ENV=development`）启动 `HotReloadController` 文件监听

### 3.2 CommandBus — 命令执行管线

命令总线是所有数据写入的**唯一入口**。将所有 mutation 路由通过 CommandBus 实现了权限校验、payload 格式校验、高危操作审批的统一控制点——这是教科书级别的 CQRS 模式。

**执行管线（interceptor chain）**:

```
execute(command):
  +-- 1. 标准化 actorId（空值默认 "agent-system-0"）
  +-- 2. 拦截器链:
  |   +-- JSON Schema 校验（基于 ActionRegistry 的 inputSchema）
  |   +-- CapabilityGuard 权限检查（非 admin actor 时校验 capabilityRequired）
  |   +-- 高危审批闸门（isHighRisk + 非 admin -> 写入 pending_commands 表 + 抛出异常）
  +-- 3. Handler 查找（modern 优先，legacy 降级）
  +-- 4. Handler.execute() 执行业务逻辑
  +-- 5. 返回结果
```

### 3.4 ActionRegistry — AI Agent 工具注册表

插件通过 `ActionRegistry.register()` 注册 AI Agent 可发现的工具。每个 Action 包含：

| 字段 | 说明 |
|------|------|
| `id` | 全局唯一标识 |
| `commandType` | 对应的命令类型（关联到 CommandBus handler） |
| `description` | AI Agent 理解工具用途的关键描述（建议中文） |
| `capabilityRequired` | 调用所需的权限字符串 |
| `isHighRisk` | 是否高危操作（需教师审批） |
| `inputSchema` | JSON Schema（Google GenAI 兼容格式） |

`getAgentTools()` 方法将所有 Action 转换为 Google GenAI `functionDeclarations` 格式，供 AI 模型的 functionCall 使用。这是 OpenLearnV2 的核心 AI 原生能力——插件无需额外集成即可被 AI Agent 自动发现和调用。

---

## 4. 插件生命周期管理

### 4.1 PluginHost — 生命周期管理器

PluginHost 是插件生命周期的核心管理者，负责插件的安装、激活、停用、卸载和热重载。关键组件如下：

| 组件 | 职责 |
|------|------|
| `pluginStates` | Map<pluginId, PluginState> 状态追踪 |
| `resourceTracker` | 按 pluginId 管理 Disposable 资源，保证精确清理 |
| `contributionRegistry` | V3.2 声明式 UI 贡献点存储 |
| `middlewareRegistry` | 按生命周期阶段分组的洋葱模型中间件管道 |
| `preloadedPlugins` | 内置插件内存预加载映射（跳过文件系统加载） |
| `pluginInstances` | 活跃实例引用（manifest + activate/deactivate + workerRef） |

### 4.2 状态机

```
INSTALLED ──→ ACTIVATING ──→ ACTIVE ──→ DEACTIVATING ──→ INACTIVE
                                  │                           │
                                  └──── ERROR ←───────────────┘
                                                        │
INACTIVE ──→ ACTIVATING（重新激活）                       │
ERROR ──→ ACTIVATING（重试）          UNINSTALLED ←──────┘
```

ACTIVATING 和 DEACTIVATING 是瞬态（transient），不应长时间停留。状态转换由 `validateStateTransition()` 强制执行,非法转换抛出 `IllegalStateTransitionError`。

### 4.3 激活流程（中间件管道）

`activatePlugin()` 的执行流程采用洋葱模型中间件管道：

```
beforeActivate 中间件 → 实际激活 → afterActivate 中间件

实际激活内部:
  1. 幂等守卫（已激活则跳过）
  2. validateTransition(INSTALLED/INACTIVE → ACTIVATING)
  3. setState(ACTIVATING)
  4. 解析 manifest + SemVer 兼容性检查
  5. 根据 execution_mode 分支：
     ├─ 'worker' → WorkerManager.createWorker()
     └─ 'inline' → ContextBuilder.buildContext() → plugin.activate(ctx)
  6. 注册 classroomTools → ContributionRegistry
  7. 授予 capabilitiesProposed 声明的权限
  8. setState(ACTIVE)
```

### 4.4 停用流程（强制清理保证）

`deactivatePlugin()` 使用多层 `finally` 块 + pipeline 安全 fallback 双重强制清理，保证即使在停用过程中抛出异常，资源也能正确回收：

```
deactivate 流程:
  1. 状态验证 + resolvePluginUuid
  2. worker 模式 → deactivateWorker()（超时保护）
  3. inline 模式 → 洋葱管道:
     beforeDeactivate 中间件
     → instance.deactivate()（超时保护，抛出仅记录警告不阻断）
       → finally:
         resourceTracker.disposeAll(pluginId)    ← 强制清理
         contributionRegistry.unregister()        ← 移除 UI 贡献
         capability.revokeAll(actorId)            ← 收回权限
         hotReloadController.unregisterPlugin()   ← 热重载注销
         DB status = 'inactive'
     → afterDeactivate 中间件
  4. 管道崩溃安全 fallback: 直接执行 resourceTracker.disposeAll + revokeAll
```

### 4.5 ResourceTracker — 确定性资源清理

`ResourceTracker` 确保所有插件资源（命令处理器、事件订阅、定时器、后台进程）在插件停用时被确定性清理。通过 `Disposable` 接口统一管理可清理资源，防止内存泄漏和僵尸订阅。

### 4.6 生命周期中间件

PluginHost 支持在 6 个生命周期阶段注册中间件（洋葱模型）：

| 阶段 | 触发时机 |
|------|---------|
| `beforeActivate` | 插件激活前 |
| `afterActivate` | 插件激活后 |
| `beforeDeactivate` | 插件停用前 |
| `afterDeactivate` | 插件停用后 |
| `beforeCommand` | 命令执行前 |
| `afterCommand` | 命令执行后 |

### 4.7 热重载机制

开发模式（`NODE_ENV=development`）下，`HotReloadController` 通过 `chokidar` 监听 `plugins/` 目录的文件变更（300ms debounce）。检测到变更后调用 `PluginHost.reloadPlugin()` 执行原子替换：停用旧版本 → 清除中间件 → 激活新版本，无需重启服务器。

---

## 5. 命令-事件-Action 三件套

这是 OpenLearnV2 插件开发的核心模式。每个业务功能需要三样东西协同工作：

```
┌─────────────────────┐
│  Action (AI 可调用)  │  → actionRegistry.register()
│  描述 + JSON Schema  │     供 AI Agent 发现和调用
└────────┬────────────┘
         │ 关联 commandType
┌────────▼────────────┐
│  Command (业务执行)  │  → commandBus.registerHandler()
│  Handler + 逻辑      │     权限检查 → 数据写入 → 返回结果
└────────┬────────────┘
         │ 执行完毕后发布
┌────────▼────────────┐
│  Event (状态通知)    │  → eventBus.publish()
│  过去式命名 + 载荷    │     审计日志 + Socket.IO 推送
└─────────────────────┘
```

**命名规范**：

- 命令类型：点号分隔，动词原形 + 资源名 — `lesson.create`、`poll.vote`、`whiteboard.query`
- 事件类型：点号分隔，过去式 — `lesson.created`、`poll.vote_cast`、`whiteboard.element_drawn`
- Action ID：手写唯一标识 — `core-lesson-create`、`poll-create`

---

## 6. 依赖注入体系

### 6.1 ServiceRegistry

Token 驱动的依赖注入容器，构建所有内核服务间的显式依赖图：

- **依赖图验证**：注册时验证所有 required 依赖已存在，缺失时抛出 `MissingDependencyError`
- **反向依赖追踪**：维护双向依赖图（requires ← → dependents），卸载时检查 `HasDependentError` 防止级联崩溃
- **SemVer 版本检查**：Token 携带版本号，插件 manifest 中的 `requires` 声明版本范围
- **原子替换**：`registerOrReplace()` 支持原子替换已注册的服务实例

### 6.2 内核服务 Token

Kernel 初始化时向 ServiceRegistry 注册 10 个 IService 实例：

| Token 常量 | 标识符 | 暴露类型 | 用途 |
|-----------|--------|---------|------|
| `ICommandBusServiceToken` | `@openlearn/core:ICommandBusService` | ICommandBusService | 命令执行、注册、拦截器 |
| `IEventBusServiceToken` | `@openlearn/core:IEventBusService` | IEventBusService | 事件发布/订阅 |
| `IActionRegistryServiceToken` | `@openlearn/core:IActionRegistryService` | IActionRegistryService | AI 工具注册 |
| `ICapabilityServiceToken` | `@openlearn/core:ICapabilityService` | ICapabilityService | 权限管理 |
| `IProcessServiceToken` | `@openlearn/core:IProcessService` | IProcessService | 后台进程/定时任务 |
| `IStorageServiceToken` | `@openlearn/core:IStorageService` | IStorageService | K-V 存储 |
| `IAIServiceToken` | `@openlearn/core:IAIService` | IAIService | AI 文本生成 |
| `IDatabaseToken` | `@openlearn/core:IDatabase` | better-sqlite3 Database | 原始 SQL 访问 |
| `IPluginHostToken` | `@openlearn/core:IPluginHost` | PluginHost | 插件主机管理 |
| `ISemesterGradeServiceToken` | `@openlearn/core:ISemesterGradeService` | ISemesterGradeService | 学期成绩管理 |

---

## 7. Worker Thread 隔离模式

### 7.1 三层隔离体系

在生产环境中，插件可在独立 Node.js Worker Thread 中运行：

| 层次 | 机制 | 说明 |
|------|------|------|
| 物理隔离 | Worker Thread | 独立 V8 线程，崩溃不影响主进程 |
| 通信隔离 | RPC Proxy | 所有内核服务调用通过 `postMessage` 序列化传递，Worker 无法直接引用主进程对象 |
| 权限隔离 | CapabilityGuard | Worker 内每个 RPC 调用在主线程侧重新经过能力检查 |

### 7.2 服务代理实现

`createServicesProxy()` 为 Worker 端构建完整的服务代理对象，核心组件：

| 组件 | 职责 |
|------|------|
| `MethodProxy` | 将 Worker 端方法调用序列化为 RPC invoke 消息，通过 `pendingCalls` Map 等待主线程响应 |
| `EventBusProxy` | 管理 Worker 端事件订阅，通过 subscribe/unsubscribe 消息与主线程 `EventForwarder` 同步 |
| `dispose` | 清理所有 pending calls 和订阅，Worker 终止时必须调用 |

### 7.3 结构化错误层次

```
WorkerRuntimeError            // 基类
├── WorkerActivateError       // 插件在 Worker 内激活失败
├── WorkerTimeoutError        // RPC 调用或激活/停用超时
├── WorkerTransportError      // postMessage 通信层失败
├── WorkerCapabilityError     // 跨边界能力检查拒绝
└── WorkerNotSupportedError   // 运行时不支持的功能
```

### 7.4 前端 Worker 模式

前端同样支持 Worker 模式，通过 `BrowserWorkerManager` 将插件运行在 Web Worker 中。前端 Worker 激活流程：创建 Web Worker → 发送 activate-request → Worker 端加载源码 → ServiceHost 建立 RPC 通道 → 返回 activated 确认。

---

## 8. 前端插件系统

### 8.1 FrontendPluginHost

前端插件运行在浏览器中，通过动态 `import()` 加载 ESM 模块。`FrontendPluginHost` 管理前端插件的完整生命周期，支持 inline 和 worker 两种执行模式。

**激活流程**：

1. 判断 executionMode：`worker` → `activateWorkerPlugin()`, `inline` → 正常流程
2. 通过 `moduleLoader` 动态加载插件源码（Blob URL 或 fetch + eval）
3. 验证 manifest.id 一致性
4. 自动注册 `classroomTools` 声明为 `classroom.tool` 扩展点
5. `buildContext()` 构建前端上下文（含 FrontendServiceRegistry 解析）
6. 5 秒超时保护 → `plugin.activate(ctx)`

### 8.2 前端服务 Token

`FrontendServiceRegistry` 注册 5 个前端专用服务：

| Token | 服务接口 | 说明 |
|-------|---------|------|
| `FRONTEND_API_TOKEN` | IFrontendAPI | RESTful HTTP API（get/post/del） |
| `SOCKET_SERVICE_TOKEN` | ISocketService | WebSocket 通信（emit/on/off/disconnect） |
| `UI_SERVICE_TOKEN` | IUIService | Toast/Modal/文件下载 |
| `STORAGE_SERVICE_TOKEN` | IStorageService | 客户端 K-V 存储 |
| `SEMESTER_GRADE_SERVICE_TOKEN` | ISemesterGradeService | 学期成绩保存 |

### 8.3 扩展点系统

插件通过 `ctx.ui.registerExtensionPoint(slot, config)` 注册 UI 组件到预定义槽位：

| Slot | 用途 |
|------|------|
| `teacher.tab` | 教师导航标签页 |
| `teacher.panel` | 教师独立全宽管理面板（v3.2） |
| `teacher.dashboard.widget` | 教师仪表盘小部件 |
| `student.view` | 学生视图 |
| `student.fullscreen` | 学生全屏视图/考试模式（v3.2） |
| `student.lesson.tool` | 学生学习工具 |
| `classroom.tool` | 课堂工具 |
| `global.setting` | 全局设置页扩展（v3.2） |

**学生端 `slotProps` 注入**：宿主渲染 `student.view` 扩展点时，自动通过 `slotProps` 注入当前登录学生 ID：

```tsx
// 插件前端组件直接通过 props 获取
export default function MyPlugin({ studentId }: { studentId?: string }) {
  // studentId 由宿主自动注入，无需额外请求
}
```

`ExtensionPointRenderer` 是宿主渲染扩展点的统一入口——`App`、`NavigationSidebar`、`Dashboard` 等宿主组件通过它按 slot 动态渲染所有已注册扩展，每个扩展被独立包裹在 `ExtensionErrorBoundary` 中隔离崩溃。

### 8.4 宿主依赖共享网关

为避免每个第三方插件前端重复打包庞大的基础库，OpenLearnV2 通过 `window.HostSharedDeps` 全局对象提供共享依赖。插件前端构建时必须将这些库标记为 external：

| 全局对象 | NPM 包 |
|----------|--------|
| `HostSharedDeps.React` | react |
| `HostSharedDeps.ReactDOM` | react-dom |
| `HostSharedDeps.Recharts` | recharts |
| `HostSharedDeps.LucideReact` | lucide-react |

> **⚠️ JSX 运行时**：HostSharedDeps 仅提供经典 React 运行时，不包含 `react/jsx-runtime`。插件前端必须使用 `"jsx": "react"`（经典模式），不能使用 `"jsx": "react-jsx"`（automatic runtime）。

---

## 9. 安全与权限模型

### 9.1 四层防护体系

| 层 | 机制 | 说明 |
|----|------|------|
| 1. 命名空间隔离 | 命名空间前缀 + UUID 防欺骗 | 裸字符命令自动加 `{pluginId}.` 前缀；注册时检测 UUID 跨插件劫持 |
| 2. 权限声明 | `capabilitiesProposed` | 安装时声明，运行时强制检查 |
| 3. 物理隔离 | Worker Thread | 可选的生产环境强化隔离 |
| 4. 审批闸门 | 高危操作审批 | `isHighRisk` Action 需教师审批后执行 |

### 9.2 权限格式

```
格式: {resource}:{action}
示例:
  lesson:read       — 读取课程
  lesson:write      — 创建/编辑课程
  lesson:delete     — 删除课程
  whiteboard:*      — 白板所有操作（通配符）
  vfs:read          — 读取虚拟文件系统
  vfs:write         — 写入虚拟文件系统
```

管理员角色（`actorId` 包含 `:administrator` 或 `:admin`）自动绕过高危审批和权限检查。

### 9.3 高危操作审批流程

```
AI Agent 调用 isHighRisk Action
  → CommandBus 拦截器检测到非 admin actor
  → 命令写入 pending_commands 表（pending 状态）
  → EventBus 发布 approval.requested 事件
  → Socket.IO 推送到教师客户端
  → 教师在审批面板批准/拒绝/修改参数
  → 批准后执行原始命令
```

---

## 10. 数据存储方案

### 10.1 SQLite 单文件数据库

系统使用 SQLite 作为主数据库，文件位于 `packages/core/db/educational_os.db`。通过 better-sqlite3 进行同步访问，适合教育场景的单服务器部署。

### 10.2 插件数据库隔离

每个插件通过 `ctx.db` API 获得命名空间隔离的数据库操作能力：

- `ctx.db.ensureTable(name, schema)` — 在 `plugin_{pluginId}_{name}` 命名空间创建表（幂等）
- `ctx.db.table(name)` — 返回带命名空间前缀的完整表名
- `ctx.db.migrate(targetVersion, upgradeFn)` — 声明式数据库版本迁移
- `ctx.db.dropAllTables()` — 删除插件创建的所有表（卸载时自动调用）

### 10.3 核心数据表

| 表名 | 用途 |
|------|------|
| `lessons` | 课程信息（含 timeline JSON、Markdown 内容） |
| `whiteboard_elements` | 白板元素（含 segmentId/page 上下文字段） |
| `plugins` | 插件元信息（含 execution_mode、file_path、loader_version） |
| `events` | 审计日志（EventBus `*` 通配符订阅者自动写入） |
| `pending_commands` | 高危操作审批队列 |
| `plugin_storage` | 插件 K-V 存储（按 namespace 隔离） |

---

## 附录 A：内置系统插件

| 插件 ID | 源文件 | 关键性 | 职责 |
|---------|--------|--------|------|
| `@openlearn/plugin-vfs` | vfs.ts | 关键 | 虚拟文件系统（读写/目录管理） |
| `@openlearn/plugin-process` | process.ts | 关键 | 后台进程和定时任务管理 |
| `@openlearn/plugin-management` | management.ts | 关键 | LMS 管理（班级/学生/作业/成绩） |
| `@openlearn/plugin-builtin` | builtin.ts | 关键 | 课堂核心（课程 CRUD / 白板 CRUD / 时间线） |
| `@openlearn/plugin-ai-planner` | ai-planner.ts | 非关键 | AI 教案生成与推荐 |
| `@openlearn/plugin-ai-submit-injector` | submit-injector.ts | 非关键 | AI 提交注入器 |
| `@openlearn/plugin-assignment-eval` | assignment-eval.ts | 非关键 | 作业评估与同伴互评 |

关键插件启动失败会触发 `process.exit(1)` 硬崩溃；非关键插件失败仅记录警告。

---

## 附录 B：完整数据流

```
用户发送消息
  |
  v
POST /api/agent/chat
  |
  v
AI 模型返回 functionCall（如 lesson.create）
  |
  v
executeAgentToolCall() 通过 ActionRegistry 查找 action
  |
  v
CommandBus.execute() 执行拦截器管线:
  +-- JSON Schema payload 校验（基于 action.inputSchema）
  +-- CapabilityGuard 权限检查（非 admin actor）
  +-- 高危操作 -> 写入 pending_commands 审批表 + 抛出异常中断
  |
  v
Handler 执行业务逻辑（db.prepare().run()）
  |
  v
EventBus.publish() 发布事件（异步并行通知所有订阅者）
  |
  +-- * 通配符订阅者写入 events 审计日志表
  +-- Socket.IO 推送给在线客户端（教师/学生实时更新）
  |
  v
返回结果给 AI Agent（继续对话或结束）
```

---

# 第 3 章 插件开发完全指南

## 目录

1. [系统架构概述](#1-系统架构概述-1)
2. [开发原理](#2-开发原理)
3. [插件结构详解](#3-插件结构详解)
4. [手把手实例项目](#4-手把手实例项目)
5. [API 及接口文档](#5-api-及接口文档)
6. [前端插件系统](#6-前端插件系统-1)
7. [安全与权限](#7-安全与权限-1)
8. [高级特性](#8-高级特性)
9. [测试与调试](#9-测试与调试)
10. [发布前自检清单](#10-发布前自检清单)
11. [发布与分发](#11-发布与分发)

---

## 1. 系统架构概述

### 1.1 设计理念

OpenLearnV2 采用 **插件驱动的命令-事件总线架构**（Plugin-Driven Command-Event Bus）。灵感来源于操作系统内核设计：一个精简的核心内核提供基础能力，所有业务功能通过插件实现。

```
┌──────────────────────────────────────────────────────────────┐
│                      OpenLearnV2 OS                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   AI Agent (Shell)                    │   │
│  │          Gemini / OpenAI 兼容模型作为智能控制器        │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │ 自然语言 → functionCall             │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │                  Command Bus (内核管线)               │   │
│  │  interceptor → JSON Schema校验 → CapabilityGuard →  │   │
│  │  高危审批闸门 → beforeCommand → Handler → afterCmd   │   │
│  └──┬──────────┬──────────┬──────────┬──────────┬───────┘   │
│     │          │          │          │          │            │
│  ┌──▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼──────┐      │
│  │内置  │  │ VFS  │  │管理  │  │ AI   │  │第三方插件 │      │
│  │插件  │  │插件  │  │插件  │  │规划器│  │ (Plugin)  │      │
│  └──┬──┘  └──┬──┘  └──┬──┘  └──┬──┘  └────┬──────┘      │
│     │        │        │        │            │              │
│  ┌──▼────────▼────────▼────────▼────────────▼──────┐      │
│  │                   Event Bus                      │      │
│  │        所有事件写入 SQLite 审计日志               │      │
│  └──────────────────────┬───────────────────────────┘      │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────┐      │
│  │     SQLite Database (30+ 表) + ServiceRegistry    │      │
│  └───────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 核心子系统

| 子系统 | 文件 | 职责 |
|--------|------|------|
| **Kernel** | `packages/core/kernel/index.ts` | 全局单例容器，分层组装所有子系统（Layer 0-3），引导系统插件启动 |
| **CommandBus** | `packages/core/command-bus/index.ts` | 命令执行管线：注册 handler → 拦截器链（JSON Schema校验→CapabilityGuard→高危审批）→ 执行 |
| **EventBus** | `packages/core/event-bus/index.ts` | 发布/订阅事件，支持通配符 `*`，异步并行通知 |
| **ActionRegistry** | `packages/core/registry/index.ts` | 注册 AI Agent 可发现的工具 |
| **CapabilityGuard** | `packages/core/capability-system/index.ts` | 基于字符串的 RBAC 权限控制 |
| **ProcessManager** | `packages/core/process-manager/index.ts` | 后台进程和定时任务管理 |
| **PluginHost** | `packages/core/plugin-host/index.ts` | 插件生命周期：安装/激活/停用/卸载/热重载，中间件管道 |
| **ServiceRegistry** | `packages/core/di/service-registry.ts` | 依赖注入容器，Token 驱动，依赖图验证 |
| **ResourceTracker** | `packages/core/plugin-host/resource-tracker.ts` | 按 pluginId 管理 Disposable 资源，保证精确清理 |
| **WorkerManager** | `packages/core/worker-manager/index.ts` | Worker Thread 隔离模式管理 |
| **FrontendPluginHost** | `src/plugin-host/plugin-host.ts` | 前端插件生命周期管理，支持 inline/worker 模式 |

### 1.3 数据流

```
用户发送消息 → POST /api/agent/chat
  → AI 模型返回 functionCall（如 lesson.create）
  → executeAgentToolCall() 通过 ActionRegistry.getActionByToolName() 查找 action
  → CommandBus.execute() 执行拦截器管线:
    ├─ JSON Schema payload 校验（基于 action.inputSchema）
    ├─ CapabilityGuard 权限检查（非 admin actor）
    └─ 高危操作 → 写入 pending_commands 审批表 + 抛出异常中断
  → beforeCommand 中间件 → Handler 执行业务逻辑 → afterCommand 中间件
  → EventBus.publish() 发布事件（异步并行通知所有订阅者）
  → Socket.IO 推送给在线客户端
  → 返回结果给 AI Agent（继续对话或结束）
```

---

## 2. 开发原理

### 2.1 插件即 ESM 模块

插件是一个导出了 `manifest` 和 `activate` 函数的 JavaScript/TypeScript 模块：

```typescript
// 插件的最小结构
export default {
  manifest: { ... },
  activate: async (ctx: PluginContext) => { ... },
  deactivate: async () => { ... },  // 可选
};
```

### 2.2 双运行时架构

```
┌─ 服务端（Node.js） ─────────────────────┐
│  PluginHost → inline/worker 执行模式     │
│  • inline: 直接在同一进程中运行           │
│  • worker: 独立 Worker Thread 隔离运行    │
└─────────────────────────────────────────┘

┌─ 前端（浏览器） ────────────────────────┐
│  FrontendPluginHost → 双模式执行         │
│  • inline: 直接 import() 动态加载         │
│  • worker: BrowserWorkerManager 隔离     │
│  • 扩展点注册（UI 面板/工具/视图）       │
│  • 浏览器 API 服务注入                   │
└─────────────────────────────────────────┘
```

### 2.3 依赖注入

插件通过 **Token** 声明依赖，由 ServiceRegistry 自动解析注入：

```typescript
import { ICommandBusServiceToken, IDatabaseToken } from '@openlearn/plugin-sdk';

// 在 activate 中解析依赖
const commandBus = await ctx.resolve(ICommandBusServiceToken);
const db = await ctx.resolve(IDatabaseToken);

// 也可以通过 ctx.services 直接访问 7 个内核服务
const eventBus = ctx.services.eventBus;
const ai = ctx.services.ai;
```

**V3.2 新增**：插件可通过 `ctx.provide()` 向 DI 容器注册自定义服务给其他插件消费：

```typescript
// 插件 A：注册自定义服务
// V3.2: use Token instead of string
await ctx.provide(QuestionBankToken, myQuestionBank);

// 插件 B：消费该服务
const qb = await ctx.resolve({ name: '@my-scope/IQuestionBankService' } as any);
```

### 2.4 PluginContext 完整接口

```typescript
interface PluginContext {
  // 7 个内核服务接口（直接访问）
  services: {
    commandBus: ICommandBusService;       // 命令执行、注册
    eventBus: IEventBusService;           // 事件发布/订阅
    actionRegistry: IActionRegistryService; // AI 工具注册
    capability: ICapabilityService;       // 权限管理
    processManager: IProcessService;       // 后台进程
    storage: IStorageService;             // K-V 存储
    ai: IAIService;                       // AI 文本生成
  };
  pluginId: string;           // 插件 ID
  manifest: Manifest;         // 插件 manifest

  // 依赖注入
  resolve<T>(token: Token<T>): Promise<T>;                    // 从 ServiceRegistry 解析服务
  provide<T>(token: Token<T>, instance: T): Promise<void>; // V3.2: 注册自定义服务

  // 插件专用数据库
  db: PluginDatabaseAPI;      // 命名空间隔离的 SQLite 操作（含 migrate() 迁移）

  // V2.5 结构化日志（自动注入 pluginId 和 timestamp）
  log: IPluginLogger;         // 支持 debug/info/warn/error 四级

  // V3.2: 类型安全的配置服务
  config: IConfigService;     // 读取 manifest.configuration 中声明的设置项

  // V3.2: 声明式贡献点只读视图
  contributions: ContributionAccessor; // list(): 内省插件在 manifest 中声明的贡献点

  // V5.1: 主应用共享模块引用（白名单控制）
  require(moduleName: string): any;
}
```

### 2.5 生命周期状态机

```
INSTALLED ──→ ACTIVATING ──→ ACTIVE ──→ DEACTIVATING ──→ INACTIVE
                                  │                           │
                                  └──── ERROR ←───────────────┘
                                                        │
INACTIVE ──→ ACTIVATING（重新激活）                      │
ERROR ──→ ACTIVATING（重试）          UNINSTALLED ←──────┘
```

- **INSTALLED**：源码已持久化，尚未激活
- **ACTIVATING**：正在执行 `activate()`（瞬态，不超过 10 秒）
- **ACTIVE**：正常运行中
- **INACTIVE**：已停用，可通过 toggle 重新激活
- **ERROR**：激活失败，可重试或卸载

### 2.6 版本兼容性速查表

开发插件前，先确认目标 OpenLearn 版本。以下特性按版本分组，选择适合你的目标版本。

**API 特性版本要求：**

| 特性 | 最低版本 | 说明 |
|------|----------|------|
| `ctx.log` | 2.5 | 结构化日志（debug/info/warn/error），自动注入 pluginId 和 timestamp |
| `ctx.config` | 3.0 | 类型安全的配置读取，配合 manifest.configuration 声明 |
| `ctx.provide()` | 3.0 | 向 DI 容器注册自定义服务供其他插件消费 |
| `ctx.require()` | 5.1 | 引用主应用白名单共享模块（recharts、jspdf 等） |
| `ctx.invokeCommand()`（前端） | 2.5 | 前端直接调用后端 CommandBus |
| `teacher.panel` 扩展槽位 | 5.1 | 教师独立全宽管理面板 |
| `student.fullscreen` 扩展槽位 | 5.1 | 学生全屏视图/考试模式 |
| `global.setting` 扩展槽位 | 5.1 | 全局设置页扩展 |

**扩展槽位版本可用性一览：**

| 槽位 | 最低版本 | 适用角色 |
|------|----------|----------|
| `teacher.tab` | 1.0 | 教师 |
| `teacher.dashboard.widget` | 1.0 | 教师 |
| `student.view` | 1.0 | 学生 |
| `student.lesson.tool` | 1.0 | 学生 |
| `classroom.tool` | 1.0 | 课堂教学 |
| `teacher.panel` | 5.1 | 教师 |
| `student.fullscreen` | 5.1 | 学生 |
| `global.setting` | 5.1 | 管理员 |

> **提示**：在 manifest.engines.openlearn 中声明目标版本，如 `"^5.1.0"`。安装时 PluginHost 自动检查兼容性。

### 2.7 导航页面 vs. 白板组件 — 如何区分？

同一个插件可以注册到不同的 slot，**每个 slot 绑定独立的 React 组件**，无需任何 if-else 分支来区分。

**核心规则：**

| Slot | 渲染位置 | 组件收到的 props | 适用场景 |
|------|---------|-----------------|---------|
| `teacher.tab` | 侧边栏导航 → 全屏独立页面 | `{ renderType: 'panel' }` | 管理界面（列表、设置、数据看板） |
| `teacher.dashboard.widget` | 白板内的可拖拽卡片 | `{ elementId, lessonId }` | 课堂交互组件（编辑、答题、展示） |
| `classroom.tool` | 课堂互动工具架按钮 | — | 工具栏入口，点击后通过 `commandType` 触发动作 |
| `student.view` | 学生端全屏视图 | `{ studentId }` | 学生操作界面 |

**`teacher.tab` 和 `teacher.dashboard.widget` 的关键区别：**

1. **容器不同**：`teacher.tab` 是全屏页面（`flex-1 overflow-auto`），适合列表、设置等管理界面；`teacher.dashboard.widget` 是白板内固定尺寸的卡片，适合课堂即时交互。

2. **props 不同**：白板组件额外接收 `elementId`（当前白板元素 ID）和 `lessonId`（当前课节 ID），可用于数据隔离和持久化。

3. **ID 匹配机制**：`teacher.dashboard.widget` 的 `id` 必须与 `manifest.classroomTools[].payload.data.teacherWidgetId` 一致，`PluginCardRenderer` 通过这个 ID 查找对应组件：

```json
// manifest.json — classroomTools 声明
{
  "classroomTools": [{
    "id": "scratch-editor-tool",
    "commandType": "whiteboard.draw",
    "payload": {
      "type": "plugin",
      "data": "{ \"teacherWidgetId\": \"my-widget\", \"width\": 960 }"
    }
  }]
}
```

```js
// frontend.js — 组件注册，id 必须与 payload 中的 teacherWidgetId 一致
ctx.ui.registerExtensionPoint('teacher.dashboard.widget', {
    id: 'my-widget',           // ← 匹配 payload.data.teacherWidgetId
    component: MyWidget,
});
```

**典型模式：导航页 = 管理界面，白板组件 = 交互工具。** 例如作业中心应在 `teacher.tab` 注册作业列表管理页，在 `teacher.dashboard.widget` 注册具体某次作业的提交/批改面板。两者共享 `elementId`/`lessonId` 即可通过后端 API 打通数据。

---

## 3. 插件结构详解

### 3.1 Manifest 完整规范

```typescript
interface Manifest {
  id: string;                    // 唯一标识，推荐格式 @scope/name
  name: string;                  // 显示名称
  version: string;               // SemVer 版本号（如 "1.0.0"）
  main?: string;                 // 入口文件名，默认 "index.js"
  description?: string;          // 描述
  author?: string;               // 作者
  engines?: {                    // 引擎版本约束
    openlearn?: string;          // 如 "^2.5.0"
  };
  requires: string[];            // 依赖的服务 Token（格式 @openlearn/core:TokenName@^1.0.0）
  optional?: string[];           // 可选依赖
  capabilitiesProposed: string[]; // 申请的权限（如 "lesson:write", "vfs:read"）
  classroomTools?: ClassroomTool[]; // 前端课堂工具声明
  provides?: string[];           // V3.2: 插件对外提供的自定义服务 Token 名称
  configuration?: {              // V3.2: 声明式配置 schema
    properties: Record<string, ConfigProperty>;
  };
}

interface ConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'integer';
  default?: unknown;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

interface ClassroomTool {
  id: string;         // 工具 ID
  name: string;       // 工具名称
  icon: string;       // 图标（使用 lucide-react icon name，如 "BarChart3"）
  commandType: string; // 关联的命令类型
  payload?: any;      // 默认 payload
}
```

### 3.2 PluginContext — 插件上下文的完整 API

插件通过 `activate(ctx)` 接收上下文对象。`ctx.services` 直接提供 7 个内核服务，无需 DI 解析：

| 服务 | 访问方式 | 用途 |
|------|---------|------|
| CommandBus | `ctx.services.commandBus` | 注册/执行命令 |
| EventBus | `ctx.services.eventBus` | 发布/订阅事件 |
| ActionRegistry | `ctx.services.actionRegistry` | 注册 AI 工具 |
| Capability | `ctx.services.capability` | 权限管理 |
| Process | `ctx.services.processManager` | 后台进程 |
| Storage | `ctx.services.storage` | K-V 存储 |
| AI | `ctx.services.ai` | 文本生成 |

通过 DI 解析更多服务（`IDatabaseToken`、`IPluginHostToken` 等）：

```typescript
import { IDatabaseToken } from '@openlearn/plugin-sdk';
const db = await ctx.resolve(IDatabaseToken);
```

### 3.3 命令-事件-Action 三件套

这是插件开发的核心模式。每个业务功能需要三样东西：

#### 3.3.1 Action 注册（AI Agent 可调用）

```typescript
await actionRegistry.register({
  id: 'my-plugin-action',          // 唯一 ID
  commandType: 'myplugin.action',   // 对应的命令类型
  description: '用中文描述此工具的功能和参数',
  capabilityRequired: 'myplugin:write',  // 所需权限
  isHighRisk: false,               // 是否高危（需教师审批）
  inputSchema: {                   // JSON Schema（Google GenAI 格式）
    type: 'OBJECT',
    properties: {
      param1: { type: 'STRING', description: '参数说明' },
      param2: { type: 'NUMBER', description: '参数说明' },
    },
    required: ['param1'],
  },
});
```

#### 3.3.2 Command Handler（业务逻辑）

```typescript
await commandBus.registerHandler('myplugin.action', {
  async execute(command) {
    const payload = command.payload as any;
    const { param1, param2 } = payload;

    // 业务逻辑...
    const result = await doSomething(param1, param2);

    // 发布事件通知其他模块
    await eventBus.publish({
      id: crypto.randomUUID(),
      type: 'myplugin.action_done',    // 过去式命名
      source: 'plugin.myplugin',        // 来源标识
      payload: { param1, result },
      timestamp: Date.now(),
      correlationId: command.id,
    });

    return { success: true, result };
  },
});
```

#### 3.3.3 Event 发布

事件命名规则：**过去式**，点号分隔，如 `lesson.created`、`assignment.graded`。

```typescript
await eventBus.publish({
  id: crypto.randomUUID(),
  type: 'myplugin.action_done',
  source: 'plugin.myplugin',
  payload: { /* 业务数据 */ },
  timestamp: Date.now(),
  correlationId: command.id,  // 关联原始命令
});
```

**⚠️ classroomTools 必须注册 Handler：**

`classroomTools[].commandType` 声明了教师点击工具按钮时执行的命令。**必须**在服务端 `activate()` 中用 `commandBus.registerHandler()` 注册对应的处理器，否则系统会报 `No handler registered for command: xxx`。

即使命令不执行实际业务逻辑（仅用于触发前端面板打开），也需注册一个空 handler：

```typescript
await commandBus.registerHandler('myplugin.open_panel', {
  async execute() {
    return { panel: 'teacher' };
  },
});
```

---

## 4. 手把手实例项目

### 4.1 项目：随堂投票插件

我们将创建一个完整的"随堂投票"插件，教师可以在白板上创建投票，学生提交选票，实时显示结果。

#### 4.1.1 创建数据库表

```typescript
// poll-plugin.ts
export default {
  manifest: {
    id: '@openlearn/plugin-poll',
    name: '随堂投票插件',
    version: '1.0.0',
    main: 'index.js',
    description: '在课堂上创建实时投票，收集学生回答',
    author: 'Your Name',
    engines: { openlearn: '^2.5.0' },
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:IProcessService@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:write', 'poll:write', 'poll:read'],
    classroomTools: [
      {
        id: 'poll-tool',
        name: '📊 投票',
        icon: 'BarChart3',
        commandType: 'poll.create',
        payload: { type: 'single_choice' },
      },
    ],
  },

  activate: async (ctx) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;

    // DI 解析数据库访问
    const { IDatabaseToken } = await import('@openlearn/plugin-sdk');
    const db = await ctx.resolve(IDatabaseToken);

    // ── 1. 创建投票表 ──
    await ctx.db.ensureTable('polls', `
      id          TEXT PRIMARY KEY,
      lesson_id   TEXT NOT NULL,
      title       TEXT NOT NULL,
      options     TEXT NOT NULL,   -- JSON: ["选项A", "选项B", ...]
      is_active   INTEGER DEFAULT 1,
      created_at  INTEGER NOT NULL
    `);

    await ctx.db.ensureTable('poll_votes', `
      id          TEXT PRIMARY KEY,
      poll_id     TEXT NOT NULL,
      student_id  TEXT NOT NULL,
      choice      TEXT NOT NULL,
      voted_at    INTEGER NOT NULL,
      UNIQUE(poll_id, student_id)
    `);

    const pollsTable = ctx.db.table('polls');
    const votesTable = ctx.db.table('poll_votes');

    // ── 2. Action: 创建投票 ──
    await actionRegistry.register({
      id: 'poll-create',
      commandType: 'poll.create',
      description: '在课程中创建一个随堂投票，教师可选择单选或多选模式',
      capabilityRequired: 'poll:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          title: { type: 'STRING', description: '投票标题/问题' },
          options: { type: 'STRING', description: '选项列表 JSON，如 ["同意","不同意","弃权"]' },
          mode: { type: 'STRING', description: '投票模式：single_choice 或 multiple_choice' },
        },
        required: ['lessonId', 'title', 'options'],
      },
    });

    // ── 3. Handler: 创建投票 ──
    await commandBus.registerHandler('poll.create', {
      async execute(command) {
        const payload = command.payload as any;
        const pollId = crypto.randomUUID();
        const options = typeof payload.options === 'string'
          ? payload.options
          : JSON.stringify(payload.options);

        db.prepare(`INSERT INTO ${pollsTable} (id, lesson_id, title, options, created_at)
                    VALUES (?, ?, ?, ?, ?)`)
          .run(pollId, payload.lessonId, payload.title, options, Date.now());

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'poll.created',
          source: 'plugin.poll',
          payload: { pollId, lessonId: payload.lessonId, title: payload.title },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { pollId, message: '投票「${payload.title}」已创建' };
      },
    });

    // ── 4. Action: 学生投票 ──
    await actionRegistry.register({
      id: 'poll-vote',
      commandType: 'poll.vote',
      description: '学生对投票进行选择',
      capabilityRequired: 'poll:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          pollId: { type: 'STRING', description: '投票 ID' },
          choice: { type: 'STRING', description: '选择的选项文本' },
        },
        required: ['pollId', 'choice'],
      },
    });

    await commandBus.registerHandler('poll.vote', {
      async execute(command) {
        const payload = command.payload as any;
        const voteId = crypto.randomUUID();

        db.prepare(`INSERT OR REPLACE INTO ${votesTable}
                    (id, poll_id, student_id, choice, voted_at)
                    VALUES (?, ?, ?, ?, ?)`)
          .run(voteId, payload.pollId, command.actorId, payload.choice, Date.now());

        const stats = db.prepare(`
          SELECT choice, COUNT(*) as count
          FROM ${votesTable}
          WHERE poll_id = ?
          GROUP BY choice
        `).all(payload.pollId);

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'poll.vote_cast',
          source: 'plugin.poll',
          payload: { pollId: payload.pollId, stats },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return { success: true, stats };
      },
    });

    // ── 5. Action: 查询投票结果 ──
    await actionRegistry.register({
      id: 'poll-results',
      commandType: 'poll.get_results',
      description: '查询指定投票的实时统计结果',
      capabilityRequired: 'poll:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          pollId: { type: 'STRING', description: '投票 ID' },
        },
        required: ['pollId'],
      },
    });

    await commandBus.registerHandler('poll.get_results', {
      async execute(command) {
        const payload = command.payload as any;

        const poll = db.prepare(`SELECT * FROM ${pollsTable} WHERE id = ?`)
          .get(payload.pollId) as any;
        if (!poll) throw new Error('投票未找到');

        const stats = db.prepare(`
          SELECT choice, COUNT(*) as count
          FROM ${votesTable}
          WHERE poll_id = ?
          GROUP BY choice
        `).all(payload.pollId);

        return {
          pollId: poll.id,
          title: poll.title,
          options: JSON.parse(poll.options),
          results: stats,
          total: stats.reduce((sum: number, s: any) => sum + s.count, 0),
        };
      },
    });

    // ── 6. 使用结构化日志 ──
    ctx.log.info('Poll plugin activated successfully', { pollTable: pollsTable });
  },

  deactivate: async () => {
    // ctx.db.dropAllTables() 由 PluginHost 自动调用
    console.log('[Poll Plugin] Deactivated');
  },
};
```

#### 4.1.2 在系统设置中安装

1. 进入「系统设置」→「插件中心」
2. 将上述代码粘贴到代码编辑器
3. 点击「安装插件」
4. 在插件列表中找到 `@openlearn/plugin-poll`，点击激活

#### 4.1.3 使用 AI Agent 调用

安装后，AI Agent 自动获得以下工具：

```
poll.create   — 创建随堂投票
poll.vote     — 学生投票
poll.get_results — 查询结果
poll.close    — 关闭投票
```

教师可以直接对 AI 说：**"在今天的物理课上创建一个投票，问题是'光速是否为宇宙中最快的速度？'，选项为：是、否、不确定"**

---

## 5. API 及接口文档

### 5.1 命令定义

```typescript
interface PlatformCommand<T = unknown> {
  id: string;           // UUID v7
  type: string;         // 命令类型，点号分隔如 "lesson.create"
  actorId: string;      // 操作者 ID
  payload: T;           // 命令载荷
  timestamp: number;    // Unix 毫秒时间戳
  metadata?: {
    correlationId?: string;     // 关联 ID
    agentDelegated?: boolean;   // 是否由 AI Agent 代理
    undoable?: boolean;         // 是否可撤销
    [key: string]: unknown;
  };
}
```

### 5.2 服务 Token（依赖注入）

| Token 常量 | 标识符 | 返回类型 | 用途 |
|-----------|--------|---------|------|
| `ICommandBusServiceToken` | `@openlearn/core:ICommandBusService` | `ICommandBusService` | 命令执行、注册 |
| `IEventBusServiceToken` | `@openlearn/core:IEventBusService` | `IEventBusService` | 事件发布/订阅 |
| `IActionRegistryServiceToken` | `@openlearn/core:IActionRegistryService` | `IActionRegistryService` | AI 工具注册 |
| `ICapabilityServiceToken` | `@openlearn/core:ICapabilityService` | `ICapabilityService` | 权限管理 |
| `IProcessServiceToken` | `@openlearn/core:IProcessService` | `IProcessService` | 后台进程 |
| `IStorageServiceToken` | `@openlearn/core:IStorageService` | `IStorageService` | K-V 存储 |
| `IAIServiceToken` | `@openlearn/core:IAIService` | `IAIService` | AI 文本生成 |
| `IDatabaseToken` | `@openlearn/core:IDatabase` | `Database` (better-sqlite3) | 直接 SQL 访问 |
| `IPluginHostToken` | `@openlearn/core:IPluginHost` | `PluginHost` | 插件主机管理 |
| `ISemesterGradeServiceToken` | `@openlearn/core:ISemesterGradeService` | `ISemesterGradeService` | 学期成绩管理 |

> **⚠️ better-sqlite3 版本差异**：`ctx.resolve(IDatabaseToken)` 返回宿主进程的 `better-sqlite3` `Database` 实例。可用 API 取决于宿主安装版本，`exec()` 仅 v9.0+ 可用，建议优先使用 `prepare().run()` / `.get()` / `.all()`。

在 `manifest.requires` 中使用格式：`@openlearn/core:TokenName@^1.0.0`

在代码中解析：

```typescript
import { IDatabaseToken } from '@openlearn/plugin-sdk';
const db = await ctx.resolve(IDatabaseToken);
```

### 5.3 ICommandBusService

```typescript
interface ICommandBusService {
  execute<T>(command: PlatformCommand<T>): Promise<unknown>;
  registerHandler(commandType: string, handler: { execute(cmd: PlatformCommand): Promise<any> }): Promise<void>;
  unregisterHandler(commandType: string): Promise<void>;
  createCommand<T>(type: string, payload: T, actorId: string, metadata?: CommandMetadata): Promise<PlatformCommand<T>>;
  setInterceptor(interceptor: (command: PlatformCommand) => Promise<void>): Promise<void>;
}
```

### 5.4 IEventBusService

```typescript
interface IEventBusService {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: string, subscriber: (event: PlatformEvent) => void | Promise<void>): Promise<void>;
  unsubscribe(eventType: string, subscriber: (event: PlatformEvent) => void | Promise<void>): Promise<void>;
}
```

**重要**: `subscribe('*', handler)` 可订阅所有事件。事件订阅器在插件 deactivate 时由 ResourceTracker 自动取消。

### 5.5 IActionRegistryService

```typescript
interface ActionDescriptor {
  id: string;                // 唯一 ID
  commandType: string;        // 对应命令类型
  description: string;        // 对 AI Agent 的功能描述（中文）
  inputSchema: any;           // JSON Schema（Google GenAI 格式）
  capabilityRequired: string; // 所需权限
  isHighRisk?: boolean;       // 高危操作需审批
}

interface IActionRegistryService {
  register(descriptor: ActionDescriptor): Promise<void>;
  unregister(id: string): Promise<void>;
  getAllActions(): Promise<ActionDescriptor[]>;
  getAgentTools(): Promise<unknown[]>;
  getActionByToolName(toolName: string): Promise<ActionDescriptor | undefined>;
  getActionByCommandType(commandType: string): Promise<ActionDescriptor | undefined>;
}
```

### 5.6 inputSchema 格式规范

遵循 Google GenAI `functionDeclarations` 格式：

```typescript
{
  type: 'OBJECT',
  properties: {
    stringParam:  { type: 'STRING',  description: '字符串参数说明' },
    numberParam:  { type: 'NUMBER',  description: '数值参数说明' },
    boolParam:    { type: 'BOOLEAN', description: '布尔参数说明' },
    arrayParam:   { type: 'ARRAY',   description: '数组参数说明',
                    items: { type: 'STRING' } },
  },
  required: ['stringParam'],  // 必填参数
}
```

### 5.7 IAIService

```typescript
interface IAIService {
  generateText(
    prompt: string,
    options?: {
      systemInstruction?: string;   // 系统指令
      temperature?: number;         // 温度 (0-1)
    },
  ): Promise<string>;
}
```

使用示例：

```typescript
const summary = await ctx.services.ai.generateText(
  `请分析以下学生作业并给出评分：\n${homework}`,
  {
    systemInstruction: '你是一位教学助手，请用中文回复。',
    temperature: 0.3,
  }
);
```

### 5.8 IStorageService

```typescript
interface IStorageService {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
```

底层使用 SQLite `plugin_storage` 表，自动按插件 namespace 隔离。

### 5.9 PluginDatabaseAPI

```typescript
interface PluginDatabaseAPI {
  ensureTable(tableName: string, schema: string): Promise<void>;
  table(tableName: string): string;                      // 返回完整表名
  dropAllTables(): Promise<void>;
  migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void): Promise<void>;
}
```

**新增 `migrate()` 方法**：支持声明式数据库版本迁移，参数 `version` 表示目标版本号，若当前版本低于目标版本则执行 `upgradeFn`。

示例：`ctx.db.table('polls')` 返回 `plugin_@openlearn/plugin-poll_polls`。

**从 DI 获取原始 Database 实例的方法限制：**

`ctx.resolve(IDatabaseToken)` 返回宿主编译的 `better-sqlite3` `Database` 实例。由于宿主可能在较老版本的 better-sqlite3 上运行，建议只使用以下兼容方法：

| 方法 | better-sqlite3 版本要求 | 说明 |
|------|------------------------|------|
| `prepare().run()` | 全版本 | 执行单条 SQL |
| `prepare().get()` | 全版本 | 查询单行 |
| `prepare().all()` | 全版本 | 查询多行 |
| `exec()` | >= 9.0.0 | 批量执行多条 SQL（**可能不可用**） |
| `pragma()` | >= 4.0.0 | PRAGMA 语句 |
| `transaction()` | 全版本 | 事务包装 |

**最佳实践：**

- 使用 `prepare().run()` 逐条执行，代替 `exec()` 批量执行
- 使用 `ctx.db.ensureTable()` + `ctx.db.table()` 管理表名，不要手动拼接
- 数据库操作优先使用 `ctx.db` PluginDatabaseAPI 封装，仅在需要精细控制时直接操作 Database 实例

### 5.10 IPluginLogger（V2.5 新增）

```typescript
interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

自动注入 `pluginId` 和 `timestamp`，替代传统 `console.log`。示例：

```typescript
ctx.log.info('Activation completed', { handlerCount: 5 });
ctx.log.error('DB migration failed', { error: err.message });
```

### 5.11 IConfigService（V3.2 新增）

```typescript
interface IConfigService {
  get<T = unknown>(key: string): T;
  getAll(): Record<string, unknown>;
  set(key: string, value: unknown): Promise<void>;
  onChange(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void;
}
```

配合 `manifest.configuration` 声明使用，自动应用默认值。示例：

```typescript
// manifest 中声明：
// configuration: {
//   properties: {
//     maxOptions: { type: 'number', default: 10, description: '最大选项数' },
//     enableAnonVoting: { type: 'boolean', default: false },
//   }
// }

const maxOptions = ctx.config.get<number>('maxOptions'); // 10
ctx.config.onChange('maxOptions', (newVal, oldVal) => {
  ctx.log.info('Config changed', { key: 'maxOptions', oldVal, newVal });
});
```

### 5.12 共享模块 require（V5.1）

插件可通过 `ctx.require()` 引用白名单中的 npm 包，无需自行打包：

```typescript
const recharts = ctx.require('recharts');
const pdf = ctx.require('jspdf');
const markdown = ctx.require('react-markdown');
const xlsx = ctx.require('xlsx');
const icons = ctx.require('lucide-react');
const uuid = ctx.require('uuid');
```

### 5.13 权限字符串规范

```
格式: {resource}:{action}
示例:
  lesson:read        — 读取课程
  lesson:write       — 创建/编辑课程
  lesson:delete      — 删除课程
  whiteboard:read    — 读取白板
  whiteboard:write   — 编辑白板
  vfs:read           — 读取虚拟文件系统
  vfs:write          — 写入虚拟文件系统
  process:write      — 创建后台进程
  assignment:write   — 编辑作业
  management:read    — 读取管理数据
  management:write   — 写入管理数据

通配符: lesson:* 匹配 lesson:read, lesson:write, lesson:delete
```

---

## 6. 前端插件系统

### 6.1 FrontendPluginHost

前端插件运行在浏览器中，通过动态 `import()` 加载 ESM 模块，支持 inline 和 worker 两种执行模式：

```typescript
// 前端插件结构
export default {
  manifest: {
    id: '@scope/frontend-plugin',
    name: '前端插件',
    version: '1.0.0',
    author: 'Author',
    capabilitiesProposed: [],
    classroomTools: [
      {
        id: 'my-tool',
        name: '🔧 我的工具',
        icon: 'Wrench',
        commandType: 'myplugin.tool_action',
        payload: {},
      },
    ],
  },

  activate: async (ctx: FrontendPluginContext) => {
    // ctx.services.frontendApi   — HTTP API 调用
    // ctx.services.socketService  — WebSocket 通信
    // ctx.services.uiService      — Toast/Modal UI
    // ctx.services.storageService  — localStorage

    ctx.ui.registerExtensionPoint('teacher.tab', {
      id: 'my-tab',
      label: '我的面板',
      icon: 'Layout',
      component: () => import('./MyPanel'),
      position: 10,
      pluginId: ctx.pluginId,
    });
  },
};
```

### 6.2 FrontendPluginContext

```typescript
interface FrontendPluginContext {
  services: {
    frontendApi: IFrontendAPI;        // HTTP API 调用
    socketService: ISocketService;    // WebSocket 通信
    uiService: IUIService;            // Toast/Modal/文件下载
    storageService: IStorageService;  // localStorage
  };
  pluginId: string;
  manifest: FrontendPluginManifest;
  ui: {
    registerExtensionPoint(slot: ExtensionSlot, config: ExtensionPointConfig): void;
    unregisterExtensionPoint(slot: ExtensionSlot, id: string): void;
  };
  invokeCommand<T = any>(type: string, payload?: any): Promise<T>; // V2.5: 调用后端 Command Handler
}
```

### 6.3 前端服务接口

```typescript
interface IFrontendAPI {
  get<T>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
  post<T>(path: string, body?: any): Promise<{ success: boolean; result?: T; error?: string }>;
  del<T>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
}

interface ISocketService {
  emit(event: string, ...args: any[]): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  disconnect(): void;
}

interface IUIService {
  showToast(title: string, message: string, type: 'info' | 'success' | 'warning'): void;
  showModal(title: string, content: React.ReactNode): void;
  closeModal(): void;
  downloadFile(data: Blob | string, filename: string, mimeType?: string): void;
}
```

### 6.4 可用的 UI 扩展槽位

| Slot | 用途 |
|------|------|
| `teacher.tab` | 教师标签页 |
| `teacher.panel` | 教师独立全宽管理面板（v3.2） |
| `teacher.dashboard.widget` | 教师仪表盘小部件 |
| `student.view` | 学生视图 |
| `student.fullscreen` | 学生全屏视图/考试模式（v3.2） |
| `student.lesson.tool` | 学生学习工具 |
| `classroom.tool` | 课堂工具 |
| `global.setting` | 全局设置页扩展（v3.2） |

**学生端插件获取当前学生 ID**：宿主在渲染学生端扩展点（`student.view`、`student.fullscreen`）时，自动通过 `slotProps` 注入当前登录学生 ID。插件组件通过 props 接收：

```tsx
// 前端插件入口 frontend.tsx
export default function MyStudentPlugin(props: { studentId?: string }) {
  const studentId = props.studentId;
  if (!studentId) return <div>请先登录学生账号</div>;

  // 使用 studentId 获取该学生的个人数据
  return <div>当前学生 ID: {studentId}</div>;
}
```

### 6.5 invokeCommand（自 V2.5 起可用）

前端插件可以通过 `ctx.invokeCommand()` 调用后端已注册的 Command Handler：

```typescript
// 前端插件中调用后端命令
const result = await ctx.invokeCommand('poll.get_results', { pollId: 'xxx' });
// 命令类型会自动添加插件命名空间前缀
```

### 6.6 宿主依赖共享网关 (HostSharedDeps)

> **⚠️ JSX 运行时限制**：`HostSharedDeps` 仅提供 `React` 和 `ReactDOM` 经典运行时，**不包含 `react/jsx-runtime`**。插件前端代码必须使用经典 JSX 转换（`"jsx": "react-jsx"` 不可用）：
>
> ```json
> // tsconfig.json — 插件项目
> { "compilerOptions": { "jsx": "react" } }  // 经典模式，不是 "react-jsx"
> ```
>
> 或 esbuild 配置：
> ```javascript
> esbuild.build({
>   jsxFactory: "React.createElement",
>   jsxFragment: "React.Fragment",
>   external: ["react", "react-dom", "recharts", "lucide-react"],
> });
> ```

为避免每个第三方插件前端重复打包庞大的基础库，OpenLearnV2 提供了 **宿主依赖共享网关 (HostSharedDeps)**。全局 `window.HostSharedDeps` 暴露以下对象：

- `React` (npm: react)
- `ReactDOM` (npm: react-dom)
- `Recharts` (npm: recharts)
- `LucideReact` (npm: lucide-react)

插件前端构建时需将这些库配置为 external：

```javascript
import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['src/frontend.tsx'],
  bundle: true,
  outfile: 'dist/frontend.js',
  external: ['react', 'react-dom', 'recharts', 'lucide-react'],
  format: 'esm',
});
```

### 6.7 前端 JSX 转换配置（重要）

宿主通过 `window.HostSharedDeps` 提供的基础库：

| 共享对象 | NPM 包 | 提供的内容 |
|----------|--------|-----------|
| `HostSharedDeps.React` | `react` | React 对象（包含 `createElement`） |
| `HostSharedDeps.ReactDOM` | `react-dom` | ReactDOM 对象 |
| `HostSharedDeps.Recharts` | `recharts` | Recharts 组件库 |
| `HostSharedDeps.LucideReact` | `lucide-react` | Lucide 图标库 |

**宿主不提供** `react/jsx-runtime` 子路径。因此构建前端时**必须使用经典 JSX 转换**（`React.createElement`），不能使用自动 JSX 运行时。

**tsconfig.json 配置：**

```json
{
  "compilerOptions": {
    "jsx": "react"
  }
}
```

> `"jsx"` 必须是 `"react"`，不能是 `"react-jsx"`。

**esbuild 构建注意事项：**

esbuild 默认读取项目根目录的 `tsconfig.json`。如果 tsconfig 中 `"jsx"` 设为 `"react-jsx"`，无论 build API 中如何设置 `jsx: 'transform'` 或 `jsxFactory`，都会被 tsconfig 覆盖，最终产物仍会包含 `import ... from "react/jsx-runtime"` 导致运行时错误。

**推荐 esbuild 构建配置：**

```javascript
import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['src/frontend.tsx'],
  bundle: true,
  outfile: 'dist/frontend.js',
  external: ['react', 'react-dom', 'recharts', 'lucide-react'],
  format: 'esm',
  platform: 'browser',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
});
```

**常见错误排查：**

| 错误信息 | 原因 | 解决方法 |
|----------|------|----------|
| `Failed to resolve module specifier "react/jsx-runtime"` | `tsconfig.json` 中 `jsx` 为 `"react-jsx"` | 改为 `"react"` |
| `React is not defined` | 前端未声明 `react` 为 `peerDependency` 或 `external` | 在构建配置中添加 `external: ['react']` |
| `process is not defined` | 构建 `platform` 未设为 `browser` | 设置 `platform: 'browser'` |

### 6.8 前端组件如何获取通信能力（完整示例）

前端插件的组件通过**模块级变量**拿到 `invokeCommand` 和扩展点注册能力。关键点：

- `registerExtensionPoint` 的 `component` 必须用**普通函数**声明（`function MyPanel() {}`），不要用箭头函数（esbuild 打包后闭包可能出问题）
- 组件通过模块级变量拿 `ctx`，因为扩展点组件不是由你的组件树渲染，props 不可控
- `default export` 是 `{ activate, deactivate }` 对象，不是组件本身

**完整示例：**

```typescript
// src/frontend.tsx

let ctx: any = null;

// ① 组件必须用普通 function 声明（不要用箭头函数）
function MyPanel() {
  const [data, setData] = React.useState([]);

  React.useEffect(() => {
    // 通过模块级变量拿到 invokeCommand
    ctx.invokeCommand('myplugin.list').then(setData);
  }, []);

  return React.createElement('div', null,
    data.map((item: any) =>
      React.createElement('div', { key: item.id }, item.name)
    )
  );
}

function MyWidget() {
  return React.createElement('div', null, '仪表盘卡片');
}

// ② activate 接收 host 传入的 FrontendPluginContext，存到模块变量
async function activate(hostCtx: any) {
  ctx = hostCtx;  // ← 关键：hostCtx 自带 invokeCommand、ui.registerExtensionPoint 等

  hostCtx.ui.registerExtensionPoint('teacher.tab', {
    id: 'my-tab',
    label: '我的面板',
    icon: 'Layout',
    component: MyPanel,     // ← 普通函数引用，不是 () => <MyPanel/>
    position: 10,
  });

  hostCtx.ui.registerExtensionPoint('teacher.dashboard.widget', {
    id: 'my-widget',
    label: '我的卡片',
    icon: 'BarChart3',
    component: MyWidget,
    position: 0,
  });
}

function deactivate() {}

// ③ default export 必须是 { activate, deactivate } 对象
export default { activate, deactivate };
```

**为什么 component 不能用箭头函数？**

esbuild 在打包箭头函数时可能改变其闭包作用域，导致 `React.createElement` 引用丢失。使用 `function` 声明可保证构建后的函数引用稳定。

**为什么通过模块级变量拿 ctx 而不是 props？**

扩展点组件由宿主渲染，props 由宿主控制。宿主向扩展点组件传递的 props 是宿主定义的（如 `studentId`、`lessonId` 等业务数据），不包含 `invokeCommand`。因此 API 调用能力必须通过模块级闭包变量传递。

---

## 7. 安全与权限

### 7.1 高危操作审批

设置 `isHighRisk: true` 的 Action，AI Agent 执行时会进入审批流程：

```typescript
await actionRegistry.register({
  id: 'dangerous-op',
  commandType: 'lesson.delete',
  description: '删除课程。高风险操作。',
  capabilityRequired: 'lesson:delete',
  isHighRisk: true,  // ← 需要教师审批
  inputSchema: { ... },
});
```

执行流程：

1. AI Agent 调用此工具
2. 命令被写入 `pending_commands` 审批表
3. 教师收到审批通知
4. 教师可选择批准、拒绝或修改参数
5. 批准后才实际执行

**注意**：`administrator` 角色执行时自动绕过高危审批。

### 7.2 权限模型

- 插件通过 `capabilitiesProposed` 声明所需权限
- 教师/管理员在安装时可审查权限
- 运行时通过 CapabilityGuard 拦截检查
- 支持通配符匹配（如 `lesson:*` 匹配所有课程操作）

### 7.3 指令隔离与命名空间保护

为防止第三方插件恶意冒充、拦截或篡改内核及其他插件的敏感指令，OpenLearnV2 实施了 **命名空间防欺骗保护**：

**命令解析规则**：

1. **系统和内核插件**（`@openlearn/` 前缀）：全局命名空间访问权，直接使用短指令名称
2. **点号命名空间指令**（如 `quiz.create`、`vote.cast`）：直接以原名全局注册，保证协同工具无感工作
3. **裸字符指令**（不含 `.`）：自动添加 `{pluginId}.` 前缀，实现强沙箱隔离

**防越权劫持**：

- 内核在命令注册阶段自动执行 UUID 强检查
- 第三方插件企图注册以其他非本插件 UUID 格式为前缀的指令时，注册拦截器抛出异常并阻止激活

---

## 8. 高级特性

### 8.1 Worker Thread 隔离模式

在生产环境中，插件可在独立 Worker Thread 中运行：

```typescript
// 数据库设置 execution_mode
db.prepare("UPDATE plugins SET execution_mode = 'worker' WHERE id = ?").run(pluginId);
```

Worker 模式的特点：

- 独立线程隔离，崩溃不影响主进程
- 通过 RPC 代理访问内核服务（MethodProxy + EventBusProxy）
- 10 秒激活超时
- 崩溃后自动清理（dispose 强制回收）

**结构化错误类**（`packages/core/worker-runtime/errors.ts`）：

- `WorkerActivateError` — 插件在 Worker 内激活失败
- `WorkerTimeoutError` — RPC 调用或激活/停用超时
- `WorkerTransportError` — postMessage 通信层失败
- `WorkerCapabilityError` — 跨边界能力检查拒绝
- `WorkerNotSupportedError` — 运行时不支持的功能

### 8.2 前端 Worker 模式

前端同样支持 Worker 隔离，通过 `BrowserWorkerManager` 将插件运行在 Web Worker 中，与后端一致的隔离保证。插件需在安装时指定 `executionMode: 'worker'`。

### 8.3 热重载（开发模式）

在 `NODE_ENV=development` 时，PluginHost 自动启用文件监听：

1. `HotReloadController` 通过 chokidar 监听 `plugins/` 目录
2. 检测文件变更（debounce 300ms）
3. 自动停用旧版本 → 清除中间件 → 激活新版本
4. 无需重启服务器

### 8.4 生命周期中间件

PluginHost 支持在 6 个生命周期阶段注册中间件（洋葱模型）：

```typescript
pluginHost.registerMiddleware('beforeActivate', async (ctx, next) => {
  console.log(`[Auth] 检查插件 ${ctx.pluginId} 的激活权限`);
  await next();  // 继续执行
});
```

可用阶段：`beforeActivate`、`afterActivate`、`beforeDeactivate`、`afterDeactivate`、`beforeCommand`、`afterCommand`。

### 8.5 异步后台任务

```typescript
// 注册任务处理器
await processManager.registerHandler('my_task_type', async (
  processId, payload, state, log, updateState
) => {
  log('任务开始...');
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    updateState({ progress: i / 10 });
    log(`进度: ${i * 10}%`);
  }
  log('任务完成');
});

// 启动任务
const processId = await processManager.spawn(
  '我的后台任务',
  'my_task_type',
  { input: 'some data' }
);

// 进程事件
eventBus.subscribe('process.completed', (event) => {
  console.log('任务完成:', event.payload.processId);
});
```

### 8.6 声明式数据库迁移

使用 `ctx.db.migrate()` 进行插件数据库版本管理：

```typescript
// 首次激活时调用（idempotent）
await ctx.db.migrate(1, async (sqliteDb) => {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS my_table (
      id TEXT PRIMARY KEY,
      data TEXT
    );
  `);
});

// 后续版本升级
await ctx.db.migrate(2, async (sqliteDb) => {
  sqliteDb.exec(`ALTER TABLE my_table ADD COLUMN extra TEXT DEFAULT ''`);
});
```

### 8.7 跨插件服务共享（V3.2）

多个插件可以通过类型安全的 DI Token 互相分享服务。

**提供方插件** 将接口定义为 Token + Type 对，放在 `src/contracts/` 目录中：

```typescript
// ext-quiz-engine/src/contracts/index.ts
import { Token } from '@openlearn/plugin-sdk';

export interface IQuizEngineService {
  score(answers: Answer[]): number;
  generateQuestion(topic: string): Question;
}

export const QuizEngineToken = new Token<IQuizEngineService>(
  'ext-quiz-engine:IQuizEngineService',
  '1.0.0'
);
```

在 `manifest.json` 中声明：

```json
{
  "provides": ["ext-quiz-engine:IQuizEngineService"]
}
```

在 `activate` 中提供实例：

```typescript
ctx.provide(QuizEngineToken, new QuizEngine());
```

**消费方插件** 在编译期导入类型，运行时通过 Token 解析：

```typescript
import type { IQuizEngineService } from 'ext-quiz-engine/contracts';
import { QuizEngineToken } from 'ext-quiz-engine/contracts';

const engine = await ctx.resolve(QuizEngineToken);
// engine 类型为 IQuizEngineService，有完整的 IDE 补全
const score = engine.score(answers);
```

在 `manifest.json` 中声明依赖：

```json
{
  "requires": [
    "@openlearn/core:ICommandBusService@^1.0.0",
    "ext-quiz-engine:IQuizEngineService"
  ]
}
```

**校验机制**：

- 安装时：检查提供方 `manifest.provides` 是否声明了 token → warn
- 激活时：检查提供方是否已激活并提供服务 → 阻塞
- 激活顺序：`ext-quiz-engine:IQuizEngineService` 自动推导为对 `ext-quiz-engine` 的依赖，提供方先激活

---

## 9. 测试与调试

### 9.1 结构化日志

使用 `ctx.log` 替代 `console.log`，自动注入 `pluginId` 和 `timestamp`：

```typescript
ctx.log.info('Handler registered', { commandType: 'poll.create' });
ctx.log.error('Database connection failed', { error: error.message });
ctx.log.debug('Request processed', { latency: 23, payload: data });
```

### 9.2 查看进程状态

```bash
# 查看插件列表
curl http://localhost:9000/api/plugins

# 查看后台进程
# 在应用 UI：系统设置 → 进程管理
```

### 9.3 事件审计

所有事件自动写入 SQLite `events` 表：

```sql
SELECT * FROM events WHERE type LIKE 'poll.%' ORDER BY timestamp DESC;
```

### 9.4 插件测试

使用 `@openlearn/plugin-test-kit` 进行单元测试：

```bash
npm install --save-dev @openlearn/plugin-test-kit vitest
```

```typescript
// __tests__/index.test.ts
import { describe, it, expect } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';
import plugin from '../src/index';

describe('my-plugin', () => {
  it('should activate and register handler', async () => {
    const ctx = createMockContext();
    await plugin.activate(ctx);

    const handlers = ctx.services.commandBus._getHandlers();
    expect(handlers).toContain('myplugin.hello');
  });
});
```

---

## 10. 发布前自检清单

在打包插件 ZIP 前，逐项检查以下内容以避免常见问题：

### Manifest 检查

- [ ] `id` 格式为 `@scope/name`，全局唯一
- [ ] `engines.openlearn` 版本号**不高于**目标系统的实际版本
- [ ] `requires` 中所有服务 Token 的版本前缀正确
- [ ] `classroomTools` 中每个 `commandType` 都有对应的 `registerHandler`

### 服务端检查

- [ ] 每个 Action（`actionRegistry.register`）都有对应的 Command Handler（`commandBus.registerHandler`）
- [ ] `ctx.db.ensureTable` 创建的每个表都有注释说明用途
- [ ] 数据库操作只使用 `prepare().run()` / `.get()` / `.all()`，避免 `exec()`、`pragma()` 等新版本方法
- [ ] 跨插件调用（如 VFS）在 `capabilitiesProposed` 中声明了对应权限
- [ ] `activate()` 中所有可能出现异常的操作包裹了 `try/catch`

### 前端检查

- [ ] `tsconfig.json` 中 `jsx` 为 `"react"`（非 `"react-jsx"`）
- [ ] `react` / `react-dom` / `recharts` / `lucide-react` 标记为 `external`（由 HostSharedDeps 提供）
- [ ] 不直接 import React hooks 之外的 React 子路径（如 `react/jsx-runtime`）
- [ ] 使用的扩展点槽位在目标系统版本中存在（参考 [2.6 版本兼容性速查表](#26-版本兼容性速查表)）
- [ ] 前端调用的命令在服务端有对应的 handler

### 构建检查

- [ ] `npx @openlearn/plugin-sdk build` 无报错
- [ ] ZIP 产物包含 `manifest.json` + `index.js` +（可选）`frontend.js`
- [ ] 解压 ZIP 后检查 `index.js` 不包含禁用的裸导入（参考 [11.4 常见打包错误与排查](#114-常见打包错误与排查)）
- [ ] 解压 ZIP 后检查 `frontend.js` 不包含 `import ... from "react/jsx-runtime"`

---

## 11. 发布与分发

### 11.1 使用 CLI 脚手架

OpenLearnV2 提供 `@openlearn/plugin-sdk` CLI 工具快速创建项目：

```bash
# 脚手架创建
npx @openlearn/plugin-sdk init --name my-plugin

# 安装依赖
cd my-plugin && npm install

# 构建 ZIP
npx @openlearn/plugin-sdk build

# 产物位于 my-plugin.zip，上传到插件中心即可安装
```

支持三种模板：`server-only`、`full-stack`、`frontend-only`。

### 11.2 手动打包为 ZIP

```bash
# 插件目录结构
my-plugin/
  index.js          # 入口（export default { manifest, activate }）
  package.json      # 可选
  README.md         # 文档

# 打包
zip -r my-plugin.zip my-plugin/
```

### 11.3 安装 ZIP 插件

在「系统设置」→「插件中心」上传 ZIP 文件，系统自动：

1. 解压 ZIP
2. 提取 index.js 作为入口
3. 解析 manifest
4. **使用 esbuild 的 `openlearn-token-enforcer` 插件进行二次扫描**（见 11.4）
5. 验证依赖（SemVer 兼容性检查）
6. 存入数据库
7. 可选：立即激活

### 11.4 常见打包错误与排查

#### 错误：`Import of "<module>" is not allowed`

**错误信息示例：**

```
Build failed with 1 error:
<stdin>:6:27: ERROR: [plugin: openlearn-token-enforcer]
Import of "crypto" is not allowed.
Plugins may only use relative imports or @openlearn/* Token services.
```

**原因：** OpenLearn 在接收到上传的 ZIP 后，会使用内置的 esbuild `openlearn-token-enforcer` 插件对入口文件（`index.js`）进行安全扫描。该扫描器**只允许两类导入**：

| 允许 | 示例 |
|------|------|
| 相对路径导入 | `import foo from './utils'` |
| `@openlearn/*` Token 服务 | `import { IDatabaseToken } from '@openlearn/plugin-sdk'` |

所有其他**裸 specifier 导入**（包括 Node.js 内置模块）都会被拒绝：

```typescript
// ❌ 禁止 — 会触发 token-enforcer 报错
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import _ from 'lodash';
```

**解决方案：**

**① 替换 `crypto.randomUUID()`（最常见）**

```typescript
// ❌ 错误写法
import { randomUUID } from 'crypto';
const id = randomUUID();

// ✅ 正确写法 — 使用全局 Web Crypto API，Node.js 20+ 和现代浏览器均可用，无需 import
const id = globalThis.crypto.randomUUID();
// 或更简短（全局 crypto 在 Node.js 20+ 中与 globalThis.crypto 等价）
const id = crypto.randomUUID();
```

**② 替换时间戳 ID（更简单）**

```typescript
// 对于不需要密码学安全性的 ID，可以用时间戳 + 随机数组合
const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
```

**③ 替换 `fs`（文件操作）**

插件不应直接使用 `fs` 模块，应通过 VFS 服务（需在 manifest 中声明 `vfs:read`/`vfs:write` 权限）：

```typescript
// ❌ 错误写法
import { readFileSync } from 'fs';

// ✅ 正确写法 — 通过 VFS 服务
const { IStorageServiceToken } = await import('@openlearn/plugin-sdk');
const storage = await ctx.resolve(IStorageServiceToken);
await ctx.services.commandBus.execute(
  ctx.services.commandBus.createCommand('vfs.read_file', { path: '/my/file.txt' }, ctx.pluginId)
);
```

**④ 替换 `path`（路径操作）**

```typescript
// ❌ 错误写法
import path from 'path';

// ✅ 正确写法 — 使用原生字符串操作
const filename = filePath.split('/').pop() ?? '';
const ext = filename.split('.').pop()?.toLowerCase() ?? '';
```

**⑤ 替换第三方 npm 包**

部分常用包已通过 `ctx.require()` 白名单共享（无需 import）：

| 包名 | 使用方式 |
|------|----------|
| `uuid` | `const { v4: uuidv4 } = ctx.require('uuid')` |
| `xlsx` | `const XLSX = ctx.require('xlsx')` |
| `recharts` | `const { LineChart } = ctx.require('recharts')` |
| `jspdf` | `const { jsPDF } = ctx.require('jspdf')` |
| `lucide-react` | `const { BookOpen } = ctx.require('lucide-react')` |

对于其他第三方包，需在构建阶段将其完整代码内联到 `index.js` 中（esbuild bundle），避免在产物中残留裸 specifier 导入语句。

**自检方法（上传前验证）：**

```bash
# 检查产物 index.js 中是否有不在白名单内的裸导入
grep -E '^import .+ from "[^@\./]' dist/index.js
# 有输出 = 有问题；无输出 = 通过
```

### 11.5 版本兼容性

插件依赖声明支持 SemVer 范围：

- `^1.0.0` — 兼容 1.x.x
- `~1.2.0` — 兼容 1.2.x
- `>=1.0.0 <2.0.0` — 显式范围

安装时 PluginHost 自动检查兼容性，不兼容则拒绝安装。

---

## 附录 A：完整插件模板

```typescript
// 复制此模板开始开发你的插件
import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@you/plugin-name',
    name: '我的插件',
    version: '1.0.0',
    main: 'index.js',
    description: '插件描述',
    author: '作者名',
    engines: { openlearn: '^2.5.0' },
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read'],
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);

    // TODO: 注册 Actions 和 Handlers

    ctx.log.info('Plugin activated');
  },

  deactivate: async () => {
    console.log('插件已停用');
  },
};
```

## 附录 B：现有内置插件参考

| 插件 | 文件 | 命令示例 |
|------|------|----------|
| 课堂核心 | `packages/plugins/builtin.ts` | `lesson.create`, `whiteboard.draw`, `whiteboard.query` |
| 虚拟文件系统 | `packages/plugins/vfs.ts` | `vfs.write_file`, `vfs.read_file`, `vfs.list_dir` |
| 管理插件 | `packages/plugins/management.ts` | `class.create`, `student.enroll`, `assignment.create` |
| AI 规划器 | `packages/plugins/ai-planner.ts` | `ai.start_generation`, `ai.apply_recommendation` |
| 作业评估 | `packages/plugins/assignment-eval.ts` | `assignment.evaluate`, `peer_review.create` |
| 进程管理 | `packages/plugins/process.ts` | `process.spawn`, `process.kill`, `process.list` |

---

# 第 4 章 插件脚手架开发指南

本指南面向第三方开发者，介绍如何使用 `@openlearn/plugin-sdk` CLI 工具从零开始创建、构建和发布 OpenLearn 插件。

## 目录

1. [快速开始](#1-快速开始-2)
2. [模板说明](#2-模板说明)
3. [项目结构](#3-项目结构)
4. [开发流程](#4-开发流程)
5. [构建与打包](#5-构建与打包)
6. [安装与调试](#6-安装与调试)
7. [发布到 npm](#7-发布到-npm)
8. [CLI 命令参考](#8-cli-命令参考)
9. [常见问题](#9-常见问题-1)

---

## 1. 快速开始

### 前提条件

- Node.js >= 18
- npm >= 9

### 3 分钟创建第一个插件

```bash
# 1. 脚手架生成项目
npx @openlearn/plugin-sdk init --name hello-world

# 2. 安装依赖
cd hello-world
npm install

# 3. 构建插件 ZIP
npx @openlearn/plugin-sdk build

# 4. 产物位于 hello-world.zip
# 上传到 OpenLearn 插件中心即可安装
```

### 交互式创建

不传参数，CLI 会引导你逐步填写：

```bash
npx @openlearn/plugin-sdk init
```

```
? Plugin package name (kebab-case): my-voting-tool
? Description (default: "my-voting-tool plugin"): 课堂投票工具
? Author (default: "OpenLearn Developer"): teacher-li

  server-only   — Backend plugin (commands, events, AI tools)
  full-stack    — Full plugin (server + React frontend)
  frontend-only — Pure UI extension (React component)

? Template (default: server-only): full-stack

✔ Scaffolded my-voting-tool/
```

---

## 2. 模板说明

提供三种模板，覆盖不同的插件类型：

### server-only — 纯后端插件

适用于只需注册 AI 工具和命令处理器的插件。没有前端界面。

**特点：**

- 注册 AI Action（`actionRegistry.register()`）
- 注册命令处理器（`commandBus.registerHandler()`）
- 发布事件（`eventBus.publish()`）
- 无前端组件

**生成文件：**

```
├── src/index.ts          # 服务端入口（manifest + activate）
├── package.json
├── tsconfig.json
└── .gitignore
```

### full-stack — 全栈插件

最完整的模板，包含服务端逻辑和 React 前端组件。适用于需要教师/学生界面的插件。

**特点：**

- 服务端：AI 工具 + 命令 + 事件 + 数据库表
- 前端：React 组件，通过宿主共享依赖运行
- 自动注入 `classroomTools` 声明
- 前端外部化 react/react-dom/recharts/lucide-react（宿主提供）

**生成文件：**

```
├── src/
│   ├── index.ts          # 服务端入口
│   └── frontend.tsx       # 前端 React 组件
├── package.json
├── tsconfig.json
└── .gitignore
```

### frontend-only — 纯前端插件

只需一个 UI 面板或课堂工具的插件。没有服务端命令处理。

**特点：**

- 仅含 frontend.tsx React 组件
- `manifest.requires` 为空
- 适合：白板小工具、仪表盘小部件、学生视图扩展

**生成文件：**

```
├── src/
│   ├── index.ts          # 最小化 manifest（仅 frontend 声明）
│   └── frontend.tsx       # 前端 React 组件
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## 3. 项目结构

脚手架生成的完整项目结构：

```
my-plugin/
├── package.json              # 插件元信息 + 依赖声明
├── tsconfig.json             # TypeScript 编译配置
├── .gitignore                # Git 忽略规则
├── README.md                 # （手动添加）插件文档
│
├── src/
│   ├── index.ts              # ★ 服务端入口
│   │                         # export default { manifest, activate, deactivate? }
│   │
│   └── frontend.tsx          # ★ 前端入口（full-stack / frontend-only 模板）
│                             # export default function MyComponent() { ... }
│
└── dist/                     # 构建产物（build 命令自动生成）
    ├── index.js              # 打包后的服务端代码
    ├── frontend.js           # 打包后的前端代码（如有）
    └── my-plugin.zip         # ★ 最终发布产物
```

### package.json 关键字段

```json
{
  "name": "openlearn-plugin-hello-world",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@openlearn/plugin-sdk": "^3.2.0"
  }
}
```

### TypeScript 配置

脚手架生成的 `tsconfig.json` 已配置好 `bundler` 模块解析和严格模式：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx"
  }
}
```

---

## 4. 开发流程

### 4.1 理解入口文件

`src/index.ts` 是插件的唯一入口，必须 default export 一个包含 `manifest` 和 `activate` 的对象：

```typescript
import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
} from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@yourname/my-plugin',          // 全局唯一标识
    name: '我的插件',                    // 显示名称
    version: '0.1.0',
    description: '插件描述',
    author: '你的名字',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read', 'lesson:write'],
    classroomTools: [{                    // 可选：前端课堂工具
      id: 'my-tool',
      name: '我的工具',
      icon: 'Puzzle',
      commandType: 'myplugin.open_tool',
    }],
    engines: { openlearn: '>=5.0.0' },
  },

  async activate(ctx: PluginContext) {
    // 在这里注册 AI 工具和命令处理器
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    // 1. 注册 AI Action
    await actionRegistry.register({
      id: 'myplugin-hello',
      commandType: 'myplugin.hello',
      description: '打招呼',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '名字' },
        },
        required: ['name'],
      },
    });

    // 2. 注册命令处理器
    await commandBus.registerHandler('myplugin.hello', {
      async execute(command) {
        const payload = command.payload as any;
        return { message: `Hello, ${payload.name}!` };
      },
    });
  },

  async deactivate() {
    // 清理资源
  },
};
```

### 4.2 可用的服务接口

在 `activate(ctx)` 中，通过 `ctx.services` 访问 7 个内核服务：

| 服务 | 访问方式 | 用途 |
|------|---------|------|
| CommandBus | `ctx.services.commandBus` | 注册/执行命令 |
| EventBus | `ctx.services.eventBus` | 发布/订阅事件 |
| ActionRegistry | `ctx.services.actionRegistry` | 注册 AI 工具 |
| Capability | `ctx.services.capability` | 权限管理 |
| Process | `ctx.services.processManager` | 后台进程 |
| Storage | `ctx.services.storage` | K-V 存储 |
| AI | `ctx.services.ai` | 文本生成 |

通过 DI 解析更多服务：

```typescript
import { IDatabaseToken } from '@openlearn/plugin-sdk';
const db = await ctx.resolve(IDatabaseToken);
```

### 4.3 开发前端组件（full-stack / frontend-only）

`src/frontend.tsx` 导出一个 React 组件，在宿主应用中渲染：

```typescript
import React, { useState } from 'react';

export default function MyPluginUI() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: 16 }}>
      <h2>我的插件</h2>
      <p>计数器: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
    </div>
  );
}
```

**重要：** 前端不打包 `react`、`react-dom`、`recharts`、`lucide-react`。这些库由宿主应用通过 `window.HostSharedDeps` 提供，CLI build 命令会自动将它们标记为 external。

### 4.4 使用插件数据库

每个插件有独立的数据库命名空间：

```typescript
// 创建表
await ctx.db.ensureTable('polls', `
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  options TEXT NOT NULL
`);

// 获取带命名空间的表名
const tableName = ctx.db.table('polls');
// → "plugin_@yourname_my-plugin_polls"

// 通过 DI 拿到 raw better-sqlite3 Database 操作
const db = await ctx.resolve(IDatabaseToken);
db.prepare(`INSERT INTO ${tableName} ...`).run(...);
```

---

## 5. 构建与打包

### 构建命令

```bash
# 在插件项目根目录运行
npx @openlearn/plugin-sdk build

# Watch 模式（文件变动自动重新构建）
npx @openlearn/plugin-sdk build --watch
```

### 构建流程

CLI `build` 命令自动完成以下步骤：

1. **验证** — 检查 `src/index.ts` 是否存在
2. **esbuild 打包** — 将 `src/index.ts` 打包为 `dist/index.js`
   - `@openlearn/plugin-sdk` 作为 external（运行时由宿主提供）
   - 其他依赖打包进产物
3. **前端打包**（可选）— 将 `src/frontend.tsx` 打包为 `dist/frontend.js`
   - `react`、`react-dom`、`recharts`、`lucide-react` 作为 external（宿主提供）
4. **manifest 提取** — 从构建产物或 `manifest.json` 提取 manifest
5. **ZIP 打包** — 将 `index.js` + `manifest.json` + `frontend.js`（可选）打包为 ZIP

产物输出：

```
dist/
├── index.js          # 服务端 bundle
├── frontend.js       # 前端 bundle（如有）
└── my-plugin.zip     # 可直接上传到插件中心
```

### 手动 manifest.json

如果需要在 ZIP 中包含自定义的 manifest，在项目根目录创建 `manifest.json`：

```json
{
  "id": "@yourname/my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "description": "...",
  "author": "...",
  "requires": ["..."],
  "capabilitiesProposed": ["..."],
  "classroomTools": [{ "id": "...", "name": "...", "icon": "...", "commandType": "..." }]
}
```

CLI build 会优先使用此文件，而不是从构建产物中提取。

---

## 6. 安装与调试

### 在 OpenLearn 中安装

1. 打开 OpenLearn 管理后台
2. 进入「系统设置」→「插件中心」
3. 选择「上传插件」，上传 `my-plugin.zip`
4. 在插件列表中找到你的插件，点击激活
5. 如果插件声明了 `classroomTools`，进入白板后可在工具栏看到

### 调试技巧

**查看日志：**

服务端 `console.log` 输出会显示在 OpenLearn 服务器日志中（带 `[Plugin:<id>]` 前缀）。

**查看事件：**

```sql
SELECT * FROM events WHERE type LIKE 'myplugin.%' ORDER BY created_at DESC;
```

**重新激活：**

修改代码后，重新构建 ZIP，在插件中心点击「更新」上传新版本。

### 测试

使用 `@openlearn/plugin-test-kit` 进行单元测试：

```bash
npm install --save-dev @openlearn/plugin-test-kit vitest
```

```typescript
// __tests__/index.test.ts
import { describe, it, expect } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';
import plugin from '../src/index';

describe('my-plugin', () => {
  it('should activate and register handler', async () => {
    const ctx = createMockContext();
    await plugin.activate(ctx);

    const handlers = ctx.services.commandBus._getHandlers();
    expect(handlers).toContain('myplugin.hello');
  });
});
```

---

## 7. 发布到 npm

如果希望你的插件能被其他开发者通过 npm 安装和二次开发：

```bash
# 确保 package.json 中 "private" 已移除或设为 false
npm publish --access public
```

其他开发者可以：

```bash
npm install openlearn-plugin-my-tool
```

---

## 8. CLI 命令参考

### init — 脚手架创建

```
npx @openlearn/plugin-sdk init [options]
```

**选项：**

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--name <name>` | 插件包名（kebab-case） | （交互式输入） |
| `--description <desc>` | 插件描述 | `"{name} plugin"` |
| `--author <author>` | 作者名 | `"OpenLearn Developer"` |
| `--template <tpl>` | 模板类型 | `server-only` |

**模板类型：** `server-only` | `full-stack` | `frontend-only`

**非交互式示例：**

```bash
npx @openlearn/plugin-sdk init \
  --name class-polls \
  --description "Classroom polling tool" \
  --author "teacher-wang" \
  --template full-stack
```

### build — 构建打包

```
npx @openlearn/plugin-sdk build [options]
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--watch`, `-w` | 监听文件变更，自动重新构建 |

**行为：**

- 必须在插件项目根目录运行（需存在 `package.json` 和 `src/index.ts`）
- 构建产物输出到 `dist/` 目录
- ZIP 文件同时输出到 `dist/` 和项目根目录

---

## 9. 常见问题

### Q: 构建报错 "esbuild not found"

`@openlearn/plugin-sdk` 的 `dependencies` 中已包含 esbuild，但如果你使用 `--template` 生成的旧项目，请手动安装：

```bash
npm install --save-dev esbuild jszip
```

### Q: 前端组件中的 React hooks 不工作？

确认 `package.json` 中有 `"peerDependencies": { "react": ">=17" }`，且 build 命令会自动将 react 作为 external。不要在前端组件中打包 React。

### Q: 如何让 AI Agent 发现我的插件功能？

在 `activate()` 中调用 `actionRegistry.register()`。AI Agent 会自动从 `ActionRegistry` 获取所有注册的工具。`description` 是 AI 理解工具用途的关键，**用中文写清楚**。

### Q: 插件间如何通信？

通过事件总线：插件 A 发布事件，插件 B 订阅事件。事件命名规则：`{pluginId}.{action}_done`（过去式）。

### Q: 我的插件需要访问文件系统？

使用 VFS（虚拟文件系统）插件提供的 API，而不是直接使用 `fs` 模块。在 manifest 中声明 `vfs:read` / `vfs:write` 权限。

### Q: 数据库表如何命名？

使用 `ctx.db.ensureTable()` 和 `ctx.db.table()`，系统会自动添加 `plugin_{pluginId}_` 前缀。不要手动拼接表名。

### Q: 上传 ZIP 报错 `Import of "crypto" is not allowed` ⚠️

**这是最常见的打包错误。** OpenLearn 在接收 ZIP 后会用 `openlearn-token-enforcer` 对产物 `index.js` 进行安全扫描，**只允许相对路径导入和 `@openlearn/*` Token 服务**，所有 Node.js 内置模块（`crypto`、`fs`、`path`）和第三方 npm 包的裸 specifier 导入都会被拒绝。

**原因**：构建脚本（如 `esbuild`）在打包时没有把这些模块 inline 进 `index.js`，而是保留了裸导入语句。

**最常见修复（`crypto.randomUUID`）：**

```typescript
// ❌ 错误 — 保留了 Node.js 裸导入
import { randomUUID } from 'crypto';

// ✅ 正确 — 使用全局 Web Crypto API（Node.js 20+ 和浏览器均内置，无需任何 import）
const id = crypto.randomUUID();
```

**上传前自检：**

```bash
# 检查 dist/index.js 中是否有不在白名单内的裸导入
grep -E '^import .+ from "[^@\./]' dist/index.js
# 有输出 = 有问题；无输出 = 通过
```

完整替换方案见 [第 3 章 插件开发完全指南 §11.4](#114-常见打包错误与排查)。

---

> **相关文档**：[第 1 章 安装与使用指南](#第-1-章-安装与使用指南) · [第 2 章 核心架构与设计](#第-2-章-核心架构与设计) · [第 3 章 插件开发完全指南](#第-3-章-插件开发完全指南)
> 最后更新：2026-07-17
