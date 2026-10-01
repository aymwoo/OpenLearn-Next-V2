/**
 * 列表端点分页参数解析（A7）。
 *
 * 统一约定：
 *   - `page`：默认 1，最小 1；
 *   - `pageSize`：默认 50，数字时 clamp 1..500；特殊值 'all' 返回全量（LIMIT -1）；
 *   - 响应信封统一为 `{ data, total, page, pageSize }`（isAll 时 pageSize = total）。
 * 不带任何分页参数时同样返回信封（page=1, pageSize=50）—— 与历史裸数组行为
 * 不兼容，属约定变更（见 CHANGELOG Breaking Changes）。
 */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
  isAll: boolean;
}

export function parsePagination(query: Record<string, unknown>): Pagination {
  const rawPage = Number(query.page);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  if (String(query.pageSize ?? '').toLowerCase() === 'all') {
    return { page: 1, pageSize: -1, offset: 0, isAll: true };
  }

  const rawSize = Number(query.pageSize);
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  return { page, pageSize, offset: (page - 1) * pageSize, isAll: false };
}
