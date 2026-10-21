# 课程导入流程审计报告

> 审计对象：OpenLearn Next v2「批量导入课程」链路（CSV）与新增的「课程包（Course Package）」链路。
> 审计日期：2026-10-21　　审计范围：前端导入 UI → HTTP API → 内核命令 → SQLite 落库 → 课件附件。

---

## 0. 结论摘要

现有「批量导入课程」是一条**结构不完整且不可回滚**的通道：它只搬运 `title` 与 `content` 两个字段，
落库后得到的是一节**空课** —— 没有教学环节、没有白板组件、没有课件附件；而且逐条独立提交，
中途失败会留下半截数据且没有任何回滚。

本次在保留 CSV 通道的同时，补齐了第二条通道：**课程包（Course Package）**——一个自包含的 JSON 格式，
把「教学环节 + 白板元素 + 课件附件」作为一个整体导入，单事务写入，失败整体回滚。

| 维度                           | CSV 批量导入（原有）    | 课程包导入（新增）          |
| ------------------------------ | ----------------------- | --------------------------- |
| 课程正文                       | ✅                      | ✅                          |
| 教学环节 `lessons.timeline`    | ❌ 恒为 NULL            | ✅                          |
| 白板元素 `whiteboard_elements` | ❌ 0 条                 | ✅ 全部预设组件             |
| 课件附件（PDF / PPTX）         | ❌ 无载体               | ✅ base64 内联 + 导入时落盘 |
| 原子性                         | ❌ 逐条提交，无回滚     | ✅ 单事务                   |
| 失败可见性                     | ❌ 仅 `console.warn`    | ✅ 结构化错误回显           |
| 幂等性                         | ❌ 重复导入产生重复课程 | ❌ 同左（见 G-06）          |

---

## 1. 现有链路全貌

```
课程库工具栏「批量导入课程 (CSV)」按钮
  src/features/teacher/CourseManagement.tsx:124
        │
        ▼
导入弹窗（拖放 / 选择文件）
  src/features/modals/ImportLessonsModal.tsx
        │ handleCSVFileChange
        ▼
useResourceLibrary.handleCSVFileChange
  src/hooks/useResourceLibrary.ts:87
        │ parseLessonCSV(file)
        ▼
CSV 解析 → { title, content }[]
  src/services/bulkImportService.ts:445
        │ submitCSVLessons()  ← 逐条循环，N 次独立请求
        ▼
POST /api/lessons  （N 次）
  server/routes/lessons.ts:358
        │ lessonService.createLesson()
        ▼
内核命令 lesson.create
  packages/plugins/builtin.ts:98
        │
        ▼
INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at)
  packages/plugins/builtin.ts:125   ← 到此为止
```

**关键事实**：这条链路的终点是一次 `INSERT INTO lessons`，只写 6 列。`lessons.timeline`、
`whiteboard_elements` 两张表**完全不在链路里**；课件附件更没有承载结构。

---

## 2. 审计发现

### G-01（高）导入的课程没有教学环节

`lesson.create` 的 INSERT 语句不含 `timeline` 列（`packages/plugins/builtin.ts:125`），
该列保持 NULL。而教学环节是课程的主干：

- 白板元素按 `data.segmentId` 归属环节，进入某环节时只渲染该环节的元素
  （`src/features/whiteboard/utils/pagination-utils.ts:60`）；
- 环节还承载 `gates`（进入条件），`progress_mode` 已被废弃并说明「进入条件请写在
  lessons.timeline 每个环节的 gates 上」（`server/services/lesson-service.ts:234`）。

**后果**：导入后的课程在课堂模式下**一个元素都看不到**，教师必须手工重建全部环节。

### G-02（高）导入的课程没有任何白板元素

CSV 只承载 `title` / `content` 两列，而平台定义的 8 个预设组件
（`src/features/teacher/lesson-editor/paletteConfig.ts:156` 起）全部以 `whiteboard_elements` 行存在：

| type           | 组件         | 定义位置               |
| -------------- | ------------ | ---------------------- |
| `presentation` | 课件演示     | `paletteConfig.ts:158` |
| `code-sandbox` | 代码沙箱     | `paletteConfig.ts:178` |
| `math-graph`   | 数学函数     | `paletteConfig.ts:198` |
| `html-applet`  | 交互网页课件 | `paletteConfig.ts:218` |
| `quiz`         | 随堂测试     | `paletteConfig.ts:264` |
| `assignment`   | 作业提交     | `paletteConfig.ts:290` |
| `rollcall`     | 随机点名     | `paletteConfig.ts:317` |
| `hello-world`  | 问候插件     | `paletteConfig.ts:329` |

此外还有 3 个基础画布图元（`text` / `rectangle` / `circle`）。
内核侧的白名单 `KNOWN_ELEMENT_TYPES`（`packages/plugins/builtin.ts:513`）共 16 种。

**后果**：导入链路对**全部 11 类白板内容零覆盖**。

### G-03（高）课件附件没有可搬运的承载结构

「课件演示」组件支持三种数据源（`src/features/whiteboard/widgets/RevealPresentationWrapper.tsx`）：

1. 内联 Markdown 幻灯片（`data.markdown`）—— 纯数据，随元素一起存即可；
2. 上传的 PDF（`data.fileUrl` + `data.fileType: 'pdf'`）；
3. 上传的 PPTX（`data.fileUrl` + `data.fileType: 'pptx'`）。

后两种的 `fileUrl` 由 `POST /api/upload`（`server/routes/os.ts:26`）返回，形如
`/uploads/1758...-a1b2c3d4.pptx` —— 指向**导入方本机** `uploads` 目录的相对路径
（`server/utils/paths.ts:24`）。这个路径**无法随课程数据搬运**：换一台机器，
组件就会去请求一个不存在的文件而 404。

**后果**：即使把 `whiteboard_elements` 导出来，也无法还原 PDF / PPTX 课件。

### G-04（高）导入不是原子的，失败没有回滚，也没有逐条错误

`submitCSVLessons`（`src/services/bulkImportService.ts:510`）对每一行发一次独立的
`POST /api/lessons`，每个请求各自提交自己的事务。第 7 行失败时，前 6 行**已经落库且无法撤销**。

更糟的是失败被静默吞掉：

```ts
// src/services/bulkImportService.ts:537 / 540
console.warn(`Failed to import item ${i + 1}:`, errData);
console.warn(`Error importing item ${i + 1}:`, err);
```

前端只在**全部失败**时返回错误（`succeeded > 0` 即视为成功），教师看不到哪几行没导进去。
这与平台自己的事务约定相悖 —— `POST /api/classes/import`（`server/routes/admin.ts:108`，
内含 `db.transaction`，见 `admin.ts:130`）已经做到了「整批要么全成、要么全回滚」，
并由 `server/__tests__/transactions.test.ts` 以 DATA-INT-01 锁定。

### G-05（中）CSV 解析比同文件内的加固版实现更弱

同一个文件里存在两套 CSV 解析：

- `splitCsvLine`（`bulkImportService.ts:15`）—— 逐字符状态机，正确处理引号转义；
- `parseLessonCSV`（`bulkImportService.ts:445`）—— 用正则 `line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)`
  拆行（`bulkImportService.ts:481`），表头用 `lines[0].split(',')` 拆（`bulkImportService.ts:462`）。

后者的具体问题：

- 引号字段内含逗号（「数学, 较弱」）会被拆成两列；
- **无法处理字段内换行** —— 而 Markdown 教学大纲几乎必然是多行的，这类内容会被截断；
- 表头用朴素 `split(',')`，遇到带引号或含 BOM 的表头会错位；
- 表头匹配用 `h.includes('title') || h.includes('标题') || h.includes('课程')` 的 `findIndex`，
  「课程简介」与「课程标题」并存时会命中错误列。

### G-06（中）没有幂等性，重复导入产生重复课程

链路里没有任何去重键（标题、内容摘要或包内唯一 id）。同一份 CSV 导入两次会得到两节同名课程，
并各自带一套白板元素 —— 清理成本随重复次数线性上升。

### G-07（中）导入预览态实际不可达（UI 断链）

`handleCSVFileChange` 在解析成功后把状态重置为 `'idle'`（**修复前的代码**，本次已改，见 3.6）：

```ts
// src/hooks/useResourceLibrary.ts:87
setImportStatus('parsing');
...
setPreviewImportData(parsedList);
setImportStatus('idle');   // ← 预览态被立刻清掉
```

而弹窗的预览表格与「开始导入」按钮都以 `importStatus === 'parsing'` 为条件
（`src/features/modals/ImportLessonsModal.tsx`）。因此**教师选完 CSV 后看不到预览，
也拿不到「开始导入」按钮** —— 整条 CSV 导入在 UI 层是断的。

### G-08（低）导入中的进度文案描述了一个不存在的事务

导入中的日志面板硬编码输出 `[API] POST /api/lessons -> Request batch transaction...`，
但实际既没有批量接口也没有跨行事务（见 G-04）。文案与真实行为不符。

---

## 3. 本次整改：课程包（Course Package）

### 3.1 格式

一个自包含的 JSON 文档（`server/services/course-package.ts`）：

```jsonc
{
  "format": "openlearn.course-package",
  "version": 1,
  "meta": { "name": "...", "description": "...", "author": "...", "tags": [] },
  "lesson": {
    "title": "...",
    "content": "# Markdown 教学大纲",
    "progressMode": "manual",
    "timeline": [{ "id": "seg-1", "title": "...", "type": "lecture", "duration": "20m", "gates": [] }],
  },
  "assets": [{ "id": "asset-deck", "filename": "deck.pptx", "contentType": "pptx", "base64": "..." }],
  "elements": [
    {
      "type": "presentation",
      "segmentId": "seg-1",
      "page": 0,
      "x": 40,
      "y": 150,
      "data": { "fileUrl": "${asset:asset-deck}", "fileType": "pptx" },
    },
  ],
}
```

附件用 `${asset:<id>}` 占位符表达 —— 这正是 G-03 的解法：**模板里存的是文件内容，
不是某台机器上的路径**。导入时占位符被替换成导入方实例上真实落盘后的 `/uploads/xxx` URL。

### 3.2 落库语义

`server/services/course-package-import.ts` 在**同一个 SQLite 事务**里写三处：

1. `lessons`（含 `timeline`）
2. `whiteboard_elements`（全部预设组件 + 基础图元 + `page_meta`）
3. 课件附件落盘到 `uploads/` 目录并回填 `fileUrl`

任一步失败 → 事务回滚，且已落盘的附件文件被显式删除（文件系统不参与 SQLite 事务，
需要补偿清理），不留孤儿文件。

### 3.3 接口

| 方法   | 路径                            | 说明                                 |
| ------ | ------------------------------- | ------------------------------------ |
| `GET`  | `/api/course-packages/template` | 下载内置课程模板（JSON，自包含附件） |
| `POST` | `/api/course-packages/import`   | 导入一个课程包（单事务写入）         |

鉴权：教师 / 管理员（与 `POST /api/lessons` 一致）。

### 3.4 内置模板覆盖内容

`server/services/course-package.ts` 的 `buildTemplateCoursePackage()` 生成「OpenLearn 预设组件全览 · 测试样例课」：

- **5 个教学环节**：准备 / 讲授 / 练习 / 测验 / 总结（对齐 `timelineConfig.ts` 的 `SEGMENT_TYPES`），
  其中测验与总结环节带 `gates`；
- **2 个白板页**（`page_meta` 元素驱动）；
- **全部 8 个预设组件 + 3 个基础图元**，且每个元素都挂到具体环节上（验证环节隔离）；
- **2 份真实附件**：3 页 PDF 讲义 + 2 页 PPTX 课件，覆盖「课件演示」组件的三种数据源
  （Markdown / PDF / PPTX）。

附件由代码现场生成（`server/services/course-package-assets.ts`）：

- PDF 用 jsPDF 生成（**纯 ASCII 正文** —— jsPDF 内置的 Helvetica 是 WinAnsi 编码的 base-14 字体，
  写中文会乱码；要正确渲染中文必须内嵌 CJK 字体，体积上百 KB 且依赖宿主机字体路径，
  不适合作为人人可复现的模板资产）；
- PPTX 用 JSZip 现场拼出最小可用的 OOXML 包（presentation / slideMaster / slideLayout / theme / 2 张 slide）。
  PPTX 不内嵌字体，中文由前端渲染器按系统字体显示，因此文案是中文。

### 3.5 前端接入

- 课程库工具栏新增「下载课程模板」按钮（`src/features/teacher/CourseManagement.tsx`）；
- 导入弹窗的拖放区同时接受 `.csv` 与 `.json`（`src/features/modals/ImportLessonsModal.tsx`）；
- 选中课程包时，弹窗切换为**课程包预览**（环节数 / 元素数 / 附件数 / 覆盖的组件类型），
  确认后走单事务导入。

### 3.6 顺带修复

G-07（预览态不可达）在本次一并修复：解析成功后不再把状态重置为 `'idle'`。

---

## 4. 仍未解决的问题（建议后续处理）

| 编号 | 问题                     | 建议                                                                       |
| ---- | ------------------------ | -------------------------------------------------------------------------- |
| G-06 | 无幂等性                 | 给课程包引入 `meta.id` 作为去重键，导入时提示「已存在同名课程」            |
| G-05 | CSV 解析弱               | `parseLessonCSV` 改用同文件内的 `splitCsvLine`，并支持多行引号字段         |
| G-08 | 进度文案虚构事务         | 已随本次改动修正为「one request per course (no cross-course transaction)」 |
| —    | CSV 通道本身仍然只有两列 | 建议把 CSV 通道标记为「简易导入」，完整导入统一走课程包                    |
| —    | 附件只支持 PDF / PPTX    | `system_resources` 已能承载任意文件，但白板元素侧没有引用机制              |

---

## 5. 相关文件

```
server/services/course-package.ts            格式定义、zod 校验、内置模板
server/services/course-package-assets.ts     PDF / PPTX 资产生成、落盘、占位符解析
server/services/course-package-import.ts     单事务导入
server/routes/course-packages.ts             GET template / POST import
server/services/__tests__/course-package.test.ts        单元测试
server/__tests__/course-package-routes.test.ts          路由与事务回滚测试
src/services/coursePackageService.ts         前端服务（下载 / 解析 / 导入）
src/features/modals/ImportLessonsModal.tsx   导入弹窗（新增课程包分支）
src/hooks/useResourceLibrary.ts              导入状态机（新增课程包状态）
src/features/teacher/CourseManagement.tsx    工具栏「下载课程模板」
```
