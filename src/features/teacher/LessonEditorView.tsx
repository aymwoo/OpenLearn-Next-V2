import type { MutableRefObject } from 'react';
import type { Lesson, WhiteboardElement } from '../../store/appStore';
import { Wand2, Loader2, CheckCircle2, X, Database, Eye, PenTool } from 'lucide-react';
import { LazyWhiteboard } from '../../components/LazyWhiteboard';
import { LessonPalette } from './lesson-editor/LessonPalette';
import { TimelineRail } from './lesson-editor/TimelineRail';
import { SegmentEditorCard } from './lesson-editor/SegmentEditorCard';
import { PaletteCardEditModal } from './lesson-editor/PaletteCardEditModal';
import { PALETTE_ITEM_MAP } from './lesson-editor/paletteConfig';

export interface LessonEditorViewProps {
  lang: 'zh' | 'en';
  lessons: Lesson[];
  selectedLesson: string | null;
  activeRole: 'teacher' | 'student';
  setActiveRole: (role: 'teacher' | 'student') => void;
  editorSaveStatus: 'none' | 'saving' | 'saved' | 'error';
  setEditorSaveStatus: (status: 'none' | 'saving' | 'saved' | 'error') => void;
  editorLastSavedTime: Date | null;
  setEditorLastSavedTime: (time: Date | null) => void;
  setIsLessonPreviewVisible: (value: boolean) => void;
  setPreviewLessonTab: (value: 'whiteboard' | 'courseware') => void;
  setPreviewSelectedCourseware: (value: string | null) => void;
  setTeacherTab: (value: string) => void;
  handlePaletteActivate: (type: string) => void;
  timelineSegments: any[];
  activeSegmentId: string | null;
  setActiveSegmentId: (value: string | null) => void;
  draggedSegmentIdx: number | null;
  setDraggedSegmentIdx: (value: number | null) => void;
  saveTimeline: (lessonId: string, newSegments: any[]) => Promise<void>;
  editorPanelsExpanded: boolean;
  setEditorPanelsExpanded: (value: boolean) => void;
  fetchElements: (lessonId: string) => Promise<void>;
  whiteboardRef: MutableRefObject<any>;
  elements: WhiteboardElement[];
  paletteEdit: { type: string; data: Record<string, any> } | null;
  handlePaletteConfirm: (data: Record<string, any>) => Promise<void>;
  setPaletteEdit: (value: { type: string; data: Record<string, any> } | null) => void;
}

export function LessonEditorView({
  lang,
  lessons,
  selectedLesson,
  activeRole,
  setActiveRole,
  editorSaveStatus,
  setEditorSaveStatus,
  editorLastSavedTime,
  setEditorLastSavedTime,
  setIsLessonPreviewVisible,
  setPreviewLessonTab,
  setPreviewSelectedCourseware,
  setTeacherTab,
  handlePaletteActivate,
  timelineSegments,
  activeSegmentId,
  setActiveSegmentId,
  draggedSegmentIdx,
  setDraggedSegmentIdx,
  saveTimeline,
  editorPanelsExpanded,
  setEditorPanelsExpanded,
  fetchElements,
  whiteboardRef,
  elements,
  paletteEdit,
  handlePaletteConfirm,
  setPaletteEdit,
}: LessonEditorViewProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="px-3.5 py-2 border-b border-slate-200/80 flex items-center justify-between shrink-0 bg-slate-50/80 backdrop-blur-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <h3 className="font-bold text-slate-800 text-xs sm:text-sm flex items-center gap-2 truncate">
            <Wand2 size={16} className="text-indigo-600 shrink-0" />
            <span className="truncate">{lang === 'zh' ? '课程编辑器: ' : 'Lesson Editor: '}{lessons.find(l => l.id === selectedLesson)?.title || (lang === 'zh' ? '未选择课程' : 'No Lesson Selected')}</span>
          </h3>
          <div className="bg-slate-200/80 p-0.5 rounded-lg flex items-center gap-0.5 border border-slate-300/60 shadow-3xs">
            <button
              onClick={() => setActiveRole('teacher')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all cursor-pointer ${
                activeRole === 'teacher'
                  ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              👨‍🏫 {lang === 'zh' ? '教师模式' : 'Teacher Mode'}
            </button>
            <button
              onClick={() => setActiveRole('student')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded transition-all cursor-pointer ${
                activeRole === 'student'
                  ? 'bg-pink-600 text-white shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🎓 {lang === 'zh' ? '学生模式' : 'Student Mode'}
            </button>
          </div>
          {selectedLesson && (
            <div className="hidden sm:flex items-center gap-1.5 shrink-0 ml-1">
              {editorSaveStatus === 'saving' && (
                <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse">
                  <Loader2 size={10} className="animate-spin text-amber-600" />
                  <span>{lang === 'zh' ? '同步 SQLite...' : 'Saving...'}</span>
                </div>
              )}
              {editorSaveStatus === 'saved' && (
                <div className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-250 px-2 py-0.5 rounded-full">
                  <CheckCircle2 size={10} className="text-emerald-600" />
                  <span>{lang === 'zh' ? '已同步 SQLite' : 'Saved to SQLite'}</span>
                  {editorLastSavedTime && (
                    <span className="text-emerald-600/70 text-[9px] font-mono">
                      {editorLastSavedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  )}
                </div>
              )}
              {editorSaveStatus === 'error' && (
                <div className="flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-250 px-2 py-0.5 rounded-full">
                  <X size={10} className="text-rose-600" />
                  <span>{lang === 'zh' ? '写入失败' : 'Failed to save'}</span>
                </div>
              )}
              {editorSaveStatus === 'none' && (
                <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                  <Database size={10} className="text-slate-400" />
                  <span>{lang === 'zh' ? 'SQLite 就绪' : 'SQLite Ready'}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {selectedLesson && (
            <button
              onClick={() => {
                setIsLessonPreviewVisible(true);
                setPreviewLessonTab('whiteboard');
                setPreviewSelectedCourseware(null);
              }}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            >
              <Eye size={13} />
              <span>{lang === 'zh' ? '学生视角预览' : 'Student View'}</span>
            </button>
          )}
          <button onClick={() => setTeacherTab('courses')} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-colors cursor-pointer">{lang === 'zh' ? '返回课程库' : 'Back to Courses'}</button>
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <LessonPalette lang={lang} onActivate={handlePaletteActivate} />
        <div className="flex-1 relative bg-white flex flex-col min-w-0 overflow-y-auto">
          <TimelineRail
            lang={lang}
            segments={timelineSegments}
            activeSegmentId={activeSegmentId}
            setActiveSegmentId={setActiveSegmentId}
            draggedSegmentIdx={draggedSegmentIdx}
            setDraggedSegmentIdx={setDraggedSegmentIdx}
            selectedLesson={selectedLesson}
            saveTimeline={saveTimeline}
            editorPanelsExpanded={editorPanelsExpanded}
            setEditorPanelsExpanded={setEditorPanelsExpanded}
          />
          {selectedLesson && activeSegmentId && editorPanelsExpanded && timelineSegments.some((s) => s.id === activeSegmentId) && (
            <SegmentEditorCard
              lang={lang}
              segment={timelineSegments.find((s) => s.id === activeSegmentId)}
              onPatch={(patch) =>
                saveTimeline(
                  selectedLesson,
                  timelineSegments.map((s) => (s.id === activeSegmentId ? { ...s, ...patch } : s)),
                )
              }
              onDelete={() => {
                if (timelineSegments.length <= 1) {
                  alert('无法删除！课程必须包含至少一个环节。');
                  return;
                }
                if (window.confirm(`确定要删除环节"${timelineSegments.find((s) => s.id === activeSegmentId)?.title}"吗？`)) {
                  const updated = timelineSegments.filter((s) => s.id !== activeSegmentId);
                  saveTimeline(selectedLesson, updated);
                  setActiveSegmentId(updated[0]?.id || null);
                }
              }}
            />
          )}
          <div className="flex-1 min-h-[500px] relative flex flex-col min-w-0">
            {!selectedLesson ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 p-8 text-center bg-gray-50">
                <div>
                  <PenTool size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="font-medium text-lg text-gray-500 mb-2">No active lesson selected</p>
                  <p className="text-sm">Please select a lesson from the Dashboard to orchestrate.</p>
                </div>
              </div>
            ) : (
              <>
                <LazyWhiteboard
                  ref={whiteboardRef}
                  lessonId={selectedLesson}
                  userRole={activeRole}
                  elements={elements}
                  activeSegmentId={activeSegmentId}
                  onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
                  onElementAdd={async (type: string, data: any) => {
                    setEditorSaveStatus('saving');
                    try {
                      const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type, data })
                      });
                      if (response.ok) {
                        setEditorSaveStatus('saved');
                        setEditorLastSavedTime(new Date());
                        fetchElements(selectedLesson);
                      } else {
                        setEditorSaveStatus('error');
                      }
                    } catch (err) {
                      setEditorSaveStatus('error');
                    }
                  }}
                  onElementUpdate={async (elementId: string, data: any) => {
                    setEditorSaveStatus('saving');
                    try {
                      const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data })
                      });
                      if (response.ok) {
                        setEditorSaveStatus('saved');
                        setEditorLastSavedTime(new Date());
                        fetchElements(selectedLesson);
                      } else {
                        setEditorSaveStatus('error');
                      }
                    } catch (err) {
                      setEditorSaveStatus('error');
                    }
                  }}
                  onElementDelete={async (elementId: string) => {
                    setEditorSaveStatus('saving');
                    try {
                      const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                        method: 'DELETE'
                      });
                      if (response.ok) {
                        setEditorSaveStatus('saved');
                        setEditorLastSavedTime(new Date());
                        fetchElements(selectedLesson);
                      } else {
                        setEditorSaveStatus('error');
                      }
                    } catch (err) {
                      setEditorSaveStatus('error');
                    }
                  }}
                  onClearBoard={async () => {
                    setEditorSaveStatus('saving');
                    try {
                      const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                        method: 'DELETE'
                      });
                      if (response.ok) {
                        setEditorSaveStatus('saved');
                        setEditorLastSavedTime(new Date());
                        fetchElements(selectedLesson);
                      } else {
                        setEditorSaveStatus('error');
                      }
                    } catch (err) {
                      setEditorSaveStatus('error');
                    }
                  }}
                  onRefresh={() => fetchElements(selectedLesson)}
                />
                {paletteEdit && PALETTE_ITEM_MAP[paletteEdit.type] && (
                  <PaletteCardEditModal
                    config={PALETTE_ITEM_MAP[paletteEdit.type]}
                    lang={lang}
                    initialData={paletteEdit.data}
                    onConfirm={handlePaletteConfirm}
                    onCancel={() => setPaletteEdit(null)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
