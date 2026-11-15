import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { isValidPluginId } from './community-registry.js';

export type CommunityFeedbackDbLike = Pick<Database.Database, 'prepare' | 'transaction'>;

export interface CommunityPluginFeedbackSummary {
  starCount: number;
  starred: boolean;
  reviewCount: number;
  averageRating: number | null;
  myRating: number | null;
}

export interface CommunityPluginReview {
  id: string;
  pluginId: string;
  userId: string;
  authorName: string;
  authorRole: string;
  rating: number;
  comment: string;
  pluginVersion: string | null;
  createdAt: number;
  updatedAt: number;
  isOwn: boolean;
}

export class CommunityFeedbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommunityFeedbackError';
  }
}

const MAX_COMMENT_LENGTH = 1000;
const MAX_VERSION_LENGTH = 64;

function emptySummary(): CommunityPluginFeedbackSummary {
  return {
    starCount: 0,
    starred: false,
    reviewCount: 0,
    averageRating: null,
    myRating: null,
  };
}

function assertValidPluginId(pluginId: string): string {
  const trimmed = typeof pluginId === 'string' ? pluginId.trim() : '';
  if (!trimmed || !isValidPluginId(trimmed)) {
    throw new CommunityFeedbackError('插件 ID 格式非法');
  }
  return trimmed;
}

function normalizeRating(rating: unknown): number {
  const num = typeof rating === 'number' ? rating : typeof rating === 'string' ? Number(rating) : NaN;
  if (!Number.isInteger(num) || num < 1 || num > 5) {
    throw new CommunityFeedbackError('评分必须是 1 到 5 之间的整数');
  }
  return num;
}

function normalizeComment(comment: unknown): string {
  if (comment === undefined || comment === null) return '';
  if (typeof comment !== 'string') {
    throw new CommunityFeedbackError('评价内容必须是字符串');
  }
  const trimmed = comment.trim();
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new CommunityFeedbackError(`评价内容不能超过 ${MAX_COMMENT_LENGTH} 个字符`);
  }
  return trimmed;
}

function normalizePluginVersion(version: unknown): string | null {
  if (version === undefined || version === null) return null;
  if (typeof version !== 'string') return null;
  const trimmed = version.trim();
  return trimmed ? trimmed.slice(0, MAX_VERSION_LENGTH) : null;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function roundAverage(avg: number | null): number | null {
  if (avg === null || !Number.isFinite(avg)) return null;
  return Math.round(avg * 10) / 10;
}

/**
 * 批量读取多个社区插件的标星与评价聚合摘要。
 * 数据库表尚未迁移时优雅降级为空摘要，保证旧环境/部分测试库不会中断市场加载。
 */
export function getFeedbackSummaries(
  db: CommunityFeedbackDbLike,
  pluginIds: readonly string[],
  userId: string | null,
): Map<string, CommunityPluginFeedbackSummary> {
  const result = new Map<string, CommunityPluginFeedbackSummary>();
  const uniqueIds = Array.from(new Set(pluginIds.filter((id) => isValidPluginId(id))));
  for (const id of uniqueIds) result.set(id, emptySummary());
  if (uniqueIds.length === 0) return result;

  const inClause = placeholders(uniqueIds.length);
  try {
    const starRows = db
      .prepare(
        `SELECT plugin_id, COUNT(*) AS cnt FROM community_plugin_stars WHERE plugin_id IN (${inClause}) GROUP BY plugin_id`,
      )
      .all(...uniqueIds) as Array<{ plugin_id: string; cnt: number }>;
    for (const row of starRows) {
      const target = result.get(row.plugin_id);
      if (target) target.starCount = Number(row.cnt) || 0;
    }

    const reviewRows = db
      .prepare(
        `SELECT plugin_id, COUNT(*) AS cnt, AVG(rating) AS avg_rating
         FROM community_plugin_reviews
         WHERE plugin_id IN (${inClause})
         GROUP BY plugin_id`,
      )
      .all(...uniqueIds) as Array<{ plugin_id: string; cnt: number; avg_rating: number | null }>;
    for (const row of reviewRows) {
      const target = result.get(row.plugin_id);
      if (target) {
        target.reviewCount = Number(row.cnt) || 0;
        target.averageRating = target.reviewCount > 0 ? roundAverage(row.avg_rating) : null;
      }
    }

    if (userId) {
      const myStars = db
        .prepare(`SELECT plugin_id FROM community_plugin_stars WHERE user_id = ? AND plugin_id IN (${inClause})`)
        .all(userId, ...uniqueIds) as Array<{ plugin_id: string }>;
      for (const row of myStars) {
        const target = result.get(row.plugin_id);
        if (target) target.starred = true;
      }

      const myReviews = db
        .prepare(
          `SELECT plugin_id, rating FROM community_plugin_reviews WHERE user_id = ? AND plugin_id IN (${inClause})`,
        )
        .all(userId, ...uniqueIds) as Array<{ plugin_id: string; rating: number }>;
      for (const row of myReviews) {
        const target = result.get(row.plugin_id);
        if (target) target.myRating = Number(row.rating);
      }
    }
  } catch {
    return result;
  }

  return result;
}

export function togglePluginStar(
  db: CommunityFeedbackDbLike,
  rawPluginId: string,
  userId: string,
  desired?: boolean,
): { pluginId: string; starred: boolean; starCount: number } {
  const pluginId = assertValidPluginId(rawPluginId);
  const runToggle = db.transaction(() => {
    const existing = db
      .prepare('SELECT 1 FROM community_plugin_stars WHERE plugin_id = ? AND user_id = ?')
      .get(pluginId, userId);
    const shouldStar = typeof desired === 'boolean' ? desired : !existing;

    if (shouldStar && !existing) {
      db.prepare('INSERT INTO community_plugin_stars (plugin_id, user_id, created_at) VALUES (?, ?, ?)').run(
        pluginId,
        userId,
        Date.now(),
      );
    } else if (!shouldStar && existing) {
      db.prepare('DELETE FROM community_plugin_stars WHERE plugin_id = ? AND user_id = ?').run(pluginId, userId);
    }

    const row = db.prepare('SELECT COUNT(*) AS cnt FROM community_plugin_stars WHERE plugin_id = ?').get(pluginId) as
      { cnt: number } | undefined;
    return {
      pluginId,
      starred: shouldStar,
      starCount: Number(row?.cnt) || 0,
    };
  });

  return runToggle();
}

export function listPluginReviews(
  db: CommunityFeedbackDbLike,
  rawPluginId: string,
  currentUserId: string | null,
): { pluginId: string; summary: CommunityPluginFeedbackSummary; reviews: CommunityPluginReview[] } {
  const pluginId = assertValidPluginId(rawPluginId);
  const summary = getFeedbackSummaries(db, [pluginId], currentUserId).get(pluginId) ?? emptySummary();

  const rows = db
    .prepare(
      `SELECT r.id, r.plugin_id, r.user_id, r.rating, r.comment, r.plugin_version, r.created_at, r.updated_at,
              COALESCE(NULLIF(TRIM(u.name), ''), u.username, '用户') AS author_name,
              COALESCE(u.role, 'teacher') AS author_role
       FROM community_plugin_reviews r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.plugin_id = ?
       ORDER BY CASE WHEN r.user_id = ? THEN 0 ELSE 1 END, r.updated_at DESC`,
    )
    .all(pluginId, currentUserId ?? '') as Array<{
    id: string;
    plugin_id: string;
    user_id: string;
    rating: number;
    comment: string;
    plugin_version: string | null;
    created_at: number;
    updated_at: number;
    author_name: string;
    author_role: string;
  }>;

  const reviews: CommunityPluginReview[] = rows.map((row) => ({
    id: row.id,
    pluginId: row.plugin_id,
    userId: row.user_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    rating: Number(row.rating),
    comment: row.comment ?? '',
    pluginVersion: row.plugin_version ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    isOwn: Boolean(currentUserId && row.user_id === currentUserId),
  }));

  return { pluginId, summary, reviews };
}

export function upsertPluginReview(
  db: CommunityFeedbackDbLike,
  params: {
    pluginId: string;
    userId: string;
    rating: unknown;
    comment?: unknown;
    pluginVersion?: unknown;
  },
): { pluginId: string; summary: CommunityPluginFeedbackSummary; review: CommunityPluginReview } {
  const pluginId = assertValidPluginId(params.pluginId);
  const rating = normalizeRating(params.rating);
  const comment = normalizeComment(params.comment);
  const pluginVersion = normalizePluginVersion(params.pluginVersion);
  const now = Date.now();

  const runUpsert = db.transaction(() => {
    const existing = db
      .prepare('SELECT id, created_at FROM community_plugin_reviews WHERE plugin_id = ? AND user_id = ?')
      .get(pluginId, params.userId) as { id: string; created_at: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE community_plugin_reviews
         SET rating = ?, comment = ?, plugin_version = ?, updated_at = ?
         WHERE id = ?`,
      ).run(rating, comment, pluginVersion, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO community_plugin_reviews (id, plugin_id, user_id, rating, comment, plugin_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), pluginId, params.userId, rating, comment, pluginVersion, now, now);
    }
  });

  runUpsert();

  const listing = listPluginReviews(db, pluginId, params.userId);
  const own = listing.reviews.find((r) => r.isOwn);
  if (!own) {
    throw new Error('保存评价后读取失败');
  }
  return { pluginId, summary: listing.summary, review: own };
}

export function deletePluginReview(
  db: CommunityFeedbackDbLike,
  rawPluginId: string,
  userId: string,
): { pluginId: string; deleted: boolean; summary: CommunityPluginFeedbackSummary } {
  const pluginId = assertValidPluginId(rawPluginId);
  const res = db
    .prepare('DELETE FROM community_plugin_reviews WHERE plugin_id = ? AND user_id = ?')
    .run(pluginId, userId);
  const summary = getFeedbackSummaries(db, [pluginId], userId).get(pluginId) ?? emptySummary();
  return { pluginId, deleted: (res.changes ?? 0) > 0, summary };
}
