-- ═══════════════════════════════════════════════════════════════════════════
-- 009_classroom_peer_review.sql — 课中全班大屏互评（Peer Review Showcase）
--
-- 背景：`src/features/classroom/peer-review/*`（Stitch 21e2dac1 全班大屏作业互评）
-- 此前只有前端 UI，无任何后端表；界面靠内置 mock 学生/作品/评分渲染。
-- 本迁移补齐课中互评的真实数据模型，使互评秀场可用真实数据驱动。
--
-- 与既有「作业级互评」（005_assignment_hub.sql 的 plugin_peer_review_*）的区别：
--   plugin_peer_review_*  作业为中心，跨课时生效，带双盲/量规/截止
--   classroom_peer_review_* 课堂为中心，随 session 生命周期，服务课中大屏场景
-- 两者互不影响，可并存。
--
-- 设计要点：
--   1. 所有表以 session_id 为主归属（课堂实时数据随会话结束即冻结）；
--   2. 分配任务唯一键 (session_id, reviewer_id, target_attempt_id) —— 防止
--      同一评阅人对同一份作品重复分配；
--   3. 评语唯一键 (session_id, reviewer_id, target_attempt_id) —— 支持重复修改
--      （同一条记录被 UPDATE），避免刷出多条互评记录；
--   4. 目标作品用 courseware_attempt.id 引用（不冗余作品内容），便于大屏展示
--      时按需联表取真实成绩与完成度；
--   5. 徽章/提名/弹幕均为真实课堂互动事件，供大屏实时展示与统计。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. 互评任务分配 ────────────────────────────────────────────────────────
-- 教师一键「1 生评 2 份」时写入；学生端按此拉取自己的待评列表。
CREATE TABLE IF NOT EXISTS classroom_peer_review_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  class_id TEXT,
  -- 评阅人（学生）
  reviewer_id TEXT NOT NULL,
  reviewer_name TEXT,
  -- 被评对象：提交作品的学生 + 具体 attempt（真实课件作答）
  target_student_id TEXT NOT NULL,
  target_student_name TEXT,
  target_attempt_id TEXT,
  -- 展示口径（来自 courseware_attempt 快照，避免大屏每帧联表）
  target_work_title TEXT,
  target_score REAL,
  -- 分层对调：'benchmark'（标杆范本）| 'improve'（攻坚作业）
  tier TEXT DEFAULT 'benchmark',
  status TEXT DEFAULT 'pending', -- pending | in_progress | submitted
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  UNIQUE(session_id, reviewer_id, target_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_cprt_session ON classroom_peer_review_tasks(session_id, status);
CREATE INDEX IF NOT EXISTS idx_cprt_reviewer ON classroom_peer_review_tasks(session_id, reviewer_id);

-- ── 2. 互评评语（学生提交的评分 + 评语 + 量规维度分） ─────────────────────
-- 唯一键含 session/reviewer/target_attempt，保证「同一人评同一份作品」只有一条，
-- 重复提交走 UPDATE（学生可反复改分直到教师锁榜）。
CREATE TABLE IF NOT EXISTS classroom_peer_reviews (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewer_name TEXT,
  target_student_id TEXT NOT NULL,
  target_attempt_id TEXT,
  score REAL NOT NULL,
  max_score REAL DEFAULT 5,
  comment TEXT,
  -- 量规维度分：{"algorithm":4,"style":5,...}（JSON，维度定义见 rubric 表）
  dimension_scores_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, reviewer_id, target_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_cpr_session ON classroom_peer_reviews(session_id, target_student_id);

-- ── 3. 随堂互评微勋章（学生互赠，用于大屏徽章流） ────────────────────────
CREATE TABLE IF NOT EXISTS classroom_peer_badges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  receiver_id TEXT NOT NULL,
  receiver_name TEXT,
  -- 勋章类型键（对应前端徽章定义，如 'brilliant_idea' | 'self_heal' | 'best_solution'）
  badge_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, sender_id, receiver_id, badge_key)
);

CREATE INDEX IF NOT EXISTS idx_cpb_session ON classroom_peer_badges(session_id, receiver_id);

-- ── 4. 先锋榜提名（按票数排名，供大屏领奖台） ────────────────────────────
-- 每次提名一行（而非计数器列），便于去重与追溯；票数由 COUNT 聚合得到。
CREATE TABLE IF NOT EXISTS classroom_peer_nominations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  nominator_id TEXT NOT NULL,
  nominated_student_id TEXT NOT NULL,
  nominated_student_name TEXT,
  honor_key TEXT, -- 荣誉标签键（如 'best_open_source' | 'best_progress'）
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, nominator_id, nominated_student_id)
);

CREATE INDEX IF NOT EXISTS idx_cpn_session ON classroom_peer_nominations(session_id, nominated_student_id);

-- ── 5. 大屏弹幕（文字 / 语音弹幕） ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS classroom_danmaku (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  text TEXT NOT NULL,
  -- 'text' | 'voice'（voice 附带时长秒数）
  type TEXT DEFAULT 'text',
  voice_duration_seconds INTEGER,
  -- 弹幕纵向位置百分比（0-100），由前端随机分配后落库，保证多端位置一致
  top_percent INTEGER DEFAULT 20,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cd_session ON classroom_danmaku(session_id, created_at DESC);

-- ── 6. 互评量规维度定义（教师可自定义，服务 rubric 看板） ─────────────────
CREATE TABLE IF NOT EXISTS classroom_peer_rubric_dimensions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  label TEXT NOT NULL,
  -- 展示用色（Tailwind 类名，随主题无关的固定色板）
  color_class TEXT,
  bar_color_class TEXT,
  max_score REAL DEFAULT 5,
  weight REAL DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, label)
);

CREATE INDEX IF NOT EXISTS idx_cprd_session ON classroom_peer_rubric_dimensions(session_id, sort_order);
