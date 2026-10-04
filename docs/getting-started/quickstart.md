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

> **需要演示数据？** 用 `pnpm dev:demo` —— 它会在 `storage/demo.db`（一次性库，
> **不影响你的开发库**）里自动铺好演示课程、2 个班级、12 名学生、1 个演示教师账号
> 和 1 条课表，然后启动服务。详见下方「演示数据模式」。

终端输出如下即表示服务启动成功（版本号运行期从 `package.json` 读取）：

```
  OpenLearn Next vX.Y.Z ready:

  ➜  Local:   http://localhost:9000
  ➜  Network: http://192.168.x.x:9000
```

访问 `http://localhost:9000` 即可进入系统控制台。默认内置初始账户：

- 管理员：`admin` / `admin`
- 教师：`teacher` / `teacher`

---

## 演示数据模式（`pnpm dev:demo`）

调试、演示、录屏或做前端联调时，需要一份「开箱即用」的教学数据：

```bash
pnpm dev:demo
```

它会：

1. 在 `storage/demo.db`（**一次性库，与你的开发库完全隔离**）上跑迁移；
2. 播种演示数据 —— 1 门课程、2 个班级、12 名学生、1 条课表；
3. 创建演示教师账号并打印凭据；
4. 复用 `startServer()` 启动服务。

终端会直接给出登录信息：

```
[dev:demo] 已播种演示数据：29 条 (课程 1 / 班级 2 / 学生 12 / 课表 1)
[dev:demo] 演示教师账号：
[dev:demo]   用户名 demo_teacher   密码 Demo@2026
[dev:demo]   演示课程 demo-lesson   演示班级 demo-class
```

### 常用变体

| 需求 | 命令 |
| --- | --- |
| 强制重建演示库（丢弃旧数据重来） | `pnpm dev:demo -- --reset` |
| 叠加自定义端口 | `PORT=3999 pnpm dev:demo` |
| 只想重建数据、不起服务 | 打开「系统设置 → 演示数据」点一键初始化/清理 |

### 与 `pnpm dev` 的区别

`pnpm dev` = `tsx server.ts`，**绕过 `cli.mjs` 的参数解析层**，所以
`--port` / `--demo` / `--db-path` 这类 CLI 选项在 dev 下无效 —— 要用环境变量
（`PORT=3999 pnpm dev`）。`pnpm dev:demo` 补上了这个缺口。

### 清理

`storage/demo.db` 已被 `.gitignore` 忽略。直接删文件即可：

```bash
rm -f storage/demo.db*        # 或用 pnpm dev:demo -- --reset
```

> 演示数据本身也可以在**系统设置 → 演示数据**里「一键清理」。该清理是**精确作用域**的：
> 只删除播种时登记在 `demo_data_registry` 表里的行，不碰系统其它数据，管理员账号不受影响。
> 详见 [演示数据一键初始化与清理](../administrator-guide/demo-data.md)。
