import { StudentView, StudentViewProps } from '../features/student/StudentView';
import { TeacherView, TeacherViewProps } from '../features/teacher/TeacherView';

export type AppShellProps = StudentViewProps & TeacherViewProps;

export function AppShell(props: AppShellProps) {
  const { activeRole } = props;
  if (activeRole === 'student') {
    return <StudentView {...props} />;
  }
  return <TeacherView {...props} />;
}
