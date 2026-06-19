/**
 * PluginCenter — extracted plugin management UI (Discover + Developer tabs).
 *
 * Extracted from App.tsx lines 6295-6757 with zero visual delta per UI-SPEC.
 * Same class names, icons, structure — visually identical to the original.
 *
 * Props match the original App.tsx state and handlers.
 */

import React from 'react';
import {
  Puzzle,
  Blocks,
  Code,
  ShieldAlert,
  Upload,
  Wand2,
  Sparkles,
  Loader2,
  CheckCircle2,
  Shield,
  Terminal,
  PenTool,
  Eye,
  Users,
  Database,
  AlertTriangle,
  X,
} from 'lucide-react';
import { LegacyPluginBadge } from './LegacyPluginBadge';
import type { Language } from '../i18n';
import JSZip from 'jszip';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PluginType {
  id: string;
  name: string;
  status: string;
  created_at: number;
  manifest: string;
  execution_mode?: string;
}

interface ParsedManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  capabilitiesProposed?: string[];
}

interface ParsedAction {
  id: string;
  commandType: string;
  description?: string;
}

export interface PluginCenterProps {
  plugins: PluginType[];
  lang: Language;
  storeTab: 'store' | 'widgets' | 'dev';
  setStoreTab: (tab: 'store' | 'widgets' | 'dev') => void;
  pluginCode: string;
  setPluginCode: (code: string) => void;
  installingPlugin: boolean;
  onInstall: () => void;
  onZipUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

// ── Capability Info (moved from App.tsx) ─────────────────────────────────────

const CAPABILITY_INFO: Record<string, {
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
    risk: 'medium',
    riskDescZh: '中风险：允许插件在授课白板上自由擦写、增删几何教具和课件图形，会实时推送或改变所有在线学员的画板视图。',
    riskDescEn: 'Medium Risk: Authorizes the plugin to draw, erase, or alter whiteboard elements, live-syncing to all classroom attendees.',
  },
  'whiteboard:read': {
    labelZh: '读取白板元素图层',
    labelEn: 'Whiteboard Read Access',
    iconName: 'Eye',
    risk: 'low',
    riskDescZh: '低风险：仅读取白板当前的静态图形元素，用于做辅助的数据联动分析或内容导出。',
    riskDescEn: 'Low Risk: Read active static vectors or quiz properties from the blackboard without modification.',
  },
  'management:read': {
    labelZh: '读取教务学员名册',
    labelEn: 'School Directory Read',
    iconName: 'Users',
    risk: 'medium',
    riskDescZh: '中风险：允许插件遍历读取班级下的学生姓名、登录邮箱等档案信息（如在做点名提问筛选时）。',
    riskDescEn: 'Medium Risk: Allows retrieving list of enrolled students, email profiles, or attendance history.',
  },
  'management:write': {
    labelZh: '修改教务核心档案',
    labelEn: 'School Directory Write',
    iconName: 'Database',
    risk: 'high',
    riskDescZh: '高风险：强力权限！允许插件创建、编辑或彻底抹除班级列表、学生个人账号、授课日志及考勤成绩等多项核心教务系统档案。',
    riskDescEn: 'High Risk: Critical! Grants ability to modify academic profiles, drop students, change registers, or log grade-sheets.',
  },
};

// ── Plugin Source Parser (moved from App.tsx) ────────────────────────────────

const parsePluginSource = (sourceCode: string) => {
  let manifest: ParsedManifest | null = null;
  const actions: ParsedAction[] = [];

  try {
    const cleanCode = sourceCode
      .replace(/require\s*\(.*?\)/g, '{}')
      .replace(/import\s+.*?\s+from\s*['"].*?['"]/g, '');

    try {
      const runner = new Function('exports', `
        try {
          ${cleanCode};
          exports.default = exports.default || exports;
        } catch(e) {}
      `);
      const mockExports = {} as any;
      runner(mockExports);
      const evaluated = mockExports.default || mockExports;
      if (evaluated && evaluated.manifest) {
        manifest = evaluated.manifest;
      }
    } catch (e: any) {
      // Ignore evaluation error, fallback to regex
    }

    const idMatch = sourceCode.match(/id\s*:\s*['"]([^'"]+)['"]/);
    const nameMatch = sourceCode.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const verMatch = sourceCode.match(/version\s*:\s*['"]([^'"]+)['"]/);
    const descMatch = sourceCode.match(/description\s*:\s*['"]([^'"]+)['"]/);
    const authorMatch = sourceCode.match(/author\s*:\s*['"]([^'"]+)['"]/);

    let capabilities: string[] = [];
    const capsMatch = sourceCode.match(/capabilitiesProposed\s*:\s*\[([\s\S]*?)\]/);
    if (capsMatch) {
      capabilities = capsMatch[1]
        .split(',')
        .map(s => s.replace(/['"\s]/g, ''))
        .filter(s => s.length > 0);
    }

    manifest = manifest || {
      id: idMatch?.[1],
      name: nameMatch?.[1],
      version: verMatch?.[1],
      description: descMatch?.[1],
      author: authorMatch?.[1],
      capabilitiesProposed: capabilities,
    };

    // Parse actions from code
    const actionMatches = sourceCode.matchAll(/actionRegistry\.register\(\{([\s\S]*?)\}\)/g);
    for (const match of actionMatches) {
      const block = match[1];
      const aId = block.match(/id\s*:\s*['"]([^'"]+)['"]/)?.[1];
      const aCmdType = block.match(/commandType\s*:\s*['"]([^'"]+)['"]/)?.[1];
      const aDesc = block.match(/description\s*:\s*['"]([^'"]+)['"]/)?.[1];
      if (aId && aCmdType) {
        actions.push({ id: aId, commandType: aCmdType, description: aDesc });
      }
    }
  } catch (e) {
    console.warn('Failed to parse plugin source:', e);
  }

  return { manifest: manifest || undefined, actions };
};

// ── DEFAULT_PLUGIN (moved from App.tsx) ─────────────────────────────────────

const DEFAULT_PLUGIN = `exports.default = {
  manifest: {
    id: "ext-quiz-generator",
    name: "Quiz Component Plugin",
    version: "1.0.0",
    capabilitiesProposed: ["quiz:write"]
  },
  activate: async (ctx) => {
    ctx.actionRegistry.register({
      id: 'ext-quiz-create',
      commandType: 'quiz.create',
      description: 'Create a multiple-choice quiz on the whiteboard for a lesson',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING' },
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['lessonId', 'question', 'options']
      }
    });

    ctx.commandBus.registerHandler('quiz.create', {
      execute: async (command) => {
        const payload = command.payload;
        const result = await ctx.commandBus.execute({
          id: Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          payload: {
            lessonId: payload.lessonId,
            type: 'quiz',
            data: JSON.stringify({ question: payload.question, options: payload.options })
          }
        });
        return { elementId: result.elementId };
      }
    });
  }
};`;

// ── Component ───────────────────────────────────────────────────────────────

export function PluginCenter({
  plugins,
  lang,
  storeTab,
  setStoreTab,
  pluginCode,
  setPluginCode,
  installingPlugin,
  onInstall,
  onZipUpload,
  onToggle,
  onDelete,
}: PluginCenterProps) {
  // ── Local state ──────────────────────────────────────────────────────────

  const [dismissMigration, setDismissMigration] = React.useState(false);
  const [zipPreview, setZipPreview] = React.useState<{ name: string; id: string; version: string } | null>(null);
  const [zipProcessing, setZipProcessing] = React.useState(false);
  const [zipError, setZipError] = React.useState<string | null>(null);

  // ── ZIP drop zone handler ─────────────────────────────────────────────────

  const handleZipDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleZipFileForPreview(files[0]);
    }
  };

  // ── ZIP manifest preview with jszip ──────────────────────────────────────

  const handleZipFileForPreview = async (file: File) => {
    setZipProcessing(true);
    setZipError(null);
    setZipPreview(null);
    try {
      const zip = await JSZip.loadAsync(file);
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        setZipError(lang === 'zh' ? 'ZIP 文件中未找到 manifest.json' : 'No manifest.json found in ZIP');
        setZipProcessing(false);
        return;
      }
      const content = await manifestFile.async('string');
      const manifest = JSON.parse(content);
      if (!manifest.id || !manifest.name) {
        setZipError(lang === 'zh' ? 'manifest.json 缺少 id 或 name 字段' : 'manifest.json missing id or name');
        setZipProcessing(false);
        return;
      }
      setZipPreview({ name: manifest.name, id: manifest.id, version: manifest.version || '1.0.0' });
      setZipProcessing(false);
    } catch (err: any) {
      setZipError(lang === 'zh' ? 'ZIP 文件解析失败，请确认文件包含有效的 manifest.json' : 'Failed to parse ZIP file. Ensure the package contains a valid manifest.json.');
      setZipProcessing(false);
    }
  };

  // ── ZIP upload change handler with preview ───────────────────────────────

  const handleZipInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleZipFileForPreview(file);
    }
    // Pass through to parent's onZipUpload
    onZipUpload(e);
  };

  // ── MigrationPrompt component ────────────────────────────────────────────

  const hasLegacyPlugins = plugins.some(p => p.execution_mode === 'legacy');

  function MigrationPromptBanner() {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start justify-between mb-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-amber-800">
              {lang === 'zh' ? '发现可迁移的旧格式插件' : 'Legacy Plugin Detected'}
            </h4>
            <p className="text-xs text-amber-700 mt-1">
              {lang === 'zh'
                ? '该插件使用旧格式运行。上传新格式 ZIP 包以完成迁移，迁移后旧版本可安全卸载。'
                : 'This plugin runs in legacy mode. Upload a new-format ZIP package to migrate. The old version can be safely uninstalled afterwards.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => document.getElementById('zip-plugin-uploader')?.click()}
            className="bg-amber-600 text-white hover:bg-amber-700 rounded-lg text-sm font-medium px-4 py-2 transition-colors"
          >
            {lang === 'zh' ? '迁移到新格式' : 'Migrate to New Format'}
          </button>
          <button
            onClick={() => setDismissMigration(true)}
            className="text-amber-500 hover:text-amber-700 p-1"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto">
      {/* App Store Module */}
      <div className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow flex flex-col overflow-hidden h-full">
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 bg-gray-50/50 shrink-0">
          <div className="flex items-center gap-6">
            <h2 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
              <Puzzle size={20} className="text-indigo-600" />
              Edu OS App Store
            </h2>
            <div className="flex bg-gray-200/50 p-1 rounded-lg">
              <button
                onClick={() => setStoreTab('store')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  storeTab === 'store'
                    ? 'bg-white shadow text-indigo-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Discover
              </button>
              <button
                onClick={() => setStoreTab('dev')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1 ${
                  storeTab === 'dev'
                    ? 'bg-white shadow text-indigo-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Code size={14} /> Developer
              </button>
            </div>
          </div>
        </div>

        {storeTab === 'store' ? (
          <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-4 gap-4">
              {plugins.map((plugin) => {
                let manifestInfo = {
                  description: 'Custom plugin extending Edu OS capabilities.',
                  author: 'Community',
                };
                try {
                  const parsed = JSON.parse(plugin.manifest);
                  if (parsed.description) manifestInfo.description = parsed.description;
                  if (parsed.author) manifestInfo.author = parsed.author;
                } catch (e) {
                  // ignore parse error
                }

                return (
                  <div
                    key={plugin.id}
                    className={`bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group flex flex-col justify-between ${
                      plugin.status !== 'active' ? 'opacity-80' : ''
                    }`}
                  >
                    <div className="absolute top-0 right-0 p-3 flex items-center gap-1">
                      <span
                        className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider ${
                          plugin.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {plugin.status}
                      </span>
                      {/* Phase 9: Legacy badge */}
                      {(plugin as any).execution_mode === 'legacy' && (
                        <LegacyPluginBadge lang={lang} />
                      )}
                    </div>
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center mb-4 border border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                      <Blocks size={24} />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 mb-1 line-clamp-1">
                        {plugin.name}
                      </h4>
                      <p className="text-sm text-gray-500 mb-4 line-clamp-2">
                        {manifestInfo.description}
                      </p>
                    </div>
                    <div className="flex items-center justify-between shrink-0">
                      <span className="text-xs font-medium text-gray-400">
                        By {manifestInfo.author}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => onToggle(plugin.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            plugin.status === 'active'
                              ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                              : 'bg-green-50 text-green-600 hover:bg-green-100'
                          }`}
                        >
                          {plugin.status === 'active'
                            ? lang === 'zh'
                              ? '禁用'
                              : 'Disable'
                            : lang === 'zh'
                              ? '启用'
                              : 'Enable'}
                        </button>
                        <button
                          onClick={() => onDelete(plugin.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                        >
                          {lang === 'zh' ? '删除' : 'Delete'}
                        </button>
                        {plugin.execution_mode === 'legacy' && (
                          <button
                            onClick={() => document.getElementById('zip-plugin-uploader')?.click()}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                            title={lang === 'zh' ? '上传新格式 ZIP 包以完成迁移' : 'Upload new-format ZIP package to migrate'}
                          >
                            {lang === 'zh' ? '迁移' : 'Migrate'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Add static placeholders to fill grid */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group flex flex-col justify-between">
                <div className="absolute top-0 right-0 p-3">
                  <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">
                    Featured
                  </span>
                </div>
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center mb-4 border border-blue-100 group-hover:bg-blue-600 group-hover:text-white transition-colors shrink-0">
                  <Puzzle size={24} />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 mb-1">
                    Quiz Component
                  </h4>
                  <p className="text-sm text-gray-500 mb-4 line-clamp-2">
                    Drop a multiple-choice quiz onto the whiteboard. Agent
                    supported capabilities.
                  </p>
                </div>
                <div className="flex items-center justify-between shrink-0">
                  <span className="text-xs font-medium text-gray-400">
                    Community
                  </span>
                  <button
                    onClick={() => setStoreTab('dev')}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 hover:shadow-sm transition-all focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                  >
                    Add via Dev
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
            <div className="p-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-amber-400" />
                <div>
                  <p className="text-xs font-semibold text-gray-200">
                    {lang === 'zh'
                      ? '开发者工具: 插件旁路加载与实时 Manifest 校验'
                      : 'Developer Tools: Plugin Sideloading & Real-time Manifest Validation'}
                  </p>
                  <p className="text-[10px] text-gray-505">
                    {lang === 'zh'
                      ? '在安装前系统将进行解析、安全授权与注册接口预览机制'
                      : 'Parse metadata, proposed permissions, and registered triggers before installation'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept=".zip"
                  id="zip-plugin-uploader"
                  className="hidden"
                  onChange={handleZipInputChange}
                />
                {/* Phase 9: Enhanced ZIP drop zone with processing/preview states */}
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors relative ${
                    zipError
                      ? 'border-red-400 bg-red-50/10'
                      : zipPreview
                        ? 'border-emerald-400 bg-emerald-50/10'
                        : zipProcessing
                          ? 'border-indigo-400 bg-indigo-50/20'
                          : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/50'
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-50/50');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50');
                  }}
                  onDrop={handleZipDrop}
                  onClick={() => {
                    setZipError(null);
                    setZipPreview(null);
                    document.getElementById('zip-plugin-uploader')?.click();
                  }}
                >
                  {zipProcessing ? (
                    <div className="text-center">
                      <Loader2 size={32} className="mx-auto text-indigo-400 mb-2 animate-spin" />
                      <p className="text-sm text-gray-400">
                        {lang === 'zh' ? '分析中...' : 'Analyzing...'}
                      </p>
                    </div>
                  ) : zipPreview ? (
                    <div className="text-center">
                      <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
                      <p className="text-sm text-emerald-400 font-semibold mb-1">{zipPreview.name}</p>
                      <p className="text-xs text-gray-500 font-mono">{zipPreview.id} <span className="text-gray-600">v{zipPreview.version}</span></p>
                      <p className="text-xs text-gray-500 mt-1">
                        {lang === 'zh' ? '点击选择其他文件' : 'Click to select another file'}
                      </p>
                    </div>
                  ) : zipError ? (
                    <div className="text-center">
                      <ShieldAlert size={32} className="mx-auto text-red-400 mb-2" />
                      <p className="text-sm text-red-400">{zipError}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {lang === 'zh' ? '点击重新选择' : 'Click to retry'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                      <p className="text-sm text-gray-500">
                        {lang === 'zh' ? '拖拽 ZIP 文件到此处' : 'Drop ZIP file here'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {lang === 'zh'
                          ? '仅支持 .zip 格式的插件包'
                          : '.zip plugin packages only'}
                      </p>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setPluginCode(DEFAULT_PLUGIN)}
                  className="px-2.5 py-1 text-[10px] uppercase font-bold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                  title="Reset to default multi-choice quiz generator example"
                >
                  <Wand2 size={11} className="text-indigo-450" />
                  {lang === 'zh' ? '示例：智能测验生成器' : 'Quiz Sample'}
                </button>
                <button
                  onClick={() => {
                    setPluginCode(`exports.default = {
  manifest: {
    id: "ext-roll-call",
    name: "Random Student Picker (随机点名小工具)",
    version: "1.0.0",
    description: "可在授课白板上直接拖拽出的互动随机点名板，对课堂提问并同步点名记录至交互画板大有裨益。",
    author: "CoreOS Team",
    capabilitiesProposed: ["whiteboard:write", "management:read"]
  },
  activate: async (ctx) => {
    ctx.actionRegistry.register({
      id: 'ext-rollcall-pick',
      commandType: 'rollcall.pick',
      description: '从班级中随机抽取一名学生进行课堂提问/点名，并投射到交互画板上',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID (必传，提取名册)' },
          lessonId: { type: 'STRING', description: '关联课时 ID (将点名效果同步投射到该课时白板上)' }
        },
        required: ['classId']
      }
    });

    ctx.commandBus.registerHandler('rollcall.pick', {
      execute: async (command) => {
        const payload = command.payload;
        const classId = payload.classId;
        const lessonId = payload.lessonId;

        let students = [];
        try {
          const res = await ctx.commandBus.execute({
            id: 'int_' + Math.random().toString(36).slice(2),
            type: 'class.get_students',
            actorId: 'plugin-rollcall',
            payload: { classId }
          });
          if (res && res.students) {
            students = res.students;
          }
        } catch (e) {
          console.error("Failed to fetch class students via command bus", e);
        }

        if (students.length === 0) {
          students = [
            { id: "mock-s-1", name: "张明", email: "zhangming@edu-os.org" },
            { id: "mock-s-2", name: "李华", email: "lihua@edu-os.org" },
            { id: "mock-s-3", name: "王超", email: "wangchao@edu-os.org" },
            { id: "mock-s-4", name: "赵丽", email: "zhaoli@edu-os.org" }
          ];
        }

        const randomIndex = Math.floor(Math.random() * students.length);
        const selectedStudent = students[randomIndex];

        let elementId = null;
        if (lessonId) {
          const drawRes = await ctx.commandBus.execute({
            id: 'int_' + Math.random().toString(36).slice(2),
            type: 'whiteboard.draw',
            payload: {
              lessonId,
              type: 'rollcall',
              data: JSON.stringify({
                classId,
                selectedStudent,
                allStudents: students,
                pickedTime: new Date().toISOString(),
                status: 'picked'
              })
            }
          });
          elementId = drawRes?.elementId;
        }

        return {
          success: true,
          selectedStudent,
          allStudentsCount: students.length,
          elementId,
          message: "已从当前班级中成功抽得幸运学生: " + selectedStudent.name
        };
      }
    });
  }
};`);
                  }}
                  className="px-2 py-1 text-[10px] uppercase font-bold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700/80 rounded transition-all flex items-center gap-1 cursor-pointer"
                  title="Load custom random rollcall plugin source code"
                >
                  <Sparkles size={11} className="text-amber-400 animate-pulse" />
                  {lang === 'zh' ? '加载：随机点名助手' : 'Load Picker'}
                </button>
              </div>
            </div>

            {/* MigrationPrompt banner — shown when legacy plugins exist */}
            {hasLegacyPlugins && !dismissMigration && (
              <div className="px-4 pt-4 bg-gray-950">
                <MigrationPromptBanner />
              </div>
            )}

            {/* Split layout */}
            <div className="flex-1 flex overflow-hidden min-h-0 bg-gray-950">
              {/* Left Column: Code Editor */}
              <div className="w-7/12 flex flex-col border-r border-gray-800 h-full p-4 min-h-0">
                <div className="flex justify-between items-center mb-1 text-[10px] uppercase font-bold text-gray-400 select-none shrink-0">
                  <span>
                    {lang === 'zh'
                      ? '⚙️ 插件主程序 JS 源代码'
                      : '⚙️ Plugin Source Code (JavaScript)'}
                  </span>
                  <span className="font-mono text-[9px] text-gray-500">
                    Node Sandbox Ready
                  </span>
                </div>
                <textarea
                  value={pluginCode}
                  onChange={(e) => setPluginCode(e.target.value)}
                  className="w-full flex-1 font-mono text-[11px] p-4 bg-gray-900 border border-gray-800 text-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none leading-relaxed overflow-y-auto"
                />
              </div>

              {/* Right Column: Manifest Verification & Live Preview */}
              <div className="w-5/12 flex flex-col bg-gray-900/40 p-4 h-full overflow-y-auto min-h-0">
                <div className="mb-3">
                  <div className="text-[10px] uppercase font-bold text-gray-400 select-none mb-1.5 flex justify-between items-center">
                    <span>
                      {lang === 'zh'
                        ? '🔍 MANIFEST 实时解析与权限审计'
                        : '🔍 Manifest Extraction & Audit'}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-900 font-mono">
                      Live Static
                    </span>
                  </div>

                  {/* Status validation card */}
                  {(() => {
                    const parsed = parsePluginSource(pluginCode);
                    const hasManifest =
                      parsed && parsed.manifest && parsed.manifest.id && parsed.manifest.name;

                    return (
                      <div className="space-y-3.5">
                        {/* Verification Status Badge */}
                        <div
                          className={`p-3 rounded-lg border flex items-start gap-2 ${
                            hasManifest
                              ? 'bg-emerald-950/45 border-emerald-800/60 text-emerald-300'
                              : 'bg-amber-955/40 border-amber-800/60 text-amber-300'
                          }`}
                        >
                          {hasManifest ? (
                            <>
                              <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                              <div>
                                <h5 className="text-xs font-bold font-sans">
                                  {lang === 'zh'
                                    ? '✓ Manifest 静态合法性验证通过'
                                    : '✓ Manifest Validation Passed'}
                                </h5>
                                <p className="text-[10px] text-emerald-400/80 mt-0.5 leading-tight">
                                  {lang === 'zh'
                                    ? '检测到完整的插件标识。可在安全白名单和命令总线中顺利完成挂载。'
                                    : 'Completed identifier extraction. Secure initialization is ready to deploy.'}
                                </p>
                              </div>
                            </>
                          ) : (
                            <>
                              <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
                              <div>
                                <h5 className="text-xs font-bold font-sans">
                                  {lang === 'zh'
                                    ? '⚠️ 未匹配到有效 Manifest 描述符'
                                    : '⚠️ Searching for valid Metadata'}
                                </h5>
                                <p className="text-[10px] text-amber-400/80 mt-0.5 leading-tight">
                                  {lang === 'zh'
                                    ? '请在代码段中指定完整的 manifest 包含 id、name 属性，系统才能自动进行预览与权限挂载。'
                                    : 'Please provide manifest object inside exports.default with unique id/name properties to active automatic registration.'}
                                </p>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Metadata Details */}
                        {hasManifest && parsed && parsed.manifest && (
                          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5 space-y-2.5">
                            <div className="border-b border-gray-800 pb-2 flex justify-between items-center">
                              <h6 className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">
                                {lang === 'zh'
                                  ? '基本描述元数据'
                                  : 'Metadata Details'}
                              </h6>
                              <span className="text-[9px] text-indigo-400 font-mono px-1 bg-indigo-950 rounded">
                                v{parsed.manifest.version || '1.0.0'}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                              <div className="text-gray-500">
                                {lang === 'zh' ? '名称:' : 'Name:'}
                              </div>
                              <div className="col-span-2 text-gray-200 font-sans font-semibold">
                                {parsed.manifest.name}
                              </div>

                              <div className="text-gray-500">
                                {lang === 'zh' ? '唯一标识:' : 'UUID/ID:'}
                              </div>
                              <div className="col-span-2 text-gray-305">
                                {parsed.manifest.id}
                              </div>

                              <div className="text-gray-500">
                                {lang === 'zh' ? '开发者:' : 'Author:'}
                              </div>
                              <div className="col-span-2 text-indigo-305">
                                {parsed.manifest.author || 'Community'}
                              </div>
                            </div>
                            {parsed.manifest.description && (
                              <div className="text-[10.5px] text-gray-400 leading-relaxed bg-gray-950 border border-gray-900 p-2 rounded-md font-sans">
                                <span className="text-gray-550 float-left mr-1 font-bold">
                                  ℹ️
                                </span>
                                {parsed.manifest.description}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Requested Capabilities */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5 space-y-2">
                          <h6 className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider pb-1.5 border-b border-gray-800 flex items-center gap-1">
                            <Shield size={11} className="text-indigo-400" />
                            <span>
                              {lang === 'zh'
                                ? '申请所需扩展权限'
                                : 'Proposed Capabilities'}
                            </span>
                          </h6>
                          {parsed &&
                          parsed.manifest &&
                          parsed.manifest.capabilitiesProposed &&
                          parsed.manifest.capabilitiesProposed.length > 0 ? (
                            <div className="space-y-2">
                              {parsed.manifest.capabilitiesProposed.map(
                                (cap: string, idx: number) => {
                                  const normCap = cap.trim().toLowerCase();
                                  const info = CAPABILITY_INFO[normCap] || {
                                    labelZh: cap,
                                    labelEn: cap,
                                    iconName: 'Shield',
                                    risk: 'low' as const,
                                    riskDescZh:
                                      '自定义插件运行权限，具备常规沙箱网络与交互限制。',
                                    riskDescEn:
                                      'Custom plugin running capability under standard restraints.',
                                  };

                                  const riskConfig = {
                                    high: {
                                      bg: 'bg-red-950/20 border-red-900/40 hover:border-red-800/80 text-red-300',
                                      badge: 'bg-red-950/60 border-red-900/60 text-red-400',
                                      labelZh: '高风险',
                                      labelEn: 'High Risk',
                                      dot: 'bg-red-400',
                                    },
                                    medium: {
                                      bg: 'bg-amber-950/15 border-amber-900/30 hover:border-amber-800/65 text-amber-300',
                                      badge: 'bg-amber-950/60 border-amber-900/50 text-amber-400',
                                      labelZh: '中风险',
                                      labelEn: 'Medium Risk',
                                      dot: 'bg-amber-400',
                                    },
                                    low: {
                                      bg: 'bg-emerald-950/10 border-emerald-900/20 hover:border-emerald-800/40 text-emerald-400',
                                      badge: 'bg-emerald-950/50 border-emerald-900/40 text-emerald-400',
                                      labelZh: '低风险',
                                      labelEn: 'Low Risk',
                                      dot: 'bg-emerald-400',
                                    },
                                  }[info.risk];

                                  const renderIcon = () => {
                                    const iconClass = 'shrink-0 text-indigo-400';
                                    if (info.iconName === 'PenTool')
                                      return <PenTool className={iconClass} size={12} />;
                                    if (info.iconName === 'Eye')
                                      return <Eye className={iconClass} size={12} />;
                                    if (info.iconName === 'Users')
                                      return <Users className={iconClass} size={12} />;
                                    if (info.iconName === 'Database')
                                      return <Database className={iconClass} size={12} />;
                                    return <Shield className={iconClass} size={12} />;
                                  };

                                  return (
                                    <div
                                      key={idx}
                                      className={`p-2 rounded-lg border flex items-center justify-between gap-2.5 transition-all duration-200 group relative ${riskConfig.bg}`}
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="p-1 rounded bg-gray-950 border border-gray-800 shrink-0">
                                          {renderIcon()}
                                        </span>
                                        <div className="min-w-0">
                                          <span className="text-[10.5px] font-bold text-gray-200 block truncate">
                                            {lang === 'zh'
                                              ? info.labelZh
                                              : info.labelEn}
                                          </span>
                                          <span className="text-[9px] text-gray-500 font-mono block truncate select-all">
                                            {cap}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Risk Badge with Floating Custom Interactive Tooltip */}
                                      <div className="relative shrink-0">
                                        <span
                                          className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border flex items-center gap-1 cursor-help transition-all ${riskConfig.badge}`}
                                        >
                                          <span
                                            className={`w-1 h-1 rounded-full animate-pulse ${riskConfig.dot}`}
                                          />
                                          <span>
                                            {lang === 'zh'
                                              ? riskConfig.labelZh
                                              : riskConfig.labelEn}
                                          </span>
                                        </span>

                                        {/* Floating hover card */}
                                        <div className="absolute z-55 right-0 bottom-full mb-2 w-56 p-2.5 bg-gray-950 border border-gray-800 rounded-lg shadow-xl text-left scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100 pointer-events-none transition-all duration-150 origin-bottom-right">
                                          <div className="flex items-center justify-between font-bold text-[9px] mb-1 pb-1 border-b border-gray-800 font-sans">
                                            <span className="text-gray-405 uppercase tracking-wide">
                                              {lang === 'zh'
                                                ? '安全性说明'
                                                : 'Security Audit'}
                                            </span>
                                            <span
                                              className={
                                                info.risk === 'high'
                                                  ? 'text-red-400'
                                                  : info.risk === 'medium'
                                                    ? 'text-amber-400'
                                                    : 'text-emerald-400'
                                              }
                                            >
                                              {lang === 'zh'
                                                ? riskConfig.labelZh
                                                : riskConfig.labelEn}
                                            </span>
                                          </div>
                                          <p className="text-[9.5px] leading-relaxed text-gray-300 font-sans">
                                            {lang === 'zh'
                                              ? info.riskDescZh
                                              : info.riskDescEn}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                },
                              )}
                            </div>
                          ) : (
                            <div className="text-[10px] text-gray-500 italic py-1">
                              {lang === 'zh'
                                ? '无权限获取要求 (运行于无特权沙箱环境)'
                                : 'No additional capabilities requested.'}
                            </div>
                          )}
                        </div>

                        {/* Registered commands mapping */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3.5 space-y-2">
                          <h6 className="text-[11px] font-bold text-amber-300 uppercase tracking-wider pb-1.5 border-b border-gray-800 flex items-center gap-1">
                            <Terminal size={11} className="text-amber-400" />
                            <span>
                              {lang === 'zh'
                                ? '内核总线注册指令 (Commands)'
                                : 'Registered Commands'}
                            </span>
                          </h6>
                          {parsed &&
                          parsed.actions &&
                          parsed.actions.length > 0 ? (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                              {parsed.actions.map((act: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="p-2 bg-gray-950 border border-gray-900 rounded-lg space-y-1"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-gray-300 font-mono">
                                      {act.id}
                                    </span>
                                    <span className="text-[9px] bg-amber-950 text-amber-400 border border-amber-900 rounded px-1.5 font-mono">
                                      {act.commandType}
                                    </span>
                                  </div>
                                  {act.description && (
                                    <p className="text-[9.5px] text-gray-400 leading-snug">
                                      {act.description}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[10px] text-gray-500 italic py-1">
                              {lang === 'zh'
                                ? '未声明注册自定义指令句柄'
                                : 'No commands or command handlers detected.'}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Control actions footer */}
            <div className="p-4 border-t border-gray-800 bg-gray-950 flex justify-between items-center shrink-0 select-none">
              <span className="text-[10px] text-gray-500 font-mono">
                Secure Sideload Mode &bull; Sandbox Integrity Check
              </span>
              <div className="flex justify-end gap-3">
                <button
                  onClick={onInstall}
                  disabled={installingPlugin || !pluginCode.trim()}
                  className="px-4 py-2 text-xs bg-indigo-600 font-bold hover:bg-indigo-700 text-white rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 hover:shadow-lg active:scale-97 cursor-pointer"
                >
                  {installingPlugin ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>
                        {lang === 'zh' ? '集成挂载中...' : 'Registering...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={13} />
                      <span>
                        {lang === 'zh'
                          ? '部署并安装到课堂内核'
                          : 'Deploy & Install Plugin'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
