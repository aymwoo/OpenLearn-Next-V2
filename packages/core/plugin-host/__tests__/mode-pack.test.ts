import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE_PACK_SEGMENT_TYPE,
  modePackCoversSegmentType,
  normalizeSegmentType,
  resolveModePackForSegment,
  type ModePackContribution,
} from '../mode-pack.js';

const whiteboard: ModePackContribution = {
  id: '@openlearn/mode-whiteboard',
  label: '白板',
  segmentTypes: ['whiteboard'],
  isDefault: true,
};

const xuean: ModePackContribution = {
  id: '@openlearn/mode-xuean',
  label: '学案',
  segmentTypes: ['xuean'],
};

describe('Mode Pack 契约（P0）', () => {
  it('normalizeSegmentType：空值回落为 whiteboard', () => {
    expect(normalizeSegmentType(undefined)).toBe(DEFAULT_MODE_PACK_SEGMENT_TYPE);
    expect(normalizeSegmentType(null)).toBe(DEFAULT_MODE_PACK_SEGMENT_TYPE);
    expect(normalizeSegmentType('')).toBe(DEFAULT_MODE_PACK_SEGMENT_TYPE);
    expect(normalizeSegmentType('  ')).toBe(DEFAULT_MODE_PACK_SEGMENT_TYPE);
    expect(normalizeSegmentType('xuean:study')).toBe('xuean:study');
  });

  it('modePackCoversSegmentType：支持前缀匹配', () => {
    expect(modePackCoversSegmentType(xuean, 'xuean')).toBe(true);
    expect(modePackCoversSegmentType(xuean, 'xuean:study')).toBe(true);
    expect(modePackCoversSegmentType(xuean, 'whiteboard')).toBe(false);
  });

  it('resolveModePackForSegment：精确包优先，否则 isDefault', () => {
    const packs = [whiteboard, xuean];
    expect(resolveModePackForSegment(packs, 'xuean:drill')?.id).toBe(xuean.id);
    expect(resolveModePackForSegment(packs, undefined)?.id).toBe(whiteboard.id);
    expect(resolveModePackForSegment(packs, 'moodle:quiz')?.id).toBe(whiteboard.id);
    expect(resolveModePackForSegment([xuean], 'whiteboard')).toBeNull();
  });
});
