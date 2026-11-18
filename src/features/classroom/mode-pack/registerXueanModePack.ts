/**
 * 将学案 Mode Pack 注册到前端扩展点与 timeline 环节类型（仅 Mode Pack flag 开启时由宿主调用）。
 */
import { BookOpen, ClipboardList, GraduationCap, Search } from 'lucide-react';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import {
  registerCustomSegmentType,
  unregisterCustomSegmentType,
  unregisterPluginSegmentTypes,
} from '../../teacher/lesson-editor/timelineConfig';
import { XueanStudentModeWorkspace, XueanTeacherModeWorkspace } from './XueanModeWorkspace';
import { XUEAN_MODE_PACK, XUEAN_MODE_PACK_SEGMENT_TYPE } from './xueanPack';

const PLUGIN_ID = XUEAN_MODE_PACK.id;

/** 精确子类型（仍由包声明的 `xuean` 前缀覆盖） */
export const XUEAN_SEGMENT_SUBTYPES = [
  { id: 'xuean:preview', labelZh: '学案导读', labelEn: 'Xuean Preview', icon: Search },
  { id: 'xuean:study', labelZh: '学案自学', labelEn: 'Xuean Study', icon: BookOpen },
  { id: 'xuean:drill', labelZh: '学案练习', labelEn: 'Xuean Drill', icon: ClipboardList },
] as const;

export function registerXueanModePack(): void {
  const host = usePluginHostStore.getState();
  const teacherId = XUEAN_MODE_PACK.teacherWorkspaceId!;
  const studentId = XUEAN_MODE_PACK.studentWorkspaceId!;

  registerCustomSegmentType(
    {
      id: XUEAN_MODE_PACK_SEGMENT_TYPE,
      labelZh: '学案学习',
      labelEn: 'Guided Study',
      icon: GraduationCap,
      pluginId: PLUGIN_ID,
    },
    PLUGIN_ID,
  );

  for (const sub of XUEAN_SEGMENT_SUBTYPES) {
    registerCustomSegmentType(
      {
        id: sub.id,
        labelZh: sub.labelZh,
        labelEn: sub.labelEn,
        icon: sub.icon,
        pluginId: PLUGIN_ID,
      },
      PLUGIN_ID,
    );
  }

  host.registerExtensionPoint('classroom.active_segment.main', {
    id: teacherId,
    label: XUEAN_MODE_PACK.label,
    pluginId: PLUGIN_ID,
    targetType: XUEAN_MODE_PACK_SEGMENT_TYPE,
    component: XueanTeacherModeWorkspace,
    slotProps: { primary: true, targetType: XUEAN_MODE_PACK_SEGMENT_TYPE },
  });

  host.registerExtensionPoint('classroom.active_segment.student_main', {
    id: studentId,
    label: XUEAN_MODE_PACK.label,
    pluginId: PLUGIN_ID,
    targetType: XUEAN_MODE_PACK_SEGMENT_TYPE,
    component: XueanStudentModeWorkspace,
    slotProps: { primary: true, targetType: XUEAN_MODE_PACK_SEGMENT_TYPE },
  });
}

export function unregisterXueanModePack(): void {
  const host = usePluginHostStore.getState();
  if (XUEAN_MODE_PACK.teacherWorkspaceId) {
    host.unregisterExtensionPoint('classroom.active_segment.main', XUEAN_MODE_PACK.teacherWorkspaceId);
  }
  if (XUEAN_MODE_PACK.studentWorkspaceId) {
    host.unregisterExtensionPoint('classroom.active_segment.student_main', XUEAN_MODE_PACK.studentWorkspaceId);
  }
  unregisterPluginSegmentTypes(PLUGIN_ID);
  unregisterCustomSegmentType(XUEAN_MODE_PACK_SEGMENT_TYPE, PLUGIN_ID);
}
