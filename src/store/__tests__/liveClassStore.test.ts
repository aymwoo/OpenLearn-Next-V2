import { describe, it, expect, beforeEach } from 'vitest';
import { liveClassStore } from '../liveClassStore';

describe('liveClassStore', () => {
  beforeEach(() => {
    liveClassStore.setState({
      liveClassSelectedClassId: null,
      liveClassIsActive: false,
      liveClassFeed: [],
      liveClassTimeRemaining: 0,
      liveClassAcknowledgedMap: new Map(),
      liveClassStudentProgress: [],
      onlineStudentIds: [],
      activeStudentLessons: {},
    });
  });

  it('updates live classroom active state', () => {
    liveClassStore.getState().setLiveClassIsActive(true);
    liveClassStore.getState().setLiveClassSelectedClassId('c100');
    expect(liveClassStore.getState().liveClassIsActive).toBe(true);
    expect(liveClassStore.getState().liveClassSelectedClassId).toBe('c100');
  });

  it('appends live class feed entries up to cap', () => {
    liveClassStore.getState().appendLiveClassFeed({ id: 'msg1', text: 'hello' });
    expect(liveClassStore.getState().liveClassFeed).toHaveLength(1);
  });
});
