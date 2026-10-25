/**
 * check-file-permissions.ts — 部署后权限基线检查（Issue #233）。
 *
 * 用法：
 *   pnpm ops:check-perms          # 只检查；有违规时退出码 1，可挂进部署流水线
 *   pnpm ops:check-perms --fix    # 检查并按基线收紧（文件 600 / 目录 700）
 *
 * `--fix` 会修改文件权限（含用户自己写的 `.env`），属于管理员的显式动作 ——
 * 收紧权限会影响同机其他账号对这些文件的访问。
 */
import { checkSensitiveFilePermissions, fixSensitiveFilePermissions } from '../server/security/file-permissions.js';

const shouldFix = process.argv.includes('--fix');

if (shouldFix) {
  const fixed = fixSensitiveFilePermissions();
  if (fixed.length > 0) {
    console.log(`[check-perms] 已按基线收紧 ${fixed.length} 项：`);
    for (const i of fixed) {
      console.log(`  ${i.path} → ${i.mode.toString(8)} → ${(i.kind === 'backup-dir' ? 0o700 : 0o600).toString(8)}`);
    }
  } else {
    console.log('[check-perms] 无需修复。');
  }
}

const issues = checkSensitiveFilePermissions();

if (issues.length === 0) {
  console.log('[check-perms] OK：.env / 主库 / WAL·SHM 侧车 / 备份快照 / 加密密钥权限均不宽于基线（600/700）。');
  process.exit(0);
}

console.error(`[check-perms] 发现 ${issues.length} 个敏感文件权限宽于基线：`);
for (const i of issues) {
  console.error(`  ${i.path} → ${i.mode.toString(8)}（期望 ≤${i.expected}，${i.kind}）`);
}
console.error(
  '修复：pnpm ops:check-perms --fix（或手工 chmod 600 <file> / chmod 700 <dir>）；详见 docs/administrator-guide/admin-manual.md。',
);
process.exit(1);
