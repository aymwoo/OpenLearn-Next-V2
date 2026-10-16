-- UP
-- 课程大纲模型思维链残留 (<think>...</think>) 清洗标记表。
-- 真正的正则文本清洗由启动阶段 cleanStoredLessonThinkArtifacts(db) 幂等执行。
CREATE TABLE IF NOT EXISTS _lesson_think_cleanup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  note TEXT NOT NULL
);

INSERT OR IGNORE INTO _lesson_think_cleanup (id, note)
VALUES (1, 'lessons.content reasoning artifacts cleaned on startup');

-- DOWN
DROP TABLE IF EXISTS _lesson_think_cleanup;
