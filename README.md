# OpenLearnV2 — Educational OS

插件驱动的在线教学平台（LMS），支持 AI Agent 辅助教学。

> 📚 **完整文档**：[openlearn-next-v2.readthedocs.io](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/) · [快速开始](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/getting-started/quickstart.html) · [安装指南](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/getting-started/installation-guide.html) · [插件开发教程](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/tutorials/plugin-development-tutorial.html) · [版本迁移](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/migration/version-migration.html)

---

## 快速开始

### 一键运行（无需 clone 项目）

```bash
# 通过 npx 直接启动（首次自动下载）
npx openlearn-next

# 自定义端口 / 数据库路径
npx openlearn-next -p 3000
OPENLEARN_DB_PATH=./my.db npx openlearn-next
```

### 全局安装

```bash
npm install -g openlearn-next   # 安装
openlearn-next                  # 启动
npm update -g openlearn-next    # 更新
```

默认账号：`admin` / `admin`（管理员）、`teacher` / `teacher`（教师）。

### 本地开发

```bash
npm install
# AI 功能可在管理后台「AI Provider 管理」配置；或设置 GEMINI_API_KEY 作为回退
./dev.sh
open http://localhost:9000
```

## 生产部署

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本自动完成：构建 → 生成 Nginx 配置 → 配置 PM2 → 生成加密密钥。
访问 `http://服务器IP` 或经 Nginx 反向代理。
详见 [部署指南](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/deployment/production-guide.html)。

## npm 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务（端口 9000） |
| `npm run build` | 生产构建（Vite + esbuild） |
| `npm start` | 运行生产构建 |
| `npm test` | 运行测试 |
| `npm run lint` | TypeScript 类型检查 |

## 环境变量

| 变量 | 必需 | 说明 |
|------|:--:|------|
| `ENCRYPTION_KEY` | ✅ | 64 位 hex，AI Provider API Key 加密密钥（`deploy.sh` 自动生成） |
| `PORT` | — | 服务端口，默认 9000 |
| `OPENLEARN_DB_PATH` | — | SQLite 数据库路径（npx 默认 `~/openlearn-next/data.db`，本地开发默认项目目录） |
| `GEMINI_API_KEY` | — | 可选。AI 服务回退密钥；推荐在管理面板「AI Provider 管理」配置 |
| `ALLOWED_ORIGINS` | — | CORS 白名单，逗号分隔 |
| `LOG_LEVEL` | — | 日志级别（debug / info / warn / error），默认 info |

## 文档链接

| 主题 | 链接 |
|------|------|
| 📖 文档中心 | <https://openlearn-next-v2.readthedocs.io/zh-cn/latest/> |
| 🚀 快速开始 | <https://openlearn-next-v2.readthedocs.io/zh-cn/latest/getting-started/quickstart.html> |
| 🎓 插件开发 | <https://openlearn-next-v2.readthedocs.io/zh-cn/latest/tutorials/plugin-development-tutorial.html> |
| 🛠 插件开发参考 | <https://openlearn-next-v2.readthedocs.io/zh-cn/latest/reference/plugin-database-api.html> |
| 🔄 版本迁移 | <https://openlearn-next-v2.readthedocs.io/zh-cn/latest/migration/version-migration.html> |
