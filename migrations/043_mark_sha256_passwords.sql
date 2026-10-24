-- UP
-- Issue #227：users 表里仍可能存在**无盐 SHA-256** 的口令摘要 ——
-- 由 builtin.user 插件命令的 user.create / user.update 写入（现已改用 bcrypt）。
--
-- SHA-256 是快速哈希，没有盐也没有工作因子：库一旦泄露（备份文件 / SQLite 文件
-- 被拷走），这些口令的爆破成本几乎为零。与 bcrypt 账号混在同一张表里，
-- 排查时也容易误以为全库都是 bcrypt。
--
-- 存量行无法反推原口令（无盐哈希不可逆），只能重置：
--   把它们的 must_change_password 置 1 —— 复用平台既有的强制改密机制
--   （enforcePasswordChanged 中间件 + 前端改密页）。
--   顺带一提：staff 登录时 verifyPassword 命中旧 SHA-256 会**自动升级**为 bcrypt，
--   因此这批账号在首次登录后即变成 bcrypt 摘要。
--
-- 判定条件：64 位纯小写十六进制（bcrypt 摘要以 $2 开头，天然不匹配）。
UPDATE users
   SET must_change_password = 1
 WHERE password_hash IS NOT NULL
   AND length(password_hash) = 64
   AND password_hash NOT GLOB '*[^0-9a-f]*';

-- DOWN
-- 回滚只能把「看起来像 SHA-256 的行」的强制改密标记清掉 ——
-- 但其中一部分在迁移前就已经是 must_change_password = 1（种子账号默认口令等），
-- 因此本 DOWN 是**有损的**：无法区分「本次标记的」与「本来就有的」。
-- 真正的回退口径应是重新设置这些账号的口令，而不是恢复标记位。
UPDATE users
   SET must_change_password = 0
 WHERE password_hash IS NOT NULL
   AND length(password_hash) = 64
   AND password_hash NOT GLOB '*[^0-9a-f]*';
