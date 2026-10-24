/**
 * check-file-permissions.ts — 部署后权限基线检查（Issue #233）。
 *
 * 用法：pnpm ops:check-perms
 * 输出不符合基线的敏感文件清单；有违规时退出码 1，可挂进部署流水线。
 */
import { checkSensitiveFilePermissions } from '../server/security/file-permissions.js';

const issues = checkSensitiveFilePermissions();

if (issues.length === 0) {
  console.log('[check-perms] OK：.env / 主库 / 备份快照 / 加密密钥权限均不宽于基线（600/700）。');
  process.exit(0);
}

console.error(`[check-perms] 发现 ${issues.length} 个敏感文件权限宽于基线：`);
for (const i of issues) {
  console.error(`  ${i.path} → ${i.mode.toString(8)}（期望 ≤${i.expected}，${i.kind}）`);
}
console.error('修复：chmod 600 <file> / chmod 700 <dir>；详见 docs/administrator-guide/admin-manual.md。');
process.exit(1);
