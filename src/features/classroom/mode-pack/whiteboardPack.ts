/**
 * 内置白板 Mode Pack 声明（P1 骨架）。
 * 实际 React 工作区注册见 `registerWhiteboardModePack()`。
 */
import type { ModePackContribution } from '../../../../packages/core/plugin-host/mode-pack';
import { DEFAULT_MODE_PACK_SEGMENT_TYPE } from '../../../../packages/core/plugin-host/mode-pack';

export const WHITEBOARD_MODE_PACK_ID = '@openlearn/mode-whiteboard';

export const WHITEBOARD_MODE_PACK: ModePackContribution = {
  id: WHITEBOARD_MODE_PACK_ID,
  label: '互动白板',
  labelEn: 'Interactive Whiteboard',
  segmentTypes: [DEFAULT_MODE_PACK_SEGMENT_TYPE],
  isDefault: true,
  prepContributionId: 'prep-whiteboard',
  teacherWorkspaceId: 'mode-whiteboard-teacher',
  studentWorkspaceId: 'mode-whiteboard-student',
};
