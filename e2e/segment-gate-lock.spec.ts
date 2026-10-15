import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function loginAdmin(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', {
    data: { entrance: 'teacher', username: 'admin', password: 'admin' },
  });
  expect(res.ok()).toBeTruthy();
}

test('未完成练习的学生在全班进入下一环节时看到锁定，提交后解锁', async ({ page, request, context }) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const title = `E2E 环节门槛 ${suffix}`;
  const studentNum = `STU_GATE_${suffix}`;
  let lessonId = '';
  let studentId = '';
  let classId = '';

  const cleanup = async () => {
    await loginAdmin(request).catch(() => {});
    if (lessonId) await request.delete(`/api/lessons/${encodeURIComponent(lessonId)}`).catch(() => {});
    if (studentId) await request.delete(`/api/students/${encodeURIComponent(studentId)}`).catch(() => {});
    if (classId) await request.delete(`/api/classes/${encodeURIComponent(classId)}`).catch(() => {});
  };

  try {
    await loginAdmin(request);
    const classRes = await request.post('/api/classes', { data: { name: `E2E 环节门槛班级 ${suffix}` } });
    expect(classRes.ok()).toBeTruthy();
    const classBody = await classRes.json();
    classId = classBody.id || classBody.class?.id || classBody.result?.id;

    const lessonRes = await request.post('/api/lessons', { data: { title, content: '环节门槛' } });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonBody = await lessonRes.json();
    lessonId = lessonBody.result?.lessonId || lessonBody.lessonId || lessonBody.id;

    const stuRes = await request.post('/api/students', {
      data: { name: `门槛学生 ${suffix}`, student_number: studentNum, password: 'password123' },
    });
    expect(stuRes.ok()).toBeTruthy();
    const stuBody = await stuRes.json();
    studentId = stuBody.id || stuBody.student?.id;
    if (classId && studentId) {
      await request
        .post(`/api/classes/${encodeURIComponent(classId)}/students`, {
          data: { studentId },
        })
        .catch(() => {});
    }

    const draw = await request.post(`/api/lessons/${lessonId}/whiteboard`, {
      data: {
        type: 'quiz',
        data: { question: '1+1=?', options: ['2', '3'], correctAnswer: 'A', segmentId: 'seg-a' },
      },
    });
    expect(draw.ok()).toBeTruthy();
    const board = await request.get(`/api/lessons/${lessonId}/whiteboard`);
    const elements = await board.json();
    const quiz = (Array.isArray(elements) ? elements : elements.elements || []).find(
      (el: { type?: string }) => el.type === 'quiz',
    );
    expect(quiz?.id).toBeTruthy();

    const timeline = await request.put(`/api/lessons/${lessonId}/timeline`, {
      data: {
        timeline: [
          { id: 'seg-a', title: '导入练习', type: 'practice', duration: '5m' },
          {
            id: 'seg-b',
            title: '下一环节',
            type: 'lecture',
            duration: '10m',
            gates: [{ type: 'quiz_completed', params: { elementId: quiz.id } }],
          },
        ],
      },
    });
    expect(timeline.ok()).toBeTruthy();

    const init = await request.post(`/api/classroom/sessions/${lessonId}/init`, {
      data: classId ? { classId } : {},
    });
    expect(init.ok()).toBeTruthy();
    const moved = await request.post(`/api/classroom/sessions/${lessonId}/segment`, {
      data: { activeSegmentId: 'seg-b' },
    });
    expect(moved.ok()).toBeTruthy();

    const studentLogin = await context.request.post('/api/auth/login', {
      data: { entrance: 'student', studentId: studentNum, password: 'password123' },
    });
    expect(studentLogin.ok()).toBeTruthy();

    const denied = await context.request.post(`/api/lessons/${lessonId}/segment-access`, {
      data: { targetSegmentId: 'seg-b' },
    });
    expect(denied.status()).toBe(403);
    const deniedBody = await denied.json();
    expect(deniedBody.allowed).toBe(false);
    expect(deniedBody.reason).toContain('练习');

    await openStudent(page, lessonId, studentId, classId);
    await expect(page.getByTestId('segment-gate-lock')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('segment-gate-lock')).toContainText('练习');

    const submitted = await context.request.post(`/api/lessons/${lessonId}/quiz-submit`, {
      data: { elementId: quiz.id, answer: 'A', timeSpentMs: 1000 },
    });
    expect(submitted.ok()).toBeTruthy();

    const allowed = await context.request.post(`/api/lessons/${lessonId}/segment-access`, {
      data: { targetSegmentId: 'seg-b' },
    });
    expect(allowed.ok()).toBeTruthy();
    expect((await allowed.json()).allowed).toBe(true);
    await expect(page.getByTestId('segment-gate-lock')).toBeHidden({ timeout: 15_000 });
  } finally {
    await cleanup();
  }
});

async function openStudent(page: Page, lessonId: string, studentId: string, classId: string) {
  await page.addInitScript(() => {
    localStorage.setItem('edu_os_tour_completed', 'true');
  });
  const classParam = classId ? `&classId=${encodeURIComponent(classId)}` : '';
  await page.goto(
    `/?mode=student_live&studentId=${encodeURIComponent(studentId)}&lessonId=${encodeURIComponent(lessonId)}${classParam}#/student_live`,
  );
}
