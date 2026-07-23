import {
  Terminal,
  Activity,
  Presentation,
  Puzzle,
  Globe,
  ClipboardList,
  Shuffle,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type PaletteColorKey =
  | 'slate'
  | 'blue'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'emerald'
  | 'cyan'
  | 'pink';

export type EditFieldKind = 'input' | 'textarea' | 'options';

export interface EditField {
  key: string;
  labelZh: string;
  labelEn: string;
  kind: EditFieldKind;
  placeholderZh?: string;
  placeholderEn?: string;
}

export interface PaletteItemConfig {
  type: string;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
  icon: LucideIcon;
  color: PaletteColorKey;
  group: string;
  defaultData: Record<string, any>;
  editFields: EditField[];
}

export interface PaletteGroup {
  id: string;
  labelZh: string;
  labelEn: string;
}

// 主题色 → Tailwind 类名（必须为静态字符串，便于编译）
export const COLOR_THEME: Record<
  PaletteColorKey,
  {
    iconBg: string;
    iconText: string;
    cardHoverBorder: string;
    cardHoverRing: string;
    cardHoverShadow: string;
    groupAccent: string;
    groupText: string;
  }
> = {
  slate: {
    iconBg: 'bg-slate-100',
    iconText: 'text-slate-600',
    cardHoverBorder: 'hover:border-slate-400',
    cardHoverRing: 'group-hover:ring-slate-300',
    cardHoverShadow: 'group-hover:shadow-slate-200/70',
    groupAccent: 'bg-slate-400',
    groupText: 'text-slate-500',
  },
  blue: {
    iconBg: 'bg-blue-100',
    iconText: 'text-blue-600',
    cardHoverBorder: 'hover:border-blue-400',
    cardHoverRing: 'group-hover:ring-blue-300',
    cardHoverShadow: 'group-hover:shadow-blue-200/70',
    groupAccent: 'bg-blue-400',
    groupText: 'text-blue-500',
  },
  violet: {
    iconBg: 'bg-violet-100',
    iconText: 'text-violet-600',
    cardHoverBorder: 'hover:border-violet-400',
    cardHoverRing: 'group-hover:ring-violet-300',
    cardHoverShadow: 'group-hover:shadow-violet-200/70',
    groupAccent: 'bg-violet-400',
    groupText: 'text-violet-500',
  },
  amber: {
    iconBg: 'bg-amber-100',
    iconText: 'text-amber-600',
    cardHoverBorder: 'hover:border-amber-400',
    cardHoverRing: 'group-hover:ring-amber-300',
    cardHoverShadow: 'group-hover:shadow-amber-200/70',
    groupAccent: 'bg-amber-400',
    groupText: 'text-amber-500',
  },
  rose: {
    iconBg: 'bg-rose-100',
    iconText: 'text-rose-600',
    cardHoverBorder: 'hover:border-rose-400',
    cardHoverRing: 'group-hover:ring-rose-300',
    cardHoverShadow: 'group-hover:shadow-rose-200/70',
    groupAccent: 'bg-rose-400',
    groupText: 'text-rose-500',
  },
  emerald: {
    iconBg: 'bg-emerald-100',
    iconText: 'text-emerald-600',
    cardHoverBorder: 'hover:border-emerald-400',
    cardHoverRing: 'group-hover:ring-emerald-300',
    cardHoverShadow: 'group-hover:shadow-emerald-200/70',
    groupAccent: 'bg-emerald-400',
    groupText: 'text-emerald-500',
  },
  cyan: {
    iconBg: 'bg-cyan-100',
    iconText: 'text-cyan-600',
    cardHoverBorder: 'hover:border-cyan-400',
    cardHoverRing: 'group-hover:ring-cyan-300',
    cardHoverShadow: 'group-hover:shadow-cyan-200/70',
    groupAccent: 'bg-cyan-400',
    groupText: 'text-cyan-500',
  },
  pink: {
    iconBg: 'bg-pink-100',
    iconText: 'text-pink-600',
    cardHoverBorder: 'hover:border-pink-400',
    cardHoverRing: 'group-hover:ring-pink-300',
    cardHoverShadow: 'group-hover:shadow-pink-200/70',
    groupAccent: 'bg-pink-400',
    groupText: 'text-pink-500',
  },
};

export const PALETTE_GROUPS: PaletteGroup[] = [
  { id: 'present', labelZh: '内容呈现', labelEn: 'Content' },
  { id: 'assess', labelZh: '评估互动', labelEn: 'Assessment' },
  { id: 'manage', labelZh: '课堂管理', labelEn: 'Classroom' },
];

export const PALETTE_ITEMS: PaletteItemConfig[] = [
  {
    type: 'presentation',
    labelZh: '课件演示',
    labelEn: 'Slides Deck',
    descriptionZh: 'Markdown 幻灯片',
    descriptionEn: 'Markdown slides',
    icon: Presentation,
    color: 'violet',
    group: 'present',
    defaultData: { markdown: '# Title Slide\n---\n## Slide 2' },
    editFields: [
      {
        key: 'markdown',
        labelZh: '幻灯片内容 (Markdown)',
        labelEn: 'Slides Content (Markdown)',
        kind: 'textarea',
        placeholderZh: '# 标题\n---\n## 第二页',
      },
    ],
  },
  {
    type: 'code-sandbox',
    labelZh: '代码沙箱',
    labelEn: 'Code Editor',
    descriptionZh: '可运行代码',
    descriptionEn: 'Runnable code',
    icon: Terminal,
    color: 'slate',
    group: 'present',
    defaultData: { code: "console.log('Hello Sandbox!');" },
    editFields: [
      {
        key: 'code',
        labelZh: '代码',
        labelEn: 'Code',
        kind: 'textarea',
        placeholderZh: "console.log('Hello');",
      },
    ],
  },
  {
    type: 'math-graph',
    labelZh: '数学函数',
    labelEn: 'Math Grapher',
    descriptionZh: '函数图像',
    descriptionEn: 'Function graph',
    icon: Activity,
    color: 'blue',
    group: 'present',
    defaultData: { equation: 'Math.sin(x)' },
    editFields: [
      {
        key: 'equation',
        labelZh: '函数表达式',
        labelEn: 'Equation',
        kind: 'input',
        placeholderZh: '如 Math.sin(x)',
      },
    ],
  },
  {
    type: 'quiz',
    labelZh: '随堂测试',
    labelEn: 'Interactive Quiz',
    descriptionZh: '选择题互动',
    descriptionEn: 'Multiple choice',
    icon: Puzzle,
    color: 'amber',
    group: 'assess',
    defaultData: { question: 'New Quiz', options: ['A', 'B', 'C', 'D'] },
    editFields: [
      {
        key: 'question',
        labelZh: '题目',
        labelEn: 'Question',
        kind: 'input',
        placeholderZh: '请输入题目',
      },
      {
        key: 'options',
        labelZh: '选项 (A/B/C/D)',
        labelEn: 'Options (A/B/C/D)',
        kind: 'options',
      },
    ],
  },
  {
    type: 'assignment',
    labelZh: '作业提交',
    labelEn: 'Assignment',
    descriptionZh: '布置与提交',
    descriptionEn: 'Submit work',
    icon: ClipboardList,
    color: 'rose',
    group: 'assess',
    defaultData: { title: 'New Assignment', description: 'Upload your work here' },
    editFields: [
      {
        key: 'title',
        labelZh: '作业标题',
        labelEn: 'Title',
        kind: 'input',
        placeholderZh: '如：第一章练习',
      },
      {
        key: 'description',
        labelZh: '说明',
        labelEn: 'Description',
        kind: 'textarea',
        placeholderZh: '作业要求说明…',
      },
    ],
  },
  {
    type: 'html-applet',
    labelZh: '交互实验',
    labelEn: 'HTML Applet',
    descriptionZh: '可交互网页',
    descriptionEn: 'Interactive web',
    icon: Globe,
    color: 'emerald',
    group: 'assess',
    defaultData: {
      code: `<!-- Interactive Physics -->\n<div style='padding:20px; text-align:center;'>\n  <h2>Interactive Physics</h2>\n  <button onclick="alert('Simulating Gravity!')">Drop Ball</button>\n</div>`,
    },
    editFields: [
      {
        key: 'code',
        labelZh: 'HTML 代码',
        labelEn: 'HTML Code',
        kind: 'textarea',
        placeholderZh: '<div>…</div>',
      },
    ],
  },
  {
    type: 'rollcall',
    labelZh: '随机点名',
    labelEn: 'Random Picker',
    descriptionZh: '课堂点名',
    descriptionEn: 'Pick a student',
    icon: Shuffle,
    color: 'cyan',
    group: 'manage',
    defaultData: { allStudents: [] },
    editFields: [],
  },
  {
    type: 'hello-world',
    labelZh: '问候插件',
    labelEn: 'Hello World',
    descriptionZh: '欢迎问候',
    descriptionEn: 'Welcome greeting',
    icon: Sparkles,
    color: 'pink',
    group: 'manage',
    defaultData: {},
    editFields: [],
  },
];

export const PALETTE_ITEM_MAP: Record<string, PaletteItemConfig> = PALETTE_ITEMS.reduce(
  (acc, item) => {
    acc[item.type] = item;
    return acc;
  },
  {} as Record<string, PaletteItemConfig>,
);
