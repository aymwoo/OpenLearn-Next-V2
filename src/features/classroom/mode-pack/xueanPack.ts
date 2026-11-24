/**
 * 内置学案 Mode Pack 声明（P2 首切片）。
 * 声明体由 `packages/core/plugin-host/mode-pack.ts` 统一维护，服务端目录
 * 与前端工作区共用同一份，避免 id / 环节类型漂移。
 * 实际 React 工作区注册见 `registerXueanModePack()`。
 */
import {
  BUILTIN_XUEAN_MODE_PACK,
  BUILTIN_XUEAN_MODE_PACK_ID,
  type ModePackContribution,
} from '../../../../packages/core/plugin-host/mode-pack';

export const XUEAN_MODE_PACK_SEGMENT_TYPE = 'xuean' as const;

export const XUEAN_MODE_PACK_ID = BUILTIN_XUEAN_MODE_PACK_ID;

export const XUEAN_MODE_PACK: ModePackContribution = BUILTIN_XUEAN_MODE_PACK;
