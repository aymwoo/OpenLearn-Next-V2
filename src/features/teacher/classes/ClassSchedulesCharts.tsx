import { BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { ClassType, StudentType } from '../../../types/app';
import { ScheduledLessonsProgressChart } from '../../../components/ScheduledLessonsProgressChart';
import { StudentCompareGrowthChart } from '../../../components/StudentCompareGrowthChart';
import { ClassAttendanceSummaryChart } from '../../../components/ClassAttendanceSummaryChart';

export interface ClassSchedulesChartsProps {
  cls: ClassType;
  lang: 'zh' | 'en';
  cStudents: StudentType[];
  classProgressMap: Record<string, any>;
  classSchedulesMap: Record<string, any>;
  classDashboardMap: Record<string, any>;
}

export function ClassSchedulesCharts(props: ClassSchedulesChartsProps) {
  const { cls, lang, cStudents, classProgressMap, classSchedulesMap, classDashboardMap } = props;

  return (
    <div className="space-y-4">
      {classProgressMap[cls.id] && classProgressMap[cls.id].length > 0 && (
        <div className="mb-4 bg-white p-2 border border-gray-100 rounded shadow-sm">
          <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
            <BarChart2 size={12} /> Class Avg Completion
          </div>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={classProgressMap[cls.id]}>
                <XAxis dataKey="lesson_title" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  contentStyle={{ fontSize: '10px', padding: '4px', borderRadius: '4px' }}
                  formatter={(value) => [`${Math.round(value as number)}%`, 'Average']}
                />
                <Bar dataKey="average_progress" fill="#6366f1" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="mb-4">
        <ScheduledLessonsProgressChart
          schedules={classSchedulesMap[cls.id] || []}
          progress={classProgressMap[cls.id] || []}
          lang={lang}
        />
      </div>

      <div className="mb-4">
        <ClassAttendanceSummaryChart
          classId={cls.id}
          lang={lang}
        />
      </div>

      {classDashboardMap[cls.id] && (
        <StudentCompareGrowthChart
          students={cStudents}
          assignments={classDashboardMap[cls.id].assignments || []}
          performance={classDashboardMap[cls.id].performance || []}
          lang={lang}
        />
      )}
    </div>
  );
}
