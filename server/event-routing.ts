// server/event-routing.ts
//
// 内核事件 → Socket.IO 投递的**声明式路由表**。
//
// 取代此前 `realtime-bridge.ts` 里逐条手写 `eventBus.subscribe(...)` 的做法：
// 过去每加一种事件都要在 bridge 里再写一个订阅块，事件名在点号风格与短横线
// 风格之间被隐式改写（`whiteboard.element_drawn` → `whiteboard-sync`），且
// `eventId / correlationId / type` 在投递时全部丢失，前端无法串联同一条业务流。
//
// 现在：一条事件 = 表里一行声明。路由集中、可枚举、可单测。
// 投递时统一附加 `_meta`（事件 ID / 类型 / 来源 / 时间 / correlationId），
// 便于前端做去重、排序与「迟到学生补齐上下文」。

import type { Server } from 'socket.io';
import type { PlatformEvent } from '../packages/core/event-bus/index.js';
import {
  classRoom,
  classroomEventRooms,
  isRealLessonRoom,
  PRESENCE_STAFF_ROOM,
  userRoom,
  WHITEBOARD_BROADCAST_ROOM,
} from './presence.js';
import { loadLessonClassId } from './services/classroom-class-lock.js';

/**
 * 转发 `presence.ts` 的定义，避免房间名出现两份来源：
 * 事件路由表与 presence 的 socket 处理器必须投到同一批房间。
 */
export { WHITEBOARD_BROADCAST_ROOM };

/**
 * Minimal structural view of the kernel database the routes need.
 * Mirrors the `better-sqlite3` `prepare().get()/.run()` surface so routes can
 * be unit-tested with an in-memory mock.
 */
export interface RouteDb {
  prepare(sql: string): {
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => unknown;
  };
}

export interface SocketRouteDeps {
  io: Server;
  db: RouteDb;
}

/** 内核事件元信息，随 socket payload 的 `_meta` 字段下发。 */
export interface EventMeta {
  eventId: string;
  type: string;
  source: string;
  timestamp: number;
  correlationId?: string;
}

export interface SocketRoute<TPayload = any> {
  /** 内核事件类型（点号 + 过去式）。 */
  readonly eventType: string;
  /** 下发给前端的 Socket 事件名。缺省应与内核名一致（事件名守恒）。 */
  readonly socketEvent: string;
  /**
   * 目标房间。`null` 表示全局广播；返回空数组表示「只执行 effect，不投递」。
   * 需要按课节反查班级等数据库信息时，使用第二个参数 `deps`。
   */
  readonly rooms: (event: PlatformEvent<TPayload>, deps: SocketRouteDeps) => string[] | null;
  /** payload 转换。默认原样透传 `event.payload`。 */
  readonly map?: (event: PlatformEvent<TPayload>, deps: SocketRouteDeps) => unknown;
  /** 投递前执行的副作用（落库等）。 */
  readonly effect?: (event: PlatformEvent<TPayload>, deps: SocketRouteDeps) => void;
  /** 是否附加 `_meta`（默认 true）。关闭仅用于严格兼容旧前端契约的路由。 */
  readonly attachMeta?: boolean;
  /**
   * 教员专属镜像事件（Issue #238）：当主事件对学生房间下发**脱敏 payload**
   * 时，通过此字段把**全量 payload** 以独立事件名镜像到 PRESENCE_STAFF_ROOM。
   * 教师客户端监听镜像事件名，学生客户端只收主事件 —— 同班学生无法从
   * WebSocket 帧里读到正确答案与他人作答。
   */
  readonly staffMirror?: {
    /** 镜像事件名（如 `whiteboard-quiz-answered-staff`）。 */
    readonly socketEvent: string;
  };
  /** 人类可读说明，供审计与排障。 */
  readonly description: string;
}

const TITLE_SQL = 'SELECT title FROM assignments WHERE id = ?';
const ELEMENT_SQL = 'SELECT * FROM whiteboard_elements WHERE id = ?';
const ATTEMPT_STUDENT_SQL = 'SELECT student_id FROM courseware_attempt WHERE id = ?';
const ROLLCALL_EXISTS_SQL = 'SELECT id FROM student_rollcalls WHERE id = ?';
const ROLLCALL_INSERT_SQL =
  'INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time) VALUES (?, ?, ?, ?, ?)';

function lessonRoom(event: PlatformEvent<any>): string[] | null {
  const lessonId = event.payload?.lessonId;
  return typeof lessonId === 'string' && lessonId ? [lessonId] : [];
}

// 「真实课节」判定收敛在 presence.ts，课堂事件路由与之共用同一规则。

function lessonAndBroadcastRooms(event: PlatformEvent<any>): string[] | null {
  const rooms = lessonRoom(event);
  if (rooms === null || rooms.length === 0) return [];
  return rooms.some(isRealLessonRoom) ? [...rooms, WHITEBOARD_BROADCAST_ROOM] : rooms;
}

/** 课节当前班级：进行中会话优先，其次课表；伪课节不反查。 */
function lessonClassId(event: PlatformEvent<any>, deps: SocketRouteDeps): string | null {
  const lessonId = event.payload?.lessonId;
  if (typeof lessonId !== 'string' || !lessonId || !isRealLessonRoom(lessonId)) return null;
  return loadLessonClassId(deps.db, lessonId);
}

/**
 * 课堂语义事件的默认投递面：课节房间 + 班级房间。
 *
 * 班级房间是必要的兜底：学生停在仪表盘 / 作业工作区时不在课节房间，
 * 只投课节房间会让「抽中、答题、进度」这类课堂状态静默丢失。
 */
function lessonAndClassRooms(event: PlatformEvent<any>, deps: SocketRouteDeps): string[] {
  const payload = event.payload as any;
  return classroomEventRooms(payload?.lessonId ?? null, {
    classId: lessonClassId(event, deps),
    userIds: payload?.studentId ? [payload.studentId] : [],
  });
}

function refreshMessage(event: PlatformEvent<any>) {
  return { roomId: event.payload?.lessonId, type: 'refresh' as const };
}

/**
 * 白板元素更新的广播策略。
 *
 * 背景：`whiteboard.element_updated` 曾经是纯 effect-only 路由（`rooms: () => []`），
 * 因为它承载的主要是拖拽/缩放这类高频几何更新，广播会让全班反复全量重拉。
 * 但同一事件也承载**语义型内容更新**（改题面、改代码、翻幻灯片、抽中学生），
 * 这些必须让学生看到 —— 缺了就会复现「教师端已改、学生端卡在旧状态」。
 *
 * 判定准则（不看「是否持久化」，看「学生是否必须看到」）：
 *   ① 改变了学生要读的内容（题面、代码、幻灯片、点名结果）
 *   ② 改变了课堂进行中的状态（抽中、公布答案、绑定作业）
 *   ③ 改变了学生下一步能做什么（组件出现/消失）
 *
 * 这里的实现是**按元素类型的声明式策略**，而不是逐组件在路由 `effect` 里开洞：
 * - 落在 `LAYOUT_ONLY_ELEMENT_TYPES` 里的类型：纯几何/视图，不广播
 * - 其余（含未登记的新类型）：广播 —— **fail-safe 方向**。
 *   未登记类型最多导致一次多余的刷新；反过来若默认不广播，
 *   新加的语义型组件会静默不同步，那正是本次要根治的病。
 *
 * 为什么放在服务端而不是前端：元素 `type` 本来就在 `whiteboard_elements` 行里，
 * 且两条持久化路径（`LiveClassroomView` 直接 PUT、`LessonEditorView` 走 800ms
 * 防抖 autosave）最终都汇聚到 `whiteboard.update` 命令 —— 放这里一次覆盖两条，
 * 无需在前端写两遍判定逻辑。
 */
const LAYOUT_ONLY_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  // 静态图元：位置/尺寸/笔迹
  'text',
  'rectangle',
  'rect',
  'circle',
  'shape',
  'pen',
  'highlighter',
  // 页面元数据已有专用事件（`page-meta-update` / `page-change`），
  // 走白板通用刷新反而重复
  'page_meta',
]);

/** 点名后刷新课节房间 + 广播房间的学生端白板。 */
function broadcastWhiteboardRefresh(event: PlatformEvent<any>, deps: SocketRouteDeps): void {
  const rooms = lessonAndBroadcastRooms(event) ?? [];
  if (rooms.length === 0) return;
  const refresh = attachMeta(refreshMessage(event), event);
  deps.io.to(rooms).emit('whiteboard-sync', refresh);
}

/**
 * 点名抽中落库 + 广播 `student-picked`。
 *
 * 幂等：同一 `rollcallId` 只落库、只广播一次（`pickedTime` 参与 id 计算，
 * 因此重复抽中不同学生会得到不同的 id，而拖拽等无谓更新不会产生新记录）。
 *
 * @returns 本次是否**新抽中**了一名学生。调用方据此决定要不要额外广播白板刷新：
 *   `element_drawn` 路由的 `rooms` 已经广播过 refresh，无需重复；
 *   `element_updated` 是 effect-only，才需要在这里补。
 */
function persistRollcallPick(el: any, elementId: string, deps: SocketRouteDeps): boolean {
  try {
    if (!el || el.type !== 'rollcall') return false;

    const elData = JSON.parse(el.data);
    if (!elData?.selectedStudent || elData.status !== 'picked') return false;

    const studentId = elData.selectedStudent.id;
    const studentName = elData.selectedStudent.name;
    const lessonId = el.lesson_id;
    const classId: string = elData.classId || (lessonId ? loadLessonClassId(deps.db, lessonId) : null) || '';

    const pickedTimeStr = elData.pickedTime || new Date().toISOString();
    const pickedTime = new Date(pickedTimeStr).getTime();
    const rollcallId = `rollcall-${elementId}-${pickedTime}`;

    const exists = deps.db.prepare(ROLLCALL_EXISTS_SQL).get(rollcallId);
    if (exists) return false;

    deps.db.prepare(ROLLCALL_INSERT_SQL).run(rollcallId, studentId, classId, lessonId, pickedTime);
    console.log(`[Rollcall] Saved rollcall for student ${studentId} (${studentName})`);
    // 与 presence.ts 手动抽问同口径：课节 + 班级 + 被点名学生，不再全局广播
    const rooms = classroomEventRooms(lessonId, { classId, userIds: [studentId] });
    if (rooms.length > 0) {
      deps.io.to(rooms).emit('student-picked', {
        rollcallId,
        studentId,
        studentName,
        classId,
        lessonId,
        pickedTime,
      });
    }

    return true;
  } catch (e) {
    console.error('Error handling rollcall element:', e);
    return false;
  }
}

/**
 * `whiteboard.element_updated` 的统一处理：按元素类型决定是否广播刷新。
 *
 * 两条持久化路径都会走到这里，因此这是「语义型更新必须同步、学生端实时跟上」
 * 唯一且不漏的收敛点。
 */
function handleElementUpdatedEffect(event: PlatformEvent<any>, deps: SocketRouteDeps): void {
  const elementId = (event.payload as any)?.elementId;
  if (typeof elementId !== 'string' || !elementId) return;

  let el: any;
  try {
    el = deps.db.prepare(ELEMENT_SQL).get(elementId);
  } catch (e) {
    console.error('[event-routing] failed to load whiteboard element:', e);
    return;
  }
  // 元素查不到（已删除等）：无内容可同步，也不必刷新
  if (!el) return;

  // 点名：只在**真正抽中新学生**时补一次刷新，拖拽等无谓更新不触发
  if (el.type === 'rollcall') {
    if (persistRollcallPick(el, elementId, deps)) {
      broadcastWhiteboardRefresh(event, deps);
    }
    return;
  }

  if (LAYOUT_ONLY_ELEMENT_TYPES.has(el.type)) return;

  broadcastWhiteboardRefresh(event, deps);
}

export const SOCKET_ROUTES: readonly SocketRoute[] = [
  // ── 作业批改 ────────────────────────────────────────────────────────────
  {
    eventType: 'assignment.graded',
    socketEvent: 'assignment-graded-toast',
    // 个人通知：只投被评分学生的用户房间，避免全班/全校收到他人成绩
    rooms: (event) => {
      const studentId = (event.payload as any)?.studentId;
      return typeof studentId === 'string' && studentId ? [userRoom(studentId)] : [];
    },
    map: (event, deps) => {
      const payload = event.payload as any;
      const assignment = deps.db.prepare(TITLE_SQL).get(payload.assignmentId) as any;
      return {
        assignmentId: payload.assignmentId,
        assignmentTitle: assignment ? assignment.title : 'Assignment',
        studentId: payload.studentId,
        score: payload.score,
        feedback: payload.feedback || '',
      };
    },
    description: '作业批改完成 → 全局 Toast（含作业标题）',
  },

  // ── 白板协同 ────────────────────────────────────────────────────────────
  // 注意：`whiteboard-sync` 是历史遗留的 socket 事件名（前端仍在监听），
  // 因此这里显式声明而非沿用内核事件名。待前端迁移到 `whiteboard.element_drawn`
  // 后可改为事件名守恒。
  {
    eventType: 'whiteboard.element_drawn',
    socketEvent: 'whiteboard-sync',
    rooms: lessonAndBroadcastRooms,
    map: refreshMessage,
    effect: (event, deps) => {
      if ((event.payload as any)?.type === 'rollcall') {
        // element_drawn 自身的 rooms 已经广播 refresh，此处只负责落库 + student-picked
        const elementId = (event.payload as any).elementId;
        if (typeof elementId !== 'string' || !elementId) return;
        persistRollcallPick(deps.db.prepare(ELEMENT_SQL).get(elementId) as any, elementId, deps);
      }
    },
    description: '白板元素新增 → 课节房间 + 广播房间刷新（点名元素另落库）',
  },
  {
    eventType: 'whiteboard.element_updated',
    socketEvent: 'whiteboard-sync',
    // 投递由 effect 按元素类型决定：布局型静默，语义型广播刷新。
    // 这里保持 rooms: [] 避免 effect 与投递重复发送。
    rooms: () => [],
    effect: handleElementUpdatedEffect,
    description: '白板元素更新 → 布局型静默；语义型（题面/代码/幻灯片/点名等）广播课节+广播房间刷新',
  },
  {
    eventType: 'whiteboard.batch_drawn',
    socketEvent: 'whiteboard-sync',
    rooms: lessonAndBroadcastRooms,
    map: refreshMessage,
    description: '白板批量绘制 → 课节房间 + 广播房间刷新',
  },
  {
    eventType: 'whiteboard.element_deleted',
    socketEvent: 'whiteboard-sync',
    rooms: lessonAndBroadcastRooms,
    map: refreshMessage,
    description: '白板元素删除 → 课节房间 + 广播房间刷新',
  },
  {
    eventType: 'whiteboard.cleared',
    socketEvent: 'whiteboard-sync',
    rooms: lessonAndBroadcastRooms,
    map: refreshMessage,
    description: '白板清空 → 课节房间 + 广播房间刷新',
  },
  {
    eventType: 'whiteboard.quiz_answered',
    socketEvent: 'whiteboard-quiz-answered',
    rooms: lessonAndClassRooms,
    // Issue #238：学生房间脱敏 —— 剥离作答内容/正确答案/正确选项索引。
    // 保留 studentId/studentName/score/isCorrect 供同班答题进度展示。
    map: (event) => {
      const p = { ...(event.payload as Record<string, unknown>) };
      delete p.answer;
      delete p.correctAnswer;
      delete p.correctIndex;
      return p;
    },
    staffMirror: { socketEvent: 'whiteboard-quiz-answered-staff' },
    description:
      '随堂练习作答 → 课节 + 班级房间（学生房间脱敏版）；教师全量版镜像至 presence-staff（Issue #238）',
  },

  // ── 作业中心（assignment-eval 插件）────────────────────────────────────
  {
    eventType: 'assignment.submitted',
    socketEvent: 'assignment-submitted-toast',
    rooms: (event) => {
      const p = event.payload as any;
      const rooms: string[] = [];
      if (typeof p?.lessonId === 'string' && p.lessonId) rooms.push(p.lessonId);
      if (typeof p?.classId === 'string' && p.classId) rooms.push(classRoom(p.classId));
      return rooms.length > 0 ? rooms : null;
    },
    map: (event) => ({
      assignmentId: (event.payload as any).assignmentId,
      studentId: (event.payload as any).studentId,
      version: (event.payload as any).version,
      isLate: (event.payload as any).isLate,
    }),
    description: '学生提交作业 → 课节/班级房间通知（教师评分面板免刷新）',
  },

  // ── 题库与随堂测验插件（@openlearn/plugin-exam-bank）───────────────────
  //
  // ⚠️ 这三条路由是**平台为外部插件预留的契约**，不是悬空代码：
  //
  //  - 考试银行插件**不在本仓**（`v2_plugins/` 下只有 courseware-hub /
  //    ext-homework-hub / openlearn-workhub / scratch-editor-deploy），
  //    所以本仓既没有它的 `eventBus.publish`（producer），也没有它的前端
  //    `socket.on`（consumer）—— 机械核对事件名时必然显示「两端皆无」。
  //  - **请勿删除**：删了之后插件一旦装上就会静默失效，而「代码看起来接好了、
  //    实际什么都不发生」正是本次审计反复撞上的失败模式。
  //  - 消费端在插件自己的前端代码里；该方向后续还会继续扩展功能。
  //
  // 与上面被删除的 `spotlight:*` 性质不同：spotlight 是「曾经有过、现在两端都空了」，
  // exambank 是「插件还没进这个仓」。空路由 vs 前置契约，处置相反。
  {
    eventType: 'exambank.survey.published',
    socketEvent: 'exambank-survey-state',
    rooms: (event) => {
      const classId = (event.payload as any)?.classId;
      return typeof classId === 'string' && classId ? [classRoom(classId)] : [];
    },
    map: (event) => ({
      action: 'published' as const,
      surveyId: (event.payload as any).surveyId,
      title: (event.payload as any).title,
      mode: (event.payload as any).mode,
      identity_mode: (event.payload as any).identity_mode,
      config: (event.payload as any).config,
      questions: (event.payload as any).questions,
    }),
    description: '问卷/测验发布 → 班级房间推送（学生端自动弹出答题界面）',
  },
  {
    eventType: 'exambank.survey.closed',
    socketEvent: 'exambank-survey-state',
    rooms: (event) => {
      const classId = (event.payload as any)?.classId;
      return typeof classId === 'string' && classId ? [classRoom(classId)] : [];
    },
    map: (event) => ({
      action: 'closed' as const,
      surveyId: (event.payload as any).surveyId,
    }),
    description: '问卷/测验关闭 → 班级房间推送（学生端答题界面收起）',
  },
  {
    eventType: 'exambank.answer.submitted',
    socketEvent: 'exambank-stats-update',
    rooms: (event) => {
      const classId = (event.payload as any)?.classId;
      return typeof classId === 'string' && classId ? [classRoom(classId)] : [];
    },
    map: (event) => ({
      surveyId: (event.payload as any).surveyId,
      surveyTitle: (event.payload as any).surveyTitle,
      submissionCount: (event.payload as any).submissionCount,
    }),
    description: '作答提交 → 班级房间实时统计计数（教师投屏面板增量刷新）',
  },

  // ── 课堂状态 ────────────────────────────────────────────────────────────
  {
    eventType: 'classroom.lock_changed',
    socketEvent: 'class-lock-status-changed',
    // 锁屏是班级级指令：班级房间覆盖已离开课节视图的学生，课节房间覆盖试听端
    rooms: (event) => {
      const payload = event.payload as any;
      const rooms = new Set<string>();
      if (typeof payload?.lessonId === 'string' && payload.lessonId) rooms.add(payload.lessonId);
      if (typeof payload?.classId === 'string' && payload.classId) rooms.add(classRoom(payload.classId));
      return [...rooms];
    },
    description: '全班锁屏/解锁 → 班级 + 课节房间',
  },
  {
    eventType: 'student.notification_acknowledged',
    socketEvent: 'student-acknowledged',
    // 已读回执由教师端监控消费；投本人 + 教师房间，不再通知全校
    rooms: (event) => {
      const studentId = (event.payload as any)?.studentId;
      return studentId ? [userRoom(String(studentId)), PRESENCE_STAFF_ROOM] : [PRESENCE_STAFF_ROOM];
    },
    description: '学生已读通知 → 本人 + 教师房间',
  },
  {
    eventType: 'student.progress_updated',
    socketEvent: 'student-progress-updated',
    rooms: lessonAndClassRooms,
    description: '学生课节进度变化 → 课节 + 班级房间（学生本人 + 教师监控）',
  },
  {
    eventType: 'courseware.attempt_updated',
    socketEvent: 'courseware-attempt-updated',
    // attempt 表没有 lesson_id，无法按课节定向；投 attempt 归属学生 + 教师房间，
    // 既让本人课件刷新，也让教师大屏/评分面板收到失效通知（客户端仍回拉详情）。
    rooms: (event, deps) => {
      const attemptId = (event.payload as any)?.attemptId;
      if (typeof attemptId !== 'string' || !attemptId) return [PRESENCE_STAFF_ROOM];
      try {
        const row = deps.db.prepare(ATTEMPT_STUDENT_SQL).get(attemptId) as { student_id?: string } | undefined;
        const studentId = row?.student_id;
        if (studentId && studentId !== 'guest') return [userRoom(studentId), PRESENCE_STAFF_ROOM];
      } catch {
        // 查不到归属时只投教师房间（客户端仍可回拉）
      }
      return [PRESENCE_STAFF_ROOM];
    },
    description: '课件 attempt 日志/提交/认领 → 归属学生 + 教师房间（仅失效通知，客户端需回拉）',
  },
  {
    eventType: 'lesson.progress_mode_changed',
    socketEvent: 'lesson-progress-mode-changed',
    rooms: lessonAndClassRooms,
    description: '课节进度模式切换 → 课节 + 班级房间',
  },
  {
    eventType: 'segment.gate_overridden',
    socketEvent: 'segment-gate-changed',
    rooms: lessonRoom,
    description: '教师放行学生环节 → 课节房间，学生端重新核对进入条件',
  },
  {
    eventType: 'segment.gate_override_revoked',
    socketEvent: 'segment-gate-changed',
    rooms: lessonRoom,
    description: '教师撤销环节放行 → 课节房间，学生端重新核对进入条件',
  },
  {
    eventType: 'points.awarded',
    socketEvent: 'classroom:points_awarded',
    // 积分是账户级事实、不隶属某一课节：只投获得者本人与教师房间。
    // 此前全局广播把「谁加了多少分」推给全校，学生端只能靠 payload.studentId 自行过滤。
    rooms: (event) => {
      const studentId = (event.payload as any)?.studentId;
      return studentId ? [userRoom(String(studentId)), PRESENCE_STAFF_ROOM] : [PRESENCE_STAFF_ROOM];
    },
    description: '积分/金币变更 → 获得者本人 + 教师房间',
  },

  // ── 关于被删除的 spotlight 路由 ──────────────────────────────────────────
  // 原先这里有两条 `spotlight:state_updated`（冒号）/ `spotlight.state_updated`
  // （点号）双拼写路由，注释说是「历史遗留，先双轨保持兼容」。
  //
  // 走查结论：**既无 producer 也无 consumer** —— 全仓（含插件目录）没有任何
  // 一处 publish 这两个事件，也没有任何一处 socket.on 它们的 socket 名。
  // 「双轨兼容」保护的是一个不存在的两端，代价是让后来者以为聚焦功能已经打通。
  // 故删除。若将来真的要做聚焦，需要连同内核事件与前端消费端一起加，
  // 而不是留一条空路由占位。
];

function buildMeta(event: PlatformEvent): EventMeta {
  const meta: EventMeta = {
    eventId: event.id,
    type: event.type,
    source: event.source,
    timestamp: event.timestamp,
  };
  if (event.correlationId) meta.correlationId = event.correlationId;
  return meta;
}

/**
 * 附加 `_meta`。仅对「普通对象」payload 生效——基本类型与数组没有空间挂字段，
 * 强行包装会破坏既有前端契约，因此直接原样透传。
 */
function attachMeta(payload: unknown, event: PlatformEvent): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  return { ...(payload as Record<string, unknown>), _meta: buildMeta(event) };
}

/**
 * 创建一个「内核事件 → Socket」派发器。同一事件类型重复注册会直接抛错，
 * 避免两张路由表互相覆盖却无人察觉。
 */
export function createRouteDispatcher(routes: readonly SocketRoute[], deps: SocketRouteDeps) {
  const byType = new Map<string, SocketRoute>();
  for (const route of routes) {
    if (byType.has(route.eventType)) {
      throw new Error(`[event-routing] duplicate socket route for event type "${route.eventType}"`);
    }
    byType.set(route.eventType, route);
  }

  return function dispatch(event: PlatformEvent): void {
    const route = byType.get(event.type);
    if (!route) return;

    try {
      route.effect?.(event, deps);

      const mapped = route.map ? route.map(event, deps) : event.payload;
      const payload = route.attachMeta === false ? mapped : attachMeta(mapped, event);

      const rooms = route.rooms(event, deps);
      if (rooms === null) {
        deps.io.emit(route.socketEvent, payload);
        return;
      }
      const targets = rooms.filter(Boolean);
      if (targets.length === 0) return;
      // 并集投递：客户端同时命中课节/班级/用户房间时只收一次，避免重复弹窗
      deps.io.to(targets).emit(route.socketEvent, payload);
      // 教员专属镜像（Issue #238）：镜像投递**原始** event.payload（未经 map 脱敏），
      // 只进 PRESENCE_STAFF_ROOM；学生房间收到的才是 map 层脱敏后的版本
      if (route.staffMirror) {
        const staffPayload = route.attachMeta === false ? event.payload : attachMeta(event.payload, event);
        deps.io.to(PRESENCE_STAFF_ROOM).emit(route.staffMirror.socketEvent, staffPayload);
      }
    } catch (e) {
      console.error(`[event-routing] Error dispatching "${event.type}" to "${route.socketEvent}":`, e);
    }
  };
}
