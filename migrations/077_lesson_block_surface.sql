-- UP
-- 077_lesson_block_surface.sql
--
-- 阶段 5：把学案首页的 `interactive_courseware` 区块迁移为统一 Surface。
--
-- 学案首页块（lesson_activity_blocks）不是活动：有独立 order_index、没有提交 /
-- 评分语义，因此新增 kind='lesson_block'，而不是转成 lesson_activities 活动。
--
-- 迁移只加 surface_id 与 Surface，content_json 保持原样（便于回退）。

ALTER TABLE lesson_activity_blocks ADD COLUMN surface_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_activity_blocks_surface
  ON lesson_activity_blocks(surface_id)
  WHERE surface_id IS NOT NULL;

INSERT OR IGNORE INTO learning_surfaces
  (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at)
SELECT
  'lsm_lb_' || b.id,
  b.lesson_id,
  'lesson_block',
  b.id,
  json_object(
    'rendererId', 'html_courseware',
    'source', json_object(
      'kind',
      CASE
        WHEN json_extract(b.content_json, '$.coursewareUuid') IS NOT NULL THEN 'courseware'
        ELSE 'resource'
      END,
      'id',
      COALESCE(
        json_extract(b.content_json, '$.coursewareUuid'),
        json_extract(b.content_json, '$.resourceId')
      )
    ),
    'config', json_object('title', NULLIF(json_extract(b.content_json, '$.title'), ''))
  ),
  NULL,
  b.created_at,
  b.updated_at
FROM lesson_activity_blocks b
WHERE b.block_type = 'interactive_courseware'
  AND json_valid(b.content_json)
  AND (
    json_extract(b.content_json, '$.coursewareUuid') IS NOT NULL
    OR json_extract(b.content_json, '$.resourceId') IS NOT NULL
  );

UPDATE lesson_activity_blocks
SET surface_id = 'lsm_lb_' || id
WHERE block_type = 'interactive_courseware'
  AND id IN (SELECT owner_id FROM learning_surfaces WHERE kind = 'lesson_block');

-- DOWN
UPDATE lesson_activity_blocks SET surface_id = NULL WHERE surface_id LIKE 'lsm_lb_%';
DELETE FROM learning_surfaces WHERE kind = 'lesson_block';
DROP INDEX IF EXISTS idx_lesson_activity_blocks_surface;
ALTER TABLE lesson_activity_blocks DROP COLUMN surface_id;
