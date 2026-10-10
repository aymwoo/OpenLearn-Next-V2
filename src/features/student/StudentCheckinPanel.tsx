import { useEffect, useState } from 'react';

export interface StudentCheckinPanelProps {
  lessonId: string | null;
  lang: 'zh' | 'en';
  addToast: (title: string, description: string, type: string) => void;
}

type CheckinStatus = 'idle' | 'submitting' | 'done' | 'error';

/**
 * 学生课堂签到码输入条（P1-3 签到闭环的前端入口）。
 *
 * 教师大屏展示 4 位 `checkin_code`，学生在此输入后 POST
 * `/api/classroom/sessions/:lessonId/checkin` 核销并直写考勤。
 * 成功/失败均给明确状态，避免“码形同虚设、无处可输”。
 */
export function StudentCheckinPanel({ lessonId, lang, addToast }: StudentCheckinPanelProps) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<CheckinStatus>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setCode('');
    setStatus('idle');
    setMessage('');
  }, [lessonId]);

  if (!lessonId) return null;

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setStatus('error');
      setMessage(lang === 'zh' ? '请先输入签到码' : 'Enter the check-in code first');
      return;
    }
    setStatus('submitting');
    setMessage('');
    try {
      const res = await fetch(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setStatus('error');
        const msg =
          data.error === 'Invalid checkin code'
            ? lang === 'zh'
              ? '签到码不正确，请核对大屏后重试'
              : 'Wrong code, check the stage display and retry'
            : data.error || (lang === 'zh' ? '签到失败，请稍后重试' : 'Check-in failed, retry later');
        setMessage(msg);
        return;
      }
      setStatus('done');
      setMessage(lang === 'zh' ? '签到成功，出勤已记录' : 'Checked in, attendance recorded');
      addToast(lang === 'zh' ? '签到成功' : 'Checked in', lang === 'zh' ? '出勤已记录' : 'Attendance recorded', 'success');
    } catch {
      setStatus('error');
      setMessage(lang === 'zh' ? '网络异常，请稍后重试' : 'Network error, retry later');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 bg-surface border border-theme rounded-xl px-3 py-2 shadow-sm text-main">
      <span className="text-xs font-bold">{lang === 'zh' ? '课堂签到' : 'Check-in'}</span>
      {status === 'done' ? (
        <span className="text-xs font-bold text-emerald-600">✓ {message}</span>
      ) : (
        <>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\s/g, '').slice(0, 12))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder={lang === 'zh' ? '输入大屏 4 位签到码' : '4-digit code on stage display'}
            inputMode="numeric"
            aria-label={lang === 'zh' ? '课堂签到码' : 'Class check-in code'}
            className="w-44 px-2 py-1 text-sm font-mono tracking-widest border border-theme rounded-lg bg-transparent"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={status === 'submitting'}
            className="px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
          >
            {status === 'submitting' ? (lang === 'zh' ? '提交中…' : 'Submitting…') : lang === 'zh' ? '签到' : 'Check in'}
          </button>
        </>
      )}
      {status === 'error' && message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
