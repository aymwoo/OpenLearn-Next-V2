import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClassroomSyncChannel } from '../classroom-sync-channel';

describe('ClassroomSyncChannel', () => {
  let listeners: ((event: any) => void)[] = [];
  let postMessageMock: any;
  let closeMock: any;

  beforeEach(() => {
    listeners = [];
    postMessageMock = vi.fn();
    closeMock = vi.fn();

    // Mock global BroadcastChannel
    vi.stubGlobal(
      'BroadcastChannel',
      vi.fn().mockImplementation(function (name: string) {
        return {
          name,
          set onmessage(fn: (event: any) => void) {
            listeners.push(fn);
          },
          postMessage: (data: any) => {
            postMessageMock(data);
            // Simulate dispatch to all listeners
            listeners.forEach((l) => l({ data }));
          },
          close: closeMock,
        };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes and posts teacher init state', () => {
    const channel = new ClassroomSyncChannel();
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.broadcastInitState({
      selectedLesson: 'L1',
      activeSegmentId: 'seg-1',
      activeTab: 'whiteboard',
      isClassLocked: false,
      liveClassTimeRemaining: 300,
      liveClassSelectedClassId: 'C1',
      liveClassIsActive: true,
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'TEACHER_INIT_STATE',
      payload: expect.objectContaining({
        selectedLesson: 'L1',
        activeSegmentId: 'seg-1',
      }),
    });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('TEACHER_INIT_STATE');

    channel.destroy();
    expect(closeMock).toHaveBeenCalled();
  });

  it('supports lesson, segment, and tab change broadcasts', () => {
    const channel = new ClassroomSyncChannel();
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.broadcastChangeLesson('L2');
    channel.broadcastChangeSegment('seg-2');
    channel.broadcastChangeTab('courseware');
    channel.broadcastLockClass(true);
    channel.broadcastPickStudent('s101', 'Alice');
    channel.broadcastSyncTimer(120, true);

    expect(received.map((r) => r.type)).toEqual([
      'TEACHER_CHANGE_LESSON',
      'TEACHER_CHANGE_SEGMENT',
      'TEACHER_CHANGE_TAB',
      'TEACHER_LOCK_CLASS',
      'TEACHER_PICK_STUDENT',
      'TEACHER_SYNC_TIMER',
    ]);

    channel.destroy();
  });

  it('supports student handshake and acknowledge response', () => {
    const channel = new ClassroomSyncChannel();
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    channel.requestHandshake();
    channel.acknowledgePick('s101');
    channel.sendHeartbeat('s101');

    expect(received.map((r) => r.type)).toEqual([
      'STUDENT_HANDSHAKE_REQUEST',
      'STUDENT_ACKNOWLEDGE_PICK',
      'STUDENT_HEARTBEAT',
    ]);

    channel.destroy();
  });

  it('unsubscribes listeners cleanly', () => {
    const channel = new ClassroomSyncChannel();
    const received: any[] = [];
    const unsubscribe = channel.onMessage((msg) => received.push(msg));

    channel.broadcastChangeLesson('L1');
    expect(received).toHaveLength(1);

    unsubscribe();
    channel.broadcastChangeLesson('L2');
    expect(received).toHaveLength(1);

    channel.destroy();
  });
});
