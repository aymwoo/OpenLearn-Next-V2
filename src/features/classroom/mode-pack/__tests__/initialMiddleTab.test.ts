import { describe, it, expect } from 'vitest';
import { shouldAutoSelectSegmentMain } from '../initialMiddleTab';

describe('shouldAutoSelectSegmentMain', () => {
  it('学案交付的课时默认落在环节工作区', () => {
    expect(shouldAutoSelectSegmentMain({ delivery_mode: 'xuean' }, true)).toBe(true);
  });

  it('白板交付的课时保持历史默认（白板页）', () => {
    expect(shouldAutoSelectSegmentMain({ delivery_mode: 'whiteboard' }, true)).toBe(false);
  });

  it('未声明交付模式的旧课不改变默认行为', () => {
    expect(shouldAutoSelectSegmentMain({}, true)).toBe(false);
    expect(shouldAutoSelectSegmentMain(null, true)).toBe(false);
  });

  it('mode pack 关闭时不生效', () => {
    expect(shouldAutoSelectSegmentMain({ delivery_mode: 'xuean' }, false)).toBe(false);
  });
});
