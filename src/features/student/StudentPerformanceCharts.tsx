import { motion } from 'framer-motion';
import { SemesterGradeTrendChart } from '../../components/SemesterGradeTrendChart';
import { RecentThreeMonthsPerformanceChart } from '../../components/RecentThreeMonthsPerformanceChart';
import { AcademicGrowthTrajectoryChart } from '../../components/AcademicGrowthTrajectoryChart';
import { StudentGradedTimeline } from '../../components/StudentGradedTimeline';

export interface StudentPerformanceChartsProps {
  assignments: any[];
  lang: 'zh' | 'en';
}

export function StudentPerformanceCharts(props: StudentPerformanceChartsProps) {
  const { assignments, lang } = props;
  return (
    <>
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
