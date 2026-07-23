import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PresenceEngineKernel,
  PresenceEntity,
  CustomPresenceDefinition,
} from '../presence-engine/index.js';

describe('OpenLearn Presence Engine Core Test Suite', () => {
  let kernel: PresenceEngineKernel;

  const teacherPresence: PresenceEntity = {
    id: 'usr_t1',
    type: 'teacher',
    status: 'Teaching',
    activity: '讲解微积分定理',
    focus: 'Focused',
    role: 'teacher',
    permission: ['lesson:control', 'stage:navigate'],
    lastActive: Date.now(),
    lastHeartbeat: Date.now(),
    connectionState: 'connected',
    metadata: {},
  };

  const studentPresence: PresenceEntity = {
    id: 'usr_s1',
    type: 'student',
    status: 'Online',
    activity: '听讲中',
    focus: 'Focused',
    role: 'student',
    permission: ['whiteboard:draw', 'quiz:submit'],
    lastActive: Date.now(),
    lastHeartbeat: Date.now(),
    connectionState: 'connected',
    metadata: {},
  };

  beforeEach(() => {
    kernel = new PresenceEngineKernel();
    kernel.registerEntity(teacherPresence);
    kernel.registerEntity(studentPresence);
  });

  describe('1. Store & Diff Synchronizer', () => {
    it('should store entities and compute partial diff updates', () => {
      const stored = kernel.store.getPresence('usr_t1');
      expect(stored?.status).toBe('Teaching');

      const diff = kernel.synchronizer.computeDiff(teacherPresence, {
        ...teacherPresence,
        status: 'Writing',
        activity: '在白板推导公式',
      });

      expect(diff).not.toBeNull();
      expect(diff?.changes.status).toBe('Writing');

      const updated = kernel.synchronizer.applyDiff(diff!);
      expect(updated?.status).toBe('Writing');
    });
  });

  describe('2. Event Bus & Watchers', () => {
    it('should publish PresenceChanged and trigger entity watchers', () => {
      const watchSpy = vi.fn();
      kernel.presenceManager.watchPresence('usr_s1', watchSpy);

      kernel.presenceManager.updatePresence('usr_s1', {
        status: 'Writing',
        activity: '作答中',
      });

      expect(watchSpy).toHaveBeenCalled();
      const current = kernel.presenceManager.getPresence('usr_s1');
      expect(current?.status).toBe('Writing');
    });
  });

  describe('3. Activity Detector', () => {
    it('should auto-detect interaction signals and update presence status', () => {
      kernel.activityDetector.reportSignal({
        entityId: 'usr_s1',
        type: 'code_execute',
        detail: '运行 Python 测试用例',
      });

      const updated = kernel.store.getPresence('usr_s1');
      expect(updated?.status).toBe('Coding');
      expect(updated?.activity).toBe('运行 Python 测试用例');
    });
  });

  describe('4. Heartbeat Manager & Timeouts', () => {
    it('should detect timeout and mark entity offline', async () => {
      const timeoutSpy = vi.fn();
      kernel.eventBus.subscribe('HeartbeatTimeout', timeoutSpy);

      // Register old heartbeat
      kernel.store.setPresence({
        ...studentPresence,
        id: 'usr_stale',
        lastHeartbeat: Date.now() - 40000, // 40 seconds ago
      });

      kernel.heartbeatManager.sweep();

      const stale = kernel.store.getPresence('usr_stale');
      expect(stale?.connectionState).toBe('offline');
      expect(timeoutSpy).toHaveBeenCalled();
    });
  });

  describe('5. Focus Engine', () => {
    it('should update and broadcast focus changes', () => {
      const focusSpy = vi.fn();
      kernel.eventBus.subscribe('FocusChanged', focusSpy);

      kernel.focusEngine.reportFocusChange('usr_s1', 'Distracted');

      const student = kernel.store.getPresence('usr_s1');
      expect(student?.focus).toBe('Distracted');
      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe('6. Group Presence', () => {
    it('should calculate group member online and active metrics', () => {
      kernel.groupManager.registerGroup({
        groupId: 'grp_101',
        name: '第一讨论组',
        onlineCount: 0,
        activeCount: 0,
        discussionStatus: 'active',
        taskProgress: 50,
        isCompleted: false,
        members: ['usr_s1'],
      });

      const refreshed = kernel.groupManager.refreshGroupCounts('grp_101');
      expect(refreshed?.onlineCount).toBe(1);
      expect(refreshed?.activeCount).toBe(1);

      kernel.groupManager.updateGroupProgress('grp_101', 100);
      expect(kernel.groupManager.getGroupPresence('grp_101')?.isCompleted).toBe(true);
    });
  });

  describe('7. Timeline Logger', () => {
    it('should log presence state transitions into time-series log', () => {
      kernel.presenceManager.updatePresence('usr_s1', { status: 'Discussing' });

      const logs = kernel.timelineLogger.getTimeline('usr_s1');
      expect(logs.length).toBe(1);
      expect(logs[0].currentStatus).toBe('Discussing');
    });
  });

  describe('8. Privacy Manager', () => {
    it('should mask entity ID in anonymous mode', () => {
      kernel.privacyManager.updateConfig({ anonymousMode: true });

      const sanitized = kernel.presenceManager.getPresence('usr_s1');
      expect(sanitized?.id).toContain('anon_');
    });
  });

  describe('9. Hand Raise & Help Requests', () => {
    it('should process raise hand and help request signals', () => {
      const helpSpy = vi.fn();
      kernel.eventBus.subscribe('HelpRequested', helpSpy);

      kernel.presenceManager.requestHelp('usr_s1', '请问第二题公式怎么理解？');

      const student = kernel.presenceManager.getPresence('usr_s1');
      expect(student?.status).toBe('Need Help');
      expect(helpSpy).toHaveBeenCalled();
    });
  });

  describe('10. Dashboard Metrics Reservation & Custom SDK Plugin', () => {
    it('should aggregate reserved Dashboard metrics and support custom presence definitions', () => {
      const customDef: CustomPresenceDefinition = {
        type: 'vr_robot',
        name: 'VR 助教机器人',
        defaultStatus: 'Idle',
        rolesAllowed: ['ai'],
      };

      kernel.presenceManager.registerPresence(customDef);
      expect(kernel.presenceManager.getCustomPresenceDefs().length).toBe(1);

      const metrics = kernel.presenceManager.getDashboardMetrics();
      expect(metrics.onlineCount).toBeGreaterThanOrEqual(1);
      expect(metrics.taskCompletionRate).toBeGreaterThanOrEqual(0);
    });
  });
});
