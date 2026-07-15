/**
 * ScoreOverlay — 成绩摘要覆盖层
 */
import React from 'react';

interface Props {
  score: number;
  total: number;
  timeSpent: number;
  onBack: () => void;
  onRetry: () => void;
}

export default function ScoreOverlay({ score, total, timeSpent, onBack, onRetry }: Props) {
  const rate = total > 0 ? (score / total * 100) : 0;
  const minutes = Math.floor(timeSpent / 60);
  const seconds = timeSpent % 60;

  // 根据正确率选颜色
  const accentColor = rate >= 90 ? '#22c55e' : rate >= 70 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100,
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '36px 48px',
        textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        maxWidth: 400,
      }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>{rate >= 90 ? '🎉' : rate >= 70 ? '👍' : '📚'}</div>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, color: '#1e293b' }}>课件完成</h2>

        <div style={{
          margin: '20px 0', display: 'flex', flexDirection: 'column', gap: 8,
          background: '#f8fafc', borderRadius: 12, padding: '20px',
        }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: accentColor }}>
            {score}<span style={{ fontSize: 18, fontWeight: 400, color: '#94a3b8' }}> / {total}</span>
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            正确率 {rate.toFixed(0)}%
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            用时 {minutes} 分 {seconds} 秒
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button
            onClick={onBack}
            style={{
              padding: '8px 20px', border: '1px solid #d1d5db', borderRadius: 8,
              background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer',
            }}
          >
            返回列表
          </button>
          <button
            onClick={onRetry}
            style={{
              padding: '8px 20px', border: 'none', borderRadius: 8,
              background: '#3b82f6', color: '#fff', fontSize: 13, cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            再试一次
          </button>
        </div>
      </div>
    </div>
  );
}
