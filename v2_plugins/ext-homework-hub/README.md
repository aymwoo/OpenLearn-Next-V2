# ext-homework-hub — 作业中心

OpenLearn Next V2 教学插件，提供完整的作业发布、收集、批改、统计与导出功能。

## 功能概览

### 教师端（`teacher.dashboard.widget`）
- **发布作业**：设置标题、描述、截止时间
- **查看提交**：按作业查看所有学生的提交记录
- **在线评分**：对提交文件打分（0-100）并给出文字反馈
- **批量下载**：一键下载某次作业的全部提交文件
- **成绩导出**：将提交记录和成绩导出为 Excel 文件（`xlsx` 格式）
- **统计概览**：实时显示已交人数、已批人数、平均分

### 学生端（`student.view`）
- **作业列表**：查看所有已发布的作业及截止时间
- **提交文件**：选择本地文件上传（不限制文件类型）
- **查看反馈**：查看教师给出的评分和反馈

## 目录结构

```
ext-homework-hub/
├── manifest.json          # 插件清单（元数据、权限、贡献点）
├── index.ts               # 后端插件主入口（数据库 + Command Handler）
├── frontend.js            # 前端微前端脚本（教师面板 + 学生面板）
├── package.json           # NPM 依赖声明（xlsx）
└── README.md              # 本文件
```

## 权限声明

| 权限 | 用途 |
|:---|:---|
| `ui:panel` | 注册教师面板和学生面板 |
| `plugin:read` | 数据库读写基础权限 |
| `vfs:write` | 作业文件存储与成绩 Excel 导出 |
| `event:publish` | 发布新作业事件通知 |

## 数据库表

| 表名 | 字段 | 说明 |
|:---|:---|:---|
| `assignments` | id, title, description, deadline, created_at, teacher_id | 作业信息 |
| `submissions` | id, assignment_id, student_id, filename, file_path, submitted_at, score, feedback | 提交记录与评分 |

> 实际物理表名由宿主通过 `ctx.db.table()` 自动添加插件 UUID 前缀进行隔离映射。

## Command 列表

| Command 类型 | 调用方 | 功能 |
|:---|:---|:---|
| `homework.create_assignment` | 教师 | 创建新作业 |
| `homework.list_assignments` | 教师/学生 | 获取作业列表（含提交状态） |
| `homework.submit` | 学生 | 提交作业文件（base64 编码） |
| `homework.list_submissions` | 教师 | 查看某作业的所有提交 |
| `homework.get_download_url` | 教师 | 获取单个文件的下载地址 |
| `homework.batch_download_urls` | 教师 | 批量获取下载地址 |
| `homework.grade` | 教师 | 评分+反馈 |
| `homework.export_scores` | 教师 | 导出成绩单 Excel |
| `homework.get_stats` | 教师 | 获取统计概览 |

## 构建与打包

```bash
# 1. 编译 TypeScript（@openlearn/plugin-sdk 由宿主提供，标记为 external）
npx esbuild index.ts --bundle --format=esm --platform=node --outfile=index.js \
  --external:@openlearn/plugin-sdk

# 2. 打包为 ZIP（注意：package.json 不需要打入 ZIP，宿主会根据清单自动安装依赖）
zip ext-homework-hub.zip manifest.json index.js frontend.js
```

## 配置项

通过管理后台可为插件配置以下参数：

| 配置项 | 类型 | 默认值 | 说明 |
|:---|:---|:---|:---|
| `maxFileSizeMB` | integer | 10 | 单文件上传大小上限（MB） |
| `allowedFileTypes` | string | `*` | 允许的文件类型，`*` 不限，多个用逗号分隔 |

## 版本历史

### v1.0.0
- 初始版本
- 作业发布、文件提交、在线评分、批量下载、Excel 导出
