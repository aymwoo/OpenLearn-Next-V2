-- UP
-- 016_preset_polls_and_passcode_expiry.sql
-- 补齐课程预设投票表与班级口令有效期、梯级下课条、随机点名奖赏字段

CREATE TABLE IF NOT EXISTS lesson_preset_polls (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  title TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'ABCD',
  options_json TEXT NOT NULL,
  correct_option TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lpp_lesson ON lesson_preset_polls(lesson_id);

ALTER TABLE classes ADD COLUMN class_passcode_expires_at INTEGER;

ALTER TABLE student_rollcalls ADD COLUMN rating TEXT;
ALTER TABLE student_rollcalls ADD COLUMN score INTEGER DEFAULT 0;
ALTER TABLE student_rollcalls ADD COLUMN reward_coins INTEGER DEFAULT 0;
ALTER TABLE student_rollcalls ADD COLUMN difficulty TEXT;

ALTER TABLE classroom_exit_tickets ADD COLUMN core_answer TEXT;
ALTER TABLE classroom_exit_tickets ADD COLUMN is_correct INTEGER DEFAULT 0;
ALTER TABLE classroom_exit_tickets ADD COLUMN tier_level TEXT DEFAULT 'passed';
ALTER TABLE classroom_exit_tickets ADD COLUMN challenge_answer TEXT;

-- DOWN
DROP INDEX IF EXISTS idx_lpp_lesson;
DROP TABLE IF EXISTS lesson_preset_polls;
