/**
 * StageGuard 资源级物理强门禁集成测试
 *
 * 验证：
 * 1. 未绑定环节的测验：全局放行；
 * 2. 通过 element.data.segmentId 绑定的测验：
 *    - 环节锁定时直接调 /quiz-submit 返回 403 Forbidden，lesson_quiz_submissions 零落库；
 *    - 环节解锁后再次提交放行并落库；
 * 3. 通过 timeline.elementIds 绑定的测验：
 *    - 环节锁定时返回 403 Forbidden；
 *    - 环节解锁后放行；
 * 4. 教师角色作答预览：免除环节准入门禁；
 * 5. Fail-close 语义一致性：守卫抛错或超时拒绝写入，杜绝跳关；
 * 6. 作业提交环节门禁：未解锁环节禁止交作业。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import path from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import {
  IStageGuardServiceToken,
  IDatabaseToken,
  ISemesterGradeServiceToken,
} from '../../packages/core/di/interfaces.js';
import { defaultStageGuardPipeline } from '../../packages/core/lesson-engine/stage-guard-pipeline.js';
import type { StageGuard } from '../../packages/core/di/interfaces.js';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { registerAssignmentHubRoutes } from '../routes/assignment-hub.js';
import { AssignmentEvalPlugin } from '../../packages/plugins/assignment-eval.js';
import { createMockContext } from '../../packages/plugin-test-kit/index.js';

describe('StageGuard 资源级物理强门禁 (Resource-level Enforcement)', () => {
  let app: express.Express;
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;
  const db = kernelContainer.db;

  const STUDENT_ID = 'stu_guard_res_001';
  const STUDENT_TOKEN = 'tok_guard_res_student';
  const studentCookie = { Cookie: `edu_os_token=${STUDENT_TOKEN}` };

  const TEACHER_ID = 'tea_guard_res_001';
  const TEACHER_TOKEN = 'tok_guard_res_teacher';
  const teacherCookie = { Cookie: `edu_os_token=${TEACHER_TOKEN}` };

  const lessonId = `les_guard_res_${Date.now()}`;
  const serverScores = new Map<string, number>();

  beforeAll(async () => {
    runMigrations(db, loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations')));

    // 绑定真实的 StageGuardPipeline 单例
    (kernelContainer as any).serviceRegistry = {
      resolve: async (token: any) => (token === IStageGuardServiceToken ? defaultStageGuardPipeline : undefined),
      resolveByName: async () => undefined,
      register: () => {},
    };

    const now = Date.now();
    // 1. 初始化学生账号与会话
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(STUDENT_ID, 'guard_res_stu', 'hash', 'student', '物理门禁学生', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      STUDENT_TOKEN,
      JSON.stringify({ userId: STUDENT_ID, studentId: STUDENT_ID, role: 'student', username: 'guard_res_stu' }),
      now,
      now + 3_600_000,
    );

    // 2. 初始化教师账号与会话
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(TEACHER_ID, 'guard_res_tea', 'hash', 'teacher', '物理门禁教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      TEACHER_TOKEN,
      JSON.stringify({ userId: TEACHER_ID, role: 'teacher', username: 'guard_res_tea' }),
      now,
      now + 3_600_000,
    );

    // 3. 初始课程与时间轴：seg-1 (基础), seg-2 (进阶，通过 data.segmentId 绑定), seg-3 (高阶，通过 timeline.elementIds 绑定)
    const timeline = [
      { id: 'seg-1', title: '第1环节：导入与基础', type: 'intro' },
      { id: 'seg-2', title: '第2环节：进阶测验', type: 'practice' },
      { id: 'seg-3', title: '第3环节：高阶作业与测验', type: 'advanced', elementIds: ['el_quiz_seg3', 'asg_seg3'] },
    ];

    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(lessonId, '物理门禁测试课', '', JSON.stringify(timeline), 'manual', TEACHER_ID, now, now);

    // 4. 初始化应用路由
    app = express();
    app.use(express.json());

    registerLessonsRoutes({
      app,
      io: { emit: () => {} } as any,
      loginLimiter: () => (_req: any, _res: any, next: any) => next(),
      aiLimiter: () => (_req: any, _res: any, next: any) => next(),
      activityRegistry: {} as any,
    } as any);

    registerAssignmentHubRoutes({
      app,
      upload: { single: () => (_req: any, _res: any, next: any) => next() } as any,
    } as any);

    // 激活 AssignmentEvalPlugin 以处理 assignment.submit
    const mockCtx = createMockContext({
      pluginId: '@openlearn/plugin-assignment-eval',
      overrides: {
        commandBus: kernelContainer.commandBus,
        actionRegistry: kernelContainer.actionRegistry,
        eventBus: kernelContainer.eventBus,
      },
    });
    await mockCtx.provide(IDatabaseToken, db as any);
    await mockCtx.provide(ISemesterGradeServiceToken, { saveSemesterGrade: async () => {} } as any);
    await mockCtx.provide(IStageGuardServiceToken, defaultStageGuardPipeline);
    await AssignmentEvalPlugin.activate(mockCtx as any);

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  beforeEach(() => {
    serverScores.clear();
    defaultStageGuardPipeline.clear();
    // 清空测试提交记录与图元/作业记录
    db.prepare('DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM plugin_submissions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM plugin_assignments WHERE lesson_id = ?').run(lessonId);
  });

  async function postQuizSubmit(elementId: string, answer: any, headers = studentCookie) {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/quiz-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ elementId, answer, timeSpentMs: 1200 }),
    });
    return { status: res.status, body: await res.json() };
  }

  it('1. 全局独立测验（未绑定任何环节）：不受门禁约束，自由提交并落库', async () => {
    const globalElId = `el_quiz_global_${uuidv7()}`;
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      globalElId,
      lessonId,
      'quiz',
      JSON.stringify({ question: '1+1=?', correctAnswer: '2' }),
      Date.now(),
    );

    // 注册全局门禁：非 seg-1 环节需要 100 分
    defaultStageGuardPipeline.registerGuard({
      id: 'gate-strict',
      name: '严格门禁',
      canEnterStage: async () => ({ allowed: false, reason: '全环节锁定' }),
    });

    // 提交未绑定环节的测验，应正常通过
    const res = await postQuizSubmit(globalElId, '2');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.score).toBe(100);

    // 数据库中应存在落库记录
    const saved = db
      .prepare('SELECT score FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ?')
      .get(lessonId, globalElId) as any;
    expect(saved).toBeDefined();
    expect(saved.score).toBe(100);
  });

  it('2. 通过 element.data.segmentId 绑定的测验：环节锁定时 403 拒绝写入，解锁后放行', async () => {
    const seg2ElId = `el_quiz_seg2_${uuidv7()}`;
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      seg2ElId,
      lessonId,
      'quiz',
      JSON.stringify({
        question: '光合作用释放的气体是？',
        correctAnswer: '氧气',
        segmentId: 'seg-2', // 显式绑定到 seg-2
      }),
      Date.now(),
    );

    // 注册 seg-2 准入门禁：需要学生在 seg-1 测验得分 >= 80
    defaultStageGuardPipeline.registerGuard({
      id: 'guard-seg2',
      name: '第1环节过关守卫',
      canEnterStage: async ({ studentId, targetStageId }) => {
        if (targetStageId !== 'seg-2') return { allowed: true };
        const score = serverScores.get(studentId) ?? 0;
        if (score < 80) {
          return { allowed: false, reason: `需先通过第1环节基础测验且得分≥80分（当前：${score}分）` };
        }
        return { allowed: true };
      },
    });

    // 步骤 A: 未达到条件时直接调 /quiz-submit 接口跳关作答
    const denied = await postQuizSubmit(seg2ElId, '氧气');
    expect(denied.status).toBe(403);
    expect(denied.body.success).toBe(false);
    expect(denied.body.error).toContain('需先通过第1环节基础测验且得分≥80分');

    // 物理强门禁验证：数据库零落库，防跳关生效
    const orphanRow = db
      .prepare('SELECT id FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ?')
      .get(lessonId, seg2ElId);
    expect(orphanRow).toBeUndefined();

    // 步骤 B: 达成条件（记入第1环节及格成绩）
    serverScores.set(STUDENT_ID, 85);

    // 再次提交同一测验，应成功落库
    const allowed = await postQuizSubmit(seg2ElId, '氧气');
    expect(allowed.status).toBe(200);
    expect(allowed.body.success).toBe(true);
    expect(allowed.body.isCorrect).toBe(true);

    const savedRow = db
      .prepare('SELECT score FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ?')
      .get(lessonId, seg2ElId) as any;
    expect(savedRow).toBeDefined();
    expect(savedRow.score).toBe(100);
  });

  it('3. 通过 timeline.elementIds 绑定的测验：无内嵌 segmentId 时仍能准确拦截与放行', async () => {
    const seg3ElId = 'el_quiz_seg3'; // 在 beforeAll 的 timeline 中被 seg-3.elementIds 引用
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      seg3ElId,
      lessonId,
      'quiz',
      JSON.stringify({
        question: 'E=mc^2 中 c 代表？',
        correctAnswer: '光速',
        // 刻意不写 segmentId，测试从 timeline.elementIds 反查解析能力
      }),
      Date.now(),
    );

    defaultStageGuardPipeline.registerGuard({
      id: 'guard-seg3',
      name: '第3环节高阶门禁',
      canEnterStage: async ({ targetStageId }) => {
        if (targetStageId === 'seg-3') {
          const unlocked = serverScores.get('seg-3-unlocked') === 1;
          return unlocked ? { allowed: true } : { allowed: false, reason: '第3环节尚未向全班开启' };
        }
        return { allowed: true };
      },
    });

    // 锁定状态下提交 -> 403 拦截
    const denied = await postQuizSubmit(seg3ElId, '光速');
    expect(denied.status).toBe(403);
    expect(denied.body.error).toContain('第3环节尚未向全班开启');

    const notSaved = db
      .prepare('SELECT id FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ?')
      .get(lessonId, seg3ElId);
    expect(notSaved).toBeUndefined();

    // 解锁后提交 -> 放行
    serverScores.set('seg-3-unlocked', 1);
    const allowed = await postQuizSubmit(seg3ElId, '光速');
    expect(allowed.status).toBe(200);
    expect(allowed.body.success).toBe(true);
  });

  it('4. 教师角色作答预览：免除环节准入门禁约束', async () => {
    const seg2ElId = `el_quiz_teacher_preview_${uuidv7()}`;
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      seg2ElId,
      lessonId,
      'quiz',
      JSON.stringify({ question: '测试题', correctAnswer: 'A', segmentId: 'seg-2' }),
      Date.now(),
    );

    // 注册永久拒绝门禁
    defaultStageGuardPipeline.registerGuard({
      id: 'block-all',
      name: '封锁守卫',
      canEnterStage: async () => ({ allowed: false, reason: '此题学生不可进' }),
    });

    // 教师带 teacherCookie 提交测验作答预览，应放行
    const teacherRes = await postQuizSubmit(seg2ElId, 'A', teacherCookie);
    expect(teacherRes.status).toBe(200);
    expect(teacherRes.body.success).toBe(true);
  });

  it('5. Fail-close 语义一致性：守卫抛错或超时拒绝写入，杜绝跳关', async () => {
    const seg2ElId = `el_quiz_fail_close_${uuidv7()}`;
    db.prepare(
      'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      seg2ElId,
      lessonId,
      'quiz',
      JSON.stringify({ question: '故障注入测试', correctAnswer: 'T', segmentId: 'seg-2' }),
      Date.now(),
    );

    // 注册异常守卫
    defaultStageGuardPipeline.registerGuard({
      id: 'faulty-guard',
      name: '崩溃守卫',
      canEnterStage: async () => {
        throw new Error('Database connection failed in guard');
      },
    });

    const res = await postQuizSubmit(seg2ElId, 'T');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('门禁插件「崩溃守卫」执行出错');

    const notWritten = db
      .prepare('SELECT id FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ?')
      .get(lessonId, seg2ElId);
    expect(notWritten).toBeUndefined();
  });

  it('6. 作业提交环节门禁：未解锁环节禁止交作业 (assignment.submit)', async () => {
    const asgId = 'asg_seg3'; // 在 timeline 中被 seg-3 引用
    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO plugin_assignments
         (id, class_id, lesson_id, element_id, title, description, status, allow_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'published', 1, ?, ?)`,
    ).run(asgId, null, lessonId, asgId, '第3环节高阶作业', '', now, now);

    defaultStageGuardPipeline.registerGuard({
      id: 'guard-asg-seg3',
      name: '作业环节门禁',
      canEnterStage: async ({ targetStageId }) => {
        if (targetStageId === 'seg-3') {
          const ok = serverScores.get('asg-seg3-open') === 1;
          return ok ? { allowed: true } : { allowed: false, reason: '第3环节作业尚未开放' };
        }
        return { allowed: true };
      },
    });

    const submitCmd = kernelContainer.commandBus.createCommand(
      'assignment.submit',
      { assignmentId: asgId, studentId: STUDENT_ID, textContent: '我的作业答案' },
      `user:${STUDENT_ID}:student`,
    );

    // 尝试提交：应被 StageGuard 拦截
    await expect(kernelContainer.commandBus.execute(submitCmd)).rejects.toThrow(
      'Stage access denied: 第3环节作业尚未开放',
    );

    // 解锁后再次提交：应成功
    serverScores.set('asg-seg3-open', 1);
    const result = (await kernelContainer.commandBus.execute(submitCmd)) as any;
    expect(result.success).toBe(true);
    expect(result.submissionId).toBeDefined();
  });
});
