export interface ClassType {
  id: string;
  name: string;
  description?: string;
}

export interface LessonType {
  id: string;
  title: string;
}

export interface ScheduleType {
  id: string;
  class_id: string;
  lesson_id: string;
  scheduled_date: string;
  time_slot?: string | null;
  status?: 'scheduled' | 'cancelled' | 'holiday' | 'swap' | string;
  notes?: string | null;
  lesson_title?: string;
  class_name?: string;
  isRepeating?: boolean;
}

export interface TimetableManagerProps {
  classes: ClassType[];
  lessons: LessonType[];
  lang: 'zh' | 'en';
  onSchedulesUpdated: () => void;
  onClassesUpdated?: () => void;
}
