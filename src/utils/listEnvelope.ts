/**
 * A7 分页信封取值助手。
 *
 * 集合级列表端点（/api/lessons、/api/students、/api/classes、/api/schedules、
 * /api/courseware/attempts）响应已统一为 `{ data, total, page, pageSize }` 信封；
 * 本助手兼容两种形状（信封 / 裸数组），防漏改消费点时 undefined 崩溃。
 */
export function listFromEnvelope<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === 'object' && Array.isArray((body as any).data)) {
    return (body as any).data as T[];
  }
  return [];
}
