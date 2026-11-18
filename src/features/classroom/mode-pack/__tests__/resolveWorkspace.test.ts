import { afterEach, describe, expect, it } from 'vitest';
import { setModePacksEnabledForTests } from '../flags';
import { resolveWorkspace } from '../resolveWorkspace';
import { WHITEBOARD_MODE_PACK } from '../whiteboardPack';
import { XUEAN_MODE_PACK } from '../xueanPack';

afterEach(() => {
  setModePacksEnabledForTests(null);
});

describe('resolveWorkspace', () => {
  it('flag 关闭时始终 legacy（零行为变化）', () => {
    setModePacksEnabledForTests(false);
    const r = resolveWorkspace({ segmentType: 'xuean', packs: [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK] });
    expect(r.kind).toBe('legacy');
  });

  it('flag 开启且有默认包时，无 type 环节走 mode-pack 白板', () => {
    setModePacksEnabledForTests(true);
    const r = resolveWorkspace({ segmentType: null, packs: [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK] });
    expect(r).toEqual({
      kind: 'mode-pack',
      segmentType: 'whiteboard',
      pack: WHITEBOARD_MODE_PACK,
    });
  });

  it('flag 开启时 xuean 环节命中学案包（不回落白板）', () => {
    setModePacksEnabledForTests(true);
    const r = resolveWorkspace({ segmentType: 'xuean', packs: [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK] });
    expect(r).toEqual({
      kind: 'mode-pack',
      segmentType: 'xuean',
      pack: XUEAN_MODE_PACK,
    });
  });

  it('flag 开启但无匹配包且无 default 时回落 legacy', () => {
    setModePacksEnabledForTests(true);
    const r = resolveWorkspace({
      segmentType: 'moodle:quiz',
      packs: [{ id: 'x', label: 'x', segmentTypes: ['xuean'] }],
    });
    expect(r.kind).toBe('legacy');
  });
});
