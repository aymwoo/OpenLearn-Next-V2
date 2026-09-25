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

系统采用后台动态配置 AI 提供商机制。启动服务后，使用管理员登录并在「系统管理 -> AI 提供商管理」中添加 OpenAI 兼容的大模型服务即可。

```ini
PORT=9000
```

### 步骤 3：启动开发服务器

```bash
pnpm dev
```

终端输出如下即表示服务启动成功（版本号运行期从 `package.json` 读取）：

```
  OpenLearn Next vX.Y.Z ready:

  ➜  Local:   http://localhost:9000
  ➜  Network: http://192.168.x.x:9000
```

访问 `http://localhost:9000` 即可进入系统控制台。默认内置初始账户：

- 管理员：`admin` / `admin`
- 教师：`teacher` / `teacher`
