/**
 * 匿名问卷的身份模型（Issue #100 讨论结论 Q7 = a）。
 *
 * 矛盾：既要"同一学生只能交一次"，又要"不暴露是谁交的"。
 *
 * 解法：`anon_key = HMAC-SHA256(服务端密钥, `${assignmentId}:${studentId}`)`
 * - `assessment_attempts.student_id` 写 NULL，只存 anon_key；
 * - 同一学生重复进入会算出同一个 key → 被唯一索引挡住（防刷票 / 防重复提交）；
 * - 教师端响应不返回 anon_key，只给"已答 N 份"；
 * - 只有管理员可以通过显式的反查端点定位（必须写审计日志，见 service 层）。
 *
 * 密钥来源：复用仓库既有的 `storage/encryption-key`（与 `class-passcode-crypto` 同源），
 * 由调用方注入，本模块保持纯函数、不读文件、不读 env。
 */
import { createHmac } from 'node:crypto';

/** 派生匿名去重键（hex，64 字符）。`secret` 为空时抛错，绝不退化成可预测值。 */
export function deriveAnonKey(secret: string | null | undefined, assignmentId: string, studentId: string): string {
  if (!secret) throw new Error('[assessment] anonymous surveys require a server secret');
  if (!assignmentId) throw new Error('[assessment] assignmentId is required to derive anon key');
  if (!studentId) throw new Error('[assessment] studentId is required to derive anon key');
  return createHmac('sha256', secret).update(`${assignmentId}:${studentId}`).digest('hex');
}

/**
 * 匿名作答在导出/统计里的展示名。
 *
 * 用去重键前缀做稳定编号（同一份问卷里同一个人始终是「匿名 3」），
 * 前缀长度取 6 位足够区分，同时不泄露完整 key。
 */
export function anonymousLabel(anonKey: string, index?: number): string {
  if (typeof index === 'number') return `匿名 ${index + 1}`;
  return `匿名 ${anonKey.slice(0, 6)}`;
}

/** 匿名尝试是否可被当前角色看到身份。仅管理员反查路径返回 true。 */
export function canRevealAnonymousIdentity(role: string | undefined | null): boolean {
  return role === 'administrator' || role === 'admin';
}
