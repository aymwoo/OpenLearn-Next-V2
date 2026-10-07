-- UP
-- 018_processes_plugin_owner.sql
-- 审计项 B-5：processes 表补 plugin_id，让后台任务的归属可判定。
--
-- 背景：ProcessManager.spawn / registerInterval 把任务写进全局 processes 表，
-- 且 processId 经全局事件总线 `process.spawned` 广播（任意插件可订阅拿到）。
-- 但 kill(processId) 只按 id UPDATE、无归属校验 —— 插件可以杀掉他人后台任务。
-- 没有 plugin_id 列就无法判定归属，只能靠内存 Map（重启即丢，且 restore()
-- 从 DB 重建的任务会失去归属信息），故落成列。
--
-- 历史行为：存量行的 plugin_id 为 NULL，表示「非插件进程」（内核自身任务）。
-- kill 校验对 NULL 的处理见 context-builder.wrapProcessManager 的 isOwnProcess：
-- 查不到归属时不拦截，避免误杀内核任务与存量行。

ALTER TABLE processes ADD COLUMN plugin_id TEXT;

-- 归属查询的热路径：按 owner 列出其全部进程
CREATE INDEX IF NOT EXISTS idx_processes_plugin_id ON processes(plugin_id);

-- 按 owner + 状态筛选（restore 只需处理 running，但内核自身任务 owner 为 NULL）
CREATE INDEX IF NOT EXISTS idx_processes_plugin_status ON processes(plugin_id, status);
-- DOWN
DROP INDEX IF EXISTS idx_processes_plugin_status;
DROP INDEX IF EXISTS idx_processes_plugin_id;
-- SQLite 3.35+ 支持 DROP COLUMN；旧版走表重建兜底由 migrate 层处理
ALTER TABLE processes DROP COLUMN plugin_id;
