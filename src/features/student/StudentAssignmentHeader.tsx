import { ChevronRight } from 'lucide-react';
import type { StudentType, Lesson } from '../../types/app';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';

export function StudentAssignmentHeader(props: {
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedAssignment: (ast: any | null) => void;
  selectedAssignment: any;
}) {
  const { setStudentViewStatus, setSelectedAssignment, selectedAssignment } = props;
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <button
        onClick={() => {
          setStudentViewStatus('dashboard');
          setSelectedAssignment(null);
        }}
        className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 transition-colors font-medium text-sm"
      >
        <ChevronRight className="rotate-180" size={16} /> Back to Dashboard
      </button>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-bold text-gray-800">Assignment: {selectedAssignment.title}</h2>
        <ExtensionPointRenderer
          slot="student.assignment.toolbar.action"
          slotProps={{ assignment: selectedAssignment }}
        />
      </div>
    </div>
  );
}
