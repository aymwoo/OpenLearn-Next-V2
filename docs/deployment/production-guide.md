# 生产环境部署与运维指南 (Production Deployment & Operations)

本指南针对高校、培训机构及中小学机房的教学现场，提供 **OpenLearn V2**（`openlearn-next`）在生产环境下的标准化部署、守护进程配置、数据容灾备份与应急运维最佳实践。

---

## 1. 运行环境要求

- **操作系统**: Linux (Ubuntu 20.04 LTS / Debian 11+ / Rocky Linux 8+ 推荐) / macOS / Windows Server
- **Node.js 运行时**: `>= 20.0.0` LTS（推荐 Node.js 22 LTS）
- **内存与 CPU**: 最低 2 核 2GB RAM，推荐 4 核 8GB RAM（大并发课件与白板同步）
- **存储权限**: 对数据库持久化目录（默认 `~/openlearn-next/`）具备读写操作权限

---

## 2. 生产环境部署方式

### 方式一：NPX / 全局安装轻量化部署 (推荐现场快速交付)

适用于单台服务器或局域网主机直接交付教学系统：

```bash
# 全局安装最新版本
npm install -g openlearn-next

# 启动环境健康自检
openlearn-next doctor

# 生产环境后台守护运行（结合 PM2）
pm2 start openlearn-next --name "openlearn-core" -- -p 9000 -H 0.0.0.0
```

### 方式二：源码构建与 Systemd 守护

适用于有二次定制或插件扩展需求的企业及自建服务器：

```bash
# 1. 克隆源码与拉取依赖
git clone https://github.com/aymwoo/OpenLearn-Next-V2.git /opt/openlearn
cd /opt/openlearn
pnpm install --frozen-lockfile

# 2. 全量生产制品构建 (Vite + 插件 + esbuild 后端 Bundle)
pnpm build

# 3. 验证构建产物
ls -lh dist/server.cjs dist/index.html

# 4. 配置 Systemd 守护单元 (/etc/systemd/system/openlearn.service)
```

Systemd 配置示范：

```ini
[Unit]
Description=OpenLearn V2 Educational OS Server
After=network.target

[Service]
Type=simple
User=openlearn
WorkingDirectory=/opt/openlearn
Environment=NODE_ENV=production
Environment=PORT=9000
Environment=HOST=0.0.0.0
Environment=OPENLEARN_DB_PATH=/var/lib/openlearn/data.db
ExecStart=/usr/bin/node /opt/openlearn/dist/server.cjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openlearn
```

---

## 3. 生产运维与容灾保障 (CLI Toolchain)

OpenLearn 内置了免启动服务、免 Web 界面的完整命令行数据运维能力。

### 3.1 环境健康诊断与防版本漂移 (`doctor`)
在首次部署、平台升级或系统排错时，使用自检工具快速排查潜在问题：
```bash
npx openlearn-next doctor
```
自检覆盖全方位运行状态：
- **基础设施**：Node.js 运行时版本（>=20）、CPU 与内存余量、数据库目录写权限、目标服务端口探活与局域网接入点探测；
- **SDK Suite 综合检测**：同步校验 `@openlearn/plugin-sdk` 与 `@openlearn/plugin-test-kit` 的解析版本与依赖形态（workspace 链接 / 精确 pin / caret 范围）；
- **核心版本防漂移**：校验宿主内核单一真理源与 `package.json` 的版本强一致性；
- **插件生态平台兼容性**：
  - **内置核心插件 (`Core Plugins`)**：校验 7 个系统核心插件的 `engines.openlearn` 是否被当前平台版本满足；
  - **已安装扩展插件 (`Installed Plugins`)**：扫描数据库与本地插件，使用轻量级 SemVer 判定引擎校验扩展插件与平台版本的兼容性；
- **一键自愈 (`doctor --fix`)**：
  ```bash
  npx openlearn-next doctor --fix
  ```
  自动清理 NPX 历史旧版本缓存、自动创建数据存储目录，消除运行期版本漂移与目录缺失隐患。

### 3.2 在线数据冷备 (`backup`)
系统依托 SQLite WAL 预写日志机制，可在**业务不中断、数据库读写零阻塞**的情况下毫秒级生成一致性快照：
```bash
# 生成自动带时间戳的备份文件 (如 openlearn_backup_20260906_120000.db)
npx openlearn-next backup

# 指定目标导出路径
npx openlearn-next backup /backup/openlearn_daily.db
```

> **建议**：通过 Crontab 配置每日凌晨定时冷备：
> ```bash
> 0 3 * * * npx openlearn-next backup /backup/openlearn_$(date +\%Y\%m\%d).db > /dev/null 2>&1
> ```

### 3.3 数据安全回滚与还原 (`restore`)
当遭遇误操作、数据损坏或灾备演练时，通过还原命令一键切换主库：
```bash
npx openlearn-next restore /backup/openlearn_daily.db
```
- **Magic Header 校验**：还原前自动校验文件头是否以 `SQLite format 3\0` 开头，杜绝坏文件注入；
- **自动生成回滚镜像**：覆盖前系统自动为现有数据库生成 `.bak_<timestamp>` 副本，确保二次容错安全；
- **日志清理**：自动清理旧库的 WAL 与 SHM 预写日志。

### 3.4 管理员密码应急重置 (`reset-admin`)
若管理人员遗忘密码或系统受锁，无需启动 Web 界面，直接在宿主机重置：
```bash
# 默认重置密码为 admin
npx openlearn-next reset-admin

# 指定高强度自定义密码
npx openlearn-next reset-admin --password 'YourStrongPasswd#2026'
```

### 3.5 远端包与运行缓存清理 (`clean`)
针对 NPX 历史旧版本缓存或本地调试日志堆积：
```bash
# 仅清理 ~/.npm/_npx 中的远端包缓存
npx openlearn-next clean --npx

# 清理日志与临时缓存（严格保护主业务数据库 data.db 不被误删）
npx openlearn-next clean
```
