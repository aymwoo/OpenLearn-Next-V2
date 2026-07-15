/**
 * StudentTool — 学生端课件卡片列表
 *
 * 展示已发布的课件，每张卡片含标题、状态、得分、操作按钮
 */
import React, { useState, useEffect, useCallback } from 'react';
import type { FrontendCtx } from './types';

interface CoursewareItem {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  stats: { submissions: number };
}

interface StudentScore {
  courseware_id: string;
  score: number;
  total: number;
  submitted_at: string;
}

interface Props {
  ctx: FrontendCtx;
  studentId?: string;
  onOpenFullscreen: (coursewareId: string) => void;
}

const COURSEWARE_ICONS = ['🧬', '📐', '⚡', '📖', '🔬', '🌍', '📊', '🎯', '🧮', '💻'];

export default function StudentTool({ ctx, studentId, onOpenFullscreen }: Props) {
  const [coursewares, setCoursewares] = useState<CoursewareItem[]>([]);
  const [scores, setScores] = useState<Map<string, StudentScore>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cwRes] = await Promise.all([
        ctx.invokeCommand('courseware.query', { status: 'published', limit: 100 }),
      ]);

      const items = cwRes.items || [];
      setCoursewares(items);

      // 加载已有成绩
      if (studentId) {
        const scoreMap = new Map<string, StudentScore>();
        await Promise.all(items.map(async (cw: CoursewareItem) => {
          try {
            const sRes = await ctx.invokeCommand('courseware.query_scores', {
              courseware_id: cw.id,
              student_id: studentId,
            });
            if (sRes.items?.length > 0) {
              scoreMap.set(cw.id, sRes.items[0]);
            }
          } catch (_) {
            // 忽略单个查询失败
          }
        }));
        setScores(scoreMap);
      }
    } catch (e) {
      console.error('StudentTool loadData failed', e);
    } finally {
      setLoading(false);
    }
  }, [ctx, studentId]);

  useEffect(() => { loadData(); }, [loadData]);

  const getStatus = (cw: CoursewareItem) => {
    const s = scores.get(cw.id);
    if (s) return { label: '✅ 已完成', action: '查看详情', color: '#22c55e', bg: '#f0fdf4' };
    return { label: '📋 未开始', action: '开始学习', color: '#3b82f6', bg: '#eff6ff' };
  };

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>加载课件列表...</div>;
  }

  if (coursewares.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📚</div>
        <div style={{ fontSize: 14 }}>暂无可用课件</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>等待教师发布课件</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: '0 0 16px' }}>📚 我的课件</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {coursewares.map((cw, i) => {
          const st = getStatus(cw);
          const rowScore = scores.get(cw.id);
          return (
            <div
              key={cw.id}
              style={{
                background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb',
                padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
                transition: 'box-shadow 0.15s', cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 28 }}>{COURSEWARE_ICONS[i % COURSEWARE_ICONS.length]}</span>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: st.bg, color: st.color, fontWeight: 500,
                }}>
                  {st.label}
                </span>
              </div>

              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{cw.title}</div>
                {cw.description && <div style={{ fontSize: 11, color: '#94a3b8' }}>{cw.description.slice(0, 60)}</div>}
              </div>

              {rowScore && (
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  得分: <strong>{rowScore.score}/{rowScore.total}</strong>
                  &nbsp;({(rowScore.score / rowScore.total * 100).toFixed(0)}%)
                </div>
              )}

              <button
                onClick={() => onOpenFullscreen(cw.id)}
                style={{
                  width: '100%', padding: '8px 0', border: 'none', borderRadius: 6,
                  background: st.color, color: '#fff', fontSize: 13, cursor: 'pointer',
                  fontWeight: 500, marginTop: 'auto',
                }}
              >
                {st.action}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
