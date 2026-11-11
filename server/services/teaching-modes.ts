/**
 * 内置教学模式 —— 课堂启动门户「教学模式选择器」的兜底数据源。
 *
 * 不写进迁移 seed 的原因：模式文案需跟随 i18n 与产品迭代变化，写进迁移会造成
 * 「迁移与业务常量两处维护」。API 读取时以「数据库记录优先 + 本常量兜底」合并返回，
 * 因此管理员可在不发版的情况下改写文案或追加自定义模式。
 * color 存语义色名（非具体色值），由前端映射到主题 token，避免深色主题下失色。
 */
export interface TeachingMode {
  id: string;
  name: string;
  nameEn: string | null;
  description: string;
  descriptionEn: string | null;
  icon: string;
  color: string;
  isBuiltin: boolean;
  sortOrder: number;
}

export const BUILTIN_TEACHING_MODES: TeachingMode[] = [
  {
    id: 'lecture',
    name: '讲授式',
    nameEn: 'Lecture',
    description: '教师主导讲解，学生跟随听讲与记录',
    descriptionEn: 'Teacher-led explanation with students following along',
    icon: 'Presentation',
    color: 'indigo',
    isBuiltin: true,
    sortOrder: 10,
  },
  {
    id: 'inquiry',
    name: '探究式',
    nameEn: 'Inquiry',
    description: '以问题驱动，学生自主提出假设并验证',
    descriptionEn: 'Question-driven: students form and test their own hypotheses',
    icon: 'FlaskConical',
    color: 'emerald',
    isBuiltin: true,
    sortOrder: 20,
  },
  {
    id: 'collaborative',
    name: '协作式',
    nameEn: 'Collaborative',
    description: '小组分工协作，共同产出并互评',
    descriptionEn: 'Group work with division of labour and peer review',
    icon: 'Users',
    color: 'amber',
    isBuiltin: true,
    sortOrder: 30,
  },
  {
    id: 'experiential',
    name: '体验式',
    nameEn: 'Experiential',
    description: '沉浸式交互体验，在做中学',
    descriptionEn: 'Immersive hands-on experience: learning by doing',
    icon: 'Sparkles',
    color: 'violet',
    isBuiltin: true,
    sortOrder: 40,
  },
  {
    id: 'drill',
    name: '练习式',
    nameEn: 'Drill',
    description: '针对性变式练习与即时反馈攻克',
    descriptionEn: 'Targeted varied practice with immediate feedback',
    icon: 'Target',
    color: 'rose',
    isBuiltin: true,
    sortOrder: 50,
  },
];

/** 教学模式 id 规范：与插件 id 同构，避免路径穿越与非法字符。 */
export const TEACHING_MODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 按 id 建索引，供会话列表等只读场景拼接展示名，避免每次都线性扫描。 */
export const BUILTIN_TEACHING_MODE_MAP: ReadonlyMap<string, TeachingMode> = new Map(
  BUILTIN_TEACHING_MODES.map((mode) => [mode.id, mode]),
);
