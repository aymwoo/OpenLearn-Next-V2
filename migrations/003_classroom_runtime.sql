-- UP
-- Classroom and AI Assistant Runtime Tables

CREATE TABLE IF NOT EXISTS student_rollcalls (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  class_id TEXT,
  lesson_id TEXT,
  picked_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_settings (
  id TEXT PRIMARY KEY,
  site_name TEXT,
  slogan TEXT,
  logo_url TEXT
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  conv_key TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_conv_key ON agent_conversations(conv_key, created_at);

-- DOWN
DROP INDEX IF EXISTS idx_agent_conv_key;
DROP TABLE IF EXISTS agent_conversations;
DROP TABLE IF EXISTS site_settings;
DROP TABLE IF EXISTS student_rollcalls;
