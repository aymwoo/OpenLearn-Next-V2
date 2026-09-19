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

  it('broadcasts and receives fullscreen synchronization messages', () => {
    const channel = new ClassroomSyncChannel();
    const received: any[] = [];
    channel.onMessage((msg) => received.push(msg));

    // 1. Fullscreen broadcast
    channel.broadcastFullscreen('el-quiz-1', 'L1');
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: 'TEACHER_BROADCAST_FULLSCREEN',
      payload: { elementId: 'el-quiz-1', lessonId: 'L1' },
    });

    // 2. Exit fullscreen broadcast
    channel.broadcastFullscreen(null, 'L1');
    expect(received).toHaveLength(2);
    expect(received[1]).toEqual({
      type: 'TEACHER_BROADCAST_FULLSCREEN',
      payload: { elementId: null, lessonId: 'L1' },
    });

    // 3. Handshake init state containing fullscreenElementId
    channel.broadcastInitState({
      selectedLesson: 'L1',
      activeSegmentId: 'seg-1',
      activeTab: 'whiteboard',
      isClassLocked: true,
      liveClassTimeRemaining: 240,
      liveClassSelectedClassId: 'C1',
      liveClassIsActive: true,
      fullscreenElementId: 'el-quiz-1',
    });
    expect(received).toHaveLength(3);
    expect(received[2].payload.fullscreenElementId).toBe('el-quiz-1');

    channel.destroy();
  });
});
