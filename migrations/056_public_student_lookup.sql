-- UP
-- 056_public_student_lookup.sql
-- Issue #538：site_settings 表增加 allow_public_student_lookup（默认 1 开启），
-- 控制登录页学生自助端是否允许未登录按姓名/班级公开查询学号。

ALTER TABLE site_settings ADD COLUMN allow_public_student_lookup INTEGER DEFAULT 1;

-- DOWN
ALTER TABLE site_settings DROP COLUMN allow_public_student_lookup;
