import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';

/** 后端 /api/demo-data/status 与 /api/demo-data/seed 返回的数据结构 */
export interface DemoDataCounts {
  schedule: number;
  class_student: number;
  student: number;
  class: number;
  lesson: number;
  user: number;
}

export interface DemoDataStatus {
  seeded: boolean;
  total: number;
  counts: DemoDataCounts;
  demoTeacherExists: boolean;
  seededAt: number | null;
  demo?: {
    lessonId: string;
    classIds: string[];
    studentIds: string[];
    teacherUsername: string;
    scheduleId: string;
  };
  credentials?: {
    username: string;
    password: string;
    name: string;
  };
}

interface DemoDataCleanupResult {
  before?: Partial<DemoDataStatus>;
  report?: {
    removed?: Partial<DemoDataCounts>;
    skippedAdministrators?: number;
    totalRemoved?: number;
  };
  after?: Partial<DemoDataStatus>;
}

interface DemoDataPanelProps {
  lang: 'zh' | 'en';
}

type Feedback = { type: 'success' | 'error'; text: string } | null;

/** 实体计数的中文/英文标签与展示顺序 */
const COUNT_FIELDS: Array<{ key: keyof DemoDataCounts; zh: string; en: string }> = [
  { key: 'lesson', zh: '课程', en: 'Lessons' },
  { key: 'class', zh: '班级', en: 'Classes' },
  { key: 'student', zh: '学生', en: 'Students' },
  { key: 'class_student', zh: '班级关系', en: 'Enrollments' },
  { key: 'schedule', zh: '课表', en: 'Schedules' },
  { key: 'user', zh: '账号', en: 'Accounts' },
];

export function DemoDataPanel({ lang }: DemoDataPanelProps) {
  const [status, setStatus] = useState<DemoDataStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // 从响应中安全取出 result（测试桩可能返回 {}，需要容错）
  const readResult = async (res: Response): Promise<any> => {
    const data = await res.json().catch(() => ({}));
    return data && data.success ? data.result : null;
  };

  // 清理结果需要用到后端返回的 message 字段，因此单独保留完整响应
  const readResponse = async <T,>(res: Response): Promise<{ result: T | null; message?: string }> => {
    const data = await res.json().catch(() => ({}));
    return { result: data && data.success ? data.result : null, message: data?.message };
  };

  const fetchDemoDataStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      const res = await fetch('/api/demo-data/status');
      if (res.ok) {
        const result = await readResult(res);
        if (result) setStatus(result as DemoDataStatus);
      }
    } catch (err) {
      console.error('Failed to fetch demo data status', err);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDemoDataStatus();
  }, [fetchDemoDataStatus]);

  // 播种是幂等的；已有数据时按钮变为「重置并重新初始化」，走 ?reset=true
  const hasDemoData = Boolean(status && (status.seeded || status.total > 0));

  const handleSeed = async () => {
    try {
      setSeeding(true);
      setFeedback(null);
      const res = await fetch(`/api/demo-data/seed${hasDemoData ? '?reset=true' : ''}`, { method: 'POST' });
      const result = await readResult(res);
      if (res.ok && result) {
        setStatus(result as DemoDataStatus);
        setFeedback({
          type: 'success',
          text:
            lang === 'zh'
              ? '演示数据已就绪，可用下方演示教师账号登录体验。'
              : 'Demo data is ready. Log in with the demo teacher account below.',
        });
      } else {
        setFeedback({
          type: 'error',
          text: lang === 'zh' ? '初始化演示数据失败，请稍后重试。' : 'Failed to seed demo data, please retry.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: lang === 'zh' ? `初始化失败：${err.message || '网络异常'}` : `Seed failed: ${err.message || 'Network error'}`,
      });
    } finally {
      setSeeding(false);
    }
  };

  const handleCleanup = async () => {
    // 危险操作确认：与本文件其它删除操作保持一致，使用原生 confirm
    const confirmMsg =
      lang === 'zh'
        ? '确定要清理演示数据吗？\n\n只删除演示数据（演示教师、演示课程/班级/学生/课表），系统本身的数据不受影响，管理员账号不会被删除。'
        : 'Purge demo data?\n\nOnly demo records (demo teacher, demo lesson/class/student/schedule) are removed. Your own data and administrator accounts are never touched.';
    if (!confirm(confirmMsg)) return;

    try {
      setCleaning(true);
      setFeedback(null);
      const res = await fetch('/api/demo-data/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 后端要求携带确认口令，否则返回 400
        body: JSON.stringify({ confirm: 'PURGE_DEMO_DATA' }),
      });
      const { result, message } = await readResponse<DemoDataCleanupResult>(res);
      if (res.ok && result) {
        setStatus(result.after ? (result.after as DemoDataStatus) : null);
        if (!result.after) await fetchDemoDataStatus();
        // 清理条数与提示文案一律以后端返回为准，不在前端硬编码数字
        const total = result.report?.totalRemoved;
        const fallback =
          total === undefined ? '' : lang === 'zh' ? `已清理 ${total} 条演示数据。` : `Removed ${total} demo records.`;
        setFeedback({ type: 'success', text: message || fallback });
      } else {
        setFeedback({
          type: 'error',
          text: lang === 'zh' ? '清理演示数据失败，请稍后重试。' : 'Failed to purge demo data, please retry.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: lang === 'zh' ? `清理失败：${err.message || '网络异常'}` : `Purge failed: ${err.message || 'Network error'}`,
      });
    } finally {
      setCleaning(false);
    }
  };

  // seededAt 是毫秒时间戳，格式化成可读时间
  const formatSeededAt = (ts: number | null | undefined) => {
    if (!ts) return null;
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
  };
  const seededAtText = formatSeededAt(status?.seededAt);

  const busy = seeding || cleaning;

  return (
    <div className="mt-5">
      <div className="bg-white border border-gray-200 rounded-xl shadow-3xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
              <Database size={18} className="text-indigo-600" />
              {lang === 'zh' ? '演示数据（Demo）' : 'Demo Data'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {lang === 'zh'
                ? '一键生成一套完整的演示课程 / 班级 / 学生 / 课表，便于快速体验与验收；清理时不影响系统本身的数据。'
                : 'One-click generation of a full demo lesson / class / student / schedule set for quick evaluation. Purging never touches real data.'}
            </p>
          </div>
          <button
            type="button"
            onClick={fetchDemoDataStatus}
            disabled={statusLoading || busy}
            title={lang === 'zh' ? '刷新状态' : 'Refresh status'}
            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer disabled:opacity-50 shrink-0"
          >
            {statusLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-5 text-left">
          {/* 状态展示 */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                  hasDemoData
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                    : 'bg-gray-50 text-gray-500 border-gray-200'
                }`}
              >
                {hasDemoData ? <CheckCircle2 size={13} /> : <Database size={13} />}
                {hasDemoData
                  ? lang === 'zh'
                    ? '已播种演示数据'
                    : 'Demo data seeded'
                  : lang === 'zh'
                    ? '尚未播种演示数据'
                    : 'No demo data yet'}
              </span>

              {seededAtText && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200">
                  <Clock size={13} />
                  {lang === 'zh' ? `播种时间：${seededAtText}` : `Seeded at ${seededAtText}`}
                </span>
              )}

              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-50 text-gray-500 border border-gray-200">
                {lang === 'zh' ? `合计 ${status?.total ?? 0} 条` : `${status?.total ?? 0} records total`}
              </span>
            </div>

            {status?.counts && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {COUNT_FIELDS.map((field) => (
                  <div
                    key={field.key}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-gray-200 bg-gray-50/60"
                  >
                    <span className="text-xs text-gray-500">
                      {lang === 'zh' ? field.zh : field.en}
                    </span>
                    <span className="text-xs font-bold text-gray-700 font-mono">
                      {status.counts[field.key] ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 演示教师账号 */}
          {status?.credentials && (
            <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                <KeyRound size={13} />
                {lang === 'zh' ? '演示教师账号（可用于登录体验）' : 'Demo teacher account (for sign-in testing)'}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-amber-800">
                <span>
                  {lang === 'zh' ? '姓名' : 'Name'}:{' '}
                  <span className="font-semibold">{status.credentials.name}</span>
                </span>
                <span>
                  {lang === 'zh' ? '用户名' : 'Username'}:{' '}
                  <span className="font-mono font-bold">{status.credentials.username}</span>
                </span>
                <span>
                  {lang === 'zh' ? '密码' : 'Password'}:{' '}
                  <span className="font-mono font-bold">{status.credentials.password}</span>
                </span>
              </div>
            </div>
          )}

          {/* 结果反馈 */}
          {feedback && (
            <div
              className={`flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  : 'bg-rose-50 text-rose-700 border-rose-100'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 size={14} className="shrink-0 mt-px" />
              ) : (
                <AlertTriangle size={14} className="shrink-0 mt-px" />
              )}
              <span className="whitespace-pre-line">{feedback.text}</span>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={handleSeed}
              disabled={busy}
              className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
            >
              {seeding ? <Loader2 size={13} className="animate-spin" /> : hasDemoData ? <RefreshCw size={14} /> : <Sparkles size={14} />}
              <span>
                {seeding
                  ? lang === 'zh'
                    ? '处理中...'
                    : 'Working...'
                  : hasDemoData
                    ? lang === 'zh'
                      ? '重置并重新初始化'
                      : 'Reset & Re-seed Demo Data'
                    : lang === 'zh'
                      ? '一键初始化演示数据'
                      : 'Seed Demo Data'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleCleanup}
              disabled={busy || !hasDemoData}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
            >
              {cleaning ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={14} />}
              <span>
                {cleaning
                  ? lang === 'zh'
                    ? '清理中...'
                    : 'Purging...'
                  : lang === 'zh'
                    ? '一键清理演示数据'
                    : 'Purge Demo Data'}
              </span>
            </button>

            {!hasDemoData && (
              <span className="text-xs text-gray-400">
                {lang === 'zh' ? '清理前需先初始化演示数据。' : 'Seed demo data before purging.'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DemoDataPanel;
