/**
 * 第三方模式包验收 fixture（阶段 11.1）。
 *
 * 服务端与前端测试共用同一份声明，避免各自手写常量后漂移：
 * - `LAB_PLUGIN_MANIFEST`：插件 manifest，`contributes['mode.pack']` 覆盖全部字段；
 * - `LAB_MODE_PACK`：manifest 里那份 `ModePackContribution` 的类型化副本；
 * - `LAB_EXTENSION_REGISTRATIONS`：插件运行时应注册的扩展点（备课 / 大纲 / 双端工作区）。
 *
 * 这不是可安装的插件包，只用于验证「manifest → 目录 → 宿主消费」链路。
 */
import type { ModePackContribution } from '../../mode-pack.js';

export const LAB_MODE_PACK_PLUGIN_ID = 'ext-lab';
export const LAB_MODE_PACK_PLUGIN_NAME = 'Inquiry Lab Mode Pack';
export const LAB_MODE_PACK_ID = 'ext-lab:mode-inquiry';
export const LAB_PREP_CONTRIBUTION_ID = 'prep-lab';
export const LAB_OUTLINE_CONTRIBUTION_ID = 'outline-lab';
export const LAB_TEACHER_WORKSPACE_ID = 'mode-lab-teacher';
export const LAB_STUDENT_WORKSPACE_ID = 'mode-lab-student';
export const LAB_ADAPTER_ID = 'lab-adapter';
export const LAB_CHANNEL_NAME = 'lab:task';

/** `inquiry` 是前缀类型，同时认领 `inquiry:sim` / `inquiry:report` 等子类型。 */
export const LAB_MODE_PACK: ModePackContribution = {
  id: LAB_MODE_PACK_ID,
  label: '探究实验室',
  labelEn: 'Inquiry Lab',
  segmentTypes: ['inquiry'],
  prepContributionId: LAB_PREP_CONTRIBUTION_ID,
  outlineContributionId: LAB_OUTLINE_CONTRIBUTION_ID,
  teacherWorkspaceId: LAB_TEACHER_WORKSPACE_ID,
  studentWorkspaceId: LAB_STUDENT_WORKSPACE_ID,
  adapterIds: [LAB_ADAPTER_ID],
  channels: [LAB_CHANNEL_NAME],
};

export const LAB_PLUGIN_MANIFEST = {
  id: LAB_MODE_PACK_PLUGIN_ID,
  name: LAB_MODE_PACK_PLUGIN_NAME,
  version: '1.0.0',
  main: 'index.js',
  contributes: {
    'mode.pack': [LAB_MODE_PACK],
  },
};

export interface LabExtensionRegistration {
  slot: string;
  config: Record<string, unknown>;
}

/**
 * 插件激活时应完成的扩展点注册。
 * 备课 / 大纲槽位按 `declared` 字段匹配，双端工作区按 `targetType` 过滤。
 */
export const LAB_EXTENSION_REGISTRATIONS: readonly LabExtensionRegistration[] = [
  {
    slot: 'classroom.prep',
    config: {
      id: LAB_PREP_CONTRIBUTION_ID,
      targetType: 'inquiry',
      slotProps: { prepContributionId: LAB_PREP_CONTRIBUTION_ID, primary: true },
    },
  },
  {
    slot: 'classroom.outline',
    config: {
      id: LAB_OUTLINE_CONTRIBUTION_ID,
      targetType: 'inquiry',
      slotProps: { primary: true },
    },
  },
  {
    slot: 'classroom.active_segment.main',
    config: {
      id: LAB_TEACHER_WORKSPACE_ID,
      targetType: 'inquiry',
      slotProps: { primary: true, targetType: 'inquiry' },
    },
  },
  {
    slot: 'classroom.active_segment.student_main',
    config: {
      id: LAB_STUDENT_WORKSPACE_ID,
      targetType: 'inquiry',
      slotProps: { primary: true, targetType: 'inquiry' },
    },
  },
];
