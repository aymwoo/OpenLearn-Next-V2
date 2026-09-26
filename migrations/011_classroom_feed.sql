-- 011: 课堂动态流持久化（课堂会话保存与恢复）
--
-- 背景：liveClassFeed 此前是纯前端内存态（appStore 上限 50 条），教师离开
-- 课堂再回来后动态流清零。本表把课堂动态（随堂作答、签到、表彰、作业提交/
-- 批改、进度里程碑等）落库为会话级事实，重进课堂时按 lesson 回放。
--
-- 写入方：server/services/classroom-feed-service.ts（订阅内核事件总线，
-- 与 server/event-routing.ts 的声明式路由同款模式）。
-- 读取方：GET /api/classroom/sessions/:lessonId 的 feedReplay 字段。

CREATE TABLE IF NOT EXISTS classroom_feed (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  lesson_id TEXT NOT NULL,
  class_id TEXT,
  -- 动态类型：quiz_answered / checkin / achievement / assignment_submitted /
  -- assignment_graded / progress / courseware_submitted / info
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  source TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classroom_feed_lesson ON classroom_feed(lesson_id, created_at);
CREATE INDEX IF NOT EXISTS idx_classroom_feed_session ON classroom_feed(session_id, created_at);
