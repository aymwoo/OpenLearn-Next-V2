import { describe, expect, it } from 'vitest';
import { resolvePrepFace } from '../resolvePrepFace';
import { WHITEBOARD_MODE_PACK } from '../whiteboardPack';
import { XUEAN_MODE_PACK } from '../xueanPack';
import type { ModePackContribution } from '../../../../../packages/core/plugin-host/mode-pack';

const LAB_PACK: ModePackContribution = {
  id: 'ext-lab:inquiry',
  label: '探究',
  segmentTypes: ['inquiry'],
  prepContributionId: 'prep-lab',
};

describe('resolvePrepFace', () => {
  it('当前环节类型优先于课时模式', () => {
    const face = resolvePrepFace({
      activeSegmentType: 'xuean',
      lessonModePackId: WHITEBOARD_MODE_PACK.id,
      lessonDeliveryMode: 'whiteboard',
    });
    expect(face.kind).toBe('xuean');
    expect(face.prepId).toBe(XUEAN_MODE_PACK.prepContributionId);
  });

  it('无环节时按课时模式包选择', () => {
    const face = resolvePrepFace({
      activeSegmentType: null,
      lessonModePackId: XUEAN_MODE_PACK.id,
      lessonDeliveryMode: 'whiteboard',
    });
    expect(face.kind).toBe('xuean');
  });

  it('无环节且无模式包时按 delivery_mode 选择', () => {
    expect(resolvePrepFace({ activeSegmentType: null, lessonDeliveryMode: 'xuean' }).kind).toBe('xuean');
    expect(resolvePrepFace({ activeSegmentType: null, lessonDeliveryMode: 'whiteboard' }).kind).toBe('whiteboard');
  });

  it('课时绑定第三方包时返回 extension', () => {
    const face = resolvePrepFace({
      activeSegmentType: null,
      lessonModePackId: LAB_PACK.id,
      packs: [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK, LAB_PACK],
    });
    expect(face.kind).toBe('extension');
    expect(face.prepId).toBe('prep-lab');
  });

  it('完全没有课时信息时按请求 tab 兜底', () => {
    expect(resolvePrepFace({ requestedTab: 'xuean_editor' }).kind).toBe('xuean');
    expect(resolvePrepFace({ requestedTab: 'lesson_editor' }).kind).toBe('whiteboard');
    expect(resolvePrepFace({}).kind).toBe('whiteboard');
  });
});
