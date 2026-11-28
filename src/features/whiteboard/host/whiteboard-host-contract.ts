/**
 * 白板宿主适配器契约。
 *
 * 每个挂载白板的宿主（教师课堂、学生课堂、备课编辑器）都必须通过
 * `build*WhiteboardHostProps` 组装 props，并在测试里用
 * `assertWhiteboardHostContract` 校验。
 *
 * 目的：宿主漏传 `readOnly` / `followRemoteFullscreen` / `onClearBoard`
 * 这类接线回归，TypeScript 看不到（原 LazyWhiteboard 是 any），
 * 叶子组件的单元测试也看不到。现在缺一个键就是编译错误或契约测试失败。
 */
import type { InteractiveWhiteboardProps } from '../InteractiveWhiteboard';

export type WhiteboardHostProps = InteractiveWhiteboardProps;

export type WhiteboardHostKind = 'teacher-classroom' | 'student-classroom' | 'lesson-editor';

type Elements = InteractiveWhiteboardProps['elements'];

/**
 * 每种宿主必须提供的键。
 *
 * 顺序无关；测试会按集合比较，缺键或多余键都会红。
 */
export const WHITEBOARD_HOST_REQUIRED_KEYS: Record<WhiteboardHostKind, readonly (keyof WhiteboardHostProps)[]> = {
  'teacher-classroom': [
    'lessonId',
    'elements',
    'userRole',
    'classId',
    'initialPage',
    'isEditMode',
    'broadcastFullscreen',
    'fullscreenBroadcastClassId',
    'onFullscreenSync',
    'activeSegmentId',
    'onSegmentSync',
    'classroomTools',
    'onExecuteTool',
    'hidePageBar',
    'onPagesStateChange',
    'onElementAdd',
    'onElementUpdate',
    'onElementDelete',
    'onRefresh',
  ],
  'student-classroom': [
    'lessonId',
    'elements',
    'classId',
    'studentId',
    'studentName',
    'userRole',
    'readOnly',
    'followRemoteFullscreen',
    'activeSegmentId',
    'onSegmentSync',
    'onElementAdd',
    'onElementUpdate',
    'onElementDelete',
    'onClearBoard',
    'onRefresh',
  ],
  'lesson-editor': [
    'lessonId',
    'elements',
    'userRole',
    'readOnly',
    'activeSegmentId',
    'hidePageBar',
    'onPagesStateChange',
    'onSegmentSync',
    'onElementDragChange',
    'onElementDropCheck',
    'onElementAdd',
    'onElementUpdate',
    'onElementDelete',
    'onClearBoard',
    'onRefresh',
  ],
};

/**
 * 返回契约违规列表（空数组表示通过）。
 *
 * 只检查「该宿主必须负责的东西」：必需键是否在对象上、关键语义是否成立。
 * 键存在但值为 undefined 不算缺失 —— 例如 `studentId: null` / `initialPage: undefined`
 * 是合法状态；真正漏传是键根本不出现。
 */
export function findWhiteboardHostContractViolations(kind: WhiteboardHostKind, props: WhiteboardHostProps): string[] {
  const violations: string[] = [];

  for (const key of WHITEBOARD_HOST_REQUIRED_KEYS[kind]) {
    if (!(key in props)) {
      violations.push(`missing key: ${String(key)}`);
    }
  }

  switch (kind) {
    case 'teacher-classroom':
      if (props.userRole !== 'teacher') violations.push(`userRole must be "teacher", got ${String(props.userRole)}`);
      if (props.broadcastFullscreen !== true) violations.push('broadcastFullscreen must be true');
      if (props.isEditMode !== false) violations.push('isEditMode must be false');
      if (props.followRemoteFullscreen) violations.push('teacher must not follow remote fullscreen');
      break;
    case 'student-classroom':
      if (props.followRemoteFullscreen !== true) violations.push('followRemoteFullscreen must be true');
      if (typeof props.readOnly !== 'boolean') violations.push('readOnly must be a boolean');
      break;
    case 'lesson-editor':
      if (typeof props.readOnly !== 'boolean') violations.push('readOnly must be a boolean');
      if (props.hidePageBar !== true) violations.push('hidePageBar must be true in lesson editor');
      break;
  }

  return violations;
}

export function assertWhiteboardHostContract(kind: WhiteboardHostKind, props: WhiteboardHostProps): void {
  const violations = findWhiteboardHostContractViolations(kind, props);
  if (violations.length > 0) {
    throw new Error(`[whiteboard-host] ${kind} contract violated: ${violations.join('; ')}`);
  }
}

// ── 教师课堂 ──────────────────────────────────────────────────────────────

export interface TeacherWhiteboardHostInput {
  lessonId: string | null;
  elements: Elements;
  classId?: string | null;
  initialPage?: number;
  onFullscreenSync?: InteractiveWhiteboardProps['onFullscreenSync'];
  activeSegmentId?: string | null;
  onSegmentSync?: InteractiveWhiteboardProps['onSegmentSync'];
  classroomTools?: InteractiveWhiteboardProps['classroomTools'];
  onExecuteTool?: InteractiveWhiteboardProps['onExecuteTool'];
  hidePageBar?: boolean;
  onPagesStateChange?: InteractiveWhiteboardProps['onPagesStateChange'];
  onElementAdd: InteractiveWhiteboardProps['onElementAdd'];
  onElementUpdate?: InteractiveWhiteboardProps['onElementUpdate'];
  onElementDelete?: InteractiveWhiteboardProps['onElementDelete'];
  onRefresh?: InteractiveWhiteboardProps['onRefresh'];
}

export function buildTeacherWhiteboardHostProps(input: TeacherWhiteboardHostInput): WhiteboardHostProps {
  return {
    lessonId: input.lessonId ?? '',
    elements: input.elements,
    userRole: 'teacher',
    classId: input.classId ?? null,
    initialPage: input.initialPage,
    isEditMode: false,
    broadcastFullscreen: true,
    fullscreenBroadcastClassId: input.classId ?? null,
    onFullscreenSync: input.onFullscreenSync,
    activeSegmentId: input.activeSegmentId,
    onSegmentSync: input.onSegmentSync,
    classroomTools: input.classroomTools,
    onExecuteTool: input.onExecuteTool,
    hidePageBar: input.hidePageBar ?? true,
    onPagesStateChange: input.onPagesStateChange,
    onElementAdd: input.onElementAdd,
    onElementUpdate: input.onElementUpdate,
    onElementDelete: input.onElementDelete,
    onRefresh: input.onRefresh,
  };
}

// ── 学生课堂 ──────────────────────────────────────────────────────────────

export interface StudentWhiteboardHostInput {
  lessonId: string | null;
  elements: Elements;
  classId?: string | null;
  studentId?: string | null;
  studentName?: string | null;
  userRole?: 'teacher' | 'student';
  readOnly: boolean;
  activeSegmentId?: string | null;
  onSegmentSync?: InteractiveWhiteboardProps['onSegmentSync'];
  onElementAdd: InteractiveWhiteboardProps['onElementAdd'];
  onElementUpdate?: InteractiveWhiteboardProps['onElementUpdate'];
  onElementDelete?: InteractiveWhiteboardProps['onElementDelete'];
  onClearBoard?: InteractiveWhiteboardProps['onClearBoard'];
  onRefresh?: InteractiveWhiteboardProps['onRefresh'];
}

export function buildStudentWhiteboardHostProps(input: StudentWhiteboardHostInput): WhiteboardHostProps {
  return {
    lessonId: input.lessonId ?? '',
    elements: input.elements,
    classId: input.classId ?? null,
    studentId: input.studentId ?? null,
    studentName: input.studentName ?? null,
    userRole: input.userRole ?? 'student',
    readOnly: input.readOnly,
    followRemoteFullscreen: true,
    activeSegmentId: input.activeSegmentId,
    onSegmentSync: input.onSegmentSync,
    onElementAdd: input.onElementAdd,
    onElementUpdate: input.onElementUpdate,
    onElementDelete: input.onElementDelete,
    onClearBoard: input.onClearBoard,
    onRefresh: input.onRefresh,
  };
}

// ── 备课编辑器 ────────────────────────────────────────────────────────────

export interface LessonEditorWhiteboardHostInput {
  lessonId: string | null;
  elements: Elements;
  userRole?: 'teacher' | 'student';
  readOnly: boolean;
  activeSegmentId?: string | null;
  hidePageBar?: boolean;
  onPagesStateChange?: InteractiveWhiteboardProps['onPagesStateChange'];
  onSegmentSync?: InteractiveWhiteboardProps['onSegmentSync'];
  onElementDragChange?: InteractiveWhiteboardProps['onElementDragChange'];
  onElementDropCheck?: InteractiveWhiteboardProps['onElementDropCheck'];
  onElementAdd: InteractiveWhiteboardProps['onElementAdd'];
  onElementUpdate?: InteractiveWhiteboardProps['onElementUpdate'];
  onElementDelete?: InteractiveWhiteboardProps['onElementDelete'];
  onClearBoard?: InteractiveWhiteboardProps['onClearBoard'];
  onRefresh?: InteractiveWhiteboardProps['onRefresh'];
}

export function buildLessonEditorWhiteboardHostProps(input: LessonEditorWhiteboardHostInput): WhiteboardHostProps {
  return {
    lessonId: input.lessonId ?? '',
    elements: input.elements,
    userRole: input.userRole ?? 'teacher',
    readOnly: input.readOnly,
    activeSegmentId: input.activeSegmentId,
    hidePageBar: input.hidePageBar ?? true,
    onPagesStateChange: input.onPagesStateChange,
    onSegmentSync: input.onSegmentSync,
    onElementDragChange: input.onElementDragChange,
    onElementDropCheck: input.onElementDropCheck,
    onElementAdd: input.onElementAdd,
    onElementUpdate: input.onElementUpdate,
    onElementDelete: input.onElementDelete,
    onClearBoard: input.onClearBoard,
    onRefresh: input.onRefresh,
  };
}
