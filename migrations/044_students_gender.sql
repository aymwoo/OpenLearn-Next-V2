-- UP
-- 学生性别：课堂「学生专注力监控」头像按性别渲染（男 / 女），未设置走中性人像。
-- 取值约定：'male' | 'female'；NULL = 未设置 —— 历史数据全部为空，由教师新建/编辑时补录。
ALTER TABLE students ADD COLUMN gender TEXT;

-- DOWN
-- 回滚丢弃该列：性别只是展示用途，没有下游业务依赖它。
ALTER TABLE students DROP COLUMN gender;
