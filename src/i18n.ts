export type Language = 'zh' | 'en';

export const DEFAULT_LANGUAGE: Language = 'zh';

const baseTranslations: Record<Language, Record<string, string>> = {
  zh: {
    // Phase 9: Extension Points & Plugin Migration
    migratableBadge: '可迁移',
    migrateToFormat: '迁移到新格式',
    migrationPromptHeading: '发现可迁移的旧格式插件',
    migrationPromptBody: '该插件使用旧格式运行。上传新格式 ZIP 包以完成迁移，迁移后旧版本可安全卸载。',
    zipParseError: 'ZIP 文件解析失败，请确认文件包含有效的 manifest.json',
    workerActivationError: '插件在 Worker 环境中激活失败，请检查插件代码与浏览器兼容性',
    extensionLoadError: '扩展组件加载失败',
    retry: '重新加载',
    noExtensionPoints: '暂无已注册的扩展组件',
    dropZipHere: '拖拽 ZIP 文件到此处',
    zipFileHint: '仅支持 .zip 格式的插件包',
    analyzing: '分析中...',
    dragActive: '释放以上传',
    legacyTooltip: '该插件使用旧执行格式运行。新格式版本可能可用。',
    ready: '就绪',
    uploadZipPlugin: '上传并安装 ZIP 插件',

    agentTitle: '内核助手',
    agentSubtitle: '自主 Shell 控制器',
    agentIntro:
      '你好！我是你的教育系统 OS 内核助手。你可以让我“创建一节物理课并在白板上画一个圆”，我将通过底层总线为你构建。',
    placeholder: '例如：创建一节历史课并画一张地图...',
    dashboard: '系统总览',
    kernelRunning: '系统正常运行',
    lessons: '课程',
    noLessons: '暂无课程。请让助手创建一节课！',
    noContent: '无内容...',
    whiteboardCanvas: '白板画布',
    emptyWhiteboard: '白板为空',
    simulationError: '系统错误：执行 OS 命令失败。',
    executedCommands: '执行的命令：',
    switchLang: 'Switch to English',
    plugins: '插件中心',
    uploadPlugin: '上传并安装插件',
    pluginSource: '扩展插件源码 (JS)',
    installPlugin: '验证并安装',
    installing: '安装中...',
    installedPlugins: '已运行插件',
    noPlugins: '未发现第三方插件',
    lessonContent: '课程教案与笔记',
    eventStream: '内核审计事件流',
    selectLesson: '请先在左侧选择一节课程',
    systemLogs: '系统日志',
    hideLogs: '隐藏日志',
    showLogs: '显示日志',
    approvals: '待审批高危操作',
    approve: '批准',
    reject: '拒绝',
    noApprovals: '暂无待审批命令',
    fileSystem: '虚拟文件系统',
    noFiles: '当前目录为空',
    processes: '进程管理',
    noProcesses: '没有正在运行的进程',
    processLogs: '查看日志',
    classes: '班级管理',
    students: '学生管理',
    noClasses: '暂无班级',
    noStudents: '暂无学生',
    openInNewTab: '在新标签页打开',
  },
  en: {
    // Phase 9: Extension Points & Plugin Migration
    migratableBadge: 'Migratable',
    migrateToFormat: 'Migrate to New Format',
    migrationPromptHeading: 'Legacy Plugin Detected',
    migrationPromptBody:
      'This plugin runs in legacy mode. Upload a new-format ZIP package to migrate. The old version can be safely uninstalled afterwards.',
    zipParseError: 'Failed to parse ZIP file. Ensure the package contains a valid manifest.json.',
    workerActivationError:
      'Plugin activation in Worker environment failed. Check plugin code and browser compatibility.',
    extensionLoadError: 'Extension failed to load',
    retry: 'Retry Load',
    noExtensionPoints: 'No extension points registered',
    dropZipHere: 'Drop ZIP file here',
    zipFileHint: '.zip plugin packages only',
    analyzing: 'Analyzing...',
    dragActive: 'Release to upload',
    legacyTooltip: 'This plugin uses the old execution format. A new-format version may be available.',
    ready: 'Ready',
    uploadZipPlugin: 'Upload & Install ZIP Plugin',

    agentTitle: 'Kernel Agent',
    agentSubtitle: 'Autonomous Shell Controller',
    agentIntro:
      'Hello! I am your Educational OS Kernel Agent. You can ask me to "create a physics lesson and draw a circle on its whiteboard" and I will use the Command Bus to build it.',
    placeholder: 'e.g. Create a history lesson and draw a map...',
    dashboard: 'OS Dashboard',
    kernelRunning: 'Kernel Running',
    lessons: 'Lessons',
    noLessons: 'No lessons yet. Ask the Agent to create one!',
    noContent: 'No content...',
    whiteboardCanvas: 'Whiteboard Canvas',
    emptyWhiteboard: 'Empty Whiteboard',
    simulationError: 'Simulation Error: Failed to execute OS command.',
    executedCommands: 'Executed Commands: ',
    switchLang: '切换到中文',
    plugins: 'Plugin Center',
    uploadPlugin: 'Upload & Install Plugin',
    pluginSource: 'Extension Source Code (JS)',
    installPlugin: 'Validate & Install',
    installing: 'Installing...',
    installedPlugins: 'Running Plugins',
    noPlugins: 'No 3rd-party plugins found',
    lessonContent: 'Lesson Content & Notes',
    eventStream: 'Kernel Audit Event Stream',
    selectLesson: 'Please select a lesson from the left',
    systemLogs: 'System Logs',
    hideLogs: 'Hide Logs',
    showLogs: 'Show Logs',
    approvals: 'Pending Approvals',
    approve: 'Approve',
    reject: 'Reject',
    noApprovals: 'No pending commands',
    fileSystem: 'Virtual File System',
    noFiles: 'Directory is empty',
    processes: 'Process Manager',
    noProcesses: 'No active processes',
    processLogs: 'View Logs',
    classes: 'Classes',
    students: 'Students',
    noClasses: 'No classes found',
    noStudents: 'No students found',
    openInNewTab: 'Open in new tab',
  },
};

/**
 * 语言代码归一化（如 zh-CN -> zh, en-US -> en）
 */
export function normalizeLang(lang?: string | null): Language {
  if (!lang) return DEFAULT_LANGUAGE;
  const lower = lang.toLowerCase();
  if (lower.startsWith('en')) return 'en';
  return 'zh';
}

/** 插件语言包全局注册表: pluginId -> { lang -> { key: value } } */
const pluginLocalesRegistry = new Map<string, Record<string, Record<string, string>>>();

let currentGlobalLanguage: Language = 'zh';

/**
 * 注册插件语言包字典
 * @param pluginId 插件唯一标识符
 * @param locales 语言包字典，如 { zh: { "tab.title": "作业中心" }, en: { "tab.title": "Homework Hub" } }
 */
export function registerPluginLocales(pluginId: string, locales: Record<string, Record<string, string>>): void {
  if (!pluginId || !locales || typeof locales !== 'object') return;
  const normalized: Record<string, Record<string, string>> = {};
  for (const [langKey, dict] of Object.entries(locales)) {
    if (dict && typeof dict === 'object') {
      const targetLang = normalizeLang(langKey);
      normalized[targetLang] = { ...(normalized[targetLang] || {}), ...dict };
    }
  }
  const existing = pluginLocalesRegistry.get(pluginId) || {};
  pluginLocalesRegistry.set(pluginId, {
    ...existing,
    ...normalized,
    ...Object.fromEntries(Object.entries(normalized).map(([k, v]) => [k, { ...(existing[k] || {}), ...v }])),
  });
}

/**
 * 注销插件语言包
 */
export function unregisterPluginLocales(pluginId: string): void {
  pluginLocalesRegistry.delete(pluginId);
}

/**
 * 获取插件已注册的语言包
 */
export function getPluginLocales(pluginId: string): Record<string, Record<string, string>> | undefined {
  return pluginLocalesRegistry.get(pluginId);
}

/**
 * 清除所有插件语言包（主要用于测试）
 */
export function clearPluginLocales(): void {
  pluginLocalesRegistry.clear();
}

/**
 * 设置全局当前语言
 */
export function setGlobalLanguage(lang: Language): void {
  currentGlobalLanguage = normalizeLang(lang);
}

/**
 * 获取全局当前语言
 */
export function getGlobalLanguage(): Language {
  return currentGlobalLanguage;
}

/**
 * 参数插值: 将模板中的 {var} 替换为对应的值
 */
export function interpolate(template: string, params?: Record<string, any>): string {
  if (!template || !params) return template;
  return template.replace(/\{([^{}]+)\}/g, (match, key) => {
    const val = params[key.trim()];
    return val !== undefined && val !== null ? String(val) : match;
  });
}

/**
 * 友好格式化回退键名，杜绝裸键与内部路径泄露给终端用户 (Issue #64 / Issue #148 防御)
 * 例如:
 * "pptx.notes.title" -> "Notes Title"
 * "%tab.title%" -> "Tab Title"
 * "homework-hub:start_quiz" -> "Start Quiz"
 */
export function friendlyFormatKey(rawKey: string): string {
  if (!rawKey) return '';
  // 1. 去掉首尾的 %
  let key = rawKey.replace(/^%+|%+$/g, '').trim();
  // 2. 去掉插件 ID 命名空间前缀 (如 ext-foo:)
  if (key.includes(':')) {
    key = key.split(':').slice(1).join(':');
  }
  // 3. 针对点号分段的键 (如 pptx.notes.title -> 取最后两段或整段转化为大写单词)
  const segments = key.split('.').filter(Boolean);
  const targetSegment = segments.length > 1 ? segments.slice(-2).join(' ') : segments[0] || key;

  // 4. 将下划线、破折号转换为空格，并将每个单词首字母大写
  return (
    targetSegment
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') || rawKey
  );
}

export interface I18nTranslateOptions {
  defaultValue?: string;
  params?: Record<string, any>;
  lang?: Language;
}

/**
 * 核心翻译函数，支持带命名空间查找与级联回退:
 * 当前语言 -> 默认语言 (zh) -> defaultValue -> 友好格式化
 */
export function t(
  key: string,
  defaultValueOrParams?: string | Record<string, any>,
  maybeParams?: Record<string, any>,
  langOverride?: Language,
): string {
  let defaultValue: string | undefined;
  let params: Record<string, any> | undefined;
  let lang: Language = langOverride || currentGlobalLanguage;

  if (typeof defaultValueOrParams === 'string') {
    defaultValue = defaultValueOrParams;
    params = maybeParams;
  } else if (defaultValueOrParams && typeof defaultValueOrParams === 'object') {
    params = defaultValueOrParams;
    if (maybeParams && typeof maybeParams === 'object' && 'defaultValue' in maybeParams) {
      defaultValue = (maybeParams as any).defaultValue;
    }
  }

  const normalizedLang = normalizeLang(lang);
  const fallbackLang = DEFAULT_LANGUAGE;

  // 1. 检查是否带插件命名空间 (pluginId:key)
  if (key.includes(':')) {
    const colonIndex = key.indexOf(':');
    const pluginId = key.substring(0, colonIndex);
    const subKey = key.substring(colonIndex + 1);

    const pluginDicts = pluginLocalesRegistry.get(pluginId);
    if (pluginDicts) {
      // 当前语言
      if (pluginDicts[normalizedLang] && pluginDicts[normalizedLang][subKey] !== undefined) {
        return interpolate(pluginDicts[normalizedLang][subKey], params);
      }
      // 回退默认语言
      if (pluginDicts[fallbackLang] && pluginDicts[fallbackLang][subKey] !== undefined) {
        return interpolate(pluginDicts[fallbackLang][subKey], params);
      }
    }
  }

  // 2. 检查宿主基础词条
  if (baseTranslations[normalizedLang]?.[key] !== undefined) {
    return interpolate(baseTranslations[normalizedLang][key], params);
  }
  if (baseTranslations[fallbackLang]?.[key] !== undefined) {
    return interpolate(baseTranslations[fallbackLang][key], params);
  }

  // 3. 若未加命名空间，尝试遍历插件语言包寻找
  for (const [, dicts] of pluginLocalesRegistry) {
    if (dicts[normalizedLang]?.[key] !== undefined) {
      return interpolate(dicts[normalizedLang][key], params);
    }
    if (dicts[fallbackLang]?.[key] !== undefined) {
      return interpolate(dicts[fallbackLang][key], params);
    }
  }

  // 4. 未命中任何翻译，执行级联回退
  if (defaultValue !== undefined && defaultValue !== null) {
    return interpolate(defaultValue, params);
  }

  return friendlyFormatKey(key);
}

/**
 * 解析 UI 声明式国际化文案
 * 支持:
 * 1. %key% 格式 (VSCode 规范，自动从所属插件语言包或宿主查找当前语言词条)
 * 2. 纯字面量文本 (如 "物理仿真实验室"，直接原样返回)
 * 3. 命名空间键名 (如 "ext-chart:title")
 */
export function resolveLabel(label: string | undefined | null, pluginId?: string, lang?: Language): string {
  if (!label) return '';
  const str = String(label).trim();

  // 判断是否为 VSCode 样式的声明式国际化 %key%
  const isPercentFormat = /^%([\w.-]+)%$/.test(str);
  if (isPercentFormat) {
    const key = str.slice(1, -1);
    const targetLang = normalizeLang(lang || currentGlobalLanguage);
    const fallbackLang = DEFAULT_LANGUAGE;

    // 优先从对应插件的语言包中查找
    if (pluginId) {
      const dicts = pluginLocalesRegistry.get(pluginId);
      if (dicts) {
        if (dicts[targetLang]?.[key] !== undefined) {
          return dicts[targetLang][key];
        }
        if (dicts[fallbackLang]?.[key] !== undefined) {
          return dicts[fallbackLang][key];
        }
      }
    }

    // 尝试宿主词条
    if (baseTranslations[targetLang]?.[key] !== undefined) {
      return baseTranslations[targetLang][key];
    }
    if (baseTranslations[fallbackLang]?.[key] !== undefined) {
      return baseTranslations[fallbackLang][key];
    }

    // 若均未命中，友好格式化，严禁原样暴露裸键
    return friendlyFormatKey(key);
  }

  // 若显式包含插件命名空间 (pluginId:key)
  if (str.includes(':') && !str.includes(' ') && !str.includes('/')) {
    return t(str, undefined, undefined, lang);
  }

  // 否则属于字面量普通文本，原样返回
  return str;
}

/**
 * 兼容原有 translations[lang][key] 的直接访问
 */
export const translations = baseTranslations;
