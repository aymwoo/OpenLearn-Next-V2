/**
 * 内置白板 Mode Pack 声明（P1 骨架）。
 * 声明体由 `packages/core/plugin-host/mode-pack.ts` 统一维护，服务端目录
 * 与前端工作区共用同一份，避免 id / 环节类型漂移。
 * 实际 React 工作区注册见 `registerWhiteboardModePack()`。
 */
import {
  BUILTIN_WHITEBOARD_MODE_PACK,
  BUILTIN_WHITEBOARD_MODE_PACK_ID,
  type ModePackContribution,
} from '../../../../packages/core/plugin-host/mode-pack';

export const WHITEBOARD_MODE_PACK_ID = BUILTIN_WHITEBOARD_MODE_PACK_ID;

export const WHITEBOARD_MODE_PACK: ModePackContribution = BUILTIN_WHITEBOARD_MODE_PACK;
