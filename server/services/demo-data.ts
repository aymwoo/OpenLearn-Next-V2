/**
 * 演示数据播种与清理（DEMO-SEED-01）
 *
 * ## 为什么需要登记表
 *
 * 早期实现（`server/routes/admin.ts` 的 `/api/admin/seed-demo`）有两个安全问题：
 *
 * 1. `lessonId` 取自 `SELECT id FROM lessons LIMIT 1` —— 它**劫持一门真实课程**
 *    而非自建课程。清理时无法安全删除"演示课程"。
 * 2. 学生按 `student_number`（`S001`…）复用 —— 可能与真实学生冲突，
 *    一旦命中就会把**真实学生**链接进演示班级。
 *
 * 本模块改为：播种时把**实际创建的每一行**登记进 `demo_data_registry`，
 * 清理时只删登记过的行。不依赖任何命名约定，因此不会误伤真实数据。
 *
 * ## 不变量
 *
 * - 清理**永不**删除 `users.role = 'administrator'` 的账号（代码侧兜底断言）。
 * - 清理**永不**删除未在登记表中的行。
 * - 播种幂等：重复调用不会产生重复数据，返回同一批 ID。
 * - 所有演示 ID 落在 `demo-` 命名空间（用户 ID 为 `usr_demo_*`），
 *   与真实数据的 UUID / `usr_*` 空间隔离。
 *
 * ## 数据矩阵（v2，对齐课程包 v3 / 学案双模式 / 测评扩展槽位）
 *
 * - 2 名教师（主讲 `demo_teacher` + 协同 `demo_teacher_b`）
 * - 2 间机房（6×4 座位）、3 个班级（各 8 人，分 2 组）、24 名学生（含登录密码）
 * - 4 门课：2 白板（探秘二进制 / 玩转排序）+ 2 学案（网络安全 / 智能红绿灯）
 * - 白板课：5 种环节 + 常用组件 + LearningSurface 绑定
 * - 学案课：3 种环节 + 8 种活动类型 + 4 类首页块 + Surface 绑定
 * - 闭环：课表、作业（含成绩项去重键）、测评、考试、成绩、考勤、积分、
 *   讨论、互评、奖励兑换、学期报告
 *
 * @module
 */

import type Database from 'better-sqlite3';
import { hashPassword } from '../../packages/core/db/index.js';
import { sealClassPasscode } from '../../packages/core/db/class-passcode-crypto.js';

/** 演示数据标记前缀 —— 仅用于 UI 展示与肉眼识别，**清理不依赖它**。 */
export const DEMO_TAG = '[演示]';

/** 学年标记，与 site_settings.current_academic_year 的演示口径一致。 */
export const DEMO_ACADEMIC_YEAR = '2026-2027';

/** 内置学案模式包 ID（packages/core/plugin-host/mode-pack.ts 的常量）。 */
const XUEAN_MODE_PACK_ID = '@openlearn/mode-xuean';

/** 确定性 ID —— 幂等 + 清理精确定位，且保留 v1 的四个兼容键。 */
export const DEMO_IDS = {
  // ── v1 兼容键（HelpTour / /api/admin/seed-demo 硬编码）──────────
  teacher: 'demo_teacher',
  primaryClass: 'demo-class',
  secondaryClass: 'demo-class-2',
  lesson: 'demo-lesson',
  schedule: 'demo-schedule',

  // ── v2 新增 ────────────────────────────────────────────────────
  teacherB: 'demo_teacher_b',
  thirdClass: 'demo-class-3',
  lab1: 'demo-lab-1',
  lab2: 'demo-lab-2',
  lessonSort: 'demo-lesson-sort',
  lessonXueanNet: 'demo-lesson-xuean-net',
  lessonXueanTraffic: 'demo-lesson-xuean-traffic',
  course: 'demo-course',
} as const;

/** 演示教师账号凭据（用于 Demo 演示，务必与生产账号区分）。 */
export const DEMO_TEACHER = {
  username: 'demo_teacher',
  password: 'Demo@2026',
  name: '演示教师',
} as const;

/** 第二教师：用于演示多教师授权隔离（只能看到自己的班级）。 */
export const DEMO_TEACHER_B = {
  username: 'demo_teacher_b',
  password: 'Demo@2026',
  name: '协同教师',
} as const;

const DEMO_TEACHER_ID = `usr_${DEMO_TEACHER.username}`;
const DEMO_TEACHER_B_ID = `usr_${DEMO_TEACHER_B.username}`;

/** 24 名演示学生姓名，轮流分配性别。 */
const STUDENT_NAMES = [
  '林小雨',
  '陈子涵',
  '王思远',
  '李梦琪',
  '张一鸣',
  '刘欣怡',
  '赵梓轩',
  '孙嘉怡',
  '周浩然',
  '吴语彤',
  '郑博文',
  '黄芷若',
  '何一诺',
  '高梓涵',
  '罗嘉宁',
  '梁思齐',
  '宋雨泽',
  '唐可欣',
  '许明轩',
  '邓紫菱',
  '冯皓然',
  '曾诗涵',
  '彭子墨',
  '萧雅雯',
] as const;

/** 实体类型：同时也是 counts 的键与清理分组依据。顺序 = 清理依赖倒序。 */
export type EntityType =
  | 'surface_attempt'
  | 'surface'
  | 'peer_review'
  | 'discussion'
  | 'activity_progress'
  | 'quiz_submission'
  | 'activity_run'
  | 'block'
  | 'activity'
  | 'assessment_answer'
  | 'assessment_attempt'
  | 'assessment_item'
  | 'assessment_assignment'
  | 'assessment'
  | 'bank_item'
  | 'exam_score'
  | 'exam'
  | 'submission'
  | 'grade_history'
  | 'assignment'
  | 'attendance'
  | 'checkin'
  | 'progress'
  | 'redemption'
  | 'reward'
  | 'credit_award'
  | 'point_log'
  | 'semester_report'
  | 'grade_weight'
  | 'score_config'
  | 'courseware'
  | 'whiteboard_element'
  | 'course_enrollment'
  | 'course'
  | 'lesson'
  | 'seat'
  | 'group'
  | 'schedule'
  | 'class_student'
  | 'student'
  | 'class'
  | 'lab'
  | 'user';

/** 与 EntityType 一一对应，顺序即清理顺序（叶子 → 根）。 */
const ALL_ENTITY_TYPES: EntityType[] = [
  'surface_attempt',
  'surface',
  'peer_review',
  'discussion',
  'activity_progress',
  'quiz_submission',
  'activity_run',
  'block',
  'activity',
  'assessment_answer',
  'assessment_attempt',
  'assessment_item',
  'assessment_assignment',
  'assessment',
  'bank_item',
  'exam_score',
  'exam',
  'submission',
  'grade_history',
  'assignment',
  'attendance',
  'checkin',
  'progress',
  'redemption',
  'reward',
  'credit_award',
  'point_log',
  'semester_report',
  'grade_weight',
  'score_config',
  'courseware',
  'whiteboard_element',
  'course_enrollment',
  'course',
  'lesson',
  'seat',
  'group',
  'schedule',
  'class_student',
  'student',
  'class',
  'lab',
  'user',
];

export interface DemoDataStatus {
  seeded: boolean;
  counts: Record<EntityType, number>;
  total: number;
  demoTeacherExists: boolean;
  seededAt: number | null;
  demo: {
    /** v1 兼容字段 */
    lessonId: string;
    classIds: string[];
    studentIds: string[];
    teacherUsername: string;
    scheduleId: string;
    /** v2 新增 */
    lessonIds: string[];
    whiteboardLessonIds: string[];
    xueanLessonIds: string[];
    labIds: string[];
    scheduleIds: string[];
    teacherUsernames: string[];
    courseIds: string[];
  };
}

export interface CleanupReport {
  removed: Record<EntityType, number>;
  /** 因是管理员账号而被跳过的条目（正常情况下恒为 0，保留作为审计信号）。 */
  skippedAdministrators: number;
  totalRemoved: number;
}

export const DEMO_TEACHER_USERNAME = DEMO_TEACHER.username;

/** 确保登记表存在（老库升级后、迁移尚未跑完时的兜底）。 */
export function ensureRegistryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_data_registry (
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );
  `);
}

/** 统计当前登记情况。 */
export function getDemoDataStatus(db: Database.Database): DemoDataStatus {
  ensureRegistryTable(db);

  const rows = db.prepare('SELECT entity_type, entity_id, created_at FROM demo_data_registry').all() as {
    entity_type: string;
    entity_id: string;
    created_at: number;
  }[];

  const counts = Object.fromEntries(ALL_ENTITY_TYPES.map((t) => [t, 0])) as Record<EntityType, number>;
  const ids: Record<string, string[]> = Object.fromEntries(ALL_ENTITY_TYPES.map((t) => [t, []]));

  let seededAt: number | null = null;
  for (const r of rows) {
    if (r.entity_type in counts) {
      counts[r.entity_type as EntityType] += 1;
      ids[r.entity_type]!.push(r.entity_id);
    }
    if (seededAt === null || r.created_at < seededAt) seededAt = r.created_at;
  }

  const teacher = db.prepare('SELECT id FROM users WHERE username = ?').get(DEMO_TEACHER.username) as
    { id: string } | undefined;

  return {
    seeded: rows.length > 0,
    counts,
    total: rows.length,
    demoTeacherExists: !!teacher,
    seededAt,
    demo: {
      lessonId: DEMO_IDS.lesson,
      classIds: [DEMO_IDS.primaryClass, DEMO_IDS.secondaryClass, DEMO_IDS.thirdClass],
      studentIds: ids.student ?? [],
      teacherUsername: DEMO_TEACHER.username,
      scheduleId: DEMO_IDS.schedule,
      lessonIds: [DEMO_IDS.lesson, DEMO_IDS.lessonSort, DEMO_IDS.lessonXueanNet, DEMO_IDS.lessonXueanTraffic],
      whiteboardLessonIds: [DEMO_IDS.lesson, DEMO_IDS.lessonSort],
      xueanLessonIds: [DEMO_IDS.lessonXueanNet, DEMO_IDS.lessonXueanTraffic],
      labIds: [DEMO_IDS.lab1, DEMO_IDS.lab2],
      scheduleIds: ids.schedule ?? [],
      teacherUsernames: [DEMO_TEACHER.username, DEMO_TEACHER_B.username],
      courseIds: ids.course ?? [],
    },
  };
}

/**
 * 清空"演示 ID 命名空间"下的残留行。
 *
 * 升级场景：旧版播种器用的是同一批确定性 ID（`demo-class` / `demo-lesson` /
 * `demo-s1`…）但**没有登记表**。新实现直接 INSERT 会撞主键，这些行确实属于演示数据。
 *
 * 安全性：所有演示 ID 都以 `demo-` 开头（用户为 `usr_demo_*`），真实数据使用
 * UUID 或 `usr_*` 形式，不会落在这个空间内。
 */
function purgeDemoNamespace(db: Database.Database): void {
  const hasTable = (name: string) =>
    !!(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) as
      { name: string } | undefined);

  const execIf = (sql: string, ...args: unknown[]) => {
    try {
      // 同一批 SQL 里有的用 1 个占位符、有的用 2 个；按实际个数截取，避免多余参数报错。
      const placeholders = (sql.match(/\?/g) ?? []).length;
      db.prepare(sql).run(...args.slice(0, placeholders));
    } catch {
      /* 表不存在则跳过 */
    }
  };

  // 学生 + 下游
  if (hasTable('students')) {
    const studentIds = (
      db.prepare("SELECT id FROM students WHERE id LIKE 'demo-stu-%' OR id LIKE 'demo-s%'").all() as { id: string }[]
    ).map((r) => r.id);
    for (const id of studentIds) {
      for (const sql of [
        'DELETE FROM class_students WHERE student_id = ?',
        'DELETE FROM student_lesson_progress WHERE student_id = ?',
        'DELETE FROM student_rollcalls WHERE student_id = ?',
        'DELETE FROM student_point_logs WHERE student_id = ?',
        'DELETE FROM credit_awards WHERE student_id = ?',
        'DELETE FROM activity_progress WHERE student_id = ?',
        'DELETE FROM learning_surface_attempts WHERE student_id = ?',
        'DELETE FROM assessment_answers WHERE attempt_id IN (SELECT id FROM assessment_attempts WHERE student_id = ?)',
        'DELETE FROM assessment_attempts WHERE student_id = ?',
        'DELETE FROM assignment_submissions WHERE student_id = ?',
        'DELETE FROM attendance WHERE student_id = ?',
        'DELETE FROM lesson_checkins WHERE student_id = ?',
        'DELETE FROM exam_scores WHERE student_id = ?',
        'DELETE FROM lesson_quiz_submissions WHERE student_id = ?',
        'DELETE FROM student_seats WHERE student_id = ?',
        'DELETE FROM lesson_discussions WHERE author_id = ?',
        'DELETE FROM activity_peer_reviews WHERE reviewer_id = ? OR reviewee_id = ?',
      ]) {
        execIf(sql, id, id);
      }
      execIf('DELETE FROM students WHERE id = ?', id);
    }
  }

  // 班级 + 下游
  if (hasTable('classes')) {
    const classIds = (db.prepare("SELECT id FROM classes WHERE id LIKE 'demo-class%'").all() as { id: string }[]).map(
      (r) => r.id,
    );
    for (const id of classIds) {
      for (const sql of [
        'DELETE FROM class_students WHERE class_id = ?',
        'DELETE FROM schedules WHERE class_id = ?',
        'DELETE FROM class_groups WHERE class_id = ?',
        'DELETE FROM student_seats WHERE class_id = ?',
        'DELETE FROM assignments WHERE class_id = ?',
        'DELETE FROM assessments WHERE owner_id = ?',
        'DELETE FROM assessment_assignments WHERE class_id = ?',
        'DELETE FROM exams WHERE class_id = ?',
        'DELETE FROM class_grade_weights WHERE class_id = ?',
        'DELETE FROM student_semester_reports WHERE class_id = ?',
      ]) {
        execIf(sql, id);
      }
      execIf('DELETE FROM classes WHERE id = ?', id);
    }
  }

  // 课程 + 下游
  if (hasTable('lessons')) {
    const lessonIds = (db.prepare("SELECT id FROM lessons WHERE id LIKE 'demo-lesson%'").all() as { id: string }[]).map(
      (r) => r.id,
    );
    for (const id of lessonIds) {
      for (const sql of [
        'DELETE FROM whiteboard_elements WHERE lesson_id = ?',
        'DELETE FROM lesson_activities WHERE lesson_id = ?',
        'DELETE FROM lesson_activity_blocks WHERE lesson_id = ?',
        'DELETE FROM learning_surfaces WHERE lesson_id = ?',
        'DELETE FROM learning_surface_attempts WHERE lesson_id = ?',
        'DELETE FROM student_lesson_progress WHERE lesson_id = ?',
        'DELETE FROM lesson_quiz_submissions WHERE lesson_id = ?',
        'DELETE FROM lesson_checkins WHERE lesson_id = ?',
        'DELETE FROM courseware_score_config WHERE lesson_id = ?',
        'DELETE FROM schedules WHERE lesson_id = ?',
        'DELETE FROM assignments WHERE lesson_id = ?',
      ]) {
        execIf(sql, id);
      }
      execIf('DELETE FROM lessons WHERE id = ?', id);
    }
  }

  // 顶层实体
  execIf("DELETE FROM schedules WHERE id LIKE 'demo-sch%'");
  execIf("DELETE FROM courses WHERE id LIKE 'demo-course%'");
  execIf("DELETE FROM course_enrollments WHERE course_id LIKE 'demo-course%'");
  execIf("DELETE FROM computer_labs WHERE id LIKE 'demo-lab%'");
  execIf("DELETE FROM courseware WHERE id LIKE 'demo-cw%'");
  execIf("DELETE FROM question_bank_items WHERE id LIKE 'demo-qb%'");
  execIf("DELETE FROM reward_catalog WHERE id LIKE 'demo-reward%'");
  execIf('DELETE FROM users WHERE id IN (?, ?)', DEMO_TEACHER_ID, DEMO_TEACHER_B_ID);
  // v1 遗留：旧播种器可能写过裸 `usr_demo_teacher`
  execIf('DELETE FROM users WHERE id = ?', 'usr_demo_teacher');
}

/** 白板课环节（5 种全覆盖）。 */
function whiteboardTimeline(prefix: string, subject: string): Record<string, unknown>[] {
  return [
    { id: `${prefix}-seg-intro`, title: '课堂导入', type: 'intro', duration: '5m', notes: `${subject}情境导入` },
    { id: `${prefix}-seg-lecture`, title: '概念精讲', type: 'lecture', duration: '15m', notes: '核心概念讲解' },
    { id: `${prefix}-seg-practice`, title: '动手实践', type: 'practice', duration: '15m', notes: '机房上机操作' },
    {
      id: `${prefix}-seg-quiz`,
      title: '随堂测验',
      type: 'quiz',
      duration: '8m',
      notes: '答题后进入总结',
      gates: [{ id: `${prefix}-gate-quiz`, type: 'allPreviousCompleted', params: {} }],
    },
    { id: `${prefix}-seg-summary`, title: '课堂总结', type: 'summary', duration: '5m', notes: '回顾与作业布置' },
  ];
}

/** 学案课环节（3 种全覆盖）。 */
function xueanTimeline(prefix: string): Record<string, unknown>[] {
  return [
    { id: `${prefix}-seg-preview`, title: '预习', type: 'xuean:preview', duration: '10m' },
    { id: `${prefix}-seg-study`, title: '研读', type: 'xuean', duration: '20m' },
    { id: `${prefix}-seg-drill`, title: '练习', type: 'xuean:drill', duration: '15m' },
  ];
}

/** 白板课程定义。elements 的 data 均为组件私有字段，坐标/placement 在播种时补齐。 */
interface DemoElement {
  type: string;
  segmentId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Record<string, unknown>;
  /** learning_surface 元素需要的 Surface 渲染器与来源 */
  surface?: { rendererId: string; source: Record<string, unknown>; config?: Record<string, unknown> };
}

interface DemoLesson {
  id: string;
  title: string;
  content: string;
  deliveryMode: 'whiteboard' | 'xuean';
  modePackId: string | null;
  timeline: Record<string, unknown>[];
  elements: DemoElement[];
  activities: {
    id: string;
    type: string;
    title: string;
    config: Record<string, unknown>;
    submissionType?: string;
    peerReview?: boolean;
    groupMode?: string;
    rubric?: Record<string, unknown>;
    surface?: { rendererId: string; source: Record<string, unknown>; config?: Record<string, unknown> };
  }[];
  blocks: {
    id: string;
    blockType: string;
    content: Record<string, unknown> | unknown[];
    surface?: { rendererId: string; source: Record<string, unknown>; config?: Record<string, unknown> };
  }[];
}

/** 4 门演示课程完整定义（小学信息科技 · 2022 课标四主线）。 */
function buildDemoLessons(): DemoLesson[] {
  const wb1 = DEMO_IDS.lesson;
  const wb2 = DEMO_IDS.lessonSort;
  const xa1 = DEMO_IDS.lessonXueanNet;
  const xa2 = DEMO_IDS.lessonXueanTraffic;

  return [
    {
      id: wb1,
      title: `${DEMO_TAG} 探秘二进制——数据是怎么表示的`,
      content: `## 教学目标

- 知道计算机内部用 **0 和 1** 表示所有信息。
- 能把 10 以内的十进制数转换成二进制。
- 通过卡片游戏体会"逢二进一"。

## 学习任务

1. 观察：为什么灯泡只有"亮 / 灭"两种状态？
2. 操作：用 4 张 1/2/4/8 的卡片表示数字。
3. 测验：完成随堂小测。

> 本课为演示课程，对应义务教育信息科技课程标准（2022 年版）第二学段「数据与编码」。`,
      deliveryMode: 'whiteboard',
      modePackId: null,
      timeline: whiteboardTimeline(wb1, '二进制'),
      elements: [
        {
          type: 'page_meta',
          segmentId: '',
          page: 0,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          data: { pages: [{ id: 'page-1', title: '第 1 页 · 二进制', order: 0 }] },
        },
        {
          type: 'presentation',
          segmentId: `${wb1}-seg-intro`,
          page: 0,
          x: 40,
          y: 40,
          width: 640,
          height: 360,
          data: { markdown: '# 探秘二进制\n\n---\n\n## 灯泡为什么只有两种状态？\n\n亮 = 1，灭 = 0' },
        },
        {
          type: 'text',
          segmentId: `${wb1}-seg-lecture`,
          page: 0,
          x: 60,
          y: 420,
          width: 520,
          height: 60,
          data: { text: '逢二进一：1 + 1 = 10', fontSize: 28, color: '#1e3a8a' },
        },
        {
          type: 'math-graph',
          segmentId: `${wb1}-seg-lecture`,
          page: 0,
          x: 620,
          y: 420,
          width: 320,
          height: 220,
          data: { equation: '2**x', title: '2 的幂' },
        },
        {
          type: 'code-sandbox',
          segmentId: `${wb1}-seg-practice`,
          page: 0,
          x: 40,
          y: 500,
          width: 520,
          height: 240,
          data: { code: 'console.log((13).toString(2)); // 1101', language: 'javascript' },
        },
        {
          type: 'quiz',
          segmentId: `${wb1}-seg-quiz`,
          page: 0,
          x: 600,
          y: 500,
          width: 460,
          height: 240,
          data: {
            question: '二进制数 1011 对应的十进制数是多少？',
            options: ['9', '11', '13', '15'],
            correctIndex: 1,
            explanation: '1×8 + 0×4 + 1×2 + 1×1 = 11',
          },
        },
        {
          type: 'rollcall',
          segmentId: `${wb1}-seg-practice`,
          page: 0,
          x: 40,
          y: 760,
          width: 260,
          height: 120,
          data: { allStudents: [], title: '随机点名' },
        },
        {
          type: 'timer',
          segmentId: `${wb1}-seg-practice`,
          page: 0,
          x: 320,
          y: 760,
          width: 200,
          height: 120,
          data: { durationSec: 300, title: '实践计时' },
        },
        {
          type: 'assignment',
          segmentId: `${wb1}-seg-summary`,
          page: 0,
          x: 600,
          y: 760,
          width: 460,
          height: 120,
          data: { title: '课后任务：用卡片表示 1~15', description: '拍照上传你的卡片排列。' },
        },
        {
          type: 'learning_surface',
          segmentId: `${wb1}-seg-practice`,
          page: 0,
          x: 40,
          y: 900,
          width: 900,
          height: 460,
          data: {},
          surface: {
            rendererId: 'html_courseware',
            source: { kind: 'courseware', id: 'demo-cw-1' },
            config: { title: '互动课件：二进制卡片', height: 420 },
          },
        },
      ],
      activities: [],
      blocks: [],
    },
    {
      id: wb2,
      title: `${DEMO_TAG} 玩转排序——让数据排好队`,
      content: `## 教学目标

- 理解排序是"按规则重新排列"的算法。
- 用冒泡排序完成一组身高数据的升序排列。
- 比较不同排序方法的步数。

## 学习任务

1. 情境：运动会入场式按身高排队。
2. 实践：用卡片模拟冒泡排序的每一轮比较。
3. 测验：判断给定序列经过一轮冒泡后的结果。

> 对应第三学段「身边的算法」。`,
      deliveryMode: 'whiteboard',
      modePackId: null,
      timeline: whiteboardTimeline(wb2, '排序'),
      elements: [
        {
          type: 'page_meta',
          segmentId: '',
          page: 0,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          data: { pages: [{ id: 'page-1', title: '第 1 页 · 排序', order: 0 }] },
        },
        {
          type: 'presentation',
          segmentId: `${wb2}-seg-intro`,
          page: 0,
          x: 40,
          y: 40,
          width: 640,
          height: 360,
          data: { markdown: '# 玩转排序\n\n---\n\n## 为什么要排序？\n\n运动会入场式按身高排队' },
        },
        {
          type: 'code-sandbox',
          segmentId: `${wb2}-seg-practice`,
          page: 0,
          x: 40,
          y: 420,
          width: 600,
          height: 300,
          data: { code: 'const a=[5,3,8,4,2];\na.sort((x,y)=>x-y);\nconsole.log(a);', language: 'javascript' },
        },
        {
          type: 'quiz',
          segmentId: `${wb2}-seg-quiz`,
          page: 0,
          x: 680,
          y: 420,
          width: 420,
          height: 220,
          data: {
            question: '对 [5,3,8,4] 做一轮升序冒泡，序列变成？',
            options: ['[3,5,4,8]', '[3,4,5,8]', '[5,3,4,8]', '[3,5,8,4]'],
            correctIndex: 0,
          },
        },
        {
          type: 'timer',
          segmentId: `${wb2}-seg-practice`,
          page: 0,
          x: 40,
          y: 740,
          width: 200,
          height: 100,
          data: { durationSec: 240, title: '小组计时' },
        },
        {
          type: 'assignment',
          segmentId: `${wb2}-seg-summary`,
          page: 0,
          x: 280,
          y: 740,
          width: 500,
          height: 120,
          data: { title: '课后任务：记录冒泡排序的每一轮', description: '用表格写出 5 个数的排序过程。' },
        },
        {
          type: 'learning_surface',
          segmentId: `${wb2}-seg-practice`,
          page: 0,
          x: 40,
          y: 880,
          width: 900,
          height: 460,
          data: {},
          surface: {
            rendererId: 'html_courseware',
            source: { kind: 'resource', id: 'demo-res-1' },
            config: { title: '互动课件：排序演示' },
          },
        },
      ],
      activities: [],
      blocks: [],
    },
    {
      id: xa1,
      title: `${DEMO_TAG} 网络安全小卫士——保护个人信息`,
      content: `## 学习目标

- 说出个人信息泄露的常见途径。
- 会设置强密码并识别钓鱼链接。
- 形成"先核实、再点击"的安全习惯。

## 学习方式

按 **预习 → 研读 → 练习** 完成学案活动。

> 对应第二学段「在线学习与生活」。`,
      deliveryMode: 'xuean',
      modePackId: XUEAN_MODE_PACK_ID,
      timeline: xueanTimeline(xa1),
      elements: [],
      activities: [
        {
          id: `${xa1}-act-reading`,
          type: 'reading',
          title: '预习：阅读《网络安全小手册》',
          config: {
            content: '# 阅读任务\n\n圈出文中提到的 3 种信息泄露途径，并记录你的疑问。',
            url: '',
          },
        },
        {
          id: `${xa1}-act-submission`,
          type: 'submission',
          title: '研读：提交一条强密码',
          submissionType: 'text',
          peerReview: true,
          config: {
            instructions: '写一个至少 8 位、包含字母数字和符号的密码，并说明为什么安全。',
            acceptText: true,
            acceptLink: false,
          },
          rubric: {
            criteria: [
              { name: '长度与复杂度', max: 5 },
              { name: '说明合理性', max: 5 },
            ],
          },
        },
        {
          id: `${xa1}-act-quiz`,
          type: 'quiz',
          title: '练习：随堂测验',
          config: {
            assessmentId: 'demo-assessment-1',
            classId: DEMO_IDS.primaryClass,
            assignmentId: 'demo-assgn-assessment-1',
          },
        },
        {
          id: `${xa1}-act-survey`,
          type: 'survey',
          title: '调查：你的上网习惯',
          config: {
            description: '请如实填写，仅用于课堂统计。',
            questions: [
              {
                id: 'q1',
                title: '你每天上网大约多久？',
                type: 'single',
                options: ['少于 30 分钟', '30~60 分钟', '1 小时以上'],
                required: true,
              },
            ],
          },
        },
        {
          id: `${xa1}-act-discussion`,
          type: 'discussion',
          title: '讨论：收到中奖短信怎么办？',
          groupMode: 'group',
          config: { prompt: '同学收到"免费中奖"短信，你建议他怎么做？为什么？', allowReplies: true },
        },
        {
          id: `${xa1}-act-courseware`,
          type: 'courseware',
          title: '课件：识别钓鱼链接',
          config: {},
          surface: {
            rendererId: 'html_courseware',
            source: { kind: 'courseware', id: 'demo-cw-1' },
            config: { title: '识别钓鱼链接' },
          },
        },
        {
          id: `${xa1}-act-scratch`,
          type: 'scratch',
          title: '创作：安全上网宣传画',
          config: { instructions: '用绘图工具画一张"保护个人信息"宣传画。' },
        },
        {
          id: `${xa1}-act-form`,
          type: 'form',
          title: '表单：课堂自评',
          config: {
            description: '自我评价本节课的参与度。',
            fields: [
              {
                id: 'f1',
                label: '我做到了不随意填写真实信息',
                type: 'single',
                options: ['做到', '基本做到', '还需努力'],
                required: true,
              },
            ],
          },
        },
      ],
      blocks: [
        {
          id: `${xa1}-blk-home`,
          blockType: 'xuean_home',
          content: { intro: '欢迎来到学案课：按「预习 → 研读 → 练习」完成 8 个活动。', backgroundImage: '' },
        },
        {
          id: `${xa1}-blk-cw`,
          blockType: 'interactive_courseware',
          content: { coursewareUuid: 'demo-cw-1', resourceId: null, title: '互动课件：识别钓鱼链接' },
          surface: {
            rendererId: 'html_courseware',
            source: { kind: 'courseware', id: 'demo-cw-1' },
            config: { title: '互动课件：识别钓鱼链接' },
          },
        },
        {
          id: `${xa1}-blk-goals`,
          blockType: 'learning_goals',
          content: { goals: ['说出 3 种信息泄露途径', '会设置强密码', '能识别钓鱼链接'] },
        },
        {
          id: `${xa1}-blk-resources`,
          blockType: 'resources',
          content: ['教材 P12-P15', '网络安全微视频', '强密码生成器的使用说明'],
        },
      ],
    },
    {
      id: xa2,
      title: `${DEMO_TAG} 智能红绿灯——生活中的自动控制`,
      content: `## 学习目标

- 描述红绿灯"输入—计算—输出"的控制过程。
- 用流程图表达一个简单的自动控制逻辑。
- 了解传感器在自动控制中的作用。

## 学习方式

按 **预习 → 研读 → 练习** 完成学案活动。

> 对应第三学段「过程与控制」。`,
      deliveryMode: 'xuean',
      modePackId: XUEAN_MODE_PACK_ID,
      timeline: xueanTimeline(xa2),
      elements: [],
      activities: [
        {
          id: `${xa2}-act-reading`,
          type: 'reading',
          title: '预习：红绿灯是怎样工作的？',
          config: { content: '阅读材料，找出红绿灯的三个组成部分：输入、计算、输出。', url: '' },
        },
        {
          id: `${xa2}-act-submission`,
          type: 'submission',
          title: '研读：画出控制流程图',
          submissionType: 'link',
          config: { instructions: '上传你画的"车辆到达 → 切换信号灯"流程图。', acceptText: true, acceptLink: true },
        },
        {
          id: `${xa2}-act-discussion`,
          type: 'discussion',
          title: '讨论：如果传感器坏了会怎样？',
          config: { prompt: '分组讨论：地磁传感器失效时，红绿灯应如何保证安全？', allowReplies: true },
        },
        {
          id: `${xa2}-act-courseware`,
          type: 'courseware',
          title: '课件：控制过程演示',
          config: {},
          surface: {
            rendererId: 'presentation',
            source: { kind: 'inline' },
            config: { markdown: '# 输入 → 计算 → 输出\n\n---\n\n感应车辆 → 判断等待时间 → 切换信号灯' },
          },
        },
        {
          id: `${xa2}-act-quiz`,
          type: 'quiz',
          title: '练习：随堂测验',
          config: {
            assessmentId: 'demo-assessment-1',
            classId: DEMO_IDS.thirdClass,
            assignmentId: 'demo-assgn-assessment-1',
          },
        },
      ],
      blocks: [
        {
          id: `${xa2}-blk-home`,
          blockType: 'xuean_home',
          content: { intro: '从身边的红绿灯出发，理解自动控制的三要素。', backgroundImage: '' },
        },
        {
          id: `${xa2}-blk-goals`,
          blockType: 'learning_goals',
          content: { goals: ['描述输入—计算—输出', '会画控制流程图', '理解传感器的作用'] },
        },
      ],
    },
  ];
}

/**
 * 播种演示数据（幂等）。
 *
 * 已播种时直接返回现有登记，不做任何写入 —— 重复点击不会产生第二份数据。
 * 未播种但存在旧版残留时会先清空演示 ID 命名空间，再重新播种。
 */
export function seedDemoData(db: Database.Database): DemoDataStatus {
  ensureRegistryTable(db);

  const existing = getDemoDataStatus(db);
  if (existing.seeded) return existing;

  const now = Date.now();
  const register = db.prepare(
    'INSERT OR IGNORE INTO demo_data_registry (entity_type, entity_id, created_at) VALUES (?, ?, ?)',
  );
  const mark = (type: EntityType, id: string) => register.run(type, id, now);
  const insert = (table: string, cols: string[], ...values: unknown[]) => {
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...values);
  };
  const studentHash = hashPassword(DEMO_TEACHER.password);
  const lessons = buildDemoLessons();

  const tx = db.transaction(() => {
    purgeDemoNamespace(db);

    // ── 1. 演示教师 ×2 ────────────────────────────────────────────
    for (const [teacher, id] of [
      [DEMO_TEACHER, DEMO_TEACHER_ID],
      [DEMO_TEACHER_B, DEMO_TEACHER_B_ID],
    ] as const) {
      insert(
        'users',
        [
          'id',
          'username',
          'password_hash',
          'role',
          'name',
          'created_at',
          'status',
          'must_change_password',
          'tour_status',
        ],
        id,
        teacher.username,
        hashPassword(teacher.password),
        'teacher',
        teacher.name,
        now,
        'active',
        0,
        'completed',
      );
      mark('user', id);
    }

    // ── 2. 机房 ×2 ────────────────────────────────────────────────
    for (const [id, room] of [
      [DEMO_IDS.lab1, '信息技术机房(一)'],
      [DEMO_IDS.lab2, '信息技术机房(二)'],
    ] as const) {
      insert('computer_labs', ['id', 'room_number', 'rows', 'cols', 'created_at'], id, room, 6, 4, now);
      mark('lab', id);
    }

    // ── 3. 课程（课程中心）×1 ────────────────────────────────────
    insert(
      'courses',
      ['id', 'title', 'description', 'owner_user_id', 'term', 'visibility', 'created_at', 'updated_at'],
      DEMO_IDS.course,
      `${DEMO_TAG} 小学信息科技 · 四主线单元`,
      '覆盖数据与编码、算法、在线生活、过程与控制四个模块。',
      DEMO_TEACHER_ID,
      DEMO_ACADEMIC_YEAR,
      'private',
      now,
      now,
    );
    mark('course', DEMO_IDS.course);

    // ── 4. 班级 ×3 ────────────────────────────────────────────────
    const classDefs = [
      { id: DEMO_IDS.primaryClass, name: '三年级(1)班', passcode: '1001', lab: DEMO_IDS.lab1, owner: DEMO_TEACHER_ID },
      {
        id: DEMO_IDS.secondaryClass,
        name: '五年级(1)班',
        passcode: '1002',
        lab: DEMO_IDS.lab1,
        owner: DEMO_TEACHER_B_ID,
      },
      { id: DEMO_IDS.thirdClass, name: '五年级(2)班', passcode: '1003', lab: DEMO_IDS.lab2, owner: DEMO_TEACHER_ID },
    ];
    const classCols = db.prepare('PRAGMA table_info(classes)').all() as { name: string }[];
    const hasOwner = classCols.some((col) => col.name === 'owner_user_id');
    for (const c of classDefs) {
      const cols = hasOwner
        ? [
            'id',
            'name',
            'description',
            'lab_id',
            'class_passcode',
            'class_passcode_expires_at',
            'owner_user_id',
            'created_at',
          ]
        : ['id', 'name', 'description', 'lab_id', 'class_passcode', 'class_passcode_expires_at', 'created_at'];
      const values: unknown[] = [
        c.id,
        `${DEMO_TAG} ${c.name}`,
        '系统一键生成的演示班级，用于 Demo 演示与功能验收。',
        c.lab,
        sealClassPasscode(c.passcode),
        now + 365 * 24 * 3600 * 1000,
      ];
      if (hasOwner) values.push(c.owner);
      values.push(now);
      insert('classes', cols, ...values);
      mark('class', c.id);
    }

    // ── 5. 学生 ×24 + 班级关系 + 座位 + 分组 ─────────────────────
    STUDENT_NAMES.forEach((name, i) => {
      const n = i + 1;
      const id = `demo-stu-${String(n).padStart(2, '0')}`;
      const classIdx = i < 8 ? 0 : i < 16 ? 1 : 2;
      const classId = classDefs[classIdx]!.id;
      insert(
        'students',
        ['id', 'student_number', 'name', 'password', 'gender', 'email', 'created_at'],
        id,
        `DEMO-S${String(n).padStart(2, '0')}`,
        name,
        studentHash,
        i % 2 === 0 ? 'male' : 'female',
        `${id}@demo.local`,
        now,
      );
      mark('student', id);

      insert('class_students', ['class_id', 'student_id', 'joined_at'], classId, id, now);
      mark('class_student', `${classId}::${id}`);

      insert(
        'course_enrollments',
        ['course_id', 'student_id', 'class_id', 'enrolled_at'],
        DEMO_IDS.course,
        id,
        classId,
        now,
      );
      mark('course_enrollment', `${DEMO_IDS.course}::${id}`);

      // 座位：每班 8 人。一班/二班共用机房一，按班级错开行段；三班独占机房二。
      const seatIdx = i % 8;
      const row = (classIdx % 2) * 2 + Math.floor(seatIdx / 4);
      const col = seatIdx % 4;
      insert(
        'student_seats',
        ['class_id', 'student_id', 'lab_id', 'row_idx', 'col_idx'],
        classId,
        id,
        classDefs[classIdx]!.lab,
        row,
        col,
      );
      mark('seat', `${classId}::${id}`);
    });

    // 分组：每班 2 组，组长在成员列表内
    for (const c of classDefs) {
      const members = STUDENT_NAMES.map((_, i) => `demo-stu-${String(i + 1).padStart(2, '0')}`).filter(
        (id, i) => (i < 8 ? 0 : i < 16 ? 1 : 2) === classDefs.indexOf(c),
      );
      for (let g = 0; g < 2; g++) {
        const groupId = `demo-grp-${c.id.slice(-1)}-${g + 1}`;
        const groupMembers = members.slice(g * 4, g * 4 + 4);
        insert(
          'class_groups',
          [
            'id',
            'class_id',
            'name',
            'name_en',
            'color',
            'member_ids',
            'leader_id',
            'is_default',
            'sort_order',
            'created_at',
            'updated_at',
          ],
          groupId,
          c.id,
          `第${g + 1}组`,
          `Group ${g + 1}`,
          g === 0 ? 'bg-indigo-500' : 'bg-emerald-500',
          JSON.stringify(groupMembers),
          groupMembers[0]!,
          1,
          100 + g,
          now,
          now,
        );
        mark('group', groupId);
      }
    }

    // ── 6. 课程 ×4（白板 / 学案双模式，全环节）───────────────────
    // 课件（供 LearningSurface 引用）
    insert(
      'courseware',
      ['id', 'uuid', 'name', 'type', 'entry', 'created_at'],
      'demo-cw-1',
      'demo-cw-1',
      '互动课件：二进制卡片',
      'html',
      'demo-courseware.html',
      now,
    );
    mark('courseware', 'demo-cw-1');
    insert(
      'courseware_score_config',
      [
        'courseware_id',
        'courseware_name',
        'score_policy',
        'score_fields',
        'raw_full_score',
        'target_full_score',
        'weight_percentage',
        'lesson_id',
        'updated_at',
        'auto_record_enabled',
        'auto_record_min_completion',
        'auto_record_strategy',
      ],
      'demo-cw-1',
      '互动课件：二进制卡片',
      'LATEST',
      'score',
      100,
      100,
      100,
      DEMO_IDS.lesson,
      now,
      1,
      0.6,
      'latest',
    );
    mark('score_config', 'demo-cw-1');

    for (const lesson of lessons) {
      insert(
        'lessons',
        [
          'id',
          'title',
          'content',
          'timeline',
          'progress_mode',
          'created_at',
          'updated_at',
          'creator_id',
          'course_id',
          'delivery_mode',
          'mode_pack_id',
          'source_package_key',
          'source_package_id',
          'source_package_hash',
        ],
        lesson.id,
        lesson.title,
        lesson.content,
        JSON.stringify(lesson.timeline),
        'manual',
        now,
        now,
        DEMO_TEACHER_ID,
        DEMO_IDS.course,
        lesson.deliveryMode,
        lesson.modePackId,
        `id:demo-pkg-${lesson.id}`,
        `demo-pkg-${lesson.id}`,
        `sha256-demo-${lesson.id}`,
      );
      mark('lesson', lesson.id);

      // 白板元素
      for (const [i, el] of lesson.elements.entries()) {
        const elId = `demo-el-${lesson.id}-${String(i + 1).padStart(2, '0')}`;
        let data = { ...el.data };
        if (el.type !== 'page_meta') {
          data = {
            ...data,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            page: el.page,
            segmentId: el.segmentId,
          };
        }
        let surfaceId: string | null;
        if (el.surface) {
          surfaceId = `lsm_wb_${elId}`;
          data = { ...data, surfaceId };
          insert(
            'learning_surfaces',
            ['id', 'lesson_id', 'kind', 'owner_id', 'content_ref_json', 'created_at', 'updated_at'],
            surfaceId,
            lesson.id,
            'whiteboard_element',
            elId,
            JSON.stringify({ rendererId: el.surface.rendererId, source: el.surface.source, config: el.surface.config }),
            now,
            now,
          );
          mark('surface', surfaceId);
        }
        insert(
          'whiteboard_elements',
          ['id', 'lesson_id', 'type', 'data', 'created_at'],
          elId,
          lesson.id,
          el.type,
          JSON.stringify(data),
          now,
        );
        mark('whiteboard_element', elId);
      }

      // 学案首页块（互动课件块必须建 Surface 并回写 surface_id）
      for (const [i, block] of lesson.blocks.entries()) {
        const blockId = block.id || `demo-blk-${lesson.id}-${i + 1}`;
        let surfaceId: string | null = null;
        if (block.surface) {
          surfaceId = `lsm_blk_${blockId}`;
          insert(
            'learning_surfaces',
            ['id', 'lesson_id', 'kind', 'owner_id', 'content_ref_json', 'created_at', 'updated_at'],
            surfaceId,
            lesson.id,
            'lesson_block',
            blockId,
            JSON.stringify({
              rendererId: block.surface.rendererId,
              source: block.surface.source,
              config: block.surface.config,
            }),
            now,
            now,
          );
          mark('surface', surfaceId);
        }
        insert(
          'lesson_activity_blocks',
          ['id', 'lesson_id', 'block_type', 'content_json', 'order_index', 'surface_id', 'created_at', 'updated_at'],
          blockId,
          lesson.id,
          block.blockType,
          JSON.stringify(block.content),
          i,
          surfaceId,
          now,
          now,
        );
        mark('block', blockId);
      }

      // 学案活动
      for (const [i, activity] of lesson.activities.entries()) {
        let surfaceId: string | null = null;
        if (activity.surface) {
          surfaceId = `lsm_act_${activity.id}`;
          insert(
            'learning_surfaces',
            ['id', 'lesson_id', 'kind', 'owner_id', 'content_ref_json', 'created_at', 'updated_at'],
            surfaceId,
            lesson.id,
            'lesson_activity',
            activity.id,
            JSON.stringify({
              rendererId: activity.surface.rendererId,
              source: activity.surface.source,
              config: activity.surface.config,
            }),
            now,
            now,
          );
          mark('surface', surfaceId);
        }
        insert(
          'lesson_activities',
          [
            'id',
            'lesson_id',
            'order_index',
            'type',
            'title',
            'config_json',
            'required',
            'visible',
            'peer_review',
            'group_mode',
            'submission_type',
            'rubric_json',
            'surface_id',
            'created_at',
            'updated_at',
          ],
          activity.id,
          lesson.id,
          i,
          activity.type,
          activity.title,
          JSON.stringify(activity.config),
          1,
          1,
          activity.peerReview ? 1 : 0,
          activity.groupMode ?? 'none',
          activity.submissionType ?? null,
          activity.rubric ? JSON.stringify(activity.rubric) : null,
          surfaceId,
          now,
          now,
        );
        mark('activity', activity.id);
      }

      // 课时级提交 Surface（lesson_eval）
      if (lesson.deliveryMode === 'xuean') {
        const evalSurfaceId = `lsm_eval_${lesson.id}`;
        insert(
          'learning_surfaces',
          ['id', 'lesson_id', 'kind', 'owner_id', 'content_ref_json', 'created_at', 'updated_at'],
          evalSurfaceId,
          lesson.id,
          'lesson_eval',
          lesson.id,
          JSON.stringify({
            rendererId: 'assignment_submission',
            source: { kind: 'assignment', id: 'demo-asg-1' },
            config: { title: '课时作业' },
          }),
          now,
          now,
        );
        mark('surface', evalSurfaceId);
      }
    }

    // Surface 作答快照（2 名学生）
    for (const [i, surfaceId] of [
      `lsm_wb_demo-el-${DEMO_IDS.lesson}-10`,
      `lsm_blk_${DEMO_IDS.lessonXueanNet}-blk-cw`,
    ].entries()) {
      const attemptId = `lsam_demo_${i + 1}`;
      const lessonId = i === 0 ? DEMO_IDS.lesson : DEMO_IDS.lessonXueanNet;
      insert(
        'learning_surface_attempts',
        [
          'id',
          'lesson_id',
          'surface_id',
          'student_id',
          'attempt_no',
          'renderer_id',
          'status',
          'auto_score',
          'score',
          'max_score',
          'completion',
          'state_json',
          'submitted_at',
          'created_at',
          'updated_at',
        ],
        attemptId,
        lessonId,
        surfaceId,
        `demo-stu-${String(i + 1).padStart(2, '0')}`,
        1,
        'html_courseware',
        'submitted',
        85,
        85,
        100,
        1,
        JSON.stringify({ demo: true, step: 'completed' }),
        now,
        now,
        now,
      );
      mark('surface_attempt', attemptId);
    }

    // ── 7. 课表 ×8 ────────────────────────────────────────────────
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateAt = (daysFromNow: number, hour: number, minute = 0) => {
      const d = new Date(now + daysFromNow * 24 * 3600 * 1000);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(hour)}:${pad(minute)}:00`;
    };
    const scheduleDefs = [
      {
        id: DEMO_IDS.schedule,
        classId: DEMO_IDS.primaryClass,
        lessonId: DEMO_IDS.lesson,
        day: 1,
        slot: '第1节',
        hour: 9,
        status: 'scheduled',
      },
      {
        id: 'demo-sch-02',
        classId: DEMO_IDS.secondaryClass,
        lessonId: DEMO_IDS.lessonSort,
        day: 1,
        slot: '第3节',
        hour: 10,
        status: 'scheduled',
      },
      {
        id: 'demo-sch-03',
        classId: DEMO_IDS.thirdClass,
        lessonId: DEMO_IDS.lessonXueanTraffic,
        day: 2,
        slot: '第2节',
        hour: 9,
        status: 'scheduled',
      },
      {
        id: 'demo-sch-04',
        classId: DEMO_IDS.primaryClass,
        lessonId: DEMO_IDS.lessonXueanNet,
        day: 3,
        slot: '第1节',
        hour: 9,
        status: 'scheduled',
      },
      {
        id: 'demo-sch-05',
        classId: DEMO_IDS.secondaryClass,
        lessonId: DEMO_IDS.lesson,
        day: 4,
        slot: '第4节',
        hour: 11,
        status: 'scheduled',
      },
      {
        id: 'demo-sch-06',
        classId: DEMO_IDS.thirdClass,
        lessonId: DEMO_IDS.lessonSort,
        day: 5,
        slot: '第2节',
        hour: 9,
        status: 'scheduled',
      },
      {
        id: 'demo-sch-07',
        classId: DEMO_IDS.primaryClass,
        lessonId: DEMO_IDS.lessonSort,
        day: -2,
        slot: '第1节',
        hour: 9,
        status: 'completed',
      },
      {
        id: 'demo-sch-08',
        classId: DEMO_IDS.secondaryClass,
        lessonId: DEMO_IDS.lessonXueanNet,
        day: 6,
        slot: '第1节',
        hour: 9,
        status: 'cancelled',
      },
    ];
    for (const s of scheduleDefs) {
      insert(
        'schedules',
        [
          'id',
          'class_id',
          'lesson_id',
          'scheduled_date',
          'time_slot',
          'status',
          'notes',
          'created_at',
          'academic_year',
        ],
        s.id,
        s.classId,
        s.lessonId,
        dateAt(s.day, s.hour),
        s.slot,
        s.status,
        `演示课表：${s.status === 'completed' ? '已完成' : s.status === 'cancelled' ? '已取消（演示异常场景）' : '待上课'}。`,
        now,
        DEMO_ACADEMIC_YEAR,
      );
      mark('schedule', s.id);
    }

    // ── 8. 作业（含成绩项去重键）─────────────────────────────────
    const assignmentDefs = [
      {
        id: 'demo-asg-1',
        classId: DEMO_IDS.primaryClass,
        lessonId: DEMO_IDS.lesson,
        title: '课后任务：卡片表示 1~15',
        content: JSON.stringify({ type: 'manual' }),
      },
      {
        id: 'demo-asg-2',
        classId: DEMO_IDS.secondaryClass,
        lessonId: DEMO_IDS.lessonSort,
        title: '课后任务：冒泡排序过程表',
        content: JSON.stringify({ type: 'manual' }),
      },
      {
        id: 'asg-cw-demo-cw-1',
        classId: DEMO_IDS.primaryClass,
        lessonId: DEMO_IDS.lesson,
        title: '互动课件: 二进制卡片',
        content: JSON.stringify({ type: 'interactive_courseware', coursewareUuid: 'demo-cw-1' }),
      },
      {
        id: 'xuean-activity:' + DEMO_IDS.lessonXueanNet + '-act-submission',
        classId: DEMO_IDS.primaryClass,
        lessonId: DEMO_IDS.lessonXueanNet,
        title: '学案活动：提交一条强密码',
        content: JSON.stringify({ adapter: 'xuean-adapter', activityId: `${DEMO_IDS.lessonXueanNet}-act-submission` }),
      },
    ];
    for (const a of assignmentDefs) {
      insert(
        'assignments',
        ['id', 'class_id', 'lesson_id', 'title', 'description', 'content', 'created_at', 'academic_year'],
        a.id,
        a.classId,
        a.lessonId,
        a.title,
        '演示作业，用于成绩归集与去重链路验收。',
        a.content,
        now,
        DEMO_ACADEMIC_YEAR,
      );
      mark('assignment', a.id);
    }

    // 作业提交（每份作业 2 名学生）
    assignmentDefs.forEach((a, ai) => {
      for (let k = 0; k < 2; k++) {
        const studentId = `demo-stu-${String(ai * 4 + k + 1).padStart(2, '0')}`;
        const score = [95, 88, 92, 76][(ai + k) % 4]!;
        insert(
          'assignment_submissions',
          [
            'assignment_id',
            'student_id',
            'content',
            'score',
            'feedback',
            'submitted_at',
            'graded_at',
            'status',
            'source',
            'graded_by',
            'academic_year',
          ],
          a.id,
          studentId,
          JSON.stringify({ demo: true, answer: '已完成' }),
          score,
          '演示评语：思路清晰，继续保持。',
          now,
          now,
          'graded',
          ai === 2 ? 'auto' : 'manual',
          DEMO_TEACHER_ID,
          DEMO_ACADEMIC_YEAR,
        );
        mark('submission', `${a.id}::${studentId}`);
      }
    });

    // 成绩修改历史（演示审计链）
    for (let i = 0; i < 2; i++) {
      const historyId = `demo-gh-${i + 1}`;
      const assignmentId = assignmentDefs[i]!.id;
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      insert(
        'assignment_grade_history',
        [
          'id',
          'assignment_id',
          'student_id',
          'old_score',
          'new_score',
          'old_status',
          'new_status',
          'old_source',
          'new_source',
          'actor_id',
          'actor_role',
          'reason',
          'created_at',
        ],
        historyId,
        assignmentId,
        studentId,
        80,
        [95, 88][i],
        'submitted',
        'graded',
        'manual',
        'manual',
        DEMO_TEACHER_ID,
        'teacher',
        '演示成绩复核',
        now,
      );
      mark('grade_history', historyId);
    }

    // ── 9. 测评体系（1 卷 3 题，2 名学生作答）────────────────────
    insert(
      'question_bank_items',
      [
        'id',
        'owner_id',
        'type',
        'stem',
        'config_json',
        'answer_key_json',
        'tags_json',
        'difficulty',
        'visibility',
        'created_at',
        'updated_at',
      ],
      'demo-qb-1',
      DEMO_TEACHER_ID,
      'single_choice',
      '二进制 1011 对应的十进制数是多少？',
      JSON.stringify({ options: ['9', '11', '13', '15'] }),
      JSON.stringify({ index: 1 }),
      JSON.stringify(['二进制', '数据与编码']),
      2,
      'private',
      now,
      now,
    );
    mark('bank_item', 'demo-qb-1');
    insert(
      'question_bank_items',
      [
        'id',
        'owner_id',
        'type',
        'stem',
        'config_json',
        'answer_key_json',
        'tags_json',
        'difficulty',
        'visibility',
        'created_at',
        'updated_at',
      ],
      'demo-qb-2',
      DEMO_TEACHER_ID,
      'multiple_choice',
      '下列哪些是强密码的特征？',
      JSON.stringify({ options: ['长度 ≥ 8', '包含符号', '使用生日', '大小写混合'] }),
      JSON.stringify({ indexes: [0, 1, 3] }),
      JSON.stringify(['网络安全']),
      2,
      'private',
      now,
      now,
    );
    mark('bank_item', 'demo-qb-2');
    insert(
      'question_bank_items',
      [
        'id',
        'owner_id',
        'type',
        'stem',
        'config_json',
        'answer_key_json',
        'tags_json',
        'difficulty',
        'visibility',
        'created_at',
        'updated_at',
      ],
      'demo-qb-3',
      DEMO_TEACHER_ID,
      'true_false',
      '收到"免费中奖"短信应立刻点击链接领取。',
      JSON.stringify({ options: ['正确', '错误'] }),
      JSON.stringify({ value: false }),
      JSON.stringify(['网络安全']),
      1,
      'private',
      now,
      now,
    );
    mark('bank_item', 'demo-qb-3');

    insert(
      'assessments',
      [
        'id',
        'kind',
        'title',
        'description',
        'owner_id',
        'settings_json',
        'status',
        'academic_year',
        'published_at',
        'created_at',
        'updated_at',
      ],
      'demo-assessment-1',
      'quiz',
      `${DEMO_TAG} 信息安全与编码 · 随堂测验`,
      '演示测验：3 题覆盖二进制、强密码与钓鱼识别。',
      DEMO_TEACHER_ID,
      JSON.stringify({
        timed: false,
        maxAttempts: 1,
        scorePolicy: 'last',
        shuffleItems: false,
        shuffleOptions: false,
        anonymous: false,
        resultVisibility: 'immediate',
        partialCredit: true,
        caseSensitive: false,
        countsTowardGrade: true,
        showItemAnalysis: true,
        strictProctor: false,
      }),
      'published',
      DEMO_ACADEMIC_YEAR,
      now,
      now,
      now,
    );
    mark('assessment', 'demo-assessment-1');

    const itemDefs = [
      {
        id: 'demo-item-1',
        bank: 'demo-qb-1',
        stem: '二进制 1011 对应的十进制数是多少？',
        config: { options: ['9', '11', '13', '15'] },
        answer: { index: 1 },
        type: 'single_choice',
        max: 30,
      },
      {
        id: 'demo-item-2',
        bank: 'demo-qb-2',
        stem: '下列哪些是强密码的特征？',
        config: { options: ['长度 ≥ 8', '包含符号', '使用生日', '大小写混合'] },
        answer: { indexes: [0, 1, 3] },
        type: 'multiple_choice',
        max: 40,
      },
      {
        id: 'demo-item-3',
        bank: 'demo-qb-3',
        stem: '收到"免费中奖"短信应立刻点击链接领取。',
        config: { options: ['正确', '错误'] },
        answer: { value: false },
        type: 'true_false',
        max: 30,
      },
    ];
    for (const [i, item] of itemDefs.entries()) {
      insert(
        'assessment_items',
        [
          'id',
          'assessment_id',
          'bank_item_id',
          'section',
          'sort_order',
          'type',
          'stem',
          'config_json',
          'answer_key_json',
          'max_score',
        ],
        item.id,
        'demo-assessment-1',
        item.bank,
        null,
        i,
        item.type,
        item.stem,
        JSON.stringify(item.config),
        JSON.stringify(item.answer),
        item.max,
      );
      mark('assessment_item', item.id);
    }
    insert(
      'assessment_assignments',
      [
        'id',
        'assessment_id',
        'class_id',
        'lesson_id',
        'schedule_id',
        'opens_at',
        'closes_at',
        'duration_sec',
        'status',
        'score_released',
        'created_by',
        'created_at',
        'academic_year',
      ],
      'demo-assgn-assessment-1',
      'demo-assessment-1',
      DEMO_IDS.primaryClass,
      DEMO_IDS.lessonXueanNet,
      DEMO_IDS.schedule,
      now - 3600_000,
      now + 7 * 24 * 3600_000,
      900,
      'open',
      1,
      DEMO_TEACHER_ID,
      now,
      DEMO_ACADEMIC_YEAR,
    );
    mark('assessment_assignment', 'demo-assgn-assessment-1');

    for (let i = 0; i < 2; i++) {
      const attemptId = `demo-att-${i + 1}`;
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      insert(
        'assessment_attempts',
        [
          'id',
          'assignment_id',
          'student_id',
          'attempt_no',
          'status',
          'started_at',
          'submitted_at',
          'score',
          'max_score',
          'needs_manual_review',
          'proctor_json',
          'academic_year',
        ],
        attemptId,
        'demo-assgn-assessment-1',
        studentId,
        1,
        'released',
        now,
        now,
        i === 0 ? 100 : 70,
        100,
        0,
        '{}',
        DEMO_ACADEMIC_YEAR,
      );
      mark('assessment_attempt', attemptId);
      for (const [j, item] of itemDefs.entries()) {
        const correct = i === 0 || j < 2;
        insert(
          'assessment_answers',
          [
            'attempt_id',
            'item_id',
            'answer_json',
            'score',
            'max_score',
            'is_correct',
            'grader',
            'graded_at',
            'manual_override',
            'updated_at',
          ],
          attemptId,
          item.id,
          JSON.stringify(item.answer),
          correct ? item.max : 0,
          item.max,
          correct ? 1 : 0,
          'auto',
          now,
          0,
          now,
        );
        mark('assessment_answer', `${attemptId}::${item.id}`);
      }
    }

    // ── 10. 考试 + 成绩 ───────────────────────────────────────────
    insert(
      'exams',
      ['id', 'class_id', 'title', 'description', 'max_score', 'created_at', 'academic_year'],
      'demo-exam-1',
      DEMO_IDS.primaryClass,
      `${DEMO_TAG} 第一单元测验`,
      '演示考试。',
      100,
      now,
      DEMO_ACADEMIC_YEAR,
    );
    mark('exam', 'demo-exam-1');
    for (let i = 0; i < 8; i++) {
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      insert(
        'exam_scores',
        ['exam_id', 'student_id', 'score', 'notes', 'recorded_at', 'academic_year'],
        'demo-exam-1',
        studentId,
        60 + i * 4,
        '演示成绩。',
        now,
        DEMO_ACADEMIC_YEAR,
      );
      mark('exam_score', `demo-exam-1::${studentId}`);
    }

    // ── 11. 考勤 / 签到 / 进度 ────────────────────────────────────
    for (let i = 0; i < 8; i++) {
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      insert(
        'attendance',
        ['schedule_id', 'student_id', 'status', 'recorded_at', 'academic_year'],
        DEMO_IDS.schedule,
        studentId,
        i === 7 ? 'late' : 'present',
        now,
        DEMO_ACADEMIC_YEAR,
      );
      mark('attendance', `${DEMO_IDS.schedule}::${studentId}`);
      insert('lesson_checkins', ['lesson_id', 'student_id', 'checked_in_at'], DEMO_IDS.lesson, studentId, now);
      mark('checkin', `${DEMO_IDS.lesson}::${studentId}`);
      insert(
        'student_lesson_progress',
        [
          'student_id',
          'lesson_id',
          'completed',
          'progress_percent',
          'completed_segments',
          'assigned_at',
          'verified',
          'verified_progress_percent',
          'academic_year',
        ],
        studentId,
        DEMO_IDS.lesson,
        i < 6 ? 1 : 0,
        i < 6 ? 100 : 60,
        JSON.stringify(lessons[0]!.timeline.map((s) => s.id).slice(0, i < 6 ? undefined : 3)),
        now,
        i < 6 ? 1 : 0,
        i < 6 ? 100 : 60,
        DEMO_ACADEMIC_YEAR,
      );
      mark('progress', `${DEMO_IDS.lesson}::${studentId}`);
    }

    // 随堂测验提交
    for (let i = 0; i < 6; i++) {
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      const quizId = `demo-quiz-${i + 1}`;
      insert(
        'lesson_quiz_submissions',
        [
          'id',
          'lesson_id',
          'element_id',
          'student_id',
          'student_name',
          'answer',
          'is_correct',
          'score',
          'submitted_at',
          'time_spent_ms',
        ],
        quizId,
        DEMO_IDS.lesson,
        `demo-el-${DEMO_IDS.lesson}-06`,
        studentId,
        STUDENT_NAMES[i],
        JSON.stringify({ choice: 1 }),
        i < 5 ? 1 : 0,
        i < 5 ? 100 : 0,
        now,
        45000 + i * 1000,
      );
      mark('quiz_submission', quizId);
    }

    // ── 12. 讨论 / 互评 / 活动进度 ────────────────────────────────
    const discussionDefs = [
      { id: 'demo-disc-1', parent: null, content: '我觉得收到中奖短信应该先删除，不点链接。' },
      { id: 'demo-disc-2', parent: 'demo-disc-1', content: '同意，还可以向家长或老师核实。' },
      { id: 'demo-disc-3', parent: null, content: '我们的流程图里加了"等待 30 秒"的判断。' },
    ];
    for (const [i, d] of discussionDefs.entries()) {
      insert(
        'lesson_discussions',
        ['id', 'activity_id', 'author_id', 'content', 'parent_id', 'created_at', 'updated_at'],
        d.id,
        `${DEMO_IDS.lessonXueanNet}-act-discussion`,
        `demo-stu-${String(i + 1).padStart(2, '0')}`,
        d.content,
        d.parent,
        now,
        now,
      );
      mark('discussion', d.id);
    }
    for (let i = 0; i < 2; i++) {
      const reviewId = `demo-peer-${i + 1}`;
      insert(
        'activity_peer_reviews',
        ['id', 'activity_id', 'reviewer_id', 'reviewee_id', 'score', 'comment', 'created_at'],
        reviewId,
        `${DEMO_IDS.lessonXueanNet}-act-submission`,
        `demo-stu-${String(i + 3).padStart(2, '0')}`,
        `demo-stu-${String(i + 1).padStart(2, '0')}`,
        i === 0 ? 9 : 8,
        '演示互评：密码解释得很清楚。',
        now,
      );
      mark('peer_review', reviewId);
    }
    for (let i = 0; i < 8; i++) {
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      const activityId = `${DEMO_IDS.lessonXueanNet}-act-${i < 4 ? 'reading' : 'submission'}`;
      insert(
        'activity_progress',
        [
          'activity_id',
          'student_id',
          'status',
          'progress_percent',
          'verified',
          'score',
          'submission_json',
          'last_activity_at',
        ],
        activityId,
        studentId,
        i < 6 ? 'graded' : 'in_progress',
        i < 6 ? 100 : 50,
        i < 6 ? 1 : 0,
        i < 6 ? 90 : null,
        JSON.stringify({ demo: true }),
        now,
      );
      mark('activity_progress', `${activityId}::${studentId}`);
    }

    // 活动运行记录（远程题型通道演示）
    insert(
      'activity_runs',
      [
        'id',
        'activity_id',
        'provider_id',
        'lesson_id',
        'class_id',
        'state',
        'actor_id',
        'started_at',
        'ended_at',
        'payload_json',
      ],
      'demo-run-1',
      `${DEMO_IDS.lessonXueanNet}-act-quiz`,
      'xuean-adapter',
      DEMO_IDS.lessonXueanNet,
      DEMO_IDS.primaryClass,
      'finished',
      DEMO_TEACHER_ID,
      now,
      now,
      JSON.stringify({ demo: true, slot: 0 }),
    );
    mark('activity_run', 'demo-run-1');

    // ── 13. 积分 / 奖励 ───────────────────────────────────────────
    for (let i = 0; i < 8; i++) {
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      const logId = `pt_demo_${String(i + 1).padStart(2, '0')}`;
      insert(
        'student_point_logs',
        ['id', 'student_id', 'class_id', 'dimension_id', 'delta_points', 'reason', 'created_at'],
        logId,
        studentId,
        DEMO_IDS.primaryClass,
        'diligence',
        5 + i,
        '演示积分：课堂表现优异',
        now,
      );
      mark('point_log', logId);
      const awardId = `aw_demo_${String(i + 1).padStart(2, '0')}`;
      insert(
        'credit_awards',
        [
          'id',
          'student_id',
          'class_id',
          'dimension_id',
          'delta_points',
          'source',
          'reason',
          'idempotency_key',
          'point_log_id',
          'actor_id',
          'created_at',
        ],
        awardId,
        studentId,
        DEMO_IDS.primaryClass,
        'diligence',
        5 + i,
        'manual',
        '演示积分发放',
        `manual:demo:class-01:stu-${String(i + 1).padStart(2, '0')}:001`,
        logId,
        DEMO_TEACHER_ID,
        now,
      );
      mark('credit_award', awardId);
    }
    for (const [id, name, cost] of [
      ['demo-reward-1', '免作业卡', 20],
      ['demo-reward-2', '优先选座卡', 30],
    ] as const) {
      insert(
        'reward_catalog',
        [
          'id',
          'name',
          'name_en',
          'description',
          'icon',
          'color',
          'cost_points',
          'stock',
          'redeemed_count',
          'status',
          'sort_order',
          'created_at',
          'updated_at',
        ],
        id,
        name,
        id === 'demo-reward-1' ? 'Homework Pass' : 'Priority Seat',
        '演示奖励。',
        'Star',
        'bg-amber-500',
        cost,
        10,
        2,
        'active',
        100,
        now,
        now,
      );
      mark('reward', id);
    }
    for (let i = 0; i < 2; i++) {
      const redemptionId = `demo-redemption-${i + 1}`;
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      insert(
        'reward_redemptions',
        [
          'id',
          'student_id',
          'class_id',
          'reward_id',
          'reward_name',
          'cost_points',
          'idempotency_key',
          'balance_before',
          'balance_after',
          'status',
          'actor_id',
          'created_at',
        ],
        redemptionId,
        studentId,
        DEMO_IDS.primaryClass,
        `demo-reward-${i + 1}`,
        i === 0 ? '免作业卡' : '优先选座卡',
        i === 0 ? 20 : 30,
        `redeem:demo:stu-${i + 1}:001`,
        100,
        100 - (i === 0 ? 20 : 30),
        'completed',
        DEMO_TEACHER_ID,
        now,
      );
      mark('redemption', redemptionId);
    }

    // ── 14. 班级成绩权重 + 学期报告 ───────────────────────────────
    for (const c of classDefs) {
      insert(
        'class_grade_weights',
        ['class_id', 'attendance_weight', 'progress_weight', 'assignment_weight', 'exam_weight', 'updated_at'],
        c.id,
        0.15,
        0.25,
        0.35,
        0.25,
        now,
      );
      mark('grade_weight', c.id);
    }
    for (let i = 0; i < 3; i++) {
      const reportId = `demo-report-${i + 1}`;
      const studentId = `demo-stu-${String(i + 1).padStart(2, '0')}`;
      insert(
        'student_semester_reports',
        [
          'id',
          'student_id',
          'class_id',
          'semester_name',
          'attendance_score',
          'progress_score',
          'assignment_score',
          'exam_score',
          'total_score',
          'grade_level',
          'teacher_evaluation',
          'ai_evaluation',
          'dimension_scores',
          'created_at',
          'updated_at',
          'academic_year',
        ],
        reportId,
        studentId,
        DEMO_IDS.primaryClass,
        '第一学期',
        95,
        90,
        88,
        84,
        89,
        'A',
        '演示评语：积极参与课堂互动。',
        'AI 建议：加强随堂测验的复核。',
        JSON.stringify({
          informationAwareness: 90,
          computationalThinking: 88,
          digitalInnovation: 85,
          socialResponsibility: 92,
        }),
        now,
        now,
        DEMO_ACADEMIC_YEAR,
      );
      mark('semester_report', reportId);
    }
  });

  tx();

  return getDemoDataStatus(db);
}

/** cleanup 时单个实体的删除策略。args 由 entity_id 按 `::` 拆分得到。 */
const CLEANUP_SQL: Record<EntityType, { sql: string; args?: number }[]> = {
  surface_attempt: [{ sql: 'DELETE FROM learning_surface_attempts WHERE id = ?' }],
  surface: [{ sql: 'DELETE FROM learning_surfaces WHERE id = ?' }],
  peer_review: [{ sql: 'DELETE FROM activity_peer_reviews WHERE id = ?' }],
  discussion: [{ sql: 'DELETE FROM lesson_discussions WHERE id = ?' }],
  activity_progress: [{ sql: 'DELETE FROM activity_progress WHERE activity_id = ? AND student_id = ?', args: 2 }],
  quiz_submission: [{ sql: 'DELETE FROM lesson_quiz_submissions WHERE id = ?' }],
  activity_run: [{ sql: 'DELETE FROM activity_runs WHERE id = ?' }],
  block: [{ sql: 'DELETE FROM lesson_activity_blocks WHERE id = ?' }],
  activity: [{ sql: 'DELETE FROM lesson_activities WHERE id = ?' }],
  assessment_answer: [{ sql: 'DELETE FROM assessment_answers WHERE attempt_id = ? AND item_id = ?', args: 2 }],
  assessment_attempt: [
    { sql: 'DELETE FROM assessment_answers WHERE attempt_id = ?' },
    { sql: 'DELETE FROM assessment_attempts WHERE id = ?' },
  ],
  assessment_item: [{ sql: 'DELETE FROM assessment_items WHERE id = ?' }],
  assessment_assignment: [{ sql: 'DELETE FROM assessment_assignments WHERE id = ?' }],
  assessment: [{ sql: 'DELETE FROM assessments WHERE id = ?' }],
  bank_item: [{ sql: 'DELETE FROM question_bank_items WHERE id = ?' }],
  exam_score: [{ sql: 'DELETE FROM exam_scores WHERE exam_id = ? AND student_id = ?', args: 2 }],
  exam: [{ sql: 'DELETE FROM exams WHERE id = ?' }],
  submission: [{ sql: 'DELETE FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?', args: 2 }],
  grade_history: [{ sql: 'DELETE FROM assignment_grade_history WHERE id = ?' }],
  assignment: [{ sql: 'DELETE FROM assignments WHERE id = ?' }],
  attendance: [{ sql: 'DELETE FROM attendance WHERE schedule_id = ? AND student_id = ?', args: 2 }],
  checkin: [{ sql: 'DELETE FROM lesson_checkins WHERE lesson_id = ? AND student_id = ?', args: 2 }],
  progress: [{ sql: 'DELETE FROM student_lesson_progress WHERE lesson_id = ? AND student_id = ?', args: 2 }],
  redemption: [{ sql: 'DELETE FROM reward_redemptions WHERE id = ?' }],
  reward: [{ sql: 'DELETE FROM reward_catalog WHERE id = ?' }],
  credit_award: [{ sql: 'DELETE FROM credit_awards WHERE id = ?' }],
  point_log: [{ sql: 'DELETE FROM student_point_logs WHERE id = ?' }],
  semester_report: [{ sql: 'DELETE FROM student_semester_reports WHERE id = ?' }],
  grade_weight: [{ sql: 'DELETE FROM class_grade_weights WHERE class_id = ?' }],
  score_config: [{ sql: 'DELETE FROM courseware_score_config WHERE courseware_id = ?' }],
  courseware: [{ sql: 'DELETE FROM courseware WHERE id = ?' }],
  whiteboard_element: [{ sql: 'DELETE FROM whiteboard_elements WHERE id = ?' }],
  course_enrollment: [{ sql: 'DELETE FROM course_enrollments WHERE course_id = ? AND student_id = ?', args: 2 }],
  course: [{ sql: 'DELETE FROM courses WHERE id = ?' }],
  lesson: [{ sql: 'DELETE FROM lessons WHERE id = ?' }],
  seat: [{ sql: 'DELETE FROM student_seats WHERE class_id = ? AND student_id = ?', args: 2 }],
  group: [{ sql: 'DELETE FROM class_groups WHERE id = ?' }],
  schedule: [{ sql: 'DELETE FROM schedules WHERE id = ?' }],
  class_student: [{ sql: 'DELETE FROM class_students WHERE class_id = ? AND student_id = ?', args: 2 }],
  student: [
    { sql: 'DELETE FROM student_rollcalls WHERE student_id = ?' },
    { sql: 'DELETE FROM students WHERE id = ?' },
  ],
  class: [{ sql: 'DELETE FROM classes WHERE id = ?' }],
  lab: [{ sql: 'DELETE FROM computer_labs WHERE id = ?' }],
  user: [{ sql: 'DELETE FROM users WHERE id = ?' }],
};

/**
 * 清理演示数据。
 *
 * 只删除 `demo_data_registry` 中登记的行，按 ALL_ENTITY_TYPES 顺序（依赖倒序）删除；
 * 删除完成后清空登记表。管理员账号在任何情况下都不会被删除。
 */
export function cleanupDemoData(db: Database.Database): CleanupReport {
  ensureRegistryTable(db);

  const removed = Object.fromEntries(ALL_ENTITY_TYPES.map((t) => [t, 0])) as Record<EntityType, number>;
  let skippedAdministrators = 0;

  const idsFor = db.prepare('SELECT entity_id FROM demo_data_registry WHERE entity_type = ?');
  const unregister = db.prepare('DELETE FROM demo_data_registry WHERE entity_type = ? AND entity_id = ?');

  const tx = db.transaction(() => {
    for (const type of ALL_ENTITY_TYPES) {
      for (const { entity_id } of idsFor.all(type) as { entity_id: string }[]) {
        // 管理员账号硬保护
        if (type === 'user') {
          const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(entity_id) as
            { id: string; role: string } | undefined;
          if (!row) {
            unregister.run(type, entity_id);
            continue;
          }
          if (row.role === 'administrator') {
            skippedAdministrators += 1;
            continue;
          }
        }

        const parts = entity_id.split('::');
        for (const { sql, args } of CLEANUP_SQL[type]) {
          try {
            removed[type] += db.prepare(sql).run(...(args === 2 ? [parts[0]!, parts[1]!] : [entity_id])).changes;
          } catch {
            /* 表不存在则跳过（老库升级场景） */
          }
        }
        unregister.run(type, entity_id);
      }
    }

    // 清理任何遗留登记（实体早已不存在的情况）
    db.prepare('DELETE FROM demo_data_registry').run();
  });

  tx();

  return {
    removed,
    skippedAdministrators,
    totalRemoved: Object.values(removed).reduce((a, b) => a + b, 0),
  };
}
