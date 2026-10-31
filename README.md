# OpenLearnV2 — Educational OS

> 插件驱动的下一代在线教育操作系统（LMS），融合微内核架构、三档沙箱隔离插件生态、零信任课件容器与原生 AI 伴随教学。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](package.json)
[![Node: 20.x / 22.x / 24.x](https://img.shields.io/badge/Node-20.x%20%2F%2022.x%20%2F%2024.x-green.svg)](package.json)
[![pnpm: 10.x](https://img.shields.io/badge/pnpm-10.33.4-orange.svg)](package.json)
[![CI](https://github.com/aymwoo/OpenLearn-Next-V2/actions/workflows/ci.yml/badge.svg)](https://github.com/aymwoo/OpenLearn-Next-V2/actions/workflows/ci.yml)

📚 **官方文档**：[在线文档库 (ReadTheDocs)](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/) · [快速上手](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/getting-started/quickstart.html) · [插件开发教程](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/tutorials/plugin-development-tutorial.html) · [部署运维手册](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/deployment/production-guide.html)

---

## 🌟 核心特性

- 🧩 **微内核与事件驱动底座 (Educational OS Microkernel)**
  - 基于 CQRS `CommandBus`、强类型 DI 依赖注入与 SQLite 关系型存储（WAL 高并发模式）。
  - 内核级 `EventBus` 支持精准事件订阅与审计追溯，搭载 Schema Golden 结构守卫，杜绝数据库版本漂移。

- 🛡️ **三档隔离插件生态 (Extensible Plugin Architecture)**
  - 支持 **Inline 原生模式**、**Worker 线程** 与 **独立子进程 (Process)** 三档隔离沙箱，具备崩溃看门狗自动重启与熔断保护。
  - 支持 ESM ZIP 热插拔分发、独立 REST API 命名空间路由隔离、出网权限白名单（Net Grants）与精细化资源配额。
  - 声明式 UI 扩展槽位：画板图元、管理端侧栏、教学工具箱、课件类型等均可由插件任意扩展。

- 📦 **零信任课件容器与透明 Bridge SDK**
  - HTML5 / 网页应用课件运行于极严沙箱容器（无 `allow-same-origin`），彻底阻断越权窥探。
  - 独创 **Bridge SDK** 跨域通讯代理，内置 `ResultWatcher` 自动感知通关与结算信号，无需课件改造即可自动回写成绩。

- 📡 **课堂实时协同与低干扰多维遥测**
  - **实时在线与专注度感知**：毫秒级捕获学生离屏、切台与活跃状态，呈现全班专注度热力图。
  - **低干扰健康遥测**：学生端极简角标异常上报（不中断正常教学），故障秒级推向教师端并持久化审计。
  - **多端实时互动白板**：基于 Konva 的高帧率协同画板，支持区域对象锁、随堂测验卡片投送与生生互评。

- 🤖 **原生 AI 伴随教学引擎**
  - 兼容 OpenAI 开放标准（DeepSeek、Qwen、Ollama、OpenAI 等任意兼容提供商），密钥多重加密落盘。
  - 深度赋能备课与授课：一键生成结构化互动教案、随堂出题与测评建议、学情智能诊断与个性化干预。

- 🧰 **开箱即用与生产级可靠运维**
  - 内置命令行诊断看护：`npx openlearn-next doctor --fix` 一键健康体检、依赖自愈与在线冷备/快照还原。
  - 严格的主机安全基线：密码强制安全初始化、CSP 防注入、LTI 1.3 标准对接兼容。

---

## 🚀 快速开始

### 方式 A：一键试用（无需克隆代码）

```bash
# 启动最新发布版体验
npx openlearn-next@latest

# 自定义端口 / 启动后自动唤起浏览器 (-o) / 演示模式 (--demo)
npx openlearn-next@latest -p 3000 -o
npx openlearn-next@latest --demo -o

# 运维诊断自愈与在线冷备
npx openlearn-next@latest doctor --fix
npx openlearn-next@latest backup
```

### 方式 B：全局安装运行

```bash
npm install -g openlearn-next   # 安装
openlearn-next                  # 启动
npm update -g openlearn-next    # 更新
```

### 方式 C：源码本地开发

```bash
# 1. 克隆仓库并安装依赖（建议 Node 22 + pnpm）
git clone https://github.com/aymwoo/OpenLearn-Next-V2.git
cd openlearnv2
pnpm install

# 2. 启动开发服务器（支持 Vite HMR，默认端口 9000）
pnpm dev

# 3. 浏览器打开
open http://localhost:9000
```

> 🔐 **初始凭据说明**：
> 平台内置种子管理员账号 `admin` 与教师账号 `teacher`。首次启动若未预设环境变量口令，**初始口令就是用户名本身**（`admin` / `admin`、`teacher` / `teacher`）——装完即可登录，不需要去翻日志或 `storage/bootstrap-credentials.txt`。登录后系统会强制引导修改密码，改密前除「改密 / 登出」外的接口一律返回 403。
>
> 想换初始口令：设置 `OPENLEARN_ADMIN_PASSWORD` / `OPENLEARN_TEACHER_PASSWORD`。想恢复旧版「随机口令 + 写入 `storage/bootstrap-credentials.txt`」行为：设置 `OPENLEARN_SEED_PASSWORD_MODE=random`（只在首次建库时生效）。

---

## 🛠️ 常用命令

| 命令               | 说明                                              |
| :----------------- | :------------------------------------------------ |
| `pnpm dev`         | 启动开发服务（Express + Vite 前端热更新）         |
| `pnpm build`       | 全量生产构建（Vite 构建 ➔ 插件打包 ➔ 服务端打包） |
| `pnpm start`       | 运行生产打包产物（`dist/server.cjs`）             |
| `pnpm test`        | 执行 Vitest 自动化单元与集成测试套件              |
| `pnpm lint`        | TypeScript 静态类型检查（`tsc --noEmit`）         |
| `pnpm lint:strict` | 严格模式类型检查                                  |
| `pnpm format`      | Prettier 代码自动格式化                           |

---

## 🚢 生产部署

推荐通过项目自带的自动化部署脚本完成生产部署：

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本将自动执行：环境依赖预检 ➔ 生产构建 ➔ Nginx 反向代理配置 ➔ PM2 进程守护与加密密钥初始化。  
更多部署方式（Docker Compose、多实例集群与环境变量全集）请查阅 [生产部署指南](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/deployment/production-guide.html) 与 [系统配置手册](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/configuration/system-configuration.html)。

---

## 📖 更多文档

- 📚 [完整官方文档库](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/)
- ⚙️ [系统环境变量配置规范](docs/configuration/system-configuration.md)
- 🔌 [插件系统与 SDK 规范](docs/tutorials/plugin-development-tutorial.md)
- 🤝 [贡献指南与开发规范 (AGENTS.md)](AGENTS.md)
- 📝 [版本更新日志 (CHANGELOG.md)](CHANGELOG.md)

---

## 📄 开源许可证

本项目基于 [MIT License](package.json) 开源发布。
