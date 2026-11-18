import { describe, it, expect } from 'vitest';
import { resolveOutlineContribution } from '../outlineContribution';

describe('resolveOutlineContribution', () => {
  it('缺省 / 白板 → whiteboard-pages', () => {
    expect(resolveOutlineContribution({ segmentType: null }).kind).toBe('whiteboard-pages');
    expect(resolveOutlineContribution({ segmentType: 'whiteboard' }).outlineContributionId).toBe(
      'outline-whiteboard-pages',
    );
  });

  it('学案前缀 → xuean-activities', () => {
    expect(resolveOutlineContribution({ segmentType: 'xuean:study' }).kind).toBe('xuean-activities');
    expect(resolveOutlineContribution({ segmentType: 'xuean' }).outlineContributionId).toBe('outline-xuean-activities');
  });
});
