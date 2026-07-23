import { PlayCircle, Presentation, Wrench, HelpCircle, CheckCircle2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface SegmentTypeMeta {
  id: string;
  labelZh: string;
  labelEn: string;
  icon: LucideIcon;
}

export interface SegmentColorMeta {
  name: string;
  /** 浅色，用于 seg.color / 未选中节点 */
  color: string;
  /** 实心填充，用于选中节点（含 ring） */
  solid: string;
  /** 进度轨道着色 */
  rail: string;
}

export const SEGMENT_TYPES: SegmentTypeMeta[] = [
  { id: 'intro', labelZh: '准备环节', labelEn: 'Intro', icon: PlayCircle },
  { id: 'lecture', labelZh: '讲授新课', labelEn: 'Lecture', icon: Presentation },
  { id: 'practice', labelZh: '互动练习', labelEn: 'Practice', icon: Wrench },
  { id: 'quiz', labelZh: '随堂测试', labelEn: 'Quiz', icon: HelpCircle },
  { id: 'summary', labelZh: '要点总结', labelEn: 'Summary', icon: CheckCircle2 },
];

export const SEGMENT_COLORS: SegmentColorMeta[] = [
  {
    name: 'Blue',
    color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
    solid: 'bg-blue-500 text-white border-blue-500 shadow-md ring-2 ring-blue-200',
    rail: 'bg-blue-400',
  },
  {
    name: 'Indigo',
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
    solid: 'bg-indigo-500 text-white border-indigo-500 shadow-md ring-2 ring-indigo-200',
    rail: 'bg-indigo-400',
  },
  {
    name: 'Green',
    color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
    solid: 'bg-green-500 text-white border-green-500 shadow-md ring-2 ring-green-200',
    rail: 'bg-green-400',
  },
  {
    name: 'Purple',
    color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
    solid: 'bg-purple-500 text-white border-purple-500 shadow-md ring-2 ring-purple-200',
    rail: 'bg-purple-400',
  },
  {
    name: 'Amber',
    color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
    solid: 'bg-amber-500 text-white border-amber-500 shadow-md ring-2 ring-amber-200',
    rail: 'bg-amber-400',
  },
];

export const DEFAULT_SEGMENT_COLOR = SEGMENT_COLORS[1].color; // Indigo

export function getSegmentType(type?: string): SegmentTypeMeta {
  return SEGMENT_TYPES.find((t) => t.id === type) || SEGMENT_TYPES[1];
}

export function getSegmentColor(color?: string): SegmentColorMeta {
  return SEGMENT_COLORS.find((c) => c.color === color) || SEGMENT_COLORS[1];
}
