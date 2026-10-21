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

import type { SweepRole, SweepSubTab, SweepTarget } from './types.js';

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
    { id: 'students', label: '学生名单', name: '学生名单|^Students$', preClick: { text: '\\[演示\\].*班|一年级.*班', nth: 0 } },
    { id: 'assignments', label: '作业成绩', name: '作业成绩|^Assignments$', preClick: { text: '\\[演示\\].*班|一年级.*班', nth: 0 } },
    { id: 'attendance', label: '课表考勤', name: '课表考勤|^Attendance$', preClick: { text: '\\[演示\\].*班|一年级.*班', nth: 0 } },
    { id: 'grades', label: '学期总评', name: '学期总评|^Grades$', preClick: { text: '\\[演示\\].*班|一年级.*班', nth: 0 } },
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
];

/**
 * 危险操作黑名单：命中这些词的按钮一律不点。
 *
 * 巡检跑在一次性演示库上，但仍然要守住「巡检只读、不搞破坏」的底线：
 * 删除、清空、发布、结束这类操作一旦误点，报告里的结论就不可信了
 * （页面状态被改了，后续视图的报错可能只是数据被删了）。
 */
export const DANGEROUS_ACTION_PATTERN =
  /删除|移除|清空|重置|初始化|清理|注销|发布|结束上课|终止|撤回|不可撤销|delete|remove|reset|clear|purge|drop|destroy|publish|revoke/i;

/** 巡检时默认不点开的按钮（会打开新窗口/下载/新标签页，扰乱巡检上下文）。 */
export const SKIP_ACTION_PATTERN = /在新标签页打开|Open .* in a new tab|导出|Export|下载/i;
