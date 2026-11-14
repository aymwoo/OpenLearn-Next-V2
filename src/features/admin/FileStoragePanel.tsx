import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Eye, FolderKanban, HardDrive, Loader2, RefreshCw } from 'lucide-react';

export type FileLayoutScheme = 'flat' | 'by-date' | 'by-course' | 'by-author' | 'custom';

export interface FileStorageBackendItem {
  id: string;
  displayName: string;
  description?: string;
  owner: string;
  capabilities: {
    supportsRange: boolean;
    supportsPresignedUrl: boolean;
    externalBacked: boolean;
  };
}

export interface FileStorageConfigState {
  layout: {
    scheme: FileLayoutScheme;
    template?: string;
  };
  defaultBackend: string;
  deduplicateByHash: boolean;
}

export interface FileStorageStats {
  activeAssets: number;
  totalAssets: number;
  uniqueBlobs: number;
  physicalBytes: number;
  logicalBytes: number;
  savedBytes: number;
  legacyAliases: number;
}

interface FileStoragePanelProps {
  lang: 'zh' | 'en';
}

const SCHEME_OPTIONS: Array<{
  value: FileLayoutScheme;
  zhLabel: string;
  enLabel: string;
  zhDesc: string;
  enDesc: string;
}> = [
  {
    value: 'by-date',
    zhLabel: '按日期分目录 (by-date)',
    enLabel: 'By Date (by-date)',
    zhDesc: '按年月日与用途归档：{yyyy}/{MM}/{dd}/{purpose}/{safeName}',
    enDesc: 'Date & purpose buckets: {yyyy}/{MM}/{dd}/{purpose}/{safeName}',
  },
  {
    value: 'by-course',
    zhLabel: '按课程/课时分目录 (by-course)',
    enLabel: 'By Course & Lesson (by-course)',
    zhDesc: '按课程隔离：{courseId}/{lessonId}/{purpose}/{safeName}',
    enDesc: 'Grouped by course: {courseId}/{lessonId}/{purpose}/{safeName}',
  },
  {
    value: 'by-author',
    zhLabel: '按上传者与日期 (by-author)',
    enLabel: 'By Author & Date (by-author)',
    zhDesc: '按作者分目录：{authorId}/{yyyy}/{MM}/{safeName}',
    enDesc: 'Grouped by author: {authorId}/{yyyy}/{MM}/{safeName}',
  },
  {
    value: 'flat',
    zhLabel: '扁平单层目录 (flat)',
    enLabel: 'Flat (flat)',
    zhDesc: '平铺存放：{safeName}',
    enDesc: 'Single flat level: {safeName}',
  },
  {
    value: 'custom',
    zhLabel: '自定义路径模板 (custom)',
    enLabel: 'Custom Template (custom)',
    zhDesc: '自定义占位符，必须包含 {safeName} / {id} / {uuid} / {hash8}',
    enDesc: 'Custom placeholders; must include {safeName}, {id}, {uuid}, or {hash8}',
  },
];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${idx === 0 ? value : value.toFixed(1)} ${units[idx]}`;
}

export function validateCustomTemplateClient(template: string, lang: 'zh' | 'en'): string | null {
  const trimmed = template.trim();
  if (!trimmed) {
    return lang === 'zh' ? '请输入自定义存储路径模板。' : 'Please enter a custom storage path template.';
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:/.test(trimmed)) {
    return lang === 'zh'
      ? '模板不能以斜杠或盘符开头，必须为相对路径。'
      : 'Template must be a relative path without leading slashes or drive letters.';
  }
  if (trimmed.split(/[\\/]+/).some((seg) => seg === '..')) {
    return lang === 'zh' ? '模板不能包含上级目录跳转（..）。' : 'Template cannot contain parent traversal (..).';
  }
  if (
    !trimmed.includes('{safeName}') &&
    !trimmed.includes('{hash8}') &&
    !trimmed.includes('{uuid}') &&
    !trimmed.includes('{id}')
  ) {
    return lang === 'zh'
      ? '为避免文件覆盖冲突，模板必须包含 {safeName}、{hash8}、{uuid} 或 {id} 唯一占位符之一。'
      : 'Template must include {safeName}, {hash8}, {uuid}, or {id} to guarantee key uniqueness.';
  }
  return null;
}

export function FileStoragePanel({ lang }: FileStoragePanelProps) {
  const headingId = useId();
  const backendSelectId = useId();
  const templateInputId = useId();
  const templateHintId = useId();
  const templateErrorId = useId();
  const dedupCheckboxId = useId();

  const templateInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [config, setConfig] = useState<FileStorageConfigState>({
    layout: { scheme: 'by-date', template: '' },
    defaultBackend: 'local',
    deduplicateByHash: true,
  });
  const [backends, setBackends] = useState<FileStorageBackendItem[]>([]);
  const [stats, setStats] = useState<FileStorageStats | null>(null);
  const [previewKey, setPreviewKey] = useState<string>('');

  const [templateTouched, setTemplateTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverTemplateError, setServerTemplateError] = useState<string | null>(null);

  const [statusAnnouncement, setStatusAnnouncement] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const requestPreview = useCallback(async (scheme: FileLayoutScheme, template?: string) => {
    try {
      setPreviewLoading(true);
      const res = await fetch('/api/admin/file-storage/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheme,
          template: scheme === 'custom' ? template : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setPreviewKey(String(data.previewKey || ''));
        setServerTemplateError(null);
      } else if (data?.error) {
        setPreviewKey('');
        if (scheme === 'custom') {
          setServerTemplateError(String(data.error));
        }
      }
    } catch {
      // 预览失败不阻断表单编辑
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      const [cfgRes, statsRes] = await Promise.all([
        fetch('/api/admin/file-storage/config'),
        fetch('/api/admin/file-storage/stats'),
      ]);

      const cfgData = await cfgRes.json().catch(() => ({}));
      const statsData = await statsRes.json().catch(() => ({}));

      if (cfgRes.ok && cfgData?.success && cfgData.config) {
        const nextConfig: FileStorageConfigState = {
          layout: {
            scheme: (cfgData.config.layout?.scheme as FileLayoutScheme) || 'by-date',
            template: cfgData.config.layout?.template || '',
          },
          defaultBackend: String(cfgData.config.defaultBackend || 'local'),
          deduplicateByHash: Boolean(cfgData.config.deduplicateByHash),
        };
        setConfig(nextConfig);
        setBackends(Array.isArray(cfgData.backends) ? cfgData.backends : []);
        void requestPreview(nextConfig.layout.scheme, nextConfig.layout.template);
      } else {
        setStatusAnnouncement({
          type: 'error',
          text:
            cfgData?.error || (lang === 'zh' ? '加载文件存储配置失败。' : 'Failed to load file storage configuration.'),
        });
      }

      if (statsRes.ok && statsData?.success && statsData.stats) {
        setStats(statsData.stats as FileStorageStats);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setStatusAnnouncement({
        type: 'error',
        text:
          lang === 'zh'
            ? `加载配置异常：${msg || '网络错误'}`
            : `Failed to fetch configuration: ${msg || 'Network error'}`,
      });
    } finally {
      setLoading(false);
    }
  }, [lang, requestPreview]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const isCustom = config.layout.scheme === 'custom';
  const clientTemplateError = isCustom ? validateCustomTemplateClient(config.layout.template || '', lang) : null;
  const showTemplateError =
    isCustom && (templateTouched || submitAttempted) ? clientTemplateError || serverTemplateError : null;
  const templateInvalid = Boolean(showTemplateError);

  const handleSchemeChange = (scheme: FileLayoutScheme) => {
    const defaultCustomTemplate = '{purpose}/{yyyy}/{MM}/{safeName}';
    setConfig((prev) => ({
      ...prev,
      layout: {
        ...prev.layout,
        scheme,
        template: scheme === 'custom' && !prev.layout.template ? defaultCustomTemplate : prev.layout.template,
      },
    }));
    setServerTemplateError(null);
    const nextTemplate = scheme === 'custom' ? config.layout.template || defaultCustomTemplate : undefined;
    void requestPreview(scheme, nextTemplate);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitAttempted(true);
    setStatusAnnouncement(null);

    if (isCustom && clientTemplateError) {
      setTemplateTouched(true);
      templateInputRef.current?.focus();
      setStatusAnnouncement({
        type: 'error',
        text: clientTemplateError,
      });
      return;
    }

    try {
      setSaving(true);
      const payload: FileStorageConfigState = {
        defaultBackend: config.defaultBackend,
        deduplicateByHash: config.deduplicateByHash,
        layout: {
          scheme: config.layout.scheme,
          ...(config.layout.scheme === 'custom' ? { template: (config.layout.template || '').trim() } : {}),
        },
      };

      const res = await fetch('/api/admin/file-storage/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setServerTemplateError(null);
        setStatusAnnouncement({
          type: 'success',
          text:
            lang === 'zh'
              ? '文件存储策略已保存，新上传的文件将立即按新策略落盘；既有文件可通过 pnpm file:reorg 按需重整。'
              : 'File storage policy saved. New uploads apply immediately; existing blobs can be reorganized via pnpm file:reorg.',
        });
        void requestPreview(payload.layout.scheme, payload.layout.template);
      } else {
        const message = String(
          data?.error || (lang === 'zh' ? '保存文件存储策略失败。' : 'Failed to save file storage configuration.'),
        );
        if (isCustom && data?.code === 'INVALID_FILE_STORAGE_CONFIG') {
          setServerTemplateError(message);
          templateInputRef.current?.focus();
        }
        setStatusAnnouncement({
          type: 'error',
          text: message,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setStatusAnnouncement({
        type: 'error',
        text: lang === 'zh' ? `保存异常：${msg || '网络错误'}` : `Save failed: ${msg || 'Network error'}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedBackend = backends.find((b) => b.id === config.defaultBackend);

  return (
    <section className="mt-5" aria-labelledby={headingId}>
      <div className="bg-white border border-gray-200 rounded-xl shadow-3xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
          <div>
            <h3 id={headingId} className="font-bold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
              <HardDrive size={18} className="text-indigo-600" aria-hidden="true" />
              {lang === 'zh' ? '文件存储与路径布局策略' : 'File Storage & Layout Policy'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {lang === 'zh'
                ? '配置文件存储后端、物理路径模板与内容寻址去重。访问路径 /api/files/:assetId 与实体路径完全解耦。'
                : 'Configure default storage backend, physical key layout, and SHA-256 deduplication. /api/files/:assetId URLs never break when keys change.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading || saving}
            aria-label={lang === 'zh' ? '刷新文件存储配置与统计' : 'Refresh file storage configuration and stats'}
            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer disabled:opacity-50 shrink-0"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>

        <form aria-labelledby={headingId} noValidate onSubmit={handleSave} className="p-4 sm:p-5 space-y-5 text-left">
          {/* 资产存储统计摘要 */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="px-3 py-2 rounded-lg border border-gray-200 bg-gray-50/60">
                <div className="text-[11px] text-gray-500">{lang === 'zh' ? '有效资产数' : 'Active Assets'}</div>
                <div className="text-sm font-bold text-gray-800 font-mono">{stats.activeAssets}</div>
              </div>
              <div className="px-3 py-2 rounded-lg border border-gray-200 bg-gray-50/60">
                <div className="text-[11px] text-gray-500">{lang === 'zh' ? '物理 Blob 数' : 'Unique Blobs'}</div>
                <div className="text-sm font-bold text-gray-800 font-mono">{stats.uniqueBlobs}</div>
              </div>
              <div className="px-3 py-2 rounded-lg border border-gray-200 bg-gray-50/60">
                <div className="text-[11px] text-gray-500">
                  {lang === 'zh' ? '实占空间 / 去重节省' : 'Physical / Saved'}
                </div>
                <div className="text-sm font-bold text-gray-800 font-mono">
                  {formatBytes(stats.physicalBytes)}
                  <span className="text-[11px] font-normal text-emerald-700 ml-1">
                    (-{formatBytes(stats.savedBytes)})
                  </span>
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg border border-gray-200 bg-gray-50/60">
                <div className="text-[11px] text-gray-500">{lang === 'zh' ? '旧路径别名映射' : 'Legacy Aliases'}</div>
                <div className="text-sm font-bold text-gray-800 font-mono">{stats.legacyAliases}</div>
              </div>
            </div>
          )}

          {/* 默认存储后端选择 */}
          <div className="space-y-1.5">
            <label htmlFor={backendSelectId} className="text-xs font-bold text-gray-700 block">
              {lang === 'zh' ? '默认存储后端（StorageBackend）' : 'Default Storage Backend'}
            </label>
            <select
              id={backendSelectId}
              value={config.defaultBackend}
              onChange={(e) => setConfig((prev) => ({ ...prev, defaultBackend: e.target.value }))}
              className="w-full text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            >
              {backends.length === 0 ? (
                <option value="local">Local Disk Storage (local)</option>
              ) : (
                backends.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.displayName} ({b.id}) — {b.owner}
                  </option>
                ))
              )}
            </select>
            {selectedBackend && (
              <p className="text-xs text-gray-500">
                {selectedBackend.description ? `${selectedBackend.description} · ` : ''}
                {lang === 'zh' ? '能力：' : 'Capabilities: '}
                {selectedBackend.capabilities.supportsRange ? 'Range ' : ''}
                {selectedBackend.capabilities.supportsPresignedUrl ? 'PresignedURL ' : ''}
                {selectedBackend.capabilities.externalBacked ? 'External' : 'Local'}
              </p>
            )}
          </div>

          {/* 物理路径布局策略（2-5 个互斥选项，使用 fieldset + legend + radio） */}
          <fieldset className="space-y-2 border border-gray-200 rounded-lg p-3.5 bg-gray-50/30">
            <legend className="text-xs font-bold text-gray-700 px-1.5 flex items-center gap-1.5">
              <FolderKanban size={14} className="text-indigo-600" aria-hidden="true" />
              {lang === 'zh' ? '文件组织方式（LayoutPolicy）' : 'Physical Layout Scheme (LayoutPolicy)'}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SCHEME_OPTIONS.map((opt) => {
                const checked = config.layout.scheme === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-indigo-50/70 border-indigo-300 text-indigo-950'
                        : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="file-layout-scheme"
                      value={opt.value}
                      checked={checked}
                      onChange={() => handleSchemeChange(opt.value)}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs leading-relaxed">
                      <span className="font-bold block">{lang === 'zh' ? opt.zhLabel : opt.enLabel}</span>
                      <span className="text-[11px] text-gray-500 font-mono">
                        {lang === 'zh' ? opt.zhDesc : opt.enDesc}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            {isCustom && (
              <div className="pt-2 space-y-1.5">
                <label htmlFor={templateInputId} className="text-xs font-bold text-gray-700 block">
                  {lang === 'zh' ? '自定义路径模板' : 'Custom Path Template'}
                </label>
                <input
                  ref={templateInputRef}
                  id={templateInputId}
                  type="text"
                  value={config.layout.template || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConfig((prev) => ({
                      ...prev,
                      layout: { ...prev.layout, template: val },
                    }));
                    setServerTemplateError(null);
                  }}
                  onBlur={() => setTemplateTouched(true)}
                  placeholder="{purpose}/{yyyy}/{MM}/{safeName}"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={templateInvalid ? 'true' : 'false'}
                  aria-describedby={showTemplateError ? `${templateHintId} ${templateErrorId}` : templateHintId}
                  className={`w-full text-sm font-mono bg-white border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 transition-all ${
                    templateInvalid ? 'border-rose-400 focus:ring-rose-500' : 'border-gray-200 focus:ring-indigo-500'
                  }`}
                />
                <p id={templateHintId} className="text-[11px] text-gray-500">
                  {lang === 'zh'
                    ? '可用占位符：{yyyy} {MM} {dd} {hh} {mm} {ss} {courseId} {lessonId} {authorId} {assignmentId} {purpose} {safeName} {hash8} {uuid} {id} {ext} {extNoDot}（须含 {safeName}/{hash8}/{uuid}/{id} 之一）'
                    : 'Tokens: {yyyy} {MM} {dd} {hh} {mm} {ss} {courseId} {lessonId} {authorId} {assignmentId} {purpose} {safeName} {hash8} {uuid} {id} {ext} {extNoDot} (must include {safeName}, {hash8}, {uuid}, or {id})'}
                </p>
                {showTemplateError && (
                  <p id={templateErrorId} className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
                    <AlertTriangle size={13} aria-hidden="true" />
                    <span>{showTemplateError}</span>
                  </p>
                )}
              </div>
            )}
          </fieldset>

          {/* 路径预览区 */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-gray-600">
                {lang === 'zh' ? '物理路径预览（示例：课程资料/课件插图.png）' : 'Physical Key Preview (Sample Upload)'}
              </div>
              <code className="text-xs font-mono text-indigo-700 break-all block mt-0.5">
                {previewLoading
                  ? lang === 'zh'
                    ? '生成预览中...'
                    : 'Generating preview...'
                  : previewKey || (lang === 'zh' ? '（当前模板无效，无法生成预览）' : '(Invalid template)')}
              </code>
            </div>
            <button
              type="button"
              onClick={() => void requestPreview(config.layout.scheme, config.layout.template)}
              disabled={previewLoading}
              className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0"
            >
              <Eye size={13} aria-hidden="true" />
              <span>{lang === 'zh' ? '预览生成路径' : 'Preview Path'}</span>
            </button>
          </div>

          {/* 内容寻址去重开关 */}
          <div className="flex items-start gap-2.5 pt-1">
            <input
              id={dedupCheckboxId}
              type="checkbox"
              checked={config.deduplicateByHash}
              onChange={(e) => setConfig((prev) => ({ ...prev, deduplicateByHash: e.target.checked }))}
              className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor={dedupCheckboxId} className="text-xs text-gray-700 cursor-pointer select-none">
              <span className="font-bold block">
                {lang === 'zh' ? '启用 SHA-256 同后端内容去重（Deduplicate by Hash）' : 'Enable SHA-256 Deduplication'}
              </span>
              <span className="text-[11px] text-gray-500">
                {lang === 'zh'
                  ? '相同内容重复上传时复用同一物理 Blob 并递增引用计数，学生作业与加密敏感路径会自动强制隔离。'
                  : 'Reuses identical physical blobs on the same backend while keeping independent file_assets records; assignment uploads always skip dedup.'}
              </span>
            </label>
          </div>

          {/* 单一状态提示 live region */}
          <div role="status" aria-live="polite" className="min-h-0">
            {statusAnnouncement && (
              <div
                className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold border ${
                  statusAnnouncement.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
              >
                {statusAnnouncement.type === 'success' ? (
                  <CheckCircle2 size={14} className="shrink-0 mt-px" aria-hidden="true" />
                ) : (
                  <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" />
                )}
                <span>{statusAnnouncement.text}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={saving || loading}
              className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
              <span>
                {saving
                  ? lang === 'zh'
                    ? '保存中...'
                    : 'Saving...'
                  : lang === 'zh'
                    ? '保存文件存储策略'
                    : 'Save File Storage Policy'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
export default FileStoragePanel;
