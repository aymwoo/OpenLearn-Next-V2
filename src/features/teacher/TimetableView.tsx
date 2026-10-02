import React from 'react';
import { TimetableManager } from '../../components/TimetableManager';
import type { Lesson, ClassType } from '../../store/appStore';
import { useOptionalAppData } from '../../context/AppDataContext';

export interface TimetableViewProps {
  classes?: ClassType[];
  lessons?: Lesson[];
  lang?: 'zh' | 'en';
  onSchedulesUpdated?: () => Promise<void>;
}

export function TimetableView(props: TimetableViewProps = {}) {
  const appData = useOptionalAppData();
  const classes = props.classes ?? appData?.classes ?? [];
  const lessons = props.lessons ?? appData?.lessons ?? [];
  const lang = props.lang ?? (appData?.lang as 'zh' | 'en') ?? 'zh';
  const onSchedulesUpdated = props.onSchedulesUpdated ?? appData?.fetchTodaySchedules ?? (async () => {});

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-white" id="teacher_timetable_tab_panel">
      <TimetableManager classes={classes} lessons={lessons} lang={lang} onSchedulesUpdated={onSchedulesUpdated} />
    </div>
  );
}
