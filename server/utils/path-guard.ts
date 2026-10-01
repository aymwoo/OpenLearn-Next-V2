/**
 * 路径安全守卫（SEC-LOW-01）
 *
 * 裸前缀判断 `target.startsWith(root)` 有同级目录逃逸：root=/a/b 时
 * /a/b2/c 也通过 startsWith。统一改用「root 补尾分隔符后的严格前缀」判定。
 * 正确惯例原本散落在 assignment-hub.ts（rootWithSep）与
 * security_hardening.test.ts 的断言中，此处收敛为公共工具。
 */
import path from 'path';

/**
 * target resolve 后是否严格位于 root 内部。
 * target === root 亦返回 false（防 root 目录本身被写/读）。
 */
export function isPathInsideRoot(root: string, target: string): boolean {
  if (!root || !target) return false;
  const rootWithSep = path.resolve(root) + path.sep;
  return path.resolve(target).startsWith(rootWithSep);
}

/**
 * 便捷封装：resolve(root, relative) 后走 isPathInsideRoot。
 * 越界（含 relative 为绝对路径、包含 .. 逃逸到 root 之外）返回 null，
 * 调用方应拒绝请求而非静默降级。
 */
export function safeJoin(root: string, relative: string): string | null {
  if (!root || !relative) return null;
  const target = path.resolve(root, relative);
  return isPathInsideRoot(root, target) ? target : null;
}
