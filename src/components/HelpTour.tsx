import React, { useState, useEffect, useRef } from 'react';
import { HelpCircle, ChevronLeft, ChevronRight, X, Sparkles, AlertCircle, Play } from 'lucide-react';

interface HelpTourProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'zh' | 'en';
  onSeedSuccess: (data: { classId: string; scheduleId: string; lessonId: string }) => void;
  onJumpTab: (tab: string) => void;
}

export function HelpTour({ isOpen, onClose, lang, onSeedSuccess, onJumpTab }: HelpTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);
  const [seedResult, setSeedResult] = useState<{ classId: string; className: string } | null>(null);
  const [highlightStyle, setHighlightStyle] = useState<React.CSSProperties>({ display: 'none' });
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({ display: 'none' });
  const popoverRef = useRef<HTMLDivElement>(null);

  // Steps definition
  const steps = [
    {
      targetId: '', // Fullscreen
      title: lang === 'zh' ? '欢迎来到 OpenLearn Next V2 平台！' : 'Welcome to OpenLearn Next V2!',
      content: lang === 'zh' 
        ? '本平台为数字课堂提供智能白板与教学插件生态托管。下面我们将通过 4 步带您快速完成初始化并体验一堂数字互动课程。' 
        : 'Welcome! This platform provides interactive whiteboards and educational plugin hosting. Let\'s set up your first class in 4 quick steps.'
    },
    {
      targetId: 'nav_btn_admin_directory', // Highlight Admin Center
      title: lang === 'zh' ? '第 1 步：一键初始化示例课程' : 'Step 1: Initialize Example Class',
      content: lang === 'zh'
        ? '在开始授课前，我们需要一个授课班级。请点击下方的按钮，系统将自动在数据库中为您建立示例班级、添加 5 名演示学生（小明、小红等），并自动排定一节今日的白板创意编程示范课！'
        : 'Before teaching, we need a classroom session. Click the button below to seed a demo class, add 5 sample students (Xiao Ming, Xiao Hong, etc.), and schedule today\'s creative programming class!',
      actionable: true // Renders the Seed button
    },
    {
      targetId: 'navigation_sidebar', // Highlight navigation tabs
      title: lang === 'zh' ? '第 2 步：了解系统导航菜单' : 'Step 2: Tour System Navigation',
      content: lang === 'zh'
        ? '初始化成功后，您可以在「系统导航」的「班级管理」中查看学生名册及座位表，或在「课程管理」中编辑白板教案。在「插件中心」中，您还可以安装/停用丰富的第三方小工具。'
        : 'After setup, explore the sidebar! Use "Classes & Students" to manage student profiles, "Courses" to edit whiteboards, and "Plugins" to manage tools.'
    },
    {
      targetId: 'nav_btn_live_class', // Highlight Live Interactive Classroom
      title: lang === 'zh' ? '第 3 步：进入互动课堂开启体验' : 'Step 3: Launch Live Classroom',
      content: lang === 'zh'
        ? '一切就绪！点击下方的「一键开课并进入课堂」，系统将为您自动进入示范课堂并展开互动白板。您可以在白板上下发测验、进行实时统计，学生端也将实时接收广播。'
        : 'All set! Click "Launch Classroom" to enter the live room. You can draw on the whiteboard, push quizzes, and view live stats, while student clients auto-sync.'
    }
  ];

  const handleSeedData = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/admin/seed-demo', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSeedResult({ classId: data.classId, className: '人工智能与创意编程示范班' });
          onSeedSuccess({
            classId: data.classId,
            scheduleId: data.scheduleId,
            lessonId: data.lessonId
          });
          // Proceed to next step automatically
          setTimeout(() => {
            setCurrentStep(2);
          }, 1500);
        }
      } else {
        const err = await res.json().catch(() => ({ error: '未知错误' }));
        setErrorFeedback(lang === 'zh' ? `初始化失败：${err.error || '请检查服务器日志'}` : `Failed: ${err.error || 'Check server logs'}`);
      }
    } catch (e: any) {
      console.error('Failed to seed demo data:', e);
      setErrorFeedback(lang === 'zh' ? `网络错误：${e.message || '请检查服务器是否运行'}` : `Network error: ${e.message || 'Check if server is running'}`);
    } finally {
      setSeeding(false);
    }
  };

  const handleFinishAndStartClass = () => {
    localStorage.setItem('edu_os_tour_completed', 'true');
    // If we have seeded a class, jump to the live classroom
    onJumpTab('live_class');
    onClose();
  };

  // Update target element highlighting layout
  useEffect(() => {
    if (!isOpen) return;

    const step = steps[currentStep];
    if (!step || !step.targetId) {
      // Fullscreen state
      setHighlightStyle({ display: 'none' });
      setPopoverStyle({
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 10000,
        width: '420px',
        maxWidth: '90vw'
      });
      return;
    }

    const updatePosition = () => {
      const target = document.getElementById(step.targetId);
      if (!target) {
        // Fallback to fullscreen if element not found
        setHighlightStyle({ display: 'none' });
        setPopoverStyle({
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10000,
          width: '420px',
          maxWidth: '90vw'
        });
        return;
      }

      const rect = target.getBoundingClientRect();
      const padding = 6;
      
      // Calculate highlight block positioning
      setHighlightStyle({
        display: 'block',
        position: 'fixed',
        top: `${rect.top - padding}px`,
        left: `${rect.left - padding}px`,
        width: `${rect.width + padding * 2}px`,
        height: `${rect.height + padding * 2}px`,
        boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.65)',
        border: '2px dashed #6366f1',
        borderRadius: '12px',
        zIndex: 9999,
        pointerEvents: 'none',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
      });

      // Calculate popover guide positioning
      const popoverWidth = 360;
      let popoverLeft = rect.left + rect.width + 16;
      let popoverTop = rect.top;

      // Adjust if running out of screen width (e.g. on mobile/right edge)
      if (popoverLeft + popoverWidth > window.innerWidth) {
        popoverLeft = Math.max(16, rect.left - popoverWidth - 16);
      }

      // Adjust top/bottom boundary
      if (popoverTop + 240 > window.innerHeight) {
        popoverTop = Math.max(16, window.innerHeight - 250);
      }

      setPopoverStyle({
        display: 'block',
        position: 'fixed',
        top: `${popoverTop}px`,
        left: `${popoverLeft}px`,
        width: `${popoverWidth}px`,
        zIndex: 10000,
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
      });
    };

    updatePosition();

    // Listen to resize and scroll
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    // Keep updating in case layout expands
    const timer = setInterval(updatePosition, 300);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      clearInterval(timer);
    };
  }, [isOpen, currentStep]);

  if (!isOpen) return null;

  const currentStepData = steps[currentStep];

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ zIndex: 9998 }}>
      {/* Fullscreen Overlay Mask if no element highlight, else handled by box-shadow */}
      {currentStepData && !currentStepData.targetId && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-2xs transition-opacity" onClick={onClose} />
      )}

      {/* Highlighting dashed hole */}
      <div style={highlightStyle} />

      {/* Help Card Popover Container */}
      <div 
        ref={popoverRef}
        style={popoverStyle}
        className="bg-white rounded-2xl border border-slate-150/60 shadow-2xl p-5 md:p-6 text-gray-900 font-sans flex flex-col justify-between"
      >
        <div>
          {/* Header */}
          <div className="flex justify-between items-start mb-3">
            <h3 className="font-extrabold text-sm md:text-base text-gray-900 flex items-center gap-1.5 leading-tight">
              <Sparkles size={16} className="text-indigo-500 animate-pulse shrink-0" />
              {currentStepData.title}
            </h3>
            <button 
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 rounded-lg p-0.5 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Description content */}
          <p className="text-xs md:text-sm text-gray-600 leading-relaxed font-medium mb-5 whitespace-pre-wrap">
            {currentStepData.content}
          </p>

          {/* Action box inside Step 1 (Seeding) */}
          {currentStepData.actionable && (
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 mb-5 flex flex-col items-center justify-center">
              {seedResult ? (
                <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold animate-bounce">
                  <Play size={12} className="fill-emerald-600" />
                  {lang === 'zh' ? '示范课程与学生名册初始化成功！' : 'Demo classes successfully initialized!'}
                </div>
              ) : (
                <button
                  onClick={handleSeedData}
                  disabled={seeding}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs md:text-sm rounded-lg hover:shadow-md transition-all cursor-pointer disabled:bg-indigo-400"
                >
                  {seeding ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {lang === 'zh' ? '正在创建数据库记录...' : 'Initializing DB records...'}
                    </span>
                  ) : (
                    <>
                      <Sparkles size={14} className="animate-pulse" />
                      {lang === 'zh' ? '一键初始化示范数据' : 'Initialize Example Data'}
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-4 shrink-0">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, idx) => (
              <div 
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentStep ? 'w-4 bg-indigo-600' : 'w-1.5 bg-slate-200'}`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            {currentStep > 0 ? (
              <button
                onClick={() => setCurrentStep(prev => prev - 1)}
                className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <ChevronLeft size={12} />
                {lang === 'zh' ? '上一步' : 'Back'}
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '跳过向导' : 'Skip Tour'}
              </button>
            )}

            {currentStep < steps.length - 1 ? (
              <button
                onClick={() => setCurrentStep(prev => prev + 1)}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '下一步' : 'Next'}
                <ChevronRight size={12} />
              </button>
            ) : (
              <button
                onClick={handleFinishAndStartClass}
                className="flex items-center gap-1 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '结束引导并开课' : 'Launch Classroom'}
                <Sparkles size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
