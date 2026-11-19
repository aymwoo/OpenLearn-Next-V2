import { afterEach, describe, expect, it } from 'vitest';
import { XUEAN_MODE_PACK } from '../xueanPack';
import { WHITEBOARD_MODE_PACK } from '../whiteboardPack';
import { resolveWorkspace } from '../resolveWorkspace';
import {
  getActiveCourseDeliveryMode,
  isModePacksEnabled,
  setActiveCourseDeliveryMode,
  setModePacksEnabledForTests,
} from '../flags';

afterEach(() => {
  setActiveCourseDeliveryMode(null);
  setModePacksEnabledForTests(null);
  delete (window as Window & { __OPENLEARN_MODE_PACKS__?: boolean }).__OPENLEARN_MODE_PACKS__;
});

describe('课程交付模式驱动课中引擎', () => {
  it('学案课在全局开关关闭时仍进入 Mode Pack，并决议到学案包', () => {
    (window as Window & { __OPENLEARN_MODE_PACKS__?: boolean }).__OPENLEARN_MODE_PACKS__ = false;
    setActiveCourseDeliveryMode('xuean');
    expect(isModePacksEnabled()).toBe(true);
    const workspace = resolveWorkspace({
      segmentType: 'xuean:study',
      packs: [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK],
      enabled: isModePacksEnabled(),
    });
    expect(workspace.kind).toBe('mode-pack');
    if (workspace.kind === 'mode-pack') {
      expect(workspace.pack.id).toBe('@openlearn/mode-xuean');
    }
  });

  it('没有模式的旧课在全局开关关闭时仍走白板旧路径', () => {
    (window as Window & { __OPENLEARN_MODE_PACKS__?: boolean }).__OPENLEARN_MODE_PACKS__ = false;
    setActiveCourseDeliveryMode(null);
    expect(getActiveCourseDeliveryMode()).toBeNull();
    expect(isModePacksEnabled()).toBe(false);
    const workspace = resolveWorkspace({
      segmentType: 'lecture',
      packs: [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK],
      enabled: isModePacksEnabled(),
    });
    expect(workspace.kind).toBe('legacy');
  });

  it('白板课不会因为学案开关被打开', () => {
    setActiveCourseDeliveryMode('whiteboard');
    expect(isModePacksEnabled()).toBe(false);
  });
});
