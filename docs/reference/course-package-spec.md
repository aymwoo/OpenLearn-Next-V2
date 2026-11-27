# 课程包（Course Package）规范与多媒体导入指南

> **适用范围**：`openlearn-next` 0.8.x+（格式版本 `version: 3`）。
> 本页是「课程包 JSON」的权威说明：格式字典、交付模式（白板 / 学案）、附件内嵌方式、导入/导出边界与安全契约。
> 实证来源：`server/services/course-package.ts`、`course-package-assets.ts`、`course-package-import.ts`、`course-package-export.ts`。

---

## 1. 两条导入通道怎么选

平台有两条课程导入通道，能力差别很大：

| 维度        | CSV 简易导入（`POST /api/lessons`）             | 课程包 JSON（`/api/course-packages/*`）                              |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| 文件形态    | `.csv`，`title` + `content`（可选 `mode`）      | `.json`，单个自包含文档                                              |
| 交付模式    | 可选 `mode` 列（`whiteboard` / `xuean`）        | `lesson.deliveryMode`（缺省白板）                                    |
| 教学环节    | ❌ 不导入（学案课自动补默认三环节）             | ✅ 完整导入 `lesson.timeline`（讲授 / 练习 / 测验 / 总结…）          |
| 白板元素    | ❌ 空白板                                       | ✅ 导入 `elements[]`（演示文稿、测验、代码沙箱、数学函数等预设组件） |
| 学案活动    | ❌ 仅学案课自动生成三个默认活动                 | ✅ 导入 `lesson.activities` / `lesson.blocks`（学案课）              |
| 附件 / 图片 | ❌ 只能依赖公网图床链接                         | ✅ 附件 base64 内联，导入时落盘并返回本实例 `/api/files/<assetId>`   |
| 事务性      | 逐条写入，中途失败会留下半截数据                | ✅ 单事务写入，失败整体回滚并清理已落盘文件                          |
| 幂等去重    | 无                                              | ✅ `meta.id` 或内容哈希去重，重复导入返回 409 并询问                 |
| 适用场景    | 批量建「空壳课」、快速占位、批量指定白板 / 学案 | 完整教案交换、备课备份、模板分发、带讲义/课件的课堂                  |

**结论**：只要课程需要教学环节、白板组件、学案活动或任何物理文件，就必须走课程包通道。CSV 只适合批量创建标题与大纲（可指定交付模式）。

### 1.1 CSV 的 `mode` 列

CSV 表头可选增加 `mode`（也识别 `delivery_mode` / `课程模式` / `授课模式` / `模式`）列：

| 值                           | 结果                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| `whiteboard` / `白板` / 留空 | 创建白板课（缺省行为，与旧模板一致）                       |
| `xuean` / `学案` / `导学案`  | 创建学案课，并自动生成「预习 / 研读 / 练习」三个环节与活动 |

无法识别的值按白板处理，不会让整行导入失败。

---

## 2. 课程包 JSON 结构

一个最小的课程包：

```json
{
  "format": "openlearn.course-package",
  "version": 3,
  "meta": {
    "id": "my-lesson-2026-spring",
    "name": "函数的单调性",
    "description": "高一数学 · 第一课时",
    "author": "张老师",
    "tags": ["数学", "函数"]
  },
  "lesson": {
    "title": "函数的单调性",
    "content": "## 教学目标\n\n- 理解单调性的定义\n\n![示意图](${asset:img-1})",
    "progressMode": "manual",
    "deliveryMode": "whiteboard",
    "timeline": [
      { "id": "seg-intro", "title": "课堂导入", "type": "intro", "duration": "5m" },
      { "id": "seg-lecture", "title": "概念精讲", "type": "lecture", "duration": "20m" }
    ]
  },
  "assets": [
    {
      "id": "img-1",
      "filename": "monotonicity.png",
      "contentType": "png",
      "base64": "iVBORw0KGgoAAAANSUhEUg..."
    }
  ],
  "elements": [
    {
      "type": "presentation",
      "segmentId": "seg-lecture",
      "page": 0,
      "x": 40,
      "y": 40,
      "width": 600,
      "height": 400,
      "data": { "fileUrl": "${asset:img-1}", "fileType": "file", "fileName": "monotonicity.png" }
    }
  ]
}
```

一个最小的**学案课**课程包（课堂按活动推进，不依赖白板元素）：

```json
{
  "format": "openlearn.course-package",
  "version": 3,
  "lesson": {
    "title": "勾股定理 · 预习-研读-练习",
    "content": "## 学习目标\n\n- 理解勾股定理的证明思路",
    "progressMode": "manual",
    "deliveryMode": "xuean",
    "modePackId": "@openlearn/mode-xuean",
    "timeline": [
      { "id": "seg-preview", "title": "预习", "type": "xuean:preview", "duration": "10m" },
      { "id": "seg-study", "title": "研读", "type": "xuean", "duration": "20m" },
      { "id": "seg-drill", "title": "练习", "type": "xuean:drill", "duration": "15m" }
    ],
    "activities": [
      {
        "type": "reading",
        "title": "预习：阅读导学材料",
        "config": { "content": "阅读教材第 3 节，记录两个疑问。", "url": "" }
      },
      {
        "type": "submission",
        "title": "研读：提交阅读收获",
        "submissionType": "text",
        "config": { "instructions": "写下本节最重要的一个观点。", "acceptText": true, "acceptLink": false }
      },
      {
        "type": "discussion",
        "title": "练习：课堂讨论",
        "config": { "prompt": "还有哪些证明方法？", "allowReplies": true }
      }
    ],
    "blocks": [
      { "blockType": "xuean_home", "content": { "intro": "按预习 → 研读 → 练习完成本节课。", "backgroundImage": "" } }
    ]
  },
  "assets": [],
  "elements": []
}
```

> 学案包可以只写 `deliveryMode: "xuean"` 而不写 `activities`：导入端会按 timeline
> 自动生成活动（`xuean:preview` → 阅读、`xuean` → 作品提交、`xuean:drill` → 测验）。

### 2.1 顶层字段

| 字段       | 类型    | 必填 | 约束与说明                                                                 |
| ---------- | ------- | ---- | -------------------------------------------------------------------------- |
| `format`   | string  | 是   | 固定为 `openlearn.course-package`；不匹配直接判为非课程包                  |
| `version`  | integer | 是   | 正整数，当前为 `3`（v1/v2 旧包仍可导入，按白板处理）                       |
| `meta`     | object  | 否   | 缺省为 `{ name: '未命名课程模板', description: '', author: '', tags: [] }` |
| `lesson`   | object  | 是   | 课程本体                                                                   |
| `assets`   | array   | 否   | 内嵌附件，缺省 `[]`                                                        |
| `elements` | array   | 否   | 白板元素，缺省 `[]`                                                        |

### 2.2 `meta`

| 字段          | 类型     | 必填 | 说明                                                                                     |
| ------------- | -------- | ---- | ---------------------------------------------------------------------------------------- |
| `id`          | string   | 否   | 课程包的**稳定身份**。有它时去重键为 `id:<meta.id>`；缺省时退化为内容哈希 `sha256:<hex>` |
| `name`        | string   | 是   | 课程包名称（展示用）                                                                     |
| `description` | string   | 否   | 描述（不参与去重哈希）                                                                   |
| `author`      | string   | 否   | 作者（不参与去重哈希）                                                                   |
| `tags`        | string[] | 否   | 标签（不参与去重哈希）                                                                   |

> **建议**：手工维护的课程包请显式写 `meta.id`。这样修改课程标题或正文后重新导出，导入端仍能识别为「同一个包」，而不是产生一个全新的课程。

### 2.3 `lesson`

| 字段           | 类型       | 必填 | 说明                                                           |
| -------------- | ---------- | ---- | -------------------------------------------------------------- |
| `title`        | string     | 是   | 课程标题                                                       |
| `content`      | string     | 否   | Markdown 教学大纲；支持 `${asset:<id>}` 占位符（见 §3）        |
| `progressMode` | string     | 否   | 缺省 `manual`                                                  |
| `timeline`     | Segment[]  | 否   | 教学环节；元素通过 `segmentId` 归属环节                        |
| `deliveryMode` | string     | 否   | `whiteboard`（缺省）/ `xuean`；写入 `lessons.delivery_mode`    |
| `modePackId`   | string     | 否   | 课时绑定的模式包 id；学案包缺省回落内置学案包，白板包保持 NULL |
| `activities`   | Activity[] | 否   | 学案活动；`xuean` 且缺省时按 timeline 自动生成                 |
| `blocks`       | Block[]    | 否   | 学案首页块（如 `xuean_home` 简介）                             |

`Segment`：

| 字段       | 类型   | 必填 | 说明                                                                                                               |
| ---------- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `id`       | string | 是   | 环节 id，**包内唯一**；重复会导致导入失败                                                                          |
| `title`    | string | 是   | 环节标题                                                                                                           |
| `type`     | string | 是   | 白板课用 `intro` / `lecture` / `practice` / `quiz` / `summary`；学案课用 `xuean:preview` / `xuean` / `xuean:drill` |
| `duration` | string | 否   | 例如 `"5m"`                                                                                                        |
| `notes`    | string | 否   | 教师备注                                                                                                           |
| `color`    | string | 否   | 环节配色（Tailwind class 字符串）                                                                                  |
| `gates`    | Gate[] | 否   | 进入条件，与备课编辑器「环节门禁」同构                                                                             |

`Gate`：`{ "id"?: string, "type": string, "params"?: object }`。

`Activity`（学案活动，导入时写入 `lesson_activities`）：

| 字段                  | 类型    | 必填 | 说明                                                                                                      |
| --------------------- | ------- | ---- | --------------------------------------------------------------------------------------------------------- |
| `type`                | string  | 是   | `reading` / `submission` / `quiz` / `survey` / `discussion` / `courseware` / `scratch` / `form` / `other` |
| `title`               | string  | 是   | 活动标题                                                                                                  |
| `config`              | object  | 否   | 活动配置（阅读正文、提交说明、讨论题等），写入 `config_json`                                              |
| `required`            | boolean | 否   | 缺省 `true`                                                                                               |
| `visible`             | boolean | 否   | 缺省 `true`                                                                                               |
| `peerReview`          | boolean | 否   | 缺省 `false`                                                                                              |
| `groupMode`           | string  | 否   | 缺省 `none`                                                                                               |
| `submissionType`      | string  | 否   | 仅作品提交活动使用，例如 `text`                                                                           |
| `rubric`              | object  | 否   | 评分量规，写入 `rubric_json`                                                                              |
| `releaseAt` / `dueAt` | number  | 否   | 毫秒时间戳                                                                                                |

`Block`（学案首页块，导入时写入 `lesson_activity_blocks`）：

| 字段        | 类型   | 必填 | 说明                                                                                                                   |
| ----------- | ------ | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `blockType` | string | 是   | `xuean_home` / `interactive_courseware` / `learning_goals` / `resources` / `free_html` 等                              |
| `content`   | object | 否   | 块内容；`xuean_home` 为 `{ intro, backgroundImage }`，背景图只接受本实例上传文件 URL（`/api/files/*` 或 `/uploads/*`） |

`interactive_courseware` 块的 `content` 为 `{ coursewareUuid, resourceId, title }`（二者至少一个），
导入时会像 `/api/lessons/:lessonId/blocks` 一样创建 `lesson_block` 类型的 LearningSurface 并回写
`surface_id`；只写块而不建 Surface 的话，学生端会退化成一段原始 JSON 而不是课件。

### 2.4 `assets`

| 字段          | 类型   | 必填 | 说明                                                                    |
| ------------- | ------ | ---- | ----------------------------------------------------------------------- |
| `id`          | string | 是   | 包内唯一，只允许 `A-Z a-z 0-9 _ -`（占位符 `${asset:<id>}` 的语法约束） |
| `filename`    | string | 是   | 展示用文件名                                                            |
| `contentType` | enum   | 是   | `pdf` `pptx` `docx` `xlsx` `zip` `png` `jpg` `md` `txt` `csv`           |
| `base64`      | string | 是   | 文件内容的标准 Base64；解码后不能为空                                   |

### 2.5 `elements`

| 字段        | 类型    | 必填 | 说明                                                                   |
| ----------- | ------- | ---- | ---------------------------------------------------------------------- |
| `type`      | string  | 是   | 白板元素类型；未知类型会被导入端拒绝                                   |
| `segmentId` | string  | 否   | 必须引用 `lesson.timeline` 中存在的环节                                |
| `page`      | integer | 否   | 白板页码，从 0 开始；缺省为 0                                          |
| `pageId`    | string  | 否   | 白板页稳定 id（与 `page_meta` 里的 `pages[].id` 对应）                 |
| `x` / `y`   | number  | 否   | 画布坐标                                                               |
| `width`     | number  | 否   | 必须 > 0                                                               |
| `height`    | number  | 否   | 必须 > 0                                                               |
| `data`      | object  | 否   | 组件私有数据（如 `presentation.fileUrl`、`quiz.question`）；支持占位符 |

支持的 `type`（与 `whiteboard.draw` 对齐）：
`pen` `highlighter` `rectangle` `circle` `text` `quiz` `rollcall` `timer` `assignment`
`hello-world` `html-applet` `code-sandbox` `math-graph` `presentation` `plugin` `page_meta`；
以及按命名约定放行的插件元素：包含 `/`、或以 `plugin:` / `plugin-` / `ext-` 开头。

`page_meta.data.pages[]` 的页面身份：

| 字段                 | 类型     | 说明                                                                                                     |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `id`                 | string   | 页面稳定 id。删除、复制和元素归属以它为准，不以全局下标为准                                              |
| `title`              | string   | 大纲标题                                                                                                 |
| `order`              | number   | 列表顺序                                                                                                 |
| `segmentId`          | string   | 可选。有值时该页只属于这一环节                                                                           |
| `excludedSegmentIds` | string[] | 可选。共享页（没有 `segmentId`）从这些环节的大纲中隐藏。在某一环节删除共享页时只追加当前环节，不删除记录 |

在某一教学环节里删除页面时：已绑定该环节的页只从 `pages` 中移除这一条，并只清理属于该页且属于该环节的元素；没有 `segmentId` 的共享页不从数组里摘掉（避免其它环节的同序号页跟着消失），而是把当前环节写入 `excludedSegmentIds`，并只删除 `segmentId` 等于当前环节的元素。

---

## 3. 附件占位符 `${asset:<id>}`

课程包里**不直接写** `/uploads/xxx.pdf` 或 `/api/files/<assetId>` 这类本机路径 —— 换个实例必然 404。
所有附件引用统一写成占位符：

- 白板元素：`data.fileUrl = "${asset:asset-sample-handout}"`
- 课程正文（Markdown）：图片写 `![示意图](${asset:img-1})`；下载链接则是普通超链接，把圆括号里的地址写成 `${asset:doc-1}`。
- 学案活动 / 首页块：`activities[].config`、`activities[].rubric`、`blocks[].content` 里的字符串同样支持占位符（如阅读材料中的图片），导入时一并解析、导出时一并逆向替换。

导入时，占位符会被替换成**导入方实例统一文件存储返回的** `/api/files/<assetId>`（旧数据里的 `/uploads/<随机名>.<ext>` 仍由 `file_aliases` 兼容读取）：

```text
课程包内的 ${asset:img-1}
        ↓ 导入时落盘 + 替换
lessons.content / whiteboard_elements.data 中的 /api/files/fa_01J...
```

- 引用了不存在的资产 id → **整个导入失败并回滚**（不会写出一节半坏的课）。
- 导出时平台会做逆向操作：扫描正文与元素里的 `/api/files/*` 与旧 `/uploads/*` 引用，读取对应资产、base64 内联、把 URL 换回占位符。

### 3.1 哪些类型能内联放映

| 附件类型                                         | 导入后的渲染方式                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `pdf`                                            | 「课件演示」组件内联渲染（pdf.js）                                |
| `pptx`                                           | 「课件演示」组件内联渲染（PowerPointViewer）                      |
| `docx` `xlsx` `zip` `png` `jpg` `md` `txt` `csv` | 降级为**下载卡片**（元素 `fileType` 被改写为 `file`），可点击下载 |

图片若想直接显示在教案里，请用 Markdown 图片语法引用占位符：`![说明](${asset:img-1})`。

---

## 4. 安全与限制契约

这些限制是**产品契约**，前后端与文档必须口径一致（常量定义在 `server/services/course-package.ts`）。

| 契约                 | 值 / 行为                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单包浏览器体积上限   | **20MB**（`COURSE_PACKAGE_MAX_FILE_BYTES`）。前端选文件时即拦截，不会把超限文件送到服务端                                                           |
| 导入请求体上限       | **32MB**（`COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES`）。base64 膨胀约 1.37 倍，故高于文件上限                                                         |
| 附件解码后总体积上限 | **20MB**。超出返回 `413 COURSE_PACKAGE_TOO_LARGE`                                                                                                   |
| Magic Bytes 校验     | 按**声明的 `contentType`** 校验文件头：`pdf`=`%PDF`，`pptx/docx/xlsx/zip`=`PK\x03\x04`，`png`=`\x89PNG`，`jpg`=`\xFF\xD8\xFF`                       |
| 文本类型校验         | `md/txt/csv` 无文件头可验，但出现 NUL 字节即判定「二进制伪装成文本」并拒绝                                                                          |
| 白名单               | 只允许 §2.4 的 10 种类型；不存在「任意二进制」通道                                                                                                  |
| 幂等去重             | 去重键 `id:<meta.id>` 或 `sha256:<内容哈希>`；作用域是**创建者**；命中返回 `409 COURSE_PACKAGE_DUPLICATE`，可用 `allowDuplicate: true` 强制导入副本 |
| 失败补偿             | 附件文件先于数据库事务落盘；任何一步失败都会删除本次已写文件，数据库整体回滚                                                                        |
| 导出体积上限         | 课程引用的附件解码后合计超过 20MB 时拒绝导出（`413 COURSE_PACKAGE_EXPORT_TOO_LARGE`），避免产出「导不回去」的包                                     |
| 导出权限             | 仅课程创建教师或管理员（与学生/其他教师分离）；课程不存在返回 404                                                                                   |

> **幂等的作用域为什么是创建者**：内置模板要能被每位教师各导一份。若全局去重，第二位教师就永远导不进模板。删除课程会释放去重键（键存在 `lessons` 行上）。

---

## 5. 把文件转成 Base64（实战脚本）

### 5.1 Node.js

```js
import fs from 'node:fs';
import path from 'node:path';

const toAsset = (id, filePath) => ({
  id,
  filename: path.basename(filePath),
  contentType: path.extname(filePath).slice(1).toLowerCase().replace('jpeg', 'jpg'),
  base64: fs.readFileSync(filePath).toString('base64'),
});

const pkg = JSON.parse(fs.readFileSync('my-course.json', 'utf8'));
pkg.assets = [
  toAsset('img-1', './monotonicity.png'),
  toAsset('doc-1', './第3章讲义.docx'),
  toAsset('deck-1', './课件.pptx'),
];
fs.writeFileSync('my-course.openlearn-package.json', JSON.stringify(pkg, null, 2));
```

### 5.2 Python

```python
import base64, json, os
from pathlib import Path

def to_asset(asset_id: str, file_path: str) -> dict:
    ext = Path(file_path).suffix.lower().lstrip('.')
    return {
        "id": asset_id,
        "filename": os.path.basename(file_path),
        "contentType": "jpg" if ext == "jpeg" else ext,
        "base64": base64.b64encode(Path(file_path).read_bytes()).decode("ascii"),
    }

with open("my-course.json", encoding="utf-8") as f:
    pkg = json.load(f)

pkg["assets"] = [
    to_asset("img-1", "./monotonicity.png"),
    to_asset("doc-1", "./第3章讲义.docx"),
    to_asset("deck-1", "./课件.pptx"),
]

with open("my-course.openlearn-package.json", "w", encoding="utf-8") as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
```

> 自包含意味着**不需要**手工把占位符替换成路径：导入端会落盘并替换。你只需要保证
> `assets[].id` 与正文/元素里 `${asset:<id>}` 的 id 一致，且文件类型在允许清单内。

### 5.3 命令行速查

```bash
# 单个文件 → base64 字符串
base64 -w 0 ./monotonicity.png

# 校验 Base64 能否解回原文件
echo "$BASE64" | base64 -d > /tmp/check.png && cmp /tmp/check.png ./monotonicity.png
```

---

## 6. 导入 / 导出端点

### 6.1 下载内置模板

```text
GET /api/course-packages/template               # 白板模板（缺省）
GET /api/course-packages/template?mode=xuean    # 学案模板
```

- 白板模板：自包含 JSON（含 PDF 讲义与 PPTX 课件两份真实附件），覆盖备课面板全部预设组件，
  适合作为「照着改」的起点，也适合验证导入链路。
- 学案模板：`deliveryMode: "xuean"` + 预习 / 研读 / 练习三个环节 + 阅读 / 作品提交 / 讨论三个活动
  - 一个 `xuean_home` 首页块，不携带白板元素与附件。

### 6.2 导入

```text
POST /api/course-packages/import
Content-Type: application/json

{ "package": { ...课程包... }, "allowDuplicate": false }
```

也接受请求体顶层直接就是课程包对象。成功响应带 `result.lessonId`、`segments`、`elements`、
`assets`、`assetFiles`（落盘明细）与 `packageKey`。

### 6.3 导出已有课程

```text
GET /api/lessons/:id/export-package
```

- 权限：课程创建教师或管理员。
- 行为：读取 `lessons`（标题 / 正文 / timeline / progressMode）、`whiteboard_elements`，
  扫描正文与元素里引用的 `/api/files/*` 与旧 `/uploads/*` 文件，读取资产并 base64 内联进 `assets[]`，URL 逆向替换为占位符。
- 响应头：
  - `Content-Disposition`：`filename*=UTF-8''<课程标题>.openlearn-package.json`
  - `X-Course-Package-Filename`：URL 编码后的文件名（前端据此保存）
  - `X-Course-Package-Assets`：内联附件数
  - `X-Course-Package-Skipped`：未内联的引用数（文件缺失 / 类型不支持 / 签名不符）
- 规范化：快照标记（`snapshot_marker`）、未知元素类型、指向不存在环节的元素**不会导出**；
  环节缺失 id 会补全、重复 id 会重命名并同步重映射 `segmentId`；导出的包会先通过导入端校验再返回。

界面入口：

- 课程管理列表：每张课程卡片的操作栏 → **导出课程包**（仅创建者或管理员可见）。
- 教案设计器顶栏 → **导出课程包**。
- 课程管理工具栏 → **白板模板** / **学案模板** 两个下载入口。
- 导入对话框中的 **下载白板课程模板** / **下载学案课程模板** 按钮。

导出的文件可以直接拖回导入对话框；因为 `meta.id` 沿用原课程 id，同一教师重复导入同一份导出物时，
会按幂等规则返回 409 并询问是否仍要导入副本。

---

## 7. 常见问题

**Q：导入后白板上为什么什么都没有？**
A：你用的可能是 CSV 通道。CSV 只写标题与正文；白板元素只在课程包的 `elements[]` 里。

**Q：正文里的图片为什么不显示？**
A：请确认引用写的是 `${asset:<id>}`（0.7.8+ 支持正文占位符），且 `id` 在 `assets[]` 中存在；
导入时占位符会被替换成 `/api/files/<assetId>`（旧数据为 `/uploads/...`），直接写死的本机路径在其他实例上会 404。

**Q：为什么 docx / xlsx / zip 没有内联预览？**
A：平台只对 PDF / PPTX 提供内联渲染器；其余类型按设计降级为下载卡片（`fileType: "file"`），
这是为了避免用错误字节去喂渲染器导致「一直解析中」。

**Q：导出提示附件超过 20MB？**
A：课程引用的附件解码后合计超限。课程包是单文件自包含格式，超过 20MB 就会超出浏览器导入上限；
请拆分课程或压缩图片后重试。

**Q：重新导入自己导出的包时提示重复？**
A：这是幂等保护。确实要两份时，在冲突提示中选择「仍然导入副本」（`allowDuplicate: true`）。

**Q：白板模板和学案模板有什么区别？**
A：白板课按教学环节 + 白板元素推进，课堂使用互动白板；学案课按活动推进（`lesson.activities`），
课堂使用学案工作区，白板元素可以为空。两者的课程包结构相同，由 `lesson.deliveryMode` 区分；
导出已有课程时会自动带上真实的交付模式与学案活动。
