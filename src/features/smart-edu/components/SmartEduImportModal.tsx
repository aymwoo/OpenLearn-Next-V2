import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Search,
  BookOpen,
  Award,
  CheckCircle2,
  Download,
  X,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Layers,
} from 'lucide-react';
import type { SmartEduCourseResource } from '../types';

interface SmartEduImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  lang?: string;
}

export function SmartEduImportModal({ isOpen, onClose, onSuccess, lang = 'zh' }: SmartEduImportModalProps) {
  const [resources, setResources] = useState<SmartEduCourseResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/external/smart-edu/resources?subject=${selectedSubject}&query=${encodeURIComponent(searchQuery)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.resources)) {
          setResources(data.resources);
        }
      })
      .catch((err) => console.error('Failed to load smart edu resources', err))
      .finally(() => setLoading(false));
  }, [isOpen, selectedSubject, searchQuery]);

  if (!isOpen) return null;

  const handleImport = async (res: SmartEduCourseResource) => {
    try {
      setImportingId(res.id);
      const resp = await fetch('/api/external/smart-edu/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId: res.id }),
      });
      const data = await resp.json();
      if (data.success) {
        setSuccessMessage(`已成功导入《${res.title}》！`);
        setTimeout(() => {
          setSuccessMessage(null);
          onSuccess?.();
          onClose();
        }, 1200);
      } else {
        alert(data.error || '导入失败');
      }
    } catch (e: any) {
      alert(e.message || '网络异常，导入失败');
    } finally {
      setImportingId(null);
    }
  };

  const getAwardLabel = (level: string) => {
    switch (level) {
      case 'national_gold':
        return '国家级一等奖精品课';
      case 'national_silver':
        return '国家级二等奖精品课';
      case 'ministry_excellent':
        return '教育部“部优”示范课';
      default:
        return '国家认证精品课';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-amber-500/30 rounded-2xl shadow-2xl shadow-amber-950/20 overflow-hidden flex flex-col max-h-[85vh]">
        {/* 顶部标题栏 */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-950/50 via-slate-900 to-slate-900 border-b border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center shadow-md shadow-amber-600/30 text-slate-950 font-bold">
              <Sparkles className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white tracking-wide">
                  国家智慧教育公共服务平台 · 精品课资源库
                </h3>
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> smartedu.cn 官方直连
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                同步教育部审定高中新课标示范课程、微课视频切片及配套白板探究实验
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 搜索与分类栏 */}
        <div className="px-6 py-3 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: '全部学科' },
              { id: 'information_tech', label: '信息科技' },
              { id: 'physics', label: '高中物理' },
              { id: 'general_tech', label: '通用技术' },
            ].map((sub) => (
              <button
                key={sub.id}
                onClick={() => setSelectedSubject(sub.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  selectedSubject === sub.id
                    ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索课名、教师、知识点..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-950/70 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
            />
          </div>
        </div>

        {/* 成功通知浮层 */}
        {successMessage && (
          <div className="mx-6 mt-3 px-4 py-2.5 bg-emerald-950/80 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center space-x-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* 资源列表内容区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-2" />
              <p className="text-xs">正在连接国家智慧教育平台检索资源...</p>
            </div>
          ) : resources.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-xs">
              未找到匹配的国家平台示范课程资源
            </div>
          ) : (
            resources.map((res) => (
              <div
                key={res.id}
                className="group relative p-5 bg-slate-800/40 hover:bg-slate-800/70 border border-slate-800 hover:border-amber-500/40 rounded-xl transition duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-2.5 mb-1.5 flex-wrap">
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded flex items-center gap-1">
                      <Award className="w-3 h-3 text-amber-400" />
                      {getAwardLabel(res.awardLevel)}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">证书号: {res.code}</span>
                  </div>

                  <h4 className="text-sm font-bold text-white group-hover:text-amber-300 transition">
                    {res.title}
                  </h4>

                  <p className="text-xs text-slate-300 mt-1 line-clamp-2 leading-relaxed">
                    {res.summary}
                  </p>

                  <div className="flex items-center space-x-4 text-[11px] text-slate-400 mt-3 flex-wrap gap-y-1">
                    <span className="text-slate-300 font-medium">主讲教师: {res.teacherName}</span>
                    <span>学校: {res.schoolName}</span>
                    <span className="flex items-center gap-1 text-amber-400/90">
                      <Layers className="w-3 h-3" />
                      包含 {res.timeline.length} 教学环节
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    disabled={importingId === res.id}
                    onClick={() => handleImport(res)}
                    className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-900/30 flex items-center space-x-1.5 transition disabled:opacity-50"
                  >
                    {importingId === res.id ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>同步中...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>一键导入本地</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 底部信息提示 */}
        <div className="px-6 py-3 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>国家平台数据通道已加密对齐 · 课程导入自动适配本地白板交互环境</span>
          </div>
          <span className="text-slate-500">CELTS-3 / 教育部教育信息化技术标准</span>
        </div>
      </div>
    </div>
  );
}
