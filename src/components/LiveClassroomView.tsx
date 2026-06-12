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
  liveClassStudentProgress
}: LiveClassroomViewProps) {
  const [lockingClass, setLockingClass] = useState(false);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

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

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Find if class-wide locking is active (if all students are locked to this lesson)
  const isClassLocked = liveClassSelectedClassId && students
    .filter(s => s.locked_lesson_id === selectedLesson).length > 0;

  return (
    <div className="flex-grow flex-1 flex flex-col min-h-0 bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl text-slate-100 overflow-hidden font-sans">
      {/* 1. Header Control Bar */}
      <div className="bg-slate-950 p-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <span className={`w-3.5 h-3.5 rounded-full ${liveClassIsActive ? 'bg-emerald-500 animate-ping' : 'bg-red-500'} absolute`} />
            <span className={`w-2 h-2 rounded-full ${liveClassIsActive ? 'bg-emerald-400' : 'bg-red-400'} relative`} />
          </div>
          <h2 className="text-base font-black tracking-tight text-white flex items-center gap-2">
            {lang === 'zh' ? '🔴 智能授课工作流控制中心' : '🔴 Active Lesson control center'}
          </h2>
        </div>

        {/* Dropdown selectors */}
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <select
              value={selectedLesson || ''}
              onChange={e => {
                const val = e.target.value === '' ? null : e.target.value;
                setSelectedLesson(val);
                if (val) fetchElements(val);
              }}
              className="bg-slate-900 border border-slate-800 rounded-lg text-xs font-semibold px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 text-slate-200 outline-none cursor-pointer"
            >
              <option value="">{lang === 'zh' ? '-- 选择授课课节 --' : '-- Select Lesson --'}</option>
              {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </div>

          <div>
            <select
              value={liveClassSelectedClassId || ''}
              onChange={e => setLiveClassSelectedClassId(e.target.value === '' ? null : e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg text-xs font-semibold px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 text-slate-200 outline-none cursor-pointer"
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
              className={`px-3 py-1.5 rounded-lg font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer ${
                isClassLocked 
                  ? 'bg-gradient-to-r from-rose-500 to-red-650 hover:from-rose-600 hover:to-red-700 text-white' 
                  : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white'
              }`}
            >
              {isClassLocked ? <ShieldAlert size={12} /> : <Shield size={12} />}
              <span>{isClassLocked ? (lang === 'zh' ? '一键解锁全班' : 'Unlock Entire Class') : (lang === 'zh' ? '全班专注锁定' : 'Lock Class Screen')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Three-column Panel Grid */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        
        {/* Left Column: Timeline Control */}
        {!isLeftSidebarCollapsed && (
          <div className="w-1/4 max-w-[280px] bg-slate-950 p-4 border-r border-slate-800/80 flex flex-col gap-4 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between mb-2 select-none">
                <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                  {lang === 'zh' ? '教学步骤与时间管理' : 'Lesson Segments & Phases'}
                </h3>
                <button
                  onClick={() => setIsLeftSidebarCollapsed(true)}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  title={lang === 'zh' ? '折叠导航栏' : 'Collapse Sidebar'}
                >
                  <ChevronLeft size={10} />
                </button>
              </div>
            
            {/* Live Timer status */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col items-center justify-center gap-1.5 shadow-inner">
              <span className="text-[9.5px] uppercase tracking-widest text-slate-400 font-semibold flex items-center gap-1">
                <Clock size={11} className={liveClassIsActive ? 'animate-spin' : ''} style={{ animationDuration: '4s' }} />
                {lang === 'zh' ? '当前步骤剩余时间' : 'Phase Remaining'}
              </span>
              <div className={`text-3xl font-black font-mono tracking-widest ${liveClassIsActive ? 'text-indigo-400' : 'text-slate-500'}`}>
                {formatTime(liveClassTimeRemaining)}
              </div>
              <div className="flex gap-2 w-full mt-2 shrink-0">
                <button
                  onClick={() => setLiveClassIsActive(!liveClassIsActive)}
                  disabled={liveClassTimeRemaining <= 0}
                  className="flex-1 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  {liveClassIsActive ? <Pause size={10} /> : <Play size={10} />}
                  <span>{liveClassIsActive ? (lang === 'zh' ? '暂停' : 'Pause') : (lang === 'zh' ? '开始' : 'Start')}</span>
                </button>
                <button
                  onClick={() => {
                    setLiveClassIsActive(false);
                    setLiveClassTimeRemaining(0);
                  }}
                  className="py-1 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-all flex items-center justify-center"
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
              <div className="space-y-2.5 overflow-y-auto flex-1 pr-1.5">
                {timelineSegments.map((seg, idx) => {
                  const isActive = activeSegmentId === seg.id;
                  return (
                    <div
                      key={seg.id}
                      className={`p-3 rounded-xl border transition-all flex flex-col gap-1.5 ${
                        isActive 
                          ? 'bg-slate-900 border-indigo-500/75 shadow-lg shadow-indigo-950/20' 
                          : 'bg-slate-900/30 border-slate-850 hover:bg-slate-900/60 hover:border-slate-800'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-slate-100">{idx + 1}. {seg.title}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-850 text-slate-400">{seg.duration}</span>
                      </div>
                      <div className="text-[9.5px] text-slate-500 line-clamp-2 leading-relaxed">
                        {seg.notes || "无步骤描述备注信息。"}
                      </div>
                      <button
                        onClick={() => handleStartSegment(seg)}
                        className={`w-full py-1 rounded text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          isActive 
                            ? 'bg-indigo-650 text-white hover:bg-indigo-700' 
                            : 'bg-slate-850 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                      >
                        <Presentation size={11} />
                        <span>{isActive ? (lang === 'zh' ? '正在同步演示' : 'Broadcasting Live') : (lang === 'zh' ? '广播此环节' : 'Broadcast Step')}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-600 italic py-4 text-center">
                {lang === 'zh' ? '请选择一个课节加载流程表' : 'Select a lesson to view schedule.'}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Middle Column: Live Interactive Whiteboard & Plugins Tool Shelf */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-900 relative">
          {selectedLesson ? (
            <div className="w-full h-full relative p-2.5 flex flex-col min-h-0">
              <div className="flex justify-between items-center px-2 py-1 select-none text-slate-400 text-[10px] uppercase font-bold shrink-0">
                <div className="flex items-center gap-2">
                  {isLeftSidebarCollapsed && (
                    <button
                      onClick={() => setIsLeftSidebarCollapsed(false)}
                      className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer mr-1.5 flex items-center gap-1"
                      title={lang === 'zh' ? '展开环节大纲' : 'Expand Sidebar'}
                    >
                      <ChevronRight size={10} />
                      <span className="text-[9px] font-bold tracking-wider">{lang === 'zh' ? '展开导航' : 'Expand'}</span>
                    </button>
                  )}
                  <span>{lang === 'zh' ? '💻 教师白板演示大屏 (学生画面将实时追随同步)' : '💻 Live presentation screen'}</span>
                </div>
                <span className="text-indigo-400 font-mono tracking-widest animate-pulse flex items-center gap-1">
                  <Activity size={10} /> Live Broadcaster Connected
                </span>
              </div>
              
              {/* Whiteboard canvas wrapper */}
              <div className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-hidden border border-slate-800 shadow-xl bg-slate-950 flex flex-col">
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
              <div className="mt-3 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-xl p-3 shadow-lg shrink-0 flex flex-col gap-2 relative z-30">
                <div className="flex items-center justify-between text-[10px] uppercase font-black text-slate-400 tracking-wider select-none">
                  <span className="flex items-center gap-1.5 text-indigo-300">
                    <Shuffle size={12} className="text-indigo-400 animate-pulse" />
                    <span>{lang === 'zh' ? '课节互动工具面板 (插件扩充)' : 'Classroom Interactive Tools Panel'}</span>
                  </span>
                  <span className="text-[8.5px] text-slate-500 font-mono">Dynamic Slots: {classroomTools.length} Loaded</span>
                </div>
                
                {classroomTools.length > 0 ? (
                  <div className="flex gap-3 overflow-x-auto py-1 pr-2 scrollbar-thin">
                    {classroomTools.map((tool) => (
                      <button
                        key={tool.id}
                        onClick={() => handleExecuteTool(tool)}
                        disabled={!selectedLesson}
                        className="p-2.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-indigo-850/60 rounded-xl text-left transition-all active:scale-[0.98] disabled:opacity-40 flex items-center gap-3 w-48 shrink-0 group cursor-pointer"
                        title={tool.description}
                      >
                        <div className="p-2 bg-slate-950 text-indigo-400 group-hover:text-amber-400 rounded-lg border border-slate-800 group-hover:border-indigo-900 shrink-0 transition-colors">
                          <DynamicIcon name={tool.icon} size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-200 group-hover:text-white truncate">{tool.name}</div>
                          <div className="text-[9px] text-slate-500 group-hover:text-slate-400 truncate mt-0.5">{tool.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-2 text-[10px] text-slate-550 italic">
                    {lang === 'zh' ? '暂无可用的插件授课工具。请先在应用商店安装并开启插件。' : 'No plugin tools loaded. Please install plugins in App Store.'}
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-2 select-none">
              <Presentation size={38} className="text-slate-600 animate-bounce" style={{ animationDuration: '2.5s' }} />
              <div className="text-sm font-bold">{lang === 'zh' ? '请在顶部栏选择一个授课课节' : 'Please select a lesson to start teaching'}</div>
              <p className="text-[10px] text-slate-650">白板及环节控制面板将在课节载入后自动生成</p>
            </div>
          )}
        </div>

        {/* Right Column: Students Status & Feedback Log */}
        <div className="w-1/4 max-w-[300px] bg-slate-950 p-4 border-l border-slate-800/80 flex flex-col gap-4 overflow-hidden shrink-0">
          
          {/* Student attendance grid */}
          <div className="h-1/2 flex flex-col min-h-0 gap-2">
            <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-wider select-none flex justify-between items-center">
              <span>{lang === 'zh' ? '学生专注力监控网格' : 'Student Status Console'}</span>
              <span className="text-[9px] bg-slate-900 border border-slate-800 text-slate-400 font-mono px-1 rounded">
                {students.filter(s => s.locked_lesson_id === selectedLesson).length} / {students.length} Locked
              </span>
            </h3>
            
            {liveClassSelectedClassId ? (
              <div className="overflow-y-auto flex-1 pr-1.5 space-y-1.5">
                {students.map((st) => {
                  const isStudentLocked = st.locked_lesson_id === selectedLesson;
                  const isCheckedIn = liveClassAcknowledgedMap.get(st.id);
                  const isOnline = onlineStudentIds.includes(st.id);
                  const activeLessonId = activeStudentLessons[st.id];
                  const isInLesson = activeLessonId === selectedLesson;
                  
                  const progPercent = liveClassStudentProgress.find(p => p.student_id === st.id)?.progress_percent ?? 0;

                  return (
                    <div
                      key={st.id}
                      className="p-2.5 bg-slate-900 border border-slate-850 hover:border-slate-800 rounded-xl flex flex-col gap-2 text-xs text-left"
                    >
                      {/* Top Row: Name, Online status, and Lock Action */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 justify-start">
                          {/* Online Status Dot */}
                          <div 
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-700'
                            }`}
                            title={isOnline ? (lang === 'zh' ? '在线' : 'Online') : (lang === 'zh' ? '离线' : 'Offline')}
                          />
                          <span className="font-semibold text-slate-200 truncate">{st.name}</span>
                          <span className="text-[8px] font-mono text-slate-500 truncate">{st.student_number || 'N/A'}</span>
                        </div>
                        
                        <div className="flex items-center gap-1 justify-end">
                          {/* Check-in status indicator */}
                          {isCheckedIn !== undefined && (
                            <div 
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isCheckedIn === true 
                                  ? 'bg-amber-400 animate-bounce' 
                                  : 'bg-slate-600'
                              }`}
                              title={isCheckedIn === true ? (lang === 'zh' ? '已就位听讲' : 'Acknowledged') : (lang === 'zh' ? '等待响应' : 'Waiting')}
                            />
                          )}

                          {/* Individual Lock controller */}
                          <button
                            onClick={() => handleToggleStudentLock(st.id, st.locked_lesson_id)}
                            disabled={!selectedLesson}
                            className={`p-1 rounded transition-colors shrink-0 cursor-pointer ${
                              isStudentLocked 
                                ? 'bg-red-950/60 text-red-400 hover:bg-red-900/50' 
                                : 'bg-slate-800 text-slate-500 hover:bg-slate-750 hover:text-slate-300'
                            }`}
                            title={isStudentLocked ? (lang === 'zh' ? '解除限制模式' : 'Unlock Screen') : (lang === 'zh' ? '锁定为当前课件模式' : 'Lock Screen')}
                          >
                            {isStudentLocked ? <ShieldAlert size={11} /> : <Shield size={11} />}
                          </button>
                        </div>
                      </div>

                      {/* Bottom Row: Classroom Entrance Status & Progress Bar */}
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-850/60">
                        {/* Entry Status */}
                        <div className="flex justify-start">
                          {isOnline ? (
                            isInLesson ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-950/50 text-emerald-400 border border-emerald-800/40 font-bold shrink-0">
                                {lang === 'zh' ? '已进课堂' : 'In Lesson'}
                              </span>
                            ) : (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-950/50 text-indigo-400 border border-indigo-800/40 font-medium shrink-0">
                                {lang === 'zh' ? '应用首页' : 'Dashboard'}
                              </span>
                            )
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-950 text-slate-500 border border-slate-900 shrink-0">
                              {lang === 'zh' ? '未进课堂' : 'Offline'}
                            </span>
                          )}
                        </div>

                        {/* Lesson Progress */}
                        <div className="flex flex-col gap-0.5 shrink-0 min-w-[80px]">
                          <div className="flex justify-between items-center text-[8px] font-bold font-mono text-slate-400">
                            <span>{lang === 'zh' ? '学习进度' : 'Prog'}</span>
                            <span className="font-bold text-slate-200">{progPercent}%</span>
                          </div>
                          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all duration-300 ${progPercent === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} 
                              style={{ width: `${progPercent}%` }} 
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-600 italic py-4 text-center">
                {lang === 'zh' ? '请选择要参与授课的班级' : 'Select class to show student monitors.'}
              </div>
            )}
          </div>

          {/* Feedback log feed */}
          <div className="h-1/2 flex flex-col border-t border-slate-900 pt-3 min-h-0 gap-2">
            <h3 className="text-[10px] font-black uppercase text-slate-400 tracking-wider select-none flex justify-between items-center">
              <span>{lang === 'zh' ? '课堂互动反馈流' : 'Live Classroom Feed'}</span>
              <button 
                onClick={() => setLiveClassFeed([{ id: 'clear', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), type: 'info', message: '反馈流已清空。' }])}
                className="text-[9px] hover:text-white text-slate-500 underline transition-all"
              >
                Clear
              </button>
            </h3>
            
            <div className="flex-1 bg-slate-950 border border-slate-900 rounded-xl p-2.5 font-mono text-[9px] leading-relaxed overflow-y-auto space-y-2 select-text text-left">
              {liveClassFeed.map((f) => (
                <div key={f.id} className="border-b border-slate-900 pb-1.5 last:border-b-0">
                  <div className="flex justify-between items-center text-slate-550 font-bold mb-0.5">
                    <span>{f.time}</span>
                    <span className={`px-1 rounded uppercase tracking-wide text-[7px] ${
                      f.type === 'success' 
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' 
                        : f.type === 'warning' 
                          ? 'bg-amber-955/40 text-amber-400 border border-amber-900/60' 
                          : 'bg-slate-900 text-slate-450 border border-slate-850'
                    }`}>
                      {f.type}
                    </span>
                  </div>
                  <p className={
                    f.type === 'success' 
                      ? 'text-emerald-300' 
                      : f.type === 'warning' 
                        ? 'text-amber-300' 
                        : 'text-slate-400'
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
