import type { Language } from '../../i18n';
export type { Language };

export interface PluginType {
  id: string;
  name: string;
  status: string;
  created_at: number;
  manifest: string;
  execution_mode?: string;
  version?: string;
  has_frontend?: boolean;
}

export interface ParsedManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  capabilitiesProposed?: string[];
}

export interface ParsedAction {
  id: string;
  commandType: string;
  description?: string;
}

export interface PluginCenterProps {
  plugins: PluginType[];
  lang: Language;
  storeTab: 'store' | 'widgets' | 'dev' | 'logs';
  setStoreTab: (tab: 'store' | 'widgets' | 'dev' | 'logs') => void;
  pluginCode: string;
  setPluginCode: (code: string) => void;
  installingPlugin: boolean;
  onInstall: () => void;
  onZipUpload: (
    file: File,
    executionMode: 'worker' | 'inline',
    opts?: { mode?: 'install' | 'update'; targetPluginId?: string; allowDowngrade?: boolean },
  ) => Promise<void>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

export const CAPABILITY_INFO: Record<string, {
  labelZh: string;
  labelEn: string;
  iconName: string;
  risk: 'low' | 'medium' | 'high';
  riskDescZh: string;
  riskDescEn: string;
}> = {
  'whiteboard:write': {
    labelZh: '写入交互白板内容',
    labelEn: 'Whiteboard Write Access',
    iconName: 'PenTool',
    risk: 'low',
    riskDescZh: '仅允许在当堂课白板上绘制线条和文本卡片',
    riskDescEn: 'Allows drawing lines and cards on active whiteboard',
  },
  'lesson:read': {
    labelZh: '读取课程教案与大纲',
    labelEn: 'Lesson Read Access',
    iconName: 'Eye',
    risk: 'low',
    riskDescZh: '仅读取当前已发布的课程章节结构与大纲内容',
    riskDescEn: 'Reads structural chapters of published lessons',
  },
  'student:read': {
    labelZh: '读取学生名单与考勤',
    labelEn: 'Student Roster Read Access',
    iconName: 'Users',
    risk: 'medium',
    riskDescZh: '获取班级学生基本学籍名录和出勤状态',
    riskDescEn: 'Accesses student roster and attendance records',
  },
  'database:custom_table': {
    labelZh: '创建插件自建独立数据表',
    labelEn: 'Custom DB Table Creation',
    iconName: 'Database',
    risk: 'medium',
    riskDescZh: '允许在 SQLite 数据库中动态建表存储该插件业务数据',
    riskDescEn: 'Allows dynamic table creation in SQLite DB',
  },
};
