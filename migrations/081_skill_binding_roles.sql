-- UP
-- 081_skill_binding_roles.sql
-- Skill 绑定角色维度：roles_json 为该绑定允许的角色集合（NULL = 跟随技能声明）。
--
-- 语义：绑定只能「收窄」技能声明的 roles，不能扩大；最终角色 =
-- 技能声明 roles ∩ binding.roles。空数组表示该范围内无人可用（fail-closed）。

ALTER TABLE skill_bindings ADD COLUMN roles_json TEXT;

-- DOWN
ALTER TABLE skill_bindings DROP COLUMN roles_json;
