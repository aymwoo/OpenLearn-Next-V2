-- UP
-- 021_class_owner_and_password_gate.sql
-- 班级归属：教师只能管理 owner_user_id 指向自己的班级；历史空值仅管理员可访问，需回填。
-- 种子账号：must_change_password=1 时，除改密/登出/会话查询外的 API（含 GET）一律拒绝。

ALTER TABLE classes ADD COLUMN owner_user_id TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- DOWN
ALTER TABLE classes DROP COLUMN owner_user_id;
ALTER TABLE users DROP COLUMN must_change_password;
