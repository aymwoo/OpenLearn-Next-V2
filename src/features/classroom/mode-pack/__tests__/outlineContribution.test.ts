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

  it('第三方包的自定义大纲 → extension', () => {
    const packs = [
      {
        id: 'ext-lab:mode-inquiry',
        label: '探究实验室',
        segmentTypes: ['inquiry'],
        outlineContributionId: 'outline-lab',
      },
    ];
    expect(resolveOutlineContribution({ segmentType: 'inquiry', packs })).toEqual({
      kind: 'extension',
      outlineContributionId: 'outline-lab',
      packId: 'ext-lab:mode-inquiry',
    });
  });
});
