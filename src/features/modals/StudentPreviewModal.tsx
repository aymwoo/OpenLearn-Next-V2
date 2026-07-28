import { Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import {
  Eye,
  X,
  BookOpen,
  Minimize2,
  Maximize2,
  ChevronRight,
  Folder,
  Globe,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { LazyWhiteboard } from '../../components/LazyWhiteboard';
import { LazyCourseware } from '../../components/LazyCourseware';
import type { Lesson, WhiteboardElement, VFSNode } from '../../types/app';

export interface StudentPreviewModalProps {
  isLessonPreviewVisible: boolean;
  setIsLessonPreviewVisible: Dispatch<SetStateAction<boolean>>;
  lessons: Lesson[];
  selectedLesson: string | null;
  previewFullscreenPanel: 'none' | 'left' | 'right';
  setPreviewFullscreenPanel: Dispatch<SetStateAction<'none' | 'left' | 'right'>>;
  previewLessonTab: 'whiteboard' | 'courseware';
  setPreviewLessonTab: Dispatch<SetStateAction<'whiteboard' | 'courseware'>>;
  activeRole: 'teacher' | 'student';
  elements: WhiteboardElement[];
  activeSegmentId: string | null;
  setActiveSegmentId: Dispatch<SetStateAction<string | null>>;
  fetchElements: (lessonId: string) => void;
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  vfsNodes: VFSNode[];
  previewSelectedCourseware: string | null;
  setPreviewSelectedCourseware: Dispatch<SetStateAction<string | null>>;
}

export function StudentPreviewModal(props: StudentPreviewModalProps) {
  const {
    isLessonPreviewVisible,
    setIsLessonPreviewVisible,
    lessons,
    selectedLesson,
    previewFullscreenPanel,
    setPreviewFullscreenPanel,
    previewLessonTab,
    setPreviewLessonTab,
    activeRole,
    elements,
    activeSegmentId,
    setActiveSegmentId,
    fetchElements,
    currentVfsParent,
    setCurrentVfsParent,
    vfsNodes,
    previewSelectedCourseware,
    setPreviewSelectedCourseware,
  } = props;

  return (
    <>
      {isLessonPreviewVisible && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 z-[60] overflow-hidden text-gray-850">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-indigo-50/70 shrink-0 select-none">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-sm">
                  <Eye size={18} />
                </div>
                <div>
                  <h2 className="font-bold text-gray-900 text-base flex items-center gap-2">
                    学生视角预览 (Student Perspective Preview)
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    正在预览课程: <span className="font-semibold text-gray-700">{lessons.find(l => l.id === selectedLesson)?.title}</span> • 演示同步与交互
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLessonPreviewVisible(false)}
                className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800 text-xs font-semibold rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1 border border-gray-200"
              >
                <X size={14} /> 退出预览
              </button>
            </div>

            {/* Split Workspace */}
            <div className="flex-1 flex min-h-0 bg-slate-50/50 p-4 gap-4">
              {/* Left Column: Lesson markdown course materials */}
              <div className={`${previewFullscreenPanel === 'left' ? 'w-full' : 'w-1/3'} bg-white border border-gray-200 rounded-xl p-4 flex flex-col min-h-0 shadow-sm ${previewFullscreenPanel === 'right' ? 'hidden' : ''} transition-all duration-300`}>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 border-b border-gray-100 pb-2 flex items-center justify-between shrink-0 select-none">
                  <span className="flex items-center gap-1">
                    <BookOpen size={14} className="text-indigo-500" /> Lesson Content (课程内容)
                  </span>
                  <button
                    onClick={() => setPreviewFullscreenPanel(p => p === 'left' ? 'none' : 'left')}
                    className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
                    title={previewFullscreenPanel === 'left' ? "退出全屏" : "全屏"}
                  >
                    {previewFullscreenPanel === 'left' ? (
                      <>
                        <Minimize2 size={13} />
                        <span className="text-[10px] font-medium">退出全屏</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 size={13} />
                        <span className="text-[10px] font-medium">全屏</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto prose prose-sm prose-indigo max-w-none text-gray-700 pr-1">
                  <Markdown>{lessons.find(l => l.id === selectedLesson)?.content || ''}</Markdown>
                </div>
              </div>

              {/* Right Column: Custom interactive whiteboard or cloud drive viewer */}
              <div className={`${previewFullscreenPanel === 'right' ? 'w-full flex-grow' : 'flex-1'} bg-white border border-gray-200 rounded-xl p-4 flex flex-col min-h-0 shadow-sm ${previewFullscreenPanel === 'left' ? 'hidden' : ''} transition-all duration-300`}>
                {/* Switcher tabs */}
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-3 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPreviewLessonTab('whiteboard')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        previewLessonTab === 'whiteboard'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      Interactive Whiteboard
                    </button>
                    <button
                      onClick={() => setPreviewLessonTab('courseware')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        previewLessonTab === 'courseware'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      Cloud Apps Viewer
                    </button>
                  </div>
                  
                  <button
                    onClick={() => setPreviewFullscreenPanel(p => p === 'right' ? 'none' : 'right')}
                    className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
                    title={previewFullscreenPanel === 'right' ? "退出全屏" : "全屏"}
                  >
                    {previewFullscreenPanel === 'right' ? (
                      <>
                        <Minimize2 size={13} />
                        <span className="text-[10px] font-medium">退出全屏</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 size={13} />
                        <span className="text-[10px] font-medium">全屏</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Tab content area */}
                <div className="flex-grow flex-1 min-h-0 flex flex-col h-full relative">
                  {previewLessonTab === 'whiteboard' ? (
                    <div className="flex-grow flex-1 min-h-0 w-full h-full relative rounded-lg overflow-hidden border border-gray-100 flex flex-col">
                      <LazyWhiteboard
lessonId={selectedLesson}
userRole={activeRole}
elements={elements}
activeSegmentId={activeSegmentId}
onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
onElementAdd={async (type: string, data: any) => {
                            await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ type, data })
                            });
                            fetchElements(selectedLesson);
                          }}
onElementUpdate={async (elementId: string, data: any) => {
                            await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ data })
                            });
                            fetchElements(selectedLesson);
                          }}
onElementDelete={async (elementId: string) => {
                            await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                              method: 'DELETE'
                            });
                            fetchElements(selectedLesson);
                          }}
onClearBoard={async () => {
                            await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                              method: 'DELETE'
                            });
                            fetchElements(selectedLesson);
                          }}
onRefresh={() => fetchElements(selectedLesson)}
/>
                    </div>
                  ) : (
                    <div className="flex-grow flex-1 flex gap-4 min-h-0 w-full h-full">
                      {/* Sidebar */}
                      <div className="w-52 flex-shrink-0 bg-gray-50 border border-gray-250/70 rounded-xl p-3 flex flex-col min-h-0 h-full animate-none">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-550 mb-2 border-b border-gray-200 pb-2">
                          Cloud Apps
                        </h4>
                        <div className="flex-1 overflow-y-auto space-y-1">
                          {currentVfsParent !== null && (
                            <button
                              onClick={() => setCurrentVfsParent(null)}
                              className="flex items-center gap-1 p-1.5 text-xs text-indigo-600 w-full hover:bg-gray-255 hover:bg-gray-200 rounded-lg mb-1 font-semibold"
                            >
                              <ChevronRight className="rotate-180" size={14} /> Back to Root
                            </button>
                          )}
                          {vfsNodes.filter(n => n.type === 'dir').map(node => (
                            <button
                              key={node.id}
                              onClick={() => setCurrentVfsParent(node.id)}
                              className="w-full text-left p-1.5 rounded-lg text-xs text-gray-700 hover:bg-gray-250 hover:bg-gray-200 flex items-center gap-2 group truncate cursor-pointer font-medium"
                              title={node.name}
                            >
                              <Folder size={14} className="text-indigo-400 shrink-0 group-hover:text-indigo-600" />
                              <span className="truncate">{node.name}</span>
                            </button>
                          ))}
                          {vfsNodes.filter(n => n.type === 'file' && (n.name.endsWith('.html') || n.name.endsWith('.htm') || n.content?.includes('<html'))).length === 0 ? (
                            <div className="text-xs text-center text-gray-400 italic py-4">No interactive HTML apps found.</div>
                          ) : (
                            vfsNodes.filter(n => n.type === 'file' && (n.name.endsWith('.html') || n.name.endsWith('.htm') || n.content?.includes('<html'))).map(node => (
                              <button
                                key={node.id}
                                onClick={() => setPreviewSelectedCourseware(node.id)}
                                className={`w-full text-left p-2 rounded-lg text-xs flex items-center gap-2 truncate transition-colors cursor-pointer font-medium ${
                                  previewSelectedCourseware === node.id 
                                    ? 'bg-indigo-100 text-indigo-700 font-semibold shadow-xs' 
                                    : 'text-gray-600 hover:bg-gray-100'
                                }`}
                                title={node.name}
                              >
                                <Globe size={14} className="shrink-0 text-indigo-500" />
                                <span className="truncate">{node.name}</span>
                              </button>
                            ))
                          )}
                        </div>
                        <div className="mt-2 text-[10px] text-gray-400 leading-tight">
                          Note: Showing HTML courseware from current OS drive directory.
                        </div>
                      </div>

                      {/* Embed Viewer */}
                      <div className="flex-1 relative bg-white border border-gray-100 rounded-xl overflow-hidden min-h-0 h-full shadow-inner flex flex-col">
                        <LazyCourseware
coursewareId={previewSelectedCourseware}
onClose={() => setPreviewSelectedCourseware(null)}
/>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
