# 快速入门 (Quickstart)

本指南帮助您在 5 分钟内快速搭建并运行 OpenLearn V2 平台。

---

## 5 分钟快速启动

### 步骤 1：克隆仓库与安装依赖

```bash
git clone https://github.com/aymwoo/OpenLearn-Next-V2.git
cd OpenLearn-Next-V2
pnpm install
```

### 步骤 2：配置环境变量

复制配置文件样例：

```bash
cp .env.example .env
```

填入 Gemni API Key（用于开启 AI 助教功能）：

```ini
GEMINI_API_KEY=your_gemini_api_key_here
PORT=9000
```

### 步骤 3：启动开发服务器

```bash
pnpm dev
```

终端输出如下即表示服务启动成功：

```
OpenLearn V2 Platform Server listening on port 9000
[Bootstrap Pipeline] Stage completed: ReadyStage
```

访问 `http://localhost:9000` 即可进入系统控制台。默认内置初始账户：
- 管理员：`admin` / `admin`
- 教师：`teacher` / `teacher`
