import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CollaborationEngineKernel,
  Participant,
  CollaborationPermission,
} from '../collaboration-engine/index.js';

describe('OpenLearn Teaching Collaboration Engine Core Test Suite', () => {
  let kernel: CollaborationEngineKernel;

  const mockTeacher: Participant = {
    id: 'usr_t1',
    name: '张老师',
    role: 'Teacher',
    isOnline: true,
    lastActive: Date.now(),
    lastHeartbeat: Date.now(),
    metadata: {},
  };

  const mockStudent1: Participant = {
    id: 'usr_s1',
    name: '学生A',
    role: 'Student',
    isOnline: true,
    lastActive: Date.now(),
    lastHeartbeat: Date.now(),
    metadata: {},
  };

  const mockStudent2: Participant = {
    id: 'usr_s2',
    name: '学生B',
    role: 'Student',
    isOnline: true,
    lastActive: Date.now(),
    lastHeartbeat: Date.now(),
    metadata: {},
  };

  beforeEach(() => {
    kernel = new CollaborationEngineKernel();
    kernel.participantManager.join(mockTeacher);
    kernel.participantManager.join(mockStudent1);
    kernel.participantManager.join(mockStudent2);
  });

  describe('1. Participant Lifecycle', () => {
    it('should manage participant join, leave, reconnect, and heartbeat', () => {
      expect(kernel.participantManager.getParticipant('usr_s1')?.isOnline).toBe(true);

      kernel.participantManager.leave('usr_s1');
      expect(kernel.participantManager.getParticipant('usr_s1')?.isOnline).toBe(false);

      kernel.participantManager.reconnect('usr_s1');
      expect(kernel.participantManager.getParticipant('usr_s1')?.isOnline).toBe(true);

      const heartbeatRes = kernel.participantManager.heartbeat('usr_s1');
      expect(heartbeatRes).toBe(true);
    });
  });

  describe('2. Dynamic Permission Matrix & Collaboration Modes', () => {
    it('should dynamically switch permissions based on mode', () => {
      expect(kernel.permissionMatrix.hasPermission('Teacher', 'Broadcast')).toBe(true);

      // Default mode: Teacher Presentation -> Student Whiteboard Edit revoked
      kernel.modeManager.setMode('Teacher Presentation');
      expect(kernel.permissionMatrix.hasPermission('Student', 'Whiteboard Edit')).toBe(false);

      // Mode: Small Group -> Student Whiteboard Edit granted
      kernel.modeManager.setMode('Small Group');
      expect(kernel.permissionMatrix.hasPermission('Student', 'Whiteboard Edit')).toBe(true);

      // Mode: Teacher Review -> Student Whiteboard Edit revoked
      kernel.modeManager.setMode('Teacher Review');
      expect(kernel.permissionMatrix.hasPermission('Student', 'Whiteboard Edit')).toBe(false);
    });
  });

  describe('3. Group Manager & Isolated Group Workspaces', () => {
    it('should create groups, assign members, auto-group, swap, merge, and dissolve', () => {
      const groups = kernel.groupManager.autoGroup(['usr_s1', 'usr_s2'], 2);
      expect(groups.length).toBe(1);

      const group = groups[0];
      const workspace = kernel.workspaceStore.getWorkspace(group.id);
      expect(workspace).toBeDefined();

      // Create manually 2 groups and swap members
      kernel.groupManager.dissolveAll();
      const g1 = kernel.groupManager.createGroup('组1', ['usr_s1']);
      const g2 = kernel.groupManager.createGroup('组2', ['usr_s2']);

      kernel.groupManager.swapMembers(g1.id, 'usr_s1', g2.id, 'usr_s2');
      expect(kernel.groupManager.getGroup(g1.id)?.memberIds).toContain('usr_s2');

      // Merge groups
      const merged = kernel.groupManager.mergeGroups(g1.id, g2.id);
      expect(merged?.memberIds.length).toBe(2);
    });
  });

  describe('4. Teacher Patrol System', () => {
    it('should enable teacher to enter, inspect, annotate, and takeover group workspace', () => {
      const g1 = kernel.groupManager.createGroup('组1', ['usr_s1']);

      const patrol = kernel.teacherPatrol.enterGroup('usr_t1', g1.id);
      expect(patrol.activeGroupId).toBe(g1.id);
      expect(patrol.isTakingOver).toBe(false);

      const annotated = kernel.teacherPatrol.annotateGroup(g1.id, { id: 'ann_1', type: 'text', content: '教师批注：干得好！' });
      expect(annotated).toBe(true);
      expect(kernel.workspaceStore.getWorkspace(g1.id)?.teachingObjects.length).toBe(1);

      const takeover = kernel.teacherPatrol.takeOverGroup('usr_t1', g1.id);
      expect(takeover.isTakingOver).toBe(true);
    });
  });

  describe('5. Broadcast & Collect System', () => {
    it('should handle broadcast sessions and collect group results', () => {
      const g1 = kernel.groupManager.createGroup('组1', ['usr_s1']);
      kernel.workspaceStore.updateWorkspace(g1.id, {
        canvasState: { elementsCount: 3 },
      });

      const broadcast = kernel.broadcastCollect.startBroadcast(
        'teacher',
        'usr_t1',
        [g1.id],
        { title: '教师广播示例' }
      );

      expect(broadcast.broadcastType).toBe('teacher');
      expect(kernel.broadcastCollect.getActiveBroadcast()).toBe(broadcast);

      kernel.broadcastCollect.stopBroadcast();
      expect(kernel.broadcastCollect.getActiveBroadcast()).toBeNull();

      const collected = kernel.broadcastCollect.collectGroupResults([g1.id]);
      expect(collected.length).toBe(1);
      expect(collected[0].canvasState).toEqual({ elementsCount: 3 });
    });
  });

  describe('6. Shared Object Manager', () => {
    it('should manage cross-group shared objects', () => {
      const shared = kernel.sharedObjectManager.createSharedObject(
        { title: '全班共享Quiz试题卡' },
        ['grp_1', 'grp_2'],
        'sync'
      );

      expect(shared.mode).toBe('sync');
      expect(kernel.sharedObjectManager.getSharedObject(shared.id)?.version).toBe(1);

      const updated = kernel.sharedObjectManager.updateSharedObject(shared.id, { title: '已更新试题卡' });
      expect(updated?.version).toBe(2);
      expect(updated?.content.title).toBe('已更新试题卡');
    });
  });

  describe('7. Conflict Resolver', () => {
    it('should lock objects, prevent concurrent edits, and resolve optimistic updates', () => {
      const lock1 = kernel.conflictResolver.acquireLock('obj_101', 'usr_t1', 5000);
      expect(lock1).toBe(true);

      const lock2 = kernel.conflictResolver.acquireLock('obj_101', 'usr_s1', 5000);
      expect(lock2).toBe(false); // Locked by teacher

      kernel.conflictResolver.releaseLock('obj_101', 'usr_t1');
      const lock3 = kernel.conflictResolver.acquireLock('obj_101', 'usr_s1', 5000);
      expect(lock3).toBe(true);

      const resolved = kernel.conflictResolver.resolveOptimistic(
        { version: 1, content: 'A' },
        { version: 2, content: 'B' }
      );
      expect(resolved.state.version).toBe(2);
      expect(resolved.rolledBack).toBe(false);
    });
  });

  describe('8. Synchronization Engine & Offline Queue', () => {
    it('should broadcast sync messages and queue them when offline', async () => {
      const handlerSpy = vi.fn();
      kernel.syncEngine.subscribeSync('pointer_sync', handlerSpy);

      await kernel.syncEngine.broadcastSync('pointer_sync', { x: 100, y: 200 }, 'usr_t1');
      expect(handlerSpy).toHaveBeenCalled();

      // Go offline
      kernel.syncEngine.setConnected(false);
      await kernel.syncEngine.broadcastSync('pointer_sync', { x: 105, y: 205 }, 'usr_t1');
      expect(kernel.syncEngine.getOfflineQueueCount()).toBe(1);

      // Reconnect and flush
      handlerSpy.mockClear();
      kernel.syncEngine.setConnected(true);
      expect(kernel.syncEngine.getOfflineQueueCount()).toBe(0);
      expect(handlerSpy).toHaveBeenCalled();
    });
  });

  describe('9. Collaboration Analytics Hook & Teacher Shortcuts', () => {
    it('should record collaboration metrics and apply teacher control shortcuts', () => {
      kernel.analyticsHook.recordParticipation();
      kernel.analyticsHook.recordEdit();
      kernel.analyticsHook.recordTeacherPatrol();

      const metrics = kernel.analyticsHook.getAnalytics();
      expect(metrics.participationCount).toBe(1);
      expect(metrics.editCount).toBe(1);

      kernel.freezeWhiteboard();
      expect(kernel.modeManager.getActiveMode()).toBe('Teacher Review');

      kernel.recoverWhiteboard('Teacher + Student');
      expect(kernel.modeManager.getActiveMode()).toBe('Teacher + Student');
    });
  });
});
