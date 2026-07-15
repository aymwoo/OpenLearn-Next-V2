/**
 * StudentFullscreen — 学生端课件全屏渲染 v0.2.0
 *
 * 新增：
 *   - 学习心跳（每 30 秒向服务端上报）
 *   - beforeunload 关闭前兜底通知
 *   - submittedRef 防止闭包陷阱
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { FrontendCtx } from './types';
import ScoreOverlay from './ScoreOverlay';

interface Props {
  ctx: FrontendCtx;
  coursewareId: string;
  studentId: string;
  studentName: string;
  onBack: () => void;
}

interface ScorePayload {
  score: number;
  total: number;
  detail?: any;
}

export default function StudentFullscreen({ ctx, coursewareId, studentId, studentName, onBack }: Props) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [scoreResult, setScoreResult] = useState<ScorePayload | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [startTime] = useState(Date.now());
  const [errorMsg, setErrorMsg] = useState('');
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittedRef = useRef(false);
  submittedRef.current = submitted;

  // 加载课件 HTML
  useEffect(() => {
    setLoading(true);
    ctx.invokeCommand('courseware.get_html', { id: coursewareId }).then(res => {
      if (res.error) { setErrorMsg(`课件加载失败: ${res.error}`); }
      else { setHtml(res.html || ''); }
      setLoading(false);
    }).catch(e => {
      setErrorMsg(`课件加载失败: ${e.message}`);
      setLoading(false);
    });
  }, [ctx, coursewareId]);

  // 自动隐藏顶栏
  const resetHideTimer = useCallback(() => {
    setHeaderVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHeaderVisible(false), 3000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [resetHideTimer]);

  // 心跳 — 每 30 秒上报
  useEffect(() => {
    heartbeatRef.current = setInterval(() => {
      ctx.invokeCommand('courseware.heartbeat', {
        courseware_id: coursewareId,
        student_id: studentId,
        progress_data: { elapsed: Math.floor((Date.now() - startTime) / 1000) },
      }).catch(() => {});
    }, 30000);
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [ctx, coursewareId, studentId]);

  // beforeunload 兜底
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!submittedRef.current) {
        ctx.invokeCommand('courseware.heartbeat', {
          courseware_id: coursewareId,
          student_id: studentId,
          progress_data: { closing: true, elapsed: Math.floor((Date.now() - startTime) / 1000) },
        }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [ctx, coursewareId, studentId]);

  // 监听 postMessage
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;
      if (data.source !== 'openlearn-cw-sdk' && data.source !== 'ai_injected') return;

      switch (data.type) {
        case 'courseware:score':
          if (submittedRef.current) break;
          {
            const { score, total, detail } = data.payload || {};
            if (typeof score === 'number' && total > 0) {
              setScoreResult({ score, total, detail });
              await submitScore(score, total, detail, data.source);
            }
          }
          break;
        case 'courseware:complete':
          if (!submittedRef.current) {
            setScoreResult({ score: 0, total: 0 });
          }
          break;
        case 'courseware:heartbeat':
          // SDK 心跳已由前端心跳覆盖，这里仅确认连通
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [coursewareId, studentId, studentName, ctx]);

  const submitScore = async (score: number, total: number, detail?: any, source?: string) => {
    if (submittedRef.current) return;
    setSubmitted(true);
    submittedRef.current = true;
    try {
      await ctx.invokeCommand('courseware.submit_score', {
        courseware_id: coursewareId,
        student_id: studentId,
        student_name: studentName,
        score, total, detail,
        submit_source: source || 'sdk',
        time_spent: Math.floor((Date.now() - startTime) / 1000),
      });
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    } catch (e: any) {
      console.error('submitScore failed', e);
    }
  };

  const handleManualConfirm = async () => {
    if (!scoreResult) return;
    await submitScore(scoreResult.score, scoreResult.total);
  };

  const handleManualEntry = async (score: number, total: number) => {
    setScoreResult({ score, total });
    await submitScore(score, total, undefined, 'manual_entry');
  };

  if (loading) {
    return (
      <div style={fullscreenCenter}>
        <div style={{ fontSize: 18, color: '#64748b', marginBottom: 8 }}>📖</div>
        <div style={{ fontSize: 14, color: '#94a3b8' }}>课件加载中...</div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div style={fullscreenCenter}>
        <div style={{ fontSize: 14, color: '#ef4444', marginBottom: 12 }}>{errorMsg}</div>
        <button onClick={onBack} style={backBtnStyle}>返回课件列表</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#fff', zIndex: 500 }}>
      <div
        onMouseEnter={() => setHeaderVisible(true)}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
          borderBottom: '1px solid #e5e7eb', padding: '8px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          opacity: headerVisible ? 1 : 0, transition: 'opacity 0.3s ease',
          pointerEvents: headerVisible ? 'auto' : 'none',
        }}
      >
        <button onClick={onBack} style={{ ...backBtnStyle, fontSize: 13 }}>← 返回列表</button>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>课件学习</span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          已用 {Math.floor((Date.now() - startTime) / 60000)} 分钟
        </span>
      </div>

      {scoreResult && !submitted && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
          background: '#fef3c7', padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, color: '#92400e' }}>
            检测到成绩：{scoreResult.score}/{scoreResult.total || '?'}
          </span>
          <button onClick={handleManualConfirm} style={{ ...primaryBtnStyle, padding: '4px 12px', fontSize: 12 }}>确认提交</button>
        </div>
      )}

      {html && (
        <iframe
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          title="课件内容"
          onMouseMove={resetHideTimer}
        />
      )}

      {submitted && scoreResult && (
        <ScoreOverlay
          score={scoreResult.score}
          total={scoreResult.total || scoreResult.score}
          timeSpent={Math.floor((Date.now() - startTime) / 1000)}
          onBack={onBack}
          onRetry={() => {
            setSubmitted(false); submittedRef.current = false;
            setScoreResult(null);
          }}
        />
      )}

      {scoreResult && scoreResult.total === 0 && scoreResult.score === 0 && !submitted && (
        <ManualEntryOverlay onConfirm={handleManualEntry} onBack={onBack} />
      )}
    </div>
  );
}

function ManualEntryOverlay({ onConfirm, onBack }: { onConfirm: (s: number, t: number) => void; onBack: () => void }) {
  const [score, setScore] = useState('');
  const [total, setTotal] = useState('100');
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '32px 40px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', maxWidth: 360 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
        <h3 style={{ margin: '0 0 4px', fontSize: 18, color: '#1e293b' }}>课件已完成</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>课件未自动提交成绩，请在课件中查看得分后手动填入：</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>得分</label>
            <input type="number" value={score} onChange={e => setScore(e.target.value)} style={{ width: 100, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, textAlign: 'center' }} placeholder="0" />
          </div>
          <span style={{ fontSize: 18, color: '#94a3b8', marginTop: 16 }}>/</span>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>总分</label>
            <input type="number" value={total} onChange={e => setTotal(e.target.value)} style={{ width: 100, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, textAlign: 'center' }} placeholder="100" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={onBack} style={{ ...primaryBtnStyle, background: '#e5e7eb', color: '#374151' }}>返回列表</button>
          <button onClick={() => onConfirm(Number(score) || 0, Number(total) || 100)} disabled={!score} style={{ ...primaryBtnStyle, opacity: !score ? 0.5 : 1 }}>确认提交</button>
        </div>
      </div>
    </div>
  );
}

const fullscreenCenter: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  height: '100vh', background: '#f8fafc',
};
const backBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: 0,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 16px', border: 'none', borderRadius: 6, background: '#3b82f6', color: '#fff',
  fontSize: 13, cursor: 'pointer', fontWeight: 500,
};
