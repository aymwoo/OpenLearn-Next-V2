# OpenLearnV2 安装与使用指南

> ⚠️ **内容待复核（2026-10-03 审计）**：§2 快速开始与 §3 环境变量基本可用，但部署与包管理器章节有会直接导致故障的错误：
> - §9 PM2 段写 `pm2 logs openlearn`；`ecosystem.config.cjs:11` 的应用名是 **`openlearnv2`**，照抄会报「process not found」。
> - §9 Docker 段建议 `docker run -v ./data:/app/data openlearnv2`；`Dockerfile:49` 把 `OPENLEARN_DB_PATH` 固定为 `/app/packages/core/db/educational_os.db`，`/app/data` **不是**任何数据目录。按本文挂载，容器一重启**全部数据丢失**。必须挂载 `/app/packages/core/db`（另含 `Dockerfile:34` 创建的 `/app/storage`、`/app/backups`）。
> - 包管理器自相矛盾：§1 声明「pnpm 为准」，§2 方式二/三与 §9 手动部署却用 `npm install` / `npm run build` / `npm start`，§10 重置系统又用 `pnpm dev`；仓库是 pnpm workspace（`pnpm-workspace.yaml` + `pnpm-lock.yaml`），混用会生成第二份依赖树。另 §2 方式三的 `./dev.sh` 未在 §1 说明，且 `package.json` 名为 `openlearn-next`。
> - §10 备份/重置的数据库路径只覆盖「本地开发」与「npx 安装」两态，未覆盖 §9 自己推荐的 Docker 部署（此时路径是容器内 `/app/packages/core/db/educational_os.db`），照做会找不到文件。
> 逐条修复前请勿将其作为实现依据。

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

- **Node.js** ≥ 20.x（LTS 推荐，`package.json` 的 `engines` 约束为 `>=20.0.0`）
- **pnpm**（**本仓库是 pnpm workspace**，见 `pnpm-workspace.yaml`；全部命令以 `pnpm` 为准，**不要用 `npm install`**——会生成第二份依赖树）
- **操作系统**：Linux（推荐）、macOS、Windows（WSL2 推荐）

验证安装：

```bash
node --version   # 应输出 v20.0.0 或更高
pnpm --version   # 应输出 8.0.0 或更高
```

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

> ⚠️ **不要用 `npm install`**。本仓库是 pnpm workspace（`pnpm-workspace.yaml` + `pnpm-lock.yaml`），含 4 个子包：`packages/core`、`packages/plugin-sdk`、`packages/plugin-test-kit`、`packages/mfe-whiteboard`。`npm install` 会生成第二份依赖树（`package-lock.json`），与 pnpm 的 `allowBuilds` 白名单（`better-sqlite3` 等原生模块需编译）行为不一致，容易在启动时抛原生模块加载错误。
>
> `pnpm-workspace.yaml` 里的 `overrides` 段还固定了若干传递依赖的安全下界（`ws` `>=8.21.0`、`qs` `>=6.16.0` 等），这些约束只在 pnpm 下生效。
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

| 变量                | 必需 | 说明                                                                                                                                                                                   |
| ------------------- | :--: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`              |  —   | 服务端口，默认 `9000`                                                                                                                                                                  |
| `ENCRYPTION_KEY`    |  —   | 64 位 hex，用于加密 AI Provider API Key。**非必需**：首次用到时若未配置，系统会自动生成并写回 `.env` 持久化（`packages/core/di/api-key-crypto.ts`）；生产环境也可用 `deploy.sh` 预生成 |
| `OPENLEARN_DB_PATH` |  —   | SQLite 数据库路径。npx 默认 `~/openlearn-next/data.db`，本地开发默认项目目录                                                                                                           |
| `LOG_LEVEL`         |  —   | 日志级别：`debug` / `info` / `warn` / `error`，默认 `info`                                                                                                                             |
| `ALLOWED_ORIGINS`   |  —   | CORS 白名单，逗号分隔                                                                                                                                                                  |

> **提示**：系统完全采用后台动态 AI 提供商管理（OpenAI 兼容 API），系统启动后在「系统管理 -> AI 提供商管理」中配置即可，无需在环境变量中写入 AI 密钥。

---

## 4. 首次登录与账户管理

### 默认账户

系统预置两个角色账户，初次使用时可直接登录：

| 用户名    | 密码      | 角色       | 权限范围                               |
| --------- | --------- | ---------- | -------------------------------------- |
| `admin`   | `admin`   | 系统管理员 | 全部功能：用户管理、插件管理、系统配置 |
| `teacher` | `teacher` | 教师       | 课程管理、班级管理、课堂直播、课件分发 |

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
> `ecosystem.config.cjs` 顶部用 `dotenv.config()` 从同目录 `.env` 读取 `ENCRYPTION_KEY` 与 `ALLOWED_ORIGINS`——**密钥不入版本库**。但注意：把 `ENCRYPTION_KEY` 留空字符串会让 `api-key-crypto.ts` 的密钥解析走空值路径，导致 AI Provider 密钥无法解密（源码有明确警告），务必在 `.env` 中填上真实值。

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

> **注意（重要）**：数据目录在容器内的固定位置，挂载 volume 时**必须挂到正确路径**。
>
> | 容器内路径 | 内容 | 丢失后果 |
> | --- | --- | --- |
> | `/app/packages/core/db` | SQLite 主库（`OPENLEARN_DB_PATH` 指向此处） | **全部业务数据丢失** |
> | `/app/storage` | 课件等文件存储 | 课件文件丢失 |
> | `/app/backups` | 数据库备份 | 灾备链路失效 |
> | `/app/logs` | 运行日志 | 排障日志丢失（容器重建即消失） |
>
> ```bash
> # ❌ 错误：/app/data 不是任何数据目录，照此挂载会在容器重建后丢失全部数据
> # docker run -v ./data:/app/data openlearnv2
>
> # ✅ 正确
> docker run -v ./data:/app/packages/core/db \
>            -v ./storage:/app/storage \
>            -v ./backups:/app/backups \
>            -v ./logs:/app/logs \
>            openlearnv2
> ```
>
> 推荐直接用 `docker compose up -d`（见 `docker-compose.yml`，上述四个卷均已声明）。

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

| 部署方式         | 数据库路径                                                | 备份方式                       |
| ---------------- | --------------------------------------------------------- | ------------------------------ |
| 本地开发         | `<项目根>/packages/core/db/educational_os.db`              | 停服后 `cp` 该文件             |
| PM2 裸机         | 同上（`cwd` = 项目根）                                     | 停服后 `cp` 该文件             |
| Docker 容器      | 容器内 `/app/packages/core/db/educational_os.db`            | 从命名卷导出，见下             |
| `npx` 全局安装   | `~/openlearn-next/data.db`                                 | 停服后 `cp` 该文件             |

```bash
# 本地开发 / PM2 裸机
cp packages/core/db/educational_os.db educational_os.db.backup.$(date +%Y%m%d)

# Docker（数据库在命名卷里，宿主机上找不到该文件）
docker compose stop app
docker run --rm -v openlearn_db:/data -v "$PWD":/backup alpine \
  tar czf /backup/educational_os-$(date +%F).db.tar.gz -C /data .
docker compose start app
```

> ⚠️ **别忘了课件目录**。`storage/courseware/` 存着所有上传的课件 HTML/ZIP，漏备份会导致课件 404 但数据库记录仍在。容器部署的对应卷是 `/app/storage`。
>
> SQLite 在线复制可能拿到不一致快照。**要么停服再 `cp`，要么用 `VACUUM INTO` 生成一致性副本**，不要直接复制正在写入的 db 文件。
>
> 恢复用 `scripts/restore-db.ts`（按 `BACKUP_DIR` 枚举备份），详见[系统管理员手册](../administrator-guide/admin-manual) §6.4。

### Q: 如何重置系统？

```bash
# 停止服务后删除数据库文件（本地开发 / PM2 裸机）
rm packages/core/db/educational_os.db

# 重新启动，系统会自动创建新数据库并预置默认账户（admin/admin、teacher/teacher）
pnpm run dev
```

> ⚠️ **重置后必须改种子账号密码**：`admin/admin` 与 `teacher/teacher` 会被重新种入且带 `mustChangePassword` 强制改密标记。详见[系统管理员手册](../administrator-guide/admin-manual) §0.2。
>
> Docker 部署要重置得删卷：`docker compose down -v`（⚠️ 这会**同时清掉** db / storage / backups / logs 四个卷，务必先备份）。

---

> **相关文档**：[插件开发完全指南](../tutorials/plugin-development-tutorial) · [核心架构与设计](../architecture/platform-kernel) · [插件脚手架开发指南](../sdk/scaffold-cli)
> 最后更新：2026-07-15
