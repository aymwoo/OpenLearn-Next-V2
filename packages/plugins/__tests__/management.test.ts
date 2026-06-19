import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { EsmLoader } from '../../core/esm-loader/esm-loader.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { ManagementPlugin } from '../management.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  IDatabaseToken,
} from '../../core/di/interfaces.js';
import { CommandBus } from '../../core/command-bus/index.js';
import { EventBus } from '../../core/event-bus/index.js';
import { ActionRegistry } from '../../core/registry/index.js';
import { CapabilityGuard } from '../../core/capability-system/index.js';

describe('ManagementPlugin', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let capabilityGuard: CapabilityGuard;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        manifest TEXT NOT NULL,
        source_code TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        loader_version TEXT,
        execution_mode TEXT
      );

      CREATE TABLE IF NOT EXISTS classes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        class_passcode TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        student_number TEXT UNIQUE,
        name TEXT NOT NULL,
        email TEXT,
        password TEXT,
        locked_lesson_id TEXT,
        private_notes TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS class_students (
        class_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (class_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL,
        lesson_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        content TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignment_submissions (
        assignment_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        content TEXT,
        score INTEGER,
        feedback TEXT,
        submitted_at INTEGER NOT NULL,
        graded_at INTEGER,
        status TEXT NOT NULL DEFAULT 'submitted',
        PRIMARY KEY (assignment_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        scheduled_date TEXT NOT NULL,
        time_slot TEXT,
        status TEXT DEFAULT 'scheduled',
        notes TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attendance (
        schedule_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        status TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        PRIMARY KEY (schedule_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS student_lesson_progress (
        student_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        progress_percent INTEGER NOT NULL DEFAULT 0,
        completed_segments TEXT,
        assigned_at INTEGER NOT NULL,
        PRIMARY KEY (student_id, lesson_id)
      );

      CREATE TABLE IF NOT EXISTS computer_labs (
        id TEXT PRIMARY KEY,
        room_number TEXT NOT NULL,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS student_seats (
        class_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        lab_id TEXT NOT NULL,
        row_idx INTEGER NOT NULL,
        col_idx INTEGER NOT NULL,
        PRIMARY KEY (class_id, student_id)
      );
    `);

    serviceRegistry = new ServiceRegistry();
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
    actionRegistry = new ActionRegistry();
    capabilityGuard = new CapabilityGuard();

    serviceRegistry.register(IEventBusServiceToken, eventBus as any);
    serviceRegistry.register(ICommandBusServiceToken, commandBus as any);
    serviceRegistry.register(IActionRegistryServiceToken, actionRegistry as any);
    serviceRegistry.register(ICapabilityServiceToken, capabilityGuard as any);
    serviceRegistry.register(IDatabaseToken, db as any);

    // Register empty mocks for remaining required core services
    serviceRegistry.register(IProcessServiceToken, {
      registerHandler: async () => {},
      unregisterHandler: async () => {},
      restore: async () => {},
    } as any);
    serviceRegistry.register(IStorageServiceToken, {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    } as any);
    serviceRegistry.register(IAIServiceToken, {
      generateText: async () => '',
    } as any);

    pluginHost = new PluginHost(serviceRegistry, new EsmLoader(), db);
  });

  afterEach(() => {
    db.close();
  });

  it('should successfully register, activate and run Management commands', async () => {
    const pluginId = '@openlearn/plugin-management';
    pluginHost.registerPreloadedPlugin(pluginId, ManagementPlugin);

    // Setup initial DB entry
    db.prepare('INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(pluginId, 'Management', JSON.stringify(ManagementPlugin.manifest), '', 'installed', Date.now(), 'esm');

    await pluginHost.activatePlugin(pluginId);

    // Verify actions registered
    const actions = await actionRegistry.getAllActions();
    const actionTypes = actions.map(a => a.commandType);
    expect(actionTypes).toContain('class.create');
    expect(actionTypes).toContain('student.create');
    expect(actionTypes).toContain('class.add_student');
    expect(actionTypes).toContain('class.get_students');

    // Grant capabilities to allow execution
    const actorId = `plugin:${ManagementPlugin.manifest.id}`;
    capabilityGuard.grant(actorId, 'management:write');
    capabilityGuard.grant(actorId, 'management:read');

    // 1. Create a class
    const createClassRes = await commandBus.execute({
      id: 'cmd-class-create',
      type: 'class.create',
      actorId,
      payload: {
        name: 'Math 101',
        description: 'Basic Mathematics'
      },
      timestamp: Date.now()
    }) as any;

    expect(createClassRes.classId).toBeDefined();
    const classId = createClassRes.classId;

    // 2. Create a student
    const createStudentRes = await commandBus.execute({
      id: 'cmd-student-create',
      type: 'student.create',
      actorId,
      payload: {
        name: 'Alice',
        email: 'alice@openlearn.org'
      },
      timestamp: Date.now()
    }) as any;

    expect(createStudentRes.studentId).toBeDefined();
    const studentId = createStudentRes.studentId;

    // 3. Add student to class
    const addStudentRes = await commandBus.execute({
      id: 'cmd-add-student',
      type: 'class.add_student',
      actorId,
      payload: {
        classId,
        studentId
      },
      timestamp: Date.now()
    }) as any;

    expect(addStudentRes.success).toBe(true);

    // 4. Get students in class
    const getStudentsRes = await commandBus.execute({
      id: 'cmd-get-students',
      type: 'class.get_students',
      actorId,
      payload: {
        classId
      },
      timestamp: Date.now()
    }) as any;

    expect(getStudentsRes.students).toBeDefined();
    expect(getStudentsRes.students.length).toBe(1);
    expect(getStudentsRes.students[0].id).toBe(studentId);
    expect(getStudentsRes.students[0].name).toBe('Alice');
  });
});
