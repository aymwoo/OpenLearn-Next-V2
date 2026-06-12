import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Pause, Users, Presentation, Clock, Shuffle, CheckCircle2, XCircle, Shield, ShieldAlert, Check, RefreshCw, Send, HelpCircle, Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import * as Icons from 'lucide-react';
import { InteractiveWhiteboard } from './InteractiveWhiteboard';

// Dynamic Icon component to render Lucide icons by name string
function DynamicIcon({ name, ...props }: { name: string; [key: string]: any }) {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) return <HelpCircle {...props} />;
  return React.createElement(IconComponent, props);
}

interface LiveClassroomViewProps {
  selectedLesson: string | null;
  setSelectedLesson: (id: string | null) => void;
  lessons: any[];
  classes: any[];
  students: any[];
  plugins: any[];
  lang: string;
  timelineSegments: any[];
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string | null) => void;
  liveClassSelectedClassId: string | null;
  setLiveClassSelectedClassId: (id: string | null) => void;
  liveClassIsActive: boolean;
  setLiveClassIsActive: (active: boolean) => void;
  liveClassTimeRemaining: number;
  setLiveClassTimeRemaining: (seconds: number) => void;
  liveClassFeed: any[];
  setLiveClassFeed: React.Dispatch<React.SetStateAction<any[]>>;
  liveClassAcknowledgedMap: Map<string, boolean>;
  setLiveClassAcknowledgedMap: React.Dispatch<React.SetStateAction<Map<string, boolean>>>;
  elements: any[];
  fetchElements: (lessonId: string) => Promise<void>;
  fetchStudents: () => Promise<void>;
  addToast: (title: string, message: string, type: 'info' | 'success' | 'warning') => void;
  onlineStudentIds: string[];
  activeStudentLessons: Record<string, string>;
  liveClassStudentProgress: any[];
  onPingStudent?: (studentId: string, message?: string) => void;
}

export function LiveClassroomView({
  selectedLesson,
  setSelectedLesson,
  lessons,
  classes,
  students,
  plugins,
  lang,
  timelineSegments,
  activeSegmentId,
  setActiveSegmentId,
  liveClassSelectedClassId,
  setLiveClassSelectedClassId,
  liveClassIsActive,
  setLiveClassIsActive,
  liveClassTimeRemaining,
  setLiveClassTimeRemaining,
  liveClassFeed,
  setLiveClassFeed,
  liveClassAcknowledgedMap,
  setLiveClassAcknowledgedMap,
  elements,
  fetchElements,
  fetchStudents,
  addToast,
  onlineStudentIds,
  activeStudentLessons,
  liveClassStudentProgress,
  onPingStudent
}: LiveClassroomViewProps) {
  const [lockingClass, setLockingClass] = useState(false);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [hoveredStudentId, setHoveredStudentId] = useState<string | null>(null);

  // Random drawing states
  const [isDrawing, setIsDrawing] = useState(false);
  const [activeDrawStudentId, setActiveDrawStudentId] = useState<string | null>(null);
  const [selectedDrawStudentIds, setSelectedDrawStudentIds] = useState<string[]>([]);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastAutoLockedRef = useRef<{ lesson: string | null; classId: string | null }>({
    lesson: null,
    classId: null
  });

  // Find if class-wide locking is active (if all students are locked to this lesson)
  const isClassLocked = !!(liveClassSelectedClassId && students
    .filter(s => s.locked_lesson_id === selectedLesson).length > 0);

  // Extract classroomTools from active plugins
  const activePlugins = plugins.filter(p => p.status === 'active');
  const classroomTools = activePlugins.flatMap(p => {
    try {
      const manifestObj = typeof p.manifest === 'string' ? JSON.parse(p.manifest) : p.manifest;
      return (manifestObj.classroomTools || []).map((t: any) => ({
        ...t,
        pluginId: p.id
      }));
    } catch (e) {
      return [];
    }
  });

  // Countdown timer effect
  useEffect(() => {
    if (liveClassIsActive && liveClassTimeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setLiveClassTimeRemaining(liveClassTimeRemaining - 1);
      }, 1000);
    } else if (liveClassTimeRemaining === 0 && liveClassIsActive) {
      addToast(
        lang === 'zh' ? '⏰ 环节时间到' : '⏰ Phase Timer Ended',
        lang === 'zh' ? '当前教学环节设定的时间已耗尽，建议转入下一环节。' : 'The current segment duration has elapsed. Transition recommended.',
        'warning'
      );
      setLiveClassIsActive(false);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [liveClassIsActive, liveClassTimeRemaining]);

  // Auto-lock class when selection changes
  useEffect(() => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      lastAutoLockedRef.current = { lesson: null, classId: null };
      return;
    }

    if (
      lastAutoLockedRef.current.lesson !== selectedLesson || 
      lastAutoLockedRef.current.classId !== liveClassSelectedClassId
    ) {
      lastAutoLockedRef.current = { lesson: selectedLesson, classId: liveClassSelectedClassId };
      handleToggleClassLock(true);
    }
  }, [selectedLesson, liveClassSelectedClassId]);

  // Helper to parse "5m" or "20m" to seconds
  const parseDuration = (dur: string): number => {
    const num = parseInt(dur.replace(/[^0-9]/g, ''));
    if (isNaN(num)) return 300;
    if (dur.includes('s')) return num;
    return num * 60; // default to minutes
  };

  const handleStartSegment = (seg: any) => {
    setActiveSegmentId(seg.id);
    const secs = parseDuration(seg.duration);
    setLiveClassTimeRemaining(secs);
    setLiveClassIsActive(true);
    
    setLiveClassFeed(prev => [
      {
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: 'info',
        message: `教学环节切换并广播：进入 [${seg.title}] 环节，设定时间 ${seg.duration}。`
      },
      ...prev
    ]);

    addToast(
      lang === 'zh' ? '📢 环节已广播' : '📢 Phase Synchronized',
      lang === 'zh' ? `已同步广播 [${seg.title}] 环节至所有在线学生端。` : `Broadcasted phase [${seg.title}] to all active students.`,
      'success'
    );
  };

  // Lock entire class
  const handleToggleClassLock = async (lock: boolean) => {
    if (!liveClassSelectedClassId || !selectedLesson) {
      addToast(
        lang === 'zh' ? '⚠️ 无法操作' : '⚠️ Action Prevented',
        lang === 'zh' ? '请先选择需要授课的课节及班级。' : 'Please select a lesson and class first.',
        'warning'
      );
      return;
    }

    setLockingClass(true);
    try {
      const endpoint = lock 
        ? `/api/classes/${liveClassSelectedClassId}/lock_lesson`
        : `/api/classes/${liveClassSelectedClassId}/unlock_lesson`;
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: lock ? JSON.stringify({ lessonId: selectedLesson }) : undefined
      });

      if (res.ok) {
        await fetchStudents();
        setLiveClassFeed(prev => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: lock ? 'warning' : 'info',
            message: lock 
              ? `已对全班学生强制锁定专注模式（限定当前课程）。` 
              : `已解锁全班学生专注模式限制。`
          },
          ...prev
        ]);
        addToast(
          lang === 'zh' ? '🔒 锁状态更新' : '🔒 Class Status Updated',
          lock ? '全班专注锁定成功，学生将无法切回主页。' : '全班屏幕解锁成功，学生已恢复自由浏览。',
          'success'
        );
      }
    } catch (e) {
      console.error('Failed to toggle class focus lock', e);
    } finally {
      setLockingClass(false);
    }
  };

  // Lock single student
  const handleToggleStudentLock = async (studentId: string, currentLockId: string | null | undefined) => {
    const newLockVal = currentLockId ? null : selectedLesson;
    try {
      const res = await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked_lesson_id: newLockVal })
      });
      if (res.ok) {
        await fetchStudents();
        const stName = students.find(s => s.id === studentId)?.name || studentId;
        setLiveClassFeed(prev => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: newLockVal ? 'warning' : 'info',
            message: newLockVal 
              ? `已针对学生 [${stName}] 单独开启专注限制锁定。` 
              : `已解锁学生 [${stName}] 的专注限制。`
          },
          ...prev
        ]);
      }
    } catch (e) {
      console.error('Failed to toggle student lock', e);
    }
  };

  // Execute interactive tool via command bus
  const handleExecuteTool = async (tool: any) => {
    if (!selectedLesson) {
      addToast(
        lang === 'zh' ? '⚠️ 请选择课节' : '⚠️ Select Lesson',
        lang === 'zh' ? '请先选择要授课的课节。' : 'Please select a lesson first.',
        'warning'
      );
      return;
    }
    
    // Check if $classId replacement is required but no class selected
    const needsClass = JSON.stringify(tool.payload || '').includes('$classId');
    if (needsClass && !liveClassSelectedClassId) {
      addToast(
        lang === 'zh' ? '⚠️ 请选择班级' : '⚠️ Select Class',
        lang === 'zh' ? '该工具需要指定上课班级，请在顶部先选择班级。' : 'Please select class first for this tool.',
        'warning'
      );
      return;
    }

    setLiveClassFeed(prev => [
      {
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: 'info',
        message: `正在运行插件工具 [${tool.name}]...`
      },
      ...prev
    ]);

    try {
      // Substitute placeholders in payload
      const resolvedPayload = JSON.parse(
        JSON.stringify(tool.payload || {})
          .replace(/\$classId/g, liveClassSelectedClassId || '')
          .replace(/\$lessonId/g, selectedLesson || '')
      );

      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: tool.commandType,
          payload: resolvedPayload
        })
      });

      if (res.ok) {
        setLiveClassFeed(prev => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: 'success',
            message: `插件工具 [${tool.name}] 执行完毕，数据成功下发。`
          },
          ...prev
        ]);
        addToast(
          lang === 'zh' ? '✓ 工具下发成功' : '✓ Tool Synchronized',
          lang === 'zh' ? `工具 [${tool.name}] 已成功在当前白板上部署并投射。` : `Tool [${tool.name}] synchronized successfully.`,
          'success'
        );
        await fetchElements(selectedLesson);
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Server error');
      }
    } catch (err: any) {
      setLiveClassFeed(prev => [
        {
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          type: 'error',
          message: `运行插件工具 [${tool.name}] 失败: ${err.message}`
        },
        ...prev
      ]);
      addToast(
        lang === 'zh' ? '❌ 运行失败' : '❌ Tool Failed',
        err.message || 'Execution error',
        'warning'
      );
    }
  };

  const handleRandomPick = () => {
    if (students.length === 0 || isDrawing) return;
    
    // Only select students who are currently online and have entered the classroom (activeStudentLessons[s.id] === selectedLesson)
    const drawPool = students.filter(s => onlineStudentIds.includes(s.id) && activeStudentLessons[s.id] === selectedLesson);

    if (drawPool.length === 0) {
      addToast(
        lang === 'zh' ? '⚠️ 无法抽问' : '⚠️ Cannot Draw',
        lang === 'zh' ? '当前课堂中没有已进入的活跃学生。' : 'No students have entered the classroom yet.',
        'warning'
      );
      return;
    }

    setIsDrawing(true);

    let count = 0;
    const maxTicks = 18;
    let currentInterval = 75;

    const tick = () => {
      const randIndex = Math.floor(Math.random() * drawPool.length);
      const randomStudent = drawPool[randIndex];
      setActiveDrawStudentId(randomStudent.id);

      count++;
      if (count < maxTicks) {
        if (count > maxTicks - 5) {
          currentInterval += 45;
        }
        setTimeout(tick, currentInterval);
      } else {
        const finalStudent = drawPool[randIndex];
        setActiveDrawStudentId(null);
        setIsDrawing(false);

        // Add the drawn student to the list of highlighted IDs
        setSelectedDrawStudentIds(prev => {
          if (prev.includes(finalStudent.id)) return prev;
          return [...prev, finalStudent.id];
        });

        // Append draw result to live class feed
        setLiveClassFeed(prev => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: 'success',
            message: `🎯 随机提问抽选：学生 [${finalStudent.name}] 被抽中回答问题！`
          },
          ...prev
        ]);

        addToast(
          lang === 'zh' ? '🎯 随机提问抽选' : '🎯 Student Drawn',
          lang === 'zh' ? `恭喜学生 [${finalStudent.name}] 被抽中回答问题！` : `Student [${finalStudent.name}] was selected to answer!`,
          'success'
        );

        // Recover highlight after 8 seconds
        setTimeout(() => {
          setSelectedDrawStudentIds(prev => prev.filter(id => id !== finalStudent.id));
        }, 8000);
      }
    };

    setTimeout(tick, currentInterval);
  };

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-grow flex-1 flex flex-col min-h-0 bg-white border border-slate-200 rounded-2xl shadow-xl text-slate-800 overflow-hidden font-sans">
      {/* 1. Header Control Bar */}
      <div className="bg-slate-50 p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 select-none">
          <div className="relative flex items-center justify-center">
            <span className={`w-3 h-3 rounded-full ${liveClassIsActive ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'} absolute`} />
            <span className={`w-2 h-2 rounded-full ${liveClassIsActive ? 'bg-emerald-500' : 'bg-rose-500'} relative`} />
          </div>
          <h2 className="text-sm font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
            {lang === 'zh' ? '🔴 智能授课工作流控制中心' : '🔴 Active Lesson control center'}
          </h2>
        </div>

        {/* Dropdown selectors */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div>
            <select
              value={selectedLesson || ''}
              onChange={e => {
                const val = e.target.value === '' ? null : e.target.value;
                setSelectedLesson(val);
                if (val) fetchElements(val);
              }}
              className="bg-white border border-slate-200 rounded-lg text-xs font-semibold px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 text-slate-700 outline-none cursor-pointer hover:bg-slate-100 transition-colors"
            >
              <option value="">{lang === 'zh' ? '-- 选择授课课节 --' : '-- Select Lesson --'}</option>
              {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </div>

          <div>
            <select
              value={liveClassSelectedClassId || ''}
              onChange={e => setLiveClassSelectedClassId(e.target.value === '' ? null : e.target.value)}
              className="bg-white border border-slate-200 rounded-lg text-xs font-semibold px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 text-slate-700 outline-none cursor-pointer hover:bg-slate-100 transition-colors"
            >
              <option value="">{lang === 'zh' ? '-- 选择授课班级 --' : '-- Select Class --'}</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Lock Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => handleToggleClassLock(!isClassLocked)}
              disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
              className={`px-3 py-1.5 rounded-lg font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer ${
                isClassLocked 
                  ? 'bg-gradient-to-r from-rose-500 to-red-650 hover:from-rose-600 hover:to-red-700 text-white' 
                  : 'bg-gradient-to-r from-indigo-600 to-purple-650 hover:from-indigo-700 hover:to-purple-750 text-white'
              }`}
            >
              {isClassLocked ? <ShieldAlert size={12} /> : <Shield size={12} />}
              <span>{isClassLocked ? (lang === 'zh' ? '一键解锁全班' : 'Unlock Entire Class') : (lang === 'zh' ? '全班专注锁定' : 'Lock Class Screen')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Three-column Panel Grid */}
      <div className="flex-1 flex overflow-hidden min-h-0 bg-slate-50/30">
        
        {/* Left Column: Timeline Control */}
        {!isLeftSidebarCollapsed && (
          <div className="w-[220px] shrink-0 bg-white p-3.5 border-r border-slate-200/80 flex flex-col gap-4 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between mb-2 select-none">
                <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                  {lang === 'zh' ? '教学步骤与时间管理' : 'Lesson Segments & Phases'}
                </h3>
                <button
                  onClick={() => setIsLeftSidebarCollapsed(true)}
                  className="p-1 rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
                  title={lang === 'zh' ? '折叠导航栏' : 'Collapse Sidebar'}
                >
                  <ChevronLeft size={10} />
                </button>
              </div>
            
            {/* Live Timer status */}
            <div className="bg-slate-50 border border-slate-150 rounded-xl p-3 flex flex-col items-center justify-center gap-1 shadow-sm">
              <span className="text-[9.5px] uppercase tracking-widest text-slate-505 font-semibold flex items-center gap-1">
                <Clock size={11} className={liveClassIsActive ? 'animate-spin' : ''} style={{ animationDuration: '4s' }} />
                {lang === 'zh' ? '当前步骤剩余时间' : 'Phase Remaining'}
              </span>
              <div className={`text-2xl font-black font-mono tracking-widest ${liveClassIsActive ? 'text-indigo-650' : 'text-slate-450'}`}>
                {formatTime(liveClassTimeRemaining)}
              </div>
              <div className="flex gap-1.5 w-full mt-2 shrink-0">
                <button
                  onClick={() => setLiveClassIsActive(!liveClassIsActive)}
                  disabled={liveClassTimeRemaining <= 0}
                  className="flex-1 py-1 rounded bg-slate-100 hover:bg-slate-205 text-[10px] font-bold text-slate-700 transition-all disabled:opacity-40 flex items-center justify-center gap-1 border border-slate-200"
                >
                  {liveClassIsActive ? <Pause size={10} /> : <Play size={10} />}
                  <span>{liveClassIsActive ? (lang === 'zh' ? '暂停' : 'Pause') : (lang === 'zh' ? '开始' : 'Start')}</span>
                </button>
                <button
                  onClick={() => {
                    setLiveClassIsActive(false);
                    setLiveClassTimeRemaining(0);
                  }}
                  className="py-1 px-2.5 rounded bg-slate-100 hover:bg-rose-50 text-[10px] font-bold text-rose-600 hover:text-rose-700 transition-all flex items-center justify-center border border-slate-200"
                  title="重置"
                >
                  <Square size={10} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wider select-none">
              {lang === 'zh' ? '教学环节进度表' : 'Timeline Segments'}
            </h4>
            
            {selectedLesson ? (
              <div className="space-y-2 overflow-y-auto flex-1 pr-1.5 scrollbar-thin">
                {timelineSegments.map((seg, idx) => {
                  const isActive = activeSegmentId === seg.id;
                  return (
                    <div
                      key={seg.id}
                      className={`p-2.5 rounded-xl border transition-all flex flex-col gap-1.5 ${
                        isActive 
                          ? 'bg-indigo-50/50 border-indigo-250 shadow-sm' 
                          : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className={`text-[11.5px] font-bold ${isActive ? 'text-indigo-900' : 'text-slate-800'}`}>{idx + 1}. {seg.title}</span>
                        <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-slate-100 text-slate-550 border border-slate-200/50">{seg.duration}</span>
                      </div>
                      <div className={`text-[9.5px] line-clamp-2 leading-relaxed ${isActive ? 'text-indigo-750' : 'text-slate-450'}`}>
                        {seg.notes || "无步骤描述备注信息。"}
                      </div>
                      <button
                        onClick={() => handleStartSegment(seg)}
                        className={`w-full py-1 rounded text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                          isActive 
                            ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm' 
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200/60'
                        }`}
                      >
                        <Presentation size={10} />
                        <span>{isActive ? (lang === 'zh' ? '同步演示中' : 'Broadcasting') : (lang === 'zh' ? '广播此环节' : 'Broadcast Step')}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic py-4 text-center">
                {lang === 'zh' ? '请选择一个课节加载流程表' : 'Select a lesson to view schedule.'}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Middle Column: Live Interactive Whiteboard & Plugins Tool Shelf */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-100 p-3 gap-3 relative">
          {selectedLesson ? (
            <div className="w-full h-full relative flex flex-col min-h-0">
              <div className="flex justify-between items-center px-1.5 py-1 select-none text-slate-500 text-[10px] uppercase font-extrabold tracking-wide shrink-0">
                <div className="flex items-center gap-2">
                  {isLeftSidebarCollapsed && (
                    <button
                      onClick={() => setIsLeftSidebarCollapsed(false)}
                      className="p-1 rounded bg-white hover:bg-slate-100 border border-slate-200 text-indigo-650 hover:text-indigo-700 transition-colors cursor-pointer mr-1.5 flex items-center gap-1 shadow-sm"
                      title={lang === 'zh' ? '展开环节大纲' : 'Expand Sidebar'}
                    >
                      <ChevronRight size={10} />
                      <span className="text-[9px] font-bold tracking-wider">{lang === 'zh' ? '展开大纲' : 'Expand'}</span>
                    </button>
                  )}
                  <span>{lang === 'zh' ? '💻 教师白板演示大屏 (实时同步至学生端)' : '💻 Live presentation screen'}</span>
                </div>
                <span className="text-indigo-650 font-mono tracking-widest animate-pulse flex items-center gap-1">
                  <Activity size={10} /> Live Broadcaster Connected
                </span>
              </div>
              
              {/* Whiteboard canvas wrapper */}
              <div className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-hidden border border-slate-200 shadow-md bg-white flex flex-col">
                <InteractiveWhiteboard
                  lessonId={selectedLesson}
                  userRole="teacher"
                  isEditMode={false}
                  elements={elements}
                  activeSegmentId={activeSegmentId}
                  onSegmentSync={(segId) => setActiveSegmentId(segId)}
                  onElementAdd={async (type, data) => {
                    await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ type, data })
                    });
                    fetchElements(selectedLesson);
                  }}
                  onElementUpdate={async (elementId, data) => {
                    await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ data })
                    });
                    fetchElements(selectedLesson);
                  }}
                  onElementDelete={async (elementId) => {
                    await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                      method: 'DELETE'
                    });
                    fetchElements(selectedLesson);
                  }}
                  onRefresh={() => fetchElements(selectedLesson)}
                />
              </div>

              {/* Classroom Interactive Tool Shelf (Extensible Tools Panel) */}
              <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3 shadow-sm shrink-0 flex flex-col gap-2 relative z-30">
                <div className="flex items-center justify-between text-[10px] uppercase font-black text-slate-550 tracking-wider select-none">
                  <span className="flex items-center gap-1.5 text-indigo-655">
                    <Shuffle size={12} className="text-indigo-600 animate-pulse" />
                    <span>{lang === 'zh' ? '互动工具 (插件扩展)' : 'Classroom Interactive Tools'}</span>
                  </span>
                  <span className="text-[8.5px] text-slate-400 font-mono">Plugins: {classroomTools.length} Active</span>
                </div>
                
                {classroomTools.length > 0 ? (
                  <div className="flex gap-2.5 overflow-x-auto py-0.5 pr-2 scrollbar-thin">
                    {classroomTools.map((tool) => (
                      <button
                        key={tool.id}
                        onClick={() => handleExecuteTool(tool)}
                        disabled={!selectedLesson}
                        className="p-2 bg-slate-50 hover:bg-slate-105 border border-slate-205 hover:border-indigo-200 rounded-xl text-left transition-all active:scale-[0.98] disabled:opacity-40 flex items-center gap-2.5 w-44 shrink-0 group cursor-pointer"
                        title={tool.description}
                      >
                        <div className="p-1.5 bg-indigo-50 text-indigo-650 group-hover:bg-indigo-100 group-hover:text-indigo-700 rounded-lg border border-indigo-100 shrink-0 transition-colors">
                          <DynamicIcon name={tool.icon} size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-700 group-hover:text-slate-900 truncate">{tool.name}</div>
                          <div className="text-[9px] text-slate-400 group-hover:text-slate-555 truncate mt-0.5">{tool.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-2 text-[10px] text-slate-400 italic">
                    {lang === 'zh' ? '暂无可用的互动工具。请在应用商店启用插件。' : 'No plugin tools loaded.'}
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-455 gap-2.5 select-none">
              <Presentation size={38} className="text-slate-300 animate-bounce" style={{ animationDuration: '2.5s' }} />
              <div className="text-sm font-bold text-slate-655">{lang === 'zh' ? '请在顶部栏选择一个授课课节' : 'Please select a lesson to start teaching'}</div>
              <p className="text-[10px] text-slate-400">白板及环节控制面板将在课节载入后自动生成</p>
            </div>
          )}
        </div>

        {/* Right Column: Students Status & Feedback Log */}
        <div className="w-[260px] shrink-0 bg-white p-3.5 border-l border-slate-200/80 flex flex-col gap-3.5 overflow-hidden">
          
          {/* Student attendance grid */}
          <div className="flex-1 flex flex-col min-h-0 gap-2">
            <h3 className="text-[10px] font-black uppercase text-slate-555 tracking-wider select-none flex justify-between items-center shrink-0">
              <span className="flex items-center gap-1">
                <span>{lang === 'zh' ? '学生专注力监控' : 'Student Status Console'}</span>
                {liveClassSelectedClassId && (
                  <button
                    onClick={handleRandomPick}
                    disabled={students.length === 0 || isDrawing}
                    className="ml-2 text-[9px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded hover:bg-indigo-105 transition-colors flex items-center gap-1 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                    title={lang === 'zh' ? '随机抽取一名学生提问' : 'Pick a student randomly'}
                  >
                    <Shuffle size={8.5} className={isDrawing ? 'animate-spin' : ''} />
                    <span>{lang === 'zh' ? '随机抽问' : 'Pick Student'}</span>
                  </button>
                )}
              </span>
              <span className="text-[9px] bg-slate-100 border border-slate-200 text-slate-555 font-mono px-1.5 py-0.5 rounded-md">
                {students.filter(s => s.locked_lesson_id === selectedLesson).length} / {students.length} Locked
              </span>
            </h3>
            
            {liveClassSelectedClassId ? (
              <div className="overflow-y-auto flex-1 pr-1 grid grid-cols-3 gap-2 justify-items-center auto-rows-max scrollbar-thin py-2">
                {students.map((st) => {
                  const isStudentLocked = st.locked_lesson_id === selectedLesson;
                  const isCheckedIn = liveClassAcknowledgedMap.get(st.id);
                  const isOnline = onlineStudentIds.includes(st.id);
                  const activeLessonId = activeStudentLessons[st.id];
                  const isInLesson = activeLessonId === selectedLesson;
                  
                  const studentProg = liveClassStudentProgress.find(p => p.student_id === st.id);
                  const progPercent = studentProg?.progress_percent ?? 0;
                  const teacherActiveIdx = activeSegmentId ? timelineSegments.findIndex(s => s.id === activeSegmentId) : -1;
                  const expectedProgress = timelineSegments.length > 0 ? Math.round(((teacherActiveIdx + 1) / timelineSegments.length) * 100) : 0;
                  const isBehind = teacherActiveIdx >= 0 && progPercent < expectedProgress;

                  const isSelectedDraw = selectedDrawStudentIds.includes(st.id);
                  const isActiveDraw = activeDrawStudentId === st.id;

                  // SVG ring calculation
                  const radius = 22;
                  const strokeWidth = 3;
                  const circumference = 2 * Math.PI * radius; // 138.23
                  const strokeDashoffset = circumference - (progPercent / 100) * circumference;

                  // Circular color system
                  let ringColor = 'stroke-indigo-650'; // normal progress / in class
                  if (isSelectedDraw) {
                    ringColor = 'stroke-amber-500 stroke-[3.5px]'; // jackpot winner!
                  } else if (isActiveDraw) {
                    ringColor = 'stroke-indigo-500 stroke-[3.5px] animate-pulse'; // flickering drawer
                  } else if (!isOnline) {
                    ringColor = 'stroke-slate-200'; // offline
                  } else if (isStudentLocked) {
                    ringColor = 'stroke-rose-500 animate-pulse'; // focus locked
                  } else if (isBehind) {
                    ringColor = 'stroke-amber-500 animate-pulse'; // behind progress
                  } else if (!isInLesson) {
                    ringColor = 'stroke-blue-400'; // not entered lesson but online
                  } else if (progPercent === 100) {
                    ringColor = 'stroke-emerald-500'; // completed
                  }

                  return (
                    <div
                      key={st.id}
                      onMouseEnter={() => setHoveredStudentId(st.id)}
                      onMouseLeave={() => setHoveredStudentId(null)}
                      className={`group relative flex flex-col items-center justify-center p-1 rounded-xl transition-all cursor-default ${
                        isSelectedDraw 
                          ? 'z-20 duration-300' 
                          : isActiveDraw 
                            ? 'z-20' 
                            : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Main Circular Widget */}
                      <div className={`relative w-14 h-14 flex items-center justify-center rounded-full transition-all duration-300 ${
                        isSelectedDraw 
                          ? 'shadow-[0_0_15px_#f59e0b] scale-110 z-10 bg-amber-50 ring-2 ring-amber-400 ring-offset-1' 
                          : isActiveDraw 
                            ? 'shadow-[0_0_10px_#6366f1] scale-105 z-10 bg-indigo-50 ring-1 ring-indigo-400' 
                            : ''
                      }`}>
                        {/* Golden glow aura for selected draw */}
                        {isSelectedDraw && (
                          <div className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping" style={{ animationDuration: '2s' }} />
                        )}

                        {/* Circular Progress Ring */}
                        <svg className="absolute w-full h-full transform -rotate-90" viewBox="0 0 50 50">
                          {/* Inner circle background */}
                          <circle
                            cx="25"
                            cy="25"
                            r={radius}
                            className="stroke-slate-100 fill-white"
                            strokeWidth={strokeWidth}
                          />
                          {/* Outer circle progress indicator */}
                          <circle
                            cx="25"
                            cy="25"
                            r={radius}
                            className={`fill-transparent transition-all duration-300 ${ringColor}`}
                            strokeWidth={strokeWidth}
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                          />
                        </svg>

                        {/* Name (Static) or Controls (Hover) */}
                        <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center overflow-hidden transition-colors ${
                          isSelectedDraw ? 'bg-amber-100/90' : ''
                        }`}>
                          {/* Name view: Visible by default, hidden on hover */}
                          <span className={`text-[10px] font-bold tracking-tight truncate max-w-[34px] group-hover:scale-0 group-hover:opacity-0 transition-all duration-200 select-none ${
                            isSelectedDraw 
                              ? 'text-amber-900 font-extrabold'
                              : !isOnline ? 'text-slate-400' : 'text-slate-700'
                          }`}>
                            {st.name}
                          </span>

                          {/* Hover action overlay */}
                          <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 scale-50 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 bg-white/95 rounded-full shadow-inner">
                            {/* Alert / Warning button */}
                            {selectedLesson && onPingStudent && (
                              <button
                                onClick={() => {
                                  const msg = lang === 'zh' 
                                    ? `⚠️ 学习进度预警：您当前的进度 (${progPercent}%) 落后于老师的讲解进度。请专注课堂，跟上讲解！`
                                    : `⚠️ Progress Alert: Your progress (${progPercent}%) is behind.`;
                                  onPingStudent(st.id, msg);
                                  addToast(lang === 'zh' ? '🔔 已发送提醒' : '🔔 Alert Sent', `已向学生 ${st.name} 发送进度提醒。`, 'success');
                                }}
                                className={`p-0.5 rounded-md hover:bg-slate-105 transition-colors shrink-0 cursor-pointer ${
                                  isBehind ? 'text-amber-500 hover:text-amber-600 animate-pulse' : 'text-slate-400 hover:text-slate-650'
                                }`}
                                title="提醒"
                              >
                                <Send size={10} />
                              </button>
                            )}

                            {/* Focus Lock controller */}
                            <button
                              onClick={() => handleToggleStudentLock(st.id, st.locked_lesson_id)}
                              disabled={!selectedLesson}
                              className={`p-0.5 rounded-md hover:bg-slate-105 transition-colors shrink-0 cursor-pointer ${
                                isStudentLocked ? 'text-rose-500 hover:text-rose-600' : 'text-slate-400 hover:text-slate-655'
                              }`}
                              title={isStudentLocked ? '解锁' : '锁定'}
                            >
                              {isStudentLocked ? <ShieldAlert size={10} /> : <Shield size={10} />}
                            </button>
                          </div>
                        </div>

                        {/* Top-Right Online/Lesson Badge Indicator or Jackpot winner target badge */}
                        {isSelectedDraw ? (
                          <span className="absolute -top-1.5 -right-1.5 z-20 text-[9px] bg-amber-500 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold shadow-md animate-bounce">
                            🎯
                          </span>
                        ) : (
                          isOnline && (
                            <span className={`absolute top-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white shrink-0 ${
                              isInLesson ? 'bg-emerald-500' : 'bg-blue-400'
                            }`} title={isInLesson ? '正在上课' : '在线(但未进课堂)'} />
                          )
                        )}

                        {/* Bottom-Right Acknowledged/Ready Indicator */}
                        {isCheckedIn === true && !isSelectedDraw && (
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white bg-amber-500 shrink-0 animate-bounce" title="已确认/就位" />
                        )}
                      </div>

                      {/* Small Progress Label or Draw Winner Label */}
                      <span className={`text-[8.5px] mt-1 truncate max-w-[48px] select-none font-medium ${
                        isSelectedDraw 
                          ? 'text-amber-600 font-extrabold animate-bounce' 
                          : !isOnline ? 'text-slate-350' : 'text-slate-505'
                      }`}>
                        {isSelectedDraw ? '🎯 抽中' : `${progPercent}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic py-4 text-center flex-1 flex items-center justify-center">
                {lang === 'zh' ? '请选择班级以显示学生' : 'Select class to show student monitors.'}
              </div>
            )}
          </div>

          {/* Hover Details / Class Summary Panel */}
          <div className="bg-slate-50 border border-slate-150 rounded-xl p-3 flex flex-col gap-1.5 h-[135px] shrink-0 shadow-sm select-none justify-center">
            {hoveredStudentId ? (() => {
              const st = students.find(s => s.id === hoveredStudentId);
              if (!st) return null;
              const studentProg = liveClassStudentProgress.find(p => p.student_id === st.id);
              const progPercent = studentProg?.progress_percent ?? 0;
              const completedSegIds = (() => {
                if (!studentProg || !studentProg.completed_segments) return [];
                try {
                  return typeof studentProg.completed_segments === 'string'
                    ? JSON.parse(studentProg.completed_segments)
                    : studentProg.completed_segments;
                } catch (e) {
                  return [];
                }
              })();
              
              return (
                <div className="flex flex-col gap-1.5 text-xs text-slate-705">
                  <div className="font-extrabold text-slate-800 border-b border-slate-200 pb-1 flex justify-between items-center shrink-0">
                    <span className="flex items-center gap-1.5 truncate">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${onlineStudentIds.includes(st.id) ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                      <span className="truncate max-w-[130px]">{st.name} ({st.student_number || 'N/A'})</span>
                    </span>
                    <span className="text-[10px] text-indigo-655 font-mono font-black shrink-0">{progPercent}%</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-1.5 text-[9.5px] leading-tight shrink-0">
                    <div className="flex flex-col gap-0.5 bg-white p-1 rounded-lg border border-slate-150">
                      <span className="text-slate-400 font-bold">随堂测验</span>
                      <span className={`font-bold font-mono text-[10px] ${studentProg?.quiz_score !== null ? 'text-indigo-600' : 'text-slate-400'}`}>
                        {studentProg?.quiz_score !== null ? `${studentProg.quiz_score} / 100` : '未提交'}
                      </span>
                    </div>
                    
                    <div className="flex flex-col gap-0.5 bg-white p-1 rounded-lg border border-slate-150">
                      <span className="text-slate-400 font-bold">教学环节进度</span>
                      <span className="font-bold text-slate-655 text-[10px]">
                        {Array.isArray(completedSegIds) ? completedSegIds.length : 0} / {timelineSegments.length}
                      </span>
                    </div>
                  </div>

                  <div className="text-[9px] text-slate-500 leading-relaxed truncate mt-0.5 shrink-0">
                    环节: {timelineSegments.length > 0 ? timelineSegments.map((seg, sIdx) => {
                      const isSegCompleted = Array.isArray(completedSegIds) && completedSegIds.includes(seg.id);
                      return (
                        <span key={seg.id} className={`mr-1 px-1 py-0.2 rounded ${isSegCompleted ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-105 text-slate-400 border border-slate-150'}`} title={seg.title}>
                          {sIdx + 1}:{isSegCompleted ? '✓' : '✗'}
                        </span>
                      );
                    }) : <span className="italic text-slate-400">暂无步骤</span>}
                  </div>
                </div>
              );
            })() : (
              // Class summary state when no hover
              <div className="flex flex-col gap-1 text-xs text-slate-700 h-full justify-center">
                <div className="font-extrabold text-slate-800 border-b border-slate-200 pb-1.5 flex items-center gap-1.5 shrink-0">
                  <Activity size={12} className="text-indigo-655 animate-pulse" />
                  <span>{lang === 'zh' ? '班级学情概况' : 'Class Overview'}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[9.5px] leading-tight mt-1.5 shrink-0">
                  <div className="flex flex-col items-center bg-white py-1 rounded-lg border border-slate-150">
                    <span className="text-slate-400 font-medium">在线/总数</span>
                    <span className="font-bold font-mono text-emerald-600 text-[11px] mt-0.5">
                      {students.filter(s => onlineStudentIds.includes(s.id)).length}/{students.length}
                    </span>
                  </div>
                  <div className="flex flex-col items-center bg-white py-1 rounded-lg border border-slate-150">
                    <span className="text-slate-400 font-medium">屏幕锁定</span>
                    <span className="font-bold font-mono text-rose-500 text-[11px] mt-0.5">
                      {students.filter(s => s.locked_lesson_id === selectedLesson).length}
                    </span>
                  </div>
                  <div className="flex flex-col items-center bg-white py-1 rounded-lg border border-slate-150">
                    <span className="text-slate-400 font-medium">平均进度</span>
                    <span className="font-bold font-mono text-indigo-650 text-[11px] mt-0.5">
                      {(() => {
                        const inClassStudents = students.filter(s => onlineStudentIds.includes(s.id));
                        if (inClassStudents.length === 0) return '0%';
                        const total = inClassStudents.reduce((sum, s) => {
                          const p = liveClassStudentProgress.find(prog => prog.student_id === s.id);
                          return sum + (p?.progress_percent ?? 0);
                        }, 0);
                        return `${Math.round(total / inClassStudents.length)}%`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Feedback log feed */}
          <div className="h-[160px] flex flex-col border-t border-slate-150 pt-3 min-h-0 gap-2 shrink-0">
            <h3 className="text-[10px] font-black uppercase text-slate-550 tracking-wider select-none flex justify-between items-center">
              <span>{lang === 'zh' ? '课堂互动反馈流' : 'Live Classroom Feed'}</span>
              <button 
                onClick={() => setLiveClassFeed([{ id: 'clear', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), type: 'info', message: '反馈流已清空。' }])}
                className="text-[9px] hover:text-slate-700 text-slate-400 underline transition-all"
              >
                Clear
              </button>
            </h3>
            
            <div className="flex-1 bg-white border border-slate-200 rounded-xl p-2.5 font-mono text-[9px] leading-relaxed overflow-y-auto space-y-2 select-text text-left text-slate-600 shadow-inner scrollbar-thin">
              {liveClassFeed.map((f) => (
                <div key={f.id} className="border-b border-slate-100 pb-1.5 last:border-b-0">
                  <div className="flex justify-between items-center text-slate-400 font-bold mb-0.5">
                    <span>{f.time}</span>
                    <span className={`px-1 rounded uppercase tracking-wide text-[7px] ${
                      f.type === 'success' 
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                        : f.type === 'warning' 
                          ? 'bg-amber-50 text-amber-600 border border-amber-100' 
                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>
                      {f.type}
                    </span>
                  </div>
                  <p className={
                    f.type === 'success' 
                      ? 'text-emerald-700 font-medium' 
                      : f.type === 'warning' 
                        ? 'text-amber-700 font-medium' 
                        : 'text-slate-655'
                  }>
                    {f.message}
                  </p>
                </div>
              ))}
            </div>
          </div>
          
        </div>

      </div>
    </div>
  );
}
