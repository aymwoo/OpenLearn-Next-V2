/**
 * Courseware Score Aggregation (native / platform side)
 * ------------------------------------------------------
 * 互动课件的一次「尝试」往往会产生多次分数样本：
 *   - 学生反复点提交（`LMS.submit` / `OpenLearn.submit`）
 *   - 平台分数变量监视器持续采样（`LMS.saveProgress({ score, watch })`）
 *   - 课件中途记录的事件里带分数（`POST /api/courseware/attempts/:id/log`）
 *
 * 此前宿主只保留「最后一次」分数（`submission_result` 每个 attempt 一行，upsert），
 * 于是「最高分」「平均分」之类的策略完全无从落地。本模块把「按策略归集样本」这件事
 * 收进宿主：`submission_raw`（append-only 原始事件）→ 策略聚合 → `submission_result`
 * （每个 attempt 的官方成绩），使记录层自身闭环，不再依赖任何插件。
 *
 * 策略与满分/权重配置存放于 `courseware_score_config`（见 migrations/004）。
 * 未配置任何行时行为与历史完全一致（取最后一次分数，不做归一化）。
 */

export type ScorePolicy = 'LATEST' | 'MAX' | 'AVERAGE' | 'FIRST';

export const SCORE_POLICIES: ScorePolicy[] = ['LATEST', 'MAX', 'AVERAGE', 'FIRST'];
export const DEFAULT_SCORE_POLICY: ScorePolicy = 'LATEST';
/** 全局默认策略行（课件未单独配置时回落到这一行） */
export const GLOBAL_SCORE_CONFIG_KEY = '*';
export const SCORE_CONFIG_TABLE = 'courseware_score_config';

/** 最小化的 SQLite 接口（兼容 better-sqlite3 / Worker RPC 代理） */
export interface SqliteLike {
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  };
}

export interface CoursewareScoreConfig {
  courseware_id: string;
  courseware_name: string | null;
  score_policy: ScorePolicy;
  score_fields: string;
  raw_full_score: number;
  target_full_score: number;
  weight_percentage: number;
  lesson_id: string | null;
  updated_at: number;
}

export interface ScoreSample {
  value: number;
  at: number;
  eventType: string;
}

export interface ResolvedScoreConfig {
  config: CoursewareScoreConfig;
  /** courseware = 该课件的专属配置；global = 全局默认行；builtin = 无任何配置（行为与历史一致） */
  source: 'courseware' | 'global' | 'builtin';
}

export interface ScoreAggregation {
  policy: ScorePolicy;
  config: CoursewareScoreConfig;
  hasExplicitConfig: boolean;
  samples: number[];
  sampleDetails: ScoreSample[];
  /** 策略聚合后的原始分（未归一化） */
  rawAggregate: number | null;
  /** 归一化到 target_full_score 之后的分 */
  normalized: number | null;
  /** 写入 submission_result.score 的最终分 */
  finalScore: number | null;
  weightPercentage: number;
}

export const DEFAULT_SCORE_CONFIG: CoursewareScoreConfig = {
  courseware_id: GLOBAL_SCORE_CONFIG_KEY,
  courseware_name: null,
  score_policy: DEFAULT_SCORE_POLICY,
  score_fields: '',
  raw_full_score: 100,
  target_full_score: 100,
  weight_percentage: 100,
  lesson_id: null,
  updated_at: 0,
};

/** 无配置时的归集选项（与历史行为一致：取最后一次，不缩放） */
const BUILTIN_SCORE_CONFIG: CoursewareScoreConfig = { ...DEFAULT_SCORE_CONFIG };

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const cleaned = trimmed.endsWith('%') ? trimmed.slice(0, -1).trim() : trimmed;
    if (!cleaned || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 100) / 100;
}

export function isKnownScorePolicy(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return KNOWN_POLICY_ALIASES.has(raw);
}

const KNOWN_POLICY_ALIASES = new Set([
  'LATEST',
  'LAST',
  'LATEST_SCORE',
  '最新',
  '最近',
  'MAX',
  'MAXIMUM',
  'HIGHEST',
  'MAX_SCORE',
  '最高',
  '最高分',
  'AVERAGE',
  'AVG',
  'MEAN',
  '平均',
  '平均分',
  'FIRST',
  'EARLIEST',
  '首个',
  '最早',
]);

export function normalizeScorePolicy(value: unknown): ScorePolicy {
  const raw = typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
  if (['MAX', 'MAXIMUM', 'HIGHEST', 'MAX_SCORE', '最高', '最高分'].includes(raw)) return 'MAX';
  if (['AVERAGE', 'AVG', 'MEAN', '平均', '平均分'].includes(raw)) return 'AVERAGE';
  if (['FIRST', 'EARLIEST', '首个', '最早'].includes(raw)) return 'FIRST';
  // LATEST / LAST / 最新 / 最近 以及任何未知取值都回落到「最后一次」
  return 'LATEST';
}

export function parseScoreFields(fields: unknown): string[] {
  if (Array.isArray(fields)) {
    return fields.map((f) => String(f ?? '').trim()).filter(Boolean);
  }
  if (typeof fields !== 'string' || !fields.trim()) return [];
  return fields
    .split(/[\n\r,，;；|]+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * 按点号路径取值，支持数组下标；中间节点若是 JSON 字符串会自动解析。
 */
export function getNested(raw: any, path: string): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (!path) return undefined;
  const parts = String(path)
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  let cursor: any = raw;
  for (let i = 0; i < parts.length; i += 1) {
    if (cursor === null || cursor === undefined) return undefined;
    const part = parts[i];
    if (/^\d+$/.test(part)) {
      const idx = Number(part);
      cursor = Array.isArray(cursor) ? cursor[idx] : cursor[part];
    } else {
      cursor = cursor[part];
    }
    if (i < parts.length - 1 && typeof cursor === 'string' && /^[[{]/.test(cursor.trim())) {
      try {
        cursor = JSON.parse(cursor);
      } catch (e) {
        /* 保持原值 */
      }
    }
  }
  return cursor;
}

const COMMON_SCORE_KEYS = [
  'score',
  'points',
  'point',
  'grade',
  'mark',
  'correct',
  'right',
  'userScore',
  'totalScore',
  'finalScore',
  'rawScore',
];

const COMMON_SCORE_CONTAINERS = ['data', 'body', 'payload', 'detail', 'summary', 'progress'];

const SCAN_MAX_DEPTH = 4;
const SCAN_MAX_NODES = 300;

/** 有界递归兜底：与 server/routes/courseware.ts 的通用分数抽取保持同一口径 */
function scanForScore(node: any, depth: number, budget: { count: number }): number | null {
  if (node === null || node === undefined) return null;
  budget.count += 1;
  if (budget.count > SCAN_MAX_NODES || depth > SCAN_MAX_DEPTH) return null;

  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (!trimmed) return null;
    if (/^[[{]/.test(trimmed)) {
      try {
        return scanForScore(JSON.parse(trimmed), depth + 1, budget);
      } catch (e) {
        return null;
      }
    }
    const keyValue = /(?:^|[?&\s,;])(?:score|point|points|grade|mark|correct|right)=([+-]?\d+(?:\.\d+)?)/i.exec(trimmed);
    if (keyValue) return Number(keyValue[1]);
    const ratio = /^([+-]?\d+(?:\.\d+)?)\s*\/\s*([+-]?\d+(?:\.\d+)?)$/.exec(trimmed);
    if (ratio) return Number(ratio[1]);
    return null;
  }

  if (typeof node !== 'object') return null;

  for (const key of COMMON_SCORE_KEYS) {
    const value = toNumber((node as any)[key]);
    if (value !== null) return value;
  }
  for (const key of Object.keys(node)) {
    const child = (node as any)[key];
    if (child === null || child === undefined) continue;
    if (typeof child !== 'object' && typeof child !== 'string') continue;
    const value = scanForScore(child, depth + 1, budget);
    if (value !== null) return value;
  }
  return null;
}

/** 按配置的字段路径取分 */
export function extractScoreFromFields(raw: any, fields: unknown): number | null {
  for (const field of parseScoreFields(fields)) {
    const value = toNumber(getNested(raw, field));
    if (value !== null) return value;
  }
  return null;
}

/**
 * 从一条原始事件载荷里取分。
 * 优先使用课件配置的 `score_fields`，否则依次尝试常见键名。
 */
export function pickScoreFromPayload(payload: any, fields?: unknown): number | null {
  const byFields = extractScoreFromFields(payload, fields);
  if (byFields !== null) return byFields;
  if (typeof payload === 'string') return scanForScore(payload, 0, { count: 0 });
  if (payload === null || typeof payload !== 'object') return null;

  for (const key of COMMON_SCORE_KEYS) {
    const value = toNumber(payload[key]);
    if (value !== null) return value;
  }
  for (const container of COMMON_SCORE_CONTAINERS) {
    const nested = payload[container];
    if (nested === null || typeof nested !== 'object') continue;
    for (const key of COMMON_SCORE_KEYS) {
      const value = toNumber(nested[key]);
      if (value !== null) return value;
    }
  }
  return scanForScore(payload, 0, { count: 0 });
}

/** 按策略把原始分样本聚合为一个分值 */
export function aggregateScores(scores: unknown, policy: unknown): number | null {
  const list = (Array.isArray(scores) ? scores : [])
    .map((s) => toNumber(s))
    .filter((n): n is number => n !== null);
  if (list.length === 0) return null;
  const resolved = normalizeScorePolicy(policy);
  if (resolved === 'MAX') return list.reduce((a, b) => (b > a ? b : a), list[0]);
  if (resolved === 'AVERAGE') return list.reduce((a, b) => a + b, 0) / list.length;
  if (resolved === 'FIRST') return list[0];
  return list[list.length - 1];
}

// ---------------------------------------------------------------------------
// 配置读写
// ---------------------------------------------------------------------------

export function normalizeScoreConfig(row: any): CoursewareScoreConfig {
  if (!row || typeof row !== 'object') return { ...BUILTIN_SCORE_CONFIG };
  const positive = (value: unknown, fallback: number): number => {
    const num = toNumber(value);
    return num !== null && num > 0 ? num : fallback;
  };
  const weight = toNumber(row.weight_percentage);
  const updatedAt = toNumber(row.updated_at);
  return {
    courseware_id: String(row.courseware_id ?? GLOBAL_SCORE_CONFIG_KEY),
    courseware_name: row.courseware_name === undefined || row.courseware_name === null ? null : String(row.courseware_name),
    score_policy: normalizeScorePolicy(row.score_policy),
    score_fields: typeof row.score_fields === 'string' ? row.score_fields : '',
    raw_full_score: positive(row.raw_full_score, 100),
    target_full_score: positive(row.target_full_score, 100),
    weight_percentage: weight === null ? 100 : clamp(weight, 0, 1000),
    lesson_id: row.lesson_id === undefined || row.lesson_id === null ? null : String(row.lesson_id),
    updated_at: updatedAt ?? 0,
  };
}

/** 读取生效的课件成绩配置：课件专属 → 全局默认 → 内置默认 */
export function resolveScoreConfig(db: SqliteLike, coursewareId?: string | null): ResolvedScoreConfig {
  const id = coursewareId === null || coursewareId === undefined ? '' : String(coursewareId).trim();
  if (id && id !== GLOBAL_SCORE_CONFIG_KEY) {
    try {
      const row = db
        .prepare(`SELECT * FROM ${SCORE_CONFIG_TABLE} WHERE courseware_id = ?`)
        .get(id) as any;
      if (row) return { config: normalizeScoreConfig(row), source: 'courseware' };
    } catch (e) {
      /* 表尚未迁移时静默回落 */
    }
  }
  try {
    const global = db
      .prepare(`SELECT * FROM ${SCORE_CONFIG_TABLE} WHERE courseware_id = ?`)
      .get(GLOBAL_SCORE_CONFIG_KEY) as any;
    if (global) return { config: normalizeScoreConfig(global), source: 'global' };
  } catch (e) {
    /* 同上 */
  }
  return { config: { ...BUILTIN_SCORE_CONFIG }, source: 'builtin' };
}

export function listScoreConfigs(db: SqliteLike): CoursewareScoreConfig[] {
  try {
    const rows = db
      .prepare(
        `SELECT * FROM ${SCORE_CONFIG_TABLE} ORDER BY CASE WHEN courseware_id = '${GLOBAL_SCORE_CONFIG_KEY}' THEN 0 ELSE 1 END, updated_at DESC`,
      )
      .all() as any[];
    return (rows || []).map(normalizeScoreConfig);
  } catch (e) {
    return [];
  }
}

export interface SaveScoreConfigInput {
  coursewareId?: string;
  courseware_id?: string;
  coursewareName?: string | null;
  courseware_name?: string | null;
  scorePolicy?: string;
  score_policy?: string;
  scoreFields?: string | string[] | null;
  score_fields?: string | string[] | null;
  rawFullScore?: number | string;
  raw_full_score?: number | string;
  targetFullScore?: number | string;
  target_full_score?: number | string;
  weightPercentage?: number | string;
  weight_percentage?: number | string;
  lessonId?: string | null;
  lesson_id?: string | null;
}

function pickInput<T>(input: SaveScoreConfigInput, camel: keyof SaveScoreConfigInput, snake: keyof SaveScoreConfigInput): T | undefined {
  if (input[camel] !== undefined) return input[camel] as unknown as T;
  if (input[snake] !== undefined) return input[snake] as unknown as T;
  return undefined;
}

export function saveScoreConfig(db: SqliteLike, input: SaveScoreConfigInput): CoursewareScoreConfig {
  if (!input || typeof input !== 'object') throw new Error('save_score_config: invalid payload');
  const coursewareId = String(
    pickInput<string>(input, 'coursewareId', 'courseware_id') ?? '',
  ).trim();
  if (!coursewareId) throw new Error('save_score_config: coursewareId is required');
  if (coursewareId.length > 128) throw new Error('save_score_config: coursewareId is too long');

  const policyRaw = pickInput<string | number>(input, 'scorePolicy', 'score_policy');
  if (policyRaw !== undefined && policyRaw !== null && String(policyRaw).trim() !== '' && !isKnownScorePolicy(String(policyRaw))) {
    throw new Error(
      `save_score_config: unknown scorePolicy "${policyRaw}" (expected one of LATEST / MAX / AVERAGE / FIRST)`,
    );
  }

  const fieldsRaw = pickInput<string | string[]>(input, 'scoreFields', 'score_fields');
  const fields = Array.isArray(fieldsRaw) ? parseScoreFields(fieldsRaw).join(',') : parseScoreFields(fieldsRaw ?? '').join(',');
  if (fields.length > 2000) throw new Error('save_score_config: scoreFields is too long');

  const nameRaw = pickInput<string | null>(input, 'coursewareName', 'courseware_name');
  const lessonRaw = pickInput<string | null>(input, 'lessonId', 'lesson_id');

  let existing: CoursewareScoreConfig | null = null;
  try {
    const row = db.prepare(`SELECT * FROM ${SCORE_CONFIG_TABLE} WHERE courseware_id = ?`).get(coursewareId) as any;
    if (row) existing = normalizeScoreConfig(row);
  } catch (e) {
    throw new Error('save_score_config: courseware_score_config table is missing (migration 004 not applied)');
  }

  const rawFull = toNumber(pickInput<string | number>(input, 'rawFullScore', 'raw_full_score'));
  const targetFull = toNumber(pickInput<string | number>(input, 'targetFullScore', 'target_full_score'));
  const weight = toNumber(pickInput<string | number>(input, 'weightPercentage', 'weight_percentage'));

  if (rawFull !== undefined && rawFull !== null && rawFull <= 0) throw new Error('save_score_config: rawFullScore must be > 0');
  if (targetFull !== undefined && targetFull !== null && targetFull <= 0)
    throw new Error('save_score_config: targetFullScore must be > 0');
  if (weight !== undefined && weight !== null && (weight < 0 || weight > 1000))
    throw new Error('save_score_config: weightPercentage must be within [0, 1000]');

  const next: CoursewareScoreConfig = {
    courseware_id: coursewareId,
    courseware_name:
      nameRaw === undefined
        ? existing?.courseware_name ?? (coursewareId === GLOBAL_SCORE_CONFIG_KEY ? '全局默认策略' : null)
        : nameRaw === null
          ? null
          : String(nameRaw).slice(0, 200),
    score_policy:
      policyRaw === undefined || policyRaw === null || String(policyRaw).trim() === ''
        ? existing?.score_policy ?? DEFAULT_SCORE_POLICY
        : normalizeScorePolicy(policyRaw),
    score_fields: fields || (fieldsRaw === undefined ? existing?.score_fields ?? '' : ''),
    raw_full_score: rawFull ?? existing?.raw_full_score ?? 100,
    target_full_score: targetFull ?? existing?.target_full_score ?? 100,
    weight_percentage: weight ?? existing?.weight_percentage ?? 100,
    lesson_id:
      lessonRaw === undefined
        ? existing?.lesson_id ?? null
        : lessonRaw === null
          ? null
          : String(lessonRaw).slice(0, 128),
    updated_at: Date.now(),
  };

  db.prepare(
    `INSERT INTO ${SCORE_CONFIG_TABLE}
       (courseware_id, courseware_name, score_policy, score_fields, raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(courseware_id) DO UPDATE SET
       courseware_name = excluded.courseware_name,
       score_policy = excluded.score_policy,
       score_fields = excluded.score_fields,
       raw_full_score = excluded.raw_full_score,
       target_full_score = excluded.target_full_score,
       weight_percentage = excluded.weight_percentage,
       lesson_id = excluded.lesson_id,
       updated_at = excluded.updated_at`,
  ).run(
    next.courseware_id,
    next.courseware_name,
    next.score_policy,
    next.score_fields,
    next.raw_full_score,
    next.target_full_score,
    next.weight_percentage,
    next.lesson_id,
    next.updated_at,
  );

  return next;
}

// ---------------------------------------------------------------------------
// 样本收集与归集
// ---------------------------------------------------------------------------

export function resolveCoursewareIdFromAttempt(db: SqliteLike, attemptId: string): string | null {
  if (!attemptId) return null;
  try {
    const row = db.prepare('SELECT courseware_id FROM courseware_attempt WHERE id = ?').get(attemptId) as any;
    return row && row.courseware_id ? String(row.courseware_id) : null;
  } catch (e) {
    return null;
  }
}

/** 收集某个 attempt 到目前为止的所有分数样本（按写入顺序） */
export function collectScoreSamples(db: SqliteLike, attemptId: string, fields?: unknown): ScoreSample[] {
  if (!attemptId) return [];
  let rows: any[] = [];
  try {
    rows =
      (db
        .prepare('SELECT event_type, payload_json, created_at FROM submission_raw WHERE attempt_id = ? ORDER BY created_at ASC')
        .all(attemptId) as any[]) || [];
  } catch (e) {
    return [];
  }
  const samples: ScoreSample[] = [];
  for (const row of rows) {
    let payload: any = null;
    try {
      payload = JSON.parse(row?.payload_json ?? 'null');
    } catch (e) {
      payload = null;
    }
    if (payload === null || payload === undefined) continue;
    const value = pickScoreFromPayload(payload, fields);
    if (value === null) continue;
    samples.push({
      value,
      at: toNumber(row?.created_at) ?? 0,
      eventType: String(row?.event_type ?? ''),
    });
  }
  return samples;
}

export interface AggregateOptions {
  /** 不传则从 attempt 反查；显式传 null 表示「使用全局默认配置」 */
  coursewareId?: string | null;
  /** 覆盖配置中的策略 */
  policy?: unknown;
  /** 覆盖配置中的字段路径 */
  scoreFields?: unknown;
  rawFullScore?: number | string | null;
  targetFullScore?: number | string | null;
  weightPercentage?: number | string | null;
}

/**
 * 计算某个 attempt 的官方成绩。
 * - 无任何配置行：取最后一次分数，不缩放（与历史行为完全一致）
 * - 有配置行：按策略聚合 → 归一化到 target_full_score → 写入 submission_result.score
 */
export function aggregateAttemptScore(
  db: SqliteLike,
  attemptId: string,
  options: AggregateOptions = {},
): ScoreAggregation {
  const coursewareId =
    options.coursewareId === undefined ? resolveCoursewareIdFromAttempt(db, attemptId) : options.coursewareId;
  const resolved = resolveScoreConfig(db, coursewareId);
  const hasExplicitConfig = resolved.source !== 'builtin';

  const policyOverride = options.policy;
  const policy =
    policyOverride === undefined || policyOverride === null || String(policyOverride).trim() === ''
      ? resolved.config.score_policy
      : normalizeScorePolicy(policyOverride);

  const scoreFields = options.scoreFields === undefined ? resolved.config.score_fields : options.scoreFields;

  const rawFull = toNumber(options.rawFullScore);
  const targetFull = toNumber(options.targetFullScore);
  const weight = toNumber(options.weightPercentage);

  const config: CoursewareScoreConfig = {
    ...resolved.config,
    score_policy: policy,
    score_fields: typeof scoreFields === 'string' ? scoreFields : parseScoreFields(scoreFields).join(','),
    raw_full_score: rawFull !== null && rawFull > 0 ? rawFull : resolved.config.raw_full_score,
    target_full_score: targetFull !== null && targetFull > 0 ? targetFull : resolved.config.target_full_score,
    weight_percentage: weight !== null ? clamp(weight, 0, 1000) : resolved.config.weight_percentage,
  };

  const sampleDetails = collectScoreSamples(db, attemptId, scoreFields);
  const samples = sampleDetails.map((s) => s.value);
  const rawAggregate = aggregateScores(samples, policy);

  let normalized: number | null = null;
  if (rawAggregate !== null) {
    if (!hasExplicitConfig) {
      // 历史行为：原样保留最后一次分数
      normalized = rawAggregate;
    } else {
      const scaled = (rawAggregate / config.raw_full_score) * config.target_full_score;
      normalized = round2(clamp(scaled, 0, config.target_full_score));
    }
  }

  return {
    policy,
    config,
    hasExplicitConfig,
    samples,
    sampleDetails,
    rawAggregate,
    normalized,
    finalScore: normalized,
    weightPercentage: config.weight_percentage,
  };
}

/** 归集结果的可序列化摘要（写入 submission_result.extra_json.score_aggregation） */
export function describeAggregation(aggregation: ScoreAggregation): Record<string, unknown> {
  return {
    policy: aggregation.policy,
    sample_count: aggregation.samples.length,
    samples: aggregation.samples.slice(-50),
    raw_aggregate: aggregation.rawAggregate,
    normalized: aggregation.normalized,
    raw_full_score: aggregation.config.raw_full_score,
    target_full_score: aggregation.config.target_full_score,
    weight_percentage: aggregation.weightPercentage,
    configured: aggregation.hasExplicitConfig,
    aggregated_at: Date.now(),
  };
}
