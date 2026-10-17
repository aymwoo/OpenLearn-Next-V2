-- UP
-- 测评子系统核心表（Issue #100 / 子 issue #120）。
--
-- 设计口径（记录在这里，避免和大纲脱节）：
--   * 组卷即快照：题目加入试卷时就复制进 assessment_items（草稿自包含），
--     发布只改 assessments.status；bank_item_id 仅作溯源，删题库不影响已组卷内容。
--   * 权威答案字段是 answer_key_json，**只在服务端使用**，任何学生端响应都不得包含它
--     （白名单序列化 + 单测门禁，见 packages/core/assessment/serialize.ts）。
--   * 匿名问卷：assessment_attempts.student_id 为 NULL，用 anon_key（HMAC）去重；
--     教师端响应不含 anon_key / student_id。
--   * 多次作答的聚合口径（first/last/highest/average）实时计算，不落冗余列。
--   * 超时用惰性结算：任何读取到 now > deadline_at 的 in_progress attempt 都结算为 submitted。
--   * 表里没有"总分"冗余列以外的派生数据；assessment_attempts.score 是"已判分部分的合计"，
--     needs_manual_review 指明是否还有待人工批改的题。

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('quiz', 'exam', 'survey')),
  title TEXT NOT NULL,
  description TEXT,
  owner_id TEXT NOT NULL,
  -- 计时 / 作答次数 / 乱序 / 匿名 / 结果可见性 / 计分策略，见 packages/core/assessment/settings.ts
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  academic_year TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessments_owner ON assessments(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_assessments_kind ON assessments(kind, status);

CREATE TABLE IF NOT EXISTS question_bank_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL,
  stem TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  -- 标准答案，仅服务端可读
  answer_key_json TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  difficulty INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_question_bank_owner ON question_bank_items(owner_id, type);

-- 试卷中的题：组卷时物化的快照（改题库不影响已组卷内容）
CREATE TABLE IF NOT EXISTS assessment_items (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  -- 溯源用；题库条目被删后仍保留快照，因此可为 NULL
  bank_item_id TEXT,
  section TEXT,
  sort_order INTEGER NOT NULL,
  type TEXT NOT NULL,
  stem TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  answer_key_json TEXT,
  max_score REAL NOT NULL DEFAULT 1,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assessment_items_order ON assessment_items(assessment_id, sort_order);

-- 发布到班级（可选关联课节 / 课表节次 / 课堂会话）
CREATE TABLE IF NOT EXISTS assessment_assignments (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  lesson_id TEXT,
  schedule_id TEXT,
  session_id TEXT,
  opens_at INTEGER,
  closes_at INTEGER,
  duration_sec INTEGER,
  -- P1 回写 exams/exam_scores 时的关联
  exam_id TEXT,
  academic_year TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- 教师「发布成绩」后才允许学生看到分数与答案（exam 类型默认关闭）
  score_released INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assessment_assignments_class ON assessment_assignments(class_id, status);
CREATE INDEX IF NOT EXISTS idx_assessment_assignments_lesson ON assessment_assignments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_assessment_assignments_window
  ON assessment_assignments(opens_at, closes_at);

CREATE TABLE IF NOT EXISTS assessment_attempts (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  -- 匿名问卷为 NULL；非匿名为学生 id
  student_id TEXT,
  -- 匿名去重用的 HMAC（见 packages/core/assessment/anonymous.ts）
  anon_key TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'submitted', 'graded', 'released')),
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  deadline_at INTEGER,
  -- 已判分部分的合计；人工批改后由服务端重算
  score REAL,
  max_score REAL,
  -- 1 表示仍有题目在等人工批改（简答 / grader 返回 score=null）
  needs_manual_review INTEGER NOT NULL DEFAULT 0,
  -- 切屏 / 失焦计数等考试监考数据（P1 使用）
  proctor_json TEXT NOT NULL DEFAULT '{}',
  academic_year TEXT,
  FOREIGN KEY (assignment_id) REFERENCES assessment_assignments(id) ON DELETE CASCADE
);

-- 同一身份（学生 id 或匿名 key）在同一份布置下，每个 attempt_no 只允许一条；
-- 匿名问卷 max_attempts 恒为 1，因此这条索引同时承担「防一人多交」。
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_attempts_identity ON assessment_attempts(
  assignment_id,
  COALESCE(student_id, ''),
  COALESCE(anon_key, ''),
  attempt_no
);

CREATE INDEX IF NOT EXISTS idx_assessment_attempts_status ON assessment_attempts(assignment_id, status);
CREATE INDEX IF NOT EXISTS idx_assessment_attempts_student ON assessment_attempts(student_id);

CREATE TABLE IF NOT EXISTS assessment_answers (
  attempt_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  answer_json TEXT,
  score REAL,
  max_score REAL,
  is_correct INTEGER,
  -- auto | manual | plugin:<id> | ai_suggested
  grader TEXT,
  feedback TEXT,
  graded_by TEXT,
  graded_at INTEGER,
  -- 教师手动改过的行不被自动判分覆盖（判分幂等的一部分）
  manual_override INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, item_id),
  FOREIGN KEY (attempt_id) REFERENCES assessment_attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assessment_answers_item ON assessment_answers(item_id);

-- DOWN
DROP TABLE IF EXISTS assessment_answers;
DROP TABLE IF EXISTS assessment_attempts;
DROP TABLE IF EXISTS assessment_assignments;
DROP TABLE IF EXISTS assessment_items;
DROP TABLE IF EXISTS question_bank_items;
DROP TABLE IF EXISTS assessments;
