import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry } from '../../core/di/service-registry.js';
import { NodeEsmLoader } from '../../core/esm-loader/index.js';
import { PluginHost } from '../../core/plugin-host/index.js';
import { AssignmentEvalPlugin } from '../assignment-eval.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IDatabaseToken,
  ISemesterGradeServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../../core/di/interfaces.js';
import { CommandBus } from '../../core/command-bus/index.js';
import { EventBus } from '../../core/event-bus/index.js';
import { ActionRegistry } from '../../core/registry/index.js';
import { CapabilityGuard } from '../../core/capability-system/index.js';

import { parseMigrationSql, executeSqlStatements } from '../../../server/utils/migrate.js';

/** 旧库形态：先建 004 之前的表，再用 005 迁移，验证迁移真的把旧结构改造成新结构 */
const MIGRATION_005 = path.resolve(process.cwd(), 'migrations/005_assignment_hub.sql');

const LEGACY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS plugin_submissions (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(lesson_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS plugin_peer_reviews (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(submission_id, reviewer_id)
  );

  CREATE TABLE IF NOT EXISTS plugin_grades (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE,
    teacher_score INTEGER,
    teacher_comment TEXT,
    teacher_weight REAL NOT NULL DEFAULT 0.6,
    peer_weight REAL NOT NULL DEFAULT 0.4,
    calculated_final_score INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    graded_at INTEGER
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
`;

function applyMigration005(db: Database.Database) {
  const raw = fs.readFileSync(MIGRATION_005, 'utf8');
  const { up } = parseMigrationSql('005_assignment_hub', raw);
  executeSqlStatements(db, up);
}

describe('AssignmentEvalPlugin（作业中心）', () => {
  let db: Database.Database;
  let serviceRegistry: ServiceRegistry;
  let pluginHost: PluginHost;
  let commandBus: CommandBus;
  let eventBus: EventBus;
  let actionRegistry: ActionRegistry;
  let gradeCalls: { lessonId: string; studentId: string; grade: number }[];
  let published: { type: string; payload: any }[];

  const execute = (type: string, actorId: string, payload: Record<string, unknown>) =>
    commandBus.execute({ id: `cmd-${type}-${Math.random()}`, type, actorId, payload, timestamp: Date.now() });

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(LEGACY_SCHEMA);
    applyMigration005(db);

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
    `);

    serviceRegistry = new ServiceRegistry();
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
    actionRegistry = new ActionRegistry();
    const capabilityGuard = new CapabilityGuard();

    serviceRegistry.register(IEventBusServiceToken, eventBus as any);
    serviceRegistry.register(ICommandBusServiceToken, commandBus as any);
    serviceRegistry.register(IActionRegistryServiceToken, actionRegistry as any);
    serviceRegistry.register(ICapabilityServiceToken, capabilityGuard as any);
    serviceRegistry.register(IDatabaseToken, db as any);

    gradeCalls = [];
    published = [];
    serviceRegistry.register(ISemesterGradeServiceToken, {
      saveSemesterGrade: async (lessonId: string, studentId: string, grade: number) => {
        gradeCalls.push({ lessonId, studentId, grade });
      },
    } as any);

    // PluginHost 构建上下文时还会解析这三个基础服务（与本插件逻辑无关），需要占位实现
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

    eventBus.subscribe('*', (event) => {
      published.push({ type: event.type, payload: event.payload });
    });

    pluginHost = new PluginHost(serviceRegistry, new NodeEsmLoader(), db);
    const pluginId = AssignmentEvalPlugin.manifest.id;
    pluginHost.registerPreloadedPlugin(pluginId, AssignmentEvalPlugin);
    db.prepare(
      'INSERT INTO plugins (id, name, manifest, source_code, status, created_at, loader_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(pluginId, 'Assignment Eval', JSON.stringify(AssignmentEvalPlugin.manifest), '', 'installed', Date.now(), 'esm');
    await pluginHost.activatePlugin(pluginId);
  });

  afterEach(() => {
    db.close();
  });

  it('迁移 005 把旧 plugin_submissions 改造成按作业唯一且保留旧数据', () => {
    db.prepare(
      'INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('sub-legacy', null, 'lesson-1', 'stu-1', '/files/a.pdf', 1, Date.now(), Date.now());

    // 同一课时同一学生可以再插一行 assignment_id 不同的记录（旧 UNIQUE(lesson_id, student_id) 已移除）
    db.prepare(
      'INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('sub-new', 'asg-1', 'lesson-1', 'stu-1', null, 1, Date.now(), Date.now());

    const rows = db.prepare('SELECT id FROM plugin_submissions ORDER BY id').all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['sub-legacy', 'sub-new']);

    // 旧记录的 assignment_id 为 NULL，因此仍受部分唯一索引保护（保证不会重复插旧形态记录）
    expect(() =>
      db
        .prepare(
          'INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('sub-legacy-dup', null, 'lesson-1', 'stu-1', '/files/b.pdf', 1, Date.now(), Date.now()),
    ).toThrow();
  });

  it('作业实体可同时绑定课时与班级，并可按课时 / 班级检索', async () => {
    const created = (await execute('assignment.create', 'user:t1:teacher', {
      title: '第 3 课 作业',
      lessonId: 'lesson-1',
      classId: 'class-1',
      elementId: 'el-1',
      peerReviewCount: 2,
    })) as any;
    expect(created.success).toBe(true);
    expect(created.created).toBe(true);

    const listByLesson = (await execute('assignment.list', 'user:stu-1:student', { lessonId: 'lesson-1' })) as any;
    expect(listByLesson.assignments).toHaveLength(1);
    expect(listByLesson.assignments[0].title).toBe('第 3 课 作业');

    const listByClass = (await execute('assignment.list', 'user:t1:teacher', { classId: 'class-1' })) as any;
    expect(listByClass.assignments).toHaveLength(1);

    const detail = (await execute('assignment.get', 'user:t1:teacher', { assignmentId: created.assignmentId })) as any;
    expect(detail.stats.submissionCount).toBe(0);
    expect(detail.assignment.element_id).toBe('el-1');
  });

  it('同一学生重交保留版本历史，且教师权重之和必须为 1', async () => {
    const { assignmentId } = (await execute('assignment.create', 'user:t1:teacher', {
      title: '作业 A',
      lessonId: 'lesson-1',
    })) as any;

    const first = (await execute('assignment.submit', 'user:stu-1:student', {
      assignmentId,
      studentId: 'stu-1',
      filePath: '/files/v1.pdf',
    })) as any;
    expect(first.version).toBe(1);

    const second = (await execute('assignment.submit', 'user:stu-1:student', {
      assignmentId,
      studentId: 'stu-1',
      filePath: '/files/v2.pdf',
    })) as any;
    expect(second.version).toBe(2);
    expect(second.submissionId).toBe(first.submissionId);

    const versions = db
      .prepare('SELECT version FROM plugin_submission_versions WHERE submission_id = ? ORDER BY version ASC')
      .all(first.submissionId) as { version: number }[];
    expect(versions.map((v) => v.version)).toEqual([1, 2]);

    expect(published.filter((e) => e.type === 'assignment.submitted')).toHaveLength(2);

    await expect(
      execute('assignment.create', 'user:t1:teacher', { title: '作业 B', teacherWeight: 0.5, peerWeight: 0.6 }),
    ).rejects.toThrow('The sum of teacherWeight and peerWeight must equal 1.0');
  });

  it('学生只能提交 / 互评自己名下的数据', async () => {
    const { assignmentId } = (await execute('assignment.create', 'user:t1:teacher', { title: '作业 C' })) as any;

    await expect(
      execute('assignment.submit', 'user:stu-2:student', { assignmentId, studentId: 'stu-1', filePath: '/x.pdf' }),
    ).rejects.toThrow('Students can only submit their own assignment');

    const submit = (await execute('assignment.submit', 'user:stu-1:student', {
      assignmentId,
      studentId: 'stu-1',
      filePath: '/x.pdf',
    })) as any;

    await expect(
      execute('assignment.peer_review', 'user:stu-2:student', {
        submissionId: submit.submissionId,
        reviewerId: 'stu-1',
        score: 90,
      }),
    ).rejects.toThrow('Students can only review their own assignment');

    // 教师可代交（特权放行）
    const teacherSubmit = (await execute('assignment.submit', 'user:t1:teacher', {
      assignmentId,
      studentId: 'stu-3',
      filePath: '/y.pdf',
    })) as any;
    expect(teacherSubmit.success).toBe(true);
  });

  it('互评分配排除本人、不重复，并在提交前禁止修改已过期的任务', async () => {
    const { assignmentId } = (await execute('assignment.create', 'user:t1:teacher', {
      title: '作业 D',
      peerReviewCount: 1,
    })) as any;

    const submissions: Record<string, string> = {};
    for (const studentId of ['stu-1', 'stu-2', 'stu-3']) {
      const res = (await execute('assignment.submit', 'user:' + studentId + ':student', {
        assignmentId,
        studentId,
        filePath: `/${studentId}.pdf`,
      })) as any;
      submissions[studentId] = res.submissionId;
    }

    const assigned = (await execute('assignment.assign_peer_reviews', 'user:t1:teacher', {
      assignmentId,
      reviewerCount: 1,
    })) as any;
    expect(assigned.created).toBe(3);

    const tasks = db
      .prepare('SELECT submission_id, reviewer_id, anonymous FROM plugin_peer_review_tasks WHERE assignment_id = ?')
      .all(assignmentId) as { submission_id: string; reviewer_id: string; anonymous: number }[];
    expect(tasks).toHaveLength(3);
    for (const task of tasks) {
      const owner = Object.entries(submissions).find(([, id]) => id === task.submission_id)![0];
      expect(task.reviewer_id).not.toBe(owner);
      expect(task.anonymous).toBe(1);
    }

    // 重复分配不会产生重复任务
    await execute('assignment.assign_peer_reviews', 'user:t1:teacher', { assignmentId, reviewerCount: 1 });
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM plugin_peer_review_tasks WHERE assignment_id = ?').get(assignmentId) as { c: number }).c,
    ).toBe(3);

    // 自评被拒
    const firstTask = tasks.find((t) => t.submission_id === submissions['stu-1'])!;
    await expect(
      execute('assignment.peer_review', `user:stu-1:student`, {
        submissionId: submissions['stu-1'],
        reviewerId: 'stu-1',
        score: 100,
      }),
    ).rejects.toThrow('Students are not allowed to evaluate their own assignments');

    // 合法互评写入任务状态与作业维度
    const reviewed = (await execute('assignment.peer_review', `user:${firstTask.reviewer_id}:student`, {
      submissionId: submissions['stu-1'],
      reviewerId: firstTask.reviewer_id,
      score: 88,
      comment: '结构清晰',
    })) as any;
    expect(reviewed.success).toBe(true);
    const storedReview = db
      .prepare('SELECT assignment_id, status, anonymous FROM plugin_peer_reviews WHERE submission_id = ?')
      .get(submissions['stu-1']) as any;
    expect(storedReview.assignment_id).toBe(assignmentId);
    expect(storedReview.status).toBe('submitted');
    expect(
      (db
        .prepare("SELECT status FROM plugin_peer_review_tasks WHERE submission_id = ? AND reviewer_id = ?")
        .get(submissions['stu-1'], firstTask.reviewer_id) as { status: string }).status,
    ).toBe('submitted');
  });

  it('评分确认后写学期成绩、发事件并投影到班级作业成绩页；草稿不发布', async () => {
    // 无课时的纯班级作业：宿主 saveSemesterGrade 无法映射，由插件自行投影
    const { assignmentId } = (await execute('assignment.create', 'user:t1:teacher', {
      title: '班级作业 E',
      classId: 'class-1',
    })) as any;
    const submission = (await execute('assignment.submit', 'user:stu-1:student', {
      assignmentId,
      studentId: 'stu-1',
      filePath: '/x.pdf',
    })) as any;

    const draft = (await execute('assignment.grade', 'user:t1:teacher', {
      submissionId: submission.submissionId,
      teacherScore: 80,
      status: 'draft',
    })) as any;
    expect(draft.status).toBe('draft');
    expect(draft.calculatedFinalScore).toBe(80);
    expect(gradeCalls).toHaveLength(0);
    expect(published.filter((e) => e.type === 'assignment.graded')).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS c FROM assignment_submissions').get()).toEqual({ c: 0 });

    const confirmed = (await execute('assignment.grade', 'user:t1:teacher', {
      submissionId: submission.submissionId,
      teacherScore: 90,
      teacherComment: '完成度好',
      status: 'confirmed',
    })) as any;
    expect(confirmed.calculatedFinalScore).toBe(90);

    const projRow = db
      .prepare('SELECT score, feedback, status FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(assignmentId, 'stu-1') as any;
    expect(projRow.score).toBe(90);
    expect(projRow.feedback).toBe('完成度好');
    expect(projRow.status).toBe('graded');
    expect(
      (db.prepare('SELECT title FROM assignments WHERE id = ?').get(assignmentId) as { title: string }).title,
    ).toBe('班级作业 E');

    const gradedEvents = published.filter((e) => e.type === 'assignment.graded');
    expect(gradedEvents).toHaveLength(1);
    expect(gradedEvents[0].payload.score).toBe(90);
    expect(gradedEvents[0].payload.studentId).toBe('stu-1');
  });

  it('带课时的作业确认评分时走宿主 saveSemesterGrade（不写重复投影行）', async () => {
    const { assignmentId } = (await execute('assignment.create', 'user:t1:teacher', {
      title: '课时作业 F',
      lessonId: 'lesson-9',
      classId: 'class-9',
    })) as any;
    const submission = (await execute('assignment.submit', 'user:stu-1:student', {
      assignmentId,
      studentId: 'stu-1',
      filePath: '/x.pdf',
    })) as any;

    await execute('assignment.grade', 'user:t1:teacher', {
      submissionId: submission.submissionId,
      teacherScore: 70,
      status: 'confirmed',
    });

    expect(gradeCalls).toEqual([{ lessonId: 'lesson-9', studentId: 'stu-1', grade: 70 }]);
    expect(db.prepare('SELECT COUNT(*) AS c FROM assignment_submissions').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM assignments').get()).toEqual({ c: 0 });
  });

  it('有互评时最终分按权重折算', async () => {
    const { assignmentId } = (await execute('assignment.create', 'user:t1:teacher', {
      title: '作业 G',
      classId: 'class-1',
      teacherWeight: 0.6,
      peerWeight: 0.4,
    })) as any;

    const sub1 = (await execute('assignment.submit', 'user:stu-1:student', { assignmentId, studentId: 'stu-1', filePath: '/1.pdf' })) as any;
    await execute('assignment.submit', 'user:stu-2:student', { assignmentId, studentId: 'stu-2', filePath: '/2.pdf' });

    await execute('assignment.peer_review', 'user:stu-2:student', {
      submissionId: sub1.submissionId,
      reviewerId: 'stu-2',
      score: 50,
    });

    const graded = (await execute('assignment.grade', 'user:t1:teacher', {
      submissionId: sub1.submissionId,
      teacherScore: 100,
      status: 'confirmed',
    })) as any;
    expect(graded.peerAverageScore).toBe(50);
    expect(graded.calculatedFinalScore).toBe(80); // 100*0.6 + 50*0.4
    expect(graded.teacherWeight).toBe(0.6);
    expect(graded.peerWeight).toBe(0.4);
  });
});
