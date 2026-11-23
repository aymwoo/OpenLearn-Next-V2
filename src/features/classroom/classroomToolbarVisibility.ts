import { useCallback, useSyncExternalStore } from 'react';

/**
 * 白板课「课堂工具」与「更多」的统一开关表。
 *
 * 顶栏只保留一个入口，里面所有按钮/功能都由此登记；「控制」tab 按登记顺序渲染开关，
 * 关闭后对应按钮在顶栏、Cockpit 面板里都不再渲染。默认全开，持久化到 localStorage。
 */
export type ClassroomToolbarGroupId = 'stage' | 'interaction' | 'quick_action' | 'manage';

export interface ClassroomToolbarFeature {
  id: string;
  group: ClassroomToolbarGroupId;
  zh: string;
  en: string;
}

export const CLASSROOM_TOOLBAR_GROUPS: { id: ClassroomToolbarGroupId; zh: string; en: string }[] = [
  { id: 'stage', zh: '阶段流程', en: 'Stage Flow' },
  { id: 'interaction', zh: '课堂互动', en: 'Interaction' },
  { id: 'quick_action', zh: '快捷工具', en: 'Quick Actions' },
  { id: 'manage', zh: '课堂管理', en: 'Classroom Management' },
];

export const CLASSROOM_TOOLBAR_FEATURES: ClassroomToolbarFeature[] = [
  { id: 'stage_stepper', group: 'stage', zh: '阶段导航（课前/课中/结课/简报）', en: 'Stage Stepper' },
  { id: 'quick_poll', group: 'interaction', zh: '极速投票', en: 'Quick Poll' },
  { id: 'buzzer', group: 'interaction', zh: '发起抢答', en: 'Buzzer' },
  { id: 'exit_ticket', group: 'interaction', zh: '60s 通票', en: 'Exit Ticket' },
  { id: 'stage_display', group: 'interaction', zh: '打开大屏展台', en: 'Stage Display' },
  { id: 'roll_call', group: 'interaction', zh: '随机抽问', en: 'Roll Call' },
  { id: 'leaderboard', group: 'interaction', zh: '积分榜', en: 'Leaderboard' },
  { id: 'pacing_barometer', group: 'interaction', zh: '节奏晴雨表', en: 'Pacing Barometer' },
  { id: 'diagnostic_center', group: 'quick_action', zh: '课堂异常告警中心', en: 'Diagnostic Center' },
  { id: 'mastery_prediction', group: 'quick_action', zh: 'AI 实时学情预测', en: 'AI Mastery Prediction' },
  { id: 'group_collab', group: 'quick_action', zh: '小组协作与画廊互评', en: 'Group Collab' },
  { id: 'showcase_diff', group: 'quick_action', zh: '多屏对比投屏', en: 'Multi-Screen Diff' },
  { id: 'peer_review', group: 'quick_action', zh: '作业互评与赏析秀场', en: 'Peer Review' },
  { id: 'parent_notification', group: 'quick_action', zh: '家校通知生成器', en: 'Parent Notification' },
  { id: 'macro_runner', group: 'quick_action', zh: '课堂宏动作编排', en: 'Action Macros' },
  { id: 'hardware_bridge', group: 'quick_action', zh: '硬件教具网关', en: 'Hardware Bridge' },
  { id: 'in_context_drawer', group: 'quick_action', zh: '课中设置抽屉', en: 'In-Class Settings' },
  { id: 'back_to_portal', group: 'manage', zh: '返回门户', en: 'Back to Portal' },
  { id: 'session_manager', group: 'manage', zh: '会话档案', en: 'Sessions' },
  { id: 'lesson_switch', group: 'manage', zh: '课节切换与编辑', en: 'Lesson Switch' },
  { id: 'student_window', group: 'manage', zh: '学生视角预览（独立 Tab）', en: 'Student Preview' },
];

export type ClassroomToolbarVisibility = Record<string, boolean>;

const STORAGE_KEY = 'openlearn:classroom-toolbar-visibility:v1';

function allEnabled(): ClassroomToolbarVisibility {
  return CLASSROOM_TOOLBAR_FEATURES.reduce<ClassroomToolbarVisibility>((acc, feature) => {
    acc[feature.id] = true;
    return acc;
  }, {});
}

function loadVisibility(): ClassroomToolbarVisibility {
  const defaults = allEnabled();
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    for (const feature of CLASSROOM_TOOLBAR_FEATURES) {
      const value = (parsed as Record<string, unknown>)[feature.id];
      if (typeof value === 'boolean') defaults[feature.id] = value;
    }
  } catch {
    // 存储损坏时退回默认全开，不阻断上课。
  }
  return defaults;
}

let visibility: ClassroomToolbarVisibility = loadVisibility();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // 隐私模式/配额不足：只影响刷新后的记忆，不影响本次上课。
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ClassroomToolbarVisibility {
  return visibility;
}

export function isClassroomToolbarFeatureEnabled(id: string): boolean {
  return visibility[id] !== false;
}

export function setClassroomToolbarFeatureEnabled(id: string, enabled: boolean) {
  if (!(id in visibility) || visibility[id] === enabled) return;
  visibility = { ...visibility, [id]: enabled };
  persist();
  emit();
}

export function resetClassroomToolbarVisibility() {
  visibility = allEnabled();
  persist();
  emit();
}

export function useClassroomToolbarVisibility() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isEnabled = useCallback((id: string) => snapshot[id] !== false, [snapshot]);
  return {
    visibility: snapshot,
    isEnabled,
    setFeatureEnabled: setClassroomToolbarFeatureEnabled,
    resetAll: resetClassroomToolbarVisibility,
  };
}
