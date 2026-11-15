-- UP
-- 054_user_onboarding_tour_status.sql
-- Issue #530：按账号持久化管理员新手引导向导（HelpTour）状态，避免跳过/完成后
-- 在刷新、重登（含开启 Clear-Site-Data）或更换设备后反复强制弹出，同时保证不同账号状态隔离。
-- tour_status: NULL 表示待引导（pending）；'completed' 表示已完成；'skipped' 表示已跳过。

ALTER TABLE users ADD COLUMN tour_status TEXT;

-- DOWN
ALTER TABLE users DROP COLUMN tour_status;
