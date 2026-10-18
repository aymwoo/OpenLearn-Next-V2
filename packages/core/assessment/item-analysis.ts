/**
 * 测评项分析：难度与区分度（Issue #184，父 #124）。
 *
 * ## 口径
 *
 * - **难度 (p 值)** = 该题已判分作答的平均得分 / 该题满分，范围 0–1。
 *   越大越容易（1 = 全员满分）。
 * - **区分度** = 题目得分与该考生**剩余卷面分**（总分减去本题得分）的 Pearson 相关。
 *   使用剩余分而不是总分，避免「题目本身贡献总分」把相关系数虚高（part-whole inflation）。
 *   对二分题（全对/全错）这一口径等价于点二列相关。
 *
 * ## 退化规则（不输出臆造值）
 *
 * - 无已判分作答（`sampleSize = 0`）→ `difficulty = null`。
 * - 样本量小于 {@link DEFAULT_MIN_SAMPLE_SIZE} → 区分度一律 `null`（小样本相关不可信）。
 * - 题目得分方差为 0（全对/全错/全部同分）或剩余分方差为 0 → 区分度 `null`。
 * - 任何非法输入（NaN / 负分 / 超过满分）在入参侧不修正，但相关系数计算会因方差为 0 或
 *   样本不足自然退化；调用方（AssessmentService）只喂数据库里已判分的分数。
 *
 * 本模块是**纯函数**，不访问数据库、不依赖评分引擎，便于单独测试。
 */

export const DEFAULT_MIN_SAMPLE_SIZE = 5;

export type DiscriminationLevel = 'high' | 'medium' | 'low';

export interface ItemAnalysisItem {
  id: string;
  type: string;
  maxScore: number;
  sortOrder?: number;
}

export interface ItemAnalysisAttempt {
  /** 卷面总分（服务端已判分/重算后的 `assessment_attempts.score`）。 */
  totalScore: number;
  /** itemId → 该题得分；未作答或待人工批改为 null/undefined。 */
  scores: Record<string, number | null | undefined>;
}

export interface ItemAnalysisOptions {
  /** 低于该样本量不计算区分度（默认 5）。 */
  minSampleSize?: number;
}

export interface ItemAnalysisRow {
  itemId: string;
  order: number;
  type: string;
  maxScore: number;
  /** 有作答记录（无论是否已判分）的 attempt 数。 */
  answered: number;
  /** 已判分（score 是数字）的 attempt 数。 */
  sampleSize: number;
  meanScore: number | null;
  difficulty: number | null;
  discrimination: number | null;
  discriminationLevel: DiscriminationLevel | null;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
}

/**
 * Pearson 相关系数；任一序列方差为 0 或长度 < 2 时返回 null（不产生 NaN）。
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const vx = variance(xs);
  const vy = variance(ys);
  if (vx === 0 || vy === 0) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let covariance = 0;
  for (let i = 0; i < xs.length; i += 1) covariance += (xs[i] - mx) * (ys[i] - my);
  covariance /= xs.length;
  return covariance / Math.sqrt(vx * vy);
}

/** 区分度分级：|r| ≥ 0.4 高，≥ 0.2 中，其余低；`null` 保持 `null`。 */
export function discriminationLevelOf(r: number | null): DiscriminationLevel | null {
  if (r === null || !Number.isFinite(r)) return null;
  const abs = Math.abs(r);
  if (abs >= 0.4) return 'high';
  if (abs >= 0.2) return 'medium';
  return 'low';
}

/**
 * 计算整卷的逐题难度/区分度。
 *
 * @param items 试卷题目（按 `sortOrder` 排序输出）
 * @param attempts 已提交/已判分的作答（in_progress 不应传入）
 */
export function computeItemAnalysis(
  items: readonly ItemAnalysisItem[],
  attempts: readonly ItemAnalysisAttempt[],
  options: ItemAnalysisOptions = {},
): ItemAnalysisRow[] {
  const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
  const ordered = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return ordered.map((item, index) => {
    const graded = attempts
      .map((attempt) => {
        const raw = attempt.scores[item.id];
        if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
        return { itemScore: raw, restScore: attempt.totalScore - raw };
      })
      .filter((row): row is { itemScore: number; restScore: number } => row !== null);

    // 「作答」指存在作答记录（即使尚未判分，score 为 null）。
    const answered = attempts.filter((attempt) => attempt.scores[item.id] !== undefined).length;

    const itemScores = graded.map((row) => row.itemScore);
    const meanScore = itemScores.length > 0 ? round(mean(itemScores)) : null;
    const difficulty =
      meanScore !== null && item.maxScore > 0 ? round(Math.min(1, Math.max(0, meanScore / item.maxScore))) : null;

    let discrimination: number | null = null;
    if (graded.length >= minSampleSize) {
      const r = pearsonCorrelation(
        itemScores,
        graded.map((row) => row.restScore),
      );
      discrimination = r === null ? null : round(r);
    }

    return {
      itemId: item.id,
      order: index,
      type: item.type,
      maxScore: item.maxScore,
      answered,
      sampleSize: graded.length,
      meanScore,
      difficulty,
      discrimination,
      discriminationLevel: discriminationLevelOf(discrimination),
    };
  });
}

/** 导出用的稳定列序（CSV/XLSX 共用）。 */
export const ITEM_ANALYSIS_COLUMNS = [
  { key: 'order', label: '题号' },
  { key: 'type', label: '题型' },
  { key: 'maxScore', label: '满分' },
  { key: 'answered', label: '作答人数' },
  { key: 'sampleSize', label: '已判分样本' },
  { key: 'meanScore', label: '平均得分' },
  { key: 'difficulty', label: '难度 (p)' },
  { key: 'discrimination', label: '区分度 (r)' },
  { key: 'discriminationLevel', label: '区分度等级' },
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 项分析 CSV（UTF-8 文本，BOM 由路由层补）。 */
export function toItemAnalysisCsv(rows: readonly ItemAnalysisRow[]): string {
  const header = ITEM_ANALYSIS_COLUMNS.map((column) => csvCell(column.label)).join(',');
  const lines = rows.map((row) => {
    const cells = ITEM_ANALYSIS_COLUMNS.map((column) => {
      if (column.key === 'order') return csvCell(row.order + 1);
      const value = row[column.key as keyof ItemAnalysisRow];
      if (column.key === 'discriminationLevel' && value === null) return '';
      return csvCell(value);
    });
    return cells.join(',');
  });
  return [header, ...lines].join('\n');
}
