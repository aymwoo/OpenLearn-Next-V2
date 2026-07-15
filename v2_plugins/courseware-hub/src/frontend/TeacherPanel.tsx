/**
 * TeacherPanel — 教师端课件管理主面板 v0.2.0
 *
 * 新增：
 *   - 版本管理：查看历史版本、切换版本
 *   - 元素高亮检查模式：预览 Tab 中悬停高亮 + 复制 CSS 选择器
 *   - 安全警告提示
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { FrontendCtx } from './types';

interface Courseware {
  id: string; courseware_key: string; version: number;
  title: string; description: string;
  extraction_config: { mode: string; ai_analysis?: any; security_warnings?: string[] };
  security_warnings: string[];
  pass_score: number; target_classes: string[]; status: string;
  created_at: string;
  stats: { submissions: number; avg_score: number };
}

interface VersionItem {
  id: string; version: number; title: string; status: string; created_at: string;
}

interface CoursewareDetail extends Courseware {
  stats: { submissions: number; avg_score: number; max_score: number; min_score: number; pass_rate: number };
}

interface ScoreItem {
  id: string; student_id: string; student_name: string;
  score: number; total: number; submit_source: string;
  time_spent: number; submitted_at: string;
}

interface Props { ctx: FrontendCtx; }

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '未发布', color: '#9ca3af' },
  published: { label: '已发布', color: '#22c55e' },
  archived: { label: '已归档', color: '#6b7280' },
};
const MODE_LABELS: Record<string, string> = {
  sdk: 'SDK 协议', ai_injected: 'AI 自动检测', manual_selector: 'CSS 选择器',
  manual_js_var: 'JS 变量', manual_entry: '学生手动录入',
};

export default function TeacherPanel({ ctx }: Props) {
  const [coursewares, setCoursewares] = useState<Courseware[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CoursewareDetail | null>(null);
  const [scores, setScores] = useState<ScoreItem[]>([]);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [tab, setTab] = useState<'preview' | 'scores' | 'settings'>('preview');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ctx.invokeCommand('courseware.query', {
        search: search || undefined,
        status: statusFilter || undefined,
        limit: 100,
      });
      setCoursewares(res.items || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [ctx, search, statusFilter]);

  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const [detailRes, scoresRes] = await Promise.all([
        ctx.invokeCommand('courseware.get_detail', { id }),
        ctx.invokeCommand('courseware.query_scores', { courseware_id: id }),
      ]);
      setDetail(detailRes);
      setScores(scoresRes.items || []);

      const verRes = await ctx.invokeCommand('courseware.query_versions', {
        courseware_key: detailRes.courseware_key,
      });
      setVersions(verRes.items || []);
    } catch (e) { console.error(e); }
  }, [ctx]);

  useEffect(() => {
    if (selectedId) { loadDetail(selectedId); }
    else { setDetail(null); setScores([]); setVersions([]); }
  }, [selectedId, loadDetail]);

  const handlePublish = async (id: string, status: string) => {
    await ctx.invokeCommand('courseware.publish', { id, status });
    loadList();
    if (selectedId === id) loadDetail(id);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除此课件？所有版本、成绩和文件将被清除。')) return;
    await ctx.invokeCommand('courseware.delete', { id });
    setSelectedId(null);
    loadList();
  };

  const handleExtractionUpdate = async (id: string, config: any) => {
    await ctx.invokeCommand('courseware.update_extraction', { id, extraction_config: config });
    if (selectedId === id) loadDetail(id);
  };

  const exportCSV = () => {
    if (scores.length === 0) return;
    const header = '学号,姓名,得分,总分,正确率,采集来源,用时(秒),提交时间';
    const rows = scores.map(s =>
      `${s.student_id},${s.student_name},${s.score},${s.total},${(s.score/s.total*100).toFixed(1)}%,${s.submit_source},${s.time_spent},${s.submitted_at}`
    );
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scores_${selectedId}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: '#f8fafc' }}>
      {/* 左侧列表 */}
      <div style={{ width: 300, minWidth: 300, borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>课件列表</span>
            <UploadButton ctx={ctx} onUploaded={loadList} />
          </div>
          <input type="text" placeholder="🔍 搜索课件..." value={search} onChange={e => setSearch(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {['', 'published', 'draft'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                ...filterBtnStyle,
                background: statusFilter === s ? '#3b82f6' : '#f1f5f9',
                color: statusFilter === s ? '#fff' : '#64748b',
              }}>
                {s === '' ? '全部' : s === 'published' ? '已发布' : '未发布'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>加载中...</div>}
          {coursewares.map(cw => {
            const st = STATUS_MAP[cw.status] || STATUS_MAP.draft;
            return (
              <div key={cw.id} onClick={() => setSelectedId(cw.id)} style={{
                padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                background: selectedId === cw.id ? '#eff6ff' : 'transparent',
                borderLeft: selectedId === cw.id ? '3px solid #3b82f6' : '3px solid transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cw.title}
                    {cw.version > 1 && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>v{cw.version}</span>}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', paddingLeft: 12 }}>
                  {st.label} · {cw.created_at?.slice(0, 10)} · {cw.stats.submissions} 份提交
                </div>
              </div>
            );
          })}
          {!loading && coursewares.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>暂无课件</div>
          )}
        </div>
      </div>

      {/* 右侧详情 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!detail ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 14 }}>
            选择左侧课件查看详情
          </div>
        ) : (
          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 18, color: '#0f172a' }}>
                {detail.title}
                {detail.version > 1 && <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>v{detail.version}</span>}
              </h2>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
                <span>采集: <strong>{MODE_LABELS[detail.extraction_config?.mode] || '未知'}</strong></span>
                <span>及格线: {detail.pass_score}分</span>
                <span>创建于 {detail.created_at?.slice(0, 10)}</span>
                <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, background: STATUS_MAP[detail.status]?.color + '20', color: STATUS_MAP[detail.status]?.color }}>
                  {STATUS_MAP[detail.status]?.label}
                </span>
                {detail.security_warnings?.length > 0 && (
                  <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, background: '#fef3c7', color: '#92400e' }}>
                    ⚠ {detail.security_warnings.length} 个安全提示
                  </span>
                )}
              </div>
            </div>

            {/* 版本切换器 */}
            {versions.length > 1 && (
              <div style={{ marginBottom: 12, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 4 }}>版本:</span>
                {versions.map(v => (
                  <button key={v.id} onClick={() => setSelectedId(v.id)} style={{
                    ...filterBtnStyle,
                    background: v.id === detail.id ? '#3b82f6' : '#f1f5f9',
                    color: v.id === detail.id ? '#fff' : '#64748b',
                  }}>
                    v{v.version} {v.status === 'published' ? '(发布)' : v.status === 'archived' ? '(归档)' : ''}
                  </button>
                ))}
              </div>
            )}

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {detail.status === 'draft' ? (
                <button onClick={() => handlePublish(detail.id, 'published')} style={primaryBtnStyle}>发布课件</button>
              ) : detail.status === 'published' ? (
                <button onClick={() => handlePublish(detail.id, 'draft')} style={{ ...primaryBtnStyle, background: '#6b7280' }}>取消发布</button>
              ) : null}
              <button onClick={() => handleDelete(detail.id)} style={dangerBtnStyle}>删除课件</button>
            </div>

            {/* 安全警告 */}
            {detail.security_warnings?.length > 0 && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>⚠ 安全提示（不影响正常使用）</div>
                {detail.security_warnings.map((w, i) => (
                  <div key={i} style={{ color: '#a16207', lineHeight: 1.6 }}>· {w}</div>
                ))}
              </div>
            )}

            {/* Tab */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
              {(['preview', 'scores', 'settings'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, color: tab === t ? '#3b82f6' : '#64748b',
                  borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
                  fontWeight: tab === t ? 600 : 400,
                }}>
                  {{ preview: '预览', scores: '成绩', settings: '设置' }[t]}
                </button>
              ))}
            </div>

            {tab === 'preview' && <PreviewTab ctx={ctx} coursewareId={detail.id} />}
            {tab === 'scores' && <ScoresTab detail={detail} scores={scores} onExportCSV={exportCSV} />}
            {tab === 'settings' && <SettingsTab detail={detail} onUpdate={handleExtractionUpdate} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Upload Button
// ============================================================

function UploadButton({ ctx, onUploaded }: { ctx: FrontendCtx; onUploaded: () => void }) {
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [passScore, setPassScore] = useState(60);
  const [htmlContent, setHtmlContent] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.html') && !file.name.endsWith('.htm')) return;
    if (!title) setTitle(file.name.replace(/\.html?$/, ''));
    const reader = new FileReader();
    reader.onload = () => setHtmlContent(reader.result as string);
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!htmlContent || !title) return;
    setUploading(true);
    try {
      const res = await ctx.invokeCommand('courseware.upload', {
        title, description, html_content: htmlContent, pass_score: passScore,
      });
      if (res.error) {
        alert(`上传失败: ${res.message || res.error}`);
      } else {
        setShow(false); setTitle(''); setDescription(''); setHtmlContent(''); setPassScore(60);
        onUploaded();
        if (res.security_warnings?.length > 0) {
          alert(`课件已上传，但检测到 ${res.security_warnings.length} 个安全提示:\n${res.security_warnings.join('\n')}`);
        }
      }
    } catch (e) { console.error(e); }
    finally { setUploading(false); }
  };

  return (
    <>
      <button onClick={() => setShow(true)} style={{ ...primaryBtnStyle, padding: '4px 12px', fontSize: 12 }}>+ 上传</button>
      {show && (
        <div style={modalOverlay} onClick={() => setShow(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>上传新课件</h3>
              <button onClick={() => setShow(false)} style={closeBtnStyle}>✕</button>
            </div>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
              style={{ border: `2px dashed ${dragOver ? '#3b82f6' : '#d1d5db'}`, borderRadius: 8, padding: 32, textAlign: 'center', background: dragOver ? '#eff6ff' : '#f9fafb', marginBottom: 16, cursor: 'pointer', transition: 'all 0.15s' }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{htmlContent ? '文件已加载' : '拖拽 HTML 文件到此处，或点击选择'}</div>
              {htmlContent && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4 }}>✓ {(htmlContent.length / 1024).toFixed(1)} KB</div>}
            </div>
            <label style={labelStyle}>课件名称</label>
            <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} placeholder="输入课件名称" />
            <label style={labelStyle}>描述</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, height: 60, resize: 'vertical' } as any} placeholder="课件描述（可选）" />
            <label style={labelStyle}>及格线</label>
            <input type="number" value={passScore} onChange={e => setPassScore(Number(e.target.value))} style={{ ...inputStyle, width: 100 }} min={0} max={1000} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setShow(false)} style={{ ...primaryBtnStyle, background: '#e5e7eb', color: '#374151' }}>取消</button>
              <button onClick={handleUpload} disabled={!htmlContent || !title || uploading} style={{ ...primaryBtnStyle, opacity: !htmlContent || !title ? 0.5 : 1 }}>
                {uploading ? '上传中...' : '确认上传'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// PreviewTab — 加入元素高亮检查模式
// ============================================================

function PreviewTab({ ctx, coursewareId }: { ctx: FrontendCtx; coursewareId: string }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [inspectMode, setInspectMode] = useState(false);
  const [copiedSelector, setCopiedSelector] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLoading(true);
    ctx.invokeCommand('courseware.get_html', { id: coursewareId }).then(res => {
      setHtml(res.html || '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ctx, coursewareId]);

  // 注入检查模式脚本
  useEffect(() => {
    if (!inspectMode || !html) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const tryInject = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const style = doc.createElement('style');
        style.id = 'openlearn-inspect-style';
        style.textContent = `
          .openlearn-inspect-hover { outline: 2px solid #3b82f6 !important; outline-offset: 1px; background: rgba(59,130,246,0.08) !important; }
          .openlearn-inspect-tooltip { position: fixed; z-index: 99999; background: #1e293b; color: #fff; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-family: monospace; pointer-events: none; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        `;
        doc.head.appendChild(style);

        let tooltip: HTMLElement | null = null;

        const getSelector = (el: Element): string => {
          if (el.id) return `#${el.id}`;
          const path: string[] = [];
          let current: Element | null = el;
          while (current && current !== doc.body && current !== doc.documentElement) {
            let selector = current.tagName.toLowerCase();
            if (current.className && typeof current.className === 'string') {
              const cls = current.className.trim().split(/\s+/).slice(0, 2).join('.');
              if (cls) selector += '.' + cls;
            }
            path.unshift(selector);
            current = current.parentElement;
            if (path.length > 3) break;
          }
          return path.join(' > ');
        };

        const onOver = (e: MouseEvent) => {
          const target = e.target as Element;
          if (target === doc.body || target === doc.documentElement) return;
          target.classList.add('openlearn-inspect-hover');
          if (!tooltip) {
            tooltip = doc.createElement('div');
            tooltip.className = 'openlearn-inspect-tooltip';
            doc.body.appendChild(tooltip);
          }
          tooltip.textContent = getSelector(target);
          tooltip.style.left = (e.pageX + 12) + 'px';
          tooltip.style.top = (e.pageY - 30) + 'px';
        };

        const onOut = (e: MouseEvent) => {
          (e.target as Element).classList.remove('openlearn-inspect-hover');
          if (tooltip) tooltip.textContent = '';
        };

        const onClick = (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const sel = getSelector(e.target as Element);
          navigator.clipboard.writeText(sel).then(() => {
            setCopiedSelector(sel);
            setTimeout(() => setCopiedSelector(''), 2000);
          });
        };

        doc.addEventListener('mouseover', onOver, true);
        doc.addEventListener('mouseout', onOut, true);
        doc.addEventListener('click', onClick, true);

        return () => {
          doc.removeEventListener('mouseover', onOver, true);
          doc.removeEventListener('mouseout', onOut, true);
          doc.removeEventListener('click', onClick, true);
          const s = doc.getElementById('openlearn-inspect-style');
          if (s) s.remove();
          if (tooltip) tooltip.remove();
        };
      } catch (_) { /* cross-origin */ }
    };

    const timer = setTimeout(tryInject, 500);
    return () => clearTimeout(timer);
  }, [inspectMode, html]);

  if (loading) return <div style={{ color: '#94a3b8', padding: 20 }}>加载中...</div>;
  if (!html) return <div style={{ color: '#94a3b8', padding: 20 }}>无法加载课件内容</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button
          onClick={() => setInspectMode(!inspectMode)}
          style={{
            ...primaryBtnStyle,
            background: inspectMode ? '#f59e0b' : '#f1f5f9',
            color: inspectMode ? '#fff' : '#64748b',
            fontSize: 12, padding: '4px 12px',
          }}
        >
          {inspectMode ? '退出检查' : '🔍 检查模式'}
        </button>
        {copiedSelector && (
          <span style={{ fontSize: 12, color: '#22c55e' }}>已复制: {copiedSelector}</span>
        )}
      </div>
      <iframe
        ref={iframeRef}
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: '100%', height: 500, border: '1px solid #e5e7eb', borderRadius: 8,
          background: '#fff', pointerEvents: inspectMode ? 'auto' : 'auto',
        }}
      />
    </div>
  );
}

// ============================================================
// ScoresTab
// ============================================================

function ScoresTab({ detail, scores, onExportCSV }: { detail: CoursewareDetail; scores: ScoreItem[]; onExportCSV: () => void }) {
  const s = detail.stats;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: '提交人数', value: s.submissions },
          { label: '平均分', value: s.avg_score },
          { label: '最高分', value: s.max_score },
          { label: '最低分', value: s.min_score },
          { label: '及格率', value: s.pass_rate + '%' },
        ].map(stat => (
          <div key={stat.label} style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{stat.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>{stat.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>成绩明细</span>
        <button onClick={onExportCSV} style={{ ...primaryBtnStyle, padding: '4px 12px', fontSize: 12 }}>导出 CSV</button>
      </div>
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
              <th style={thStyle}>学号</th><th style={thStyle}>姓名</th><th style={thStyle}>得分</th>
              <th style={thStyle}>总分</th><th style={thStyle}>正确率</th><th style={thStyle}>来源</th>
              <th style={thStyle}>用时</th><th style={thStyle}>提交时间</th>
            </tr>
          </thead>
          <tbody>
            {scores.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={tdStyle}>{s.student_id}</td><td style={tdStyle}>{s.student_name}</td>
                <td style={tdStyle}>{s.score}</td><td style={tdStyle}>{s.total}</td>
                <td style={tdStyle}>{(s.score / s.total * 100).toFixed(1)}%</td>
                <td style={tdStyle}><span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: s.submit_source === 'sdk' ? '#dcfce7' : '#fef3c7', color: s.submit_source === 'sdk' ? '#166534' : '#92400e' }}>{s.submit_source}</span></td>
                <td style={tdStyle}>{s.time_spent ? `${Math.floor(s.time_spent/60)}分${s.time_spent%60}秒` : '-'}</td>
                <td style={tdStyle}>{s.submitted_at?.replace('T', ' ').slice(0, 19)}</td>
              </tr>
            ))}
            {scores.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: 24 }}>暂无成绩数据</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// SettingsTab
// ============================================================

function SettingsTab({ detail, onUpdate }: { detail: CoursewareDetail; onUpdate: (id: string, config: any) => void }) {
  const [mode, setMode] = useState(detail.extraction_config?.mode || 'sdk');
  const [scoreSelector, setScoreSelector] = useState(detail.extraction_config?.manual_config?.scoreSelector || detail.extraction_config?.ai_analysis?.scoreSelector || '');
  const [totalSelector, setTotalSelector] = useState(detail.extraction_config?.manual_config?.totalSelector || detail.extraction_config?.ai_analysis?.totalSelector || '');
  const [triggerSelector, setTriggerSelector] = useState(detail.extraction_config?.manual_config?.triggerSelector || detail.extraction_config?.ai_analysis?.triggerSelector || '');
  const [jsVarName, setJsVarName] = useState(detail.extraction_config?.manual_config?.jsVarName || detail.extraction_config?.ai_analysis?.jsVarName || '');
  const [saving, setSaving] = useState(false);

  const buildConfig = (): any => {
    switch (mode) {
      case 'sdk': return { mode: 'sdk' };
      case 'ai_injected': return { mode: 'ai_injected', ai_analysis: { scoreSource: 'dom', scoreSelector, totalSelector, triggerSelector, triggerEvent: 'button_click', confidence: 0.85 } };
      case 'manual_selector': return { mode: 'manual_selector', manual_config: { scoreSelector, totalSelector, triggerSelector, triggerEvent: 'button_click' } };
      case 'manual_js_var': return { mode: 'manual_js_var', manual_config: { jsVarName } };
      case 'manual_entry': return { mode: 'manual_entry' };
      default: return { mode: 'sdk' };
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onUpdate(detail.id, buildConfig()); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 500 }}>
      <label style={labelStyle}>成绩采集方式</label>
      <select value={mode} onChange={e => setMode(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
        <option value="sdk">SDK 协议 — 课件调用 OpenLearn.submit()</option>
        <option value="ai_injected">AI 自动检测 — 系统分析并注入提取脚本</option>
        <option value="manual_selector">CSS 选择器 — 手动指定成绩 DOM 元素</option>
        <option value="manual_js_var">JS 变量 — 指定全局变量名</option>
        <option value="manual_entry">学生手动录入 — 无自动采集</option>
      </select>
      {(mode === 'manual_selector' || mode === 'ai_injected') && (
        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>成绩元素选择器</label>
          <input value={scoreSelector} onChange={e => setScoreSelector(e.target.value)} style={inputStyle} placeholder="例如：#result .score-value" />
          <label style={labelStyle}>总分元素选择器</label>
          <input value={totalSelector} onChange={e => setTotalSelector(e.target.value)} style={inputStyle} placeholder="例如：#result .total-value（可选）" />
          <label style={labelStyle}>触发元素选择器</label>
          <input value={triggerSelector} onChange={e => setTriggerSelector(e.target.value)} style={inputStyle} placeholder="例如：#submit-btn" />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>💡 在预览 Tab 中开启「检查模式」，悬停元素即可复制选择器</div>
        </div>
      )}
      {mode === 'manual_js_var' && (
        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>JS 全局变量名</label>
          <input value={jsVarName} onChange={e => setJsVarName(e.target.value)} style={inputStyle} placeholder="例如：window.__score" />
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <button onClick={handleSave} disabled={saving} style={primaryBtnStyle}>{saving ? '保存中...' : '保存配置'}</button>
      </div>
    </div>
  );
}

// ============================================================
// 样式
// ============================================================

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff',
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 16px', border: 'none', borderRadius: 6, background: '#3b82f6', color: '#fff',
  fontSize: 13, cursor: 'pointer', fontWeight: 500,
};
const dangerBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle, background: '#ef4444',
};
const filterBtnStyle: React.CSSProperties = {
  padding: '3px 10px', border: 'none', borderRadius: 14, fontSize: 11, cursor: 'pointer', fontWeight: 500,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 10,
};
const thStyle: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 11, whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', color: '#4b5563', fontSize: 12,
};
const modalOverlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
  background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 24, width: 480, maxHeight: '80vh', overflow: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
};
const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#94a3b8', padding: 0,
};
