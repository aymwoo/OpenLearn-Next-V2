/**
 * 内置学案 Mode Pack 声明（P2 首切片）。
 * 实际 React 工作区注册见 `registerXueanModePack()`。
 */
import type { ModePackContribution } from '../../../../packages/core/plugin-host/mode-pack';

export const XUEAN_MODE_PACK_SEGMENT_TYPE = 'xuean' as const;

export const XUEAN_MODE_PACK_ID = '@openlearn/mode-xuean';

export const XUEAN_MODE_PACK: ModePackContribution = {
  id: XUEAN_MODE_PACK_ID,
  label: '学案学习',
  labelEn: 'Guided Study (Xuean)',
  segmentTypes: [XUEAN_MODE_PACK_SEGMENT_TYPE],
  isDefault: false,
  prepContributionId: 'prep-xuean',
  outlineContributionId: 'outline-xuean-activities',
  teacherWorkspaceId: 'mode-xuean-teacher',
  studentWorkspaceId: 'mode-xuean-student',
  adapterIds: ['xuean-adapter'],
  channels: ['xuean:task'],
};
