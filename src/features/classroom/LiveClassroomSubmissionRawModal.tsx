import React from 'react';
import { FileText, XCircle, RefreshCw, Activity, Award } from 'lucide-react';

export function LiveClassroomSubmissionRawModal({
  lang,
  selectedAttempt,
  loadingRaw,
  rawPayload,
  onClose,
}: {
  lang: string;
  selectedAttempt: any;
  loadingRaw: boolean;
  rawPayload: any;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-theme animate-in fade-in zoom-in duration-200 text-main">
        {/* Modal Header */}
        <div className="bg-surface-secondary px-6 py-4 border-b border-theme flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="text-primary-ink" size={18} />
            <h3 className="text-sm font-bold text-main">
              {lang === 'zh'
                ? `[${selectedAttempt.studentName}] 的互动提交轨迹详情`
                : `Submission Details - ${selectedAttempt.studentName}`}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-main p-1.5 hover:bg-surface-secondary rounded-lg transition-colors cursor-pointer"
          >
            <XCircle size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 scrollbar-thin">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
              <div className="text-xs text-muted font-bold uppercase tracking-wider">
                {lang === 'zh' ? '课件名称' : 'Courseware'}
              </div>
              <div className="text-xs font-semibold text-main mt-1 truncate" title={selectedAttempt.coursewareName}>
                {selectedAttempt.coursewareName}
              </div>
            </div>
            <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
              <div className="text-xs text-muted font-bold uppercase tracking-wider">
                {lang === 'zh' ? '提交成绩' : 'Score'}
              </div>
              <div className="text-xs font-bold text-primary-ink mt-1">
                {selectedAttempt.score !== null ? `${selectedAttempt.score} 分` : lang === 'zh' ? '未打分' : 'N/A'}
              </div>
            </div>
            <div className="bg-surface-secondary p-3 rounded-xl border border-theme">
              <div className="text-xs text-muted font-bold uppercase tracking-wider">
                {lang === 'zh' ? '课件完成度' : 'Completion'}
              </div>
              <div className="text-xs font-bold text-emerald-600 mt-1">
                {selectedAttempt.completion !== null ? `${Math.round(selectedAttempt.completion * 100)}%` : '0%'}
              </div>
            </div>
          </div>

          {/* Event Logs Timeline */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-main border-b border-theme pb-1.5 flex items-center gap-1.5 flex-wrap">
              <Activity size={13} className="text-primary-ink" />
              <span>{lang === 'zh' ? '实时捕获轨迹事件流 (LMS Bridge)' : 'LMS Event Captures'}</span>
            </h4>

            {loadingRaw ? (
              <div className="py-12 flex flex-col items-center justify-center text-muted gap-2">
                <RefreshCw size={20} className="animate-spin text-primary-ink" />
                <span className="text-xs">{lang === 'zh' ? '正在查询原始数据...' : 'Loading raw data...'}</span>
              </div>
            ) : Array.isArray(rawPayload) && rawPayload.length > 0 ? (
              <div className="space-y-3 font-mono text-xs max-h-[40vh] overflow-y-auto pr-1 scrollbar-thin">
                {rawPayload.map((evt, idx) => {
                  let parsedPayload = {};
                  try {
                    parsedPayload =
                      typeof evt.payload_json === 'string' ? JSON.parse(evt.payload_json) : evt.payload_json;
                  } catch {
                    /* ignore malformed payload_json */
                  }

                  return (
                    <div
                      key={evt.id || idx}
                      className="p-3 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 flex flex-col gap-1.5"
                    >
                      <div className="flex justify-between items-center text-xs text-slate-400 border-b border-slate-800 pb-1">
                        <span className="font-bold text-indigo-400 bg-indigo-950/50 border border-indigo-900/50 px-1.5 py-0.5 rounded">
                          {evt.event_type}
                        </span>
                        <span>{new Date(evt.created_at).toLocaleTimeString()}</span>
                      </div>
                      <pre className="overflow-x-auto text-xs leading-relaxed p-1 text-emerald-400/90 whitespace-pre-wrap word-break-all">
                        {JSON.stringify(parsedPayload, null, 2)}
                      </pre>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-muted italic">
                {lang === 'zh' ? '该学生未产生任何轨迹事件数据。' : 'No trace events captured.'}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-surface-secondary px-6 py-4 border-t border-theme flex justify-between gap-3 shrink-0">
          <div className="text-xs text-muted flex items-center gap-1">
            <Award size={10} />
            <span>Powered by LMS Bridge API v1</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface hover:bg-surface-secondary border border-theme text-main font-bold rounded-lg text-xs transition-all cursor-pointer shadow-sm active:scale-95"
          >
            {lang === 'zh' ? '关闭窗口' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
