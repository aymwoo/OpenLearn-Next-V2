import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { init as initPptxPreview } from 'pptx-preview';
import Markdown from 'react-markdown';
import {
  Presentation,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Play,
  BookOpen,
  Edit3,
  Loader2,
  Upload,
  Maximize2,
  Wand2,
  FileText,
} from 'lucide-react';

export function RevealPresentationWrapper({ 
  elementId, 
  data, 
  userRole = 'teacher',
  onElementUpdate 
}: { 
  elementId: string; 
  data: any; 
  userRole?: 'teacher' | 'student';
  onElementUpdate?: (id: string, data: any) => Promise<void>; 
}) {
  const [mode, setMode] = useState<'ppt' | 'doc' | 'edit'>('ppt');
  const [markdown, setMarkdown] = useState(data.markdown || "# Title Slide\n---\n## Slide 2");
  const [slideIndex, setSlideIndex] = useState(data.slideX || 0);
  const [autoplay, setAutoplay] = useState(false);
  const [autoplayInterval, setAutoplayInterval] = useState(4); // seconds
  const [isFullscreen, setIsFullscreen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Custom presentations (PDF/PPTX) state
  const isTeacher = userRole === 'teacher';
  const isStudent = userRole === 'student';
  const fileUrl = data.fileUrl || '';
  const fileType = data.fileType || 'md'; // 'md' | 'pdf' | 'pptx'
  const fileName = data.fileName || '';
  const isFileLoaded = !!fileUrl;
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const pptxContainerRef = useRef<HTMLDivElement>(null);
  const previewerInstanceRef = useRef<any>(null);

  const isFullscreenSynced = !!data.isFullscreenSynced;
  const isFullscreenForced = !!data.isFullscreenForced;
  const isContainerFullscreen = isFullscreen || (isStudent && isFullscreenSynced && isFullscreenForced);

  // Parse slides
  const slides = markdown
    .split(/(?:\r?\n|^)---(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const totalSlides = fileType === 'md' ? Math.max(1, slides.length) : (data.slideCount || 1);

  // Auto reset mode to 'ppt' if an external file is loaded
  useEffect(() => {
    if (fileType !== 'md' && mode !== 'ppt') {
      setMode('ppt');
    }
  }, [fileType, mode]);

  // Sync index from parents
  useEffect(() => {
    if (data.slideX !== undefined && data.slideX !== slideIndex) {
      setSlideIndex(data.slideX);
    }
  }, [data.slideX]);

  // Sync markdown from parents (if updated by someone else)
  useEffect(() => {
    if (data.markdown !== undefined && data.markdown !== markdown) {
      setMarkdown(data.markdown);
    }
  }, [data.markdown]);

  // PPTX rendering effect (Only loads if fileType is 'pptx' and container ref is available)
  useEffect(() => {
    if (fileType !== 'pptx' || !fileUrl) {
      if (previewerInstanceRef.current) {
        previewerInstanceRef.current.destroy();
        previewerInstanceRef.current = null;
      }
      return;
    }

    let active = true;
    fetch(fileUrl)
      .then(res => res.arrayBuffer())
      .then(async (ab) => {
        if (!active) return;
        if (previewerInstanceRef.current) {
          previewerInstanceRef.current.destroy();
          previewerInstanceRef.current = null;
        }
        if (pptxContainerRef.current) {
          pptxContainerRef.current.innerHTML = '';
          try {
            const previewer = initPptxPreview(pptxContainerRef.current, { mode: 'slide' } as any);
            previewerInstanceRef.current = previewer;
            await previewer.load(ab);
            
            if (active) {
              if (isTeacher && onElementUpdate && data.slideCount !== previewer.slideCount) {
                onElementUpdate(elementId, {
                  ...data,
                  slideCount: previewer.slideCount
                });
              }
              previewer.renderSingleSlide(slideIndex);
            }
          } catch (e) {
            console.error("PPTX preview init failed", e);
          }
        }
      })
      .catch(err => console.error("Fetch PPTX failed", err));

    return () => {
      active = false;
      if (previewerInstanceRef.current) {
        previewerInstanceRef.current.destroy();
        previewerInstanceRef.current = null;
      }
    };
  }, [fileUrl, fileType, isContainerFullscreen]);

  // Render PPTX slide when slideIndex changes
  useEffect(() => {
    if (fileType === 'pptx' && previewerInstanceRef.current) {
      try {
        previewerInstanceRef.current.renderSingleSlide(slideIndex);
      } catch (e) {
        console.error("PPTX renderSingleSlide failed", e);
      }
    }
  }, [slideIndex, fileType]);

  // Autoplay function (For markdown slides only)
  useEffect(() => {
    if (!autoplay || mode !== 'ppt' || fileType !== 'md') return;
    const interval = setInterval(() => {
      setSlideIndex(prev => {
        const next = (prev + 1) % Math.max(1, slides.length);
        if (onElementUpdate) {
          onElementUpdate(elementId, { ...data, slideX: next });
        }
        return next;
      });
    }, autoplayInterval * 1000);
    return () => clearInterval(interval);
  }, [autoplay, autoplayInterval, slides.length, mode, fileType]);

  // Keyboard navigation effect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isStudent && isFullscreenSynced && isFullscreenForced) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        handleSlideChange(slideIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSlideChange(slideIndex - 1);
      } else if (e.key === 'Escape' && isContainerFullscreen) {
        e.preventDefault();
        handleToggleFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slideIndex, isContainerFullscreen, isStudent, isFullscreenSynced, isFullscreenForced, totalSlides]);

  const handleSlideChange = (index: number) => {
    if (isStudent && isFullscreenSynced && isFullscreenForced) return;
    const validIndex = Math.min(Math.max(0, index), totalSlides - 1);
    setSlideIndex(validIndex);
    if (isTeacher && onElementUpdate) {
      onElementUpdate(elementId, { ...data, slideX: validIndex });
    }
  };

  const handleMarkdownChange = (newMd: string) => {
    setMarkdown(newMd);
    if (onElementUpdate) {
      onElementUpdate(elementId, { ...data, markdown: newMd });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'pptx') {
      alert('仅支持上传 PDF 或 PPTX 格式的课件文件！');
      return;
    }

    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64String = event.target?.result as string;
        const base64Data = base64String.split(',')[1];
        
        const response = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            base64Data: base64Data
          })
        });

        if (!response.ok) {
          throw new Error('服务器上传文件失败');
        }

        const resData = await response.json();
        
        if (onElementUpdate) {
          await onElementUpdate(elementId, {
            ...data,
            fileUrl: resData.url,
            fileName: file.name,
            fileType: resData.type,
            slideX: 0,
            slideCount: resData.pageCount || 1,
            isFullscreenSynced: data.isFullscreenSynced !== undefined ? data.isFullscreenSynced : true,
            isFullscreenForced: false
          });
          setSlideIndex(0);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert('课件文件上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handleClearFile = () => {
    if (window.confirm('确定要清除已上传的课件并恢复为 Markdown 编辑模式吗？')) {
      if (onElementUpdate) {
        onElementUpdate(elementId, {
          ...data,
          fileUrl: '',
          fileName: '',
          fileType: 'md',
          slideX: 0,
          slideCount: 0,
          isFullscreenForced: false
        });
        setSlideIndex(0);
      }
    }
  };

  const handleToggleFullscreen = (val: boolean) => {
    setIsFullscreen(val);
    if (isTeacher && onElementUpdate) {
      onElementUpdate(elementId, {
        ...data,
        isFullscreenForced: val
      });
    }
  };

  const handleToggleFullscreenSync = (val: boolean) => {
    if (onElementUpdate) {
      onElementUpdate(elementId, {
        ...data,
        isFullscreenSynced: val,
        isFullscreenForced: val ? isFullscreen : false
      });
    }
  };

  // Preset templates
  const presets = [
    {
      name: '基础通用课件',
      desc: '标准的课件 structure',
      content: `# 物理学原理与探究\n---\n## 课程介绍\n1. 经典力学基础\n2. 能量守恒定律\n3. 万有引力应用\n---\n## 科学探究要素\n- 观察与提问\n- 制定计划与设计实验\n- 进行实验与收集证据\n- 交流、评估及得出结论\n---\n## 物理课后思考一\n> 牛顿第一定律是否可以在地球上直接通过实验完全验证？请结合摩擦力阐述。`
    },
    {
      name: '英语词汇互动',
      desc: '交互式英文闪卡',
      content: `# Topic: Smart Education\n---\n## Key Vocabulary\n- **Orchestration**: Arrangement or cooperation of system systems.\n- **Heuristic**: Practical method not guaranteed to be perfect.\n- **Applet**: Lightweight interactive program.\n---\n## Reading Passage\nModern class orchestration allows instructors to dispatch customized applets directly onto the virtual desk interfaces of student endpoints instantly!\n---\n## Fill in the Blank\nThe teacher used the virtual whiteboard to ___ classroom active learning slides.\n*(Answer: orchestrate)*`
    },
    {
      name: '微课探究文档',
      desc: '一页式大纲微课',
      content: `# 探究牛顿第三定律\n在本节微课中，我们将探讨作用力与反作用力的核心性质。\n\n## 概念要点\n- 作用力与反作用力**大小相等**\n- 作用力与反作用力**方向相反**\n- 作用力与反作用力作用在**不同的物体上**\n- 它们伴随发生，同时消失。\n\n---\n\n## 经典实验设计\n1. 准备两个完全相同的弹簧测力计 A 与 B。\n2. 将它们对拉，观察两者的示数变化。\n3. 会发现：不管拉力如何变化，A 的读数总是等于 B 的读数。\n\n## 问题思考\n当马拉着车在水平路面上加速前进时，马拉车的力与车拉马的力，哪一个更大？`
    }
  ];

  // Extracts headers from markdown text for Outline sidebar in Doc mode
  const extractOutline = () => {
    const lines = markdown.split('\n');
    const headers: { text: string; level: number; lineIndex: number }[] = [];
    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,3})\s+(.*)$/);
      if (match) {
        headers.push({
          text: match[2].trim(),
          level: match[1].length,
          lineIndex: index
        });
      }
    });
    return headers;
  };
  const outline = extractOutline();

  if (isContainerFullscreen && typeof document !== 'undefined') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900/10 text-slate-400 font-sans p-4">
        <div className="flex flex-col items-center gap-2">
          <Presentation size={24} className="text-indigo-500 animate-pulse" />
          <span className="text-xs">演示文稿正在全屏放映中</span>
        </div>
        {createPortal(
          <div className="fixed inset-0 z-[99999] bg-neutral-950 flex flex-col items-center justify-center font-sans p-6">
            {/* Top floating control rail */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between text-white/80 select-none z-[100001] px-4 py-2 bg-neutral-900/60 backdrop-blur-md rounded-xl border border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-bold text-xs tracking-wider uppercase">
                  {fileType === 'md' ? 'Markdown Slides' : `${fileType.toUpperCase()} Presentation`} {isStudent && '(Synced)'}
                </span>
              </div>
              
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-white/50">Slide {slideIndex + 1} / {totalSlides}</span>
                
                {/* Teacher controls */}
                {isTeacher && (
                  <>
                    {fileType === 'md' && (
                      <button
                        onClick={() => setAutoplay(p => !p)}
                        className={`px-2.5 py-1 rounded-md text-[10px] uppercase font-bold tracking-wider transition-colors border cursor-pointer ${autoplay ? 'bg-emerald-50 border-emerald-400 text-white animate-pulse' : 'bg-transparent border-neutral-700 text-neutral-400 hover:bg-neutral-850'}`}
                      >
                        {autoplay ? 'Autoplay Live' : 'Autoplay'}
                      </button>
                    )}
                    
                    <label className="flex items-center gap-1.5 text-xs text-white/70 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isFullscreenSynced}
                        onChange={(e) => handleToggleFullscreenSync(e.target.checked)}
                        className="rounded border-neutral-700 bg-neutral-800 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <span>同步学生全屏</span>
                    </label>
                  </>
                )}

                {/* Exit Fullscreen Button */}
                {(!isStudent || !isFullscreenForced || !isFullscreenSynced || isFullscreen) && (
                  <button
                    onClick={() => handleToggleFullscreen(false)}
                    className="p-1 px-2.5 bg-red-600 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer border-0 hover:bg-red-700"
                    title="退出放映"
                  >
                    退出放映 (Esc)
                  </button>
                )}
              </div>
            </div>

            {/* Main Presentation Contents */}
            <div className="w-full flex-1 min-h-0 flex items-center justify-center relative">
              {fileType === 'pdf' ? (
                <div className="w-full h-full flex items-center justify-center p-2 bg-slate-100 max-w-[90vw] max-h-[82vh] aspect-video rounded-2xl overflow-hidden shadow-2xl border border-neutral-850">
                  <iframe
                    key={`${fileUrl}-fs-${slideIndex}`}
                    src={`${fileUrl}#page=${slideIndex + 1}&toolbar=0&navpanes=0`}
                    className="w-full h-full border-0 rounded-xl"
                  />
                </div>
              ) : fileType === 'pptx' ? (
                <div className="w-full h-full flex items-center justify-center p-2 bg-slate-900/5 max-w-[90vw] max-h-[82vh] aspect-video rounded-2xl overflow-hidden shadow-2xl border border-neutral-850">
                  <div 
                    ref={pptxContainerRef} 
                    className="w-full h-full overflow-auto rounded-xl bg-white border border-slate-100 shadow-md flex items-center justify-center" 
                  />
                </div>
              ) : (
                // Markdown mode
                <div className="flex-1 w-full flex items-center justify-center max-w-[90vw] min-h-0">
                  <div className="w-full bg-white rounded-xl shadow-md border border-slate-100 flex flex-col overflow-y-auto p-6 md:p-8 aspect-video relative transition-all duration-300 hover:shadow-lg max-h-[82vh] max-w-none p-12 md:p-16 border-neutral-850 rounded-3xl shadow-2xl">
                    <div className="flex justify-between items-center text-[10px] font-semibold text-slate-400 border-b border-slate-100 pb-2 mb-4 shrink-0">
                      <span className="tracking-wide uppercase text-indigo-650">SMART CLASS SLIDE DECK</span>
                      <span className="font-mono">SLIDE {slideIndex + 1} / {totalSlides}</span>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                      <div className="markdown-body text-slate-800 leading-relaxed font-sans prose prose-neutral max-w-none text-xs">
                        {slides[slideIndex] ? (
                          <Markdown>{slides[slideIndex]}</Markdown>
                        ) : (
                          <div className="text-center text-slate-400 italic py-8">幻灯片没有内容，请在“编辑文档”中添加。</div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-2 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400 shrink-0 font-sans">
                      <span>智慧互动教室白板演示系统</span>
                      <span>Page {slideIndex + 1}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Controllers */}
            {/* If Student and Force Screen active, hides page controller completely to lock them */}
            {!(isStudent && isFullscreenSynced && isFullscreenForced) && (
              <div className="absolute bottom-6 bg-neutral-900/80 backdrop-blur-md px-6 py-2.5 rounded-full border border-neutral-800 shadow-2xl z-[100001]">
                <button
                  disabled={slideIndex === 0 || isStudent}
                  onClick={() => handleSlideChange(slideIndex - 1)}
                  className={`p-1.5 rounded-full border transition-colors cursor-pointer ${
                    slideIndex === 0 || isStudent
                      ? 'border-neutral-800 text-neutral-600 bg-neutral-950/20 cursor-not-allowed'
                      : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
                  }`}
                  title="上一张 (ArrowLeft)"
                >
                  <ChevronLeft size={18} />
                </button>

                <div className="flex items-center gap-1.5 px-1 font-mono text-xs text-neutral-200">
                  <span className="font-bold text-white text-base">{slideIndex + 1}</span>
                  <span className="text-neutral-600">/</span>
                  <span>{totalSlides}</span>
                </div>

                <button
                  disabled={slideIndex >= totalSlides - 1 || isStudent}
                  onClick={() => handleSlideChange(slideIndex + 1)}
                  className={`p-1.5 rounded-full border transition-colors cursor-pointer ${
                    slideIndex >= totalSlides - 1 || isStudent
                      ? 'border-neutral-800 text-neutral-600 bg-neutral-950/20 cursor-not-allowed'
                      : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
                  }`}
                  title="下一张 (ArrowRight)"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
      </div>
    );
  }

  const viewerClassName = isContainerFullscreen
    ? "fixed inset-0 z-[99999] bg-neutral-950 flex flex-col items-center justify-center font-sans p-6"
    : "flex-1 flex flex-col items-center justify-between p-4 bg-slate-900/5 relative min-w-0";

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 overflow-hidden text-xs relative font-sans">
      {/* 1. Dynamic Sub-toolbar (Only visible if NOT in fullscreen, or for teacher to manage) */}
      {!isContainerFullscreen && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 border-b border-slate-200 shrink-0 select-none relative z-10">
          {/* Play/Scroll/Edit Toggle Buttons */}
          <div className="flex items-center gap-1">
            {fileType === 'md' ? (
              <>
                <button
                  onClick={() => setMode('ppt')}
                  className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer ${mode === 'ppt' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}
                  title="播放课件幻灯片 (PPT Mode)"
                >
                  <Play size={11} />
                  <span>PPT 播放</span>
                </button>
                
                <button
                  onClick={() => setMode('doc')}
                  className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer ${mode === 'doc' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}
                  title="以精美文档形式阅读 (Markdown Document mode)"
                >
                  <BookOpen size={11} />
                  <span>文档阅读</span>
                </button>

                <button
                  onClick={() => setMode('edit')}
                  className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-colors cursor-pointer ${mode === 'edit' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}
                  title="在线编辑 Markdown 内容"
                >
                  <Edit3 size={11} />
                  <span>编辑文档</span>
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1 bg-indigo-50 border border-indigo-200/50 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-semibold">
                <Presentation size={10} />
                <span>{fileType.toUpperCase()} 课件演示中</span>
              </div>
            )}
          </div>

          {/* Toolbar Info / State Controls */}
          <div className="flex items-center gap-3">
            {/* Teacher Upload & Clear File controls */}
            {isTeacher && (
              <div className="flex items-center gap-1.5 border-r border-slate-200 pr-3">
                {uploading ? (
                  <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                    <Loader2 size={10} className="animate-spin" />
                    <span>上传解析中...</span>
                  </div>
                ) : isFileLoaded ? (
                  <div className="flex items-center gap-1.5 bg-slate-200/50 pl-2 pr-1.5 py-0.5 rounded border border-slate-300/30">
                    <span className="text-[10px] font-medium text-slate-600 max-w-[120px] truncate font-mono" title={fileName}>
                      {fileName}
                    </span>
                    <button
                      onClick={handleClearFile}
                      className="p-0.5 hover:bg-slate-300 rounded text-red-500 cursor-pointer border-0 bg-transparent"
                      title="清除并切换回 Markdown"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 flex items-center gap-1 font-semibold text-[10px] cursor-pointer"
                      title="上传 PPTX 或 PDF 课件"
                    >
                      <Upload size={10} />
                      <span>上传课件</span>
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".pdf,.pptx"
                      className="hidden"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Autoplay (Only for markdown PPT mode) */}
            {mode === 'ppt' && fileType === 'md' && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setAutoplay(p => !p)}
                  className={`p-1 rounded flex items-center gap-1 font-semibold text-[10px] transition-colors border cursor-pointer ${autoplay ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  title="开启/关闭幻灯片自动播放"
                >
                  {autoplay ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" /> : null}
                  <span>{autoplay ? '自动播放中' : '自动播放'}</span>
                </button>
                
                {autoplay && (
                  <select
                    value={autoplayInterval}
                    onChange={(e) => setAutoplayInterval(Number(e.target.value))}
                    className="bg-white border border-slate-200 rounded px-1 text-[10px] py-0.5 text-slate-700 font-medium"
                  >
                    <option value={2}>2秒</option>
                    <option value={4}>4秒</option>
                    <option value={6}>6秒</option>
                    <option value={10}>10秒</option>
                  </select>
                )}
              </div>
            )}

            {/* Sync Fullscreen settings for Teacher */}
            {isTeacher && mode === 'ppt' && (
              <label className="flex items-center gap-1 text-[10px] text-slate-500 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFullscreenSynced}
                  onChange={(e) => handleToggleFullscreenSync(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-650 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span>同步学生全屏</span>
              </label>
            )}

            {/* Fullscreen Toggle */}
            {mode === 'ppt' && (!isStudent || !(isFullscreenSynced && isFullscreenForced)) && (
              <button
                onClick={() => handleToggleFullscreen(true)}
                className="p-1 rounded-lg text-slate-655 hover:bg-slate-200 border border-slate-200 bg-white transition-colors cursor-pointer"
                title="全屏放映"
              >
                <Maximize2 size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. Main Mode Body */}
      <div className="flex-1 min-h-0 relative flex flex-row overflow-hidden">
        {mode === 'ppt' && (
          <div className={viewerClassName}>
            {/* Top floating control rail (Only in fullscreen mode) */}
            {isContainerFullscreen && (
              <div className="absolute top-4 left-4 right-4 flex items-center justify-between text-white/80 select-none z-[100001] px-4 py-2 bg-neutral-900/60 backdrop-blur-md rounded-xl border border-neutral-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-bold text-xs tracking-wider uppercase">
                    {fileType === 'md' ? 'Markdown Slides' : `${fileType.toUpperCase()} Presentation`} {isStudent && '(Synced)'}
                  </span>
                </div>
                
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono text-white/50">Slide {slideIndex + 1} / {totalSlides}</span>
                  
                  {/* Teacher controls */}
                  {isTeacher && (
                    <>
                      {fileType === 'md' && (
                        <button
                          onClick={() => setAutoplay(p => !p)}
                          className={`px-2.5 py-1 rounded-md text-[10px] uppercase font-bold tracking-wider transition-colors border cursor-pointer ${autoplay ? 'bg-emerald-50 border-emerald-400 text-white animate-pulse' : 'bg-transparent border-neutral-700 text-neutral-400 hover:bg-neutral-850'}`}
                        >
                          {autoplay ? 'Autoplay Live' : 'Autoplay'}
                        </button>
                      )}
                      
                      <label className="flex items-center gap-1.5 text-xs text-white/70 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isFullscreenSynced}
                          onChange={(e) => handleToggleFullscreenSync(e.target.checked)}
                          className="rounded border-neutral-700 bg-neutral-800 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <span>同步学生全屏</span>
                      </label>
                      
                      <button
                        onClick={() => handleToggleFullscreen(false)}
                        className="p-1 px-2.5 bg-red-655 text-white text-xs font-bold rounded-md transition-colors cursor-pointer border-0"
                        title="退出放映"
                      >
                        退出放映 (Esc)
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Main Presentation Contents */}
            <div className="w-full flex-1 min-h-0 flex items-center justify-center relative">
              {fileType === 'pdf' ? (
                <div className={`w-full h-full flex items-center justify-center p-2 bg-slate-100 ${isContainerFullscreen ? 'max-w-5xl aspect-video rounded-2xl overflow-hidden shadow-2xl border border-neutral-850' : ''}`}>
                  <iframe
                    key={`${fileUrl}-${isContainerFullscreen ? 'fs' : 'card'}-${slideIndex}`}
                    src={`${fileUrl}#page=${slideIndex + 1}&toolbar=0&navpanes=0`}
                    className="w-full h-full border-0 rounded-xl"
                  />
                </div>
              ) : fileType === 'pptx' ? (
                <div className={`w-full h-full flex items-center justify-center p-2 bg-slate-900/5 ${isContainerFullscreen ? 'max-w-5xl aspect-video rounded-2xl overflow-hidden shadow-2xl border border-neutral-850' : ''}`}>
                  <div 
                    ref={pptxContainerRef} 
                    className="w-full h-full overflow-auto rounded-xl bg-white border border-slate-100 shadow-md flex items-center justify-center" 
                  />
                </div>
              ) : (
                // Markdown mode
                <div className="flex-1 w-full flex items-center justify-center max-w-2xl min-h-0">
                  <div className={`w-full bg-white rounded-xl shadow-md border border-slate-100 flex flex-col overflow-y-auto p-6 md:p-8 aspect-video relative transition-all duration-300 hover:shadow-lg max-h-full ${isContainerFullscreen ? 'max-w-4xl p-12 md:p-16 border-neutral-850 rounded-3xl shadow-2xl' : ''}`}>
                    <div className="flex justify-between items-center text-[10px] font-semibold text-slate-400 border-b border-slate-100 pb-2 mb-4 shrink-0">
                      <span className="tracking-wide uppercase text-indigo-650">SMART CLASS SLIDE DECK</span>
                      <span className="font-mono">SLIDE {slideIndex + 1} / {totalSlides}</span>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                      <div className="markdown-body text-slate-800 leading-relaxed font-sans prose prose-neutral max-w-none text-xs">
                        {slides[slideIndex] ? (
                          <Markdown>{slides[slideIndex]}</Markdown>
                        ) : (
                          <div className="text-center text-slate-400 italic py-8">幻灯片没有内容，请在“编辑文档”中添加。</div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-2 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400 shrink-0 font-sans">
                      <span>智慧互动教室白板演示系统</span>
                      <span>Page {slideIndex + 1}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Controllers */}
            {/* If Student and Force Screen active, hides page controller completely to lock them */}
            {!(isStudent && isFullscreenSynced && isFullscreenForced) && (
              <div className={`mt-4 flex items-center justify-center gap-3 select-none shrink-0 ${
                isContainerFullscreen 
                  ? 'absolute bottom-6 bg-neutral-900/80 backdrop-blur-md px-6 py-2.5 rounded-full border border-neutral-800 shadow-2xl z-[100001]' 
                  : 'bg-white px-4 py-2 rounded-full border border-slate-200/80 shadow-md relative z-10'
              }`}>
                <button
                  disabled={slideIndex === 0 || (isStudent && isFullscreenSynced && isFullscreenForced)}
                  onClick={() => handleSlideChange(slideIndex - 1)}
                  className={`p-1.5 rounded-full border transition-colors cursor-pointer ${
                    slideIndex === 0 || (isStudent && isFullscreenSynced && isFullscreenForced)
                      ? (isContainerFullscreen ? 'border-neutral-800 text-neutral-600 bg-neutral-950/20 cursor-not-allowed' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed') 
                      : (isContainerFullscreen ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-slate-205 text-slate-655 hover:bg-slate-50')
                  }`}
                  title="上一张 (ArrowLeft)"
                >
                  <ChevronLeft size={isContainerFullscreen ? 18 : 14} />
                </button>

                <div className={`flex items-center gap-1.5 px-1 font-mono text-xs ${isContainerFullscreen ? 'text-neutral-200' : 'text-slate-700'}`}>
                  <span className={`font-bold ${isContainerFullscreen ? 'text-white text-base' : 'text-slate-900'}`}>{slideIndex + 1}</span>
                  <span className={isContainerFullscreen ? 'text-neutral-600' : 'text-slate-350'}>/</span>
                  <span>{totalSlides}</span>
                </div>

                <button
                  disabled={slideIndex >= totalSlides - 1 || (isStudent && isFullscreenSynced && isFullscreenForced)}
                  onClick={() => handleSlideChange(slideIndex + 1)}
                  className={`p-1.5 rounded-full border transition-colors cursor-pointer ${
                    slideIndex >= totalSlides - 1 || (isStudent && isFullscreenSynced && isFullscreenForced)
                      ? (isContainerFullscreen ? 'border-neutral-800 text-neutral-600 bg-neutral-950/20 cursor-not-allowed' : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed') 
                      : (isContainerFullscreen ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800' : 'border-slate-205 text-slate-655 hover:bg-slate-50')
                  }`}
                  title="下一张 (ArrowRight)"
                >
                  <ChevronRight size={isContainerFullscreen ? 18 : 14} />
                </button>
              </div>
            )}
          </div>
        )}

        {mode === 'doc' && fileType === 'md' && (
          <div className="flex-1 flex flex-row min-h-0 bg-white">
            {/* Outline Sidebar Navigator */}
            {outline.length > 0 && (
              <div className="w-1/4 min-w-[120px] max-w-[200px] border-r border-slate-200 bg-slate-50/50 flex flex-col py-3 px-2 overflow-y-auto shrink-0 select-none">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-2 flex items-center gap-1">
                  <FileText size={10} />
                  文档大纲
                </span>
                <div className="flex flex-col gap-0.5">
                  {outline.map((o, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        const targetEl = scrollContainerRef.current?.querySelector(`[data-line-index="${o.lineIndex}"]`);
                        if (targetEl) {
                          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                      }}
                      className="text-left text-[11px] py-1 px-2 rounded hover:bg-slate-100 text-slate-600 hover:text-slate-900 truncate cursor-pointer font-medium whitespace-nowrap border-0 bg-transparent"
                      style={{ paddingLeft: `${Math.max(8, o.level * 6)}px` }}
                      title={o.text}
                    >
                      {o.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Scrollable document container */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 md:p-8" ref={scrollContainerRef}>
              <div className="markdown-body prose prose-neutral max-w-none text-xs leading-relaxed text-slate-700">
                {markdown.split('\n').map((line, idx) => {
                  const headerMatch = line.match(/^(#{1,3})\s+(.*)$/);
                  if (headerMatch) {
                    const level = headerMatch[1].length;
                    const text = headerMatch[2].trim();
                    const HeaderTag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
                    const sizeClass = level === 1 ? 'text-lg font-bold text-indigo-900 border-b pb-1 mt-4 mb-2' : level === 2 ? 'text-base font-bold text-slate-800 mt-3 mb-1.5' : 'text-sm font-semibold text-slate-700 mt-2 mb-1';
                    return (
                      <HeaderTag key={idx} data-line-index={idx} className={sizeClass}>
                        {text}
                      </HeaderTag>
                    );
                  }
                  
                  if (line.trim() === '---') {
                    return <hr key={idx} className="my-4 border-slate-200" />;
                  }

                  return (
                    <p key={idx} className="my-1.5 text-slate-600 antialiased leading-relaxed">
                      {line}
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {mode === 'edit' && fileType === 'md' && (
          <div className="flex-1 flex flex-col md:flex-row min-h-0 bg-white">
            {/* Preset template selector panel (Left side) */}
            <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-slate-100 bg-slate-50/40 p-3 flex flex-col overflow-y-auto shrink-0 select-none">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-2 flex items-center gap-1">
                <Wand2 size={10} className="text-indigo-650" />
                推荐课件及文档模板
              </span>
              <div className="flex flex-col gap-2">
                {presets.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (window.confirm(`确定要加载模板 “${preset.name}” 吗？这将会覆盖当前白板课件中的所有编辑内容。`)) {
                        handleMarkdownChange(preset.content);
                        setSlideIndex(0);
                      }
                    }}
                    className="w-full text-left p-2.5 rounded-lg border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm transition-all focus:outline-none cursor-pointer group"
                  >
                    <div className="font-bold text-[11px] text-slate-800 group-hover:text-indigo-700 whitespace-nowrap overflow-hidden text-ellipsis">{preset.name}</div>
                    <div className="text-[9px] text-slate-400 mt-0.5">{preset.desc}</div>
                  </button>
                ))}
              </div>

              <div className="mt-4 p-2 bg-amber-50 rounded border border-amber-100 text-[10px] text-amber-700 font-sans leading-relaxed">
                <strong>💡 使用提示</strong><br />
                在任意位置插入一行 <code>---</code> 即可分割出一个新的幻灯片（PPT）页面。
              </div>
            </div>

            {/* Simple, real-time sync textarea editor */}
            <div className="flex-1 flex flex-col p-3 min-h-[200px]">
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="font-bold text-slate-500 text-[10px] uppercase">Markdown Source Code</span>
                <span className="text-[9px] text-slate-400">实时自动同步到所有协同终端</span>
              </div>
              <textarea
                value={markdown}
                onChange={(e) => handleMarkdownChange(e.target.value)}
                placeholder="在此输入 Markdown 文档。使用 '---' 来作为 PPT 页面分页符..."
                className="flex-1 w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white transition-all resize-none leading-relaxed text-slate-800"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
