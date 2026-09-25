export type NetworkMode = 'CLOUD_ONLINE' | 'EDGE_LAN_ONLY' | 'OFFLINE_DISCONNECTED';

export interface NetworkHealthState {
  mode: NetworkMode;
  isInternetReachable: boolean;
  isLocalServerReachable: boolean;
  latencyMs: number;
  lastPingTimestamp: number;
  bufferedOfflineEventsCount: number;
}

export interface OfflineJournalEvent {
  id: string;
  eventType: string;
  payload: any;
  timestamp: number;
  synced: boolean;
}

// ── 硬件教具生态标准化 ──────────────────────────────────────────
export type HardwareDeviceType = 'RF_CLICKER' | 'PRESENTER_PEN' | 'DIGITAL_TABLET';

export type HardwareStandardAction =
  | 'CLICKER_SUBMIT_OPTION' // 物理答题器选择 A/B/C/D
  | 'CLICKER_BUZZER_PRESS'  // 物理答题器抢答
  | 'PRESENTER_PREV_PAGE'   // 翻页笔上一页
  | 'PRESENTER_NEXT_PAGE'   // 翻页笔下一页
  | 'PRESENTER_LASER_TOGGLE'// 翻页笔激光笔开关
  | 'PRESENTER_BLANK_SCREEN'// 翻页笔黑屏/全屏
  | 'TABLET_DRAW_STROKE';   // 数位板压感笔触

export interface HardwareEvent {
  deviceId: string;
  deviceType: HardwareDeviceType;
  action: HardwareStandardAction;
  studentId?: string;
  studentNumber?: string;
  value?: string | number | boolean;
  rawPayload?: any;
  timestamp: number;
}

// ── 课堂宏动作编排 (Classroom Action Macros) ─────────────────────
export type MacroId = 'MACRO_BURST_QUIZ' | 'MACRO_BREAKOUT_SYNC' | 'MACRO_FOCUS_SILENCE';

export interface MacroStep {
  id: string;
  title: string;
  description: string;
  durationMs?: number; // 步骤延迟或预设持续时间
  actionType:
    | 'BROADCAST_NOTIFICATION'
    | 'START_COUNTDOWN'
    | 'LOCK_STUDENT_SCREENS'
    | 'NAVIGATE_VIEW'
    | 'AUTO_COLLECT_QUIZ'
    | 'OPEN_GALLERY_WALK'
    | 'HIGHLIGHT_WHITEBOARD';
  payload?: any;
}

export interface MacroPreset {
  id: MacroId;
  name: string;
  description: string;
  icon: string;
  category: 'evaluation' | 'collaboration' | 'focus';
  estimatedSeconds: number;
  steps: MacroStep[];
}

export interface MacroExecutionState {
  macroId: MacroId;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'aborted';
  currentStepIndex: number;
  progressPercent: number;
  stepStartTime: number;
  totalSteps: number;
  logMessages: string[];
}
