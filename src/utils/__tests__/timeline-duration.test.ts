import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEGMENT_SECONDS,
  formatSegmentDuration,
  parseDurationStringToSeconds,
  resolveSegmentDuration,
  segmentPlannedMinutes,
} from '../timeline-duration';

describe('parseDurationStringToSeconds', () => {
  it('把教案里的分钟字符串换成秒', () => {
    expect(parseDurationStringToSeconds('5m')).toBe(300);
    expect(parseDurationStringToSeconds('20m')).toBe(1200);
    expect(parseDurationStringToSeconds('15min')).toBe(900);
    expect(parseDurationStringToSeconds(' 6 mins ')).toBe(360);
    expect(parseDurationStringToSeconds('6分钟')).toBe(360);
    expect(parseDurationStringToSeconds('5M')).toBe(300);
  });

  it('识别秒和小时，以及组合单位', () => {
    expect(parseDurationStringToSeconds('90s')).toBe(90);
    expect(parseDurationStringToSeconds('90秒')).toBe(90);
    expect(parseDurationStringToSeconds('1h')).toBe(3600);
    expect(parseDurationStringToSeconds('1.5h')).toBe(5400);
    expect(parseDurationStringToSeconds('1小时')).toBe(3600);
    expect(parseDurationStringToSeconds('1h30m')).toBe(5400);
    expect(parseDurationStringToSeconds('5m30s')).toBe(330);
  });

  it('无单位纯数字按分钟', () => {
    expect(parseDurationStringToSeconds('10')).toBe(600);
    expect(parseDurationStringToSeconds('0')).toBe(0);
  });

  it('空值和乱码返回 null', () => {
    expect(parseDurationStringToSeconds('')).toBeNull();
    expect(parseDurationStringToSeconds('   ')).toBeNull();
    expect(parseDurationStringToSeconds('not-a-time')).toBeNull();
    expect(parseDurationStringToSeconds('NaN')).toBeNull();
    expect(parseDurationStringToSeconds('未设置')).toBeNull();
    expect(parseDurationStringToSeconds('-5m')).toBeNull();
  });
});

describe('resolveSegmentDuration', () => {
  it('数字 duration 按秒，字符串 duration 按单位', () => {
    expect(resolveSegmentDuration({ duration: 300 })).toEqual({ seconds: 300, known: true });
    expect(resolveSegmentDuration({ duration: 1200 })).toEqual({ seconds: 1200, known: true });
    expect(resolveSegmentDuration({ duration: '5m' })).toEqual({ seconds: 300, known: true });
    expect(resolveSegmentDuration({ duration: '20m' })).toEqual({ seconds: 1200, known: true });
  });

  it('duration 优先于旧字段', () => {
    expect(resolveSegmentDuration({ duration: '5m', durationMinutes: 99 })).toEqual({
      seconds: 300,
      known: true,
    });
  });

  it('duration 缺失时读取旧的分钟和秒字段', () => {
    expect(resolveSegmentDuration({ durationMinutes: 8 })).toEqual({ seconds: 480, known: true });
    expect(resolveSegmentDuration({ durationMin: '12m' })).toEqual({ seconds: 720, known: true });
    expect(resolveSegmentDuration({ duration_minutes: '9' })).toEqual({ seconds: 540, known: true });
    expect(resolveSegmentDuration({ minutes: 4 })).toEqual({ seconds: 240, known: true });
    expect(resolveSegmentDuration({ estimatedDurationSeconds: 600 })).toEqual({ seconds: 600, known: true });
    expect(resolveSegmentDuration({ estimated_duration_seconds: '10m' })).toEqual({ seconds: 600, known: true });
    expect(resolveSegmentDuration({ durationSeconds: '450' })).toEqual({ seconds: 450, known: true });
  });

  it('duration 无法解析时改用仍可读的旧字段', () => {
    expect(resolveSegmentDuration({ duration: 'not-a-time', durationMinutes: 8 })).toEqual({
      seconds: 480,
      known: true,
    });
  });

  it('缺失时使用调用方缺省，乱码不套缺省', () => {
    expect(resolveSegmentDuration({ title: '导入' }, { fallbackSeconds: DEFAULT_SEGMENT_SECONDS })).toEqual({
      seconds: 300,
      known: false,
    });
    expect(resolveSegmentDuration({ duration: null }, { fallbackSeconds: 300 })).toEqual({
      seconds: 300,
      known: false,
    });
    expect(resolveSegmentDuration({ duration: '' }, { fallbackSeconds: 300 })).toEqual({
      seconds: 300,
      known: false,
    });
    expect(resolveSegmentDuration({ duration: 'not-a-time' }, { fallbackSeconds: 300 })).toEqual({
      seconds: null,
      known: false,
    });
    expect(resolveSegmentDuration({ duration: { minutes: 5 } }, { fallbackSeconds: 300 })).toEqual({
      seconds: null,
      known: false,
    });
  });

  it('不传缺省时，缺失也是 null 而不是 NaN', () => {
    const resolved = resolveSegmentDuration({ duration: undefined });
    expect(resolved).toEqual({ seconds: null, known: false });
    expect(Number.isNaN(resolved.seconds)).toBe(false);
  });
});

describe('segmentPlannedMinutes / formatSegmentDuration', () => {
  it('默认四环节合计 45 分钟', () => {
    const segments = [{ duration: '5m' }, { duration: '20m' }, { duration: '15m' }, { duration: '5m' }];
    expect(segments.reduce((sum, seg) => sum + segmentPlannedMinutes(seg), 0)).toBe(45);
  });

  it('无法识别的时长记 0 分钟', () => {
    expect(segmentPlannedMinutes({ duration: 'not-a-time' })).toBe(0);
    expect(segmentPlannedMinutes({ duration: null })).toBe(0);
    expect(Number.isNaN(segmentPlannedMinutes({ duration: '5m' }))).toBe(false);
  });

  it('展示文案在有值和缺失时都不是 NaN', () => {
    expect(formatSegmentDuration(300, 'zh')).toEqual({ minutes: 5, compact: '5m', prose: '5 分钟' });
    expect(formatSegmentDuration(90, 'zh').compact).toBe('2m');
    expect(formatSegmentDuration(null, 'zh')).toEqual({ minutes: null, compact: '未设置', prose: '未设置' });
    expect(formatSegmentDuration(null, 'en').compact).toBe('Unset');
    expect(formatSegmentDuration(Number.NaN, 'zh').compact).toBe('未设置');
  });
});
