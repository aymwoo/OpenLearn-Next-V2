import { StudentAssignmentHeader } from './StudentAssignmentHeader';
import { StudentAssignmentQuestionPanel } from './StudentAssignmentQuestionPanel';
import { StudentAssignmentWorkPanel } from './StudentAssignmentWorkPanel';

export interface StudentAssignmentViewProps {
  selectedAssignment: any;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedAssignment: (ast: any | null) => void;
  quizStudentAnswers: any;
  submitQuizAssignment: (isFinal: boolean) => void;
  subAssignmentTab: 'quiz' | 'whiteboard';
  setSubAssignmentTab: (tab: 'quiz' | 'whiteboard') => void;
  setQuizStudentAnswers: (updater: (prev: any) => any) => void;
  elements: any[];
  activeRole: 'student' | 'teacher';
  activeStudentId: string | null;
  fetchElements: (lessonId: string) => void;
}

export function StudentAssignmentView(props: StudentAssignmentViewProps) {
  const {
    selectedAssignment,
    setStudentViewStatus,
    setSelectedAssignment,
    quizStudentAnswers,
    submitQuizAssignment,
    subAssignmentTab,
    setSubAssignmentTab,
    setQuizStudentAnswers,
    elements,
    activeRole,
    activeStudentId,
    fetchElements,
  } = props;
  return (
    <div className="flex flex-col h-full space-y-4">
      <StudentAssignmentHeader setStudentViewStatus={setStudentViewStatus} setSelectedAssignment={setSelectedAssignment} selectedAssignment={selectedAssignment} />
      <div className="flex-1 flex gap-6 min-h-0 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <StudentAssignmentQuestionPanel selectedAssignment={selectedAssignment} quizStudentAnswers={quizStudentAnswers} submitQuizAssignment={submitQuizAssignment} />
        <StudentAssignmentWorkPanel selectedAssignment={selectedAssignment} subAssignmentTab={subAssignmentTab} setSubAssignmentTab={setSubAssignmentTab} quizStudentAnswers={quizStudentAnswers} setQuizStudentAnswers={setQuizStudentAnswers} submitQuizAssignment={submitQuizAssignment} elements={elements} activeRole={activeRole} activeStudentId={activeStudentId} fetchElements={fetchElements} />
      </div>
    </div>
  );
}
