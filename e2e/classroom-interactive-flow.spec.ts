import { expect, test } from '@playwright/test';

/**
 * 互动课堂学生端答题、快速投票与教师端学情采集 Playwright 端到端浏览器自动化测试。
 *
 * 验证目标：
 *  1. 白板随堂测验（Quiz）：在真实浏览器中展示标准白板卡片、全屏展开作答、防剧透、提交与实时反馈；
 *  2. 极速单选投票（Quick Poll）：教师下发后学生端浮层展示、点击作答并更新已提交状态；
 *  3. 教师端学情采集闭环：随堂测成绩与投票分布在服务端准确聚合。
 */
test.describe('互动课堂学生端答题与全链路采集 Playwright E2E 测试', () => {
  test('学生在白板中查看随堂测卡片、打开全屏答题提交，并由教师端采集记录', async ({ page, request, context }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const studentNum = `STU_${suffix}`;
    const lessonTitle = `E2E 互动测验课节 ${suffix}`;
    let lessonId = '';
    let studentId = '';

    // 1. 管理员登录并创建课程与随堂测白板元素
    const adminLogin = await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const lessonRes = await request.post('/api/lessons', {
      data: { title: lessonTitle, content: 'E2E 测试随堂测答题与提交' },
    });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonData = await lessonRes.json();
    lessonId = lessonData.result?.lessonId || lessonData.lessonId || lessonData.id;
    expect(lessonId).toBeTruthy();

    // 在白板中添加随堂测元素
    const quizQuestion = `量子论中光子的能量公式是什么？(${suffix})`;
    const wbRes = await request.post(`/api/lessons/${lessonId}/whiteboard`, {
      data: {
        type: 'quiz',
        data: {
          question: quizQuestion,
          options: ['E = h * nu', 'E = m * c^2', 'F = m * a', 'V = I * R'],
          correctAnswer: 'A',
          correctIndex: 0,
          passScore: 60,
          submissions: {},
        },
      },
    });
    expect(wbRes.ok()).toBeTruthy();

    // 创建测试学生账户
    const createStuRes = await request.post('/api/students', {
      data: {
        name: `测试学生_${suffix}`,
        student_number: studentNum,
        password: 'password123',
      },
    });
    expect(createStuRes.ok()).toBeTruthy();
    const stuData = await createStuRes.json();
    studentId = stuData.id;

    // 2. 学生在浏览器上下文中登录
    const studentLogin = await context.request.post('/api/auth/login', {
      data: {
        entrance: 'student',
        studentId: studentNum,
        password: 'password123',
      },
    });
    expect(studentLogin.ok()).toBeTruthy();

    // 3. 打开学生端课堂页面
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });

    await page.goto(`/?mode=student_live&lessonId=${lessonId}`);

    // 验证白板画布成功渲染随堂测卡片（防普通画布 return null 断层回归）
    const quizCard = page.locator(`[data-testid^="whiteboard-quiz-"]`).first();
    await expect(quizCard).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('随堂测验 (Interactive Quiz)')).toBeVisible();
    await expect(page.getByText(quizQuestion)).toBeVisible();

    // 点击进入全屏测验
    const openFullscreenBtn = page.getByTestId('quiz-open-fullscreen').first();
    await expect(openFullscreenBtn).toBeVisible();
    await openFullscreenBtn.click();

    // 验证全屏测验弹层渲染
    const questionInModal = page.getByTestId('quiz-question');
    await expect(questionInModal).toBeVisible({ timeout: 10_000 });
    await expect(questionInModal).toContainText(quizQuestion);

    // 防剧透：未提交前不应显示「正确答案」标记
    await expect(page.getByText('✓ 正确答案')).toBeHidden();

    // 选择第 1 个选项 A（正确选项）
    const optionA = page.getByTestId('quiz-option-0');
    await expect(optionA).toBeVisible();
    await optionA.click();

    // 点击提交
    const submitBtn = page.getByTestId('quiz-submit-btn');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 验证提交成功横幅与得分
    const feedbackBanner = page.getByTestId('quiz-feedback');
    await expect(feedbackBanner).toBeVisible({ timeout: 10_000 });
    await expect(feedbackBanner).toContainText('100');
    await expect(page.getByText('✓ 正确答案')).toBeVisible();

    // 4. 验证教师端接口能正确采集并聚合此答题记录
    const submissionsRes = await request.get(`/api/lessons/${lessonId}/quiz-submissions`);
    expect(submissionsRes.ok()).toBeTruthy();
    const submissionsJson = await submissionsRes.json();
    expect(submissionsJson.success).toBe(true);
    expect(submissionsJson.quizzes.length).toBeGreaterThanOrEqual(1);

    const quizResult = submissionsJson.quizzes[0];
    expect(quizResult.submissions[studentId]).toBeDefined();
    expect(quizResult.submissions[studentId].score).toBe(100);
    expect(quizResult.submissions[studentId].answer).toBe('A');
    if (quizResult.submissions[studentId].isCorrect !== undefined) {
      expect(quizResult.submissions[studentId].isCorrect).toBe(true);
    }
  });

  test('学生在课堂中接收快速投票（Quick Poll）并在浏览器中完成投票', async ({ page, request, context }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const studentNum = `STU_POLL_${suffix}`;
    const lessonTitle = `E2E 快速投票课节 ${suffix}`;

    // 登录教师并创建课节
    await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });

    const lessonRes = await request.post('/api/lessons', {
      data: { title: lessonTitle, content: 'E2E 投票测试' },
    });
    const lessonData = await lessonRes.json();
    const lessonId = lessonData.result?.lessonId || lessonData.lessonId || lessonData.id;

    // 创建测试学生
    await request.post('/api/students', {
      data: {
        name: `投票学生_${suffix}`,
        student_number: studentNum,
        password: 'password123',
      },
    });

    // 教师发起投票
    const pollQuestion = `今天的内容大家掌握得如何？(${suffix})`;
    const pollRes = await request.post(`/api/classroom/sessions/${lessonId}/quick-poll`, {
      data: {
        title: pollQuestion,
        questionType: 'ABCD',
        options: ['完全掌握', '基本掌握', '还有疑惑'],
      },
    });
    expect(pollRes.ok()).toBeTruthy();

    // 学生登录
    await context.request.post('/api/auth/login', {
      data: {
        entrance: 'student',
        studentId: studentNum,
        password: 'password123',
      },
    });

    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });

    await page.goto(`/?mode=student_live&lessonId=${lessonId}`);

    // 等待快速投票悬浮弹窗出现
    await expect(page.getByText('极速答题进行中')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(pollQuestion)).toBeVisible();

    // 点击「完全掌握」
    const optionBtn = page.getByRole('button', { name: '完全掌握' });
    await expect(optionBtn).toBeVisible();
    await optionBtn.click();

    // 验证「已提交」状态
    await expect(page.getByText('已提交')).toBeVisible({ timeout: 10_000 });

    // 验证教师端获取投票统计（通过讲台/大屏全景数据接口）
    const stageRes = await request.get(`/api/classroom/stage/${lessonId}/data`);
    expect(stageRes.ok()).toBeTruthy();
    const stageJson = await stageRes.json();
    expect(stageJson.activePoll).toBeTruthy();
    expect(stageJson.activePoll.distribution['完全掌握']).toBeGreaterThanOrEqual(1);
    expect(stageJson.activePoll.totalVotes).toBeGreaterThanOrEqual(1);
  });
});
