# OpenLearnV2 安装与使用指南

> ✅ **2026-10-03 审计警告已全部解决（2026-10-25 复核）**：PM2 应用名、Docker `/data` 卷布局、包管理器口径（全仓 pnpm）、备份/重置路径覆盖均已在正文修正。若发现正文与 `Dockerfile` / `ecosystem.config.cjs` / `package.json` 冲突，以代码为准并提 issue。

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

| 环境                  | CPU   | 内存  | 磁盘   |
| --------------------- | ----- | ----- | ------ |
| 开发 / 个人使用       | 2 核+ | 2 GB+ | 1 GB+  |
| 生产部署（30 人并发） | 4 核+ | 4 GB+ | 10 GB+ |

### 软件要求

- **Node.js** 20.x / 22.x / 24.x（LTS 推荐 22.x；`package.json` 的 `engines` 约束为 `20.x || 22.x || 24.x`）
- **pnpm**（**本仓库是 pnpm workspace**，见 `pnpm-workspace.yaml`；全部命令以 `pnpm` 为准，**不要用 `npm install`**——会生成第二份依赖树）
- **操作系统**：Linux（推荐）、macOS、Windows（WSL2 推荐）

> **为什么不是「Node ≥ 20」**：本平台的硬依赖 `better-sqlite3` 是**原生模块**，它的
> `.node` 二进制按 Node 的 ABI 编译，不是跨版本通用的 JS 包。同一份 `node_modules`
> 换到另一个 Node 主版本上就会在运行期炸出 `ERR_DLOPEN_FAILED /
NODE_MODULE_VERSION 不一致` —— 这条原生报错对客户不可操作。平台因此只承诺
> **实测过的**主版本：20.x（现场旧 LTS）、22.x（CI / Docker / `.nvmrc` 全程钉它）、
> 24.x（当前 LTS）。21.x / 23.x 非 LTS 且 better-sqlite3 官方不提供 21.x 预编译产物；
> 25.x 及以上本项目未验证。

验证安装：

```bash
node --version   # 应输出 v20.x / v22.x / v24.x 之一（仓库 .nvmrc 已钉住 22）
pnpm --version   # 应输出 10.x（仓库 `packageManager` 钉 `10.33.4`，Corepack 会自动对齐）
```

### Node 版本守卫：拦在哪、拦成什么样

平台在**三个位置**拦版本问题，报的都是同一份可执行指引（`scripts/assert-node-runtime.mjs`）：

| 位置                   | 触发时机                            | 行为                                                        |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------- |
| 安装期（`preinstall`） | `npm install` / 源码 `pnpm install` | **硬失败**：安装当场中止，打印修复指引                      |
| CLI 入口               | 执行 `openlearn-next <命令>`        | **硬失败**：非诊断类命令直接拒绝执行并退出码 1              |
| 服务启动期             | `node dist/server.cjs` / `pnpm dev` | **硬失败**：把 `ERR_DLOPEN_FAILED` 翻译成「重建还是换版本」 |

两处已知边界，说清楚免得误判：

- **pnpm v10 默认不执行依赖的生命周期脚本**，所以「从 npm registry 安装本平台」时，
  安装期那道闸在 pnpm 下**不会触发**（npm 下会触发）。此时兜底的是 CLI 与启动期两道闸 ——
  客户敲下第一条命令就会看到人话报错，而不是原生栈。
- `doctor` / `compat-report` / `check-update` 是**只读诊断**命令，即便版本不受支持也
  照常可用 —— 客户在环境有问题时最需要能跑起来的正是它们。

---

## 2. 快速开始

### 方式一：npx 一键启动与 CLI 工具链（推荐）

无需 clone 项目，首次运行时自动下载安装并提供全套运维指令：

```bash
# 1. 标准启动（推荐指定 @latest 强制检索 npm registry 最新版本，杜绝旧缓存版本漂移）
npx openlearn-next@latest

# 2. 启动并自动唤起默认浏览器 (-o)
npx openlearn-next@latest -o

# 3. 自定义端口 (-p) 与绑定特定网卡 (-H)
npx openlearn-next@latest -p 3000 -H 127.0.0.1

# 4. 临时演示沙盒模式（--demo：在 /tmp/ 创建一次性数据，退出自动销毁）
npx openlearn-next@latest --demo -o

# 5. 指定 CORS 跨域白名单来源
npx openlearn-next@latest --cors "http://localhost:5173,*"

# 6. 自定义数据库文件存储路径
npx openlearn-next@latest --db-path ./my.db
# 或通过环境变量：OPENLEARN_DB_PATH=./my.db npx openlearn-next@latest
```

#### 🛠️ CLI 常用运维与诊断子命令

`npx openlearn-next` 内置免界面运维工具链：

```bash
# 环境健康体检与防版本漂移自检（--fix 可一键自愈旧版缓存与目录权限）
npx openlearn-next doctor
# 或一键自动自愈漂移与环境异常：
npx openlearn-next doctor --fix

# 一键在线数据快照冷备（毫秒级导出当前数据库备份）
npx openlearn-next backup my_backup.db

# 从快照安全还原数据（自动创建旧数据库回滚镜像）
npx openlearn-next restore my_backup.db

# 免界面直接重置管理员密码（默认重置为 admin 或指定新密码）
npx openlearn-next reset-admin --password new_password_123

# 终端速查当前已安装的所有插件清单与运行状态
npx openlearn-next plugins

# 清理 NPX 远端历史包缓存（解决版本漂移或更新不生效）
npx openlearn-next clean --npx
```

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

# 安装依赖（仓库是 pnpm workspace，见 pnpm-workspace.yaml，必须用 pnpm）
pnpm install

# 启动开发服务（Express + Vite HMR，端口 9000）
pnpm run dev
# 或：./dev.sh（等价，内部即 npx tsx --no-cache server.ts）

# 访问（首次登录后请前往「系统管理 -> AI 提供商管理」添加大模型提供商）
open http://localhost:9000
```

> ⚠️ **不要用 `npm install`**。本仓库是 pnpm workspace（`pnpm-workspace.yaml` + `pnpm-lock.yaml`），含 4 个子包：`packages/core`、`packages/plugin-sdk`、`packages/plugin-test-kit`、`packages/bridge-sdk`（MFE 边界已移除，`mfe-whiteboard` 不复存在）。`npm install` 会生成第二份依赖树（`package-lock.json`），与 pnpm 的 `allowBuilds` 白名单（`better-sqlite3` 等原生模块需编译）行为不一致，容易在启动时抛原生模块加载错误。
>
> `pnpm-workspace.yaml` 里的 `overrides` 段还固定了若干传递依赖的安全下界（`ws` `>=8.21.0`、`qs` `>=6.16.0`、`engine.io` `>=6.6.10`、`ip-address` `>=10.7.1` 等）。替换按版本范围写，避免把 minimatch 3/5 的 `brace-expansion` 1.x/2.x 或生产打包用的 esbuild 0.25 一并抬走。这些约束只在 pnpm 下生效。CI 的 `security-audit` 对 `https://registry.npmjs.org/` 执行 `pnpm audit --audit-level high`，存在 high 或 critical 时失败；`pnpm lint:strict` 同样是阻断步骤。
>
> `dev.sh` 需有可执行位（`chmod +x dev.sh`）。

---

## 3. 环境变量

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```bash
# .env
PORT=9000
ENCRYPTION_KEY=your-64-char-hex-key
LOG_LEVEL=info
ALLOWED_ORIGINS=http://localhost:5173
```

| 变量                | 必需 | 说明                                                                                                                                                                                                                 |
| ------------------- | :--: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`              |  —   | 服务端口，默认 `9000`                                                                                                                                                                                                |
| `ENCRYPTION_KEY`    |  —   | 64 位 hex，加密 AI Provider API Key 和班级临时口令。未配置时首次启动生成 `storage/encryption-key`（权限 600，与 `bootstrap-credentials.txt` 同目录），重启后仍能解密。建议改为环境变量并离线备份。不要留空字符串占位 |
| `OPENLEARN_DB_PATH` |  —   | SQLite 数据库路径。npx 默认 `~/openlearn-next/data.db`，本地开发默认项目目录                                                                                                                                         |
| `LOG_LEVEL`         |  —   | 日志级别：`debug` / `info` / `warn` / `error`，默认 `info`                                                                                                                                                           |
| `ALLOWED_ORIGINS`   |  —   | CORS 白名单，逗号分隔                                                                                                                                                                                                |

> **提示**：系统完全采用后台动态 AI 提供商管理（OpenAI 兼容 API），系统启动后在「系统管理 -> AI 提供商管理」中配置即可，无需在环境变量中写入 AI 密钥。

---

## 4. 首次登录与账户管理

### 种子账户

空库首次启动会创建两个账号，用户名固定，**口令不再默认等于用户名**：

| 用户名    | 初始口令 | 角色       | 权限范围                               |
| --------- | -------- | ---------- | -------------------------------------- |
| `admin`   | 见下方   | 系统管理员 | 全部功能：用户管理、插件管理、系统配置 |
| `teacher` | 见下方   | 教师       | 课程管理、班级管理、课堂直播、课件分发 |

口令来源（二选一）：

1. 启动前设置 `OPENLEARN_ADMIN_PASSWORD`、`OPENLEARN_TEACHER_PASSWORD`。
2. 留空则随机生成，启动日志打印一次，并写入 `storage/bootstrap-credentials.txt`（权限 600）。登录后请修改密码并删除该文件。

若口令仍与用户名相同（含升级前就在用 `admin` / `admin` 的库），登录会被标记为必须改密：除 `POST /api/auth/change-password`、`POST /api/auth/logout`、`GET /api/auth/session`、`GET /api/auth/me` 外，其余 `/api` 请求（含读请求）返回 403 `FORBIDDEN_DEFAULT_PASSWORD`。页面本身仍可打开。

> 端到端测试才会设置 `PLAYWRIGHT_TEST=1` 以保留 `admin` / `admin`。生产环境不要设置这个变量。

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

| 模块     | 路径            | 说明                             |
| -------- | --------------- | -------------------------------- |
| 课程管理 | 侧边栏 → 课程   | 创建/编辑课程、排课、课件上传    |
| 班级管理 | 侧边栏 → 班级   | 创建班级、添加学生、查看班级数据 |
| 直播课堂 | 课程 → 进入课堂 | 实时白板、互动工具、学生管理     |
| 插件中心 | 侧边栏 → 插件   | 浏览/安装/卸载插件               |
| 用户管理 | 管理面板        | 用户列表、角色分配、权限设置     |
| AI Agent | 右下角浮动按钮  | 自然语言控制教学操作             |

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

| 工具       | 说明                                           |
| ---------- | ---------------------------------------------- |
| 课件管理   | 上传 HTML 课件，自动分发到学生端，实时采集成绩 |
| 选择题测验 | 创建单选题/多选题，实时统计正确率              |
| 随机点名   | 从班级中随机选取学生回答问题                   |
| 思维导图   | 协作编辑思维导图                               |
| 计时器     | 设定倒计时，同步广播至所有学生端               |
| 代码沙箱   | 在线编程练习环境                               |
| 数学图形   | 几何图形绘制与演示                             |

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

参见 [插件开发完全指南](../tutorials/plugin-development-tutorial) 和 [插件脚手架开发指南](../sdk/scaffold-cli)。

---

## 8. AI Agent 使用

### 什么是 AI Agent

AI Agent 是 OpenLearnV2 的智能助手，通过自然语言即可控制教学操作。它基于接入的 OpenAI 兼容大模型（如 DeepSeek、Qwen、OpenAI 等），将自然语言指令转换为系统命令。

### 使用方式

1. 点击右下角的 **AI Agent 浮动按钮**
2. 在弹出的对话框中输入自然语言指令
3. AI Agent 自动解析意图并执行操作

### 指令示例

| 指令类型 | 示例                                       |
| -------- | ------------------------------------------ |
| 课程管理 | 「帮我创建一个名为 Python 入门的课程」     |
| 班级管理 | 「把张三、李四添加到计算机网络班」         |
| 课件操作 | 「上传这份 HTML 课件，标题叫数据结构演示」 |
| 数据查询 | 「计算机网络班的测验平均分是多少」         |
| 课堂操作 | 「开始课堂测验，题目是...」                |

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
pnpm install --frozen-lockfile
pnpm run build

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，确认 ENCRYPTION_KEY 已配置（AI 提供商在后台配置）

# 3. 启动服务
pnpm start
```

### PM2 进程管理

```bash
# 使用 PM2 启动
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status

# 查看日志（应用名是 ecosystem.config.cjs 里的 apps[0].name，即 openlearnv2）
pm2 logs openlearnv2
pm2 logs openlearnv2 --lines 200

# 设置开机自启
pm2 save
pm2 startup
```

> ⚠️ **应用名是 `openlearnv2`，不是 `openlearn`**。`pm2 logs <name>` 的名字来自 `ecosystem.config.cjs` 的 `apps[0].name`，照抄旧文档的 `openlearn` 会得到 `process not found`。
>
> `ecosystem.config.cjs` 顶部用 `dotenv.config()` 从同目录 `.env` 读取 `ENCRYPTION_KEY` 与 `ALLOWED_ORIGINS`——**密钥不入版本库**。把 `ENCRYPTION_KEY` 留成空字符串时，进程不会再生成一把只活在内存里的临时钥匙：它会改用数据目录里的 `storage/encryption-key`（没有就现场生成并写成 0600）。启动日志会警告这是自动生成的密钥。生产环境请在 `.env` 里填上真实的 64 位 hex，并离线备份。若环境变量和该文件不是同一把钥匙，进程会报错退出。

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

> **注意（重要）**：数据在容器内的 `/data`（库、课件、插件、上传）和 `/backups`。不要挂到 `/app/packages/core/db` 或 `/app/storage`，那是旧布局，和当前 `OPENLEARN_DATA_DIR` 对不上。完整步骤、反代和健康检查见 [Docker & Nginx](../deployment/docker-nginx)。
>
> ```bash
> docker compose up -d --build
> # 反代：TRUST_PROXY=1 docker compose --profile proxy up -d --build
> ```

---

## 10. 常见问题

### Q: 启动后无法访问？

- 检查端口是否被占用：`lsof -i :9000`
- 检查防火墙是否放行端口

### Q: AI Agent 功能不可用？

- 确认已配置 AI 服务：在管理后台「AI 提供商管理」中已添加并激活至少一个 AI 提供商
- 检查网络是否能正常访问该提供商的 API 地址与模型名称
- 确认填写的 API Key 是否正确有效

### Q: 插件安装后不显示？

- 确认插件状态为「已启用」
- 检查插件所需的权限是否已授予
- 刷新页面后重试
- 查看服务端日志：`pnpm run dev` 模式下终端可见，PM2 模式用 `pm2 logs openlearnv2`

### Q: 如何备份数据？

OpenLearnV2 使用 SQLite 数据库存储所有数据。数据库路径由 `OPENLEARN_DB_PATH` 环境变量决定（`packages/core/db/index.ts` 读取），未设置时为项目内的默认路径。按部署方式分四种：

| 部署方式       | 数据库路径                                              | 备份方式                                               |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| 本地开发       | `<项目根>/packages/core/db/educational_os.db`           | 停服后 `cp` 该文件                                     |
| PM2 裸机       | 同上（`cwd` = 项目根）                                  | 停服后 `cp` 该文件                                     |
| Docker 容器    | 容器内 `/data/educational_os.db`，课件在同卷 `storage/` | `docker compose exec app node scripts/site-backup.mjs` |
| `npx` 全局安装 | `~/openlearn-next/data.db`                              | 停服后 `cp` 该文件                                     |

```bash
# 本地开发 / PM2 裸机：数据库 + storage/plugins/uploads
node scripts/site-backup.mjs

# Docker（数据在命名卷里）
docker compose exec app node scripts/site-backup.mjs
```

> ⚠️ **别忘了课件目录**。`storage/courseware/` 存着上传的课件。`site-backup.mjs` 会把 `storage/`、`plugins/`、`uploads/` 打进同一个文件包。容器里它们都在 `/data` 卷。
>
> SQLite 在线复制可能拿到不一致快照。脚本用 `VACUUM INTO`。不要直接 `cp` 正在写入的 db 文件。
>
> 恢复须先停服：`node scripts/site-restore.mjs --i-understand-downtime`。详见[系统管理员手册](../administrator-guide/admin-manual) §6.4。

### Q: 如何重置系统？

```bash
# 停止服务后删除数据库文件（本地开发 / PM2 裸机）
rm packages/core/db/educational_os.db

# 重新启动。空库会创建 admin / teacher，口令来自环境变量或 storage/bootstrap-credentials.txt
pnpm run dev
```

> 重置后到启动日志或 `storage/bootstrap-credentials.txt` 取初始口令。若仍配置成与用户名相同，登录后必须改密，期间业务 API 读请求也会被拦截。详见[系统管理员手册](../administrator-guide/admin-manual) §0.2。
>
> Docker 部署要重置得删卷：`docker compose down -v`（⚠️ 这会清掉 `openlearn_data` 与 `openlearn_backups`，务必先备份）。

---

> **相关文档**：[插件开发完全指南](../tutorials/plugin-development-tutorial) · [核心架构与设计](../architecture/platform-kernel) · [插件脚手架开发指南](../sdk/scaffold-cli)
> 最后更新：2026-07-15
