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
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchActivities,
  startActivity,
  type ActivityProviderDescriptor,
  type ActivityRole,
} from './activity-service.js';

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
}

export const ActivityWorkspaceWidget: React.FC<ActivityWorkspaceWidgetProps> = ({
  role,
  actorId,
  lang = 'en',
  classroomId,
}) => {
  const [activities, setActivities] = useState<ActivityProviderDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => {
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
  }, [role]);

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

  const handleLaunch = async (activity: ActivityProviderDescriptor) => {
    setStatus((s) => ({ ...s, [activity.id]: lang === 'zh' ? '启动中…' : 'Starting…' }));
    try {
      const res = await startActivity(
        activity.id,
        { classroomId, role },
        actorId,
      );
      setStatus((s) => ({
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
      setStatus((s) => ({
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
                  {status[a.id] && (
                    <span style={{ fontSize: 11, opacity: 0.85 }}>{status[a.id]}</span>
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
