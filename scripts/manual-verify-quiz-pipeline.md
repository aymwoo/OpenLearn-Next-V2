# 手动验证 Quiz → WhiteboardEventSlot 流水线

> 这是一个 **手工 + curl** 的验证脚本，用来确认教师/学生端到端的实时成绩反馈链路是否通畅。
> 自动化的 e2e 测试见 `server/__tests__/quiz-answered-e2e.test.ts`。

## 前置

- 后端运行在 `pnpm dev`（或 `pnpm start`，端口 9000）
- 浏览器已开两个标签：
  - **Tab A** — 教师端（admin/admin）→ 创建一个 quiz 元素并进入全屏
  - **Tab B** — 学生端（任意 student 账号）→ 进入同一节课
- Tab B 已加载白板并能看到 quiz 元素

## 步骤

### 1. 观察 WhiteboardEventPanel 是否存在（教师端）

打开 Tab A 教师端白板页面，右下角应该有一个 **`🔔 事件流 (N)`** 按钮（默认折叠）。点击展开应该看到空列表（因为还没人提交）。

> data-testid：`whiteboard-event-panel`、`whiteboard-event-panel-toggle`

### 2. 学生提交 quiz

Tab B 学生端：点击白板上的 quiz 元素（如果非全屏）→ 全屏查看（教师已最大化时学生也能看到）。

选择答案 → 提交。

### 3. 教师端应该实时看到

- **WhiteboardEventPanel** 列表出现新行：
  ```
  类型: quiz.answered
  来源: widget.quiz
  学生: <学生名>
  内容: <答案> · 100分
  时间: <提交时间>
  ```
- **RecentSubmissionsCard**（如果有教师面板内嵌）显示：
  ```
  ✓ 答对  Alice · 100分 · <题目>
  ```

### 4. 用 curl 验证后端 emit（可选，给开发者）

获取 session token 后：

```bash
# 教师登录拿 token
TOKEN=$(curl -s -X POST http://localhost:9000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' \
  -c - | grep edu_os_token | awk '{print $7}')

# 触发一个 quiz-submit（学生 session）
STUDENT_TOKEN=$(curl -s -X POST http://localhost:9000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"student1","password":"student1"}' \
  -c - | grep edu_os_token | awk '{print $7}')

curl -s -X POST http://localhost:9000/api/lessons/<LESSON_ID>/quiz-submit \
  -H 'Content-Type: application/json' \
  -H "Cookie: edu_os_token=$STUDENT_TOKEN" \
  -d '{"elementId":"<QUIZ_ELEMENT_ID>","answer":"B"}'
```

期望响应：
```json
{ "success": true, "isCorrect": true, "score": 100, "studentId": "..." }
```

同时 socket 层应该 emit `whiteboard-quiz-answered` 事件（教师端 Tab A 的 WhiteboardEventPanel 会显示）。

## 故障排查

| 现象 | 原因 | 排查 |
|---|---|---|
| WhiteboardEventPanel 不显示 | userRole !== 'teacher' | 检查 InteractiveWhiteboard 的 userRole prop 是否传入 |
| 事件不显示在 Panel | socket 连接断开 | 打开 Network → WS，看 socket.io 是否 connected |
| Panel 显示了，但 RecentSubmissionsCard 没有 | 教师端没挂载该组件 | 检查 TeacherPanel 是否引用 `RecentSubmissionsCard` |
| HTTP quiz-submit 401 | session 失效 | 重新登录拿新 token |

## 与自动化测试的对应关系

| 手工验证步骤 | 自动化测试 |
|---|---|
| 后端 emit 事件 | `server/__tests__/quiz-answered-e2e.test.ts` (Test 1, 2) |
| 前端 ingest 到 WhiteboardEventSlot | `src/hooks/__tests__/whiteboard-quiz-ingest.test.tsx` |
| WhiteboardEventPanel 渲染 | `src/features/whiteboard/__tests__/whiteboard-event-slot.test.ts` |
| RecentSubmissionsCard 渲染 | 暂无（Todo: 加测试覆盖） |