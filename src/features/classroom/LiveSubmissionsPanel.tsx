import React from 'react';
import {
  Search,
  RefreshCw,
  Trophy,
  Zap,
  Database,
  FileText,
  Eye,
  Check,
} from 'lucide-react';

export const FINISHED_STATUSES = ['completed', 'submitted', 'finished'];
export const IN_PROGRESS_STATUSES = ['active', 'inprogress', 'started'];

export interface LiveSubmissionsPanelProps {
  lang: 'zh' | 'en';
  selectedLesson: string | null;
  liveClassSelectedClassId: string | null;
  attempts: any[];
  displayAttempts: any[];
  loadingAttempts: boolean;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  submissionFilter: string;
  setSubmissionFilter: (val: any) => void;
  fetchAttempts: () => void;
  setMiddleTab: (tab: any) => void;
  autoRecordRule: {
    enabled: boolean;
    minCompletion: number;
    strategy: 'highest' | 'latest';
  };
  autoRecordRuleLoaded: boolean;
  savingAutoRecordRule: boolean;
  saveAutoRecordRule: (rule: any) => Promise<void>;
  autoRecordReport: { recorded: number } | null;
  runAutoRecord: (silent?: boolean) => Promise<void>;
  autoRecordRunning: boolean;
  handleViewRaw: (attempt: any) => void;
  handlePromoteAttempt: (attemptId: string) => void;
  handleMarkAbsent: (studentId: string, coursewareId: string) => void;
}

export function LiveSubmissionsPanel({
  lang,
  selectedLesson,
  liveClassSelectedClassId,
  attempts,
  displayAttempts,
  loadingAttempts,
  searchQuery,
  setSearchQuery,
  submissionFilter,
  setSubmissionFilter,
  fetchAttempts,
  setMiddleTab,
  autoRecordRule,
  autoRecordRuleLoaded,
  savingAutoRecordRule,
  saveAutoRecordRule,
  autoRecordReport,
  runAutoRecord,
  autoRecordRunning,
  handleViewRaw,
  handlePromoteAttempt,
  handleMarkAbsent,
}: LiveSubmissionsPanelProps) {
  return (
    <div className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-hidden border border-theme shadow-md bg-surface flex flex-col p-4">
      {/* Submissions list view */}
      <div className="flex justify-between items-center mb-4 gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-main">
            {lang === 'zh' ? '学生互动提交数据列表' : 'Student Submissions'}
          </span>
          {attempts.length > 0 && (
            <span
              className="text-xs bg-primary-theme/10 text-primary-theme px-2 py-0.5 rounded-full border border-primary-theme/20 font-bold"
              title={
                displayAttempts.length === attempts.length
                  ? undefined
                  : lang === 'zh'
                    ? `已按所选班级/筛选条件过滤，全部记录共 ${attempts.length} 条`
                    : `Filtered by the selected class/filters. ${attempts.length} records in total.`
              }
            >
              {displayAttempts.length} {lang === 'zh' ? '条记录' : 'records'}
              {displayAttempts.length !== attempts.length && (
                <span className="ml-1 font-normal opacity-70">/ {attempts.length}</span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder={lang === 'zh' ? '搜索学生或课件...' : 'Search student or courseware...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-surface border border-theme rounded-lg text-xs pl-8 pr-3 py-1.5 focus:ring-1 focus:ring-primary-theme text-main outline-none w-44 transition-all"
            />
            <Search size={12} className="absolute left-2.5 top-2.5 text-muted" />
          </div>

          {/* Filter */}
          <select
            value={submissionFilter}
            onChange={(e: any) => setSubmissionFilter(e.target.value)}
            className="bg-surface border border-theme rounded-lg text-xs px-3 py-1.5 focus:ring-1 focus:ring-primary-theme text-main outline-none cursor-pointer hover:bg-surface-secondary transition-colors"
          >
            <option value="all">{lang === 'zh' ? '全部状态' : 'All Status'}</option>
            <option value="submitted">{lang === 'zh' ? '已提交/完成' : 'Submitted/Finished'}</option>
            <option value="started">{lang === 'zh' ? '进行中' : 'In Progress'}</option>
          </select>

          {/* Refresh */}
          <button
            onClick={fetchAttempts}
            disabled={loadingAttempts}
            className="p-1.5 bg-surface hover:bg-surface-secondary border border-theme rounded-lg text-muted hover:text-main transition-colors cursor-pointer flex items-center justify-center shadow-sm disabled:opacity-50"
            title={lang === 'zh' ? '刷新数据' : 'Refresh'}
          >
            <RefreshCw size={12} className={loadingAttempts ? 'animate-spin' : ''} />
          </button>

          {/* Jump to Top Performers */}
          <button
            onClick={() => setMiddleTab('top_performers')}
            className="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
            title={lang === 'zh' ? '查看随堂测验 Top 5 榜单' : 'View Top 5 Performers'}
          >
            <Trophy size={12} className="text-amber-500" />
            <span>{lang === 'zh' ? '优秀榜' : 'Top 5'}</span>
          </button>
        </div>
      </div>

      {/* 自动录入规则条：开关 + 完成度门槛 + 立即补录 */}
      <div className="flex items-center gap-3 flex-wrap mb-3 shrink-0 px-3 py-2 rounded-lg border border-theme bg-surface-secondary/40">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRecordRule.enabled}
            disabled={!autoRecordRuleLoaded || savingAutoRecordRule}
            onChange={(e) => void saveAutoRecordRule({ ...autoRecordRule, enabled: e.target.checked })}
            className="w-3.5 h-3.5 accent-primary-theme cursor-pointer disabled:opacity-50"
          />
          <span className="text-xs font-bold text-main flex items-center gap-1">
            <Zap size={12} className="text-primary-theme" />
            {lang === 'zh' ? '自动录入成绩' : 'Auto-record scores'}
          </span>
        </label>

        <span
          className="text-[11px] text-muted"
          title={
            lang === 'zh'
              ? '规则在「全局默认策略」上配置，个别课件可在成绩配置中单独覆盖。学生提交后由服务端直接写入学期成绩，无需逐条点击「录入成绩」。'
              : 'Configured on the global default; individual courseware can override.'
          }
        >
          {autoRecordRule.enabled
            ? lang === 'zh'
              ? `已开启 · 完成后自动写入学期成绩${autoRecordReport ? `（本次 ${autoRecordReport.recorded} 条）` : ''}`
              : `On${autoRecordReport ? ` (${autoRecordReport.recorded} recorded)` : ''}`
            : lang === 'zh'
              ? '关闭中 · 仍可逐条手动录入'
              : 'Off · manual recording still available'}
        </span>

        {autoRecordRule.enabled && (
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-[11px] text-muted whitespace-nowrap">
              {lang === 'zh' ? '完成度门槛' : 'Min completion'}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(autoRecordRule.minCompletion * 100)}
              disabled={savingAutoRecordRule}
              onChange={(e) =>
                saveAutoRecordRule({ ...autoRecordRule, minCompletion: Number(e.target.value) / 100 })
              }
              onMouseUp={() => void saveAutoRecordRule(autoRecordRule)}
              onTouchEnd={() => void saveAutoRecordRule(autoRecordRule)}
              className="w-24 accent-primary-theme cursor-pointer disabled:opacity-50"
            />
            <span className="text-[11px] font-bold font-mono text-main w-9 text-right">
              {Math.round(autoRecordRule.minCompletion * 100)}%
            </span>
          </label>
        )}

        {autoRecordRule.enabled && (
          <label className="flex items-center gap-1.5 select-none">
            <span className="text-[11px] text-muted whitespace-nowrap">
              {lang === 'zh' ? '更新策略' : 'Update policy'}
            </span>
            <select
              value={autoRecordRule.strategy}
              disabled={savingAutoRecordRule}
              onChange={(e) => {
                const strategy = e.target.value === 'highest' ? 'highest' : 'latest';
                void saveAutoRecordRule({ ...autoRecordRule, strategy });
              }}
              className="text-[11px] px-1.5 py-0.5 bg-surface border border-theme rounded-lg text-main cursor-pointer disabled:opacity-50"
              title={
                lang === 'zh'
                  ? '自动录入行被学生重做后的分数取法：最新 = 取最新一次提交；最高 = 仅新分更高才覆盖。教师手动录入的分数永远受保护。'
                  : 'How auto-recorded rows update on resubmission: latest = newest attempt wins; highest = only overwrite when higher. Manual scores are always protected.'
              }
            >
              <option value="latest">{lang === 'zh' ? '最新一次' : 'Latest'}</option>
              <option value="highest">{lang === 'zh' ? '最高分' : 'Highest'}</option>
            </select>
          </label>
        )}

        <button
          onClick={() => void runAutoRecord(false)}
          disabled={autoRecordRunning || !selectedLesson || !liveClassSelectedClassId}
          className="px-2.5 py-1 bg-primary-theme/10 hover:bg-primary-theme/20 text-primary-theme border border-primary-theme/30 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            lang === 'zh'
              ? '按当前规则，把本课节本班已提交但未录入的记录补录进来（重复点击不会重复记分）'
              : 'Record any submitted-but-unrecorded rows per the current rule (idempotent)'
          }
        >
          <Database size={12} className={autoRecordRunning ? 'animate-pulse' : ''} />
          <span>
            {autoRecordRunning
              ? lang === 'zh'
                ? '补录中…'
                : 'Recording…'
              : lang === 'zh'
                ? '立即补录'
                : 'Run now'}
          </span>
        </button>
      </div>

      {/* Table area */}
      <div className="flex-1 overflow-y-auto border border-theme rounded-xl scrollbar-thin">
        {loadingAttempts ? (
          <div className="h-full flex flex-col items-center justify-center text-muted gap-2">
            <RefreshCw size={24} className="animate-spin text-primary-theme mb-2" />
            <span className="text-xs">
              {lang === 'zh' ? '正在加载学生提交数据...' : 'Loading submissions...'}
            </span>
          </div>
        ) : (
          (() => {
            if (displayAttempts.length === 0) {
              return (
                <div className="h-full flex flex-col items-center justify-center py-12 text-muted gap-2">
                  <FileText size={32} className="text-muted/60" />
                  <span className="text-xs">
                    {lang === 'zh' ? '暂无匹配的提交数据。' : 'No matching submissions found.'}
                  </span>
                  {!liveClassSelectedClassId && (
                    <span className="text-xs text-muted italic">
                      {lang === 'zh'
                        ? '提示：请在顶部选择一个班级进行筛选。'
                        : 'Tip: Select a class at the top to filter.'}
                    </span>
                  )}
                </div>
              );
            }

            return (
              <table className="w-full border-collapse text-left text-xs text-main">
                <thead>
                  <tr className="bg-surface-secondary border-b border-theme font-bold text-muted select-none">
                    <th className="p-3">{lang === 'zh' ? '学生姓名' : 'Student Name'}</th>
                    <th className="p-3">{lang === 'zh' ? '交互课件' : 'Courseware'}</th>
                    <th className="p-3">{lang === 'zh' ? '状态' : 'Status'}</th>
                    <th className="p-3 text-center">{lang === 'zh' ? '成绩' : 'Score'}</th>
                    <th className="p-3 text-center">{lang === 'zh' ? '完成度' : 'Completion'}</th>
                    <th className="p-3 text-right">{lang === 'zh' ? '操作' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-theme">
                  {displayAttempts.map((a) => {
                    const isFinished = FINISHED_STATUSES.includes(a.status);
                    const hasScore = a.score !== null && a.score !== undefined;
                    const canRecord = isFinished && hasScore;
                    const recordDisabledReason = !isFinished
                      ? lang === 'zh'
                        ? '该提交仍在进行中，完成后才能录入学期成绩'
                        : 'Still in progress'
                      : !hasScore
                        ? lang === 'zh'
                          ? '该提交没有分数，无法录入（不会凭空记分）'
                          : 'No score available'
                        : undefined;
                    const formattedTime = a.started_at
                      ? new Date(a.started_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'N/A';

                    return (
                      <tr
                        key={a.attemptId}
                        className="hover:bg-surface-secondary/50 transition-colors group"
                      >
                        <td className="p-3">
                          <div className="font-semibold text-main">{a.studentName}</div>
                          <div className="text-xs text-muted mt-0.5">
                            {lang === 'zh' ? '时间' : 'Time'}: {formattedTime}
                          </div>
                        </td>
                        <td
                          className="p-3 font-medium text-main max-w-[150px] truncate"
                          title={a.coursewareName}
                        >
                          {a.coursewareName}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full border text-xs font-bold ${
                              isFinished
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                : 'bg-blue-50 text-blue-700 border-blue-100 animate-pulse'
                            }`}
                          >
                            {isFinished
                              ? lang === 'zh'
                                ? '已提交'
                                : 'Finished'
                              : lang === 'zh'
                                ? '进行中'
                                : 'Running'}
                          </span>
                        </td>
                        <td className="p-3 text-center font-bold font-mono">
                          {a.score !== null ? (
                            <span className="text-primary-theme bg-primary-theme/10 border border-primary-theme/20 px-1.5 py-0.5 rounded-md">
                              {a.score}分
                            </span>
                          ) : (
                            <span className="text-muted font-medium">-</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-semibold font-mono">
                          {a.completion !== null ? `${Math.round(a.completion * 100)}%` : '0%'}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleViewRaw(a)}
                              className="p-1 text-muted hover:text-primary-theme hover:bg-surface-secondary border border-transparent hover:border-theme rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-xs"
                              title={lang === 'zh' ? '查看提交轨迹事件数据' : 'View Raw Data'}
                            >
                              <Eye size={12} />
                              <span>{lang === 'zh' ? '轨迹' : 'Events'}</span>
                            </button>

                            {a.isPromoted > 0 ? (
                              <span className="px-2 py-1 text-emerald-650 font-bold text-xs flex items-center gap-0.5 bg-emerald-50/50 rounded-lg border border-emerald-100">
                                <Check size={11} />
                                {lang === 'zh' ? '已归档' : 'Saved'}
                              </span>
                            ) : (
                              <>
                                <button
                                  onClick={() => handlePromoteAttempt(a.attemptId)}
                                  disabled={!canRecord}
                                  className={`px-2 py-1 text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm transition-all active:scale-95 cursor-pointer border ${
                                    canRecord
                                      ? 'bg-primary-theme hover:bg-primary-theme-hover text-white border-primary-theme'
                                      : 'bg-surface-secondary text-muted border-theme cursor-not-allowed opacity-60'
                                  }`}
                                  title={
                                    recordDisabledReason ??
                                    (lang === 'zh'
                                      ? '将分数和进度作为随堂学习数据存入数据库，记入学期成绩'
                                      : 'Save to DB & Semester grade')
                                  }
                                >
                                  <Database size={11} />
                                  <span>{lang === 'zh' ? '录入成绩' : 'Record'}</span>
                                </button>
                                <button
                                  onClick={() => {
                                    const confirmed = window.confirm(
                                      lang === 'zh'
                                        ? `确定把【${a.studentName}】的「${a.coursewareName}」标记为缺考吗？\n缺考按 0 分计入学期成绩；学生补交不会自动覆盖，教师改判请手动录入。`
                                        : `Mark ${a.studentName} as absent for "${a.coursewareName}"?\nAbsent counts as 0 in semester grades; resubmission won't override it — use manual recording instead.`,
                                    );
                                    if (confirmed) void handleMarkAbsent(a.studentId, a.coursewareId);
                                  }}
                                  className="px-2 py-1 text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm transition-all active:scale-95 cursor-pointer border bg-surface text-muted hover:text-red-600 hover:border-red-200 border-theme"
                                  title={
                                    lang === 'zh'
                                      ? '该生未参加本次课件学习（如缺席），成绩按 0 分计'
                                      : 'Student did not participate (e.g. absent); counts as 0'
                                  }
                                >
                                  <span>{lang === 'zh' ? '标缺考' : 'Absent'}</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()
        )}
      </div>
    </div>
  );
}
