import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GLOBAL_SCORE_CONFIG_KEY,
  aggregateAttemptScore,
  aggregateScores,
  collectScoreSamples,
  describeAggregation,
  extractScoreFromFields,
  getNested,
  isKnownScorePolicy,
  listScoreConfigs,
  normalizeScorePolicy,
  parseScoreFields,
  pickScoreFromPayload,
  resolveScoreConfig,
  round2,
  saveScoreConfig,
  toNumber,
} from '../courseware-score.js';

const MIGRATION_004 = path.resolve(process.cwd(), 'migrations/004_courseware_score_config.sql');

function applyMigration(db: Database.Database) {
  const raw = fs.readFileSync(MIGRATION_004, 'utf8');
  const up = raw.split(/--\s*DOWN/i)[0].replace(/^\s*--\s*UP[^\n]*\n/i, '');
  db.exec(up);
}

describe('courseware-score helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE courseware_attempt (
        id TEXT PRIMARY KEY,
        courseware_id TEXT,
        student_id TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        status TEXT
      );
      CREATE TABLE submission_raw (
        id TEXT PRIMARY KEY,
        attempt_id TEXT,
        event_type TEXT,
        payload_json TEXT,
        created_at INTEGER
      );
      CREATE TABLE submission_result (
        id TEXT PRIMARY KEY,
        attempt_id TEXT,
        score REAL,
        comment TEXT,
        completion REAL,
        extra_json TEXT
      );
    `);
    applyMigration(db);
  });

  afterEach(() => {
    db.close();
  });

  function seedAttempt(attemptId: string, coursewareId: string) {
    db.prepare(
      'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
    ).run(attemptId, coursewareId, 'stu-1', Date.now(), 'active');
  }

  function seedSample(attemptId: string, payload: any, createdAt: number, eventType = 'progress') {
    db.prepare(
      'INSERT INTO submission_raw (id, attempt_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(`raw_${createdAt}_${Math.random()}`, attemptId, eventType, JSON.stringify(payload), createdAt);
  }

  describe('纯函数', () => {
    it('toNumber 接受数字、数字字符串与百分号写法', () => {
      expect(toNumber(88)).toBe(88);
      expect(toNumber(' 72.5 ')).toBe(72.5);
      expect(toNumber('80%')).toBe(80);
      expect(toNumber('abc')).toBeNull();
      expect(toNumber('')).toBeNull();
      expect(toNumber(null)).toBeNull();
      expect(toNumber(NaN)).toBeNull();
      expect(toNumber(true)).toBeNull();
    });

    it('parseScoreFields 支持逗号/分号/换行/数组', () => {
      expect(parseScoreFields('score, data.points;grade\nmark')).toEqual(['score', 'data.points', 'grade', 'mark']);
      expect(parseScoreFields(['a', ' b ', ''])).toEqual(['a', 'b']);
      expect(parseScoreFields(undefined)).toEqual([]);
    });

    it('getNested 支持点号路径与数组下标', () => {
      const raw = { a: { b: [{ c: 12 }] }, s: '{"x":{"y":7}}' };
      expect(getNested(raw, 'a.b.0.c')).toBe(12);
      expect(getNested(raw, 's.x.y')).toBe(7);
      expect(getNested(raw, 'nope.deep')).toBeUndefined();
      expect(getNested(null, 'a')).toBeUndefined();
    });

    it('aggregateScores 覆盖四种策略', () => {
      const samples = [10, 90, 50];
      expect(aggregateScores(samples, 'LATEST')).toBe(50);
      expect(aggregateScores(samples, 'MAX')).toBe(90);
      expect(aggregateScores(samples, 'FIRST')).toBe(10);
      expect(aggregateScores(samples, 'AVERAGE')).toBe(50);
      expect(aggregateScores([], 'MAX')).toBeNull();
      expect(aggregateScores(['80', '90'], 'MAX')).toBe(90);
      // 未知策略回落到「最后一次」，保持历史行为
      expect(aggregateScores(samples, 'WHATEVER')).toBe(50);
      expect(aggregateScores(samples, undefined)).toBe(50);
    });

    it('normalizeScorePolicy / isKnownScorePolicy', () => {
      expect(normalizeScorePolicy('highest')).toBe('MAX');
      expect(normalizeScorePolicy('平均分')).toBe('AVERAGE');
      expect(normalizeScorePolicy('最近')).toBe('LATEST');
      expect(isKnownScorePolicy('MAX')).toBe(true);
      expect(isKnownScorePolicy('bogus')).toBe(false);
    });

    it('pickScoreFromPayload 识别常见载荷形态', () => {
      expect(pickScoreFromPayload({ score: 42 })).toBe(42);
      expect(pickScoreFromPayload({ data: { points: '17' } })).toBe(17);
      expect(pickScoreFromPayload({ score: 55, watch: { userScore: 55 } })).toBe(55);
      expect(pickScoreFromPayload('{"score": 31}')).toBe(31);
      expect(pickScoreFromPayload({ nested: { deep: { score: 9 } } })).toBe(9);
      expect(pickScoreFromPayload({ raw: 'score=64&total=100' })).toBe(64);
      expect(pickScoreFromPayload({ c: { d: { e: { score: 3 } } } }, 'c.d.e.score')).toBe(3);
      expect(extractScoreFromFields({ s: { v: 8 } }, 's.v')).toBe(8);
      expect(pickScoreFromPayload({ noScore: true })).toBeNull();
    });

    it('round2 保留两位小数', () => {
      expect(round2((40 / 50) * 100)).toBe(80);
      expect(round2(12.3456)).toBe(12.35);
    });
  });

  describe('配置读写', () => {
    it('无任何配置行时回落到内置默认（与历史行为一致）', () => {
      const resolved = resolveScoreConfig(db, 'cw-1');
      expect(resolved.source).toBe('builtin');
      expect(resolved.config.score_policy).toBe('LATEST');
      expect(resolved.config.target_full_score).toBe(100);
    });

    it('保存并读取课件专属配置，全局行作为回落', () => {
      saveScoreConfig(db as any, {
        coursewareId: 'cw-1',
        coursewareName: '测试课件',
        scorePolicy: 'MAX',
        scoreFields: 'score,data.points',
        rawFullScore: 50,
        targetFullScore: 100,
        weightPercentage: 40,
        lessonId: 'lesson-1',
      });
      const own = resolveScoreConfig(db, 'cw-1');
      expect(own.source).toBe('courseware');
      expect(own.config.score_policy).toBe('MAX');
      expect(own.config.raw_full_score).toBe(50);
      expect(own.config.target_full_score).toBe(100);
      expect(own.config.weight_percentage).toBe(40);
      expect(own.config.lesson_id).toBe('lesson-1');

      // 未配置的课件落到全局
      saveScoreConfig(db as any, { coursewareId: GLOBAL_SCORE_CONFIG_KEY, scorePolicy: 'AVERAGE' });
      const fallback = resolveScoreConfig(db, 'cw-unconfigured');
      expect(fallback.source).toBe('global');
      expect(fallback.config.score_policy).toBe('AVERAGE');

      // 更新已有配置（upsert 不新增行）
      saveScoreConfig(db as any, { coursewareId: 'cw-1', scorePolicy: 'AVERAGE' });
      expect(listScoreConfigs(db as any)).toHaveLength(2);
      expect(resolveScoreConfig(db, 'cw-1').config.score_policy).toBe('AVERAGE');
      // 未提供的字段保持不变
      expect(resolveScoreConfig(db, 'cw-1').config.raw_full_score).toBe(50);
      expect(resolveScoreConfig(db, 'cw-1').config.weight_percentage).toBe(40);
    });

    it('非法配置被拒绝', () => {
      expect(() => saveScoreConfig(db as any, { coursewareId: 'cw-1', scorePolicy: 'NOT_A_POLICY' })).toThrow(
        /unknown scorePolicy/,
      );
      expect(() => saveScoreConfig(db as any, { coursewareId: 'cw-1', rawFullScore: 0 })).toThrow(/rawFullScore/);
      expect(() => saveScoreConfig(db as any, { coursewareId: 'cw-1', targetFullScore: -5 })).toThrow(/targetFullScore/);
      expect(() => saveScoreConfig(db as any, { coursewareId: 'cw-1', weightPercentage: 5000 })).toThrow(
        /weightPercentage/,
      );
      expect(() => saveScoreConfig(db as any, {} as any)).toThrow(/coursewareId is required/);
    });
  });

  describe('样本收集与归集', () => {
    it('无配置：取最后一次分数且不缩放（历史行为）', () => {
      seedAttempt('att-1', 'cw-1');
      seedSample('att-1', { score: 30 }, 1000);
      seedSample('att-1', { score: 70 }, 2000);
      seedSample('att-1', { score: 45 }, 3000);

      const agg = aggregateAttemptScore(db as any, 'att-1');
      expect(agg.hasExplicitConfig).toBe(false);
      expect(agg.samples).toEqual([30, 70, 45]);
      expect(agg.rawAggregate).toBe(45);
      expect(agg.finalScore).toBe(45);
    });

    it('MAX 策略 + 满分归一化', () => {
      seedAttempt('att-2', 'cw-2');
      saveScoreConfig(db as any, {
        coursewareId: 'cw-2',
        scorePolicy: 'MAX',
        rawFullScore: 50,
        targetFullScore: 100,
      });
      seedSample('att-2', { score: 20 }, 1000);
      seedSample('att-2', { score: 40 }, 2000); // 40/50 -> 80
      seedSample('att-2', { score: 30 }, 3000);

      const agg = aggregateAttemptScore(db as any, 'att-2');
      expect(agg.policy).toBe('MAX');
      expect(agg.rawAggregate).toBe(40);
      expect(agg.normalized).toBe(80);
      expect(agg.finalScore).toBe(80);
      expect(agg.hasExplicitConfig).toBe(true);
      expect(agg.weightPercentage).toBe(100);
    });

    it('AVERAGE 策略按样本均值，超满分被裁剪', () => {
      seedAttempt('att-3', 'cw-3');
      saveScoreConfig(db as any, { coursewareId: 'cw-3', scorePolicy: 'AVERAGE' });
      seedSample('att-3', { score: 100 }, 1000);
      seedSample('att-3', { score: 150 }, 2000); // 裁剪到 100
      const agg = aggregateAttemptScore(db as any, 'att-3');
      expect(agg.rawAggregate).toBe(125);
      expect(agg.finalScore).toBe(100);
    });

    it('监视器样本（{score, watch}）与 log 事件都能被识别', () => {
      seedAttempt('att-4', 'cw-4');
      saveScoreConfig(db as any, { coursewareId: 'cw-4', scorePolicy: 'MAX' });
      seedSample('att-4', { score: 55, watch: { userScore: 55, dom__score: 82 } }, 1000);
      seedSample('att-4', { eventType: 'click' }, 1500); // 无分数，忽略
      seedSample('att-4', { payload: { points: 91 } }, 2000);

      const samples = collectScoreSamples(db as any, 'att-4');
      expect(samples.map((s) => s.value)).toEqual([55, 91]);
      expect(aggregateAttemptScore(db as any, 'att-4').finalScore).toBe(91);
    });

    it('配置的 score_fields 优先于通用键名', () => {
      seedAttempt('att-5', 'cw-5');
      saveScoreConfig(db as any, { coursewareId: 'cw-5', scorePolicy: 'LATEST', scoreFields: 'custom.myScore' });
      seedSample('att-5', { score: 99, custom: { myScore: 12 } }, 1000);
      expect(collectScoreSamples(db as any, 'att-5', 'custom.myScore').map((s) => s.value)).toEqual([12]);
      // 未指定字段时使用通用键名
      expect(collectScoreSamples(db as any, 'att-5').map((s) => s.value)).toEqual([99]);
    });

    it('describeAggregation 输出可序列化摘要', () => {
      seedAttempt('att-6', 'cw-6');
      seedSample('att-6', { score: 60 }, 1000);
      const agg = aggregateAttemptScore(db as any, 'att-6');
      const summary = describeAggregation(agg);
      expect(summary.policy).toBe('LATEST');
      expect(summary.sample_count).toBe(1);
      expect(summary.samples).toEqual([60]);
      expect(JSON.parse(JSON.stringify(summary))).toBeTruthy();
    });
  });
});
