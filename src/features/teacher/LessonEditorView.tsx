import type { MutableRefObject } from 'react';
import type { Lesson, WhiteboardElement } from '../../store/appStore';
import type { SessionType } from '../../types/app';
import { useAppStore } from '../../store/appStore';
import { Wand2, Loader2, CheckCircle2, X, Database, Eye, PenTool, AlertTriangle, Copy } from 'lucide-react';
import { LazyWhiteboard } from '../../components/LazyWhiteboard';
import { LessonPalette } from './lesson-editor/LessonPalette';
import { TimelineRail } from './lesson-editor/TimelineRail';
import { SegmentEditorCard } from './lesson-editor/SegmentEditorCard';
import { PaletteCardEditModal } from './lesson-editor/PaletteCardEditModal';
import { PALETTE_ITEM_MAP } from './lesson-editor/paletteConfig';

export interface LessonEditorViewProps {
  lang: 'zh' | 'en';
  session?: SessionType | null;
  onCopyCourse?: (lessonId: string) => Promise<void>;
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
  session,
  onCopyCourse,
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
  const appSession = useAppStore((s) => s.session);
  const effectiveSession = session || appSession;
  const currentLesson = lessons.find((l) => l.id === selectedLesson);

  const isAdmin =
    effectiveSession?.username === 'admin' ||
    effectiveSession?.userId === 'usr_admin' ||
    (effectiveSession?.role as string) === 'administrator' ||
    effectiveSession?.subRole === 'administrator';

  const isOwner =
    !currentLesson?.creator_id ||
    currentLesson.creator_id === effectiveSession?.userId ||
    currentLesson.creator_id === effectiveSession?.username;

  const canEdit = isAdmin || isOwner;

  const safeHandlePaletteActivate = (type: string) => {
    if (!canEdit) {
      alert(
        lang === 'zh'
          ? '【只读模式】您无法直接修改其他教师创建的课程。请点击上方的「一键克隆为我的备课」生成您的专属教案副本。'
          : '[Read-Only Mode] You cannot modify lessons created by other teachers. Please clone it to your own lessons.'
      );
      return;
    }
    handlePaletteActivate(type);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-surface rounded-2xl border border-theme overflow-hidden shadow-sm text-main">
      <div className="px-3.5 py-2 border-b border-theme flex items-center justify-between shrink-0 bg-surface-secondary/80 backdrop-blur-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <h3 className="font-bold text-main text-xs sm:text-sm flex items-center gap-2 truncate">
            <Wand2 size={16} className="text-primary-theme shrink-0" />
            <span className="truncate">{lang === 'zh' ? '课程编辑器: ' : 'Lesson Editor: '}{currentLesson?.title || (lang === 'zh' ? '未选择课程' : 'No Lesson Selected')}</span>
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
                <div className="flex items-center gap-1 text-[10px] font-semibold text-muted bg-surface-secondary border border-theme px-2 py-0.5 rounded-full">
                  <Database size={10} className="text-muted" />
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
              className="px-2.5 py-1 bg-primary-theme hover:bg-primary-theme-hover text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            >
              <Eye size={13} />
              <span>{lang === 'zh' ? '学生视角预览' : 'Student View'}</span>
            </button>
          )}
          <button onClick={() => setTeacherTab('courses')} className="px-2.5 py-1 bg-surface-secondary hover:bg-surface border border-theme text-muted hover:text-main text-xs font-medium rounded-lg transition-colors cursor-pointer">{lang === 'zh' ? '返回课程库' : 'Back to Courses'}</button>
        </div>
      </div>

      {!canEdit && currentLesson && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-xs text-amber-900 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-600 shrink-0" />
            <span>
              {lang === 'zh'
                ? `【他人课程只读模式】当前课程由教师「${currentLesson.creator_name || currentLesson.creator_id}」创建。您拥有完整查看与备课参考权限。如需编辑调整，请克隆为您的专属教案。`
                : `[Read-Only Mode] This lesson was created by teacher "${currentLesson.creator_name || currentLesson.creator_id}". To customize, please clone it.`}
            </span>
          </div>
          {onCopyCourse && (
            <button
              onClick={() => onCopyCourse(currentLesson.id)}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1 rounded-lg shadow-xs transition-all hover:shadow cursor-pointer shrink-0"
            >
              <Copy size={13} />
              <span>{lang === 'zh' ? '一键克隆为我的备课' : 'Clone as My Lesson'}</span>
            </button>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <LessonPalette lang={lang} onActivate={safeHandlePaletteActivate} />
        <div className="flex-1 relative bg-surface flex flex-col min-w-0 overflow-y-auto">
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
              <div className="absolute inset-0 flex items-center justify-center text-muted p-8 text-center bg-surface-secondary/50">
                <div>
                  <PenTool size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="font-medium text-lg text-main mb-2">No active lesson selected</p>
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
