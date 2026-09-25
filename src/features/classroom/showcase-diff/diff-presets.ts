import type { DiffStampType } from './types';

export interface DiffStampPreset {
  type: DiffStampType;
  label: string;
  shortLabel: string;
  icon: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

export const DIFF_STAMP_PRESETS: DiffStampPreset[] = [
  {
    type: 'pitfall',
    label: '⚠️ 典型思维死角',
    shortLabel: '思维死角',
    icon: '⚠️',
    bgColor: 'bg-rose-500/20',
    textColor: 'text-rose-600 dark:text-rose-300',
    borderColor: 'border-rose-500/40',
  },
  {
    type: 'smart',
    label: '💡 巧妙化简/妙解',
    shortLabel: '巧妙妙解',
    icon: '💡',
    bgColor: 'bg-amber-500/20',
    textColor: 'text-amber-600 dark:text-amber-300',
    borderColor: 'border-amber-500/40',
  },
  {
    type: 'miss_force',
    label: '❌ 漏掉临界/守恒条件',
    shortLabel: '漏临界条件',
    icon: '❌',
    bgColor: 'bg-purple-500/20',
    textColor: 'text-purple-600 dark:text-purple-300',
    borderColor: 'border-purple-500/40',
  },
  {
    type: 'exemplary',
    label: '✅ 规范书写示范',
    shortLabel: '规范示范',
    icon: '✅',
    bgColor: 'bg-emerald-500/20',
    textColor: 'text-emerald-600 dark:text-emerald-300',
    borderColor: 'border-emerald-500/40',
  },
];

export const HIGHLIGHTER_COLORS = [
  { name: '荧光黄', hex: '#fde047', strokeHex: 'rgba(253, 224, 71, 0.45)' },
  { name: '荧光粉', hex: '#f472b6', strokeHex: 'rgba(244, 114, 182, 0.45)' },
  { name: '荧光青', hex: '#22d3ee', strokeHex: 'rgba(34, 211, 238, 0.45)' },
  { name: '荧光绿', hex: '#4ade80', strokeHex: 'rgba(74, 222, 128, 0.45)' },
];

export const PEN_COLORS = [
  { name: '批改红', hex: '#ef4444' },
  { name: '标注蓝', hex: '#3b82f6' },
  { name: '警示橙', hex: '#f97316' },
  { name: '强调白', hex: '#ffffff' },
];
