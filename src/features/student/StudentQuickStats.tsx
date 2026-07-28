import { motion } from 'framer-motion';
import { AnimatedCounter } from '../../components/AnimatedCounter';

export interface StudentQuickStatsProps {
  studentDashboardData: any;
}

export function StudentQuickStats(props: StudentQuickStatsProps) {
  const { studentDashboardData } = props;
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:border-indigo-300 hover:shadow-md transition-all duration-300"
      >
        <span className="text-3xl font-bold text-indigo-600">
          <AnimatedCounter value={studentDashboardData.classes?.length || 0} />
        </span>
        <span className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider text-center select-none">Enrolled Classes</span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:border-teal-300 hover:shadow-md transition-all duration-300"
      >
        <span className="text-3xl font-bold text-teal-600">
          <AnimatedCounter value={studentDashboardData.assignments?.filter((a: any) => a.submission_status === 'graded').length || 0} />
        </span>
        <span className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider text-center select-none">Completed Assignments</span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:border-amber-300 hover:shadow-md transition-all duration-300"
      >
        <span className="text-3xl font-bold text-amber-500">
          <AnimatedCounter value={studentDashboardData.assignments?.filter((a: any) => !a.submission_status).length || 0} />
        </span>
        <span className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider text-center select-none">Pending Assignments</span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:border-pink-300 hover:shadow-md transition-all duration-300"
      >
        <span className="text-3xl font-bold text-pink-600">
          <AnimatedCounter value={studentDashboardData.schedules?.length || 0} />
        </span>
        <span className="text-sm font-medium text-gray-500 mt-1 uppercase tracking-wider text-center select-none">Upcoming Lessons</span>
      </motion.div>
    </div>
  );
}
