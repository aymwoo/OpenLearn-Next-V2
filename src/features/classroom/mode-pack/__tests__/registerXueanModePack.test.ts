import { afterEach, describe, expect, it } from 'vitest';
import { usePluginHostStore } from '../../../../plugin-host/plugin-host-store';
import { getAllSegmentTypes } from '../../../teacher/lesson-editor/timelineConfig';
import { registerXueanModePack, unregisterXueanModePack } from '../registerXueanModePack';
import { XUEAN_MODE_PACK, XUEAN_MODE_PACK_SEGMENT_TYPE } from '../xueanPack';

afterEach(() => {
  unregisterXueanModePack();
  usePluginHostStore.setState({ extensionPoints: new Map() });
});

describe('registerXueanModePack', () => {
  it('注册双端扩展点、primary 与 xuean 环节类型', () => {
    registerXueanModePack();
    const host = usePluginHostStore.getState();
    const teacher = host.getExtensions('classroom.active_segment.main');
    const student = host.getExtensions('classroom.active_segment.student_main');
    expect(teacher.some((e) => e.id === XUEAN_MODE_PACK.teacherWorkspaceId)).toBe(true);
    expect(student.some((e) => e.id === XUEAN_MODE_PACK.studentWorkspaceId)).toBe(true);
    const teacherExt = teacher.find((e) => e.id === XUEAN_MODE_PACK.teacherWorkspaceId)!;
    expect(teacherExt.targetType).toBe(XUEAN_MODE_PACK_SEGMENT_TYPE);
    expect(teacherExt.slotProps?.primary).toBe(true);
    expect(getAllSegmentTypes().some((t) => t.id === XUEAN_MODE_PACK_SEGMENT_TYPE)).toBe(true);
  });

  it('卸载后扩展点与环节类型消失', () => {
    registerXueanModePack();
    unregisterXueanModePack();
    const host = usePluginHostStore.getState();
    expect(
      host.getExtensions('classroom.active_segment.main').some((e) => e.id === XUEAN_MODE_PACK.teacherWorkspaceId),
    ).toBe(false);
    expect(getAllSegmentTypes().some((t) => t.id === XUEAN_MODE_PACK_SEGMENT_TYPE)).toBe(false);
  });
});
