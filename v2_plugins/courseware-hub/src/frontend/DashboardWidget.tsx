/**
 * DashboardWidget — 教师仪表盘统计卡片
 */
import React, { useState, useEffect } from 'react';
import type { FrontendCtx } from './types';

interface DashboardStats {
  total_coursewares: number;
  published_coursewares: number;
  total_submissions: number;
  avg_score: number;
}

interface Props {
  ctx: FrontendCtx;
}

export default function DashboardWidget({ ctx }: Props) {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    ctx.invokeCommand('courseware.dashboard_stats').then(setStats).catch(console.error);
  }, [ctx]);

  if (!stats) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: 20 }}>加载中...</div>
      </div>
    );
  }

  const items: [string, string, string][] = [
    ['课件总数', String(stats.total_coursewares), '📚'],
    ['已发布', String(stats.published_coursewares), '📢'],
    ['成绩提交', String(stats.total_submissions), '📝'],
    ['均分', String(stats.avg_score || '-'), '📊'],
  ];

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>📊</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>课件中心</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {items.map(([label, value, icon]) => (
          <div key={label} style={{ textAlign: 'center', background: '#f8fafc', borderRadius: 6, padding: '8px 4px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{icon} {label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: 14,
};
