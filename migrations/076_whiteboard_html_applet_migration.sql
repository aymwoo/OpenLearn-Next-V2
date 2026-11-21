-- UP
-- 076_whiteboard_html_applet_migration.sql
--
-- 阶段 5：存量白板 `html-applet` 迁移为 `learning_surface` 元素 + Surface。
--
-- 映射规则（与 CoursewareHost 的来源优先级一致）：
--   coursewareUuid → rendererId='html_courseware', source.kind='courseware'
--   resourceId     → rendererId='html_courseware', source.kind='resource'
--   code（手写 HTML）→ 先幂等落到 system_resources（type='html'），再按 courseware 引用
--
-- 迁移只改元素类型与 data，保留 x/y/width/height/page/segmentId 等几何字段；
-- 元素 id 不变，因此分页、层级、协同与快照恢复都不受影响。
--
-- 内联 HTML 说明：SQLite 侧没有 sha256 函数，无法复刻 `inline-<sha16>` 的命名。
-- 这里按「同内容只存一份」插入 `inline-mig-*`；已有同内容记录时直接复用。

-- 1) 内联 HTML 落库（同一段 code 只写一条）
INSERT INTO system_resources (id, name, type, content, created_at)
SELECT
  'inline-mig-' || lower(hex(randomblob(8))),
  'index.html',
  'html',
  src.code,
  src.created_at
FROM (
  SELECT
    json_extract(data, '$.code') AS code,
    MIN(created_at) AS created_at
  FROM whiteboard_elements
  WHERE type = 'html-applet'
    AND json_valid(data)
    AND json_extract(data, '$.coursewareUuid') IS NULL
    AND json_extract(data, '$.resourceId') IS NULL
    AND json_extract(data, '$.code') IS NOT NULL
    AND length(trim(json_extract(data, '$.code'))) > 0
  GROUP BY json_extract(data, '$.code')
) AS src
WHERE NOT EXISTS (
  SELECT 1 FROM system_resources sr WHERE sr.type = 'html' AND sr.content = src.code
);

-- 2) 为每个可迁移的 html-applet 元素建 Surface
INSERT OR IGNORE INTO learning_surfaces
  (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at)
SELECT
  'lsm_wb_' || we.id,
  we.lesson_id,
  'whiteboard_element',
  we.id,
  json_object(
    'rendererId', 'html_courseware',
    'source', json_object(
      'kind',
      CASE
        WHEN json_extract(we.data, '$.coursewareUuid') IS NOT NULL THEN 'courseware'
        WHEN json_extract(we.data, '$.resourceId') IS NOT NULL THEN 'resource'
        ELSE 'courseware'
      END,
      'id',
      COALESCE(
        json_extract(we.data, '$.coursewareUuid'),
        json_extract(we.data, '$.resourceId'),
        (
          SELECT sr.id FROM system_resources sr
          WHERE sr.type = 'html' AND sr.content = json_extract(we.data, '$.code')
          ORDER BY sr.created_at ASC
          LIMIT 1
        )
      )
    ),
    'config', json_object('title', NULLIF(json_extract(we.data, '$.title'), ''))
  ),
  NULL,
  we.created_at,
  we.created_at
FROM whiteboard_elements we
WHERE we.type = 'html-applet'
  AND json_valid(we.data)
  AND (
    json_extract(we.data, '$.coursewareUuid') IS NOT NULL
    OR json_extract(we.data, '$.resourceId') IS NOT NULL
    OR (
      json_extract(we.data, '$.code') IS NOT NULL
      AND length(trim(json_extract(we.data, '$.code'))) > 0
    )
  );

-- 3) 元素原地改类型：移除内容正文字段，只保留 surfaceId 与展示配置
UPDATE whiteboard_elements
SET type = 'learning_surface',
    data = json_set(
      json_remove(
        data,
        '$.coursewareUuid',
        '$.resourceId',
        '$.code',
        '$.sourceType',
        '$.sourceId'
      ),
      '$.surfaceId',
      'lsm_wb_' || id
    )
WHERE type = 'html-applet'
  AND json_valid(data)
  AND id IN (SELECT owner_id FROM learning_surfaces WHERE kind = 'whiteboard_element');

-- DOWN
-- 从 Surface 内容引用反序列化回 html-applet；内联资源保留（可能仍被其它数据引用）。
UPDATE whiteboard_elements
SET type = 'html-applet',
    data = json_set(
      json_remove(data, '$.surfaceId'),
      '$.coursewareUuid',
      CASE
        WHEN json_extract(
          (SELECT content_ref_json FROM learning_surfaces WHERE id = json_extract(whiteboard_elements.data, '$.surfaceId')),
          '$.source.kind'
        ) = 'courseware'
        THEN json_extract(
          (SELECT content_ref_json FROM learning_surfaces WHERE id = json_extract(whiteboard_elements.data, '$.surfaceId')),
          '$.source.id'
        )
        ELSE NULL
      END,
      '$.resourceId',
      CASE
        WHEN json_extract(
          (SELECT content_ref_json FROM learning_surfaces WHERE id = json_extract(whiteboard_elements.data, '$.surfaceId')),
          '$.source.kind'
        ) = 'resource'
        THEN json_extract(
          (SELECT content_ref_json FROM learning_surfaces WHERE id = json_extract(whiteboard_elements.data, '$.surfaceId')),
          '$.source.id'
        )
        ELSE NULL
      END,
      '$.title',
      NULLIF(json_extract(
        (SELECT content_ref_json FROM learning_surfaces WHERE id = json_extract(whiteboard_elements.data, '$.surfaceId')),
        '$.config.title'
      ), '')
    )
WHERE type = 'learning_surface'
  AND json_valid(data)
  AND json_extract(data, '$.surfaceId') LIKE 'lsm_wb_%';

DELETE FROM learning_surfaces WHERE kind = 'whiteboard_element';
