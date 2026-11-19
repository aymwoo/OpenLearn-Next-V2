import { describe, expect, it } from 'vitest';
import {
  isXueanDeliveryMode,
  resolveCourseDeliveryMode,
  xueanActivityTypeForSegment,
  xueanSegmentTypeForActivity,
} from '../course-delivery-mode.js';

describe('course delivery mode', () => {
  it('未设置、白板和无法识别的值都是白板', () => {
    expect(resolveCourseDeliveryMode(null)).toBe('whiteboard');
    expect(resolveCourseDeliveryMode(undefined)).toBe('whiteboard');
    expect(resolveCourseDeliveryMode('')).toBe('whiteboard');
    expect(resolveCourseDeliveryMode('whiteboard')).toBe('whiteboard');
    expect(resolveCourseDeliveryMode('lecture')).toBe('whiteboard');
    expect(isXueanDeliveryMode(null)).toBe(false);
  });

  it('只有 xuean 才是学案模式', () => {
    expect(resolveCourseDeliveryMode('xuean')).toBe('xuean');
    expect(isXueanDeliveryMode('xuean')).toBe(true);
  });

  it('学案环节类型能对上活动类型', () => {
    expect(xueanSegmentTypeForActivity('preview')).toBe('xuean:preview');
    expect(xueanSegmentTypeForActivity('study')).toBe('xuean');
    expect(xueanSegmentTypeForActivity('drill')).toBe('xuean:drill');
    expect(xueanActivityTypeForSegment('xuean:preview')).toBe('reading');
    expect(xueanActivityTypeForSegment('xuean')).toBe('submission');
    expect(xueanActivityTypeForSegment('xuean:drill')).toBe('quiz');
  });
});
