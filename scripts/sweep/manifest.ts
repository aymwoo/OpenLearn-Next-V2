/**
 * scripts/sweep/manifest.ts —— 巡检计划（哪些角色、哪些视图）
 *
 * ## 为什么不把教师端视图写死
 *
 * 教师/管理员工作台是**单一 SPA + hash 路由**（见 `src/utils/teacherTabHash.ts`），
 * 导航项由 `src/features/shared/NavigationSidebar.tsx` 渲染，每个导航按钮带
 * `aria-label`。因此巡检工具在运行时**直接读 DOM 发现导航项**并逐个点击，
 * 而不是在这里枚举一份会过期的视图清单 —— 新增导航项会自动被纳入巡检。
 *
 * 需要显式写死的只有两类：
 * 1. 侧边栏之外的入口（教师端「系统总览」在顶栏；学生端根本没有侧边栏）。
 * 2. 视图内部的二级页签 —— 它们是普通按钮，不带路由信息，只能按名字匹配。
 *
 * @module
 */

import type { SweepRole, SweepScenario, SweepSubTab, SweepTarget } from './types.js';
import { CROSS_TENANT_TEACHER } from './prepare.js';

/**
 * 视图内的二级页签，按「点击导航后落到的 hash tab」索引。
 *
 * 只有确认过按钮名的页签才登记；登记了但当次运行没找到的，会在报告里
 * 标成 `missing`（不等于坏了，只等于这次没点进去）。
 */
export const SUB_TABS_BY_TAB: Record<string, SweepSubTab[]> = {
  // 班级管理：ClassTabs.tsx
  // 页签要**先展开某个班级**才出现，因此需要 preClick 点开班级行。
  classes: [
    {
      id: 'students',
      label: '学生名单',
      name: '学生名单|^Students$',
      preClick: { text: '\\[演示\\].*班|一年级.*班', nth: 0 },
    },
    {
      id: 'assignments',
      label: '作业成绩',
      name: '作业成绩|^Assignments$',
      preClick: { text: '\\[演示\\].*班|一年级.*班', nth: 0 },
    },
    {
      id: 'attendance',
      label: '课表考勤',
      name: '课表考勤|^Attendance$',
      preClick: { text: '\\[演示\\].*班|一年级.*班', nth: 0 },
    },
    {
      id: 'grades',
      label: '学期总评',
      name: '学期总评|^Grades$',
      preClick: { text: '\\[演示\\].*班|一年级.*班', nth: 0 },
    },
  ],
  // 测评中心：AssessmentCenter.tsx
  assessments: [
    { id: 'papers', label: '试卷', name: '^试卷$|^Papers$' },
    { id: 'bank', label: '题库', name: '^题库$|^Question bank$' },
  ],
  // 管理后台：AdminPanel.tsx
  admin_directory: [
    { id: 'directory', label: '学校教职及系统配置', name: '学校教职及系统配置|Staff Accounts & Config' },
    { id: 'ai_providers', label: 'AI 模型提供商', name: 'AI 模型提供商|AI Providers' },
    { id: 'sqlite', label: '系统监控', name: '系统监控|System Monitor' },
    { id: 'site_settings', label: '站点信息设置', name: '站点信息设置|Site Settings' },
  ],
};

/**
 * 教师/管理员端：除侧边栏外，顶栏还有一个「系统总览」入口（不在侧边栏里，
 * 因此发现机制扫不到），单独登记。
 */
const DASHBOARD_TARGET: SweepTarget = {
  id: 'dashboard',
  label: '系统总览',
  hash: 'dashboard',
  note: '顶栏入口，不在侧边栏中',
};

/**
 * 学生端视图清单。
 *
 * 学生端没有侧边栏导航，全部视图都从仪表盘里的挂件/快捷指令进入，
 * 因此这里用「path + click」的组合描述。
 */
const STUDENT_TARGETS: SweepTarget[] = [
  {
    id: 'dashboard',
    label: '学生仪表盘',
    path: '/',
    note: '学生端首屏，含全部看板挂件',
  },
  {
    id: 'assessments',
    label: '我的测评',
    path: '/',
    click: { name: '打开我的测评|Open my assessments' },
    note: '由仪表盘「我的测评」挂件进入',
  },
  {
    id: 'assignments',
    label: '我的作业',
    path: '/',
    open: { selector: '#student-quick-actions-fab-btn' },
    click: { selector: '#qa-action-view-assignments' },
    note: '由学生快捷指令浮层进入',
  },
  {
    id: 'live-session',
    label: '进入实时课堂',
    path: '/',
    open: { selector: '#student-quick-actions-fab-btn' },
    click: { selector: '#qa-action-join-live' },
    note: '由学生快捷指令浮层进入（需要有进行中的课堂会话）',
    // 本轮（无课堂会话）这个入口本就不渲染 —— 「学生（课中）」那一轮才真正点到它。
    expectMissing: true,
  },
  {
    id: 'lesson',
    label: '课程内容',
    path: '/',
    click: { text: '初中信息技术|Information Technology', nth: 0 },
    note: '由「我的课程」列表点击演示课程进入',
  },
];

/**
 * 学生端在**有进行中课堂会话**时的视图。
 *
 * 有会话时学生端会被锁进课中视图（“全课专注锁定·跟随教师授课”），
 * 仪表盘那些挂件根本不可见 —— 所以课中形态必须单独一轮来测。
 */
const STUDENT_LIVE_TARGETS: SweepTarget[] = [
  {
    id: 'live-direct',
    label: '课中课堂（直链）',
    path: '/?mode=student_live&lessonId=demo-lesson',
    note: 'student_live 深链，覆盖课中浮层/工具栏',
  },
  {
    id: 'live-session',
    label: '进入实时课堂',
    path: '/',
    open: { selector: '#student-quick-actions-fab-btn' },
    click: { selector: '#qa-action-join-live' },
    note: '由学生快捷指令浮层进入（需要有进行中的课堂会话）',
  },
];

/**
 * 巡检角色清单。
 *
 * 账号来源：
 * - `admin` / `teacher`：演示库以 `PLAYWRIGHT_TEST=1` 播种，走「众所周知的口令」
 *   分支（`resolveSeedCredential` 的 `allowWellKnown`），口令等于用户名，
 *   且 `must_change_password = 0`，因此不会被改密门拦住。
 * - `demo_teacher`：演示数据播种器创建的教师，持有演示课程/班级/课表，
 *   巡检「班级管理」「课程管理」时才有真实数据。
 * - 学生：演示学号 `DEMO-S01`，口令用其所在演示班级的上课临时口令 `1001`
 *   （班级口令登录是产品支持的正式路径，见 server/routes/roster.ts）。
 *
 * ## 顺序为什么是这样
 *
 * 学生端**有进行中的课堂会话时会被锁进课中视图**，仪表盘挂件全部不可见。
 * 因此：
 *
 * 1. `admin` —— 不开课堂会话，能看到「无会话时前端仍去 POST view-state 拿到 404」
 *    这类冷启动缺陷；
 * 2. `student` —— 同样不开会话，完整覆盖学生常态外壳（仪表盘/测评/作业/课程）；
 * 3. `teacher` —— 此时才建课堂会话，覆盖教师的授课驾驶舱；
 * 4. `student-live` —— 会话已存在，覆盖学生的课中形态。
 */
export const SWEEP_ROLES: SweepRole[] = [
  {
    id: 'admin',
    label: '管理员',
    login: { entrance: 'teacher', username: 'admin', password: 'admin' },
    // 管理员这一轮**故意不开课堂会话**：这样能看到「无会话时前端仍去 POST
    // view-state 拿到 404」这类冷启动缺陷；课堂会话留给后面的轮次覆盖。
    prepare: ['assignment'],
    targets: [DASHBOARD_TARGET],
  },
  {
    id: 'student',
    label: '学生',
    login: { entrance: 'student', studentId: 'DEMO-S01', password: '1001' },
    prepare: ['assignment'],
    targets: STUDENT_TARGETS,
  },
  {
    id: 'student-live',
    label: '学生（课中）',
    login: { entrance: 'student', studentId: 'DEMO-S01', password: '1001' },
    // 这里才建立课堂会话（停在「课前就绪」）：会话存在时学生端才会出现
    // 「进入实时课堂」入口。
    //
    // **必须排在教师轮次之前**：教师打开互动课堂会开启「全课专注锁定」，
    // 学生端随即被锁进课中视图，快捷指令浮层（含「进入实时课堂」入口）消失。
    prepare: ['classroomSession'],
    targets: STUDENT_LIVE_TARGETS,
  },
  {
    id: 'teacher',
    label: '教师',
    login: { entrance: 'teacher', username: 'demo_teacher', password: 'Demo@2026' },
    prepare: [],
    targets: [DASHBOARD_TARGET],
  },
  {
    id: 'teacher-live',
    label: '教师（授课中）',
    login: { entrance: 'teacher', username: 'demo_teacher', password: 'Demo@2026' },
    // 把会话推进到「授课中」：教师端此时显示完整的授课驾驶舱。
    prepare: ['classroomInProgress'],
    targets: [DASHBOARD_TARGET],
  },
  {
    id: 'teacher-2',
    label: '教师（另一账号）',
    // 第二教师账号由 prepare.ts 的 `ensureCrossTenantTeacher` 用产品自己的
    // `user.create` 命令创建（幂等：已存在就跳过）。
    //
    // **它存在的唯一理由**是让「跨教师/跨班的对象级授权」在巡检里**可触发**：
    // 演示世界原本只有一位教师，单教师世界里任何授权判定都必然放行，
    // #211 补的那条判定链在巡检中是盲区。
    //
    // 不给 targets —— 它不参与只读巡检，只作为剧本里的越权方出现。
    login: {
      entrance: 'teacher',
      username: CROSS_TENANT_TEACHER.username,
      password: CROSS_TENANT_TEACHER.password,
    },
    prepare: [],
    targets: [],
  },
];

/**
 * 危险操作黑名单：命中这些词的按钮一律不点。
 * 巡检跑在一次性演示库上，但仍然要守住「巡检只读、不搞破坏」的底线：
 * 删除、清空、发布、结束这类操作一旦误点，报告里的结论就不可信了
 * （页面状态被改了，后续视图的报错可能只是数据被删了）。
 */
export const DANGEROUS_ACTION_PATTERN =
  /删除|移除|清空|重置|初始化|清理|注销|发布|结束上课|终止|撤回|不可撤销|delete|remove|reset|clear|purge|drop|destroy|publish|revoke/i;

/** 巡检时默认不点开的按钮（会打开新窗口/下载/新标签页，扰乱巡检上下文）。 */
export const SKIP_ACTION_PATTERN = /在新标签页打开|Open .* in a new tab|导出|Export|下载/i;

/**
 * 写流程剧本（“写”链路巡检）。
 *
 * 只读巡检回答「打开每个视图有没有报错」；剧本回答「**做完一笔真实业务**之后，
 * 打开相关界面会不会冒 403/500」。
 *
 * 业务写入走 API（契约稳定，UI 改版不会让剧本碎），观察走浏览器（那里才有渲染噪音）。
 * 剧本只在一次性演示库上跑，且动作是显式编写的 —— 不会误触删除类按钮。
 */
export const SWEEP_SCENARIOS: SweepScenario[] = [
  {
    id: 'assignment-loop',
    label: '作业闭环（发布 → 提交 → 批改 → 回看）',
    roles: ['teacher', 'student'],
    steps: [
      {
        label: '教师发布作业到演示班',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/assignments',
          body: {
            title: '巡检剧本作业',
            description: '功能巡检（写流程剧本）自动创建，仅存在于一次性演示库。',
            classId: 'demo-class',
            allowText: true,
            teacherWeight: 1,
            peerWeight: 0,
            status: 'published',
          },
        },
        capture: { name: 'assignmentId', path: 'assignmentId' },
        expect: { path: 'assignmentId', notEmpty: true },
      },
      {
        label: '教师打开班级管理（看到新作业）',
        role: 'teacher',
        view: { hash: 'classes' },
      },
      {
        label: '教师打开测评中心',
        role: 'teacher',
        view: { hash: 'assessments' },
      },
      {
        label: '学生提交作答',
        role: 'student',
        api: {
          method: 'POST',
          path: '/api/assignments/{{assignmentId}}/submit',
          body: { textContent: '巡检剧本学生的作答内容' },
        },
        capture: { name: 'submissionId', path: 'submissionId' },
        expect: { path: 'submissionId', notEmpty: true },
      },
      {
        label: '学生打开我的作业（看到已提交）',
        role: 'student',
        view: { path: '/' },
      },
      {
        label: '教师批改给分',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/commands',
          body: {
            commandType: 'assignment.grade',
            payload: {
              submissionId: '{{submissionId}}',
              teacherScore: 88,
              teacherComment: '巡检剧本自动批改',
              teacherWeight: 1,
              peerWeight: 0,
              status: 'confirmed',
            },
          },
        },
        expect: { path: 'result.calculatedFinalScore', equals: 88 },
      },
      {
        label: '教师查看该作业的成绩',
        role: 'teacher',
        api: {
          method: 'GET',
          path: '/api/assignments/{{assignmentId}}?studentId=DEMO-S01',
        },
        expect: { path: 'success', equals: true },
      },
      {
        label: '教师回到班级管理（看已批改）',
        role: 'teacher',
        view: { hash: 'classes' },
      },
      {
        label: '学生回看分数',
        role: 'student',
        view: { path: '/' },
      },
    ],
  },

  /**
   * 课堂互动全链（投票 → 抢答 → 通票 → 倒计时）—— #211 对象级授权面。
   *
   * ## 为什么自建一节课而不是复用 `demo-lesson`
   *
   * 只读巡检的角色顺序刻意让「管理员 / 学生」先跑，此时**还没有课堂会话** ——
   * 这样才看得到「无会话时前端仍去 POST view-state 拿到 404」这类冷启动缺陷。
   * 剧本在只读巡检**之前**跑，如果这里给 `demo-lesson` 建了会话，那层覆盖就没了。
   * 所以剧本自建一节专用课节，边界互不干扰。
   */
  {
    id: 'classroom-interaction-loop',
    label: '课堂互动全链（投票 → 抢答 → 倒计时 → 通票）',
    roles: ['teacher', 'student'],
    steps: [
      {
        label: '教师新建一节专用巡检课节',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/lessons',
          body: { title: '巡检课堂互动课节', content: '功能巡检（写流程剧本）自动创建，仅存在于一次性演示库。' },
        },
        capture: { name: 'lessonId', path: 'result.lessonId' },
        expect: { path: 'result.lessonId', notEmpty: true },
      },
      {
        label: '教师建立课堂会话并绑定演示班',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{lessonId}}/init',
          body: { classId: 'demo-class', teachingModeId: 'lecture' },
        },
        capture: { name: 'sessionId', path: 'session.id' },
        expect: { path: 'session.id', notEmpty: true },
      },
      {
        label: '教师发起极速投票',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{lessonId}}/quick-poll',
          body: {
            questionType: 'ABCD',
            title: '巡检极速投票：下列哪一项属于信息？',
            options: ['一张纸质地图', '一段程序代码', '一段旋律', '以上都是'],
            correctOption: 'D',
          },
        },
        capture: { name: 'pollId', path: 'poll.id' },
        expect: { path: 'poll.id', notEmpty: true },
      },
      {
        label: '学生投票',
        role: 'student',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{lessonId}}/quick-poll/{{pollId}}/vote',
          // 选项必须落在教师建投票时给出的选项里（服务端会校验），
          // 否则 400「Invalid vote option」。
          body: { option: '以上都是' },
        },
        expect: { path: 'success', equals: true },
      },
      {
        label: '教师确认投票已生效',
        role: 'teacher',
        api: { method: 'GET', path: '/api/classroom/sessions/{{lessonId}}' },
        expect: { path: 'activePoll.id', notEmpty: true },
      },
      {
        label: '教师开启抢答器',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{lessonId}}/buzzer',
          body: { title: '巡检抢答' },
        },
        capture: { name: 'buzzerId', path: 'buzzer.id' },
        expect: { path: 'buzzer.id', notEmpty: true },
      },
      {
        label: '学生抢答',
        role: 'student',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{lessonId}}/buzzer/{{buzzerId}}/buzz',
          body: {},
        },
        expect: { path: 'success', equals: true },
      },
      {
        label: '教师启动倒计时',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{lessonId}}/countdown',
          body: { action: 'start', duration: 60 },
        },
        expect: { path: 'success', equals: true },
      },
      {
        label: '学生提交结课通票',
        role: 'student',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{lessonId}}/exit-ticket',
          body: { rating: 5, feedback: '巡检通票：课堂互动全链可达' },
        },
        expect: { path: 'success', equals: true },
      },
      {
        label: '教师读取结课通票汇总',
        role: 'teacher',
        api: { method: 'GET', path: '/api/classroom/sessions/{{lessonId}}/exit-ticket-summary' },
        expect: { path: 'success', equals: true },
      },
      {
        label: '教师打开班级管理（观察互动写入后的渲染）',
        role: 'teacher',
        view: { hash: 'classes' },
      },
    ],
  },

  /**
   * 课件提交 → 自动录分 → 成绩查询 —— #213 / #215 的成绩写入面。
   *
   * 自动录分走**教师触发的** `/api/courseware/attempts/auto-record`
   * （提交瞬间的实时自动录入依赖「进行中」的课堂会话，会把演示课节推进到
   * 授课中 —— 那会锁住学生端、破坏只读巡检的覆盖，所以不取那条路）。
   *
   * 成绩落库后从班级作业列表里取回**刚自动生成的那条**作业，再查它的成绩行 ——
   * 这正是 #215「成绩写入收敛为唯一入口」要守住的那条链。
   */
  {
    id: 'courseware-grade-loop',
    label: '课件提交 → 自动录分 → 成绩查询',
    roles: ['teacher', 'student'],
    steps: [
      {
        label: '教师上传一个互动课件',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/courseware/upload',
          body: {
            name: '巡检互动课件',
            filename: 'index.html',
            // 一段最小可运行的课件 HTML（base64）。课件必须真实落盘，
            // 否则 /runtime 拿不到入口文件，也就没有 attempt 可提交。
            base64Data: 'PGh0bWw+PGJvZHk+PGgxPlx6dVBpYyBpbnRlcmFjdGl2ZSBjb3Vyc2V3YXJlPC9oMT48L2JvZHk+PC9odG1sPg==',
          },
        },
        capture: { name: 'coursewareUuid', path: 'uuid' },
        expect: { path: 'uuid', notEmpty: true },
      },
      {
        label: '学生铸造课件访问令牌',
        role: 'student',
        // /runtime 是课件沙箱直出入口，SEC-AUTH 之后必须带 `?ct=` 短时令牌
        // （父页面就是这么做的）。令牌与课件 uuid 绑定。
        api: { method: 'GET', path: '/api/courseware/{{coursewareUuid}}/access-token' },
        capture: { name: 'coursewareToken', path: 'token' },
        expect: { path: 'token', notEmpty: true },
      },
      {
        label: '学生打开课件运行时（建立 attempt）',
        role: 'student',
        // 结尾的斜杠是必须的：`/runtime/:uuid`（无斜杠）会 302 到 `/runtime/:uuid/`，
        // 而 Express 的 res.redirect **不保留原查询串** —— `?ct=` 令牌会被丢掉，
        // 于是落到 401。产品前端用的也是带斜杠的地址。
        api: { method: 'GET', path: '/runtime/{{coursewareUuid}}/?ct={{coursewareToken}}' },
      },
      {
        label: '学生查询自己的课件 attempt',
        role: 'student',
        api: { method: 'GET', path: '/api/courseware/attempts?coursewareUuid={{coursewareUuid}}' },
        // 列表接口返回 { data: [...], total, page, pageSize }
        capture: { name: 'attemptId', path: 'data.0.attemptId' },
        expect: { path: 'data.0.attemptId', notEmpty: true },
      },
      {
        label: '学生提交课件成绩',
        role: 'student',
        api: {
          method: 'POST',
          path: '/api/courseware/attempts/{{attemptId}}/submit',
          body: {
            score: 88,
            completion: 100,
            status: 'completed',
            comment: '巡检剧本：课件作答完成',
            lessonId: 'demo-lesson',
          },
        },
        expect: { path: 'success', equals: true },
      },
      {
        label: '教师开启课件自动录分规则',
        role: 'teacher',
        // 自动录分**默认关闭**（`auto_record_enabled: false`）——
        // 不先开规则，「教师触发自动录分」必然 recorded=0。
        api: {
          method: 'POST',
          path: '/api/commands',
          body: {
            commandType: 'courseware.save_score_config',
            payload: {
              coursewareId: '*',
              autoRecordEnabled: true,
              autoRecordMinCompletion: 0,
            },
          },
        },
        expect: { path: 'result.success', equals: true },
      },
      {
        label: '教师触发自动录分',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/courseware/attempts/auto-record',
          body: { lessonId: 'demo-lesson', classId: 'demo-class' },
        },
        expect: { path: 'recorded', equals: 1 },
      },
      {
        label: '教师取回自动生成的作业（最新一条）',
        role: 'teacher',
        api: { method: 'GET', path: '/api/classes/demo-class/assignments' },
        capture: { name: 'assignmentId', path: '0.id' },
        expect: { path: '0.id', notEmpty: true },
      },
      {
        label: '教师查询该作业的成绩行',
        role: 'teacher',
        api: { method: 'GET', path: '/api/assignments/{{assignmentId}}/submissions' },
        expect: { path: '0.score', equals: 88 },
      },
    ],
  },

  /**
   * 课程包导入 → 课程出现 —— #204 的导入通道面。
   *
   * 导入请求体是「课程包 JSON」，附件用 base64 内联；这里带一份**最小可用**的
   * 课程包（含一个教学环节与一个白板元素），验证的是「导入 → 课程真的出现」。
   *
   * `allowDuplicate: true` 是必须的：课程包按创建者 + 包身份去重，
   * 同一个包导第二次会返回 409（这是产品的幂等设计，不是缺陷）。
   */
  {
    id: 'course-package-import-loop',
    label: '课程包导入 → 课程出现',
    roles: ['teacher'],
    steps: [
      {
        label: '教师导入一份课程包',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/course-packages/import',
          body: {
            allowDuplicate: true,
            package: {
              format: 'openlearn.course-package',
              version: 1,
              meta: { name: '巡检课程包', description: '功能巡检（写流程剧本）自动创建。' },
              lesson: {
                title: '巡检导入课程包',
                content: '功能巡检（写流程剧本）自动创建，仅存在于一次性演示库。',
                progressMode: 'manual',
                timeline: [{ id: 'seg-1', title: '导入校验', type: 'prepare', duration: '5min' }],
              },
              assets: [],
              elements: [{ type: 'text', data: { text: '巡检课程包白板元素' } }],
            },
          },
        },
        capture: { name: 'importedLessonId', path: 'result.lessonId' },
        expect: { path: 'result.lessonId', notEmpty: true },
      },
      {
        label: '教师打开刚导入的课程',
        role: 'teacher',
        api: { method: 'GET', path: '/api/lessons/{{importedLessonId}}' },
        // 单条课节接口直接返回课节对象（没有 success 包装层）
        expect: { path: 'title', equals: '巡检导入课程包' },
      },
      {
        label: '教师打开课程管理（观察导入结果）',
        role: 'teacher',
        view: { hash: 'courses' },
      },
    ],
  },

  /**
   * 跨教师 / 跨班的对象级授权 —— #211 防的那类回归。
   *
   * ## 为什么这条必须在结构上可触发
   *
   * 演示世界原本只有一位教师、两个都归他所有的班级 ——
   * 「A 教师越权访问 B 教师的课节」在单教师世界里**不可能发生**，
   * 于是 #211 补的判定链在巡检里是盲区：真出问题时没有任何一步会红。
   *
   * 这里用第二教师账号建自己的班级与课节，再让**另一位教师**与**别班学生**
   * 去碰它 —— 期望被 403 拒绝。403 是**期望值**，因此这一步用 `expectStatus`。
   */
  {
    id: 'cross-tenant-authorization',
    label: '跨教师 / 跨班访问应被 403 拒绝',
    roles: ['teacher', 'teacher-2', 'student'],
    steps: [
      {
        label: '第二教师建立自己的班级',
        role: 'teacher-2',
        api: {
          method: 'POST',
          path: '/api/classes',
          body: { name: '巡检隔离班（第二教师）', description: '功能巡检自动创建，用于跨班授权回归。' },
        },
        capture: { name: 'otherClassId', path: 'id' },
        expect: { path: 'id', notEmpty: true },
      },
      {
        label: '第二教师建立自己的课节',
        role: 'teacher-2',
        api: {
          method: 'POST',
          path: '/api/lessons',
          body: { title: '巡检隔离课节（第二教师）', content: '功能巡检自动创建，用于跨教师授权回归。' },
        },
        capture: { name: 'otherLessonId', path: 'result.lessonId' },
        expect: { path: 'result.lessonId', notEmpty: true },
      },
      {
        label: '第二教师在隔离班里开课',
        role: 'teacher-2',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{otherLessonId}}/init',
          body: { classId: '{{otherClassId}}', teachingModeId: 'lecture' },
        },
        capture: { name: 'otherSessionId', path: 'session.id' },
        expect: { path: 'session.id', notEmpty: true },
      },
      {
        label: '另一教师读取他班课节 → 应 403',
        role: 'teacher',
        api: { method: 'GET', path: '/api/classroom/sessions/{{otherLessonId}}' },
        expectStatus: 403,
      },
      {
        label: '另一教师操作他班投票 → 应 403',
        role: 'teacher',
        api: {
          method: 'POST',
          path: '/api/classroom/sessions/{{otherLessonId}}/quick-poll',
          body: { title: '越权投票', options: ['A', 'B'] },
        },
        expectStatus: 403,
      },
      {
        label: '别班学生读取他班课节 → 应 403',
        role: 'student',
        api: { method: 'GET', path: '/api/classroom/sessions/{{otherLessonId}}' },
        expectStatus: 403,
      },
      {
        label: '第二教师自己读自己的课节 → 应 200',
        role: 'teacher-2',
        api: { method: 'GET', path: '/api/classroom/sessions/{{otherLessonId}}' },
        expectStatus: 200,
      },
    ],
  },
];
