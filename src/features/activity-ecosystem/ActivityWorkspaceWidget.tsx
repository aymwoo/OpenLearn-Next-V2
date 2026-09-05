/**
 * OpenLearn Activity Ecosystem — Workspace Widget (Sprint P7-01)
 *
 * A single, role-aware widget that renders the registered Activity Providers
 * inside the Workspace Shell. Teacher and Student use DIFFERENT layouts but the
 * SAME implementation — the only difference is driven by `role`:
 *   - teacher → launcher (starts activities, drives the classroom)
 *   - student → participant (opens / joins activities)
 *
 * It reads the SAME registry the host and plugins share (no duplicated list),
 * and starts activities through the existing classroom command/event pipeline.
 *
 * Two render modes (selected by the `mode` prop):
 *   - 'launcher' (default, used by the student workspace): the catalogue of
 *     activities the actor can start / join. Kept on the dark surface.
 *   - 'status'   (used by the teacher dashboard "Activity Center"): a LIGHT,
 *     dashboard-aligned monitor of activities currently in progress. It polls
 *     the server and hides itself entirely when nothing is running. Clicking a
 *     running activity opens a management popover (e.g. to end it).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  HelpCircle,
  Vote,
  BarChart3,
  MessagesSquare,
  Users,
  FileText,
  Trophy,
  CheckCircle2,
  BookOpen,
  Puzzle,
  X,
  Clock,
  Pause,
  Play,
} from 'lucide-react';
import {
  fetchActivities,
  startActivity,
  fetchRunningActivities,
  finishActivity,
  pauseActivity,
  resumeActivity,
  type ActivityProviderDescriptor,
  type ActivityRole,
  type RunningActivity,
} from './activity-service.js';
import { useAppStore } from '../../store/appStore';

const panelBase: React.CSSProperties = {
  padding: '12px',
  color: '#e2e8f0',
  fontSize: '13px',
};

export interface ActivityWorkspaceWidgetProps {
  /** Drives the layout: teacher = launcher, student = participant. */
  role: 'teacher' | 'student';
  /** Actor id used for permission isolation on start. */
  actorId?: string;
  lang?: 'en' | 'zh';
  classroomId?: string;
  /**
   * 'launcher' (default) shows the start/join catalogue. 'status' shows the
   * live "in progress" monitor used on the teacher dashboard.
   */
  mode?: 'launcher' | 'status';
}

/** Small map from the descriptor `icon` string to a lucide component. */
const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  HelpCircle,
  Vote,
  BarChart3,
  MessagesSquare,
  Users,
  FileText,
  Trophy,
  CheckCircle2,
  BookOpen,
};

function ActivityIcon({ name, className }: { name?: string; className?: string }) {
  const Cmp = (name && ICONS[name]) || Puzzle;
  return <Cmp size={18} className={className} />;
}

/** Human-readable elapsed time since `startedAt`. */
function formatElapsed(startedAt: number | null, lang: string): string {
  if (!startedAt) return lang === 'zh' ? '进行中' : 'In progress';
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return lang === 'zh' ? `${m} 分 ${s} 秒` : `${m}m ${s}s`;
}

export const ActivityWorkspaceWidget: React.FC<ActivityWorkspaceWidgetProps> = ({
  role,
  actorId,
  lang = 'en',
  classroomId,
  mode = 'launcher',
}) => {
  // ── launcher-mode state (teacher/student start-or-join catalogue) ──
  const [activities, setActivities] = useState<ActivityProviderDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launcherStatus, setLauncherStatus] = useState<Record<string, string>>({});

  // ── status-mode state (dashboard "in progress" monitor) ──
  const [running, setRunning] = useState<RunningActivity[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const setTeacherTab = useAppStore((s) => s.setTeacherTab);

  // Group by category for a cleaner catalogue (same data, different layout).
  const byCategory = useMemo(() => {
    const groups = new Map<string, ActivityProviderDescriptor[]>();
    for (const a of activities) {
      const key = a.category;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    }
    return Array.from(groups.entries());
  }, [activities]);

  // Launcher effect: load the catalogue of startable activities.
  useEffect(() => {
    if (mode !== 'launcher') return;
    let cancelled = false;
    setLoading(true);
    fetchActivities(role as ActivityRole)
      .then((list) => {
        if (!cancelled) setActivities(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role, mode]);

  // Status effect: poll the live "running" list every 5s (matches db-status cadence).
  useEffect(() => {
    if (mode !== 'status') return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = await fetchRunningActivities();
        if (!cancelled) setRunning(list);
      } catch (e: unknown) {
        if (!cancelled) setStatusError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode]);

  const runAction = async (action: (id: string) => Promise<void>) => {
    if (!manageId) return;
    setActionBusy(true);
    setFinishError(null);
    try {
      await action(manageId);
      // Refresh the live list so the card + popover reflect the new state.
      setRunning(await fetchRunningActivities());
    } catch (e: unknown) {
      setFinishError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const handleFinish = () => runAction(finishActivity);
  const handlePause = () => runAction(pauseActivity);
  const handleResume = () => runAction(resumeActivity);
  const handleEnterClassroom = () => {
    setManageId(null);
    setTeacherTab('live_class');
  };

  // ── status (dashboard) mode ────────────────────────────────────────────────
  if (mode === 'status') {
    // Brief skeleton only while the first load is in flight — never perpetual.
    if (statusLoading) {
      return (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm h-24 animate-pulse" />
      );
    }
    // No running activities (or a transient error) → hide the card entirely.
    if (statusError || running.length === 0) return null;

    const managed = running.find((r) => r.id === manageId) || null;

    return (
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-slate-800 font-extrabold">
            <span>🧩</span>
            <span>{lang === 'zh' ? '进行中的活动' : 'Activities in Progress'}</span>
          </div>
          <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
            {running.length}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {running.map((a) => {
            const isRunning = a.state === 'running';
            return (
              <button
                key={a.id}
                onClick={() => setManageId(a.id)}
                className="w-full flex items-center gap-3 text-left bg-slate-50 hover:bg-slate-100 border border-slate-200/70 rounded-xl p-3 transition-colors"
              >
                <ActivityIcon name={a.icon} className="text-indigo-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-slate-800 truncate">{a.name}</div>
                  {a.category && (
                    <div className="text-[11px] text-slate-500 truncate">{a.category}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isRunning
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {isRunning
                      ? lang === 'zh'
                        ? '进行中'
                        : 'Running'
                      : lang === 'zh'
                        ? '已暂停'
                        : 'Paused'}
                  </span>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Clock size={10} /> {formatElapsed(a.startedAt, lang)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {managed && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
            onClick={() => setManageId(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-800">{managed.name}</h3>
                <button
                  onClick={() => setManageId(null)}
                  className="text-slate-400 hover:text-slate-600"
                  aria-label="close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="text-sm text-slate-500 mb-1">
                {lang === 'zh' ? '状态' : 'Status'}:{' '}
                {managed.state === 'running'
                  ? lang === 'zh'
                    ? '进行中'
                    : 'Running'
                  : lang === 'zh'
                    ? '已暂停'
                    : 'Paused'}
              </div>
              <div className="text-sm text-slate-500 mb-4">
                {lang === 'zh' ? '开始时间' : 'Started'}:{' '}
                {managed.startedAt ? new Date(managed.startedAt).toLocaleString() : '-'}
              </div>
              {finishError && <div className="text-xs text-rose-600 mb-2">{finishError}</div>}
              <div className="flex gap-2">
                {managed.state === 'running' ? (
                  <button
                    disabled={actionBusy}
                    onClick={handlePause}
                    className="flex-1 flex items-center justify-center gap-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-bold"
                  >
                    <Pause size={14} /> {lang === 'zh' ? '暂停' : 'Pause'}
                  </button>
                ) : (
                  <button
                    disabled={actionBusy}
                    onClick={handleResume}
                    className="flex-1 flex items-center justify-center gap-1 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-bold"
                  >
                    <Play size={14} /> {lang === 'zh' ? '恢复' : 'Resume'}
                  </button>
                )}
                <button
                  disabled={actionBusy}
                  onClick={handleFinish}
                  className="flex-1 flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-bold"
                >
                  {actionBusy
                    ? lang === 'zh'
                      ? '处理中…'
                      : 'Working…'
                    : lang === 'zh'
                      ? '结束'
                      : 'End'}
                </button>
              </div>
              <button
                onClick={handleEnterClassroom}
                className="w-full mt-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg py-2 text-sm font-bold"
              >
                {lang === 'zh' ? '进入课堂' : 'Enter Classroom'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── launcher mode (student workspace / default) ─────────────────────────────
  // (The data-loading effect for launcher mode is the guarded one near the top;
  // it runs only when `mode === 'launcher'`.)

  const handleLaunch = async (activity: ActivityProviderDescriptor) => {
    setLauncherStatus((s) => ({ ...s, [activity.id]: lang === 'zh' ? '启动中…' : 'Starting…' }));
    try {
      const res = await startActivity(
        activity.id,
        { classroomId, role },
        actorId,
      );
      setLauncherStatus((s) => ({
        ...s,
        [activity.id]: res.dispatched
          ? lang === 'zh'
            ? '已启动 ✓'
            : 'Started ✓'
          : lang === 'zh'
            ? '已通知 ✓'
            : 'Notified ✓',
      }));
    } catch (e: unknown) {
      setLauncherStatus((s) => ({
        ...s,
        [activity.id]: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  if (loading) {
    return <div style={panelBase}>{lang === 'zh' ? '加载活动中…' : 'Loading activities…'}</div>;
  }
  if (error) {
    return (
      <div style={panelBase}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          🧩 {lang === 'zh' ? '活动中心' : 'Activity Center'}
        </div>
        <div style={{ opacity: 0.7 }}>{error}</div>
      </div>
    );
  }

  const title = role === 'teacher' ? (lang === 'zh' ? '活动中心（教师）' : 'Activity Center') : lang === 'zh' ? '活动（学生）' : 'Activities';

  if (activities.length === 0) {
    return (
      <div style={panelBase}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>🧩 {title}</div>
        <div style={{ opacity: 0.7 }}>
          {lang === 'zh' ? '暂无可用活动。' : 'No activities available.'}
        </div>
      </div>
    );
  }

  return (
    <div style={panelBase}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>🧩 {title}</div>
      {byCategory.map(([category, items]) => (
        <div key={category} style={{ marginBottom: 10 }}>
          <div style={{ opacity: 0.6, fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>
            {category}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {items.map((a) => (
              <div
                key={a.id}
                style={{
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: '8px 10px',
                  minWidth: 150,
                  background: '#0f172a',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {a.icon ? `${a.icon} ` : '▫️ '}
                  {a.name}
                </div>
                {a.description && (
                  <div style={{ opacity: 0.7, fontSize: 11, margin: '2px 0 6px' }}>
                    {a.description}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => handleLaunch(a)}
                    style={{
                      cursor: 'pointer',
                      background: role === 'teacher' ? '#2563eb' : '#0ea5e9',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 12,
                    }}
                  >
                    {role === 'teacher'
                      ? lang === 'zh'
                        ? '启动'
                        : 'Start'
                      : lang === 'zh'
                        ? '参与'
                        : 'Open'}
                  </button>
                  {launcherStatus[a.id] && (
                    <span style={{ fontSize: 11, opacity: 0.85 }}>{launcherStatus[a.id]}</span>
                  )}
                </div>
                <div style={{ opacity: 0.5, fontSize: 10, marginTop: 4 }}>
                  {a.provider === 'official' ? 'official' : a.provider}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
