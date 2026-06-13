# AI 互动课件运行时（AI Courseware Runtime）开发提示词

> 将以下完整需求直接交给 Vibe Coding 工具（Claude Code、Cursor、Gemini CLI、Windsurf、Trae、Augment 等）即可生成项目。

## 一、项目目标

完善当前的HTML Applet组件，支持教师上传和使用以下课件：

### 支持的课件格式

1. 单个 HTML 文件

```text
quiz.html
```

2. ZIP 压缩包

```text
lesson.zip

├─ index.html
├─ css/
├─ js/
├─ assets/
└─ images/
```

ZIP 解压后自动识别入口页面。

优先寻找：

```text
index.html
main.html
lesson.html
```

如果存在多个候选入口，应允许教师手动指定。

---

## 二、技术栈要求

### 后端

优先：

```text
Next.js v16
SQLite（开发）
PostgreSQL（生产）
```

目录结构清晰，支持以后替换数据库。

### 前端

使用：

```text
next.js v16
```

要求：

- 组件化
- 易维护
- 不依赖重量级 UI 框架

---

## 三、课件上传模块

实现：

```http
POST /api/courseware/upload
```

支持：

- html
- htm
- zip

限制：

```text
最大文件：500MB
```

上传后生成 UUID：

```text
storage/courseware/{uuid}/
```

数据库：

```sql
courseware

id
uuid
name
type
entry
created_at
```

---

## 四、ZIP 自动解压

自动解压：

```text
storage/courseware/{uuid}/
```

识别规则：

```text
index.html
main.html
lesson.html
```

若不存在：

扫描：

```text
*.html
```

如果只有一个 HTML：

自动使用。

如果多个：

```json
{
  "need_select_entry": true,
  "candidates": [...]
}
```

---

## 五、安全运行要求（最重要）

禁止：

- innerHTML
- dangerouslySetInnerHTML
- v-html

直接运行课件。

必须使用 iframe 沙箱：

```html
<iframe
    sandbox="
        allow-scripts
        allow-forms
        allow-downloads
    "
>
</iframe>
```

禁止：

```text
allow-same-origin
allow-top-navigation
allow-popups
allow-modals
```

确保课件不能：

- 获取主站 Cookie
- 操作主站 DOM
- 修改父页面
- 跳转主页面
- 访问 localStorage

---

## 六、运行时 URL

```text
/runtime/{uuid}/
```

自动加载入口页面。

实现静态资源服务。

保证 ZIP 内：

```text
css/
js/
assets/
images/
```

都能正常访问。

---

## 七、Bridge SDK（核心）

自动注入：

```javascript
window.LMS
```

提供 API：

```javascript
LMS.submit(data)

LMS.saveProgress(data)

LMS.finish(data)

LMS.getStudent()

LMS.getCourseware()

LMS.log(event,data)
```

示例：

```javascript
LMS.submit({
    score:95,
    comment:"优秀"
})
```

使用 postMessage 与父页面通信。

---

## 八、自动注入 bridge.js

无需修改课件源码。

至少实现两种方案：

### 方案一

运行时修改 HTML：

```html
<script src="/bridge.js"></script>
```

### 方案二

运行时代理响应内容并注入。

说明优缺点，并实际采用其中一种。

---

## 九、数据采集（兼容未知课件）

实现 Hook：

### fetch

采集：

- url
- method
- headers
- body

### XMLHttpRequest

采集：

- url
- body

### axios

采集：

- config.data

### 表单提交

采集 FormData。

### Beacon API

拦截：

```javascript
navigator.sendBeacon()
```

### postMessage

监听：

```javascript
window.parent.postMessage(...)
```

要求：

原逻辑必须继续执行。

---

## 十、主站接收消息

实现：

```javascript
window.addEventListener("message")
```

接收：

```javascript
{
    type:"LMS_SUBMIT",
    payload:{...}
}
```

以及：

```javascript
FETCH
XHR
FORM
```

校验：

- event.source
- event.origin
- courseware uuid
- student session

防止伪造。

---

## 十一、学生身份注入

提供：

```json
{
    "student_id":123,
    "student_name":"张三",
    "class_id":5,
    "attempt_id":888
}
```

供：

```javascript
LMS.getStudent()
```

读取。

禁止暴露：

- JWT
- Cookie
- Token

---

## 十二、数据库设计

### courseware

```sql
id
uuid
name
entry
created_at
```

### courseware_attempt

```sql
id
courseware_id
student_id
started_at
finished_at
status
```

### submission_raw

```sql
id
attempt_id
event_type
payload_json
created_at
```

### submission_result

```sql
id
attempt_id
score
comment
completion
extra_json
```

---

## 十三、未知数据标准化

优先识别：

```text
score
grade
result
comment
feedback
completion
student
name
```

生成统一结果。

要求：

- 保留原始 JSON
- 永不覆盖
- 不得丢失数据

---

## 十四、教师管理后台

支持：

### 课件管理

- 上传
- 删除
- 查看入口
- 查看文件大小
- 查看上传时间

### 学习记录

查看：

- 学生
- 开始时间
- 完成时间
- 状态
- 得分
- 评价

### 原始数据查看

展示 payload_json。

支持复制。

---

## 十五、学生端

流程：

```text
课程
↓
点击课件
↓
加载 iframe
↓
学习
↓
自动记录结果
```

要求：

- 加载中状态
- 错误提示
- 支持断点续学

---

## 十六、日志与审计

记录：

- 上传日志
- 运行日志
- Bridge 日志
- Hook 日志
- 错误日志
- 提交日志

支持按：

- 课程
- 学生
- 课件
- attempt

查询。

---

## 十七、测试要求

### 上传测试

- HTML
- ZIP
- 多入口 ZIP

### Bridge 测试

验证：

```javascript
LMS.submit()
```

### Hook 测试

验证：

- fetch
- xhr
- axios
- beacon
- form

### 安全测试

验证无法：

- 访问 Cookie
- 修改父页面 DOM
- 跳转顶层页面

---

## 十八、代码要求

在帮助页面添加专门的一个标签页面用来说明这个功能包含：

- 安全说明
- Bridge API 文档
- Hook 原理说明

代码必须能够直接运行，而不是伪代码。

如果发现更优方案，请在不破坏核心目标的前提下主动优化，并解释原因。

核心目标优先级：

1. 安全隔离
2. 未知数据采集
3. 可维护性
