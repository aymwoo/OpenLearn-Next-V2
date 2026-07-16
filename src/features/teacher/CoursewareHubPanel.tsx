import React, { useState, useEffect, useCallback } from 'react';
import { X, Upload, Search, Eye, Trash2, CheckCircle2, XCircle, BarChart3, Globe, RefreshCw, FileText } from 'lucide-react';

const MANIFEST_ID = '@courseware-hub/plugin';
const CT = (cmd: string) => `${MANIFEST_ID}.${cmd}`;

interface CoursewareItem {
  id: string;
  courseware_key: string;
  version: number;
  title: string;
  description: string;
  status: string;
  pass_score: number;
  extraction_config: any;
  security_warnings: string[];
  target_classes: string[];
  created_at: string;
  updated_at: string;
  stats?: { submissions: number; avg_score: number };
}

interface ScoreItem {
  id: string;
  student_id: string;
  student_name: string;
  score: number;
  total: number;
  submitted_at: string;
  time_spent: number;
}

interface Props {
  onClose: () => void;
  lang: string;
}

export function CoursewareHubPanel({ onClose, lang }: Props) {
  const [items, setItems] = useState<CoursewareItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [scores, setScores] = useState<ScoreItem[]>([]);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadPassScore, setUploadPassScore] = useState(60);
  const [uploadHtml, setUploadHtml] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingPassScore, setEditingPassScore] = useState(60);

  const callCmd = useCallback(async (cmdType: string, payload?: any) => {
    const res = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandType: CT(cmdType), payload: payload ?? {} }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Command failed');
    }
    const data = await res.json();
    return data.result;
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callCmd('courseware.query', {
        status: statusFilter || undefined,
        search: search || undefined,
        limit: 100,
      });
      setItems(result?.items ?? []);
    } catch (e: any) {
      console.error('Fetch courseware list failed:', e);
    } finally {
      setLoading(false);
    }
  }, [callCmd, statusFilter, search]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleUpload = async () => {
    if (!uploadTitle.trim() || !uploadHtml.trim()) return;
    setUploading(true);
    try {
      await callCmd('courseware.upload', {
        title: uploadTitle.trim(),
        html_content: uploadHtml,
        pass_score: uploadPassScore,
      });
      setUploadTitle('');
      setUploadHtml('');
      setUploadPassScore(60);
      await fetchList();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setUploadHtml((ev.target?.result as string) ?? '');
    reader.readAsText(file);
  };

  const handlePublish = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'published' ? 'draft' : 'published';
    try {
      await callCmd('courseware.publish', { id, status: newStatus });
      await fetchList();
    } catch (e: any) { alert(e.message); }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(lang === 'zh' ? `确认删除课件「${title}」及其所有版本和成绩数据？` : `Delete "${title}" and all versions/scores?`)) return;
    try {
      await callCmd('courseware.delete', { id });
      await fetchList();
    } catch (e: any) { alert(e.message); }
  };

  const handleViewDetail = async (id: string) => {
    try {
      const d = await callCmd('courseware.get_detail', { id });
      const s = await callCmd('courseware.query_scores', { courseware_id: id });
      setDetail(d);
      setScores(s?.items ?? []);
      setDetailId(id);
    } catch (e: any) { alert(e.message); }
  };

  const handleStartEdit = (item: CoursewareItem) => {
    setEditingId(item.id);
    setEditingTitle(item.title);
    setEditingPassScore(item.pass_score);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editingTitle.trim()) return;
    try {
      await callCmd('courseware.upload', {
        title: editingTitle.trim(),
        html_content: '',
        courseware_key: items.find(i => i.id === editingId)?.courseware_key,
        pass_score: editingPassScore,
      });
      setEditingId(null);
      await fetchList();
    } catch (e: any) { alert(e.message); }
  };

  const handleUpdateExtraction = async (id: string, mode: string) => {
    try {
      await callCmd('courseware.update_extraction', { id, extraction_config: { mode } as any });
      await fetchList();
    } catch (e: any) { alert(e.message); }
  };

  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-800">{t('课件管理', 'Courseware Hub')}</h2>
              <p className="text-xs text-gray-400">{t('上传 HTML 课件 · 成绩采集 · 版本管理', 'Upload · Score Collection · Versioning')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {detailId ? (
          /* Detail / Scores View */
          <div className="flex-1 overflow-y-auto p-6">
            <button onClick={() => setDetailId(null)} className="text-sm text-indigo-600 hover:underline mb-4 inline-flex items-center gap-1">
              ← {t('返回列表', 'Back to list')}
            </button>
            {detail && (
              <div className="space-y-6">
                <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                  <h3 className="font-bold text-gray-800 mb-3">{detail.title}</h3>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                    <div><span className="text-gray-400">{t('版本', 'Version')}:</span> <span className="font-mono text-gray-700">{detail.version}</span></div>
                    <div><span className="text-gray-400">{t('状态', 'Status')}:</span> <span className={`font-bold ${detail.status === 'published' ? 'text-green-600' : 'text-amber-600'}`}>{detail.status}</span></div>
                    <div><span className="text-gray-400">{t('及格线', 'Pass Score')}:</span> <span className="font-mono">{detail.pass_score}</span></div>
                    <div><span className="text-gray-400">{t('提交数', 'Submissions')}:</span> <span className="font-mono">{detail.stats?.submissions ?? 0}</span></div>
                    <div><span className="text-gray-400">{t('平均分', 'Avg Score')}:</span> <span className="font-mono text-indigo-600 font-bold">{detail.stats?.avg_score ?? '-'}</span></div>
                    <div><span className="text-gray-400">{t('通过率', 'Pass Rate')}:</span> <span className="font-mono">{detail.stats?.pass_rate ?? '-'}%</span></div>
                  </div>
                </div>

                {/* Scores table */}
                <div>
                  <h4 className="font-bold text-gray-700 mb-3">{t('成绩列表', 'Score List')}</h4>
                  {scores.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">{t('暂无成绩记录', 'No scores yet')}</p>
                  ) : (
                    <div className="overflow-x-auto border border-gray-200 rounded-xl">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                          <tr>
                            <th className="px-4 py-2 text-left">{t('学生', 'Student')}</th>
                            <th className="px-4 py-2 text-right">{t('分数', 'Score')}</th>
                            <th className="px-4 py-2 text-right">{t('用时(秒)', 'Time(s)')}</th>
                            <th className="px-4 py-2 text-right">{t('提交时间', 'Submitted')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {scores.map(s => (
                            <tr key={s.id} className="hover:bg-gray-50">
                              <td className="px-4 py-2 font-medium text-gray-700">{s.student_name || s.student_id}</td>
                              <td className={`px-4 py-2 text-right font-mono font-bold ${s.score >= (detail?.pass_score ?? 60) ? 'text-green-600' : 'text-red-500'}`}>{s.score}/{s.total}</td>
                              <td className="px-4 py-2 text-right text-gray-500">{s.time_spent}</td>
                              <td className="px-4 py-2 text-right text-gray-400 text-xs">{new Date(s.submitted_at).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Main list + upload */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Toolbar */}
            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 shrink-0 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('搜索课件...', 'Search courseware...')}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
              >
                <option value="">{t('全部状态', 'All Status')}</option>
                <option value="published">{t('已发布', 'Published')}</option>
                <option value="draft">{t('草稿', 'Draft')}</option>
                <option value="archived">{t('已归档', 'Archived')}</option>
              </select>
              <button onClick={fetchList} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title={t('刷新', 'Refresh')}>
                <RefreshCw size={16} className="text-gray-400" />
              </button>
            </div>

            {/* Upload area */}
            <div className="px-6 py-4 border-b border-gray-100 bg-indigo-50/30 shrink-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-bold text-gray-600 shrink-0">{t('上传课件', 'Upload')}:</span>
                <input
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  placeholder={t('课件标题', 'Title')}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-40 outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                  type="number"
                  value={uploadPassScore}
                  onChange={e => setUploadPassScore(Number(e.target.value))}
                  placeholder={t('及格线', 'Pass')}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-20 outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <label className="text-sm px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-indigo-400 hover:bg-white transition-colors text-gray-500">
                  <Upload size={14} className="inline mr-1" />
                  {uploadHtml ? t('已选择文件', 'File selected') : t('选择 HTML', 'Select HTML')}
                  <input type="file" accept=".html,.htm" onChange={handleFileSelect} className="hidden" />
                </label>
                <button
                  onClick={handleUpload}
                  disabled={uploading || !uploadTitle.trim() || !uploadHtml.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  {uploading ? t('上传中...', 'Uploading...') : t('上传', 'Upload')}
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-6">
              {loading ? (
                <div className="text-center py-12 text-gray-400">{t('加载中...', 'Loading...')}</div>
              ) : items.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <FileText size={40} className="mx-auto mb-3 opacity-30" />
                  <p>{t('暂无课件，请上传您的第一个 HTML 课件', 'No courseware yet. Upload your first HTML courseware.')}</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {items.map(item => (
                    <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-200 transition-colors shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-bold text-gray-800 truncate">{item.title}</h4>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              item.status === 'published' ? 'bg-green-50 text-green-650 border border-green-200' :
                              item.status === 'archived' ? 'bg-gray-50 text-gray-500 border border-gray-200' :
                              'bg-amber-50 text-amber-650 border border-amber-200'
                            }`}>
                              {item.status === 'published' ? t('已发布', 'Published') : item.status === 'archived' ? t('已归档', 'Archived') : t('草稿', 'Draft')}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">v{item.version}</span>
                          </div>
                          {item.description && <p className="text-xs text-gray-400 line-clamp-2 mb-2">{item.description}</p>}
                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            <span className="flex items-center gap-1"><BarChart3 size={12} />{t('提交', 'Subs')}: {item.stats?.submissions ?? 0}</span>
                            <span className="flex items-center gap-1"><CheckCircle2 size={12} />{t('均分', 'Avg')}: {item.stats?.avg_score ?? '-'}</span>
                            {item.security_warnings?.length > 0 && (
                              <span className="text-amber-500 flex items-center gap-1" title={item.security_warnings.join(', ')}>
                                ⚠ {item.security_warnings.length}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => handleViewDetail(item.id)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title={t('详情', 'Details')}>
                            <Eye size={15} className="text-gray-400" />
                          </button>
                          <button onClick={() => handlePublish(item.id, item.status)} className={`p-1.5 hover:bg-gray-100 rounded-lg transition-colors`} title={item.status === 'published' ? t('下架', 'Unpublish') : t('发布', 'Publish')}>
                            {item.status === 'published' ? <XCircle size={15} className="text-amber-500" /> : <Globe size={15} className="text-green-500" />}
                          </button>
                          <button onClick={() => handleDelete(item.id, item.title)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors" title={t('删除', 'Delete')}>
                            <Trash2 size={15} className="text-red-400" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
