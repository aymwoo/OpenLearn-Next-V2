import { useEffect, useState, type FormEvent } from 'react';
import { Clock3, Loader2, Check } from 'lucide-react';

const MIN_HOURS = 3;
const MAX_HOURS = 30 * 24;
const DEFAULT_HOURS = 24;

function msToHours(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_HOURS;
  return Math.round(ms / (60 * 60 * 1000));
}

function hoursToMs(hours: number): number {
  return Math.round(hours * 60 * 60 * 1000);
}

export function ClassroomSessionLifecycleSettingsPanel({ lang }: { lang: 'zh' | 'en' }) {
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/classroom/session-lifecycle-settings', { credentials: 'same-origin' })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { autoArchiveAfterMs?: number; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || (lang === 'zh' ? '无法加载课次归档设置' : 'Failed to load session archive settings'));
          return;
        }
        if (typeof data.autoArchiveAfterMs === 'number') {
          setHours(msToHours(data.autoArchiveAfterMs));
        }
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/classroom/session-lifecycle-settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoArchiveAfterMs: hoursToMs(Number(hours)) }),
      });
      const data = (await res.json().catch(() => ({}))) as { autoArchiveAfterMs?: number; error?: string };
      if (!res.ok) {
        throw new Error(data.error || (lang === 'zh' ? '保存失败' : 'Save failed'));
      }
      if (typeof data.autoArchiveAfterMs === 'number') {
        setHours(msToHours(data.autoArchiveAfterMs));
      }
      setSuccess(lang === 'zh' ? '课次自动归档阈值已保存' : 'Auto-archive threshold saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-3xs overflow-hidden max-w-3xl mt-5"
      data-testid="session-lifecycle-settings-panel"
    >
      <div className="p-4 sm:p-5 border-b border-gray-100 bg-gray-50/60">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
          <Clock3 size={18} className="text-indigo-600" />
          {lang === 'zh' ? '课次自动归档阈值' : 'Session auto-archive threshold'}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {lang === 'zh'
            ? '长期无教师活动的僵尸课次会自动归档。默认 24 小时，最短 3 小时，最长 30 天。归档后学生端不再提示未结束，实时录成绩仍只认课中授课阶段。'
            : 'Idle zombie sessions are archived automatically. Default 24 hours, minimum 3 hours, maximum 30 days. After archiving, students no longer see the unfinished prompt, and live score recording still only uses in-class sessions.'}
        </p>
      </div>
      <form onSubmit={save} className="p-5 space-y-4 text-left">
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
          {lang === 'zh' ? '无教师活动后自动归档（小时）' : 'Auto-archive after inactivity (hours)'}
          <input
            type="number"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step={1}
            value={hours}
            disabled={!loaded || saving}
            onChange={(event) => setHours(Number(event.target.value))}
            className="mt-1 w-full text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
            data-testid="auto-archive-hours-input"
          />
        </label>
        <p className="text-xs text-gray-400">
          {lang === 'zh'
            ? `当前约 ${hours} 小时（${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)} 天）。教师仍可对个别课次设置豁免。`
            : `Currently about ${hours} hours (${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)} days). Teachers can still exempt individual sessions.`}
        </p>
        {error && (
          <p className="text-sm text-rose-600" role="alert">
            {error}
          </p>
        )}
        {success && <p className="text-sm text-emerald-700">{success}</p>}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!loaded || saving}
            className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            {lang === 'zh' ? '保存归档阈值' : 'Save archive threshold'}
          </button>
        </div>
      </form>
    </div>
  );
}
