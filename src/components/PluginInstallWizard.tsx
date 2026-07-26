import React, { useMemo, useState, useEffect } from 'react';
import { Shield, Sparkles, AlertTriangle, ChevronLeft, ChevronRight, X, Loader2, CheckCircle } from 'lucide-react';
import JSZip from 'jszip';

export type ZipInstallOptions = {
  mode: 'install' | 'update';
  targetPluginId?: string;
  allowDowngrade?: boolean;
};

interface InstalledPluginSummary {
  id: string;
  name: string;
  status: string;
  manifest: string;
  version?: string;
}

interface PluginInstallWizardProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'zh' | 'en';
  file: File | null;
  /** When set, wizard is locked to updating this DB plugin id (card "Update"). */
  lockedTargetPluginId?: string | null;
  installedPlugins?: InstalledPluginSummary[];
  onConfirmInstall: (
    file: File,
    executionMode: 'worker' | 'inline',
    opts?: ZipInstallOptions,
  ) => Promise<void>;
}

interface DetectedExtensionPoint {
  slot: string;
  id: string;
  label: string;
  source: 'manifest' | 'frontend';
}

/** Decode JS string-literal escapes produced by bundlers (\uXXXX, \u{...}, \xXX, \\). */
function decodeJsStringLiteral(raw: string): string {
  return raw
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function pickLabel(entry: Record<string, unknown> | null | undefined, fallback: string): string {
  if (!entry) return fallback;
  for (const key of ['label', 'name', 'title', 'displayName'] as const) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

/** Collect extension points declared in manifest.contributes / classroomTools (UTF-8, preferred). */
function extractFromManifest(manifest: any): DetectedExtensionPoint[] {
  if (!manifest || typeof manifest !== 'object') return [];
  const panels: DetectedExtensionPoint[] = [];
  const seen = new Set<string>();

  const push = (slot: string, id: string, label: string) => {
    const key = `${slot}::${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    panels.push({ slot, id, label: label || id || slot, source: 'manifest' });
  };

  const contributes = manifest.contributes;
  if (contributes && typeof contributes === 'object') {
    for (const [slot, configs] of Object.entries(contributes)) {
      if (!Array.isArray(configs)) continue;
      for (const raw of configs) {
        const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const id = typeof entry.id === 'string' ? entry.id : '?';
        push(slot, id, pickLabel(entry, id));
      }
    }
  }

  // Legacy classroomTools → classroom.tool
  if (Array.isArray(manifest.classroomTools)) {
    for (const raw of manifest.classroomTools) {
      const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const id = typeof entry.id === 'string' ? entry.id : '?';
      push('classroom.tool', id, pickLabel(entry, id));
    }
  }

  return panels;
}

/** Static-analyze frontend.js registerExtensionPoint calls; decode \uXXXX labels. */
function extractFromFrontendJs(jsContent: string): DetectedExtensionPoint[] {
  if (!jsContent) return [];
  const panels: DetectedExtensionPoint[] = [];
  // Allow nested braces up to one level so multi-field configs still match
  const epRegex =
    /registerExtensionPoint\s*\(\s*['"]([^'"]+)['"]\s*,\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = epRegex.exec(jsContent)) !== null) {
    const slot = decodeJsStringLiteral(match[1]);
    const configStr = match[2];
    const idMatch = configStr.match(/\bid\s*:\s*['"]([^'"]*)['"]/);
    const labelMatch = configStr.match(/\blabel\s*:\s*['"]([^'"]*)['"]/);
    const nameMatch = configStr.match(/\bname\s*:\s*['"]([^'"]*)['"]/);
    const id = decodeJsStringLiteral(idMatch?.[1] || '?');
    const rawLabel = labelMatch?.[1] ?? nameMatch?.[1] ?? id;
    panels.push({
      slot,
      id,
      label: decodeJsStringLiteral(rawLabel) || id || slot,
      source: 'frontend',
    });
  }
  return panels;
}

function mergeExtensionPoints(
  fromManifest: DetectedExtensionPoint[],
  fromFrontend: DetectedExtensionPoint[],
): DetectedExtensionPoint[] {
  const merged = new Map<string, DetectedExtensionPoint>();
  // Manifest first (authoritative UTF-8 labels)
  for (const p of fromManifest) {
    merged.set(`${p.slot}::${p.id}`, p);
  }
  // Frontend fills gaps / richer runtime registrations
  for (const p of fromFrontend) {
    const key = `${p.slot}::${p.id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, p);
      continue;
    }
    // Prefer a human label from either side; keep manifest source if present
    const betterLabel =
      existing.label && existing.label !== existing.id && existing.label !== existing.slot
        ? existing.label
        : p.label;
    merged.set(key, { ...existing, label: betterLabel || existing.label });
  }
  return Array.from(merged.values());
}

const TEACHER_SLOTS = new Set([
  'teacher.tab',
  'teacher.dashboard.widget',
  'workspace.view',
  'classroom.tool',
  'command.palette',
]);
const STUDENT_SLOTS = new Set(['student.view', 'student.dashboard.widget']);

function coerceSemver(v: string | undefined | null): string {
  if (!v || typeof v !== 'string') return '0.0.0';
  const m = v.trim().match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return '0.0.0';
  return `${m[1]}.${m[2] || '0'}.${m[3] || '0'}`;
}

function compareSemver(a: string, b: string): number {
  const pa = coerceSemver(a).split('.').map((x) => parseInt(x, 10));
  const pb = coerceSemver(b).split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

export function PluginInstallWizard({
  isOpen,
  onClose,
  lang,
  file,
  onConfirmInstall,
  lockedTargetPluginId = null,
  installedPlugins = [],
}: PluginInstallWizardProps) {
  const [step, setStep] = useState(0);
  const [manifest, setManifest] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [zipFiles, setZipFiles] = useState<Array<{ name: string; size: number }>>([]);
  const [contributes, setContributes] = useState<any>(null);
  const [hasFrontend, setHasFrontend] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [executionMode, setExecutionMode] = useState<'worker' | 'inline'>('worker');
  const [zipObj, setZipObj] = useState<JSZip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);

  // Extension-point preview state (static analysis — not a live sandbox)
  const [previewRole, setPreviewRole] = useState<'teacher' | 'student'>('teacher');
  const [registeredPanels, setRegisteredPanels] = useState<DetectedExtensionPoint[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Upgrade detection
  const [existingInstall, setExistingInstall] = useState<{
    pluginId: string;
    name: string;
    version: string;
    status: string;
    isSystem: boolean;
    manifestId: string;
  } | null>(null);
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const [confirmInUse, setConfirmInUse] = useState(false);

  useEffect(() => {
    if (isOpen && file) {
      setStep(0);
      setManifest(null);
      setCapabilities([]);
      setContributes(null);
      setHasFrontend(false);
      setAgreedToTerms(false);
      setExecutionMode('worker');
      setZipObj(null);
      setError(null);
      setRegisteredPanels([]);
      setZipFiles([]);
      setPreviewRole('teacher');
      setExistingInstall(null);
      setAllowDowngrade(false);
      setConfirmInUse(false);
      parseZip(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, file]);

  const parseZip = async (zipFile: File) => {
    setProcessing(true);
    setError(null);
    try {
      const zip = await JSZip.loadAsync(zipFile);
      setZipObj(zip);

      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        throw new Error(lang === 'zh' ? 'ZIP 包中缺少 manifest.json 声明文件' : 'manifest.json missing in ZIP package');
      }

      const content = await manifestFile.async('string');
      const parsed = JSON.parse(content);

      if (!parsed.id || !parsed.name) {
        throw new Error(lang === 'zh' ? 'manifest.json 缺少必填字段 id 或 name' : 'manifest.json missing required id or name field');
      }

      setManifest(parsed);
      setCapabilities(parsed.capabilitiesProposed || []);
      setContributes(parsed.contributes || null);
      setHasFrontend(!!zip.file('frontend.js'));

      // Seed extension points from manifest immediately (UTF-8 labels)
      setRegisteredPanels(extractFromManifest(parsed));

      // If this is a worker-based executionMode by default
      if (parsed.executionMode === 'inline') {
        setExecutionMode('inline');
      }

      // Detect same-id install for upgrade path
      await detectExistingInstall(parsed);
    } catch (err: any) {
      setError(err.message || 'ZIP parse error');
    } finally {
      setProcessing(false);
    }
  };

  const detectExistingInstall = async (parsed: any) => {
    setExistingInstall(null);
    setAllowDowngrade(false);
    setConfirmInUse(false);
    if (!parsed?.id) return;

    // Card "Update": lock to a specific plugin row
    if (lockedTargetPluginId) {
      const local = installedPlugins.find((p) => p.id === lockedTargetPluginId);
      let localManifest: any = null;
      try {
        localManifest = local ? JSON.parse(local.manifest) : null;
      } catch {
        localManifest = null;
      }
      if (localManifest?.id && localManifest.id !== parsed.id) {
        setError(
          lang === 'zh'
            ? `ZIP 的插件 ID（${parsed.id}）与当前卡片（${localManifest.id}）不一致，无法更新。`
            : `ZIP manifest.id (${parsed.id}) does not match this plugin (${localManifest.id}).`,
        );
        return;
      }
      if (String(parsed.id).startsWith('@openlearn/')) {
        setError(lang === 'zh' ? '系统核心插件禁止通过插件中心更新。' : 'System plugins cannot be updated here.');
        return;
      }
      setExistingInstall({
        pluginId: lockedTargetPluginId,
        name: local?.name || localManifest?.name || parsed.name,
        version: local?.version || localManifest?.version || '0.0.0',
        status: local?.status || 'unknown',
        isSystem: false,
        manifestId: parsed.id,
      });
      return;
    }

    // Prefer local list (already loaded in Plugin Center)
    const fromList = installedPlugins.find((p) => {
      try {
        return JSON.parse(p.manifest)?.id === parsed.id;
      } catch {
        return false;
      }
    });
    if (fromList) {
      let m: any = {};
      try {
        m = JSON.parse(fromList.manifest);
      } catch {
        m = {};
      }
      if (String(parsed.id).startsWith('@openlearn/') || fromList.id.startsWith('@openlearn/')) {
        setError(lang === 'zh' ? '系统核心插件禁止通过插件中心更新。' : 'System plugins cannot be updated here.');
        return;
      }
      setExistingInstall({
        pluginId: fromList.id,
        name: fromList.name || m.name || parsed.name,
        version: fromList.version || m.version || '0.0.0',
        status: fromList.status,
        isSystem: false,
        manifestId: parsed.id,
      });
      return;
    }

    // Fallback API lookup
    try {
      const res = await fetch(`/api/plugins/by-manifest/${encodeURIComponent(parsed.id)}`);
      const data = await res.json();
      if (data?.success && data.installed) {
        if (data.isSystem) {
          setError(lang === 'zh' ? '系统核心插件禁止通过插件中心更新。' : 'System plugins cannot be updated here.');
          return;
        }
        setExistingInstall({
          pluginId: data.pluginId,
          name: data.name,
          version: data.version || '0.0.0',
          status: data.status,
          isSystem: !!data.isSystem,
          manifestId: parsed.id,
        });
      }
    } catch (e) {
      console.warn('Failed to detect existing plugin install', e);
    }
  };

  // Enrich extension-point list when entering the preview step
  useEffect(() => {
    if (step !== 3 || !zipObj) return;

    let cancelled = false;
    (async () => {
      setPreviewLoading(true);
      try {
        const frontendJsFile = zipObj.file('frontend.js');
        const jsContent = frontendJsFile ? await frontendJsFile.async('string') : '';
        const fromManifest = extractFromManifest(manifest);
        const fromFrontend = extractFromFrontendJs(jsContent);
        if (cancelled) return;
        setRegisteredPanels(mergeExtensionPoints(fromManifest, fromFrontend));

        setZipFiles([
          {
            name: 'index.js',
            size: zipObj.file('index.js') ? (await zipObj.file('index.js')!.async('string')).length : 0,
          },
          { name: 'frontend.js', size: jsContent.length },
          {
            name: 'manifest.json',
            size: zipObj.file('manifest.json') ? (await zipObj.file('manifest.json')!.async('string')).length : 0,
          },
        ]);
      } catch (e) {
        console.warn('Extension point preview failed:', e);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, zipObj, manifest, hasFrontend]);

  const filteredPanels = useMemo(() => {
    const slotSet = previewRole === 'teacher' ? TEACHER_SLOTS : STUDENT_SLOTS;
    const matched = registeredPanels.filter((p) => slotSet.has(p.slot));
    // If role filter empties the list, fall back to all so user still sees detections
    return matched.length > 0 ? matched : registeredPanels;
  }, [registeredPanels, previewRole]);

  const isUpgrade = !!existingInstall;
  const isDowngrade =
    isUpgrade && compareSemver(manifest?.version || '0.0.0', existingInstall!.version) < 0;
  const isInUse =
    isUpgrade &&
    existingInstall!.status === 'active' &&
    (registeredPanels.some((p) =>
      ['classroom.tool', 'student.view', 'teacher.tab', 'workspace.view'].includes(p.slot),
    ) ||
      !!(manifest?.classroomTools && manifest.classroomTools.length > 0) ||
      !!(manifest?.contributes && Object.keys(manifest.contributes).length > 0));

  const canProceedInstall = (() => {
    if (!file || !manifest) return false;
    if (existingInstall?.isSystem) return false;
    if (isDowngrade && !allowDowngrade) return false;
    if (isInUse && !confirmInUse) return false;
    return true;
  })();

  const handleInstall = async () => {
    if (!file || !canProceedInstall) return;
    setInstalling(true);
    setError(null);
    setProgressPct(10);
    setProgressMsg(
      lang === 'zh'
        ? isUpgrade
          ? '正在上传并更新...'
          : '正在上传并安装...'
        : isUpgrade
          ? 'Uploading and updating...'
          : 'Uploading and installing...',
    );
    try {
      await onConfirmInstall(file, executionMode, {
        mode: isUpgrade ? 'update' : 'install',
        targetPluginId: existingInstall?.pluginId,
        allowDowngrade: isDowngrade ? allowDowngrade : false,
      });
      setProgressPct(100);
      setProgressMsg(lang === 'zh' ? (isUpgrade ? '更新完成' : '安装完成') : isUpgrade ? 'Updated' : 'Complete');
      onClose();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || (lang === 'zh' ? (isUpgrade ? '更新失败' : '安装失败') : isUpgrade ? 'Update failed' : 'Installation failed'));
      setProgressPct(0);
      setProgressMsg('');
    } finally {
      setInstalling(false);
    }
  };

  if (!isOpen) return null;

  // Determine risk profile of capability
  const getRiskBadge = (cap: string) => {
    const high = ['db:schema', 'management:write', 'network:access'];
    const med = ['whiteboard:write', 'vfs:write'];

    if (high.includes(cap)) {
      return {
        label: lang === 'zh' ? '🔴 高危' : '🔴 High',
        desc:
          lang === 'zh'
            ? '可读写数据库、获取网络数据，存在敏感信息暴露风险。'
            : 'Can read/write DB or access network, sensitive data risk.',
      };
    }
    if (med.includes(cap)) {
      return {
        label: lang === 'zh' ? '🟡 中危' : '🟡 Medium',
        desc:
          lang === 'zh'
            ? '可在课表、白板中进行绘制或执行教学环节操作。'
            : 'Can write to whiteboards or control course schedules.',
      };
    }
    return {
      label: lang === 'zh' ? '🟢 低危' : '🟢 Low',
      desc:
        lang === 'zh'
          ? '常规的基础界面弹窗与局域隔离存储能力。'
          : 'Basic UI elements or isolated local storage.',
    };
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center overflow-y-auto select-none"
      style={{ zIndex: 9999 }}
    >
      <div className="bg-white border border-slate-200 shadow-2xl rounded-2xl w-full max-w-2xl p-6 md:p-7 relative flex flex-col justify-between max-h-[90vh]">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-100 pb-4 shrink-0">
          <h2 className="font-extrabold text-base md:text-lg text-slate-800 flex items-center gap-2">
            <Shield className="text-indigo-600 animate-pulse" size={20} />
            {lang === 'zh'
              ? `${isUpgrade ? '三方插件更新向导' : '三方插件安装向导'} (${step + 1}/5)`
              : `${isUpgrade ? 'Plugin Update Wizard' : 'Plugin Setup Wizard'} (${step + 1}/5)`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-650 cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* Core Wizard step content */}
        <div className="flex-1 overflow-y-auto py-5 min-h-[300px]">
          {processing ? (
            <div className="flex flex-col items-center justify-center py-20 text-indigo-600 gap-2">
              <Loader2 size={36} className="animate-spin" />
              <span className="text-sm font-semibold">
                {lang === 'zh' ? '正在解压并审计文件...' : 'Extracting and auditing package...'}
              </span>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 flex items-start gap-2.5">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">{lang === 'zh' ? '校验未通过，安装中断' : 'Verification Failed'}</h4>
                <p className="text-xs mt-1 leading-relaxed">{error}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Step 1: Validation metadata */}
              {step === 0 && manifest && (
                <div className="flex flex-col gap-4">
                  <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex gap-4">
                    <div className="w-12 h-12 bg-indigo-600 text-white rounded-lg flex items-center justify-center shrink-0 shadow-sm font-bold text-lg uppercase">
                      {manifest.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-slate-900 text-base">{manifest.name}</h3>
                      <p className="text-[10px] font-mono text-gray-500 mt-1">
                        ID: {manifest.id} | v{manifest.version || '1.0.0'}
                      </p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-700 text-xs mb-1.5">{lang === 'zh' ? '功能描述' : 'Description'}</h4>
                    <p className="text-xs text-gray-600 leading-relaxed bg-slate-50 border border-slate-100 p-3 rounded-lg font-medium">
                      {manifest.description ||
                        (lang === 'zh' ? '该插件暂无详细描述信息。' : 'No description provided for this plugin.')}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/30">
                      <span className="text-[10px] text-gray-400 block font-semibold">
                        {lang === 'zh' ? '主程序入口' : 'Main Entry'}
                      </span>
                      <span className="text-xs font-bold text-slate-700 font-mono mt-0.5 block">
                        {manifest.main || 'index.js'}
                      </span>
                    </div>
                    <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/30">
                      <span className="text-[10px] text-gray-400 block font-semibold">
                        {lang === 'zh' ? '前端沙箱包' : 'Frontend UI Asset'}
                      </span>
                      <span
                        className={`text-xs font-bold mt-0.5 block ${hasFrontend ? 'text-indigo-600' : 'text-gray-500'}`}
                      >
                        {hasFrontend
                          ? lang === 'zh'
                            ? '包含 (frontend.js)'
                            : 'Included (frontend.js)'
                          : lang === 'zh'
                            ? '无'
                            : 'None'}
                      </span>
                    </div>
                  </div>

                  {existingInstall && (
                    <div
                      className={`mt-1 rounded-xl border p-4 ${
                        isDowngrade ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/40'
                      }`}
                    >
                      <h4 className="text-xs font-extrabold text-slate-800 mb-2">
                        {lang === 'zh' ? '检测到已安装同一插件 — 将执行原地更新' : 'Same plugin already installed — in-place update'}
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-white/70 border border-slate-100 rounded-lg p-2">
                          <div className="text-slate-400 font-semibold">{lang === 'zh' ? '当前版本' : 'Installed'}</div>
                          <div className="font-bold text-slate-800 mt-0.5">
                            {existingInstall.name}
                            <span className="font-mono text-slate-500 ml-1">v{existingInstall.version}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 font-mono">
                            {existingInstall.status === 'active'
                              ? lang === 'zh'
                                ? '状态: 运行中'
                                : 'status: active'
                              : lang === 'zh'
                                ? '状态: 未启用'
                                : 'status: inactive'}
                          </div>
                        </div>
                        <div className="bg-white/70 border border-slate-100 rounded-lg p-2">
                          <div className="text-slate-400 font-semibold">{lang === 'zh' ? 'ZIP 新版本' : 'Package'}</div>
                          <div className="font-bold text-slate-800 mt-0.5">
                            {manifest.name}
                            <span className="font-mono text-indigo-600 ml-1">v{manifest.version || '0.0.0'}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            {lang === 'zh' ? '保留配置 / 业务数据 / UUID' : 'Keeps config, data & UUID'}
                          </div>
                        </div>
                      </div>
                      {isDowngrade && (
                        <label className="mt-3 flex items-start gap-2 text-[11px] font-bold text-red-700 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={allowDowngrade}
                            onChange={(e) => setAllowDowngrade(e.target.checked)}
                          />
                          <span>
                            {lang === 'zh'
                              ? `确认强制降级：v${existingInstall.version} → v${manifest.version || '0.0.0'}（可能不兼容）`
                              : `Force downgrade v${existingInstall.version} → v${manifest.version || '0.0.0'} (may be incompatible)`}
                          </span>
                        </label>
                      )}
                      {isInUse && (
                        <label className="mt-2 flex items-start gap-2 text-[11px] font-bold text-amber-800 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={confirmInUse}
                            onChange={(e) => setConfirmInUse(e.target.checked)}
                          />
                          <span>
                            {lang === 'zh'
                              ? '该插件当前为启用状态且声明了课堂/教学扩展点，热更新可能导致课中 UI 短暂异常。我已知晓并继续。'
                              : 'Plugin is active with classroom UI contributions. Hot-update may briefly disrupt live class UI. I understand.'}
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Capabilities / Permissions */}
              {step === 1 && (
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-slate-500 font-medium mb-1">
                    {lang === 'zh'
                      ? '此插件申请了以下系统权限，请仔细评估安装后可能产生的风控隐患：'
                      : 'This plugin requests the following capabilities, please review carefully:'}
                  </p>

                  {capabilities.length === 0 ? (
                    <div className="text-center p-8 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 font-bold text-xs">
                      {lang === 'zh'
                        ? '✓ 该插件未申请任何敏感系统权限，可安全安装。'
                        : '✓ This plugin requires no system capabilities, very safe.'}
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                      {capabilities.map((cap) => {
                        const risk = getRiskBadge(cap);
                        return (
                          <div
                            key={cap}
                            className="border border-slate-100 rounded-xl p-3 flex flex-col gap-1 hover:border-slate-200 bg-slate-55/10"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-slate-800 bg-white border border-slate-150 rounded px-1.5 py-0.5">
                                {cap}
                              </span>
                              <span className="text-[10px] font-extrabold">{risk.label}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-normal font-medium mt-1">{risk.desc}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {capabilities.length > 0 && (
                    <label className="flex items-start gap-2 border border-orange-100 rounded-xl p-3 bg-orange-50/30 cursor-pointer mt-2 text-[11px] text-orange-850 font-bold leading-normal">
                      <input
                        type="checkbox"
                        checked={agreedToTerms}
                        onChange={(e) => setAgreedToTerms(e.target.checked)}
                        className="mt-0.5 w-3.5 h-3.5 rounded text-orange-600 border-orange-300 focus:ring-orange-500 cursor-pointer shrink-0"
                      />
                      <span>
                        {lang === 'zh'
                          ? '我已了解并信任此插件的提供商，愿意授予上述高级系统权限。'
                          : 'I trust the developer and agree to grant all requested capabilities.'}
                      </span>
                    </label>
                  )}
                </div>
              )}

              {/* Step 3: Extension points contributes */}
              {step === 2 && (
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-slate-500 font-medium">
                    {lang === 'zh'
                      ? '插件将向系统注册并扩展以下槽位（Slots）与自定义命令：'
                      : 'The plugin will inject UI slots or register custom commands:'}
                  </p>

                  <div className="border border-slate-150/65 rounded-xl p-4 bg-slate-50/50 space-y-4">
                    {contributes ? (
                      <>
                        {contributes.teacher?.dashboard?.widget && (
                          <div className="text-xs">
                            <span className="font-bold text-slate-700 block mb-1">插槽: 教师端侧栏卡片</span>
                            <span className="text-gray-500 font-mono">
                              teacher.dashboard.widget → {contributes.teacher.dashboard.widget}
                            </span>
                          </div>
                        )}
                        {contributes.student?.view && (
                          <div className="text-xs">
                            <span className="font-bold text-slate-700 block mb-1">插槽: 学生答题看板</span>
                            <span className="text-gray-500 font-mono">student.view → {contributes.student.view}</span>
                          </div>
                        )}

                        {manifest.capabilitiesProposed && manifest.capabilitiesProposed.length > 0 && (
                          <div className="text-xs border-t border-slate-100 pt-3">
                            <span className="font-bold text-slate-700 block mb-1">
                              {lang === 'zh' ? '注册指令集' : 'Commands Registered'}
                            </span>
                            <div className="flex gap-1.5 flex-wrap">
                              {manifest.capabilitiesProposed.map((c: string) => (
                                <span
                                  key={c}
                                  className="bg-indigo-50 border border-indigo-150/60 rounded px-1.5 py-0.5 text-indigo-700 font-mono"
                                >
                                  {c.replace(':write', '.create')}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center text-xs text-slate-400 italic py-6">
                        {lang === 'zh'
                          ? '此插件没有提供任何额外的槽位注册项。'
                          : 'This plugin contributes no extension points.'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 4: Detected extension points (static preview) */}
              {step === 3 && (
                <div className="flex flex-col gap-3 h-full">
                  <div className="flex items-center justify-between shrink-0 gap-3">
                    <p className="text-xs text-slate-500 font-semibold">
                      {lang === 'zh' ? '检测到的扩展点（静态分析预览）：' : 'Detected extension points (static analysis):'}
                    </p>
                    <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPreviewRole('teacher')}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                          previewRole === 'teacher'
                            ? 'bg-white shadow text-indigo-650'
                            : 'text-slate-550 hover:text-slate-800'
                        }`}
                      >
                        {lang === 'zh' ? '教师端相关' : 'Teacher slots'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewRole('student')}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                          previewRole === 'student'
                            ? 'bg-white shadow text-indigo-650'
                            : 'text-slate-550 hover:text-slate-800'
                        }`}
                      >
                        {lang === 'zh' ? '学生端相关' : 'Student slots'}
                      </button>
                    </div>
                  </div>

                  <div className="border border-slate-200/80 rounded-xl p-4 bg-slate-50/50 flex-grow overflow-auto min-h-[220px] max-h-[300px]">
                    <div className="h-full bg-white rounded-lg p-4 border border-slate-100 shadow-sm">
                      {previewLoading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-2 text-indigo-600">
                          <Loader2 size={22} className="animate-spin" />
                          <span className="text-xs font-semibold">
                            {lang === 'zh' ? '正在分析扩展点…' : 'Analyzing extension points…'}
                          </span>
                        </div>
                      ) : filteredPanels.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-center text-xs text-slate-400 italic px-4">
                          {lang === 'zh'
                            ? '未检测到扩展点注册（manifest.contributes / frontend.js）。'
                            : 'No extension points detected in manifest or frontend.js.'}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          <div className="text-[11px] font-semibold text-slate-500">
                            {lang === 'zh'
                              ? `共 ${filteredPanels.length} 项（按「${previewRole === 'teacher' ? '教师端' : '学生端'}」筛选）`
                              : `${filteredPanels.length} item(s) for ${previewRole} view`}
                          </div>
                          <ul className="space-y-2">
                            {filteredPanels.map((p) => (
                              <li
                                key={`${p.source}-${p.slot}-${p.id}`}
                                className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm font-bold text-slate-800 truncate">{p.label}</div>
                                  <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
                                    {p.slot}
                                    {p.id && p.id !== '?' ? ` · ${p.id}` : ''}
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                    p.source === 'manifest'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                      : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                  }`}
                                >
                                  {p.source === 'manifest'
                                    ? lang === 'zh'
                                      ? 'manifest'
                                      : 'manifest'
                                    : 'frontend.js'}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {zipFiles.length > 0 && (
                            <div className="pt-2 border-t border-slate-100">
                              <div className="text-[10px] font-semibold text-slate-400 mb-1">
                                {lang === 'zh' ? '包内文件' : 'Package files'}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {zipFiles.map((f) => (
                                  <span
                                    key={f.name}
                                    className="text-[10px] font-mono bg-white border border-slate-150 rounded px-1.5 py-0.5 text-slate-600"
                                  >
                                    {f.name}
                                    {f.size > 0 ? ` (${Math.max(1, Math.round(f.size / 1024))} KB)` : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] text-gray-550 font-medium shrink-0 bg-indigo-50/40 p-2 border border-indigo-100/40 rounded-lg">
                    <Sparkles size={11} className="text-indigo-600" />
                    <span>
                      {lang === 'zh'
                        ? '此步骤为静态扫描结果，不会执行插件代码。中文标签已从 JS 转义序列还原；优先展示 manifest 声明，frontend.js 作为补充。'
                        : 'Static scan only — plugin code is not executed. Unicode escapes in JS labels are decoded; manifest entries take priority over frontend.js.'}
                    </span>
                  </div>
                </div>
              )}

              {/* Step 5: Sandbox config */}
              {step === 4 && (
                <div className="flex flex-col gap-4">
                  {existingInstall && (
                    <div
                      className={`rounded-xl border p-3 text-[11px] ${
                        isDowngrade ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/50'
                      }`}
                    >
                      <div className="font-extrabold text-slate-800 mb-1">
                        {lang === 'zh'
                          ? `更新确认：v${existingInstall.version} → v${manifest?.version || '0.0.0'}`
                          : `Update: v${existingInstall.version} → v${manifest?.version || '0.0.0'}`}
                      </div>
                      <div className="text-slate-600">
                        {lang === 'zh'
                          ? '将原地替换代码与静态资源，保留 UUID、配置与业务数据。'
                          : 'Replaces code/assets in place. UUID, config and data are preserved.'}
                      </div>
                      {isDowngrade && (
                        <label className="mt-2 flex items-start gap-2 font-bold text-red-700 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={allowDowngrade}
                            onChange={(e) => setAllowDowngrade(e.target.checked)}
                          />
                          <span>{lang === 'zh' ? '确认强制降级' : 'Confirm forced downgrade'}</span>
                        </label>
                      )}
                      {isInUse && (
                        <label className="mt-2 flex items-start gap-2 font-bold text-amber-800 cursor-pointer">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={confirmInUse}
                            onChange={(e) => setConfirmInUse(e.target.checked)}
                          />
                          <span>
                            {lang === 'zh'
                              ? '已知晓课中热更新风险'
                              : 'I accept live-class hot-update risk'}
                          </span>
                        </label>
                      )}
                      {!canProceedInstall && (
                        <p className="mt-2 text-red-600 font-semibold">
                          {lang === 'zh'
                            ? '请先完成上方确认项后再更新。'
                            : 'Complete the confirmation checks above before updating.'}
                        </p>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-slate-500 font-medium">
                    {lang === 'zh'
                      ? '设置该插件启动时的微前端沙箱执行模式：'
                      : 'Configure micro-frontend sandbox execution model:'}
                  </p>

                  <div className="space-y-3">
                    <label
                      className={`border rounded-xl p-4 flex gap-3 cursor-pointer transition-all ${
                        executionMode === 'worker'
                          ? 'bg-indigo-50/40 border-indigo-300 shadow-xs'
                          : 'border-slate-150 hover:border-indigo-200 bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="sandbox_mode"
                        checked={executionMode === 'worker'}
                        onChange={() => setExecutionMode('worker')}
                        className="mt-1 w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500 cursor-pointer shrink-0"
                      />
                      <div>
                        <h4 className="font-extrabold text-xs md:text-sm text-slate-800">
                          {lang === 'zh' ? 'Worker 强沙箱隔离模式 (推荐)' : 'Worker Sandbox Isolation (Recommended)'}
                        </h4>
                        <p className="text-[11px] text-slate-550 mt-1 leading-normal font-medium">
                          {lang === 'zh'
                            ? '插件代码在独立的后台 Worker 线程中加载运行。即便发生死循环、崩溃抛错也不会株连系统主服务崩溃，安全性最高。'
                            : "Loads in isolated background worker threads. Uncaught plugin errors won't crash main system."}
                        </p>
                      </div>
                    </label>

                    <label
                      className={`border rounded-xl p-4 flex gap-3 cursor-pointer transition-all ${
                        executionMode === 'inline'
                          ? 'bg-indigo-50/40 border-indigo-300 shadow-xs'
                          : 'border-slate-150 hover:border-indigo-200 bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="sandbox_mode"
                        checked={executionMode === 'inline'}
                        onChange={() => setExecutionMode('inline')}
                        className="mt-1 w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500 cursor-pointer shrink-0"
                      />
                      <div>
                        <h4 className="font-extrabold text-xs md:text-sm text-slate-800">
                          {lang === 'zh' ? 'VM Inline 主进程运行模式' : 'VM Inline Execution'}
                        </h4>
                        <p className="text-[11px] text-slate-550 mt-1 leading-normal font-medium">
                          {lang === 'zh'
                            ? '插件在主进程上下文中运行，执行性能极高。但如果代码发生不可捕获错误，可能会造成服务崩溃，适合受信任的代码。'
                            : 'Runs in host process, higher execution speed. Uncaught plugin failures might cause host server to stop.'}
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-4 shrink-0">
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-4 bg-indigo-650' : 'w-1.5 bg-slate-200'}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((prev) => prev - 1)}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <ChevronLeft size={12} />
                {lang === 'zh' ? '上一步' : 'Back'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
            )}

            {step === 1 && capabilities.length > 0 && !agreedToTerms ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-200 text-gray-400 rounded-lg text-xs font-semibold cursor-not-allowed"
              >
                {lang === 'zh' ? '请先授权同意' : 'Accept terms first'}
                <ChevronRight size={12} />
              </button>
            ) : step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((prev) => prev + 1)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '下一步' : 'Next'}
                <ChevronRight size={12} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleInstall}
                disabled={installing || !canProceedInstall}
                className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:bg-indigo-400"
              >
                {installing ? (
                  <div className="flex flex-col gap-1.5 min-w-32">
                    <div className="flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin" />
                      <span>
                        {lang === 'zh' ? (isUpgrade ? '更新中...' : '安装中...') : isUpgrade ? 'Updating...' : 'Installing...'}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-indigo-400/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white/80 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(progressPct, 5)}%` }}
                      />
                    </div>
                    {progressMsg && (
                      <div className="text-[10px] text-indigo-200 truncate max-w-40">
                        {progressPct}% — {progressMsg}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <CheckCircle size={13} />
                    {lang === 'zh'
                      ? isUpgrade
                        ? '确认更新并上传'
                        : '确认安装并上传'
                      : isUpgrade
                        ? 'Confirm & Update'
                        : 'Confirm & Install'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
