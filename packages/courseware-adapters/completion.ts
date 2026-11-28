/**
 * 完成度口径归一。
 *
 * 历史问题：桥接 `LMS.submit` 默认写 `completion: 1.0`（0~1 比率），
 * 服务端校验区间却是 `[0, 100]`，学习面与部分课件又按百分数上报（85）。
 * 于是同一列里混入 0.85 与 85，前端统一按 `completion * 100` 展示时
 * 出现 8500% 的脏数据，自动录入门槛（0~1）也被绕过。
 *
 * 本模块把「入库前」的完成度统一收敛为 0~1 比率：
 * - 0~1：视为比率，原样保留；
 * - 1~100：视为百分数，除以 100；
 * - >100：截断为 1；
 * - 负数：截断为 0；
 * - 布尔 true/false：1 / 0；
 * - 带 `%` 的字符串：按百分数处理。
 *
 * 返回 null 表示「没有可用完成度」，调用方不得兜底成 0 或 1。
 */
export function normalizeCompletionRatio(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;

  let num: number;
  let isPercent = false;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.endsWith('%')) {
      isPercent = true;
      num = Number(trimmed.slice(0, -1).trim());
    } else {
      num = Number(trimmed);
    }
  } else {
    return null;
  }

  if (!Number.isFinite(num)) return null;
  const ratio = isPercent ? num / 100 : num > 1 && num <= 100 ? num / 100 : num;
  const clamped = Math.max(0, Math.min(1, ratio));
  // 保留 4 位小数，避免 1/3 之类的浮点长尾进入数据库与前端展示
  return Math.round(clamped * 10000) / 10000;
}

/** 读取时兼容历史脏数据（>1 视为百分数），用于列表/详情投影。 */
export function normalizeCompletionForDisplay(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1 && value <= 100) {
    return Math.round((value / 100) * 10000) / 10000;
  }
  return normalizeCompletionRatio(value);
}
