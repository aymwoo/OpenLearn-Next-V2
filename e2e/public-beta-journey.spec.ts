import { expect, request as playwrightRequest, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.OPENLEARN_BETA_E2E_DIR || '/tmp/openlearn-beta-e2e';
const TEACHER_PASSWORD = 'TeacherBeta#2026';
/** 与 scripts/e2e-beta-server.mjs 的 OPENLEARN_ADMIN_PASSWORD 保持一致。生产启动拒绝口令等于用户名。 */
const ADMIN_PASSWORD = 'Ol-BetaE2e-Adm-7kQ9';
const STUDENT_PASSWORD = 'StuBeta#2026';
const OTHER_PASSWORD = 'OtherBeta#2026';
const STUDENT_NUMBER = 'SBETA001';
const SECRET_ANSWER = 'BetaSecretAnswer-do-not-log';

const PLUGIN_SOURCE = `
export default {
  manifest: {
    id: 'ext-beta-probe',
    name: 'Beta Probe',
    version: '1.0.0',
    main: 'index.js',
    requires: [],
    capabilitiesProposed: [],
  },
  activate: async () => {},
  deactivate: async () => {},
};
`;

async function bodyOf(res: APIResponse): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`non-json ${res.status()}: ${text.slice(0, 400)}`);
  }
}

async function login(ctx: APIRequestContext, data: Record<string, unknown>) {
  const res = await ctx.post('/api/auth/login', { data });
  const body = await bodyOf(res);
  return { res, body };
}

test('公测关键旅程：作业、越权、插件与观测', async () => {
  const admin = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:9107' });
  const teacher = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:9107' });
  const student = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:9107' });
  const outsider = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:9107' });
  const anon = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:9107' });

  try {
    const live = await anon.get('/health');
    expect(live.status()).toBe(200);
    const liveBody = await bodyOf(live);
    expect(liveBody.status).toBe('ok');
    expect(liveBody).not.toHaveProperty('db');

    const ready = await anon.get('/health/ready');
    expect(ready.status(), '就绪检查应通过').toBe(200);
    const readyBody = await bodyOf(ready);
    expect(readyBody).toEqual({ status: 'ready' });

    const metricsDenied = await anon.get('/metrics');
    expect(metricsDenied.status()).toBe(401);
    const metrics = await anon.get('/metrics', { headers: { Authorization: 'Bearer beta-metrics-secret' } });
    expect(metrics.status()).toBe(200);
    expect(await metrics.text()).toContain('openlearn_up 1');

    const firstLogin = await login(admin, { entrance: 'teacher', username: 'admin', password: ADMIN_PASSWORD });
    expect(firstLogin.res.status()).toBe(200);
    // 强口令不等于用户名，种子行的 must_change_password 为 0，登录后不进强制改密。
    expect((firstLogin.body.session as { mustChangePassword?: boolean }).mustChangePassword).toBeFalsy();

    const classesAfter = await admin.get('/api/classes');
    expect(classesAfter.status(), '强口令管理员应能访问业务接口').toBe(200);

    const createdUser = await admin.post('/api/users', {
      data: { username: 'beta_other', password: OTHER_PASSWORD, role: 'teacher', name: '另一位教师' },
    });
    expect(createdUser.ok(), await createdUser.text()).toBeTruthy();

    const badLogin = await login(anon, { entrance: 'teacher', username: 'teacher', password: 'wrong-password' });
    expect(badLogin.res.status()).toBe(401);

    const teacherLogin = await login(teacher, { entrance: 'teacher', username: 'teacher', password: TEACHER_PASSWORD });
    expect(teacherLogin.res.status(), JSON.stringify(teacherLogin.body)).toBe(200);
    expect((teacherLogin.body.session as { mustChangePassword?: boolean }).mustChangePassword).toBeFalsy();

    const classRes = await teacher.post('/api/classes', { data: { name: '公测旅程班', description: 'e2e' } });
    expect(classRes.ok(), await classRes.text()).toBeTruthy();
    const classId = String((await bodyOf(classRes)).id || '');
    expect(classId).not.toBe('');

    const enroll = await teacher.post(`/api/classes/${classId}/students/bulk-enroll`, {
      data: { students: [{ name: '公测学生', student_number: STUDENT_NUMBER, password: STUDENT_PASSWORD }] },
    });
    expect(enroll.ok(), await enroll.text()).toBeTruthy();
    const enrollBody = await bodyOf(enroll);
    const enrolled = (enrollBody.results as Array<{ id: string; student_number: string }>)[0];
    expect(enrolled.student_number).toBe(STUDENT_NUMBER);

    const assignmentRes = await teacher.post('/api/assignments', {
      data: {
        title: '公测旅程作业',
        classId,
        allowText: true,
        teacherWeight: 1,
        peerWeight: 0,
        status: 'published',
      },
    });
    expect(assignmentRes.ok(), await assignmentRes.text()).toBeTruthy();
    const assignmentId = String((await bodyOf(assignmentRes)).assignmentId || '');
    expect(assignmentId).not.toBe('');

    const studentLogin = await login(student, {
      entrance: 'student',
      studentId: STUDENT_NUMBER,
      password: STUDENT_PASSWORD,
    });
    expect(studentLogin.res.status(), JSON.stringify(studentLogin.body)).toBe(200);

    const submit = await student.post(`/api/assignments/${assignmentId}/submit`, {
      data: { textContent: '公测学生的作答' },
    });
    expect(submit.ok(), await submit.text()).toBeTruthy();
    const submissionId = String((await bodyOf(submit)).submissionId || '');
    expect(submissionId).not.toBe('');

    const grade = await teacher.post('/api/commands', {
      data: {
        commandType: 'assignment.grade',
        payload: {
          submissionId,
          teacherScore: 88,
          teacherComment: '已批改',
          teacherWeight: 1,
          peerWeight: 0,
          status: 'confirmed',
        },
      },
    });
    expect(grade.ok(), await grade.text()).toBeTruthy();
    const gradeBody = await bodyOf(grade);
    const result = (gradeBody.result || gradeBody) as { calculatedFinalScore?: number };
    expect(result.calculatedFinalScore).toBe(88);

    const viewed = await teacher.get(`/api/assignments/${assignmentId}?studentId=${encodeURIComponent(enrolled.id)}`);
    expect(viewed.ok(), await viewed.text()).toBeTruthy();
    const viewedBody = await bodyOf(viewed);
    const gradeRow = viewedBody.grade as { calculated_final_score?: number } | null;
    expect(gradeRow?.calculated_final_score).toBe(88);

    const outsiderLogin = await login(outsider, {
      entrance: 'teacher',
      username: 'beta_other',
      password: OTHER_PASSWORD,
    });
    expect(outsiderLogin.res.status(), JSON.stringify(outsiderLogin.body)).toBe(200);
    const crossRead = await outsider.get(`/api/assignments/${assignmentId}`);
    expect(crossRead.status()).toBe(403);
    const crossList = await outsider.get(`/api/classes/${classId}/assignments`);
    expect(crossList.status()).toBe(403);
    const crossGrade = await outsider.post('/api/commands', {
      data: {
        commandType: 'assignment.grade',
        payload: { submissionId, teacherScore: 1, teacherWeight: 1, peerWeight: 0, status: 'draft' },
      },
    });
    expect(crossGrade.status()).toBe(403);

    const installed = await admin.post('/api/plugins', { data: { sourceCode: PLUGIN_SOURCE } });
    expect(installed.ok(), await installed.text()).toBeTruthy();
    const manifest = (await bodyOf(installed)).manifest as { id?: string };
    expect(manifest.id).toBe('ext-beta-probe');

    const toggled = await admin.post('/api/plugins/ext-beta-probe/toggle');
    expect(toggled.ok(), await toggled.text()).toBeTruthy();
    expect((await bodyOf(toggled)).status).toBe('active');

    const approved = await admin.post('/api/plugins/ext-beta-probe/public-routes', {
      data: { approvePublicRoutes: true },
    });
    expect(approved.ok(), await approved.text()).toBeTruthy();

    const reported = await anon.post('/api/client-errors', {
      data: {
        source: 'runtime',
        message: `password=${SECRET_ANSWER}`,
        stack: `textContent=${SECRET_ANSWER}`,
        path: '/classroom?passcode=9999',
      },
    });
    expect(reported.status()).toBe(204);

    const auditPath = path.join(DATA_DIR, 'logs', 'audit.log');
    const appLogPath = path.join(DATA_DIR, 'logs', 'openlearn.log');
    await expect
      .poll(() => (fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8') : ''), { timeout: 10_000 })
      .toContain('auth.login_failed');
    const auditLog = fs.readFileSync(auditPath, 'utf8');
    for (const event of ['auth.forbidden', 'plugin.installed', 'plugin.enabled', 'plugin.public_route_approved']) {
      expect(auditLog, event).toContain(event);
    }
    expect(auditLog).not.toContain(SECRET_ANSWER);
    expect(auditLog).not.toContain(STUDENT_PASSWORD);
    expect(auditLog).not.toContain('公测学生的作答');

    const appLog = fs.existsSync(appLogPath) ? fs.readFileSync(appLogPath, 'utf8') : '';
    expect(appLog).toContain('error.captured');
    expect(appLog).not.toContain(SECRET_ANSWER);
    expect(appLog).toContain('requestId');
  } finally {
    await Promise.all([admin.dispose(), teacher.dispose(), student.dispose(), outsider.dispose(), anon.dispose()]);
  }
});
