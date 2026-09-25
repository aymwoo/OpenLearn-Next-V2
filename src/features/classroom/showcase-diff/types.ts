/**
 * Types for Showcase & Dual/Quad-Screen Diff feature
 */

export type DiffScreenLayout = 'dual' | 'triple' | 'quad';

export interface DiffStudentWork {
  studentId: string;
  studentName: string;
  studentNumber?: string;
  seatNumber?: string;
  source: 'code' | 'whiteboard' | 'quiz_answer' | 'screen_snapshot';
  title?: string;
  content: string; // 演算文本、代码、公式或 SVG 快照
  submittedAt?: string;
  durationSec?: number;
  accuracyScore?: number;
  tags: string[]; // ['推荐思路', '极值妙解', '典型卡点', '规范步骤']
  category?: 'exemplary' | 'typical_error' | 'alternative' | 'standard';
}

export type DiffToolType = 'laser' | 'highlighter' | 'pen' | 'eraser' | 'stamp';

export interface DiffPoint {
  x: number;
  y: number;
}

export interface DiffAnnotationStroke {
  id: string;
  tool: 'laser' | 'highlighter' | 'pen' | 'eraser';
  color: string;
  width: number;
  opacity: number;
  points: DiffPoint[];
}

export type DiffStampType = 'pitfall' | 'smart' | 'miss_force' | 'exemplary';

export interface DiffStamp {
  id: string;
  x: number;
  y: number;
  type: DiffStampType;
  label: string;
  color: string;
  screenIndex: number;
}
