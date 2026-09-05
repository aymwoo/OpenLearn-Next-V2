import React, { useState, useId } from 'react';
import {
  X,
  Palette,
  Sparkles,
  Download,
  Upload,
  Trash2,
  Check,
  RotateCcw,
  Sliders,
  Eye,
  Copy,
  BookOpen,
  Layers,
  Save,
} from 'lucide-react';
import { useThemeStore, type ThemeSpec, BUILTIN_THEME_TOKENS, getThemeTokens } from '../store/themeStore';

interface ThemeDesignerModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: 'zh' | 'en';
}

interface ThemePreset {
  id: string;
  label: string;
  description: string;
  tokens: Record<string, string>;
}

const PRESETS: ThemePreset[] = [
  {
    id: 'sapphire-classic',
    label: '高雅墨蓝',
    description: '深海午夜蓝灰与经典宝石蓝，适合沉浸式研究与高对比度投影',
    tokens: {
      '--bg-app': '#0d131f',
      '--bg-surface': '#161f30',
      '--bg-surface-secondary': '#1f2c42',
      '--bg-surface-elevated': '#24334d',
      '--border-theme': '#2e3f5b',
      '--border-theme-subtle': '#1f2c42',
      '--text-main': '#f1f5f9',
      '--text-muted': '#94a3b8',
      '--color-primary': '#3b82f6',
      '--color-primary-hover': '#2563eb',
    },
  },
  {
    id: 'sakura-dusk',
    label: '暮樱柔粉',
    description: '柔和日系樱花与温暖象牙白，适合美育、艺术与温馨研讨课堂',
    tokens: {
      '--bg-app': '#fff9fa',
      '--bg-surface': '#ffffff',
      '--bg-surface-secondary': '#fceef1',
      '--bg-surface-elevated': '#ffffff',
      '--border-theme': '#f5d5db',
      '--border-theme-subtle': '#fae8eb',
      '--text-main': '#3f2d33',
      '--text-muted': '#8a6d76',
      '--color-primary': '#f43f5e',
      '--color-primary-hover': '#e11d48',
    },
  },
  {
    id: 'autumn-amber',
    label: '复古秋叶',
    description: '温暖金秋落叶色调与复古羊皮纸质感，适合文科通识与阅读研讨',
    tokens: {
      '--bg-app': '#fdfaf6',
      '--bg-surface': '#ffffff',
      '--bg-surface-secondary': '#f5eee6',
      '--bg-surface-elevated': '#ffffff',
      '--border-theme': '#e6d7c3',
      '--border-theme-subtle': '#ede3d5',
      '--text-main': '#2d241e',
      '--text-muted': '#7c6a59',
      '--color-primary': '#d97706',
      '--color-primary-hover': '#b45309',
    },
  },
  {
    id: 'deep-sea-cyber',
    label: '深海极客',
    description: '赛博暗黑青绿冷光，极高现代感与未来科技探索质感',
    tokens: {
      '--bg-app': '#091014',
      '--bg-surface': '#0f1a20',
      '--bg-surface-secondary': '#16262e',
      '--bg-surface-elevated': '#1d333e',
      '--border-theme': '#25414e',
      '--border-theme-subtle': '#16262e',
      '--text-main': '#e0f2fe',
      '--text-muted': '#7dd3fc',
      '--color-primary': '#06b6d4',
      '--color-primary-hover': '#0891b2',
    },
  },
];

const DEFAULT_TOKENS = { ...BUILTIN_THEME_TOKENS.light };

export function ThemeDesignerModal({ isOpen, onClose, lang = 'zh' }: ThemeDesignerModalProps) {
  const { availableThemes, saveCustomTheme, deleteCustomTheme } = useThemeStore();
  const inputPrefix = useId();

  const [themeId, setThemeId] = useState('custom-mytheme');
  const [label, setLabel] = useState('我的专属主题');
  const [description, setDescription] = useState('自定义教学调色板配置');
  const [tokens, setTokens] = useState<Record<string, string>>({ ...DEFAULT_TOKENS });
  const [importExportMode, setImportExportMode] = useState<'none' | 'import' | 'export'>('none');
  const [jsonText, setJsonText] = useState('');
  const [copyStatus, setCopyStatus] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  if (!isOpen) return null;

  const customThemes = availableThemes.filter((t) => t.category === 'custom');

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleApplyPreset = (preset: ThemePreset) => {
    setThemeId(preset.id);
    setLabel(preset.label);
    setDescription(preset.description);
    setTokens({ ...preset.tokens });
    showNotification(`已载入预设: ${preset.label}`);
  };

  const handleLoadCustomTheme = (spec: ThemeSpec) => {
    setThemeId(spec.id);
    setLabel(spec.label);
    setDescription(spec.description);
    const loaded = getThemeTokens(spec.id);
    if (loaded && Object.keys(loaded).length > 0) {
      setTokens({ ...loaded });
    }
    showNotification(`已载入自定义主题: ${spec.label}`);
  };

  const handleUpdateToken = (tokenKey: string, value: string) => {
    setTokens((prev) => ({
      ...prev,
      [tokenKey]: value,
    }));
  };

  const handleSaveAndApply = () => {
    const cleanId = themeId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanId) {
      alert('请输入有效的主题标识 (ID)');
      return;
    }
    const spec: ThemeSpec = {
      id: cleanId,
      label: label.trim() || '未命名主题',
      description: description.trim() || '自定义主题',
      previewBg: tokens['--bg-app'] || '#ffffff',
      previewPrimary: tokens['--color-primary'] || '#4f46e5',
      category: 'custom',
    };
    saveCustomTheme(spec, tokens);
    showNotification(`主题「${spec.label}」已保存并成功激活！`);
  };

  const handleOpenExport = () => {
    const exportData = {
      version: '1.0',
      id: themeId,
      label,
      description,
      tokens,
    };
    setJsonText(JSON.stringify(exportData, null, 2));
    setImportExportMode('export');
  };

  const handleOpenImport = () => {
    setJsonText('');
    setImportExportMode('import');
  };

  const handleDoImport = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed.tokens || typeof parsed.tokens !== 'object') {
        throw new Error('缺少合法的 tokens 字段');
      }
      if (parsed.id) setThemeId(parsed.id);
      if (parsed.label) setLabel(parsed.label);
      if (parsed.description) setDescription(parsed.description);
      setTokens((prev) => ({
        ...prev,
        ...parsed.tokens,
      }));
      setImportExportMode('none');
      showNotification('主题配置导入成功！');
    } catch (err: any) {
      alert(`导入失败: ${err.message || 'JSON 格式解析错误'}`);
    }
  };

  const handleCopyExportJson = () => {
    navigator.clipboard.writeText(jsonText);
    setCopyStatus(true);
    setTimeout(() => setCopyStatus(false), 2000);
  };

  const tokenFields: { key: string; labelZh: string; labelEn: string; desc: string }[] = [
    { key: '--color-primary', labelZh: '核心主色', labelEn: 'Primary Brand Color', desc: '按钮高亮、焦点描边与重点图标' },
    { key: '--color-primary-hover', labelZh: '主色悬浮', labelEn: 'Primary Hover', desc: '按钮悬停交互色' },
    { key: '--bg-app', labelZh: '全局底色', labelEn: 'App Background', desc: '页面整体底衬颜色' },
    { key: '--bg-surface', labelZh: '卡片底色', labelEn: 'Surface Background', desc: '白板卡片、浮层与侧边栏底色' },
    { key: '--bg-surface-secondary', labelZh: '次级底色', labelEn: 'Secondary Surface', desc: '表格斑马纹、标签与次级面板' },
    { key: '--bg-surface-elevated', labelZh: '浮层底色', labelEn: 'Elevated Surface', desc: '弹窗与下拉菜单浮动卡片' },
    { key: '--border-theme', labelZh: '主边框色', labelEn: 'Border Color', desc: '卡片外边框、网格分割线' },
    { key: '--border-theme-subtle', labelZh: '弱化边框', labelEn: 'Subtle Border', desc: '细微内部分割线' },
    { key: '--text-main', labelZh: '主文本色', labelEn: 'Main Text', desc: '正文文字、标题' },
    { key: '--text-muted', labelZh: '弱化文本', labelEn: 'Muted Text', desc: '副标题、辅助信息与提示说明' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-surface text-main border border-theme rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] max-h-[900px] flex flex-col overflow-hidden relative">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-theme shrink-0 bg-surface">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-theme/10 rounded-xl text-primary-theme">
              <Palette size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2 text-main">
                {lang === 'zh' ? '主题可视化设计器' : 'Theme Visual Designer'}
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary-theme/10 text-primary-theme font-medium">
                  v0.3.0
                </span>
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {lang === 'zh'
                  ? '自定义课堂交互色盘，支持一键载入创意预设、实时拟真沙箱预览与微前端自动同步'
                  : 'Customize learning palettes with live previews, creative presets, and micro-frontend sync'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenImport}
              className="px-3 py-1.5 rounded-lg border border-theme text-xs font-medium hover:bg-surface-secondary text-main transition-colors flex items-center gap-1.5 cursor-pointer"
              title="导入 JSON"
            >
              <Upload size={14} />
              {lang === 'zh' ? '导入配置' : 'Import'}
            </button>
            <button
              onClick={handleOpenExport}
              className="px-3 py-1.5 rounded-lg border border-theme text-xs font-medium hover:bg-surface-secondary text-main transition-colors flex items-center gap-1.5 cursor-pointer"
              title="导出 JSON"
            >
              <Download size={14} />
              {lang === 'zh' ? '导出配置' : 'Export'}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-muted hover:text-main hover:bg-surface-secondary transition-colors cursor-pointer ml-1"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 浮动操作提示条 */}
        {notification && (
          <div className="absolute top-18 left-1/2 -translate-x-1/2 z-50 bg-primary-theme text-white px-4 py-2 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
            <Check size={14} />
            {notification}
          </div>
        )}

        {/* 主体两栏布局 */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* 左侧配置栏 (滚动) */}
          <div className="w-full md:w-1/2 border-r border-theme overflow-y-auto p-6 space-y-6">
            {/* 1. 创意预设快捷选择 */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Sparkles size={14} className="text-amber-500" />
                  {lang === 'zh' ? '创意预设配色' : 'Creative Presets'}
                </label>
                <span className="text-2xs text-muted">一键填入调色板</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleApplyPreset(preset)}
                    className="flex flex-col p-3 rounded-xl border border-theme hover:border-primary-theme/50 hover:bg-surface-secondary text-left transition-all cursor-pointer group relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="font-semibold text-xs text-main flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full border border-black/10 shrink-0"
                          style={{ backgroundColor: preset.tokens['--color-primary'] }}
                        />
                        {preset.label}
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className="w-2.5 h-2.5 rounded-xs"
                          style={{ backgroundColor: preset.tokens['--bg-app'] }}
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-xs"
                          style={{ backgroundColor: preset.tokens['--bg-surface'] }}
                        />
                      </div>
                    </div>
                    <p className="text-3xs text-muted mt-1.5 line-clamp-2 leading-relaxed opacity-85">
                      {preset.description}
                    </p>
                  </button>
                ))}
              </div>
            </section>

            {/* 2. 基本信息 */}
            <section className="space-y-3 pt-2 border-t border-theme-subtle">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                <Sliders size={14} className="text-primary-theme" />
                {lang === 'zh' ? '主题基础信息' : 'Theme Metadata'}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${inputPrefix}-themeId`} className="block text-2xs font-medium text-muted mb-1">
                    主题标识 (ID)
                  </label>
                  <input
                    id={`${inputPrefix}-themeId`}
                    type="text"
                    value={themeId}
                    onChange={(e) => setThemeId(e.target.value)}
                    placeholder="custom-mytheme"
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-theme bg-surface-secondary text-main focus:outline-none focus:ring-1 focus:ring-primary-theme"
                  />
                </div>
                <div>
                  <label htmlFor={`${inputPrefix}-label`} className="block text-2xs font-medium text-muted mb-1">
                    主题名称
                  </label>
                  <input
                    id={`${inputPrefix}-label`}
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="我的专属主题"
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-theme bg-surface-secondary text-main focus:outline-none focus:ring-1 focus:ring-primary-theme"
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`${inputPrefix}-description`} className="block text-2xs font-medium text-muted mb-1">
                  主题描述
                </label>
                <input
                  id={`${inputPrefix}-description`}
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="针对特定课堂采光与演示场景优化"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-theme bg-surface-secondary text-main focus:outline-none focus:ring-1 focus:ring-primary-theme"
                />
              </div>
            </section>

            {/* 3. 调色盘明细项 */}
            <section className="space-y-3 pt-2 border-t border-theme-subtle">
              <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                <Palette size={14} className="text-primary-theme" />
                {lang === 'zh' ? '色彩变量调节 (Design Tokens)' : 'CSS Variables Token Tuning'}
              </label>
              <div className="space-y-2.5">
                {tokenFields.map((field) => {
                  const val = tokens[field.key] || '#000000';
                  return (
                    <div
                      key={field.key}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-theme hover:bg-surface-secondary/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-main">{field.labelZh}</span>
                          <span className="text-3xs font-mono text-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                            {field.key}
                          </span>
                        </div>
                        <p className="text-3xs text-muted mt-0.5">{field.desc}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="relative flex items-center">
                          <input
                            type="color"
                            value={val.startsWith('#') && val.length === 7 ? val : '#4f46e5'}
                            onChange={(e) => handleUpdateToken(field.key, e.target.value)}
                            className="w-8 h-8 rounded-lg cursor-pointer border border-theme p-0.5 bg-surface"
                            title="打开系统拾色器"
                          />
                        </div>
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => handleUpdateToken(field.key, e.target.value)}
                          className="w-20 px-2 py-1 text-xs font-mono rounded-lg border border-theme bg-surface text-main text-center focus:outline-none focus:ring-1 focus:ring-primary-theme"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 4. 已保存的自定义主题 */}
            {customThemes.length > 0 && (
              <section className="space-y-3 pt-2 border-t border-theme-subtle">
                <label className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Layers size={14} className="text-primary-theme" />
                  {lang === 'zh' ? '已创建的自定义主题' : 'Saved Custom Themes'}
                </label>
                <div className="space-y-2">
                  {customThemes.map((ct) => (
                    <div
                      key={ct.id}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-theme bg-surface-secondary/30"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                          style={{ backgroundColor: ct.previewPrimary }}
                        />
                        <div className="truncate">
                          <div className="text-xs font-semibold text-main truncate">{ct.label}</div>
                          <div className="text-3xs text-muted truncate">{ct.description}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <button
                          onClick={() => handleLoadCustomTheme(ct)}
                          className="px-2 py-1 text-2xs rounded-md bg-surface border border-theme hover:bg-surface-secondary text-main transition-colors cursor-pointer"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`确定删除自定义主题「${ct.label}」吗？`)) {
                              deleteCustomTheme(ct.id);
                              showNotification(`已删除主题「${ct.label}」`);
                            }
                          }}
                          className="p-1 text-muted hover:text-red-500 rounded-md transition-colors cursor-pointer"
                          title="删除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* 右侧实时拟真预览区 */}
          <div className="w-full md:w-1/2 flex flex-col p-6 bg-surface-secondary/30 overflow-y-auto">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
                <Eye size={14} className="text-primary-theme" />
                {lang === 'zh' ? '拟真沙盒视口 (Live Sandbox)' : 'Live Sandbox Preview'}
              </div>
              <span className="text-2xs text-muted font-mono">
                当前预览: {label} ({themeId})
              </span>
            </div>

            {/* 拟真沙箱容器，直接应用动态 inline tokens */}
            <div
              className="flex-1 rounded-2xl border shadow-inner overflow-hidden flex flex-col transition-colors duration-200"
              style={{
                backgroundColor: tokens['--bg-app'] || '#f8fafc',
                borderColor: tokens['--border-theme'] || '#e2e8f0',
                color: tokens['--text-main'] || '#0f172a',
              }}
            >
              {/* 模拟顶栏 */}
              <div
                className="h-12 border-b px-4 flex items-center justify-between shrink-0"
                style={{
                  backgroundColor: tokens['--bg-surface'] || '#ffffff',
                  borderColor: tokens['--border-theme'] || '#e2e8f0',
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-white text-xs"
                    style={{ backgroundColor: tokens['--color-primary'] || '#4f46e5' }}
                  >
                    OL
                  </div>
                  <span className="font-bold text-xs" style={{ color: tokens['--text-main'] }}>
                    OpenLearn V2
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="text-3xs px-2 py-0.5 rounded-md font-mono"
                    style={{
                      backgroundColor: tokens['--bg-surface-secondary'] || '#f1f5f9',
                      color: tokens['--text-muted'] || '#64748b',
                    }}
                  >
                    10:30:00
                  </div>
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-3xs font-bold text-white"
                    style={{ backgroundColor: tokens['--color-primary'] || '#4f46e5' }}
                  >
                    T
                  </div>
                </div>
              </div>

              {/* 模拟教学内容区 */}
              <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                {/* 教学看板卡片 */}
                <div
                  className="p-4 rounded-xl border shadow-xs space-y-3"
                  style={{
                    backgroundColor: tokens['--bg-surface'] || '#ffffff',
                    borderColor: tokens['--border-theme'] || '#e2e8f0',
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-sm" style={{ color: tokens['--text-main'] }}>
                        高中物理实验探究：机械能守恒定律
                      </h4>
                      <p className="text-xs mt-1" style={{ color: tokens['--text-muted'] }}>
                        DIS 光电门传感器毫秒级数据回传与曲线拟合分析
                      </p>
                    </div>
                    <span
                      className="text-3xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: tokens['--bg-surface-secondary'],
                        color: tokens['--color-primary'],
                        border: `1px solid ${tokens['--border-theme']}`,
                      }}
                    >
                      进行中
                    </span>
                  </div>

                  {/* 模拟数据指标格 */}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: tokens['--bg-surface-secondary'] }}
                    >
                      <div className="text-3xs" style={{ color: tokens['--text-muted'] }}>
                        光电门测速 (v)
                      </div>
                      <div
                        className="text-sm font-bold font-mono mt-0.5"
                        style={{ color: tokens['--text-main'] }}
                      >
                        2.43 m/s
                      </div>
                    </div>
                    <div
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: tokens['--bg-surface-secondary'] }}
                    >
                      <div className="text-3xs" style={{ color: tokens['--text-muted'] }}>
                        动能增量 (ΔEk)
                      </div>
                      <div
                        className="text-sm font-bold font-mono mt-0.5"
                        style={{ color: tokens['--color-primary'] }}
                      >
                        0.589 J
                      </div>
                    </div>
                    <div
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: tokens['--bg-surface-secondary'] }}
                    >
                      <div className="text-3xs" style={{ color: tokens['--text-muted'] }}>
                        误差率 (Err)
                      </div>
                      <div
                        className="text-sm font-bold font-mono mt-0.5"
                        style={{ color: tokens['--text-main'] }}
                      >
                        0.84 %
                      </div>
                    </div>
                  </div>

                  {/* 模拟操作按钮群 */}
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-xs transition-opacity hover:opacity-90 cursor-pointer"
                      style={{ backgroundColor: tokens['--color-primary'] || '#4f46e5' }}
                    >
                      开始数据采集
                    </button>
                    <button
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer"
                      style={{
                        backgroundColor: tokens['--bg-surface-elevated'] || '#ffffff',
                        borderColor: tokens['--border-theme'] || '#e2e8f0',
                        color: tokens['--text-main'] || '#0f172a',
                      }}
                    >
                      重置实验
                    </button>
                    <button
                      className="px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                      style={{ color: tokens['--text-muted'] }}
                    >
                      查看教案
                    </button>
                  </div>
                </div>

                {/* 模拟白板画板预览 */}
                <div
                  className="p-3 rounded-xl border space-y-2"
                  style={{
                    backgroundColor: tokens['--bg-surface-elevated'] || '#ffffff',
                    borderColor: tokens['--border-theme-subtle'] || '#f1f5f9',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-2xs font-semibold" style={{ color: tokens['--text-main'] }}>
                      互动白板区域 (Whiteboard Canvas)
                    </span>
                    <span className="text-3xs font-mono" style={{ color: tokens['--text-muted'] }}>
                      60 FPS
                    </span>
                  </div>
                  <div
                    className="h-28 rounded-lg border border-dashed flex items-center justify-center p-3 relative overflow-hidden"
                    style={{
                      backgroundColor: tokens['--bg-app'],
                      borderColor: tokens['--border-theme'],
                    }}
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold shadow-md transform -rotate-6"
                      style={{ backgroundColor: tokens['--color-primary'] }}
                    >
                      <BookOpen size={20} />
                    </div>
                    <div
                      className="absolute bottom-2 right-2 text-3xs font-mono px-1.5 py-0.5 rounded border"
                      style={{
                        backgroundColor: tokens['--bg-surface'],
                        borderColor: tokens['--border-theme'],
                        color: tokens['--text-muted'],
                      }}
                    >
                      iframe Bridge Sync Ready
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部保存与操作栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-theme shrink-0 bg-surface">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setTokens({ ...DEFAULT_TOKENS });
                showNotification('已重置为系统默认调色板');
              }}
              className="px-3 py-1.5 rounded-lg border border-theme text-xs font-medium hover:bg-surface-secondary text-main transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw size={14} />
              {lang === 'zh' ? '重置默认' : 'Reset Defaults'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-theme text-xs font-medium hover:bg-surface-secondary text-main transition-colors cursor-pointer"
            >
              {lang === 'zh' ? '关闭' : 'Close'}
            </button>
            <button
              onClick={handleSaveAndApply}
              className="px-5 py-2 rounded-xl bg-primary-theme text-white text-xs font-semibold shadow-sm hover:opacity-95 transition-opacity flex items-center gap-1.5 cursor-pointer"
            >
              <Save size={15} />
              {lang === 'zh' ? '保存并激活主题' : 'Save & Activate Theme'}
            </button>
          </div>
        </div>

        {/* 导入 / 导出弹窗 */}
        {importExportMode !== 'none' && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-6 z-50 animate-in fade-in duration-100">
            <div className="bg-surface border border-theme rounded-2xl p-5 w-full max-w-lg shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-main flex items-center gap-2">
                  {importExportMode === 'export' ? (
                    <>
                      <Download size={16} className="text-primary-theme" />
                      {lang === 'zh' ? '导出主题配置 JSON' : 'Export Theme JSON'}
                    </>
                  ) : (
                    <>
                      <Upload size={16} className="text-primary-theme" />
                      {lang === 'zh' ? '导入主题配置 JSON' : 'Import Theme JSON'}
                    </>
                  )}
                </h3>
                <button
                  onClick={() => setImportExportMode('none')}
                  className="p-1 rounded-md text-muted hover:text-main cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div>
                <textarea
                  value={jsonText}
                  readOnly={importExportMode === 'export'}
                  onChange={(e) => setJsonText(e.target.value)}
                  placeholder={importExportMode === 'import' ? '请在此粘贴主题导出的 JSON 字符串...' : ''}
                  rows={10}
                  className="w-full p-3 font-mono text-2xs rounded-xl border border-theme bg-surface-secondary text-main focus:outline-none focus:ring-1 focus:ring-primary-theme resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                {importExportMode === 'export' ? (
                  <>
                    <button
                      onClick={handleCopyExportJson}
                      className="px-4 py-1.5 rounded-lg bg-primary-theme text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                    >
                      {copyStatus ? <Check size={14} /> : <Copy size={14} />}
                      {copyStatus ? (lang === 'zh' ? '已复制' : 'Copied') : lang === 'zh' ? '复制到剪贴板' : 'Copy'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setImportExportMode('none')}
                      className="px-3 py-1.5 rounded-lg border border-theme text-xs font-medium hover:bg-surface-secondary text-main cursor-pointer"
                    >
                      {lang === 'zh' ? '取消' : 'Cancel'}
                    </button>
                    <button
                      onClick={handleDoImport}
                      className="px-4 py-1.5 rounded-lg bg-primary-theme text-white text-xs font-medium cursor-pointer"
                    >
                      {lang === 'zh' ? '解析并导入' : 'Parse & Import'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
