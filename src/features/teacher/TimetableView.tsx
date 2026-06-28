import React from 'react';
import { TimetableManager } from '../../components/TimetableManager';
import type { Lesson, ClassType } from '../../store/appStore';

interface TimetableViewProps {
  classes: ClassType[];
  lessons: Lesson[];
  lang: string;
  onSchedulesUpdated: () => Promise<void>;
}

export function TimetableView({ classes, lessons, lang, onSchedulesUpdated }: TimetableViewProps) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-white" id="teacher_timetable_tab_panel">
      <TimetableManager classes={classes} lessons={lessons} lang={lang} onSchedulesUpdated={onSchedulesUpdated} />
    </div>
  );
}
