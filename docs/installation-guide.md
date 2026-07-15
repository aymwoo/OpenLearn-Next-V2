# OpenLearnV2 安装与使用指南

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

参见 [插件开发完全指南](plugin-development-tutorial) 和 [插件脚手架开发指南](scaffold)。

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

> **相关文档**：[插件开发完全指南](plugin-development-tutorial) · [核心架构与设计](architecture_review_report) · [插件脚手架开发指南](scaffold)
> 最后更新：2026-07-15
