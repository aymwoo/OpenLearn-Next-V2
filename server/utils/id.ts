/**
 * 安全 ID 生成（Phase B3 / 路线图 B3）。
 *
 * `Math.random().toString(36)` 是可预测的 PRNG，生成的资源 ID（班级/学生/课表/
 * 投票/互评等主键）存在枚举与碰撞伪造风险，统一改为 crypto 随机源。
 * 保留原「短前缀 + 随机串」风格：8 字节 hex（16 字符），TEXT 主键无宽度约束。
 */
import crypto from 'crypto';

/** prefix + 8 字节加密随机 hex；prefix 传空则纯随机串 */
export function randomId(prefix = ''): string {
  return prefix + crypto.randomBytes(8).toString('hex');
}
