/**
 * Cursor-based pagination helpers
 *
 * All list endpoints use cursor pagination (not offset) for consistent,
 * feed-safe results even when new rows are inserted between pages.
 */

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Build a paginated result from a raw array.
 * The caller passes one extra item beyond `limit`; if it exists, there is a next page.
 *
 * Usage:
 *   const rows = await db.query(limit + 1, cursor);
 *   return paginate(rows, limit, (row) => row.created_at);
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  getCursor: (row: T) => string,
): PaginatedResult<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? getCursor(lastItem) : null;
  return { items, nextCursor };
}
