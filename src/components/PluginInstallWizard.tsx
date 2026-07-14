import React, { useState, useEffect, useRef } from 'react';
import { Shield, Sparkles, AlertTriangle, Play, ChevronLeft, ChevronRight, X, Loader2, CheckCircle, HelpCircle } from 'lucide-react';
import JSZip from 'jszip';

interface PluginInstallWizardProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'zh' | 'en';
  file: File | null;
  onConfirmInstall: (file: File, executionMode: 'worker' | 'inline') => Promise<void>;
}

export function PluginInstallWizard({ isOpen, onClose, lang, file, onConfirmInstall }: PluginInstallWizardProps) {
  const [step, setStep] = useState(0);
  const [manifest, setManifest] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [contributes, setContributes] = useState<any>(null);
  const [hasFrontend, setHasFrontend] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [executionMode, setExecutionMode] = useState<'worker' | 'inline'>('worker');
  const [zipObj, setZipObj] = useState<JSZip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [installing, setInstalling] = useState(false);

  // UI Preview States
  const [previewRole, setPreviewRole] = useState<'teacher' | 'student'>('teacher');
  const [registeredPanels, setRegisteredPanels] = useState<any[]>([]);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Mock database element data for the Live UI Preview
  const [mockData, setMockData] = useState<any>({
    question: '这是一道用于 UI 预览的选择题，你觉得这个向导如何？',
    options: ['A. 极具科技感，惊艳', 'B. 流程清晰，安全有保障', 'C. 能够实时预览，非常赞', 'D. 都是'],
    quiz_score: {
      'A. 极具科技感，惊艳': 5,
      'B. 流程清晰，安全有保障': 3,
      'C. 能够实时预览，非常赞': 4,
      'D. 都是': 3
    },
    quiz_submitting_users: ['s1', 's2', 's3', 's4']
  });

  // Reset wizard state when opening a new file
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
      parseZip(file);
    }
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

      // If this is a worker-based executionMode by default
      if (parsed.executionMode === 'inline') {
        setExecutionMode('inline');
      }
    } catch (err: any) {
      setError(err.message || 'ZIP parse error');
    } finally {
      setProcessing(false);
    }
  };

  // Run the frontend.js inside a mock micro-frontend sandbox for UI previewing
  useEffect(() => {
    if (step !== 3 || !zipObj || !hasFrontend) return;

    let cancelled = false;
    const originalFetch = window.fetch;

    const setupPreviewSandbox = async () => {
      let blobUrl = '';
      try {
        const frontendJsFile = zipObj.file('frontend.js');
        if (!frontendJsFile) return;
        if (cancelled) return;

        const jsContent = await frontendJsFile.async('string');
        const blob = new Blob([jsContent], { type: 'application/javascript' });
        blobUrl = URL.createObjectURL(blob);

        // Dynamically import ESM module
        const module = await import(/* @vite-ignore */ blobUrl);
        const panelsList: any[] = [];

        // Mock Frontend Context Registry
        const mockCtx = {
          registerPanel: (config: any) => {
            panelsList.push(config);
          },
          services: {
            commandBus: {
              execute: async (cmd: any) => {
                alert(lang === 'zh' 
                  ? `[模拟指令派发成功]\n类型: ${cmd.type}\n负载: ${JSON.stringify(cmd.payload, null, 2)}`
                  : `[Mock Command Executed]\nType: ${cmd.type}\nPayload: ${JSON.stringify(cmd.payload, null, 2)}`
                );
                return { success: true };
              }
            }
          }
        };

        // Activate the plugin frontend ESM script
        if (module.default && typeof module.default.activate === 'function') {
          await module.default.activate(mockCtx);
        }
        setRegisteredPanels(panelsList);

        // Mock Network Interceptor
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : input.url;

          // Hijack whiteboard elements fetch
          if (url.includes('/api/lessons/mock-lesson/whiteboard')) {
            return new Response(JSON.stringify({
              success: true,
              elements: [{
                id: 'mock-el',
                type: 'plugin',
                data: mockData
              }]
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // Hijack student submit quiz answer
          if (url.includes('/api/lessons/mock-lesson/quiz-submit')) {
            const body = JSON.parse((init as any).body);
            const ansLetter = body.answer;

            setMockData((prev: any) => {
              const nextScore = { ...prev.quiz_score };
              const matchingOpt = prev.options.find((o: string) => o.startsWith(ansLetter) || o === ansLetter);
              if (matchingOpt) {
                nextScore[matchingOpt] = (nextScore[matchingOpt] || 0) + 1;
              } else {
                nextScore[ansLetter] = (nextScore[ansLetter] || 0) + 1;
              }
              return {
                ...prev,
                quiz_score: nextScore,
                quiz_submitting_users: [...prev.quiz_submitting_users, 's_mock_user']
              };
            });

            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          return originalFetch(input, init);
        };

      } catch (err) {
        // Dynamic import of blob URLs fails for modules with bare imports (React, etc.)
        // This is expected — the sandbox preview is best-effort
        console.warn('Sandbox preview skipped: frontend.js uses module imports that cannot be resolved from a blob URL.');
      }
    };

    setupPreviewSandbox();

    return () => {
      cancelled = true;
      window.fetch = originalFetch;
      // blobUrl is now managed inside setupPreviewSandbox
    };
  }, [step, zipObj, hasFrontend, mockData]);

  // Mount/render the UI when the preview DOM container becomes ready or previewRole shifts
  useEffect(() => {
    if (step !== 3 || registeredPanels.length === 0 || !previewContainerRef.current) return;

    previewContainerRef.current.innerHTML = '';
    
    // Find matching panel based on role switcher
    const slot = previewRole === 'teacher' ? 'teacher.dashboard.widget' : 'student.view';
    const panel = registeredPanels.find(p => p.slot === slot);

    if (panel && typeof panel.render === 'function') {
      Promise.resolve(
        panel.render(previewContainerRef.current, {
          elementId: 'mock-el',
          lessonId: 'mock-lesson'
        })
      ).catch(console.error);
    } else {
      previewContainerRef.current.innerHTML = `<div class="text-center p-8 text-xs text-gray-400 italic">${lang === 'zh' ? '此角色下该插件未声明任何 UI 扩展槽位' : 'This plugin does not contribute UI for this role'}</div>`;
    }
  }, [step, registeredPanels, previewRole]);

  const handleInstall = async () => {
    if (!file) return;
    setInstalling(true);
    try {
      await onConfirmInstall(file, executionMode);
      onClose();
    } catch (e) {
      console.error(e);
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
      return { label: lang === 'zh' ? '🔴 高危' : '🔴 High', desc: lang === 'zh' ? '可读写数据库、获取网络数据，存在敏感信息暴露风险。' : 'Can read/write DB or access network, sensitive data risk.' };
    }
    if (med.includes(cap)) {
      return { label: lang === 'zh' ? '🟡 中危' : '🟡 Medium', desc: lang === 'zh' ? '可在课表、白板中进行绘制或执行教学环节操作。' : 'Can write to whiteboards or control course schedules.' };
    }
    return { label: lang === 'zh' ? '🟢 低危' : '🟢 Low', desc: lang === 'zh' ? '常规的基础界面弹窗与局域隔离存储能力。' : 'Basic UI elements or isolated local storage.' };
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center overflow-y-auto select-none" style={{ zIndex: 9999 }}>
      <div className="bg-white border border-slate-200 shadow-2xl rounded-2xl w-full max-w-2xl p-6 md:p-7 relative flex flex-col justify-between max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center border-b border-slate-100 pb-4 shrink-0">
          <h2 className="font-extrabold text-base md:text-lg text-slate-800 flex items-center gap-2">
            <Shield className="text-indigo-600 animate-pulse" size={20} />
            {lang === 'zh' ? `三方插件安装向导 (${step + 1}/5)` : `Plugin Setup Wizard (${step + 1}/5)`}
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
              <span className="text-sm font-semibold">{lang === 'zh' ? '正在解压并审计文件...' : 'Extracting and auditing package...'}</span>
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
                      <p className="text-[10px] font-mono text-gray-500 mt-1">ID: {manifest.id} | v{manifest.version || '1.0.0'}</p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-700 text-xs mb-1.5">{lang === 'zh' ? '功能描述' : 'Description'}</h4>
                    <p className="text-xs text-gray-600 leading-relaxed bg-slate-50 border border-slate-100 p-3 rounded-lg font-medium">
                      {manifest.description || (lang === 'zh' ? '该插件暂无详细描述信息。' : 'No description provided for this plugin.')}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/30">
                      <span className="text-[10px] text-gray-400 block font-semibold">{lang === 'zh' ? '主程序入口' : 'Main Entry'}</span>
                      <span className="text-xs font-bold text-slate-700 font-mono mt-0.5 block">{manifest.main || 'index.js'}</span>
                    </div>
                    <div className="border border-slate-100 rounded-xl p-3 bg-slate-50/30">
                      <span className="text-[10px] text-gray-400 block font-semibold">{lang === 'zh' ? '前端沙箱包' : 'Frontend UI Asset'}</span>
                      <span className={`text-xs font-bold mt-0.5 block ${hasFrontend ? 'text-indigo-600' : 'text-gray-500'}`}>
                        {hasFrontend ? (lang === 'zh' ? '包含 (frontend.js)' : 'Included (frontend.js)') : (lang === 'zh' ? '无' : 'None')}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Capabilities / Permissions */}
              {step === 1 && (
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-slate-500 font-medium mb-1">
                    {lang === 'zh' ? '此插件申请了以下系统权限，请仔细评估安装后可能产生的风控隐患：' : 'This plugin requests the following capabilities, please review carefully:'}
                  </p>

                  {capabilities.length === 0 ? (
                    <div className="text-center p-8 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 font-bold text-xs">
                      {lang === 'zh' ? '✓ 该插件未申请任何敏感系统权限，可安全安装。' : '✓ This plugin requires no system capabilities, very safe.'}
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                      {capabilities.map(cap => {
                        const risk = getRiskBadge(cap);
                        return (
                          <div key={cap} className="border border-slate-100 rounded-xl p-3 flex flex-col gap-1 hover:border-slate-200 bg-slate-55/10">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-slate-800 bg-white border border-slate-150 rounded px-1.5 py-0.5">{cap}</span>
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
                      <span>{lang === 'zh' ? '我已了解并信任此插件的提供商，愿意授予上述高级系统权限。' : 'I trust the developer and agree to grant all requested capabilities.'}</span>
                    </label>
                  )}
                </div>
              )}

              {/* Step 3: Extension points contributes */}
              {step === 2 && (
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-slate-500 font-medium">
                    {lang === 'zh' ? '插件将向系统注册并扩展以下槽位（Slots）与自定义命令：' : 'The plugin will inject UI slots or register custom commands:'}
                  </p>

                  <div className="border border-slate-150/65 rounded-xl p-4 bg-slate-50/50 space-y-4">
                    {contributes ? (
                      <>
                        {/* Slots */}
                        {contributes.teacher?.dashboard?.widget && (
                          <div className="text-xs">
                            <span className="font-bold text-slate-700 block mb-1">插槽: 教师端侧栏卡片</span>
                            <span className="text-gray-500 font-mono">teacher.dashboard.widget → {contributes.teacher.dashboard.widget}</span>
                          </div>
                        )}
                        {contributes.student?.view && (
                          <div className="text-xs">
                            <span className="font-bold text-slate-700 block mb-1">插槽: 学生答题看板</span>
                            <span className="text-gray-500 font-mono">student.view → {contributes.student.view}</span>
                          </div>
                        )}
                        
                        {/* Custom Commands registered in manifest */}
                        {manifest.capabilitiesProposed && manifest.capabilitiesProposed.length > 0 && (
                          <div className="text-xs border-t border-slate-100 pt-3">
                            <span className="font-bold text-slate-700 block mb-1">{lang === 'zh' ? '注册指令集' : 'Commands Registered'}</span>
                            <div className="flex gap-1.5 flex-wrap">
                              {manifest.capabilitiesProposed.map((c: string) => (
                                <span key={c} className="bg-indigo-50 border border-indigo-150/60 rounded px-1.5 py-0.5 text-indigo-700 font-mono">{c.replace(':write', '.create')}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center text-xs text-slate-400 italic py-6">
                        {lang === 'zh' ? '此插件没有提供任何额外的槽位注册项。' : 'This plugin contributes no extension points.'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 4: UI Live Sandbox Preview */}
              {step === 3 && (
                <div className="flex flex-col gap-3 h-full">
                  <div className="flex items-center justify-between shrink-0">
                    <p className="text-xs text-slate-500 font-semibold">
                      {lang === 'zh' ? '沙箱实时交互预览 (基于 Mock 虚拟接口数据)：' : 'Live UI Sandbox Preview (Interactive simulation):'}
                    </p>
                    <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0">
                      <button
                        onClick={() => setPreviewRole('teacher')}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${previewRole === 'teacher' ? 'bg-white shadow text-indigo-650' : 'text-slate-550 hover:text-slate-800'}`}
                      >
                        {lang === 'zh' ? '教师统计端' : 'Teacher View'}
                      </button>
                      <button
                        onClick={() => setPreviewRole('student')}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${previewRole === 'student' ? 'bg-white shadow text-indigo-650' : 'text-slate-550 hover:text-slate-800'}`}
                      >
                        {lang === 'zh' ? '学生答题端' : 'Student View'}
                      </button>
                    </div>
                  </div>

                  {/* Sandbox preview viewport container */}
                  <div className="border border-slate-200/80 rounded-xl p-4 bg-slate-50/50 flex-grow overflow-auto min-h-[220px] max-h-[300px]">
                    <div ref={previewContainerRef} className="h-full bg-white rounded-lg p-4 border border-slate-100 shadow-sm" />
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] text-gray-550 font-medium shrink-0 bg-indigo-50/40 p-2 border border-indigo-100/40 rounded-lg">
                    <Sparkles size={11} className="text-indigo-600" />
                    <span>{lang === 'zh' ? '您可以在预览区直接操作点击（例如在学生端点击选项并提交，教师端的柱状统计图将实时更新）。' : 'Live interaction simulated: Submitting answers on student view updates teacher chart instantly.'}</span>
                  </div>
                </div>
              )}

              {/* Step 5: Sandbox sandbox config */}
              {step === 4 && (
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-slate-500 font-medium">
                    {lang === 'zh' ? '设置该插件启动时的微前端沙箱执行模式：' : 'Configure micro-frontend sandbox execution model:'}
                  </p>

                  <div className="space-y-3">
                    <label className={`border rounded-xl p-4 flex gap-3 cursor-pointer transition-all ${executionMode === 'worker' ? 'bg-indigo-50/40 border-indigo-300 shadow-xs' : 'border-slate-150 hover:border-indigo-200 bg-white'}`}>
                      <input
                        type="radio"
                        name="sandbox_mode"
                        checked={executionMode === 'worker'}
                        onChange={() => setExecutionMode('worker')}
                        className="mt-1 w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500 cursor-pointer shrink-0"
                      />
                      <div>
                        <h4 className="font-extrabold text-xs md:text-sm text-slate-800">{lang === 'zh' ? 'Worker 强沙箱隔离模式 (推荐)' : 'Worker Sandbox Isolation (Recommended)'}</h4>
                        <p className="text-[11px] text-slate-550 mt-1 leading-normal font-medium">{lang === 'zh' ? '插件代码在独立的后台 Worker 线程中加载运行。即便发生死循环、崩溃抛错也不会株连系统主服务崩溃，安全性最高。' : 'Loads in isolated background worker threads. Uncaught plugin errors won\'t crash main system.'}</p>
                      </div>
                    </label>

                    <label className={`border rounded-xl p-4 flex gap-3 cursor-pointer transition-all ${executionMode === 'inline' ? 'bg-indigo-50/40 border-indigo-300 shadow-xs' : 'border-slate-150 hover:border-indigo-200 bg-white'}`}>
                      <input
                        type="radio"
                        name="sandbox_mode"
                        checked={executionMode === 'inline'}
                        onChange={() => setExecutionMode('inline')}
                        className="mt-1 w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500 cursor-pointer shrink-0"
                      />
                      <div>
                        <h4 className="font-extrabold text-xs md:text-sm text-slate-800">{lang === 'zh' ? 'VM Inline 主进程运行模式' : 'VM Inline Execution'}</h4>
                        <p className="text-[11px] text-slate-550 mt-1 leading-normal font-medium">{lang === 'zh' ? '插件在主进程上下文中运行，执行性能极高。但如果代码发生不可捕获错误，可能会造成服务崩溃，适合受信任的代码。' : 'Runs in host process, higher execution speed. Uncaught plugin failures might cause host server to stop.'}</p>
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
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div 
                key={i} 
                className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-4 bg-indigo-650' : 'w-1.5 bg-slate-200'}`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <button
                onClick={() => setStep(prev => prev - 1)}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <ChevronLeft size={12} />
                {lang === 'zh' ? '上一步' : 'Back'}
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-3.5 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
            )}

            {step === 1 && capabilities.length > 0 && !agreedToTerms ? (
              <button
                disabled
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-200 text-gray-400 rounded-lg text-xs font-semibold cursor-not-allowed"
              >
                {lang === 'zh' ? '请先授权同意' : 'Accept terms first'}
                <ChevronRight size={12} />
              </button>
            ) : step < 4 ? (
              <button
                onClick={() => setStep(prev => prev + 1)}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '下一步' : 'Next'}
                <ChevronRight size={12} />
              </button>
            ) : (
              <button
                onClick={handleInstall}
                disabled={installing}
                className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer disabled:bg-indigo-400"
              >
                {installing ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    {lang === 'zh' ? '安装中...' : 'Installing...'}
                  </>
                ) : (
                  <>
                    <CheckCircle size={13} />
                    {lang === 'zh' ? '确认安装并上传' : 'Confirm & Install'}
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
