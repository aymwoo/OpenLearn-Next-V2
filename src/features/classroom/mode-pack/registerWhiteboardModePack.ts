/**
 * 将白板 Mode Pack 注册到前端扩展点（仅 Mode Pack flag 开启时由宿主调用）。
 */
import { Presentation } from 'lucide-react';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import {
  registerCustomSegmentType,
  unregisterCustomSegmentType,
  unregisterPluginSegmentTypes,
} from '../../teacher/lesson-editor/timelineConfig';
import { WhiteboardModeWorkspace } from './WhiteboardModeWorkspace';
import { WHITEBOARD_MODE_PACK } from './whiteboardPack';
import { DEFAULT_MODE_PACK_SEGMENT_TYPE } from '../../../../packages/core/plugin-host/mode-pack';

const PLUGIN_ID = WHITEBOARD_MODE_PACK.id;

export function registerWhiteboardModePack(): void {
  const host = usePluginHostStore.getState();
  const teacherId = WHITEBOARD_MODE_PACK.teacherWorkspaceId!;
  const studentId = WHITEBOARD_MODE_PACK.studentWorkspaceId!;

  registerCustomSegmentType(
    {
      id: DEFAULT_MODE_PACK_SEGMENT_TYPE,
      labelZh: '互动白板',
      labelEn: 'Whiteboard',
      icon: Presentation,
      pluginId: PLUGIN_ID,
    },
    PLUGIN_ID,
  );

  host.registerExtensionPoint('classroom.active_segment.main', {
    id: teacherId,
    label: WHITEBOARD_MODE_PACK.label,
    pluginId: PLUGIN_ID,
    targetType: DEFAULT_MODE_PACK_SEGMENT_TYPE,
    component: WhiteboardModeWorkspace,
    slotProps: { primary: true, targetType: DEFAULT_MODE_PACK_SEGMENT_TYPE },
  });

  host.registerExtensionPoint('classroom.active_segment.student_main', {
    id: studentId,
    label: WHITEBOARD_MODE_PACK.label,
    pluginId: PLUGIN_ID,
    targetType: DEFAULT_MODE_PACK_SEGMENT_TYPE,
    component: WhiteboardModeWorkspace,
    slotProps: { primary: true, targetType: DEFAULT_MODE_PACK_SEGMENT_TYPE },
  });
}

export function unregisterWhiteboardModePack(): void {
  const host = usePluginHostStore.getState();
  if (WHITEBOARD_MODE_PACK.teacherWorkspaceId) {
    host.unregisterExtensionPoint('classroom.active_segment.main', WHITEBOARD_MODE_PACK.teacherWorkspaceId);
  }
  if (WHITEBOARD_MODE_PACK.studentWorkspaceId) {
    host.unregisterExtensionPoint('classroom.active_segment.student_main', WHITEBOARD_MODE_PACK.studentWorkspaceId);
  }
  unregisterPluginSegmentTypes(PLUGIN_ID);
  unregisterCustomSegmentType(DEFAULT_MODE_PACK_SEGMENT_TYPE, PLUGIN_ID);
}
