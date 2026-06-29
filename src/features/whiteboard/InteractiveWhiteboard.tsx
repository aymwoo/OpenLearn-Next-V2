import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Stage, Layer, Rect, Circle, Line, Text as KonvaText, Group } from 'react-konva';
import { MousePointer2, Square, Circle as CircleIcon, PenTool, Type, Eraser, Loader2, Presentation, ChevronLeft, ChevronRight, Wand2, Terminal, Activity, Trash2, Settings, Plus, X, Paintbrush, ChevronDown, Undo2, Redo2, RotateCcw, Play, Pause, Maximize2, Minimize2, Edit3, BookOpen, Eye, FileText, Highlighter, Sparkles, HelpCircle, Shuffle, UserCheck, Upload } from 'lucide-react';
import { Html } from 'react-konva-utils';
import { init as initPptxPreview } from 'pptx-preview';
import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/white.css';
import RevealMarkdown from 'reveal.js/plugin/markdown';
import { v7 as uuidv7 } from 'uuid';
import Markdown from 'react-markdown';
import { getSocketInstance } from '../../services/socket-service';
import { frontendEventBus } from '../../services/event-bus';
import { appStore } from '../../store/appStore';

function RollCallWrapper({
  elementId,
  data,
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete
}: {
  elementId: string,
  data: any,
  onElementUpdate?: (id: string, data: any) => Promise<void>,
  onPointerDown: (e: React.PointerEvent) => void,
  onPointerMove: (e: React.PointerEvent) => void,
  onPointerUp: (e: React.PointerEvent) => void,
  onDelete: () => void
}) {
  const allStudents = data.allStudents || [
    { id: "mock-s-1", name: "张明", email: "zhangming@edu-os.org" },
    { id: "mock-s-2", name: "李华", email: "lihua@edu-os.org" },
    { id: "mock-s-3", name: "王超", email: "wangchao@edu-os.org" },
    { id: "mock-s-4", name: "赵丽", email: "zhaoli@edu-os.org" },
    { id: "mock-s-5", name: "钱科", email: "qianke@edu-os.org" },
    { id: "mock-s-6", name: "孙雪", email: "sunxue@edu-os.org" }
  ];
  
  const [selectedStudent, setSelectedStudent] = useState<any>(data.selectedStudent || null);
  const [isRolling, setIsRolling] = useState(false);
  const [tempName, setTempName] = useState<string>('');

  const pickStudent = () => {
    if (allStudents.length === 0 || isRolling) return;
    
    setIsRolling(true);
    let counter = 0;
    const totalFlips = 16;
    const intervalTime = 80;

    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * allStudents.length);
      setTempName(allStudents[idx].name);
      counter++;

      if (counter >= totalFlips) {
        clearInterval(interval);
        const finalIdx = Math.floor(Math.random() * allStudents.length);
        const picked = allStudents[finalIdx];
        setSelectedStudent(picked);
        setIsRolling(false);

        // Save selected back to whiteboard
        if (onElementUpdate) {
          onElementUpdate(elementId, {
            ...data,
            selectedStudent: picked,
            pickedTime: new Date().toISOString(),
            status: 'picked'
          });
        }
      }
    }, intervalTime);
  };

  return (
    <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 border border-indigo-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans select-none" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-indigo-950/80 text-indigo-200 px-3 py-2 flex justify-between items-center text-xs font-semibold border-b border-indigo-900/50 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="flex items-center gap-1.5 text-indigo-300">
          <Sparkles size={13} className="animate-pulse text-indigo-400" />
          <span>随机点名助手 (Picker Ext)</span>
        </span>
        <button 
          onClick={onDelete} 
          onPointerDown={e => e.stopPropagation()}
          className="p-1 hover:bg-indigo-900/60 rounded text-indigo-400 hover:text-red-450 transition-colors cursor-pointer" 
          title="删除组件"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex-1 p-3.5 flex flex-col justify-between min-h-0 text-white gap-2">
        
        {/* Name Selector View */}
        <div className="w-full flex-1 flex flex-col items-center justify-center p-2 rounded-lg bg-indigo-950/50 border border-indigo-900/30">
          {isRolling ? (
            <div className="text-center space-y-2">
              <div className="text-[10px] text-indigo-300 uppercase tracking-widest animate-pulse font-semibold">检索班级学生中...</div>
              <div className="text-2xl font-extrabold text-amber-300 scale-105 tracking-wider font-sans">
                {tempName}
              </div>
            </div>
          ) : selectedStudent ? (
            <div className="text-center space-y-1.5">
              <div className="text-[9px] text-indigo-400 uppercase tracking-widest font-semibold flex items-center justify-center gap-1">
                <UserCheck size={11} className="text-emerald-400 animate-bounce" />
                <span>抽中的幸运学生</span>
              </div>
              <div className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-300 tracking-wider">
                {selectedStudent.name}
              </div>
              <div className="text-[9px] text-indigo-300/70 font-mono overflow-hidden text-ellipsis max-w-full">
                {selectedStudent.email || "No Email Account"}
              </div>
            </div>
          ) : (
            <div className="text-center space-y-1">
              <HelpCircle size={28} className="text-indigo-400/80 mx-auto animate-pulse" />
              <div className="text-xs text-indigo-300 font-semibold">随机抽取摇奖板</div>
              <p className="text-[9px] text-indigo-400/60 leading-tight">将在白板上演示随机滚动，对课堂提问大有裨益</p>
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="w-full shrink-0 flex flex-col items-center gap-1" onPointerDown={e => e.stopPropagation()}>
          <button
            onClick={pickStudent}
            disabled={isRolling}
            className="w-full py-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-750 text-white font-bold text-[11px] uppercase tracking-wider rounded-lg shadow-md active:scale-97 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
          >
            <Shuffle size={12} className={isRolling ? 'animate-spin' : ''} />
            <span>{isRolling ? '滚轮运转中...' : selectedStudent ? '重新随机点名' : '开始随机点名'}</span>
          </button>
          
          <div className="text-[8.5px] text-indigo-400/60 text-center font-mono">
            班级人数：{allStudents.length} 人 • 内核总线热同步
          </div>
        </div>

      </div>
    </div>
  );
}

function CodeSandboxWrapper({ 
  elementId, 
  data, 
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete
}: { 
  elementId: string, 
  data: any, 
  onElementUpdate?: (id: string, data: any) => Promise<void>,
  onPointerDown: (e: React.PointerEvent) => void,
  onPointerMove: (e: React.PointerEvent) => void,
  onPointerUp: (e: React.PointerEvent) => void,
  onDelete: () => void
}) {
  const [code, setCode] = useState(data.code || "console.log('Hello from sandbox!');");
  const [output, setOutput] = useState('');

  const runCode = () => {
    try {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => {
         logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
         originalLog(...args);
      };
      
      const result = eval(code);
      if (result !== undefined) logs.push(`Return: ${result}`);
      setOutput(logs.join('\n'));
      
      console.log = originalLog;
    } catch (e: any) {
      setOutput(`Error: ${e.message}`);
    }
  };

  const handleBlur = () => {
     if (onElementUpdate && code !== data.code) {
        onElementUpdate(elementId, { ...data, code });
     }
  };

  return (
    <div className="w-full h-full bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden flex flex-col font-mono text-sm" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-gray-800 text-gray-300 px-3 py-1.5 flex justify-between items-center text-xs border-b border-gray-700 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
         <span className="flex items-center gap-1">JS Sandbox</span>
         <div className="flex items-center gap-1.5" onPointerDown={e => e.stopPropagation()}>
           <button onClick={runCode} className="bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded shadow text-[10px] cursor-pointer">Run</button>
           <button onClick={onDelete} className="p-0.5 hover:bg-gray-700 rounded text-gray-400 hover:text-red-500 transition-colors cursor-pointer" title="删除组件">
             <Trash2 size={13} />
           </button>
         </div>
      </div>
      <textarea 
         value={code}
         onChange={e => setCode(e.target.value)}
         onBlur={handleBlur}
         className="w-full flex-1 min-h-0 bg-gray-900 text-green-400 p-3 focus:outline-none resize-none font-mono text-xs"
         placeholder="// Write JS here"
         onPointerDown={e => { e.stopPropagation(); }}
         onKeyDown={e => { e.stopPropagation(); }}
      />
      {output && (
        <div className="bg-black text-gray-400 p-2 border-t border-gray-800 h-24 overflow-y-auto whitespace-pre-wrap text-[10px] shrink-0">
           {output}
         </div>
      )}
    </div>
  );
}

function MathGraphWrapper({ 
  elementId, 
  data, 
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete
}: { 
  elementId: string, 
  data: any, 
  onElementUpdate?: (id: string, data: any) => Promise<void>,
  onPointerDown: (e: React.PointerEvent) => void,
  onPointerMove: (e: React.PointerEvent) => void,
  onPointerUp: (e: React.PointerEvent) => void,
  onDelete: () => void
}) {
  const [equation, setEquation] = useState<string>(data.equation || "Math.sin(x)");
  const [points, setPoints] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [containerDimensions, setContainerDimensions] = useState({ width: 400, height: 300 });
  const graphContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!graphContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerDimensions({
          width: entry.contentRect.width || 400,
          height: entry.contentRect.height || 300
        });
      }
    });
    observer.observe(graphContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      const generatedPoints = [];
      const centerX = containerDimensions.width / 2;
      const centerY = containerDimensions.height / 2;
      for (let xUnit = -10; xUnit <= 10; xUnit += 0.2) {
         const x = xUnit;
         const y = eval(equation);
         if (typeof y !== 'number' || isNaN(y)) continue;
         const px = centerX + x * 20; // scale 20, center centerX
         const py = centerY - y * 20; // scale 20, center centerY
         generatedPoints.push(`${px},${py}`);
      }
      setPoints(generatedPoints.join(' '));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, [equation, containerDimensions]);

  const handleBlur = () => {
    if (onElementUpdate && equation !== data.equation) {
       onElementUpdate(elementId, { ...data, equation });
    }
  };

  return (
    <div className="w-full h-full bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden flex flex-col font-mono text-sm" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-gray-100 text-gray-700 px-3 py-1.5 flex justify-between items-center text-xs border-b border-gray-300 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
         <span className="flex items-center gap-1 font-semibold text-gray-600">Math Graph Sandbox</span>
         <button 
           onClick={onDelete} 
           onPointerDown={e => e.stopPropagation()}
           className="p-1 hover:bg-gray-200 rounded-full text-gray-500 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center" 
           title="删除组件"
         >
           <Trash2 size={13} />
         </button>
      </div>
      <div className="p-3 border-b border-gray-200 flex-none flex flex-col gap-1">
         <span className="text-gray-500 text-xs">y = f(x)</span>
         <input 
            type="text" 
            value={equation} 
            onChange={e => setEquation(e.target.value)}
            onBlur={handleBlur}
            className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            placeholder="e.g. Math.sin(x) * x"
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
         />
         {error && <div className="text-red-500 text-[10px] mt-1">{error}</div>}
      </div>
      <div className="flex-1 relative overflow-hidden bg-white min-h-0" ref={graphContainerRef}>
          <svg width={containerDimensions.width} height={containerDimensions.height} viewBox={`0 0 ${containerDimensions.width} ${containerDimensions.height}`} className="absolute top-0 left-0">
             {/* Grid */}
             <line x1={containerDimensions.width / 2} y1="0" x2={containerDimensions.width / 2} y2={containerDimensions.height} stroke="#e5e7eb" strokeWidth="1" />
             <line x1="0" y1={containerDimensions.height / 2} x2={containerDimensions.width} y2={containerDimensions.height / 2} stroke="#e5e7eb" strokeWidth="1" />
             {/* Path */}
             {points && <polyline points={points} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />}
          </svg>
      </div>
    </div>
  );
}

function HelloWorldWrapper({ 
  elementId, 
  data, 
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete,
  lessonId
}: { 
  elementId: string, 
  data: any, 
  onElementUpdate?: (id: string, data: any) => Promise<void>,
  onPointerDown: (e: React.PointerEvent) => void,
  onPointerMove: (e: React.PointerEvent) => void,
  onPointerUp: (e: React.PointerEvent) => void,
  onDelete: () => void,
  lessonId: string
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'hello.say',
          payload: {
            lessonId: lessonId,
            username: 'World',
            shout: true
          }
        })
      });
    } catch (e) {
      console.error('Failed to trigger hello.say command:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full bg-white border border-slate-200/80 rounded-xl shadow-lg overflow-hidden flex flex-col font-sans select-none" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-slate-50 text-slate-700 px-2 py-1.5 flex justify-between items-center text-[10px] font-semibold border-b border-slate-150 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="flex items-center gap-1.5 text-slate-650">
          <Sparkles size={11} className="text-amber-500 animate-pulse" />
          <span>Hello World 插件</span>
        </span>
        <button 
          onClick={onDelete} 
          onPointerDown={e => e.stopPropagation()}
          className="p-1 hover:bg-slate-150 rounded text-slate-400 hover:text-red-500 transition-colors cursor-pointer" 
          title="删除组件"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div className="flex-1 p-2 flex items-center justify-center bg-slate-50/20">
        <button
          onClick={handleClick}
          disabled={loading}
          onPointerDown={e => e.stopPropagation()}
          className="w-full py-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-750 text-white font-bold text-[10px] rounded-lg shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
        >
          <Wand2 size={11} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? '输出中...' : '点击输出'}</span>
        </button>
      </div>
    </div>
  );
}

function RevealPresentationWrapper({ 
  elementId, 
  data, 
  userRole = 'teacher',
  onElementUpdate 
}: { 
  elementId: string, 
  data: any, 
  userRole?: 'teacher' | 'student',
  onElementUpdate?: (id: string, data: any) => Promise<void> 
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
            const previewer = initPptxPreview(pptxContainerRef.current, { mode: 'slide' });
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


interface WhiteboardElement {
  id: string;
  type: string;
  data: string;
}

interface InteractiveWhiteboardProps {
  lessonId: string;
  elements: WhiteboardElement[];
  onElementAdd: (type: string, data: any) => Promise<void>;
  onElementUpdate?: (elementId: string, data: any) => Promise<void>;
  onElementDelete?: (elementId: string) => Promise<void>;
  onClearBoard?: () => Promise<void>;
  onRefresh?: () => void;
  enableAutoAI?: boolean;
  activeSegmentId?: string | null;
  onSegmentSync?: (segmentId: string) => void;
  userRole?: 'teacher' | 'student';
  isEditMode?: boolean;
}

/**
 * 为 srcDoc 模式的 HTML Applet 注入 LMS 上下文和 bridge.js。
 * 服务端渲染路径（/runtime/ 或 /api/resources/）由 injectLmsSdk 处理；
 * 白板手写 HTML 代码的 srcDoc 路径不走服务端，需前端手动注入。
 */
let _srcDocAttemptCounter = 0;
function wrapSrcDocWithBridge(rawCode: string, lessonId: string): string {
  const attemptId = `att_srcdoc_${lessonId}_${Date.now()}_${++_srcDocAttemptCounter}`;
  const context = {
    student_id: 'teacher_preview',
    student_name: 'Teacher (Preview)',
    class_id: '',
    attempt_id: attemptId,
  };
  const courseware = {
    uuid: lessonId,
    name: 'Whiteboard HTML Applet',
  };
  return `<!DOCTYPE html>
<html><head>
<script>
  window.__LMS_STUDENT__ = ${JSON.stringify(context)};
  window.__LMS_COURSEWARE__ = ${JSON.stringify(courseware)};
<\/script>
<script src="/bridge.js"><\/script>
</head><body>
${rawCode || ''}
</body></html>`;
}

export function InteractiveWhiteboard({ 
  lessonId, 
  elements, 
  onElementAdd, 
  onElementUpdate, 
  onElementDelete,
  onClearBoard,
  onRefresh, 
  enableAutoAI,
  activeSegmentId,
  onSegmentSync,
  userRole = 'teacher',
  isEditMode = true,
}: InteractiveWhiteboardProps) {
  // 防御：确保 elements 始终是数组（极端情况下 Zustand store 可能返回非数组值）
  const safeElements = Array.isArray(elements) ? elements : [];
  const [tool, setTool] = useState<'cursor' | 'rect' | 'circle' | 'pen' | 'text' | 'presentation' | 'highlighter'>('cursor');
  const [highlighterColor, setHighlighterColor] = useState('#facc15');
  const [currentPage, setCurrentPage] = useState(0);
  // currentDrawing holds the shape currently being drawn, so elements is source of truth for others.
  const [currentDrawing, setCurrentDrawing] = useState<any>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const stageRef = useRef<any>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const socketRef = useRef<any>(null);
  const [remoteDrawings, setRemoteDrawings] = useState<Record<string, any>>({});
  // Quiz: elementId -> option student selected (not yet submitted)
  const [quizSelection, setQuizSelection] = useState<Record<string, string>>({});
  // Quiz submission result: elementId -> submitted answer + score
  const [quizAnswers, setQuizAnswers] = useState<Record<string, { option: string; score?: number; isCorrect?: boolean }>>({});
  const [quizSubmitting, setQuizSubmitting] = useState<Record<string, boolean>>({});
  // Fullscreen: when set, only this element is rendered full-viewport
  const [fullscreenElementId, setFullscreenElementId] = useState<string | null>(null);
  const [activeDragElement, setActiveDragElement] = useState<{ id: string; currentX: number; currentY: number; startPointerX: number; startPointerY: number; data: any } | null>(null);
  const dragRef = useRef<{
    id: string;
    currentX: number;
    currentY: number;
    startPointerX: number;
    startPointerY: number;
    data: any;
  } | null>(null);

  const resizeRef = useRef<{
    id: string;
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialWidth: number;
    initialHeight: number;
  } | null>(null);

  const resizingStateRef = useRef<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [selectedShapeId, _setSelectedShapeId] = useState<string | null>(null);
  const setSelectedShapeId = (id: string | null | ((prev: string | null) => string | null)) => {
    if (userRole === 'teacher') {
      if (typeof id === 'function') {
        _setSelectedShapeId(id);
      } else {
        _setSelectedShapeId(id);
      }
    }
  };

  const [contextMenu, _setContextMenu] = useState<{ x: number; y: number; elementId?: string } | null>(null);
  const setContextMenu = (val: { x: number; y: number; elementId?: string } | null) => {
    if (userRole === 'teacher') {
      _setContextMenu(val);
    }
  };
  const [activeResizeElement, setActiveResizeElement] = useState<{
    id: string;
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialWidth: number;
    initialHeight: number;
  } | null>(null);
  const [resizingState, setResizingState] = useState<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  
  const idleTimerRef = useRef<any>(null);
  const [dialog, setDialog] = useState<{
    type: 'confirm' | 'prompt' | 'alert';
    title: string;
    message: string;
    placeholder?: string;
    onConfirm: (inputValue?: string) => void | Promise<void>;
  } | null>(null);
  const [dialogInput, setDialogInput] = useState('');
  const [editingProperties, setEditingProperties] = useState<any>(null);
  const [propertyUndoStack, setPropertyUndoStack] = useState<{ [elementId: string]: string[] }>({});
  const [propertyRedoStack, setPropertyRedoStack] = useState<{ [elementId: string]: string[] }>({});

  const [systemResources, setSystemResources] = useState<any[]>([]);
  const [loadingResources, setLoadingResources] = useState<boolean>(false);
  
  const [coursewares, setCoursewares] = useState<any[]>([]);
  const [zipCandidates, setZipCandidates] = useState<string[]>([]);
  const [zipUploadInfo, setZipUploadInfo] = useState<{ uuid: string; name: string } | null>(null);
  const [showEntrySelector, setShowEntrySelector] = useState<boolean>(false);

  const fetchCoursewares = async () => {
    try {
      const res = await fetch('/api/courseware');
      if (res.ok) {
        const data = await res.json();
        setCoursewares(data);
      }
    } catch (e) {
      console.error('Error fetching coursewares:', e);
    }
  };

  const fetchSystemResources = async () => {
    try {
      setLoadingResources(true);
      const res = await fetch('/api/resources');
      if (res.ok) {
        const data = await res.json();
        setSystemResources(data);
      }
    } catch (e) {
      console.error('Error fetching system resources:', e);
    } finally {
      setLoadingResources(false);
    }
  };

  useEffect(() => {
    if (selectedShapeId) {
      const selectedEl = safeElements.find(e => e.id === selectedShapeId);
      if (selectedEl) {
        if (selectedEl.type === 'html-applet') {
          fetchSystemResources();
          fetchCoursewares();
        }
        try {
          setEditingProperties(JSON.parse(selectedEl.data));
        } catch (e) {
          setEditingProperties({});
        }
      } else {
        setEditingProperties(null);
      }
    } else {
      setEditingProperties(null);
    }
  }, [selectedShapeId, elements]);

  const handleUpdateElementData = async (updatedFields: any) => {
    const selectedEl = safeElements.find(e => e.id === selectedShapeId);
    if (!selectedEl) return;
    let parsedData = {};
    try {
      parsedData = JSON.parse(selectedEl.data);
    } catch (err) {}

    const updatedData = {
      ...parsedData,
      ...updatedFields
    };

    const oldStr = selectedEl.data;
    const newStr = JSON.stringify(updatedData);

    if (oldStr !== newStr) {
      setPropertyUndoStack(prev => {
        const stack = prev[selectedEl.id] ? [...prev[selectedEl.id]] : [];
        if (stack.length >= 30) stack.shift();
        stack.push(oldStr);
        return {
          ...prev,
          [selectedEl.id]: stack
        };
      });
      setPropertyRedoStack(prev => ({
        ...prev,
        [selectedEl.id]: []
      }));
    }

    if (onElementUpdate) {
      setIsSyncing(true);
      try {
        await onElementUpdate(selectedEl.id, updatedData);
        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        if (onRefresh) onRefresh();
      } catch (e) {
        console.error("更新属性失败:", e);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleUndoProp = async () => {
    if (!selectedShapeId) return;
    const selectedEl = safeElements.find(e => e.id === selectedShapeId);
    if (!selectedEl) return;

    const stack = propertyUndoStack[selectedShapeId] || [];
    if (stack.length === 0) return;

    const previousSnapshot = stack[stack.length - 1];
    const remainingUndo = stack.slice(0, stack.length - 1);

    const currentSnapshot = selectedEl.data;
    setPropertyRedoStack(prev => {
      const rStack = prev[selectedShapeId] ? [...prev[selectedShapeId]] : [];
      rStack.push(currentSnapshot);
      return { ...prev, [selectedShapeId]: rStack };
    });

    setPropertyUndoStack(prev => ({
      ...prev,
      [selectedShapeId]: remainingUndo
    }));

    if (onElementUpdate) {
      setIsSyncing(true);
      try {
        const parsedPrev = JSON.parse(previousSnapshot);
        setEditingProperties(parsedPrev);
        await onElementUpdate(selectedShapeId, parsedPrev);
        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        if (onRefresh) onRefresh();
      } catch (e) {
        console.error("撤销修改失败:", e);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleRedoProp = async () => {
    if (!selectedShapeId) return;
    const selectedEl = safeElements.find(e => e.id === selectedShapeId);
    if (!selectedEl) return;

    const rStack = propertyRedoStack[selectedShapeId] || [];
    if (rStack.length === 0) return;

    const nextSnapshot = rStack[rStack.length - 1];
    const remainingRedo = rStack.slice(0, rStack.length - 1);

    const currentSnapshot = selectedEl.data;
    setPropertyUndoStack(prev => {
      const uStack = prev[selectedShapeId] ? [...prev[selectedShapeId]] : [];
      uStack.push(currentSnapshot);
      return { ...prev, [selectedShapeId]: uStack };
    });

    setPropertyRedoStack(prev => ({
      ...prev,
      [selectedShapeId]: remainingRedo
    }));

    if (onElementUpdate) {
      setIsSyncing(true);
      try {
        const parsedNext = JSON.parse(nextSnapshot);
        setEditingProperties(parsedNext);
        await onElementUpdate(selectedShapeId, parsedNext);
        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        if (onRefresh) onRefresh();
      } catch (e) {
        console.error("重做修改失败:", e);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  const handleLocalPropChange = (key: string, value: any) => {
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        [key]: value
      };
    });
  };

  const handlePropBlur = (key: string, value: any) => {
    handleUpdateElementData({ [key]: value });
  };

  const handlePropsUpdate = (updates: Record<string, any>) => {
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        ...updates
      };
    });
    handleUpdateElementData(updates);
  };

  const handleNumericPropBlur = (key: string, value: string | number) => {
    const num = parseFloat(value as string);
    if (!isNaN(num)) {
      handleUpdateElementData({ [key]: num });
    }
  };

  const handleOptionChangeLocal = (index: number, value: string) => {
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      const newOpts = [...(prev.options || [])];
      newOpts[index] = value;
      return {
        ...prev,
        options: newOpts
      };
    });
  };

  const handleOptionBlur = (index: number, value: string) => {
    if (!editingProperties) return;
    const newOpts = [...(editingProperties.options || [])];
    newOpts[index] = value;
    handleUpdateElementData({ options: newOpts });
  };

  const handleAddOption = () => {
    if (!editingProperties) return;
    const currentOpts = editingProperties.options || [];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nextLabel = alphabet[currentOpts.length] || `Option ${currentOpts.length + 1}`;
    const newOpts = [...currentOpts, `选项 ${nextLabel}`];
    
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      return { ...prev, options: newOpts };
    });
    handleUpdateElementData({ options: newOpts });
  };

  const handleRemoveOption = (index: number) => {
    if (!editingProperties) return;
    const newOpts = (editingProperties.options || []).filter((_: any, i: number) => i !== index);
    
    setEditingProperties((prev: any) => {
      if (!prev) return prev;
      return { ...prev, options: newOpts };
    });
    handleUpdateElementData({ options: newOpts });
  };

  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  const getElementFloatingPosition = (el: WhiteboardElement) => {
    try {
      const data = JSON.parse(el.data);
      if (el.type === 'pen' && data.points) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity;
        for (let i = 0; i < data.points.length; i += 2) {
          const px = data.points[i];
          const py = data.points[i + 1];
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
        }
        return {
          x: (minX + maxX) / 2,
          y: minY - 36
        };
      } else if (el.type === 'rectangle' || (el.type === 'shape' && data.shape === 'rect')) {
        const rectX = data.x ?? 0;
        const rectY = data.y ?? 0;
        const rectW = data.width ?? 0;
        const rectH = data.height ?? 0;
        return {
          x: rectX + rectW / 2,
          y: (rectH < 0 ? rectY + rectH : rectY) - 36
        };
      } else if (el.type === 'circle' || (el.type === 'shape' && data.shape === 'circle')) {
        const circX = data.x ?? 0;
        const circY = data.y ?? 0;
        const circR = data.radius ?? 0;
        return {
          x: circX,
          y: circY - circR - 36
        };
      } else if (el.type === 'text') {
        const textX = data.x ?? 0;
        const textY = data.y ?? 0;
        return {
          x: textX + 40,
          y: textY - 36
        };
      } else if (data.x !== undefined && data.y !== undefined) {
        return {
          x: data.x + (data.width ? data.width / 2 : 150),
          y: data.y - 36
        };
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  };

  const handleElementDragStart = (e: React.PointerEvent, elementId: string, elementData: any) => {
    if (userRole !== 'teacher') return;
    e.preventDefault();
    const initialX = elementData.x ?? 0;
    const initialY = elementData.y ?? 0;
    const dragInfo = {
      id: elementId,
      currentX: initialX,
      currentY: initialY,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      data: elementData
    };
    dragRef.current = dragInfo;
    setActiveDragElement(dragInfo);
  };

  const handleElementDragMove = (e: React.PointerEvent) => {
    // Handled by window event listener
  };

  const handleElementDragEnd = async (e: React.PointerEvent) => {
    // Handled by window event listener
  };

  const handleResizeStart = (
    e: React.PointerEvent,
    id: string,
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
    currentX: number,
    currentY: number,
    currentWidth: number,
    currentHeight: number
  ) => {
    if (userRole !== 'teacher') return;
    e.preventDefault();
    e.stopPropagation();
    
    const resizeInfo = {
      id,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentX,
      initialY: currentY,
      initialWidth: currentWidth,
      initialHeight: currentHeight
    };
    const stateInfo = {
      id,
      x: currentX,
      y: currentY,
      width: currentWidth,
      height: currentHeight
    };
    
    resizeRef.current = resizeInfo;
    resizingStateRef.current = stateInfo;
    setActiveResizeElement(resizeInfo);
    setResizingState(stateInfo);
  };

  const handleResizeMove = (e: React.PointerEvent) => {
    // Handled by window event listener
  };

  const handleResizeEnd = async (e: React.PointerEvent) => {
    // Handled by window event listener
  };

  // Window-level dragging event listeners
  useEffect(() => {
    if (!activeDragElement) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startPointerX;
      const dy = e.clientY - dragRef.current.startPointerY;
      const initialX = dragRef.current.data.x ?? 0;
      const initialY = dragRef.current.data.y ?? 0;
      
      dragRef.current.currentX = initialX + dx;
      dragRef.current.currentY = initialY + dy;
      
      setActiveDragElement({
        ...dragRef.current
      });
    };

    const onPointerUp = async (e: PointerEvent) => {
      if (!dragRef.current) return;
      const finalX = dragRef.current.currentX;
      const finalY = dragRef.current.currentY;
      const elementId = dragRef.current.id;
      const elementData = dragRef.current.data;
      
      dragRef.current = null;
      setActiveDragElement(null);
      
      if (onElementUpdate) {
        setIsSyncing(true);
        try {
          await onElementUpdate(elementId, { ...elementData, x: finalX, y: finalY });
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        } catch (err) {
          console.error("Drag end update error:", err);
        } finally {
          setIsSyncing(false);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [activeDragElement, onElementUpdate, lessonId]);

  // Window-level resizing event listeners
  useEffect(() => {
    if (!activeResizeElement || !resizingState) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!resizeRef.current || !resizingStateRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;

      let nextX = resizeRef.current.initialX;
      let nextY = resizeRef.current.initialY;
      let nextW = resizeRef.current.initialWidth;
      let nextH = resizeRef.current.initialHeight;

      const minWidth = 150;
      const minHeight = 100;

      const { corner } = resizeRef.current;

      if (corner === 'bottom-right') {
        nextW = Math.max(minWidth, resizeRef.current.initialWidth + dx);
        nextH = Math.max(minHeight, resizeRef.current.initialHeight + dy);
      } else if (corner === 'bottom-left') {
        const pW = resizeRef.current.initialWidth - dx;
        if (pW >= minWidth) {
          nextW = pW;
          nextX = resizeRef.current.initialX + dx;
        }
        nextH = Math.max(minHeight, resizeRef.current.initialHeight + dy);
      } else if (corner === 'top-right') {
        nextW = Math.max(minWidth, resizeRef.current.initialWidth + dx);
        const pH = resizeRef.current.initialHeight - dy;
        if (pH >= minHeight) {
          nextH = pH;
          nextY = resizeRef.current.initialY + dy;
        }
      } else if (corner === 'top-left') {
        const pW = resizeRef.current.initialWidth - dx;
        if (pW >= minWidth) {
          nextW = pW;
          nextX = resizeRef.current.initialX + dx;
        }
        const pH = resizeRef.current.initialHeight - dy;
        if (pH >= minHeight) {
          nextH = pH;
          nextY = resizeRef.current.initialY + dy;
        }
      }

      resizingStateRef.current = {
        id: resizeRef.current.id,
        x: nextX,
        y: nextY,
        width: nextW,
        height: nextH
      };

      setResizingState({
        ...resizingStateRef.current
      });
    };

    const onPointerUp = async (e: PointerEvent) => {
      if (!resizeRef.current || !resizingStateRef.current) return;
      const { id } = resizeRef.current;
      const { x, y, width, height } = resizingStateRef.current;

      resizeRef.current = null;
      resizingStateRef.current = null;
      setActiveResizeElement(null);
      setResizingState(null);

      const targetEl = safeElements.find(el => el.id === id);
      if (targetEl && onElementUpdate) {
        try {
          const currentData = JSON.parse(targetEl.data);
          setIsSyncing(true);
          await onElementUpdate(id, { ...currentData, x, y, width, height });
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        } catch (err) {
          console.error("Resize end update error:", err);
        } finally {
          setIsSyncing(false);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [activeResizeElement, resizingState, elements, onElementUpdate, lessonId]);

  const handleElementDelete = (elementId: string) => {
    setDialog({
      type: 'confirm',
      title: '删除组件',
      message: '您确定要从白板中删除这个组件或图形吗？该操作不可撤销。',
      onConfirm: async () => {
        setIsSyncing(true);
        try {
          if (onElementDelete) {
            await onElementDelete(elementId);
          } else {
            await fetch(`/api/lessons/${lessonId}/whiteboard/${elementId}`, {
              method: 'DELETE'
            });
          }
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
          if (onRefresh) onRefresh();
          setSelectedShapeId(null);
        } catch (err) {
          console.error("Delete element failed:", err);
        } finally {
          setIsSyncing(false);
          setDialog(null);
        }
      }
    });
  };

  const handleClearBoard = () => {
    setDialog({
      type: 'confirm',
      title: '清空白板',
      message: '您确定要清空画布上的所有组件、图形和线条吗？此操作将永久清空白板且不可逆！',
      onConfirm: async () => {
        setIsSyncing(true);
        try {
          if (onClearBoard) {
            await onClearBoard();
          } else {
            await fetch(`/api/lessons/${lessonId}/whiteboard`, {
              method: 'DELETE'
            });
          }
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
          if (onRefresh) onRefresh();
          setSelectedShapeId(null);
        } catch (err) {
          console.error("Clear board failed:", err);
        } finally {
          setIsSyncing(false);
          setDialog(null);
        }
      }
    });
  };

  const handleResetBoard = () => {
    setDialog({
      type: 'confirm',
      title: '重置白板',
      message: '您确定要将白板重置为开始上课的状态吗？您在白板上做的所有临时修改都将被重置。',
      onConfirm: async () => {
        setIsSyncing(true);
        try {
          await fetch(`/api/lessons/${lessonId}/whiteboard/reset`, {
            method: 'POST'
          });
          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
          if (onRefresh) onRefresh();
          setSelectedShapeId(null);
        } catch (err) {
          console.error("Reset board failed:", err);
        } finally {
          setIsSyncing(false);
          setDialog(null);
        }
      }
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          handleElementDelete(selectedShapeId);
          setSelectedShapeId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShapeId]);

  const resetIdleTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!enableAutoAI) return;
    idleTimerRef.current = setTimeout(async () => {
      // 1 minute idle, auto-ask
      setIsSyncing(true);
      try {
        const res = await fetch(`/api/lessons/${lessonId}/ai-tutor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elements: safeElements.map(e => ({ type: e.type, data: JSON.parse(e.data) })) })
        });
        if (res.ok) {
           frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
           if (onRefresh) onRefresh();
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSyncing(false);
      }
    }, 60000);
  };

  useEffect(() => {
    resetIdleTimer();
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [elements]); // Reset timer on new external elements too, or just user interaction

  // Socket 连接：直接获取宿主 Socket 单例（替代 MfeContext DI）
  useEffect(() => {
    const socket = getSocketInstance();
    socketRef.current = socket;

    socket.emit('join-room', lessonId);

    const handleWhiteboardSync = (data: any) => {
      if (data.type === 'temp-draw') {
         setRemoteDrawings(prev => ({ ...prev, [data.userId]: data.payload }));
      } else if (data.type === 'temp-end') {
         setRemoteDrawings(prev => {
            const next = { ...prev };
            delete next[data.userId];
            return next;
         });
      } else if (data.type === 'refresh') {
         if (onRefresh) onRefresh();
      } else if (data.type === 'segment-change') {
         if (onSegmentSync && data.payload?.segmentId) {
            onSegmentSync(data.payload.segmentId);
         }
      }
    };

    socketRef.current.on('whiteboard-sync', handleWhiteboardSync);

    return () => {
      socketRef.current?.off('whiteboard-sync', handleWhiteboardSync);
    }
  }, [lessonId, onRefresh, onSegmentSync]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        // Use offsetWidth and offsetHeight for accurate display size calculations including border
        if (containerRef.current) {
          setContainerSize({
            width: containerRef.current.offsetWidth,
            height: containerRef.current.offsetHeight,
          });
        }
      }
    });
    observer.observe(containerRef.current);
    
    // Fallback: also run an initial resize and register window resize
    const handleWindowResize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    handleWindowResize();
    window.addEventListener('resize', handleWindowResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, []);

  const handleMouseDown = (e: any) => {
    resetIdleTimer();
    setContextMenu(null);
    if (tool === 'cursor') {
      const clickedOnEmpty = e.target === e.target.getStage();
      if (clickedOnEmpty) {
        setSelectedShapeId(null);
      }
      return;
    }
    if (isSyncing) return;
    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();
    if (tool === 'pen') {
      setCurrentDrawing({ type: 'pen', points: [pos.x, pos.y], color: 'black' });
    } else if (tool === 'highlighter') {
      setCurrentDrawing({ type: 'highlighter', points: [pos.x, pos.y], color: highlighterColor });
    } else if (tool === 'rect') {
      setCurrentDrawing({ type: 'rectangle', x: pos.x, y: pos.y, width: 0, height: 0, stroke: 'blue' });
    } else if (tool === 'circle') {
      setCurrentDrawing({ type: 'circle', x: pos.x, y: pos.y, radius: 0, stroke: 'green' });
    } else if (tool === 'text') {
      setCurrentDrawing({ type: 'text', x: pos.x, y: pos.y, text: 'Click to edit...', fontSize: 16, color: 'black' });
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || !currentDrawing) return;
    const pos = e.target.getStage().getPointerPosition();
    
    if (currentDrawing.type === 'pen' || currentDrawing.type === 'highlighter') {
      setCurrentDrawing({
        ...currentDrawing,
        points: currentDrawing.points.concat([pos.x, pos.y])
      });
    } else if (currentDrawing.type === 'rectangle') {
      setCurrentDrawing({
        ...currentDrawing,
        width: pos.x - currentDrawing.x,
        height: pos.y - currentDrawing.y
      });
    } else if (currentDrawing.type === 'circle') {
      const radius = Math.sqrt(Math.pow(pos.x - currentDrawing.x, 2) + Math.pow(pos.y - currentDrawing.y, 2));
      setCurrentDrawing({
        ...currentDrawing,
        radius
      });
    }
  };

  const handleMouseUp = async () => {
    if (!isDrawing || !currentDrawing) return;
    setIsDrawing(false);
    
    const drawingToSubmit = { ...currentDrawing, page: currentPage, segmentId: activeSegmentId };
    setCurrentDrawing(null); // Optimistically remove, the parent API fetch will restore it. Actually, wait. The user might see it disappear.
    // It's better to immediately call onElementAdd which is hopefully fast.
    
    setIsSyncing(true);
    try {
      await onElementAdd(drawingToSubmit.type, drawingToSubmit);
      frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!socketRef.current || !socketRef.current.id) return;
    if (currentDrawing) {
      socketRef.current.emit('whiteboard-update', { roomId: lessonId, type: 'temp-draw', userId: socketRef.current.id, payload: { ...currentDrawing, page: currentPage, segmentId: activeSegmentId } });
    } else {
      socketRef.current.emit('whiteboard-update', { roomId: lessonId, type: 'temp-end', userId: socketRef.current.id });
    }
  }, [currentDrawing, lessonId, currentPage, activeSegmentId]);

  useEffect(() => {
    if (activeSegmentId && socketRef.current) {
      socketRef.current.emit('whiteboard-update', { roomId: lessonId, type: 'segment-change', payload: { segmentId: activeSegmentId } });
    }
  }, [activeSegmentId, lessonId]);

  const renderDrawingRaw = (drawing: any) => {
    if (!drawing) return null;
    if (activeSegmentId) {
      const segId = drawing.segmentId || 'seg-1';
      if (segId !== activeSegmentId) return null;
    } else if (drawing.page !== currentPage) {
      return null;
    }
    if (drawing.type === 'pen') {
      return (
        <Line
          points={drawing.points}
          stroke={drawing.color}
          strokeWidth={4}
          tension={0.5}
          lineCap="round"
          lineJoin="round"
        />
      );
    }
    if (drawing.type === 'highlighter') {
      return (
        <Line
          points={drawing.points}
          stroke={drawing.color || '#facc15'}
          strokeWidth={18}
          tension={0.5}
          lineCap="round"
          lineJoin="round"
          opacity={0.5}
        />
      );
    }
    if (drawing.type === 'rectangle') {
      return <Rect x={drawing.x} y={drawing.y} width={drawing.width} height={drawing.height} stroke={drawing.stroke} />;
    }
    if (drawing.type === 'circle') {
      return <Circle x={drawing.x} y={drawing.y} radius={drawing.radius} stroke={drawing.stroke} />;
    }
    if (drawing.type === 'text') {
      return <KonvaText x={drawing.x} y={drawing.y} text={drawing.text} fontSize={drawing.fontSize} fill={drawing.color} />;
    }
    return null;
  };

  const renderActiveDrawing = () => renderDrawingRaw(currentDrawing ? { ...currentDrawing, page: currentPage, segmentId: activeSegmentId } : null);

  const renderRemoteDrawings = () => {
    return Object.values(remoteDrawings).map((drawing, i) => (
      <React.Fragment key={i}>
        {renderDrawingRaw(drawing)}
      </React.Fragment>
    ));
  };

  // Render incoming elements
  const renderElement = (el: WhiteboardElement) => {
    try {
      const data = JSON.parse(el.data);
      const isDraggingThis = activeDragElement?.id === el.id;
      const isResizingThis = resizingState?.id === el.id;
      const displayX = isResizingThis ? resizingState.x : (isDraggingThis ? activeDragElement.currentX : (data.x ?? 0));
      const displayY = isResizingThis ? resizingState.y : (isDraggingThis ? activeDragElement.currentY : (data.y ?? 0));

      const getInitialWidth = (type: string) => {
        if (type === 'hello-world') return 160;
        if (type === 'quiz') return 300;
        if (type === 'rollcall') return 320;
        if (type === 'assignment') return 310;
        if (type === 'html-applet') return 400;
        if (type === 'code-sandbox') return 400;
        if (type === 'math-graph') return 400;
        if (type === 'presentation') return 600;
        return 300;
      };

      const getInitialHeight = (type: string) => {
        if (type === 'hello-world') return 64;
        if (type === 'quiz') return 280;
        if (type === 'rollcall') return 310;
        if (type === 'assignment') return 250;
        if (type === 'html-applet') return 300;
        if (type === 'code-sandbox') return 320;
        if (type === 'math-graph') return 350;
        if (type === 'presentation') return 400;
        return 300;
      };

      const displayWidth = isResizingThis ? resizingState.width : (data.width ?? getInitialWidth(el.type));
      const displayHeight = isResizingThis 
        ? resizingState.height 
        : (data.isMinimized 
            ? 32 
            : (data.height ?? getInitialHeight(el.type)));
      const isThisSelected = selectedShapeId === el.id;

      const renderResizeHandles = () => {
        if (!isThisSelected) return null;
        return (
          <>
            {/* Outline highlight */}
            <div className="absolute -inset-1 border-2 border-indigo-500 rounded-lg pointer-events-none z-50 shadow-md animate-pulse duration-1000 animate-in fade-in" />
            {/* Corner Resize Handles */}
            <div 
              className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-600 rounded-full cursor-nwse-resize z-50 hover:bg-indigo-50 hover:scale-110 transition-transform shadow"
              onPointerDown={(e) => handleResizeStart(e, el.id, 'top-left', displayX, displayY, displayWidth, displayHeight)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
            <div 
              className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-600 rounded-full cursor-nesw-resize z-50 hover:bg-indigo-50 hover:scale-110 transition-transform shadow"
              onPointerDown={(e) => handleResizeStart(e, el.id, 'top-right', displayX, displayY, displayWidth, displayHeight)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
            <div 
              className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-600 rounded-full cursor-nesw-resize z-50 hover:bg-indigo-50 hover:scale-110 transition-transform shadow"
              onPointerDown={(e) => handleResizeStart(e, el.id, 'bottom-left', displayX, displayY, displayWidth, displayHeight)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
            <div 
              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-indigo-600 rounded-full cursor-nwse-resize z-50 hover:bg-indigo-50 hover:scale-110 transition-transform shadow"
              onPointerDown={(e) => handleResizeStart(e, el.id, 'bottom-right', displayX, displayY, displayWidth, displayHeight)}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
            />
          </>
        );
      };

      if (el.type === 'hello-world') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
                style: {
                  position: 'absolute',
                  top: `${displayY}px`,
                  left: `${displayX}px`,
                  pointerEvents: 'none',
                  zIndex: isThisSelected ? 20 : 10
                }
              }}
            >
              <div 
                onPointerDown={(e) => {
                  setSelectedShapeId(el.id);
                  e.stopPropagation();
                }}
                className="bg-transparent"
                style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
              >
                <HelloWorldWrapper
                  elementId={el.id}
                  data={data}
                  onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                  onPointerMove={handleElementDragMove}
                  onPointerUp={handleElementDragEnd}
                  onDelete={() => handleElementDelete(el.id)}
                  onElementUpdate={onElementUpdate}
                  lessonId={lessonId}
                />
                {renderResizeHandles()}
              </div>
            </Html>
          </Group>
        );
      }

      if (el.type === 'rollcall') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              }
            }}
          >
            <div 
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="bg-transparent"
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <RollCallWrapper
                elementId={el.id}
                data={data}
                onElementUpdate={onElementUpdate}
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
                onDelete={() => handleElementDelete(el.id)}
              />
              {renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }

      if (el.type === 'quiz') {
        const totalSubmissions = Object.keys(data.submissions || {}).length;
        const optionCounts: Record<string, number> = {};
        Object.values(data.submissions || {}).forEach((sub: any) => {
          const ans = String(sub.answer).toUpperCase();
          optionCounts[ans] = (optionCounts[ans] || 0) + 1;
        });

        const session = appStore.getState().session;
        const currentStudentId = session?.studentId || session?.userId || 'mock-student-id';
        const hasSubmitted = !!data.submissions?.[currentStudentId];
        const studentSubmission = data.submissions?.[currentStudentId];
        const serverSubmitted = studentSubmission
          ? { option: studentSubmission.answer, score: studentSubmission.score, isCorrect: studentSubmission.score === 100 }
          : null;

        const isTeacherView = userRole === 'teacher';
        // Determine student display state
        const studentDone = hasSubmitted || !!serverSubmitted;
        const localDone = !!quizAnswers[el.id];
        const finalResult = studentDone ? serverSubmitted : localDone ? quizAnswers[el.id] : null;

        const handleQuizSubmit = async () => {
          const selectedOption = quizSelection[el.id];
          if (!selectedOption || quizSubmitting[el.id] || quizAnswers[el.id]) return;
          setQuizSubmitting(prev => ({ ...prev, [el.id]: true }));
          try {
            const res = await fetch(`/api/lessons/${lessonId}/quiz-submit`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                elementId: el.id,
                answer: selectedOption
              })
            });
            if (res.ok) {
              const result = await res.json();
              setQuizAnswers(prev => ({
                ...prev,
                [el.id]: { option: selectedOption, score: result?.score, isCorrect: result?.isCorrect }
              }));
              frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              if (onRefresh) onRefresh();
            }
          } catch (err) {
            console.error('Quiz submit failed:', err);
          } finally {
            setQuizSubmitting(prev => ({ ...prev, [el.id]: false }));
          }
        };

        return (
          <Group key={el.id}>
            <Html
              divProps={{
                style: {
                  position: 'absolute',
                  top: displayY + 'px',
                  left: displayX + 'px',
                  pointerEvents: 'none',
                  zIndex: isThisSelected ? 20 : 10
                }
              }}
            >
              <div
                onPointerDown={(e) => {
                  setSelectedShapeId(el.id);
                  e.stopPropagation();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const containerRect = containerRef.current?.getBoundingClientRect();
                  if (containerRect) {
                    setContextMenu({
                      x: e.clientX - containerRect.left,
                      y: e.clientY - containerRect.top,
                      elementId: el.id
                    });
                  }
                }}
                className="bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col font-sans text-sm relative select-none"
                style={{ pointerEvents: 'auto', width: displayWidth + 'px', height: displayHeight + 'px' }}
              >
                <div
                  className="bg-gradient-to-r from-indigo-650 to-violet-650 text-white px-3 py-2 flex justify-between items-center text-xs font-bold border-b border-indigo-700 cursor-move select-none shrink-0"
                  onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                  onPointerMove={handleElementDragMove}
                  onPointerUp={handleElementDragEnd}
                >
                  <span className="flex items-center gap-1">
                    <Sparkles size={12} className="animate-pulse text-indigo-200" />
                    <span>📝 随堂测验</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setFullscreenElementId(el.id)}
                      onPointerDown={e => e.stopPropagation()}
                      className="p-1 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                      title="全屏"
                    >
                      <Maximize2 size={11} />
                    </button>
                    <button
                      onClick={async () => {
                        if (onElementUpdate) {
                          await onElementUpdate(el.id, { ...data, isMinimized: !data.isMinimized });
                          frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                        }
                      }}
                      onPointerDown={e => e.stopPropagation()}
                      className="p-1 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                      title={data.isMinimized ? "展开组件" : "收起组件"}
                    >
                      {data.isMinimized ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
                    </button>
                    {isTeacherView && (
                      <button
                        onClick={() => handleElementDelete(el.id)}
                        onPointerDown={e => e.stopPropagation()}
                        className="p-1 hover:bg-white/10 rounded-full text-white/80 hover:text-red-300 transition-colors cursor-pointer flex items-center justify-center"
                        title="删除组件"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
                {!data.isMinimized && (
                  <div className="p-3 text-slate-800 flex-1 overflow-y-auto flex flex-col justify-between">
                    <div>
                      <p className="font-bold text-xs text-slate-900 mb-2 leading-relaxed">{data.question}</p>
                      {isTeacherView ? renderTeacherStats() : renderStudentView()}
                    </div>
                    {!isTeacherView && !studentDone && !localDone && renderSubmitButton()}
                  </div>
                )}
                {!data.isMinimized && renderResizeHandles()}
              </div>
            </Html>
          </Group>
        );

        function renderTeacherStats() {
          return (
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold mb-1">
                <span>实时提交统计:</span>
                <span className="text-indigo-600 font-bold">{totalSubmissions} 人已提交</span>
              </div>
              {(data.options || []).map((opt: string, i: number) => {
                const optLetter = opt.charAt(0).toUpperCase();
                const count = optionCounts[optLetter] || 0;
                const percent = totalSubmissions > 0 ? Math.round((count / totalSubmissions) * 100) : 0;
                const isCorrect = optLetter === String(data.correctAnswer).toUpperCase();
                return (
                  <div key={i} className="relative h-7 bg-slate-50 border border-slate-150 rounded-lg overflow-hidden flex items-center px-3 justify-between shadow-sm">
                    <div className={`absolute top-0 left-0 h-full transition-all duration-500 ${isCorrect ? 'bg-emerald-500/10' : 'bg-indigo-500/10'}`} style={{ width: percent + '%' }} />
                    <div className="z-10 flex items-center gap-2 text-xs">
                      <span className={`font-semibold ${isCorrect ? 'text-emerald-700 font-bold' : 'text-slate-600'}`}>{opt}</span>
                      {isCorrect && <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1 rounded-sm">正确答案</span>}
                    </div>
                    <span className="z-10 text-[10px] font-bold text-slate-500">{count}人 ({percent}%)</span>
                  </div>
                );
              })}
            </div>
          );
        }

        function renderStudentView() {
          if (finalResult) {
            const ok = finalResult.isCorrect;
            return (
              <div className={`rounded-xl p-3 flex flex-col items-center justify-center text-center space-y-1.5 ${ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                <span className="text-xl">{ok ? '🎉' : '❌'}</span>
                <p className="font-bold text-xs">{ok ? '回答正确！' : '回答错误'}</p>
                {!ok && data.correctAnswer && <p className="text-[9px] opacity-70">正确答案：{data.correctAnswer}</p>}
              </div>
            );
          }
          return (
            <div className="flex flex-col gap-1.5">
              {(data.options || []).map((opt: string, i: number) => {
                const selected = quizSelection[el.id];
                const isPicked = selected === opt;
                return (
                  <button
                    key={i}
                    onClick={() => setQuizSelection(prev => ({ ...prev, [el.id]: prev[el.id] === opt ? '' : opt }))}
                    className={`w-full text-left px-3 py-2 border rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer shadow-sm ${isPicked ? 'bg-indigo-50 border-indigo-400 text-indigo-800 ring-1 ring-indigo-400' : 'bg-slate-50 hover:bg-indigo-50/50 border-slate-200 hover:border-indigo-300 text-slate-700'}`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold shrink-0 ${isPicked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 bg-white text-slate-500'}`}>
                      {isPicked ? '✓' : opt.charAt(0).toUpperCase()}
                    </div>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
          );
        }

        function renderSubmitButton() {
          const canSubmit = !!quizSelection[el.id] && !quizSubmitting[el.id];
          return (
            <button
              onClick={() => handleQuizSubmit()}
              disabled={!canSubmit}
              className={`w-full mt-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${canSubmit ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              {quizSubmitting[el.id] ? <span className="flex items-center justify-center gap-1"><Loader2 size={12} className="animate-spin" /> 提交中...</span> : '提交答案'}
            </button>
          );
        }
      }
      if (el.type === 'assignment') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              }
            }}
          >
            <div 
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden flex flex-col font-sans text-sm relative select-none" 
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <div 
                className="bg-orange-50 text-orange-700 px-3 py-1.5 flex justify-between items-center text-xs font-semibold border-b border-orange-100 cursor-move select-none shrink-0"
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
              >
                <span>Assignment Upload Task</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFullscreenElementId(el.id)} onPointerDown={e => e.stopPropagation()} className="p-1 hover:bg-slate-200/50 rounded-full text-orange-600 hover:text-orange-900 transition-colors cursor-pointer flex items-center justify-center" title="全屏"><Maximize2 size={11} /></button>
                  <button
                    onClick={async () => {
                      if (onElementUpdate) {
                        await onElementUpdate(el.id, { ...data, isMinimized: !data.isMinimized });
                        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                      }
                    }}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-orange-655 hover:text-orange-900 transition-colors cursor-pointer flex items-center justify-center"
                    title={data.isMinimized ? "展开组件" : "收起组件"}
                  >
                    {data.isMinimized ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
                  </button>
                  <button 
                    onClick={() => handleElementDelete(el.id)}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-orange-600 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center"
                    title="删除组件"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              {!data.isMinimized && (
                <div className="p-4 text-center flex-1 overflow-y-auto flex flex-col justify-center min-h-0">
                  <p className="font-semibold text-gray-800 mb-1 text-xs">{data.title}</p>
                  <p className="text-xs text-gray-500 mb-3 line-clamp-3">{data.description}</p>
                  <button 
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-1.5 rounded transition-colors text-xs shadow-sm cursor-pointer" 
                    onClick={() => {
                      setDialog({
                        type: 'alert',
                        title: '作业文件上传',
                        message: `系统已经成功模拟拉起本地文件选择和上传流程！\n已准备上传作业: ${data.title ?? '白板作业'}`,
                        onConfirm: () => setDialog(null)
                      });
                    }}
                  >
                    Upload File
                  </button>
                </div>
              )}
              {!data.isMinimized && renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
      if (el.type === 'html-applet') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              }
            }}
          >
            <div 
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden flex flex-col font-sans text-sm relative" 
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <div 
                className="bg-gray-100 text-gray-700 px-3 py-1.5 flex justify-between items-center text-xs font-semibold border-b border-gray-200 cursor-move select-none shrink-0"
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
              >
                <span>Interactive Courseware</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFullscreenElementId(el.id)} onPointerDown={e => e.stopPropagation()} className="p-1 hover:bg-slate-200/50 rounded-full text-gray-600 hover:text-gray-900 transition-colors cursor-pointer flex items-center justify-center" title="全屏"><Maximize2 size={11} /></button>
                  <button
                    onClick={async () => {
                      if (onElementUpdate) {
                        await onElementUpdate(el.id, { ...data, isMinimized: !data.isMinimized });
                        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                      }
                    }}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-gray-650 hover:text-gray-900 transition-colors cursor-pointer flex items-center justify-center"
                    title={data.isMinimized ? "展开组件" : "收起组件"}
                  >
                    {data.isMinimized ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
                  </button>
                  <button 
                    onClick={() => handleElementDelete(el.id)}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-gray-650 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center"
                    title="删除组件"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              {!data.isMinimized && (
                <div className="flex-1 bg-white overflow-hidden relative min-h-0">
                  <iframe
                    className="w-full h-full border-none"
                    src={data.coursewareUuid ? `/runtime/${data.coursewareUuid}/` : (data.resourceId ? `/api/resources/${data.resourceId}/` : undefined)}
                    srcDoc={data.coursewareUuid || data.resourceId ? undefined : wrapSrcDocWithBridge(data.code, lessonId)}
                    sandbox="allow-scripts allow-forms allow-downloads"
                  />
                </div>
              )}
              {!data.isMinimized && renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
      if (el.type === 'pen') {
        const isSelected = selectedShapeId === el.id;
        return (
          <Line
            key={el.id}
            id={el.id}
            points={data.points}
            stroke={isSelected ? '#3b82f6' : (data.color || 'black')}
            strokeWidth={isSelected ? 6 : 4}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              const nextPoints = data.points.map((val: number, i: number) => {
                return i % 2 === 0 ? val + deltaX : val + deltaY;
              });
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, points: nextPoints });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'highlighter') {
        const isSelected = selectedShapeId === el.id;
        return (
          <Line
            key={el.id}
            id={el.id}
            points={data.points}
            stroke={isSelected ? '#3b82f6' : (data.color || '#facc15')}
            strokeWidth={isSelected ? 24 : 18}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            opacity={0.5}
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              const nextPoints = data.points.map((val: number, i: number) => {
                return i % 2 === 0 ? val + deltaX : val + deltaY;
              });
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, points: nextPoints });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'rectangle' || (el.type === 'shape' && data.shape === 'rect')) {
        const isSelected = selectedShapeId === el.id;
        return (
          <Rect 
            key={el.id} 
            id={el.id}
            x={data.x} 
            y={data.y} 
            width={data.width} 
            height={data.height} 
            fill={data.fill || 'transparent'} 
            stroke={isSelected ? '#3b82f6' : (data.stroke || 'blue')}
            strokeWidth={isSelected ? 3 : 1}
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, x: data.x + deltaX, y: data.y + deltaY });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'circle' || (el.type === 'shape' && data.shape === 'circle')) {
        const isSelected = selectedShapeId === el.id;
        return (
          <Circle 
            key={el.id} 
            id={el.id}
            x={data.x} 
            y={data.y} 
            radius={data.radius} 
            fill={data.fill || 'transparent'} 
            stroke={isSelected ? '#3b82f6' : (data.stroke || 'green')}
            strokeWidth={isSelected ? 3 : 1}
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, x: data.x + deltaX, y: data.y + deltaY });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'text') {
        const isSelected = selectedShapeId === el.id;
        return (
          <KonvaText 
            key={el.id} 
            id={el.id}
            x={data.x} 
            y={data.y} 
            text={data.text} 
            fontSize={data.fontSize || 16} 
            fill={isSelected ? '#3b82f6' : (data.color || 'black')}
            fontStyle={isSelected ? 'bold' : 'normal'}
            draggable={userRole === 'teacher' && tool === 'cursor'}
            onClick={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onTap={(e) => {
              if (tool === 'cursor') {
                e.cancelBubble = true;
                setSelectedShapeId(isSelected ? null : el.id);
              }
            }}
            onDragEnd={async (e) => {
              const node = e.target;
              const deltaX = node.x();
              const deltaY = node.y();
              node.x(0);
              node.y(0);
              if (onElementUpdate) {
                await onElementUpdate(el.id, { ...data, x: data.x + deltaX, y: data.y + deltaY });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
              }
            }}
          />
        );
      }
      if (el.type === 'code-sandbox') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              },
            }}
          >
            <div
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="relative rounded-lg shadow-xl"
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <CodeSandboxWrapper 
                elementId={el.id} 
                data={data} 
                onElementUpdate={onElementUpdate ? async (id, d) => {
                   await onElementUpdate(id, d);
                   frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                } : undefined}
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
                onDelete={() => handleElementDelete(el.id)}
              />
              {renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
      if (el.type === 'math-graph') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              },
            }}
          >
            <div
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="relative rounded-lg shadow-xl"
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <MathGraphWrapper 
                elementId={el.id} 
                data={data} 
                onElementUpdate={onElementUpdate ? async (id, d) => {
                   await onElementUpdate(id, d);
                   frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                } : undefined}
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
                onDelete={() => handleElementDelete(el.id)}
              />
              {renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
      if (el.type === 'presentation') {
        return (
          <Group key={el.id}>
            <Html
              divProps={{
              style: {
                position: 'absolute',
                top: `${displayY}px`,
                left: `${displayX}px`,
                pointerEvents: 'none',
                zIndex: isThisSelected ? 20 : 10
              },
            }}
          >
            <div 
              onPointerDown={(e) => {
                setSelectedShapeId(el.id);
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (containerRect) {
                  setContextMenu({
                    x: e.clientX - containerRect.left,
                    y: e.clientY - containerRect.top,
                    elementId: el.id
                  });
                }
              }}
              className="bg-white border border-gray-305 rounded-lg shadow-xl overflow-hidden flex flex-col font-sans text-sm relative select-none" 
              style={{ pointerEvents: 'auto', width: `${displayWidth}px`, height: `${displayHeight}px` }}
            >
              <div 
                className="bg-purple-100 text-purple-700 px-3 py-1.5 flex justify-between items-center text-xs font-semibold border-b border-purple-200 cursor-move shrink-0"
                onPointerDown={(e) => handleElementDragStart(e, el.id, data)}
                onPointerMove={handleElementDragMove}
                onPointerUp={handleElementDragEnd}
              >
                <span>Interactive Presentation</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFullscreenElementId(el.id)} onPointerDown={e => e.stopPropagation()} className="p-1 hover:bg-slate-200/50 rounded-full text-purple-600 hover:text-purple-900 transition-colors cursor-pointer flex items-center justify-center" title="全屏"><Maximize2 size={11} /></button>
                  <button
                    onClick={async () => {
                      if (onElementUpdate) {
                        await onElementUpdate(el.id, { ...data, isMinimized: !data.isMinimized });
                        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                      }
                    }}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-purple-650 hover:text-purple-900 transition-colors cursor-pointer flex items-center justify-center"
                    title={data.isMinimized ? "展开组件" : "收起组件"}
                  >
                    {data.isMinimized ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
                  </button>
                  <button 
                    onClick={() => handleElementDelete(el.id)}
                    onPointerDown={e => e.stopPropagation()}
                    className="p-1 hover:bg-slate-200/50 rounded-full text-purple-600 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center"
                    title="删除组件"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              {!data.isMinimized && (
                <div className="flex-1 min-h-0 relative bg-white" style={{ pointerEvents: 'auto' }}>
                  <RevealPresentationWrapper 
                    elementId={el.id} 
                    data={data} 
                    userRole={userRole}
                    onElementUpdate={onElementUpdate ? async (id, d) => {
                       await onElementUpdate(id, d);
                       frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                    } : undefined} 
                  />
                </div>
              )}
              {!data.isMinimized && renderResizeHandles()}
            </div>
          </Html>
        </Group>
        );
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  };

  const handleWhiteboardDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleWhiteboardDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleWhiteboardDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      let payloadStr = e.dataTransfer.getData('application/json');
      if (!payloadStr) payloadStr = e.dataTransfer.getData('text/plain');
      if (!payloadStr) payloadStr = e.dataTransfer.getData('text');
      if (!payloadStr) payloadStr = e.dataTransfer.getData('Text');
      
      console.log("Whiteboard drop triggered. Payload:", payloadStr);
      if (!payloadStr) return;
      
      let payload;
      try {
        payload = JSON.parse(payloadStr);
      } catch (err) {
        console.error("Failed to parse drop JSON payload:", err);
        return;
      }
      
      if (typeof payload !== 'object' || !payload) return;

      if (!containerRef.current) {
        console.warn("containerRef.current is not loaded on drop");
        return;
      }
      const stageBox = containerRef.current.getBoundingClientRect();
      let dropX = e.clientX - stageBox.left;
      let dropY = e.clientY - stageBox.top;
      
      console.log(`Adding whiteboard element of type ${payload.type} at (${dropX}, ${dropY})`);
      setIsSyncing(true);
      try {
        if (payload.type === 'code-sandbox') {
           await onElementAdd('code-sandbox', {
               code: payload.code || "console.log('Hello Sandbox!');",
               x: dropX,
               y: dropY,
               page: currentPage,
               segmentId: activeSegmentId
           });
        } else if (payload.type === 'math-graph') {
           await onElementAdd('math-graph', {
               equation: payload.equation || "Math.sin(x)",
               x: dropX,
               y: dropY,
               page: currentPage,
               segmentId: activeSegmentId
           });
        } else if (payload.type === 'presentation') {
           await onElementAdd('presentation', {
               markdown: payload.markdown || "# Title Slide\n---\n## Slide 2",
               x: dropX,
               y: dropY,
               width: 600,
               height: 400,
               slideX: 0,
               slideY: 0,
               page: currentPage,
               segmentId: activeSegmentId
           });
        } else if (payload.type === 'quiz') {
           await onElementAdd('quiz', {
               question: payload.question || "New Quiz",
               options: ["A", "B", "C", "D"],
               x: dropX,
               y: dropY,
               page: currentPage,
               segmentId: activeSegmentId
           });
        } else if (payload.type === 'html-applet') {
           await onElementAdd('html-applet', {
               code: payload.code || "",
               x: dropX,
               y: dropY,
               page: currentPage,
               segmentId: activeSegmentId
           });
        } else if (payload.type === 'assignment') {
           await onElementAdd('assignment', {
               title: payload.title || "New Assignment",
               description: payload.description || "",
               x: dropX,
               y: dropY,
               page: currentPage,
               segmentId: activeSegmentId
           });
        } else if (payload.type === 'hello-world') {
            await onElementAdd('hello-world', {
                x: dropX,
                y: dropY,
                page: currentPage,
                segmentId: activeSegmentId
            });
         } else if (payload.type === 'rollcall') {
            await onElementAdd('rollcall', {
                allStudents: [],
                x: dropX,
                y: dropY,
                page: currentPage,
                segmentId: activeSegmentId
            });
         }
        frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
        if (onRefresh) onRefresh();
      } finally {
        setIsSyncing(false);
      }
    } catch (err) {
      console.error("Drop error", err);
    }
  };

  return (
    <div className="flex-1 flex flex-row min-h-0 overflow-hidden bg-white">
      <div 
        className="flex-1 flex flex-col min-h-0 bg-white relative min-w-0"
        onDragOver={handleWhiteboardDragOver}
        onDragEnter={handleWhiteboardDragEnter}
        onDrop={handleWhiteboardDrop}
      >
      <div className="flex items-center justify-center gap-2 p-2 bg-gray-100 border-b border-gray-200 absolute top-0 left-0 right-0 w-full z-10 shadow-sm animate-in fade-in duration-200">
        <button onClick={() => { setTool('cursor'); setSelectedShapeId(null); }} className={`p-1.5 rounded ${tool === 'cursor' ? 'bg-white shadow' : 'hover:bg-gray-200'}`} title="Cursor Selector">
          <MousePointer2 size={16} />
        </button>
        <button onClick={() => setTool('pen')} className={`p-1.5 rounded ${tool === 'pen' ? 'bg-white shadow' : 'hover:bg-gray-200'}`} title="Drawing Pen">
          <PenTool size={16} />
        </button>
        <button onClick={() => setTool('highlighter')} className={`p-1.5 rounded ${tool === 'highlighter' ? 'bg-white shadow text-yellow-600' : 'hover:bg-gray-200'}`} title="Highlighter Annotation">
          <Highlighter size={16} />
        </button>
        {tool === 'highlighter' && (
          <div className="flex items-center gap-1 bg-white p-1 rounded-md shadow-inner border border-gray-200 animate-in zoom-in-95 duration-150">
            {[
              { hex: '#facc15', label: 'Yellow' },
              { hex: '#4ade80', label: 'Green' },
              { hex: '#f472b6', label: 'Pink' },
              { hex: '#60a5fa', label: 'Blue' }
            ].map((col) => (
              <button
                key={col.hex}
                onClick={() => setHighlighterColor(col.hex)}
                className={`w-3.5 h-3.5 rounded-full border transition-all ${highlighterColor === col.hex ? 'ring-2 ring-indigo-500 scale-115 border-indigo-400' : 'border-gray-300'}`}
                style={{ backgroundColor: col.hex }}
                title={col.label}
              />
            ))}
          </div>
        )}
        <button onClick={() => setTool('rect')} className={`p-1.5 rounded ${tool === 'rect' ? 'bg-white shadow' : 'hover:bg-gray-200'}`}>
          <Square size={16} />
        </button>
        <button onClick={() => setTool('circle')} className={`p-1.5 rounded ${tool === 'circle' ? 'bg-white shadow' : 'hover:bg-gray-200'}`}>
          <CircleIcon size={16} />
        </button>
        <button onClick={() => setTool('text')} className={`p-1.5 rounded ${tool === 'text' ? 'bg-white shadow' : 'hover:bg-gray-200'}`}>
          <Type size={16} />
        </button>
         <button 
          onClick={() => {
             setDialogInput('# Title Slide\n---\n## Slide 2');
             setDialog({
                type: 'prompt',
                title: '添加演示文稿',
                message: '请输入演示文稿的 Markdown 内容 (使用 --- 拆分新幻灯片):',
                placeholder: '# Title Slide\n---\n## Slide 2',
                onConfirm: async (inputValue) => {
                   const md = inputValue || '# Title Slide\n---\n## Slide 2';
                   setIsSyncing(true);
                   try {
                      await onElementAdd('presentation', {
                          markdown: md,
                          x: 50,
                          y: 50,
                          width: 600,
                          height: 400,
                          slideX: 0,
                          slideY: 0,
                          page: currentPage,
                          segmentId: activeSegmentId
                      });
                      frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                   } finally {
                      setIsSyncing(false);
                      setDialog(null);
                   }
                }
             });
          }} 
          className="p-1.5 rounded hover:bg-gray-200"
          title="Add Presentation"
        >
          <Presentation size={16} />
        </button>
        <button
          onClick={async () => {
             setIsSyncing(true);
             try {
                await onElementAdd('code-sandbox', {
                    code: "console.log('Hello Sandbox!');",
                    x: 100,
                    y: 100,
                    page: currentPage,
                    segmentId: activeSegmentId
                });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
             } finally {
                setIsSyncing(false);
             }
          }} 
          className="p-1.5 rounded hover:bg-gray-200"
          title="Add Code Sandbox"
        >
          <Terminal size={16} />
        </button>
        <button
          onClick={async () => {
             setIsSyncing(true);
             try {
                await onElementAdd('math-graph', {
                    equation: "Math.sin(x)",
                    x: 100,
                    y: 150,
                    page: currentPage,
                    segmentId: activeSegmentId
                });
                frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
             } finally {
                setIsSyncing(false);
             }
          }} 
          className="p-1.5 rounded hover:bg-gray-200"
          title="Add Math Graph Sandbox"
        >
          <Activity size={16} />
        </button>
        <button
          onClick={async () => {
             setIsSyncing(true);
             try {
                const res = await fetch(`/api/lessons/${lessonId}/ai-tutor`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ elements: safeElements.map(e => ({ type: e.type, data: JSON.parse(e.data) })) })
                });
                if (res.ok) {
                   frontendEventBus.publish({
      id: uuidv7(),
      type: 'whiteboard.element_updated',
      source: 'whiteboard',
      payload: { lessonId },
      timestamp: Date.now(),
      correlationId: lessonId,
    });
                   if (onRefresh) onRefresh();
                } else {
                   setDialog({
                      type: 'alert',
                      title: 'AI 辅导提示',
                      message: '无法获取 AI 授课助手的帮助，请稍后再试。',
                      onConfirm: () => setDialog(null)
                    });
                }
             } finally {
                setIsSyncing(false);
             }
          }}
          className="p-1.5 rounded hover:bg-purple-100 text-purple-600 bg-purple-50 shadow-sm ml-2 font-medium flex items-center gap-1 text-xs"
          title="Ask AI Tutor for a hint"
        >
          <Wand2 size={14} /> Ask AI
        </button>
        {selectedShapeId && (
          <button
            onClick={() => {
              handleElementDelete(selectedShapeId);
              setSelectedShapeId(null);
            }}
            className="p-1.5 rounded hover:bg-neutral-100 text-gray-700 shadow-sm font-semibold flex items-center gap-1 text-xs select-none"
            title="Delete selected shape"
          >
            <Trash2 size={14} /> 删除选中
          </button>
        )}
        {userRole !== 'student' ? (
          <button
            onClick={handleClearBoard}
            className="p-1.5 rounded hover:bg-red-100 text-red-600 bg-red-50 shadow-sm font-semibold flex items-center gap-1 text-xs select-none"
            title="Clear Board (Remove all elements)"
          >
            <Eraser size={14} /> 清空白板
          </button>
        ) : (
          <button
            onClick={handleResetBoard}
            className="p-1.5 rounded hover:bg-amber-100 text-amber-600 bg-amber-50 shadow-sm font-semibold flex items-center gap-1 text-xs select-none"
            title="Reset Board (Revert to initial state)"
          >
            <RotateCcw size={14} /> 重置白板
          </button>
        )}
        <div className="w-px h-4 bg-gray-300 mx-1"></div>
        {isSyncing && <Loader2 size={14} className="text-gray-400 animate-spin" />}
      </div>
      
      <div 
        ref={containerRef} 
        className="flex-1 bg-gray-50/50 rounded-lg border border-dashed border-gray-200 relative overflow-hidden mt-12 w-full mb-16"
        onDragOver={handleWhiteboardDragOver}
        onDragEnter={handleWhiteboardDragEnter}
        onDrop={handleWhiteboardDrop}
      >
        <div className="absolute inset-0 w-full h-full overflow-hidden">
          {containerSize.width > 0 && containerSize.height > 0 && (
            fullscreenElementId ? (
              /* ── Fullscreen overlay ── */
              (() => {
                const fsEl = safeElements.find(e => e.id === fullscreenElementId);
                if (!fsEl) { setFullscreenElementId(null); return null; }
                let fsData: any = {};
                try { fsData = JSON.parse(fsEl.data); } catch (_) {}
                const pad = 16;
                const fsW = containerSize.width - pad * 2;
                const fsH = containerSize.height - pad * 2;
                return (
                  <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" style={{ pointerEvents: 'auto' }}>
                    <div className="relative bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ width: Math.max(400, fsW), height: Math.max(300, fsH) }}>
                      <div className="bg-indigo-50 text-indigo-700 px-4 py-2 flex justify-between items-center text-sm font-semibold border-b border-indigo-100 shrink-0">
                        <span>{fsEl.type === 'quiz' ? '📝 随堂测验' : fsEl.type === 'timer' ? '⏱ 计时器' : fsEl.type === 'assignment' ? '📋 作业' : fsEl.type === 'code-sandbox' ? '💻 代码沙箱' : fsEl.type === 'html-applet' ? '🌐 交互课件' : fsEl.type === 'rollcall' ? '🎲 随机点名' : fsEl.type}</span>
                        <button
                          onClick={() => setFullscreenElementId(null)}
                          className="p-1.5 hover:bg-indigo-200/50 rounded-lg text-indigo-600 hover:text-indigo-900 transition-colors cursor-pointer flex items-center gap-1 text-xs"
                        >
                          <Minimize2 size={14} /> 退出全屏
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto p-6">
                        {fsEl.type === 'quiz' && (
                          <div className="max-w-2xl mx-auto space-y-6">
                            <h3 className="text-xl font-bold text-gray-800">{fsData.question}</h3>
                            <div className="flex flex-col gap-3">
                              {(fsData.options || []).map((opt: string, i: number) => (
                                <button key={i} className="px-5 py-4 text-left bg-gray-50 border-2 border-gray-200 rounded-xl text-base hover:bg-gray-100 transition-colors">
                                  <span className="font-bold text-indigo-600 mr-3">{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]}.</span>
                                  {opt}
                                </button>
                              ))}
                            </div>
                            {fsData.submissions && Object.keys(fsData.submissions).length > 0 && (
                              <div className="mt-4 p-4 bg-gray-50 rounded-xl">
                                <p className="text-sm font-semibold text-gray-600">提交统计: {Object.keys(fsData.submissions).length} 人已作答</p>
                              </div>
                            )}
                          </div>
                        )}
                        {fsEl.type === 'timer' && (
                          <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                              <div className="text-8xl font-mono font-bold text-orange-600 mb-4">
                                {String(Math.floor((fsData.remaining ?? fsData.duration ?? 60) / 60)).padStart(2, '0')}:{String((fsData.remaining ?? fsData.duration ?? 60) % 60).padStart(2, '0')}
                              </div>
                              <p className="text-lg text-gray-500">{fsData.label || '计时器'}</p>
                            </div>
                          </div>
                        )}
                        {fsEl.type === 'assignment' && (
                          <div className="max-w-2xl mx-auto space-y-6">
                            <h3 className="text-xl font-bold text-gray-800">{fsData.title}</h3>
                            <p className="text-gray-600 text-base whitespace-pre-wrap">{fsData.description}</p>
                            <button className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 rounded-xl transition-colors text-base shadow-sm cursor-pointer">Upload File</button>
                          </div>
                        )}
                        {fsEl.type === 'code-sandbox' && (
                          <div className="h-full flex flex-col gap-4">
                            <textarea value={fsData.code || ''} readOnly className="flex-1 p-4 bg-gray-900 text-green-400 font-mono text-sm rounded-xl resize-none" />
                          </div>
                        )}
                        {fsEl.type === 'html-applet' && (
                          <div className="h-full flex items-center justify-center">
                            <div className="text-center text-gray-500">
                              <BookOpen size={64} className="mx-auto mb-4 text-indigo-300" />
                              <p className="text-lg font-semibold">{fsData.title || '交互课件'}</p>
                              {fsData.coursewareUuid && <iframe src={`/runtime/${fsData.coursewareUuid}/`} className="w-full h-[60vh] mt-4 rounded-xl border" />}
                            </div>
                          </div>
                        )}
                        {fsEl.type === 'rollcall' && (
                          <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                              <div className="text-6xl font-bold text-indigo-600 mb-4">{fsData.selectedStudent || '点击点名'}</div>
                              <p className="text-lg text-gray-500">随机点名</p>
                            </div>
                          </div>
                        )}
                        {!['quiz', 'timer', 'assignment', 'code-sandbox', 'html-applet', 'rollcall'].includes(fsEl.type) && (
                          <div className="flex items-center justify-center h-full text-gray-400 text-sm">此组件类型暂不支持全屏预览</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
            <Stage
            width={containerSize.width}
            height={containerSize.height}
            onMouseDown={handleMouseDown}
            onMousemove={handleMouseMove}
            onMouseup={handleMouseUp}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              const containerRect = containerRef.current?.getBoundingClientRect();
              if (containerRect) {
                const x = e.evt.clientX - containerRect.left;
                const y = e.evt.clientY - containerRect.top;
                
                const node = e.target;
                const targetId = node.id();
                
                if (targetId) {
                  setSelectedShapeId(targetId);
                  setContextMenu({
                    x,
                    y,
                    elementId: targetId
                  });
                } else {
                  setContextMenu({
                    x,
                    y
                  });
                }
              }
            }}
            ref={stageRef}
            className="w-full h-full cursor-crosshair"
          >
            <Layer>
              {safeElements.filter(el => {
                try {
                  const data = JSON.parse(el.data);
                  if (activeSegmentId) {
                    const elSegment = data.segmentId || 'seg-1';
                    return elSegment === activeSegmentId;
                  } else {
                    const elPage = data.page ?? 0;
                    return elPage === currentPage;
                  }
                } catch (e) {
                  return activeSegmentId ? activeSegmentId === 'seg-1' : currentPage === 0;
                }
              }).map(renderElement)}
              {/* Show drawing in progress */}
              {renderActiveDrawing()}
              {/* Show remote drawings */}
              {renderRemoteDrawings()}
            </Layer>
          </Stage>
          )
        )}

        {/* Floating Context-sensitive Deletion Pill above selected shape */}
        {selectedShapeId && (() => {
          const selectedEl = safeElements.find(e => e.id === selectedShapeId);
          if (!selectedEl) return null;
          const pos = getElementFloatingPosition(selectedEl);
          if (!pos) return null;
          
          const left = Math.max(10, Math.min(containerSize.width - 150, pos.x - 60));
          const top = Math.max(10, Math.min(containerSize.height - 50, pos.y));
          
          return (
            <div 
              style={{ left: `${left}px`, top: `${top}px`, pointerEvents: 'auto' }}
              className="absolute bg-white text-gray-800 shadow-xl border border-red-200 rounded-lg py-1 px-2 flex items-center gap-1.5 z-30 animate-in fade-in slide-in-from-bottom-2 duration-150 animate-out fade-out duration-100"
            >
              <span className="text-xs font-semibold px-1 text-gray-500 capitalize select-none">{selectedEl.type}</span>
              <div className="w-[1px] h-3 bg-gray-200" />
              <button 
                onClick={() => {
                  handleElementDelete(selectedShapeId);
                  setSelectedShapeId(null);
                }}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-white hover:bg-red-600 px-2 py-0.5 rounded transition-all font-medium cursor-pointer"
              >
                <Trash2 size={12} />
                删除
              </button>
            </div>
          );
        })()}

        {/* Elegant Right-Click Context Menu */}
        {contextMenu && (
          <div 
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px`, pointerEvents: 'auto' }}
            className="absolute bg-white rounded-lg shadow-2xl border border-gray-200 py-1.5 w-44 z-40 font-sans text-sm animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {contextMenu.elementId ? (
              <>
                <div className="px-3 py-1 text-[11px] text-gray-500 font-bold uppercase tracking-wider select-none">
                  组件选项
                </div>
                <button 
                  onClick={() => {
                    const elId = contextMenu.elementId;
                    if (elId) {
                      handleElementDelete(elId);
                      if (selectedShapeId === elId) {
                        setSelectedShapeId(null);
                      }
                    }
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 flex items-center gap-2 text-left text-red-600 hover:bg-red-50 transition-colors text-xs font-semibold"
                >
                  <Trash2 size={14} />
                  删除此组件
                </button>
              </>
            ) : (
              <>
                <div className="px-3 py-1 text-[11px] text-gray-400 font-bold uppercase tracking-wider select-none">
                  白板操作
                </div>
                <button 
                  onClick={() => {
                    setTool('cursor');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'cursor' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <MousePointer2 size={14} />
                  选择工具 (Cursor)
                </button>
                <button 
                  onClick={() => {
                    setTool('pen');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'pen' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <PenTool size={14} />
                  画笔工具 (Pen)
                </button>
                <button 
                  onClick={() => {
                    setTool('highlighter');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'highlighter' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <Highlighter size={14} />
                  高亮荧光笔 (Highlighter)
                </button>
                <button 
                  onClick={() => {
                    setTool('rect');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'rect' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <Square size={14} />
                  矩形工具 (Rectangle)
                </button>
                <button 
                  onClick={() => {
                    setTool('circle');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'circle' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <CircleIcon size={14} />
                  圆形工具 (Circle)
                </button>
                <button 
                  onClick={() => {
                    setTool('text');
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 text-left text-xs font-medium hover:bg-gray-50 transition-colors ${tool === 'text' ? 'text-indigo-600' : 'text-gray-750'}`}
                >
                  <Type size={14} />
                  文本工具 (Text)
                </button>
              </>
            )}
          </div>
        )}
        </div>
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 bg-white px-4 py-2 rounded-full shadow border border-gray-200">
          <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} className="p-1 hover:bg-gray-100 rounded" disabled={currentPage === 0}>
             <ChevronLeft size={20} className={currentPage === 0 ? "text-gray-300" : "text-gray-700"} />
          </button>
          <span className="text-sm font-medium text-gray-600">Page {currentPage + 1}</span>
          <button onClick={() => setCurrentPage(p => p + 1)} className="p-1 hover:bg-gray-100 rounded">
             <ChevronRight size={20} className="text-gray-700" />
          </button>
      </div>

      {dialog && (
        <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4 font-sans">
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden max-w-sm w-full border border-gray-100 flex flex-col scale-100 pointer-events-auto">
            <div className="px-5 py-4 border-b border-gray-150/60 bg-gray-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-gray-800 text-sm">{dialog.title}</h3>
              <button onClick={() => setDialog(null)} className="text-gray-400 hover:text-gray-650 transition-colors text-xl font-light cursor-pointer">×</button>
            </div>
            <div className="p-5 flex-1 min-h-0">
              <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap mb-4 font-medium">{dialog.message}</p>
              {dialog.type === 'prompt' && (
                <textarea
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  placeholder={dialog.placeholder}
                  className="w-full h-32 p-3 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 focus:bg-white transition-all resize-none font-medium"
                  onPointerDown={(e) => e.stopPropagation()}
                />
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2 text-xs shrink-0">
              {dialog.type !== 'alert' && (
                <button
                  onClick={() => setDialog(null)}
                  className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors font-medium border border-gray-200 cursor-pointer"
                >
                  取消
                </button>
              )}
              <button
                onClick={async () => {
                  try {
                    await dialog.onConfirm(dialogInput);
                  } catch (e) {
                    console.error("Dialog action error:", e);
                  }
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-all shadow-sm cursor-pointer"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {showEntrySelector && zipUploadInfo && (
        <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4 font-sans">
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden max-w-sm w-full border border-gray-100 flex flex-col scale-100 pointer-events-auto">
            <div className="px-5 py-4 border-b border-gray-150/60 bg-gray-50 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-gray-800 text-sm">选择课件入口页面</h3>
              <button onClick={() => setShowEntrySelector(false)} className="text-gray-400 hover:text-gray-650 transition-colors text-xl font-light cursor-pointer">×</button>
            </div>
            <div className="p-5 flex-1 min-h-0 space-y-3">
              <p className="text-xs text-gray-600 leading-relaxed font-medium">ZIP压缩包中含有多个HTML文件，请选择一个作为课件入口：</p>
              <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50 space-y-1">
                {zipCandidates.map(c => (
                  <button
                    key={c}
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/courseware/confirm', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            uuid: zipUploadInfo.uuid,
                            name: zipUploadInfo.name,
                            entry: c
                          })
                        });
                        if (res.ok) {
                          const data = await res.json();
                          handlePropsUpdate({ coursewareUuid: data.uuid, resourceId: '' });
                          
                          setShowEntrySelector(false);
                          fetchCoursewares();
                        }
                      } catch (err) {
                        console.error('Failed to confirm entry point:', err);
                      }
                    }}
                    className="w-full text-left p-2 rounded hover:bg-indigo-50 hover:text-indigo-700 text-xs font-semibold font-mono truncate transition-all cursor-pointer"
                  >
                    📄 {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2 text-xs shrink-0">
              <button
                onClick={() => setShowEntrySelector(false)}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors font-medium border border-gray-200 cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* 注入右侧属性编辑器侧边栏 */}
    {isEditMode && selectedShapeId && editingProperties && (() => {
       const selectedEl = safeElements.find(e => e.id === selectedShapeId);
       if (!selectedEl) return null;
       
       return (
          <div className="w-80 h-full max-h-full bg-slate-50 border-l border-slate-200 flex flex-col font-sans text-xs select-none shadow-xl shrink-0 z-20 animate-in slide-in-from-right duration-200" onPointerDown={e => e.stopPropagation()}>
            {/* 顶栏 */}
            <div className="px-4 py-3 border-b border-slate-200 bg-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <Settings size={15} className="text-slate-500 animate-spin" style={{ animationDuration: '6s' }} />
                <span className="font-bold text-slate-800 text-sm">属性编辑器</span>
              </div>
              <div className="flex items-center gap-1.5 font-sans">
                {/* 撤销 (Undo) 按钮 */}
                <button
                  onClick={handleUndoProp}
                  disabled={(propertyUndoStack[selectedShapeId] || []).length === 0}
                  className={`p-1 rounded-lg transition-all flex items-center justify-center gap-1 border border-transparent select-none cursor-pointer ${
                    (propertyUndoStack[selectedShapeId] || []).length === 0
                      ? 'text-slate-350 bg-transparent border-transparent opacity-40 cursor-not-allowed'
                      : 'text-slate-700 bg-slate-50 hover:bg-slate-100 hover:border-slate-200 active:bg-slate-150'
                  }`}
                  title="撤销属性修改"
                >
                  <Undo2 size={13} />
                  {((propertyUndoStack[selectedShapeId] || []).length > 0) && (
                    <span className="text-[10px] font-bold text-slate-500">{(propertyUndoStack[selectedShapeId] || []).length}</span>
                  )}
                </button>

                {/* 重做 (Redo) 按钮 */}
                <button
                  onClick={handleRedoProp}
                  disabled={(propertyRedoStack[selectedShapeId] || []).length === 0}
                  className={`p-1 rounded-lg transition-all flex items-center justify-center gap-1 border border-transparent select-none cursor-pointer ${
                    (propertyRedoStack[selectedShapeId] || []).length === 0
                      ? 'text-slate-350 bg-transparent border-transparent opacity-40 cursor-not-allowed'
                      : 'text-slate-700 bg-slate-50 hover:bg-slate-100 hover:border-slate-200 active:bg-slate-150'
                  }`}
                  title="重做属性修改"
                >
                  <Redo2 size={13} />
                  {((propertyRedoStack[selectedShapeId] || []).length > 0) && (
                    <span className="text-[10px] font-bold text-slate-500">{(propertyRedoStack[selectedShapeId] || []).length}</span>
                  )}
                </button>

                <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />

                <button 
                  onClick={() => setSelectedShapeId(null)} 
                  className="text-slate-400 hover:text-slate-650 hover:bg-slate-100 p-1 rounded-full transition-all cursor-pointer"
                  title="关闭属性编辑器"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 基本标签和信息 */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">组件类型</span>
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-650 rounded text-[10px] font-bold uppercase tracking-wider">
                    {selectedEl.type}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">组件标识</span>
                  <span className="font-mono text-slate-500 text-[10px] truncate max-w-[155px]" title={selectedEl.id}>
                    {selectedEl.id}
                  </span>
                </div>
              </div>

              {/* 通用属性: X, Y 坐标及宽高 */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5 flex items-center gap-1.5">
                  物理定位 & 尺寸
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">X 坐标</label>
                    <input 
                      type="number"
                      value={Math.round(editingProperties.x ?? 0)}
                      onChange={(e) => handleLocalPropChange('x', parseFloat(e.target.value) || 0)}
                      onBlur={(e) => handleNumericPropBlur('x', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">Y 坐标</label>
                    <input 
                      type="number"
                      value={Math.round(editingProperties.y ?? 0)}
                      onChange={(e) => handleLocalPropChange('y', parseFloat(e.target.value) || 0)}
                      onBlur={(e) => handleNumericPropBlur('y', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {selectedEl.type !== 'pen' && selectedEl.type !== 'circle' && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">宽度 (Width)</label>
                      <input 
                        type="number"
                        min="50"
                        value={Math.round(editingProperties.width ?? 300)}
                        onChange={(e) => handleLocalPropChange('width', parseFloat(e.target.value) || 50)}
                        onBlur={(e) => handleNumericPropBlur('width', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">高度 (Height)</label>
                      <input 
                        type="number"
                        min="50"
                        value={Math.round(editingProperties.height ?? 300)}
                        onChange={(e) => handleLocalPropChange('height', parseFloat(e.target.value) || 50)}
                        onBlur={(e) => handleNumericPropBlur('height', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}

                {selectedEl.type === 'circle' && (
                  <div className="mt-2">
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">半径 (Radius)</label>
                    <input 
                      type="number"
                      min="5"
                      value={Math.round(editingProperties.radius ?? 50)}
                      onChange={(e) => handleLocalPropChange('radius', parseFloat(e.target.value) || 5)}
                      onBlur={(e) => handleNumericPropBlur('radius', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* 1. QUIZ (测验配置) */}
              {selectedEl.type === 'quiz' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    随堂测验配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">测验题目 (Question)</label>
                    <textarea
                      value={editingProperties.question || ''}
                      onChange={(e) => handleLocalPropChange('question', e.target.value)}
                      onBlur={(e) => handlePropBlur('question', e.target.value)}
                      className="w-full h-20 p-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none font-medium leading-relaxed"
                      placeholder="编写问题描述..."
                    />
                  </div>

                  {/* Correct answer selector */}
                  {(editingProperties.options || []).length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      <label className="block text-[10px] text-amber-700 font-bold mb-1.5">
                        ⚠️ 正确答案 (Correct Answer)
                      </label>
                      <select
                        value={editingProperties.correctAnswer || ''}
                        onChange={(e) => {
                          handleLocalPropChange('correctAnswer', e.target.value);
                          handlePropBlur('correctAnswer', e.target.value);
                        }}
                        className={`w-full px-2 py-1.5 border rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer ${
                          editingProperties.correctAnswer
                            ? 'border-green-300 bg-green-50 text-green-800'
                            : 'border-amber-300 bg-white text-amber-800'
                        }`}
                      >
                        <option value="">-- 请选择正确答案 --</option>
                        {(editingProperties.options || []).map((opt: string, idx: number) => (
                          <option key={idx} value={opt}>{opt}</option>
                        ))}
                      </select>
                      {!editingProperties.correctAnswer && (
                        <p className="text-[9px] text-amber-600 mt-1">未设置正确答案将无法自动判分</p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="block text-[10px] text-slate-400 font-semibold">
                      选项列表 (Options)
                    </label>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {(editingProperties.options || []).map((opt: string, idx: number) => {
                        const optionLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                        const label = optionLabels[idx] || (idx + 1);
                        return (
                          <div key={idx} className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-700 bg-slate-100 rounded px-1.5 py-1 text-center shrink-0 min-w-[22px]">
                              {label}
                            </span>
                            <input 
                              type="text"
                              value={opt || ''}
                              onChange={(e) => handleOptionChangeLocal(idx, e.target.value)}
                              onBlur={(e) => handleOptionBlur(idx, e.target.value)}
                              className="flex-1 px-2 py-1 border border-slate-200 rounded-lg text-xs font-medium"
                            />
                            <button
                              onClick={() => handleRemoveOption(idx)}
                              title="删除选项"
                              className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1 rounded-md shrink-0 transition-colors cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    
                    <button
                      onClick={handleAddOption}
                      className="w-full mt-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold border border-slate-200/80 rounded-lg flex items-center justify-center gap-1 hover:text-slate-700 transition-all text-[11px] cursor-pointer"
                    >
                      <Plus size={12} /> 添加选项
                    </button>
                  </div>
                </div>
              )}

              {/* 2. ASSIGNMENT (作业配置) */}
              {selectedEl.type === 'assignment' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    作业选项配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">作业任务标题 (Title)</label>
                    <input 
                      type="text"
                      value={editingProperties.title || ''}
                      onChange={(e) => handleLocalPropChange('title', e.target.value)}
                      onBlur={(e) => handlePropBlur('title', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="作业名..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">详细作业要求描述</label>
                    <textarea
                      value={editingProperties.description || ''}
                      onChange={(e) => handleLocalPropChange('description', e.target.value)}
                      onBlur={(e) => handlePropBlur('description', e.target.value)}
                      className="w-full h-24 p-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none font-medium leading-relaxed"
                      placeholder="请输入详细的作业指南..."
                    />
                  </div>
                </div>
              )}

              {/* 3. CODE SANDBOX 和 HTML APPLET 和 Sandbox */}
              {(selectedEl.type === 'code-sandbox' || selectedEl.type === 'html-applet') && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5 flex justify-between items-center">
                    <span>动态运行代码定制</span>
                    {selectedEl.type === 'html-applet' && (
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold">HTML Applet</span>
                    )}
                  </h4>

                  {selectedEl.type === 'html-applet' && (
                    <div className="space-y-3 border-b border-slate-100 pb-3">
                      <div>
                        <label className="block text-[10px] text-indigo-600 font-bold mb-1">选择 AI 互动课件 (ZIP/HTML):</label>
                        <select
                          value={editingProperties.coursewareUuid || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            handlePropsUpdate({ coursewareUuid: val, resourceId: '' });
                          }}
                          className="w-full text-xs p-2 bg-slate-50 border border-indigo-200 hover:border-indigo-300 rounded-lg text-slate-750 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-semibold"
                        >
                          <option value="">-- 使用系统资源或自定义代码 --</option>
                          {coursewares.map(c => (
                            <option key={c.id} value={c.uuid}>
                              📁 [互动课件] {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-500 font-bold mb-1">选择已有的系统资源:</label>
                        <select
                          value={editingProperties.resourceId || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            handlePropsUpdate({ resourceId: val, coursewareUuid: '' });
                          }}
                          className="w-full text-xs p-2 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg text-slate-750 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-semibold"
                        >
                          <option value="">-- 使用互动课件或自定义代码 --</option>
                          {systemResources.map(r => (
                            <option key={r.id} value={r.id}>
                              [{r.type === 'folder' ? '文件夹' : '单HTML'}] {r.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-[10px] text-slate-500 space-y-2">
                        <span className="font-bold text-slate-600 block">上传资源 (会自动保存到对应库):</span>
                        <div className="grid grid-cols-2 gap-2">
                          {/* Courseware ZIP/HTML Upload */}
                          <label className="col-span-2 flex flex-col items-center justify-center p-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 hover:border-indigo-300 rounded-lg cursor-pointer text-center transition-all">
                            <span className="font-bold text-indigo-700 text-[10px]">✨ 上传 AI 互动课件 (.zip/.html)</span>
                            <input
                              type="file"
                              accept=".zip,.html,.htm"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                  const result = event.target?.result as string;
                                  try {
                                    const res = await fetch('/api/courseware/upload', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        name: file.name.replace(/\.[^/.]+$/, ""),
                                        filename: file.name,
                                        base64Data: result
                                      })
                                    });
                                    if (res.ok) {
                                      const data = await res.json();
                                      if (data.need_select_entry) {
                                        setZipCandidates(data.candidates);
                                        setZipUploadInfo({ uuid: data.uuid, name: data.name });
                                        setShowEntrySelector(true);
                                      } else {
                                        handlePropsUpdate({ coursewareUuid: data.uuid, resourceId: '' });
                                        
                                        fetchCoursewares();
                                      }
                                    } else {
                                      const errData = await res.json();
                                      alert("上传失败: " + (errData.error || res.statusText));
                                    }
                                  } catch (err) {
                                    console.error('Courseware upload failed:', err);
                                  }
                                };
                                reader.readAsDataURL(file);
                              }}
                            />
                          </label>

                          {/* Single HTML File Upload */}
                          <label className="flex flex-col items-center justify-center p-2 bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-lg cursor-pointer text-center transition-all">
                            <span className="font-bold text-slate-600 text-[10px]">📄 上传系统HTML文件</span>
                            <input
                              type="file"
                              accept=".html,.htm"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = async (event) => {
                                  const text = event.target?.result as string;
                                  try {
                                    const res = await fetch('/api/resources', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        name: file.name,
                                        type: 'html',
                                        content: text
                                      })
                                    });
                                    if (res.ok) {
                                      const data = await res.json();
                                      handlePropsUpdate({ resourceId: data.id, coursewareUuid: '' });
                                      fetchSystemResources();
                                    }
                                  } catch (err) {
                                    console.error('Upload failed:', err);
                                  }
                                };
                                reader.readAsText(file);
                              }}
                            />
                          </label>

                          {/* Folder Upload */}
                          <label className="flex flex-col items-center justify-center p-2 bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-lg cursor-pointer text-center transition-all">
                            <span className="font-bold text-slate-600 text-[10px]">📁 上传系统文件夹</span>
                            <input
                              type="file"
                              {...{
                                webkitdirectory: "",
                                directory: "",
                              } as any}
                              multiple
                              className="hidden"
                              onChange={async (e) => {
                                const files = e.target.files;
                                if (!files || files.length === 0) return;
                                
                                const filesToUpload: { path: string; content: string }[] = [];
                                let folderName = '';
                                
                                for (let i = 0; i < files.length; i++) {
                                  const file = files[i];
                                  const relPath = file.webkitRelativePath || file.name;
                                  if (!folderName) {
                                    folderName = relPath.split('/')[0] || 'uploaded_resource';
                                  }
                                  
                                  const ext = file.name.split('.').pop()?.toLowerCase();
                                  const isBinary = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext || '');
                                  
                                  await new Promise<void>((resolve) => {
                                    const reader = new FileReader();
                                    reader.onload = (evt) => {
                                      const content = evt.target?.result as string;
                                      filesToUpload.push({
                                        path: relPath,
                                        content: content
                                      });
                                      resolve();
                                    };
                                    if (isBinary) {
                                      reader.readAsDataURL(file);
                                    } else {
                                      reader.readAsText(file);
                                    }
                                  });
                                }

                                try {
                                  const res = await fetch('/api/resources', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      name: folderName,
                                      type: 'folder',
                                      content: JSON.stringify(filesToUpload)
                                    })
                                  });
                                  if (res.ok) {
                                    const data = await res.json();
                                    handlePropsUpdate({ resourceId: data.id, coursewareUuid: '' });
                                    fetchSystemResources();
                                  }
                                } catch (err) {
                                  console.error('Folder upload failed:', err);
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {(!editingProperties.resourceId && !editingProperties.coursewareUuid || selectedEl.type === 'code-sandbox') && (
                    <div>
                      <label className="block text-[10px] text-slate-400 font-semibold mb-1">沙箱程序代码 (Source Code)</label>
                      <textarea
                        value={editingProperties.code || ''}
                        onChange={(e) => handleLocalPropChange('code', e.target.value)}
                        onBlur={(e) => handlePropBlur('code', e.target.value)}
                        className="w-full h-48 p-3 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-900 text-slate-100 resize-none leading-relaxed"
                        placeholder="// 编写交互沙箱代码..."
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 4. MATH GRAPH */}
              {selectedEl.type === 'math-graph' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    函数解析拟合
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">
                      函数表达式 y = f(x)
                    </label>
                    <input 
                      type="text"
                      value={editingProperties.equation || ''}
                      onChange={(e) => handleLocalPropChange('equation', e.target.value)}
                      onBlur={(e) => handlePropBlur('equation', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-100"
                    />
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                      支持标准 JS 表达式。 示例：<br />
                      • <code className="bg-slate-100 px-1 rounded">Math.sin(x)</code> 正负弦波形<br />
                      • <code className="bg-slate-100 px-1 rounded">Math.cos(x) * x</code> 振幅衰减
                    </p>
                  </div>
                </div>
              )}

              {/* 5. PRESENTATION */}
              {selectedEl.type === 'presentation' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    幻灯片 Markdown 文案
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">Markdown 源代码</label>
                    <textarea
                      value={editingProperties.markdown || ''}
                      onChange={(e) => handleLocalPropChange('markdown', e.target.value)}
                      onBlur={(e) => handlePropBlur('markdown', e.target.value)}
                      className="w-full h-64 p-2.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-100 resize-none font-medium leading-relaxed bg-slate-50"
                      placeholder="修改 Markdown 内容..."
                    />
                  </div>
                </div>
              )}

              {/* 6. TEXT (文字颜色样式) */}
              {selectedEl.type === 'text' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    文字属性管理
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">文本内容</label>
                    <input 
                      type="text"
                      value={editingProperties.text || ''}
                      onChange={(e) => handleLocalPropChange('text', e.target.value)}
                      onBlur={(e) => handlePropBlur('text', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">文字大小 (FontSize)</label>
                    <input 
                      type="number"
                      min="10"
                      max="100"
                      value={editingProperties.fontSize || 16}
                      onChange={(e) => handleLocalPropChange('fontSize', parseInt(e.target.value) || 10)}
                      onBlur={(e) => handleNumericPropBlur('fontSize', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">文字填充颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.color || '#000000'}
                        onChange={(e) => handleLocalPropChange('color', e.target.value)}
                        onBlur={(e) => handlePropBlur('color', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.color || '#000000'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 7. RECTANGLE 和 SHAPE */}
              {(selectedEl.type === 'rectangle' || selectedEl.type === 'shape') && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    矩形样式配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">外边框颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.stroke || '#000000'}
                        onChange={(e) => handleLocalPropChange('stroke', e.target.value)}
                        onBlur={(e) => handlePropBlur('stroke', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.stroke || '#000000'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 8. CIRCLE */}
              {selectedEl.type === 'circle' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    圆形样式配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">外边框颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.stroke || '#000000'}
                        onChange={(e) => handleLocalPropChange('stroke', e.target.value)}
                        onBlur={(e) => handlePropBlur('stroke', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.stroke || '#000000'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 9. PEN */}
              {selectedEl.type === 'pen' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    线条样式配置
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">折线颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.color || '#000000'}
                        onChange={(e) => handleLocalPropChange('color', e.target.value)}
                        onBlur={(e) => handlePropBlur('color', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.color || '#000000'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 10. HIGHLIGHTER */}
              {selectedEl.type === 'highlighter' && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-slate-700 text-xs border-b border-slate-100 pb-1.5">
                    高亮荧光标记 (Highlighter)
                  </h4>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-semibold mb-1">荧光笔颜色</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="color"
                        value={editingProperties.color || '#facc15'}
                        onChange={(e) => handleLocalPropChange('color', e.target.value)}
                        onBlur={(e) => handlePropBlur('color', e.target.value)}
                        className="w-8 h-8 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <span className="font-mono text-[11px] text-slate-500">
                        {editingProperties.color || '#facc15'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="text-[10px] text-slate-400 text-center select-none pt-2 font-medium">
                提示：属性在失焦或修改时自动同步，多端可见。
              </div>
            </div>

            {/* 底部操作按钮 */}
            <div className="p-3 border-t border-slate-200 bg-white flex flex-col gap-2 shrink-0">
              <button
                onClick={() => handleUpdateElementData(editingProperties)}
                disabled={isSyncing}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition-all shadow-sm hover:shadow active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 text-xs"
              >
                {isSyncing ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    正在广播同步...
                  </>
                ) : (
                  <>
                    <Paintbrush size={13} />
                    应用修改并强制同步
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  handleElementDelete(selectedShapeId);
                  setSelectedShapeId(null);
                }}
                className="w-full py-2 bg-red-50 hover:bg-red-105 text-red-650 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 border border-red-200 cursor-pointer text-xs"
              >
                <Trash2 size={13} />
                删除当前组件
              </button>
            </div>
          </div>
       );
    })()}

  </div>
  );
}
