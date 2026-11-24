-- UP
-- 071_lesson_mode_pack.sql
--
-- 课时级 Mode Pack 绑定。
--
-- delivery_mode（069）是封闭枚举 whiteboard|xuean，无法表达第三方插件贡献的
-- 模式包。mode_pack_id 存 `contributes['mode.pack'].id`，读取时优先于
-- delivery_mode；NULL 表示旧课，按 delivery_mode 回落（最终白板兜底）。
--
-- 仅做加法迁移，旧代码可继续忽略新列。

ALTER TABLE lessons ADD COLUMN mode_pack_id TEXT;

-- DOWN
ALTER TABLE lessons DROP COLUMN mode_pack_id;
