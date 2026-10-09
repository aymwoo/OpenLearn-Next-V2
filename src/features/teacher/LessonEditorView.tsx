import { useEffect, useState, useCallback, useRef, type MutableRefObject } from 'react';
import type { Lesson, WhiteboardElement } from '../../store/appStore';
import type { SessionType } from '../../types/app';
import { useAppStore } from '../../store/appStore';
import { useAppData } from '../../context/AppDataContext';
import { Wand2, Loader2, CheckCircle2, X, Database, PenTool, AlertTriangle, Copy } from 'lucide-react';
import { LazyWhiteboard } from '../../components/LazyWhiteboard';
import { ClassroomSyncChannel } from '../../services/classroom-sync-channel';
import { LessonPalette } from './lesson-editor/LessonPalette';
import { TimelineRail } from './lesson-editor/TimelineRail';
import { SegmentEditorCard } from './lesson-editor/SegmentEditorCard';
import { PaletteCardEditModal } from './lesson-editor/PaletteCardEditModal';
import { PALETTE_ITEM_MAP, getPaletteItemConfig } from './lesson-editor/paletteConfig';
import { useWhiteboardAutoSave } from '../whiteboard/services/useWhiteboardAutoSave';
import type { WhiteboardPageItem, WhiteboardDragState } from '../whiteboard/InteractiveWhiteboard';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { useOptionalPluginHost } from '../../plugin-host/plugin-host-context';

export function LessonEditorView() {
  // C1-R3: 全部数据经 AppDataContext 取用（不再经 TeacherView props 透传）
  const host = useOptionalPluginHost();
  const {
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
  } = useAppData();
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
  const isReadOnly = !canEdit || activeRole !== 'teacher';
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [whiteboardPages, setWhiteboardPages] = useState<WhiteboardPageItem[]>([]);
  const [currentWhiteboardPage, setCurrentWhiteboardPage] = useState<number>(0);
  const [whiteboardDragState, setWhiteboardDragState] = useState<WhiteboardDragState | null>(null);
  const hoveredPageDropTargetRef = useRef<{ type: 'page'; pageIndex: number } | null>(null);
  const hoveredSegmentDropTargetRef = useRef<{ type: 'segment'; segmentId: string } | null>(null);

  useEffect(() => {
    if (!whiteboardDragState) {
      hoveredPageDropTargetRef.current = null;
      hoveredSegmentDropTargetRef.current = null;
    }
  }, [whiteboardDragState]);

  // ── 接入双向受控 IHostActionDispatcher：响应全局或插件发起的 host:refresh ──
  useEffect(() => {
    if (!host) return;
    const dispatcher = host.getDispatcher?.();
    if (!dispatcher) return;

    const disposable = dispatcher.registerHandler('host:refresh', async (envelope) => {
      const target = envelope.action.payload.target;
      if (target === 'lessons' || target === 'all') {
        if (selectedLesson && fetchElements) {
          await fetchElements(selectedLesson);
        }
        return { success: true, refreshed: ['lessons'] };
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [host, selectedLesson, fetchElements]);

  const handleSaveElementToServer = async (lId: string, elId: string, data: any): Promise<boolean> => {
    try {
      const response = await fetch(`/api/lessons/${lId}/whiteboard/${elId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      return response.ok;
    } catch (err) {
      console.error('[LessonEditorView] autosave element failed:', err);
      return false;
    }
  };

  const {
    queueUpdate,
    flush: flushAutoSave,
    pendingCount,
  } = useWhiteboardAutoSave({
    lessonId: selectedLesson,
    onSaveToServer: handleSaveElementToServer,
    debounceDelay: 800,
    onStatusChange: (status, savedTime) => {
      if (status !== 'pending') {
        setEditorSaveStatus(status);
      }
      if (savedTime) {
        setEditorLastSavedTime(savedTime);
      }
    },
  });

  const handleElementDropCheck = useCallback(
    (e: PointerEvent, elementId: string): boolean => {
      const target = hoveredPageDropTargetRef.current || hoveredSegmentDropTargetRef.current;
      if (!target) return false;
      if (target.type === 'page') {
        void (async () => {
          await whiteboardRef.current?.moveElementToPage?.(elementId, target.pageIndex);
          if (selectedLesson) {
            await flushAutoSave();
            await fetchElements(selectedLesson);
          }
        })();
        return true;
      }
      if (target.type === 'segment') {
        void (async () => {
          await whiteboardRef.current?.moveElementToSegment?.(elementId, target.segmentId);
          if (selectedLesson) {
            await flushAutoSave();
            await fetchElements(selectedLesson);
          }
        })();
        return true;
      }
      return false;
    },
    [whiteboardRef, selectedLesson, flushAutoSave, fetchElements],
  );

  // 备课与教案设计器：向打开的学生端Tab实时广播课节与环节变化
  useEffect(() => {
    if (!selectedLesson) return;
    const channel = new ClassroomSyncChannel();
    channel.broadcastChangeLesson(selectedLesson);
    if (activeSegmentId) {
      channel.broadcastChangeSegment(activeSegmentId);
    }
    const unsub = channel.onMessage((msg) => {
      if (msg.type === 'STUDENT_HANDSHAKE_REQUEST') {
        channel.broadcastInitState({
          selectedLesson,
          activeSegmentId,
          activeTab: 'whiteboard',
          isClassLocked: false,
          liveClassTimeRemaining: 0,
          liveClassSelectedClassId: '',
          liveClassIsActive: false,
        });
      }
    });
    return () => {
      unsub();
      channel.destroy();
    };
  }, [selectedLesson, activeSegmentId]);

  const safeHandlePaletteActivate = (type: string) => {
    if (isReadOnly) {
      alert(
        !canEdit
          ? lang === 'zh'
            ? '【只读模式】您无法直接修改其他教师创建的课程。请点击上方的「一键克隆为我的备课」生成您的专属教案副本。'
            : '[Read-Only Mode] You cannot modify lessons created by other teachers. Please clone it to your own lessons.'
          : lang === 'zh'
            ? '学生视角预览为只读模式。'
            : 'Student preview is read-only.',
      );
      return;
    }
    handlePaletteActivate(type);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-surface rounded-2xl border border-theme overflow-hidden shadow-sm text-main transition-colors">
      {/* 现代悬浮毛玻璃顶栏 (Glassmorphic Header) */}
      <div className="px-4 py-2.5 border-b border-theme flex flex-wrap items-center justify-between gap-3 shrink-0 bg-surface/85 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          {/* 课程标题 Badge */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primary-theme/10 text-primary-theme border border-primary-theme/20 flex items-center justify-center shrink-0">
              <Wand2 size={16} />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-primary-theme">
                  {lang === 'zh' ? '教案与白板编排' : 'Lesson Orchestrator'}
                </span>
                {isReadOnly && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold bg-amber-500/15 text-amber-600 border border-amber-500/30">
                    {lang === 'zh' ? '只读预览' : 'Read-Only Preview'}
                  </span>
                )}
              </div>
              <h2 className="text-xs sm:text-sm font-black text-main truncate tracking-tight">
                {lang === 'zh'
                  ? `课程编辑器: ${currentLesson?.title || '未选择课程'}`
                  : `Lesson Editor: ${currentLesson?.title || 'No Lesson Selected'}`}
              </h2>
            </div>
          </div>

          {/* 现代微药丸段控器角色切换 (Segmented Control) —— 已移至右侧「返回课程库」旁 */}

          {/* 自动保存状态胶囊 */}
          {selectedLesson && (
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              {pendingCount > 0 && editorSaveStatus !== 'saving' && (
                <button
                  type="button"
                  onClick={() => void flushAutoSave()}
                  title={lang === 'zh' ? '有未保存改动，点击立即写入服务器' : 'Pending changes, click to sync now'}
                  className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-2.5 py-1 rounded-full transition-all cursor-pointer shadow-2xs hover:scale-102"
                >
                  <Loader2 size={11} className="animate-spin text-amber-600" />
                  <span>
                    {lang === 'zh' ? `${pendingCount} 项待写入 (点击立即保存)` : `${pendingCount} pending (sync now)`}
                  </span>
                </button>
              )}
              {editorSaveStatus === 'saving' && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-full animate-pulse shadow-2xs">
                  <Loader2 size={11} className="animate-spin text-amber-600" />
                  <span>{lang === 'zh' ? '同步 SQLite...' : 'Saving SQLite...'}</span>
                </div>
              )}
              {editorSaveStatus === 'saved' && pendingCount === 0 && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full shadow-2xs">
                  <CheckCircle2 size={11} className="text-emerald-500" />
                  <span>{lang === 'zh' ? '已自动保存' : 'Auto-Saved'}</span>
                  {editorLastSavedTime && (
                    <span className="text-[11px] font-mono opacity-70">
                      {editorLastSavedTime.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              )}
              {editorSaveStatus === 'error' && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-rose-600 bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 rounded-full shadow-2xs">
                  <X size={11} className="text-rose-600" />
                  <span>{lang === 'zh' ? '写入失败' : 'Failed to save'}</span>
                </div>
              )}
              {editorSaveStatus === 'none' && pendingCount === 0 && (
                <div className="flex items-center gap-1.5 text-xs font-bold text-muted bg-surface-secondary border border-theme px-2.5 py-1 rounded-full shadow-2xs">
                  <Database size={11} className="text-muted" />
                  <span>{lang === 'zh' ? '同步就绪' : 'Ready'}</span>
                </div>
              )}

              {/* Plugin Extension Slots */}
              <ExtensionPointRenderer
                slot="whiteboard.autosave.status"
                slotProps={{
                  lessonId: selectedLesson,
                  status: editorSaveStatus,
                  pendingCount,
                  lastSavedTime: editorLastSavedTime,
                }}
              />
              <ExtensionPointRenderer
                slot="whiteboard.autosave.action"
                slotProps={{
                  lessonId: selectedLesson,
                  flush: flushAutoSave,
                  pendingCount,
                }}
              />
            </div>
          )}
        </div>

        {/* 顶部右侧快捷操作 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 视角切换：教师视角就地切回；学生视角在独立标签页打开，避免备课界面被整体替换 */}
          <div className="bg-surface-secondary border border-theme p-1 rounded-xl flex items-center gap-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setActiveRole('teacher')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeRole === 'teacher'
                  ? 'bg-surface text-primary-theme font-black shadow-xs border border-theme/60 scale-102'
                  : 'text-muted hover:text-main'
              }`}
              title={lang === 'zh' ? '在当前窗口切回教师编辑视角' : 'Switch back to the teacher editor view'}
            >
              <span>👨‍🏫</span>
              <span>{lang === 'zh' ? '教师视角' : 'Teacher'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const studentUrl = `${window.location.origin}${window.location.pathname}?mode=student_preview&lessonId=${encodeURIComponent(
                  selectedLesson || '',
                )}#/student_preview`;
                const opened = window.open(studentUrl, '_blank');
                if (!opened) {
                  alert(
                    lang === 'zh'
                      ? '新标签页被浏览器拦截，请允许本站打开弹出窗口后重试。'
                      : 'The new tab was blocked. Please allow pop-ups for this site and retry.',
                  );
                }
              }}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeRole === 'student'
                  ? 'bg-primary-theme text-white font-black shadow-xs scale-102'
                  : 'text-muted hover:text-main'
              }`}
              title={
                lang === 'zh'
                  ? '在新标签页中以学生身份预览本课节（不影响当前备课窗口）'
                  : 'Open a student-perspective preview of this lesson in a new tab'
              }
            >
              <span>🎓</span>
              <span>{lang === 'zh' ? '学生视角' : 'Student'}</span>
            </button>
          </div>

          {/* 备课编辑器头部动作扩展（导入教案库 / AI 合规审查 / 导出 PDF 等） */}
          <ExtensionPointRenderer
            slot="editor.header.action"
            slotProps={{
              lessonId: selectedLesson,
              currentLesson,
              lang,
              isReadOnly,
              activeRole,
              onSave: handleSaveElementToServer,
            }}
          />

          <button
            type="button"
            onClick={() => setTeacherTab('courses')}
            className="px-3 py-1.5 bg-surface hover:bg-surface-secondary border border-theme text-muted hover:text-main text-xs font-bold rounded-xl transition-all cursor-pointer shadow-2xs hover:scale-102"
          >
            {lang === 'zh' ? '返回课程库' : 'Back to Courses'}
          </button>
        </div>
      </div>

      {!canEdit && currentLesson && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 backdrop-blur-xs shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500 shrink-0" />
            <span>
              {lang === 'zh'
                ? `【他人课程只读模式】当前课程由教师「${currentLesson.creator_name || currentLesson.creator_id}」创建。您拥有完整查看与备课参考权限。如需编辑调整，请克隆为您的专属教案。`
                : `[Read-Only Mode] This lesson was created by teacher "${currentLesson.creator_name || currentLesson.creator_id}". To customize, please clone it.`}
            </span>
          </div>
          {onCopyCourse && (
            <button
              onClick={() => onCopyCourse(currentLesson.id)}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold px-3 py-1.5 rounded-xl shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0"
            >
              <Copy size={13} />
              <span>{lang === 'zh' ? '一键克隆为我的备课' : 'Clone as My Lesson'}</span>
            </button>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <LessonPalette
          lang={lang}
          onActivate={safeHandlePaletteActivate}
          readOnly={isReadOnly}
          collapsed={paletteCollapsed}
          onToggleCollapse={setPaletteCollapsed}
          pages={whiteboardPages}
          currentPage={currentWhiteboardPage}
          onSwitchPage={(idx) => whiteboardRef.current?.switchPage?.(idx)}
          onAddPage={(customTitle) => whiteboardRef.current?.addPage?.(customTitle)}
          onDeletePage={(idx) => whiteboardRef.current?.deletePage?.(idx)}
          onRenamePage={(idx, newTitle) => whiteboardRef.current?.renamePage?.(idx, newTitle)}
          dragState={whiteboardDragState}
          onHoverDropTarget={(target) => {
            hoveredPageDropTargetRef.current = target;
          }}
        />
        <div className="flex-1 relative bg-surface flex flex-col min-w-0">
          <TimelineRail
            lang={lang}
            segments={timelineSegments}
            activeSegmentId={activeSegmentId}
            setActiveSegmentId={setActiveSegmentId}
            draggedSegmentIdx={draggedSegmentIdx}
            setDraggedSegmentIdx={setDraggedSegmentIdx}
            selectedLesson={selectedLesson}
            saveTimeline={saveTimeline}
            readOnly={isReadOnly}
            editorPanelsExpanded={editorPanelsExpanded}
            setEditorPanelsExpanded={setEditorPanelsExpanded}
            dragState={whiteboardDragState}
            onHoverDropTarget={(target) => {
              hoveredSegmentDropTargetRef.current = target;
            }}
          />
          <div className="flex-1 relative flex flex-col min-w-0 overflow-y-auto">
            {selectedLesson &&
              activeSegmentId &&
              editorPanelsExpanded &&
              timelineSegments.some((s) => s.id === activeSegmentId) && (
                <SegmentEditorCard
                  key={activeSegmentId}
                  lang={lang}
                  segment={timelineSegments.find((s) => s.id === activeSegmentId)}
                  readOnly={isReadOnly}
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
                    if (
                      window.confirm(
                        `确定要删除环节"${timelineSegments.find((s) => s.id === activeSegmentId)?.title}"吗？`,
                      )
                    ) {
                      const updated = timelineSegments.filter((s) => s.id !== activeSegmentId);
                      saveTimeline(selectedLesson, updated);
                      setActiveSegmentId(updated[0]?.id || null);
                    }
                  }}
                />
              )}
            <div className="flex-1 min-h-[380px] relative flex flex-col min-w-0">
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
                    readOnly={isReadOnly}
                    elements={elements}
                    activeSegmentId={activeSegmentId}
                    hidePageBar={true}
                    onPagesStateChange={({
                      pages,
                      currentPage,
                    }: {
                      pages: WhiteboardPageItem[];
                      currentPage: number;
                    }) => {
                      setWhiteboardPages(pages);
                      setCurrentWhiteboardPage(currentPage);
                    }}
                    onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
                    onElementDragChange={setWhiteboardDragState}
                    onElementDropCheck={handleElementDropCheck}
                    onElementAdd={async (type: string, data: any) => {
                      if (isReadOnly) return;
                      await flushAutoSave();
                      setEditorSaveStatus('saving');
                      try {
                        const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ type, data }),
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
                    onElementUpdate={(elementId: string, data: any) => {
                      if (isReadOnly) return;
                      queueUpdate(elementId, data);
                    }}
                    onElementDelete={async (elementId: string) => {
                      if (isReadOnly) return;
                      await flushAutoSave();
                      setEditorSaveStatus('saving');
                      try {
                        const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                          method: 'DELETE',
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
                      if (isReadOnly) return;
                      await flushAutoSave();
                      setEditorSaveStatus('saving');
                      try {
                        const response = await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                          method: 'DELETE',
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
                  {paletteEdit && !isReadOnly && getPaletteItemConfig(paletteEdit.type) && (
                    <PaletteCardEditModal
                      config={getPaletteItemConfig(paletteEdit.type)!}
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
    </div>
  );
}
