import { motion } from 'framer-motion';
import { Sparkles, Check } from 'lucide-react';

export interface StudentRollCallAlarmsProps {
  studentDashboardData: any;
  readNotifications: Set<string>;
  setReadNotifications: (updater: (prev: Set<string>) => Set<string>) => void;
  activeStudentId: string | null;
  addToast: (title: string, description: string, type: string) => void;
  lang: 'zh' | 'en';
}

export function StudentRollCallAlarms(props: StudentRollCallAlarmsProps) {
  const { studentDashboardData, readNotifications, setReadNotifications, activeStudentId, addToast, lang } = props;
  const rollcalls = studentDashboardData?.rollcalls || [];
  const unreadRCs = rollcalls.filter((r: any) => !readNotifications.has(r.id));
  if (unreadRCs.length === 0) return null;

  return (
    <div className="space-y-4">
      {unreadRCs.map((r: any) => (
        <motion.div
          key={r.id}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-amber-500 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden"
        >
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-2xl animate-pulse" />
          <div className="absolute -left-10 -top-10 w-32 h-32 bg-yellow-300/20 rounded-full blur-xl" />

          <div className="flex flex-col md:flex-row items-center justify-between gap-4 relative z-10">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 backdrop-blur-md rounded-xl animate-bounce shrink-0">
                <Sparkles className="h-6 w-6 text-yellow-100" />
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight">
                  {lang === 'zh' ? '⚡️ 闪电提问点名中，请立即回应！' : '⚡️ Active Classroom Roll Call Alarm!'}
                </h3>
                <p className="text-yellow-50 text-sm mt-1 max-w-xl font-medium">
                  {lang === 'zh'
                    ? `您刚才在课程"${r.lesson_title || '课堂'}"中被老师随机选中。大屏已同步闪烁您的姓名，请点击右侧按钮确认专注参与！`
                    : `You have been randomly selected by the teacher in lesson "${r.lesson_title || 'Class'}". Please click the button to confirm your presence and active attention!`}
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  await fetch(`/api/students/${activeStudentId}/read_notifications`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notificationId: r.id })
                  });
                  setReadNotifications(prev => {
                    const next = new Set(prev);
                    next.add(r.id);
                    return next;
                  });
                  addToast(
                    lang === 'zh' ? '已确认参与状态' : 'Presence confirmed',
                    lang === 'zh' ? '成功！已安全同步并确认在线。' : 'Successfully synchronized and confirmed active presence.',
                    'success'
                  );
                } catch (e) {
                  console.error('Failed to acknowledge rollcall', e);
                }
              }}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg ring-2 ring-white/20 active:scale-95 transition-all flex items-center gap-2 cursor-pointer shrink-0"
            >
              <Check size={14} />
              <span>{lang === 'zh' ? '🙋‍♂️ 我已就位 / 确认听讲' : '🙋‍♂️ Present & Alert'}</span>
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
