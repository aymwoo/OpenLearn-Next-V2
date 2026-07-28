import type { Dispatch, SetStateAction } from 'react';
import type { StudentType } from '../../types/app';
import { BookOpen, Minimize2, Maximize2, ChevronRight, Folder, Globe } from 'lucide-react';
import { LazyWhiteboard } from '../../components/LazyWhiteboard';
import { LazyCourseware } from '../../components/LazyCourseware';
import { StudentAssignmentEvalPanel } from '../../components/StudentAssignmentEvalPanel';

export interface StudentLessonInteractionPanelProps {
  studentLessonTab: 'whiteboard' | 'courseware' | 'assignment';
  setStudentLessonTab: (tab: 'whiteboard' | 'courseware' | 'assignment') => void;
  isStudentLessonContentCollapsed: boolean;
  setIsStudentLessonContentCollapsed: (b: boolean) => void;
  lang: 'zh' | 'en';
  studentFullscreenPanel: 'left' | 'right' | 'none';
  setStudentFullscreenPanel: Dispatch<SetStateAction<'left' | 'right' | 'none'>>;
  selectedLesson: string | null;
  elements: any[];
  activeRole: 'student' | 'teacher';
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string) => void;
  fetchElements: (lessonId: string) => void;
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  vfsNodes: any[];
  studentSelectedCourseware: string | null;
  setStudentSelectedCourseware: (id: string | null) => void;
  activeStudentId: string | null;
  addToast: (title: string, description: string, type: string) => void;
}

export function StudentLessonInteractionPanel(props: StudentLessonInteractionPanelProps) {
  const {
    studentLessonTab,
    setStudentLessonTab,
    isStudentLessonContentCollapsed,
    setIsStudentLessonContentCollapsed,
    lang,
    studentFullscreenPanel,
    setStudentFullscreenPanel,
    selectedLesson,
    elements,
    activeRole,
    activeSegmentId,
    setActiveSegmentId,
    fetchElements,
    currentVfsParent,
    setCurrentVfsParent,
    vfsNodes,
    studentSelectedCourseware,
    setStudentSelectedCourseware,
    activeStudentId,
    addToast,
  } = props;
  return (
    <div className={`${(isStudentLessonContentCollapsed || studentFullscreenPanel === 'right') ? 'w-full flex-grow' : 'flex-grow flex-1'} relative flex flex-col min-h-0 ${studentFullscreenPanel === 'left' ? 'hidden' : ''} transition-all duration-300`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
           <button
             onClick={() => setIsStudentLessonContentCollapsed(!isStudentLessonContentCollapsed)}
             className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100/80 cursor-pointer shadow-3xs"
             title={isStudentLessonContentCollapsed ? "展开课程内容" : "折叠课程内容"}
           >
             <BookOpen size={13} className="text-indigo-650" />
             <span>{isStudentLessonContentCollapsed ? (lang === 'zh' ? '展开课程内容' : 'Expand Content') : (lang === 'zh' ? '折叠课程内容' : 'Collapse Content')}</span>
           </button>
           <button onClick={() => setStudentLessonTab('whiteboard')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${studentLessonTab === 'whiteboard' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>Interactive Whiteboard</button>
           <button onClick={() => setStudentLessonTab('courseware')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${studentLessonTab === 'courseware' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>Interactive Courseware Viewer</button>
            <button onClick={() => setStudentLessonTab('assignment')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${studentLessonTab === 'assignment' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>{lang === 'zh' ? '作业提交与互评' : 'Assignments & Peer Reviews'}</button>
        </div>
        
        <button
          onClick={() => setStudentFullscreenPanel(p => p === 'right' ? 'none' : 'right')}
          className="p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer flex items-center gap-1"
          title={studentFullscreenPanel === 'right' ? "退出全屏" : "全屏"}
        >
          {studentFullscreenPanel === 'right' ? (
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
      {studentLessonTab === 'whiteboard' && (
         <LazyWhiteboard
lessonId={selectedLesson}
elements={elements}
userRole={activeRole}
activeSegmentId={activeSegmentId}
onSegmentSync={(segId: string) => setActiveSegmentId(segId)}
onElementUpdate={async () => { /* readonly or sync */ }}
onElementDelete={async (elementId: string) => {
               await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, { method: 'DELETE' });
               fetchElements(selectedLesson);
             }}
onClearBoard={async () => {
               await fetch(`/api/lessons/${selectedLesson}/whiteboard`, { method: 'DELETE' });
               fetchElements(selectedLesson);
             }}
onElementAdd={async () => { /* readonly or sync */ }}
onRefresh={() => fetchElements(selectedLesson)}
/>
      )}
      {studentLessonTab === 'courseware' && (
         <div className="flex-1 flex gap-4 min-h-0">
           {/* Courseware Selector Sidebar */}
           <div className="w-48 flex-shrink-0 bg-gray-50 border border-gray-200 rounded-lg p-3 flex flex-col min-h-0">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 border-b border-gray-200 pb-2">Cloud Apps</h4>
              <div className="flex-1 overflow-y-auto space-y-1">
                 {currentVfsParent !== null && (
                    <button onClick={() => setCurrentVfsParent(null)} className="flex items-center gap-2 p-1.5 text-xs text-indigo-600 w-full hover:bg-gray-200 rounded mb-1 font-medium">
                      <ChevronRight className="rotate-180" size={14} /> Back to Root
                    </button>
                 )}
                 {vfsNodes.filter(n => n.type === 'dir').map(node => (
                    <button
                      key={node.id}
                      onClick={() => setCurrentVfsParent(node.id)}
                      className="w-full text-left p-1.5 rounded text-xs text-gray-700 hover:bg-gray-200 flex items-center gap-2 group truncate"
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
                         onClick={() => setStudentSelectedCourseware(node.id)}
                         className={`w-full text-left p-2 rounded text-xs flex items-center gap-2 truncate transition-colors ${studentSelectedCourseware === node.id ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}
                         title={node.name}
                       >
                          <Globe size={14} className="shrink-0" />
                          <span className="truncate">{node.name}</span>
                       </button>
                    ))
                  )}
               </div>
               <div className="mt-2 text-[10px] text-gray-400 leading-tight">Note: Showing HTML courseware from current OS drive directory. Ask agent to generate courseware.</div>
            </div>
            <div className="flex-1 relative bg-white min-h-0">
               <LazyCourseware
coursewareId={studentSelectedCourseware}
onClose={() => setStudentSelectedCourseware(null)}
/>
            </div>
         </div>
      )}
      {studentLessonTab === 'assignment' && (
         <StudentAssignmentEvalPanel
           lessonId={selectedLesson}
           studentId={activeStudentId}
           lang={lang}
           addToast={addToast}
         />
      )}
    </div>
  );
}
