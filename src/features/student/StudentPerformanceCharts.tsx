import { motion } from 'motion/react';
import { WeeklyProgressTrendChart } from '../../components/WeeklyProgressTrendChart';
import { SemesterGradeTrendChart } from '../../components/SemesterGradeTrendChart';
import { RecentThreeMonthsPerformanceChart } from '../../components/RecentThreeMonthsPerformanceChart';
import { AcademicGrowthTrajectoryChart } from '../../components/AcademicGrowthTrajectoryChart';
import { StudentGradedTimeline } from '../../components/StudentGradedTimeline';

export interface StudentPerformanceChartsProps {
  assignments: any[];
  lang: 'zh' | 'en';
  hideWeeklyTrend?: boolean;
}

export function StudentPerformanceCharts(props: StudentPerformanceChartsProps) {
  const { assignments, lang, hideWeeklyTrend = false } = props;
  return (
    <>
      {/* Weekly Progress Trend Line Chart */}
      {!hideWeeklyTrend && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease: 'easeOut' }}
        >
          <WeeklyProgressTrendChart assignments={assignments} lang={lang} />
        </motion.div>
      )}

      {/* Historical Semester Grade Performance Trend Chart Component */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
      >
        <SemesterGradeTrendChart assignments={assignments} lang={lang} />
      </motion.div>

      {/* 3-Month Historical Performance Line Chart */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      >
        <RecentThreeMonthsPerformanceChart assignments={assignments} lang={lang} />
      </motion.div>

      {/* Academic Growth Trajectory Cumulative Average Progression Chart */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}
      >
        <AcademicGrowthTrajectoryChart assignments={assignments} lang={lang} />
      </motion.div>

      {/* Visual Performance History Timeline & Chronological Chart Component */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
      >
        <StudentGradedTimeline assignments={assignments} />
      </motion.div>
    </>
  );
}
