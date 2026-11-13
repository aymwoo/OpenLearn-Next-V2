import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Eye,
  Monitor,
  Moon,
  PackageOpen,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { BUILTIN_THEMES, useThemeStore } from '../store/themeStore';
import {
  deleteThemeApi,
  disableThemeApi,
  enableThemeApi,
  fetchThemeBundleApi,
  getThemeExportUrl,
  type ThemeCatalogEntry,
} from '../services/themeService';
import type { ThemeBorderRadius, ThemeColorMode, ThemeDensity } from '../../packages/core/themes/theme-spec';

interface ThemeCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: 'zh' | 'en';
  isAdmin?: boolean;
}

export function ThemeCenterModal({ isOpen, onClose, lang = 'zh', isAdmin = false }: ThemeCenterModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const theme = useThemeStore((s) => s.theme);
  const catalog = useThemeStore((s) => s.catalog);
  const installedVersion = useThemeStore((s) => s.installedVersion);
  const latestVersion = useThemeStore((s) => s.latestVersion);
  const upgradeAvailable = useThemeStore((s) => s.upgradeAvailable);
  const upgradeChangelog = useThemeStore((s) => s.upgradeChangelog);
  const colorMode = useThemeStore((s) => s.colorMode);
  const appearanceOverrides = useThemeStore((s) => s.appearanceOverrides);
  const previewState = useThemeStore((s) => s.previewState);

  const refreshCatalog = useThemeStore((s) => s.refreshCatalog);
  const installThemeZip = useThemeStore((s) => s.installThemeZip);
  const selectTheme = useThemeStore((s) => s.selectTheme);
  const setColorMode = useThemeStore((s) => s.setColorMode);
  const setAppearanceOverrides = useThemeStore((s) => s.setAppearanceOverrides);
  const upgradeCurrentTheme = useThemeStore((s) => s.upgradeCurrentTheme);
  const startPreview = useThemeStore((s) => s.startPreview);
  const cancelPreview = useThemeStore((s) => s.cancelPreview);
  const resetToSafeDefault = useThemeStore((s) => s.resetToSafeDefault);

  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (isOpen) {
      if (typeof dlg.showModal === 'function' && !dlg.open) {
        dlg.showModal();
      } else {
        dlg.setAttribute('open', 'true');
      }
      void refreshCatalog();
    } else if (dlg.open) {
      if (typeof dlg.close === 'function') {
        dlg.close();
      } else {
        dlg.removeAttribute('open');
      }
    }
  }, [isOpen, refreshCatalog]);

  const handleClose = () => {
    if (previewState) {
      cancelPreview();
    }
    onClose();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setFeedback(null);
    try {
      const item = await installThemeZip(file);
      setFeedback({
        type: 'ok',
        text:
          lang === 'zh'
            ? `已安装第三方主题「${item.name}」(v${item.latestVersion})`
            : `Installed theme "${item.name}" (v${item.latestVersion})`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.message || (lang === 'zh' ? '主题包校验或安装失败' : 'Failed to install theme package'),
      });
    } finally {
      setUploading(false);
    }
  };

  const handlePreviewThirdParty = async (entry: ThemeCatalogEntry) => {
    setBusyId(entry.id);
    setFeedback(null);
    try {
      const res = await fetchThemeBundleApi(entry.id, entry.latestVersion);
      if (!res?.bundle) {
        setFeedback({ type: 'err', text: lang === 'zh' ? '无法加载主题包预览数据' : 'Unable to load theme preview' });
        return;
      }
      startPreview({
        themeId: entry.id,
        bundle: res.bundle,
        mode: colorMode,
        appearanceOverrides,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleApplyThirdParty = async (entry: ThemeCatalogEntry) => {
    setBusyId(entry.id);
    setFeedback(null);
    try {
      await selectTheme(entry.id, { version: entry.latestVersion });
      setFeedback({
        type: 'ok',
        text: lang === 'zh' ? `已切换至主题「${entry.name}」` : `Switched to "${entry.name}"`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || '应用主题失败' });
    } finally {
      setBusyId(null);
    }
  };

  const handleAdminToggleDisable = async (entry: ThemeCatalogEntry) => {
    setBusyId(entry.id);
    setFeedback(null);
    try {
      if (entry.status === 'disabled') {
        await enableThemeApi(entry.id);
      } else {
        await disableThemeApi(entry.id);
      }
      await refreshCatalog();
      if (theme === entry.id && entry.status !== 'disabled') {
        await resetToSafeDefault();
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || '操作失败' });
    } finally {
      setBusyId(null);
    }
  };

  const handleAdminDelete = async (entry: ThemeCatalogEntry) => {
    setBusyId(entry.id);
    setFeedback(null);
    try {
      await deleteThemeApi(entry.id);
      await refreshCatalog();
      if (theme === entry.id) {
        await resetToSafeDefault();
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || '删除主题失败' });
    } finally {
      setBusyId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      aria-labelledby="theme-center-title"
      className="fixed inset-0 m-auto max-w-4xl w-[94vw] max-h-[88vh] p-0 rounded-2xl border border-theme bg-surface text-main shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs overflow-hidden"
    >
      <div className="flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-theme bg-surface-secondary/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles size={20} className="text-primary-theme" />
            <div>
              <h2 id="theme-center-title" className="text-base font-bold text-main">
                {lang === 'zh' ? '主题中心 · 第三方主题与外观定制' : 'Theme Center · Third-Party Themes'}
              </h2>
              <p className="text-xs text-muted">
                {lang === 'zh'
                  ? '导入安全沙盒校验的 .zip 主题包，支持深浅模式、基础外观覆盖与版本独立升级'
                  : 'Install declarative .zip theme packages with per-account isolation and live preview'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void resetToSafeDefault()}
              className="px-3 py-1.5 rounded-lg border border-theme text-xs font-medium text-main hover:bg-surface-secondary flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw size={13} />
              {lang === 'zh' ? '恢复默认' : 'Reset Safe'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              aria-label={lang === 'zh' ? '关闭' : 'Close'}
              className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface-secondary cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {feedback && (
            <div
              role="status"
              className={`rounded-xl px-4 py-2.5 text-xs font-medium flex items-center justify-between border ${
                feedback.type === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
              }`}
            >
              <span>{feedback.text}</span>
              <button type="button" onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Opt-in upgrade notice for active theme */}
          {upgradeAvailable && latestVersion && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-amber-800 dark:text-amber-300">
                  {lang === 'zh'
                    ? `当前主题有新版本可用：v${installedVersion} → v${latestVersion}`
                    : `Theme upgrade available: v${installedVersion} -> v${latestVersion}`}
                </div>
                {upgradeChangelog && <p className="text-xs text-muted mt-1">{upgradeChangelog}</p>}
              </div>
              <button
                type="button"
                data-testid="theme-upgrade-confirm"
                onClick={() => void upgradeCurrentTheme()}
                className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shrink-0 cursor-pointer"
              >
                {lang === 'zh' ? `确认升级到 v${latestVersion}` : `Upgrade to v${latestVersion}`}
              </button>
            </div>
          )}

          {/* Account Mode & Appearance Overrides */}
          <section className="rounded-xl border border-theme bg-surface-secondary/30 p-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-main">
                {lang === 'zh' ? '当前账号基础外观覆盖（独立持久保存）' : 'Account Appearance Overrides'}
              </h3>
              <div className="flex items-center gap-1 bg-surface border border-theme rounded-lg p-0.5">
                {(
                  [
                    { id: 'light', label: lang === 'zh' ? '浅色' : 'Light', icon: Sun },
                    { id: 'dark', label: lang === 'zh' ? '深色' : 'Dark', icon: Moon },
                    { id: 'auto', label: lang === 'zh' ? '自动' : 'Auto', icon: Monitor },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void setColorMode(id as ThemeColorMode)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                      colorMode === id ? 'bg-primary-theme text-white' : 'text-muted hover:text-main'
                    }`}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-muted font-medium block">{lang === 'zh' ? '强调色覆盖' : 'Accent Color'}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={lang === 'zh' ? '强调色覆盖' : 'Accent color override'}
                    value={appearanceOverrides.primaryColor || '#4f46e5'}
                    onChange={(e) =>
                      void setAppearanceOverrides({ ...appearanceOverrides, primaryColor: e.target.value })
                    }
                    className="h-8 w-10 rounded border border-theme bg-surface cursor-pointer"
                  />
                  {appearanceOverrides.primaryColor && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...appearanceOverrides };
                        delete next.primaryColor;
                        void setAppearanceOverrides(next);
                      }}
                      className="text-xs text-muted hover:text-main underline cursor-pointer"
                    >
                      {lang === 'zh' ? '清除' : 'Clear'}
                    </button>
                  )}
                </div>
              </label>

              <label className="space-y-1">
                <span className="text-muted font-medium block">{lang === 'zh' ? '组件圆角' : 'Corner Radius'}</span>
                <select
                  value={appearanceOverrides.borderRadius || ''}
                  onChange={(e) => {
                    const val = e.target.value as ThemeBorderRadius | '';
                    const next = { ...appearanceOverrides };
                    if (val) next.borderRadius = val;
                    else delete next.borderRadius;
                    void setAppearanceOverrides(next);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-theme bg-surface text-main text-xs"
                >
                  <option value="">{lang === 'zh' ? '跟随主题包默认' : 'Theme Default'}</option>
                  <option value="sharp">{lang === 'zh' ? '利落直角 (sharp)' : 'Sharp'}</option>
                  <option value="rounded">{lang === 'zh' ? '标准圆角 (rounded)' : 'Rounded'}</option>
                  <option value="pill">{lang === 'zh' ? '柔和胶囊 (pill)' : 'Pill'}</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-muted font-medium block">{lang === 'zh' ? '界面密度' : 'Layout Density'}</span>
                <select
                  value={appearanceOverrides.density || ''}
                  onChange={(e) => {
                    const val = e.target.value as ThemeDensity | '';
                    const next = { ...appearanceOverrides };
                    if (val) next.density = val;
                    else delete next.density;
                    void setAppearanceOverrides(next);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-theme bg-surface text-main text-xs"
                >
                  <option value="">{lang === 'zh' ? '跟随主题包默认' : 'Theme Default'}</option>
                  <option value="compact">{lang === 'zh' ? '紧凑 (compact)' : 'Compact'}</option>
                  <option value="comfortable">{lang === 'zh' ? '舒适 (comfortable)' : 'Comfortable'}</option>
                  <option value="spacious">{lang === 'zh' ? '宽松 (spacious)' : 'Spacious'}</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-muted font-medium block">
                  {lang === 'zh' ? '字号比例' : 'Font Scale'} ({appearanceOverrides.fontScale || 1}×)
                </span>
                <input
                  type="range"
                  min="0.85"
                  max="1.25"
                  step="0.05"
                  value={appearanceOverrides.fontScale || 1}
                  onChange={(e) =>
                    void setAppearanceOverrides({ ...appearanceOverrides, fontScale: Number(e.target.value) })
                  }
                  className="w-full accent-indigo-600 cursor-pointer"
                />
              </label>
            </div>
          </section>

          {/* Install Third-Party ZIP Package */}
          <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-dashed border-theme p-4 bg-surface">
            <div className="flex items-start gap-3">
              <PackageOpen size={20} className="text-primary-theme shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-main">
                  {lang === 'zh' ? '安装或更新第三方主题包 (.zip)' : 'Install / Update Theme Package (.zip)'}
                </div>
                <p className="text-xs text-muted mt-0.5">
                  {lang === 'zh'
                    ? '所有登录账号均可上传主题包至共享目录；同一主题 ID 仅限原上传者提交更高版本更新。'
                    : 'Any authenticated user may install packages; only the original author can publish version bumps.'}
                </p>
              </div>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                data-testid="theme-zip-upload-input"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-primary-theme text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Upload size={14} />
                {uploading
                  ? lang === 'zh'
                    ? '校验并安装中...'
                    : 'Installing...'
                  : lang === 'zh'
                    ? '上传主题包 (.zip)'
                    : 'Upload .zip'}
              </button>
            </div>
          </section>

          {/* Built-in themes */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
              {lang === 'zh' ? '系统内置主题' : 'Built-in Themes'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {BUILTIN_THEMES.map((item) => {
                const active = theme === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void selectTheme(item.id)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'border-primary-theme bg-primary-theme/10 ring-1 ring-primary-theme/40'
                        : 'border-theme bg-surface hover:bg-surface-secondary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="w-4 h-4 rounded-full border border-black/15"
                        style={{ backgroundColor: item.previewPrimary }}
                      />
                      {active && <Check size={14} className="text-primary-theme" />}
                    </div>
                    <div className="text-xs font-bold text-main mt-2">{item.label}</div>
                    <div className="text-xs text-muted mt-1 line-clamp-2">{item.description}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Shared third-party catalog */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
              {lang === 'zh'
                ? `平台共享第三方主题目录 (${catalog.length})`
                : `Shared Theme Catalog (${catalog.length})`}
            </h3>
            {catalog.length === 0 ? (
              <div className="rounded-xl border border-theme p-6 text-center text-xs text-muted bg-surface-secondary/20">
                {lang === 'zh'
                  ? '暂无已安装的第三方主题包。上传符合规范的 .zip 主题包即可实时预览与应用。'
                  : 'No third-party themes installed yet. Upload a .zip package above to get started.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {catalog.map((entry) => {
                  const isActive = theme === entry.id;
                  const isPreviewing = previewState?.themeId === entry.id;
                  const isDisabled = entry.status === 'disabled';
                  return (
                    <div
                      key={entry.id}
                      data-testid={`theme-catalog-card-${entry.id}`}
                      className={`rounded-xl border p-4 flex flex-col justify-between gap-3 ${
                        isActive ? 'border-primary-theme bg-primary-theme/5' : 'border-theme bg-surface'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {entry.previewImageUrl ? (
                          <img
                            src={entry.previewImageUrl}
                            alt={entry.name}
                            className="w-12 h-12 rounded-xl object-cover border border-theme shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl border border-theme bg-surface-secondary flex items-center justify-center shrink-0">
                            <Sparkles size={18} className="text-primary-theme" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-main truncate">{entry.name}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-secondary text-muted font-mono">
                              v{entry.latestVersion}
                            </span>
                            {isActive && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-primary-theme text-white font-semibold">
                                {lang === 'zh' ? '使用中' : 'Active'}
                              </span>
                            )}
                            {isDisabled && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 font-semibold flex items-center gap-1">
                                <ShieldAlert size={11} />
                                {lang === 'zh' ? '已停用' : 'Disabled'}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted mt-0.5">
                            {entry.author} · {entry.supportsModes.join(' / ')}
                            {entry.isOwner && (
                              <span className="ml-2 text-primary-theme font-medium">
                                ({lang === 'zh' ? '我上传的' : 'Yours'})
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted mt-1.5 line-clamp-2">{entry.description}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-theme-subtle">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {!isDisabled && entry.compatible && (
                            <>
                              <button
                                type="button"
                                disabled={busyId === entry.id}
                                onClick={() => (isPreviewing ? cancelPreview() : void handlePreviewThirdParty(entry))}
                                className="px-2.5 py-1.5 rounded-lg border border-theme text-xs font-medium text-main hover:bg-surface-secondary flex items-center gap-1 cursor-pointer"
                              >
                                <Eye size={13} />
                                {isPreviewing
                                  ? lang === 'zh'
                                    ? '退出预览'
                                    : 'Stop Preview'
                                  : lang === 'zh'
                                    ? '预览'
                                    : 'Preview'}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === entry.id}
                                onClick={() => void handleApplyThirdParty(entry)}
                                className="px-2.5 py-1.5 rounded-lg bg-primary-theme text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Check size={13} />
                                {lang === 'zh' ? '应用' : 'Apply'}
                              </button>
                            </>
                          )}
                          <a
                            href={getThemeExportUrl(entry.id, entry.latestVersion)}
                            download
                            className="px-2.5 py-1.5 rounded-lg border border-theme text-xs font-medium text-muted hover:text-main hover:bg-surface-secondary flex items-center gap-1"
                          >
                            <Download size={13} />
                            {lang === 'zh' ? '导出' : 'Export'}
                          </a>
                        </div>

                        {isAdmin && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyId === entry.id}
                              onClick={() => void handleAdminToggleDisable(entry)}
                              className="px-2.5 py-1 rounded-lg border border-amber-500/40 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                            >
                              {isDisabled
                                ? lang === 'zh'
                                  ? '恢复启用'
                                  : 'Enable'
                                : lang === 'zh'
                                  ? '停用'
                                  : 'Disable'}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === entry.id}
                              onClick={() => void handleAdminDelete(entry)}
                              aria-label={lang === 'zh' ? `删除 ${entry.name}` : `Delete ${entry.name}`}
                              className="p-1.5 rounded-lg border border-rose-500/30 text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </dialog>
  );
}
