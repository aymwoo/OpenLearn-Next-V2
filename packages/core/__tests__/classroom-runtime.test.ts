import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ClassroomRuntimeKernel,
  TaskPriority,
  IRuntimeService,
  IRuntimeModule,
  UserParticipant,
} from '../classroom-runtime/index.js';

describe('OpenLearn Classroom Runtime Core Test Suite', () => {
  let kernel: ClassroomRuntimeKernel;

  const mockTeacher: UserParticipant = {
    id: 'usr_t1',
    name: '王老师',
    role: 'Teacher',
    isOnline: true,
    joinedAt: Date.now(),
  };

  const mockStudent: UserParticipant = {
    id: 'usr_s1',
    name: '李同学',
    role: 'Student',
    isOnline: true,
    joinedAt: Date.now(),
  };

  beforeEach(() => {
    kernel = new ClassroomRuntimeKernel('rt_test_001');
  });

  describe('1. Lifecycle & Transitions', () => {
    it('should transition through full runtime lifecycle', async () => {
      const lifecycleSpy = vi.fn();
      kernel.eventBus.subscribe('LifecycleChanged', (evt) => {
        lifecycleSpy(evt.payload.to);
      });

      expect(kernel.stateManager.getState().runtime.lifecycle).toBe('Create');

      await kernel.initialize();
      expect(kernel.stateManager.getState().runtime.lifecycle).toBe('Prepare');

      await kernel.start();
      expect(kernel.stateManager.getState().runtime.lifecycle).toBe('Running');

      await kernel.pause();
      expect(kernel.stateManager.getState().runtime.lifecycle).toBe('Pause');

      await kernel.resume();
      expect(kernel.stateManager.getState().runtime.lifecycle).toBe('Running');

      await kernel.stop();
      expect(kernel.stateManager.getState().runtime.lifecycle).toBe('Stop');

      await kernel.dispose();
      expect(kernel.stateManager.getState().runtime.lifecycle).toBe('Dispose');
      expect(lifecycleSpy).toHaveBeenCalled();
    });
  });

  describe('2. Session Manager', () => {
    it('should manage session creation, join, leave, reconnect and destruction', async () => {
      const session = await kernel.sessionManager.createSession('sess_101', mockTeacher, 'crs_01', 'les_01');
      expect(session.sessionId).toBe('sess_101');
      expect(kernel.sessionManager.getActiveSession()?.teacher.name).toBe('王老师');

      // Student join
      const joined = await kernel.sessionManager.joinSession(mockStudent);
      expect(joined).toBe(true);
      expect(kernel.stateManager.getState().students.length).toBe(1);

      // Student leave
      await kernel.sessionManager.leaveSession('usr_s1');
      expect(kernel.stateManager.getState().students.length).toBe(0);

      // Student reconnect
      await kernel.sessionManager.reconnectSession('usr_s1');
      expect(kernel.stateManager.getState().students.length).toBe(1);

      // Destroy session
      await kernel.sessionManager.destroySession();
      expect(kernel.sessionManager.getActiveSession()).toBeNull();
    });
  });

  describe('3. Immutable State Tree', () => {
    it('should immutably maintain state tree updates', () => {
      const initial = kernel.stateManager.getState();
      expect(initial.whiteboard.objectCount).toBe(0);

      kernel.stateManager.updateState({
        whiteboard: { activeStageViewId: 'stg_view_1', objectCount: 5, isLocked: false },
      });

      const next = kernel.stateManager.getState();
      expect(next.whiteboard.objectCount).toBe(5);
      expect(next.whiteboard.activeStageViewId).toBe('stg_view_1');
    });
  });

  describe('4. Service Registry', () => {
    it('should register, retrieve and initialize services', async () => {
      const initSpy = vi.fn();
      const disposeSpy = vi.fn();

      const mockService: IRuntimeService = {
        serviceId: 'mock_whiteboard_service',
        name: 'Mock Whiteboard Service',
        initialize: async () => {
          initSpy();
        },
        dispose: async () => {
          disposeSpy();
        },
      };

      kernel.registerService(mockService);
      expect(kernel.serviceRegistry.getService('mock_whiteboard_service')).toBe(mockService);

      await kernel.initialize();
      expect(initSpy).toHaveBeenCalled();

      await kernel.dispose();
      expect(disposeSpy).toHaveBeenCalled();
    });
  });

  describe('5. Module Registry', () => {
    it('should register, start, and stop external modules without modifying runtime code', async () => {
      const startSpy = vi.fn();
      const stopSpy = vi.fn();

      const quizModule: IRuntimeModule = {
        id: 'mod_quiz',
        name: 'Quiz Interactive Module',
        version: '1.0.0',
        initialize: async () => {},
        start: async () => {
          startSpy();
        },
        stop: async () => {
          stopSpy();
        },
        dispose: async () => {},
      };

      kernel.registerModule(quizModule);
      expect(kernel.moduleRegistry.getModule('mod_quiz')).toBe(quizModule);

      await kernel.initialize();
      await kernel.start();
      expect(startSpy).toHaveBeenCalled();

      await kernel.stop();
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('6. Priority Scheduler', () => {
    it('should execute tasks in priority order', async () => {
      const executed: string[] = [];

      kernel.scheduler.start();

      const pLow = kernel.scheduleTask('low_task', async () => {
        executed.push('low');
        return 'low';
      }, TaskPriority.Low);

      const pImmediate = kernel.scheduleTask('immediate_task', async () => {
        executed.push('immediate');
        return 'immediate';
      }, TaskPriority.Immediate);

      const [resLow, resImm] = await Promise.all([pLow, pImmediate]);

      expect(resLow).toBe('low');
      expect(resImm).toBe('immediate');
      expect(executed).toEqual(['immediate', 'low']);

      kernel.scheduler.stop();
    });
  });

  describe('7. Permission Manager', () => {
    it('should strictly check and modify role permissions', () => {
      expect(kernel.permissionManager.hasPermission('Teacher', 'lesson:control')).toBe(true);
      expect(kernel.permissionManager.hasPermission('Student', 'lesson:control')).toBe(false);
      expect(kernel.permissionManager.hasPermission('Student', 'quiz:submit')).toBe(true);

      kernel.permissionManager.grantPermission('Student', 'lesson:control');
      expect(kernel.permissionManager.hasPermission('Student', 'lesson:control')).toBe(true);

      kernel.permissionManager.revokePermission('Student', 'lesson:control');
      expect(kernel.permissionManager.hasPermission('Student', 'lesson:control')).toBe(false);
    });
  });

  describe('8. Resource Manager', () => {
    it('should register, list, and remove media/plugin resources', () => {
      const res = kernel.resourceManager.registerResource('https://cdn.openlearn.io/demo.mp4', 'video', 102400);
      expect(res.status).toBe('loaded');

      const videos = kernel.resourceManager.listResources('video');
      expect(videos.length).toBe(1);

      kernel.resourceManager.removeResource(res.id);
      expect(kernel.resourceManager.listResources().length).toBe(0);
    });
  });

  describe('9. Runtime Hooks', () => {
    it('should execute registered runtime hooks during lifecycle events', async () => {
      const hookSpy = vi.fn();
      kernel.registerRuntimeHook('beforeLessonStart', hookSpy);

      await kernel.initialize();
      await kernel.start();

      expect(hookSpy).toHaveBeenCalled();
    });
  });

  describe('10. Snapshot & Recovery & Diagnostics', () => {
    it('should take state snapshot and produce dev monitor diagnostics', async () => {
      await kernel.initialize();
      await kernel.start();

      const snapshot = kernel.takeSnapshot();
      expect(snapshot.snapshotId).toBeDefined();
      expect(kernel.snapshotManager.getLatestSnapshot()).toBe(snapshot);

      const diag = kernel.getDiagnostics();
      expect(diag.runtimeId).toBe('rt_test_001');
      expect(diag.lifecycleState).toBe('Running');
    });
  });
});
