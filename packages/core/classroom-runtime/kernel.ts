/**
 * OpenLearn Classroom Runtime Kernel
 * Master orchestrator unifying Kernel, Session, State, EventBus, Scheduler, Services, Modules, Permissions, and Hooks.
 */

import {
  RuntimeLifecycleState,
  RuntimeContextData,
  RuntimeRole,
  UserParticipant,
  IRuntimeService,
  IRuntimeModule,
  RuntimeHookName,
  RuntimeHookCallback,
  TaskPriority,
  RuntimeSnapshot,
} from './types.js';
import { RuntimeEventBus } from './event-bus.js';
import { RuntimeStateManager } from './state-manager.js';
import { RuntimeServiceRegistry } from './service-registry.js';
import { RuntimeModuleRegistry } from './module-registry.js';
import { RuntimeScheduler } from './scheduler.js';
import { RuntimePermissionManager } from './permission-manager.js';
import { RuntimeResourceManager } from './resource-manager.js';
import { RuntimeSnapshotManager } from './snapshot-recovery.js';
import { RuntimeHooksManager } from './hooks-system.js';
import { ClassroomSessionManager, ClassroomSessionData } from './session-manager.js';
import { RuntimeMonitor, RuntimeDiagnostics } from './monitor.js';

export class ClassroomRuntimeKernel {
  public readonly runtimeId: string;
  public readonly eventBus: RuntimeEventBus;
  public readonly stateManager: RuntimeStateManager;
  public readonly serviceRegistry: RuntimeServiceRegistry;
  public readonly moduleRegistry: RuntimeModuleRegistry;
  public readonly scheduler: RuntimeScheduler;
  public readonly permissionManager: RuntimePermissionManager;
  public readonly resourceManager: RuntimeResourceManager;
  public readonly snapshotManager: RuntimeSnapshotManager;
  public readonly hooksManager: RuntimeHooksManager;
  public readonly sessionManager: ClassroomSessionManager;
  public readonly monitor: RuntimeMonitor;

  private currentUser?: UserParticipant;
  private currentRole: RuntimeRole = 'Teacher';

  constructor(id = `rt_${globalThis.crypto.randomUUID()}`) {
    this.runtimeId = id;
    this.eventBus = new RuntimeEventBus();
    this.stateManager = new RuntimeStateManager(id);
    this.serviceRegistry = new RuntimeServiceRegistry();
    this.moduleRegistry = new RuntimeModuleRegistry();
    this.scheduler = new RuntimeScheduler();
    this.permissionManager = new RuntimePermissionManager();
    this.resourceManager = new RuntimeResourceManager();
    this.snapshotManager = new RuntimeSnapshotManager();
    this.hooksManager = new RuntimeHooksManager();
    this.sessionManager = new ClassroomSessionManager(this.eventBus, this.stateManager);
    this.monitor = new RuntimeMonitor();

    // Track lifecycle in state
    this.stateManager.setLifecycle('Create');
  }

  // ── Unified Context ────────────────────────────────────────────────────

  public getContext(): RuntimeContextData {
    const session = this.sessionManager.getActiveSession();
    return {
      runtimeId: this.runtimeId,
      sessionId: session?.sessionId || 'sess_default',
      courseId: session?.courseId,
      lessonId: session?.lessonId,
      teacher: session?.teacher,
      currentUser: this.currentUser || session?.teacher,
      role: this.currentRole,
      permissions: this.permissionManager.getRolePermissions(this.currentRole),
      lifecycleState: this.stateManager.getState().runtime.lifecycle,
    };
  }

  // ── Runtime Lifecycle Transitions ──────────────────────────────────────

  public async initialize(): Promise<void> {
    this.transitionState('Initialize');
    this.scheduler.start();

    const ctx = this.getContext();
    await this.serviceRegistry.initializeAll(ctx);

    this.transitionState('Prepare');
  }

  public async start(): Promise<void> {
    const ctx = this.getContext();

    await this.hooksManager.executeHook('beforeLessonStart', {}, ctx);
    this.transitionState('Running');

    await this.moduleRegistry.startAll(ctx);
    await this.hooksManager.executeHook('afterLessonStart', {}, ctx);

    await this.eventBus.publish('LessonStarted', {
      lessonId: ctx.lessonId || 'les_active',
      timestamp: Date.now(),
    });

    this.takeSnapshot();
  }

  public async pause(): Promise<void> {
    this.transitionState('Pause');
    this.scheduler.stop();

    await this.eventBus.publish('RuntimePaused', {
      elapsedTime: this.stateManager.getState().runtime.elapsedTime,
      timestamp: Date.now(),
    });
  }

  public async resume(): Promise<void> {
    this.transitionState('Resume');
    this.scheduler.start();
    this.transitionState('Running');
  }

  public async stop(): Promise<void> {
    const ctx = this.getContext();
    this.transitionState('Stop');

    await this.moduleRegistry.stopAll(ctx);
    this.scheduler.stop();

    this.takeSnapshot();
  }

  public async dispose(): Promise<void> {
    await this.stop();
    this.transitionState('Dispose');

    await this.serviceRegistry.disposeAll();
    this.hooksManager.clear();
    this.resourceManager.clear();
    this.eventBus.clear();
  }

  private transitionState(next: RuntimeLifecycleState): void {
    const prev = this.stateManager.getState().runtime.lifecycle;
    this.stateManager.setLifecycle(next);

    this.eventBus.publish('LifecycleChanged', {
      from: prev,
      to: next,
      timestamp: Date.now(),
    });
  }

  // ── Extension & Plugin API ─────────────────────────────────────────────

  public registerModule(module: IRuntimeModule): void {
    this.moduleRegistry.registerModule(module);
  }

  public registerService<T extends IRuntimeService>(service: T): void {
    this.serviceRegistry.registerService(service);
  }

  public registerRuntimeHook<T = Record<string, unknown>>(
    hookName: RuntimeHookName,
    callback: RuntimeHookCallback<T>
  ): () => void {
    return this.hooksManager.registerHook(hookName, callback);
  }

  public scheduleTask<T = unknown>(
    name: string,
    taskFn: () => Promise<T>,
    priority: TaskPriority = TaskPriority.Normal,
    delayMs = 0
  ): Promise<T> {
    return this.scheduler.schedule(name, taskFn, priority, delayMs);
  }

  // ── Session & Permissions ──────────────────────────────────────────────

  public setUser(user: UserParticipant): void {
    this.currentUser = user;
    this.currentRole = user.role;
  }

  public hasPermission(permission: import('./types.js').RuntimePermission): boolean {
    return this.permissionManager.hasPermission(this.currentRole, permission);
  }

  // ── Snapshots & Recovery ───────────────────────────────────────────────

  public takeSnapshot(): RuntimeSnapshot {
    return this.snapshotManager.takeSnapshot(
      this.stateManager.getState(),
      this.serviceRegistry.listServices(),
      this.moduleRegistry.listModules().map((m) => m.id),
      this.resourceManager.listResources()
    );
  }

  public restoreLatestSnapshot(): boolean {
    const snap = this.snapshotManager.getLatestSnapshot();
    if (!snap) return false;

    this.stateManager.setState(snap.stateTree);
    return true;
  }

  // ── Diagnostics Monitor ────────────────────────────────────────────────

  public getDiagnostics(): RuntimeDiagnostics {
    return this.monitor.getDiagnostics(
      this.stateManager.getState(),
      this.serviceRegistry.listServices().length,
      this.moduleRegistry.listModules().length,
      this.scheduler.getPendingTaskCount()
    );
  }
}
