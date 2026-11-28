import { describe, expect, it, vi } from 'vitest';
import {
  WHITEBOARD_HOST_REQUIRED_KEYS,
  assertWhiteboardHostContract,
  buildLessonEditorWhiteboardHostProps,
  buildStudentWhiteboardHostProps,
  buildTeacherWhiteboardHostProps,
  findWhiteboardHostContractViolations,
  type WhiteboardHostKind,
  type WhiteboardHostProps,
} from '../whiteboard-host-contract';

const elements: WhiteboardHostProps['elements'] = [
  { id: 'el-1', type: 'quiz', data: JSON.stringify({ question: '1 + 1 = ?' }) },
];

const HOST_KINDS = Object.keys(WHITEBOARD_HOST_REQUIRED_KEYS) as WhiteboardHostKind[];

function buildTeacher(overrides: Partial<Parameters<typeof buildTeacherWhiteboardHostProps>[0]> = {}) {
  return buildTeacherWhiteboardHostProps({
    lessonId: 'l1',
    classId: 'c1',
    initialPage: 2,
    elements,
    onFullscreenSync: vi.fn(),
    activeSegmentId: 'seg-a',
    onSegmentSync: vi.fn(),
    classroomTools: [],
    onExecuteTool: vi.fn(),
    hidePageBar: true,
    onPagesStateChange: vi.fn(),
    onElementAdd: vi.fn(async () => {}),
    onElementUpdate: vi.fn(async () => {}),
    onElementDelete: vi.fn(async () => {}),
    onRefresh: vi.fn(),
    ...overrides,
  });
}

function buildStudent(overrides: Partial<Parameters<typeof buildStudentWhiteboardHostProps>[0]> = {}) {
  return buildStudentWhiteboardHostProps({
    lessonId: 'l1',
    classId: 'c1',
    studentId: 's1',
    studentName: 'Alice',
    elements,
    userRole: 'student',
    readOnly: true,
    activeSegmentId: 'seg-a',
    onSegmentSync: vi.fn(),
    onElementAdd: vi.fn(async () => {}),
    onElementUpdate: vi.fn(async () => {}),
    onElementDelete: vi.fn(async () => {}),
    onClearBoard: vi.fn(async () => {}),
    onRefresh: vi.fn(),
    ...overrides,
  });
}

function buildEditor(overrides: Partial<Parameters<typeof buildLessonEditorWhiteboardHostProps>[0]> = {}) {
  return buildLessonEditorWhiteboardHostProps({
    lessonId: 'l1',
    elements,
    userRole: 'teacher',
    readOnly: false,
    activeSegmentId: 'seg-a',
    hidePageBar: true,
    onPagesStateChange: vi.fn(),
    onSegmentSync: vi.fn(),
    onElementDragChange: vi.fn(),
    onElementDropCheck: vi.fn(),
    onElementAdd: vi.fn(async () => {}),
    onElementUpdate: vi.fn(async () => {}),
    onElementDelete: vi.fn(async () => {}),
    onClearBoard: vi.fn(async () => {}),
    onRefresh: vi.fn(),
    ...overrides,
  });
}

function omitKey(props: WhiteboardHostProps, key: keyof WhiteboardHostProps): WhiteboardHostProps {
  const copy = { ...props } as WhiteboardHostProps & Record<string, unknown>;
  delete copy[key];
  return copy;
}

describe('宿主契约的键清单', () => {
  it.each(HOST_KINDS)('%s 的必需键不重复', (kind) => {
    const keys = WHITEBOARD_HOST_REQUIRED_KEYS[kind];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('教师适配器输出与契约键集合完全一致', () => {
    const props = buildTeacher();
    expect(Object.keys(props).sort()).toEqual([...WHITEBOARD_HOST_REQUIRED_KEYS['teacher-classroom']].sort());
    expect(findWhiteboardHostContractViolations('teacher-classroom', props)).toEqual([]);
  });

  it('学生适配器输出与契约键集合完全一致', () => {
    const props = buildStudent();
    expect(Object.keys(props).sort()).toEqual([...WHITEBOARD_HOST_REQUIRED_KEYS['student-classroom']].sort());
    expect(findWhiteboardHostContractViolations('student-classroom', props)).toEqual([]);
  });

  it('备课适配器输出与契约键集合完全一致', () => {
    const props = buildEditor();
    expect(Object.keys(props).sort()).toEqual([...WHITEBOARD_HOST_REQUIRED_KEYS['lesson-editor']].sort());
    expect(findWhiteboardHostContractViolations('lesson-editor', props)).toEqual([]);
  });
});

describe('宿主适配器的语义契约', () => {
  it('教师课堂固定为授课态并广播全屏', () => {
    const props = buildTeacher();

    expect(props.userRole).toBe('teacher');
    expect(props.isEditMode).toBe(false);
    expect(props.broadcastFullscreen).toBe(true);
    expect(props.fullscreenBroadcastClassId).toBe('c1');
    expect(props.hidePageBar).toBe(true);
    expect(props.followRemoteFullscreen).toBeUndefined();
    expect(props).not.toHaveProperty('readOnly');
  });

  it('学生课堂固定跟随远程全屏，readOnly 与锁定状态同步', () => {
    const onElementDelete = vi.fn(async () => {});
    const onClearBoard = vi.fn(async () => {});
    const props = buildStudent({ readOnly: true, onElementDelete, onClearBoard });

    expect(props.userRole).toBe('student');
    expect(props.followRemoteFullscreen).toBe(true);
    expect(props.readOnly).toBe(true);
    expect(props.studentId).toBe('s1');
    expect(props.studentName).toBe('Alice');
    expect(props.classId).toBe('c1');
    expect(props.onElementDelete).toBe(onElementDelete);
    expect(props.onClearBoard).toBe(onClearBoard);
    expect(props).not.toHaveProperty('broadcastFullscreen');
  });

  it('学生课堂解锁后 readOnly 随入参变化，而不是写死', () => {
    expect(buildStudent({ readOnly: false }).readOnly).toBe(false);
    expect(buildStudent({ readOnly: true }).readOnly).toBe(true);
  });

  it('备课编辑器固定隐藏页面栏并注入拖放回调', () => {
    const onPagesStateChange = vi.fn();
    const onElementDragChange = vi.fn();
    const onElementDropCheck = vi.fn();
    const props = buildEditor({ onPagesStateChange, onElementDragChange, onElementDropCheck });

    expect(props.readOnly).toBe(false);
    expect(props.hidePageBar).toBe(true);
    expect(props.onPagesStateChange).toBe(onPagesStateChange);
    expect(props.onElementDragChange).toBe(onElementDragChange);
    expect(props.onElementDropCheck).toBe(onElementDropCheck);
    expect(props).not.toHaveProperty('followRemoteFullscreen');
  });

  it('缺省 lessonId / classId 归一化为稳定值', () => {
    expect(buildStudent({ lessonId: null, classId: null }).lessonId).toBe('');
    expect(buildStudent({ lessonId: null, classId: null }).classId).toBeNull();
    expect(buildEditor({ lessonId: null }).lessonId).toBe('');
  });
});

describe('契约校验能抓住漏传与语义漂移', () => {
  it.each(HOST_KINDS)('%s 缺必需键会被报告，且 assert 抛错', (kind) => {
    const props =
      kind === 'teacher-classroom' ? buildTeacher() : kind === 'student-classroom' ? buildStudent() : buildEditor();
    const key = WHITEBOARD_HOST_REQUIRED_KEYS[kind][0];
    const broken = omitKey(props, key);

    expect(findWhiteboardHostContractViolations(kind, broken)).toContain(`missing key: ${String(key)}`);
    expect(() => assertWhiteboardHostContract(kind, broken)).toThrow(new RegExp(String(key)));
  });

  it('教师端不广播 / 进入编辑态会被报告', () => {
    expect(
      findWhiteboardHostContractViolations('teacher-classroom', { ...buildTeacher(), broadcastFullscreen: false }),
    ).toContain('broadcastFullscreen must be true');
    expect(
      findWhiteboardHostContractViolations('teacher-classroom', { ...buildTeacher(), isEditMode: true }),
    ).toContain('isEditMode must be false');
  });

  it('学生端不跟随远程全屏会被报告', () => {
    expect(
      findWhiteboardHostContractViolations('student-classroom', { ...buildStudent(), followRemoteFullscreen: false }),
    ).toContain('followRemoteFullscreen must be true');
  });

  it('学生端 readOnly 不是布尔会被报告', () => {
    expect(
      findWhiteboardHostContractViolations('student-classroom', {
        ...buildStudent(),
        readOnly: undefined as unknown as boolean,
      }),
    ).toContain('readOnly must be a boolean');
  });

  it('备课端取消隐藏页面栏会被报告', () => {
    expect(findWhiteboardHostContractViolations('lesson-editor', { ...buildEditor(), hidePageBar: false })).toContain(
      'hidePageBar must be true in lesson editor',
    );
  });

  it('三个宿主的合法输出都不会让 assert 抛错', () => {
    expect(() => assertWhiteboardHostContract('teacher-classroom', buildTeacher())).not.toThrow();
    expect(() => assertWhiteboardHostContract('student-classroom', buildStudent())).not.toThrow();
    expect(() => assertWhiteboardHostContract('lesson-editor', buildEditor())).not.toThrow();
  });
});
