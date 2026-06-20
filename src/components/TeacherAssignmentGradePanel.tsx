import React, { useState, useEffect } from 'react';
import {
  FileText,
  CheckCircle,
  MessageSquare,
  Award,
  RefreshCw,
  AlertCircle,
  Settings2,
  Users,
  ChevronDown,
  ChevronUp,
  Save,
  Send,
  Database,
  ExternalLink
} from 'lucide-react';

interface TeacherAssignmentGradePanelProps {
  lessonId: string;
  lang: 'zh' | 'en';
  addToast: (title: string, message: string, type: 'info' | 'success' | 'warning') => void;
}

export function TeacherAssignmentGradePanel({
  lessonId,
  lang,
  addToast
}: TeacherAssignmentGradePanelProps) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submissions, setSubmissions] = useState<any[]>([]);

  // Default weights (in percent)
  const [defaultTeacherWeight, setDefaultTeacherWeight] = useState<number>(60);
  const [defaultPeerWeight, setDefaultPeerWeight] = useState<number>(40);

  // Form states map by submissionId
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [teacherWeights, setTeacherWeights] = useState<Record<string, number>>({});
  const [peerWeights, setPeerWeights] = useState<Record<string, number>>({});

  // UI state for expanding peer reviews
  const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState<Record<string, 'draft' | 'confirmed' | null>>({});

  const zh = lang === 'zh';

  const fetchData = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const res = await fetch(`/api/lessons/${lessonId}/eval-grades`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setSubmissions(data);

        // Initialize form states
        const initialScores: Record<string, number> = {};
        const initialComments: Record<string, string> = {};
        const initialTeacherWeights: Record<string, number> = {};
        const initialPeerWeights: Record<string, number> = {};

        data.forEach(sub => {
          if (sub.grade) {
            initialScores[sub.id] = sub.grade.teacher_score;
            initialComments[sub.id] = sub.grade.teacher_comment;
            initialTeacherWeights[sub.id] = Math.round(sub.grade.teacher_weight * 100);
            initialPeerWeights[sub.id] = Math.round(sub.grade.peer_weight * 100);
          } else {
            // Default value from local state if not set previously
            initialScores[sub.id] = scores[sub.id] !== undefined ? scores[sub.id] : 80;
            initialComments[sub.id] = comments[sub.id] !== undefined ? comments[sub.id] : '';
            initialTeacherWeights[sub.id] = teacherWeights[sub.id] !== undefined ? teacherWeights[sub.id] : defaultTeacherWeight;
            initialPeerWeights[sub.id] = peerWeights[sub.id] !== undefined ? peerWeights[sub.id] : defaultPeerWeight;
          }
        });

        setScores(prev => ({ ...initialScores, ...prev }));
        setComments(prev => ({ ...initialComments, ...prev }));
        setTeacherWeights(prev => ({ ...initialTeacherWeights, ...prev }));
        setPeerWeights(prev => ({ ...initialPeerWeights, ...prev }));
      } else {
        throw new Error('Invalid submissions data format');
      }
    } catch (e: any) {
      console.error('Error fetching submissions grades:', e);
      addToast(
        zh ? '数据加载失败' : 'Failed to Load Data',
        zh ? '请检查网络连接或刷新页面。' : 'Please check your connection and try again.',
        'warning'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (lessonId) {
      fetchData();
    }
  }, [lessonId]);

  // Sync global default weights to individual students if they don't have grades yet
  const handleDefaultTeacherWeightChange = (val: number) => {
    setDefaultTeacherWeight(val);
    setDefaultPeerWeight(100 - val);

    // Update individual students' weights for those not confirmed/saved
    setTeacherWeights(prev => {
      const next = { ...prev };
      submissions.forEach(sub => {
        if (!sub.grade || sub.grade.status !== 'confirmed') {
          next[sub.id] = val;
        }
      });
      return next;
    });

    setPeerWeights(prev => {
      const next = { ...prev };
      submissions.forEach(sub => {
        if (!sub.grade || sub.grade.status !== 'confirmed') {
          next[sub.id] = 100 - val;
        }
      });
      return next;
    });
  };

  const handleIndividualTeacherWeightChange = (subId: string, val: number) => {
    setTeacherWeights(prev => ({ ...prev, [subId]: val }));
    setPeerWeights(prev => ({ ...prev, [subId]: 100 - val }));
  };

  const handleGrade = async (subId: string, status: 'draft' | 'confirmed') => {
    const teacherScore = scores[subId];
    const teacherComment = comments[subId] || '';
    const tWeight = (teacherWeights[subId] ?? defaultTeacherWeight) / 100;
    const pWeight = (peerWeights[subId] ?? defaultPeerWeight) / 100;

    if (teacherScore === undefined || isNaN(teacherScore) || teacherScore < 0 || teacherScore > 100) {
      addToast(
        zh ? '评分无效' : 'Invalid Score',
        zh ? '教师评分必须在 0 到 100 之间！' : 'Teacher score must be between 0 and 100!',
        'warning'
      );
      return;
    }

    if (status === 'confirmed') {
      const confirmMsg = zh
        ? '确认同步后，最终得分将直接同步写入宿主学期成绩库，此后该学生的作业成绩将锁定不可修改。是否确认？'
        : 'Once confirmed, the final score will be synced to the host semester reports and locked. Proceed?';
      if (!window.confirm(confirmMsg)) {
        return;
      }
    }

    setSubmitting(prev => ({ ...prev, [subId]: status }));
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'assignment.grade',
          payload: {
            submissionId: subId,
            teacherScore: Number(teacherScore),
            teacherComment,
            teacherWeight: tWeight,
            peerWeight: pWeight,
            status
          }
        })
      });

      const data = await res.json();
      if (data.success) {
        addToast(
          status === 'confirmed'
            ? (zh ? '平时成绩同步成功' : 'Semester Grade Synced')
            : (zh ? '平时成绩草稿已保存' : 'Grade Draft Saved'),
          status === 'confirmed'
            ? (zh ? `已将平时成绩 ${data.result.calculatedFinalScore} 分同步至学期报告！` : `Successfully synced grade ${data.result.calculatedFinalScore}!`)
            : (zh ? '成功保存了教师打分与评语草稿。' : 'Successfully saved score and comment draft.'),
          'success'
        );
        fetchData(true);
      } else {
        throw new Error(data.error || 'Failed to submit grade');
      }
    } catch (e: any) {
      addToast(
        zh ? '操作失败' : 'Operation Failed',
        e.message,
        'warning'
      );
    } finally {
      setSubmitting(prev => ({ ...prev, [subId]: null }));
    }
  };

  const toggleReviews = (subId: string) => {
    setExpandedReviews(prev => ({ ...prev, [subId]: !prev[subId] }));
  };

  if (loading) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center py-12 text-gray-500">
        <RefreshCw className="animate-spin text-indigo-500 mb-2" size={32} />
        <p className="text-xs">{zh ? '正在读取学生作业与成绩状态...' : 'Loading student submissions and grades...'}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full relative rounded-xl overflow-hidden border border-slate-200 shadow-md bg-white p-5 text-left">
      {/* Panel Header */}
      <div className="flex justify-between items-center pb-4 border-b border-slate-100 mb-4 gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 select-none">
            <Award size={16} className="text-indigo-655" />
            {zh ? '学生作业成绩评定与折算系统' : 'Student Assignment Grading & Sync'}
          </h3>
          <span className="text-[9px] bg-indigo-50 text-indigo-750 px-2 py-0.5 rounded-full border border-indigo-100 font-bold">
            {submissions.length} {zh ? '个提交' : 'submissions'}
          </span>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-1.5 bg-white hover:bg-slate-55 border border-slate-200 rounded-lg text-slate-600 transition-colors flex items-center justify-center cursor-pointer shadow-4xs"
          title={zh ? '刷新数据' : 'Refresh'}
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Global default weights setup */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <Settings2 className="text-indigo-500 shrink-0 mt-0.5" size={16} />
          <div>
            <h4 className="text-xs font-bold text-slate-700">{zh ? '全局默认折算权重设置' : 'Default Grading Weights Configuration'}</h4>
            <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
              {zh ? '调整权重分配，所有尚未锁定成绩的学生将自动应用此默认权重比例。' : 'Setting global default weights. Changes will automatically apply to non-confirmed grades.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0 bg-white px-3.5 py-2 rounded-lg border border-slate-200 shadow-3xs">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">{zh ? '教师评分:' : 'Teacher:'}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={defaultTeacherWeight}
              onChange={(e) => handleDefaultTeacherWeightChange(Number(e.target.value))}
              className="w-20 accent-indigo-650 cursor-pointer"
            />
            <span className="text-xs font-bold text-indigo-700 w-8 text-right">{defaultTeacherWeight}%</span>
          </div>

          <div className="h-4 w-[1px] bg-slate-200" />

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">{zh ? '学生互评:' : 'Peer Review:'}</span>
            <span className="text-xs font-bold text-slate-700 w-8">{defaultPeerWeight}%</span>
          </div>
        </div>
      </div>

      {/* Main submissions area */}
      <div className="flex-grow flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">
        {submissions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
            <AlertCircle size={32} className="text-slate-350" />
            <p className="text-xs">{zh ? '本节课目前没有任何学生提交作业。' : 'No students have submitted assignments yet for this lesson.'}</p>
          </div>
        ) : (
          submissions.map((sub) => {
            const currentScore = scores[sub.id] !== undefined ? scores[sub.id] : 80;
            const currentComment = comments[sub.id] || '';
            const tWeight = teacherWeights[sub.id] ?? defaultTeacherWeight;
            const pWeight = peerWeights[sub.id] ?? defaultPeerWeight;

            const isConfirmed = sub.grade?.status === 'confirmed';
            
            // Calculate final total preview
            const finalScorePreview = Math.round(
              currentScore * (tWeight / 100) + sub.peerAverageScore * (pWeight / 100)
            );

            return (
              <div key={sub.id} className={`bg-white border rounded-xl shadow-3xs overflow-hidden transition-all ${isConfirmed ? 'border-emerald-200 bg-emerald-50/5' : 'border-slate-200'}`}>
                {/* Top strip */}
                <div className="px-4 py-3 bg-slate-50/50 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs select-none">
                      {sub.studentName?.charAt(0) || 'S'}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800">{sub.studentName}</div>
                      <div className="text-[9px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5">
                        <span>V{sub.version}</span>
                        <span>•</span>
                        <span>{new Date(sub.updatedAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isConfirmed ? (
                      <span className="bg-emerald-55 text-emerald-700 text-[10px] font-black px-2.5 py-1 rounded-full border border-emerald-150 flex items-center gap-1 shadow-3xs select-none">
                        <CheckCircle size={12} />
                        {zh ? '成绩已同步' : 'Synced to Reports'}
                      </span>
                    ) : (
                      <span className="bg-amber-50 text-amber-805 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200/60 select-none">
                        {sub.grade ? (zh ? '草稿状态' : 'Draft') : (zh ? '未评定' : 'Ungraded')}
                      </span>
                    )}
                    
                    <a
                      href={sub.filePath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-indigo-600 hover:text-indigo-850 font-medium hover:underline flex items-center gap-1 bg-white border border-slate-200 px-2 py-1 rounded-lg shadow-4xs"
                      title={sub.filePath}
                    >
                      <FileText size={11} />
                      {zh ? '查看作业' : 'View File'}
                      <ExternalLink size={8} />
                    </a>
                  </div>
                </div>

                {/* Sub Body */}
                <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left part: Peer Reviews */}
                  <div className="lg:col-span-5 flex flex-col gap-2.5 border-r border-slate-100 pr-0 lg:pr-5 text-left">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-bold text-slate-650 flex items-center gap-1 select-none">
                        <Users size={13} className="text-slate-400" />
                        {zh ? '学生互评详情' : 'Peer Review Details'}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                        {zh ? '互评人数:' : 'Reviews:'} {sub.peerReviews.length}
                      </span>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 flex items-center gap-3">
                      <div className="bg-white border border-slate-200 w-12 h-12 rounded-lg flex flex-col items-center justify-center shrink-0 shadow-3xs">
                        <span className="text-[9px] text-slate-405 select-none font-bold">{zh ? '均分' : 'Avg'}</span>
                        <span className="text-sm font-extrabold text-slate-700 leading-none mt-0.5">{sub.peerAverageScore}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-slate-450 leading-normal font-medium">
                          {sub.peerReviews.length > 0 
                            ? (zh ? `根据同学互评分数得出的平均值。` : `Average score computed from classmate evaluations.`)
                            : (zh ? `暂无同学对此作业给出评分。` : `No classmate peer reviews received yet.`)}
                        </p>
                        {sub.peerReviews.length > 0 && (
                          <button
                            onClick={() => toggleReviews(sub.id)}
                            className="text-[10px] text-indigo-650 hover:text-indigo-800 font-bold mt-1.5 flex items-center gap-0.5 cursor-pointer outline-none"
                          >
                            {expandedReviews[sub.id] ? (
                              <>
                                {zh ? '收起互评详情' : 'Hide Details'} <ChevronUp size={12} />
                              </>
                            ) : (
                              <>
                                {zh ? '展开互评详情' : 'Show Details'} <ChevronDown size={12} />
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Collapsible individual reviews */}
                    {expandedReviews[sub.id] && sub.peerReviews.length > 0 && (
                      <div className="mt-2 space-y-2 border-t border-slate-100 pt-2.5 max-h-40 overflow-y-auto scrollbar-thin">
                        {sub.peerReviews.map((rev: any) => (
                          <div key={rev.id} className="bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-left shadow-4xs">
                            <div className="flex justify-between items-center font-bold text-slate-700">
                              <span className="flex items-center gap-1 font-semibold text-slate-655">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                                {rev.reviewer_name}
                              </span>
                              <span className="text-indigo-650 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 text-[10px]">
                                {rev.score} {zh ? '分' : 'pts'}
                              </span>
                            </div>
                            {rev.comment && (
                              <p className="text-[10px] text-slate-550 mt-1 italic pl-2.5 border-l-2 border-slate-100 font-medium">
                                "{rev.comment}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right part: Teacher score input & calculations */}
                  <div className="lg:col-span-7 flex flex-col gap-3 justify-between">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Teacher Score Input */}
                      <div>
                        <label className="block text-[10px] font-bold text-slate-650 mb-1 select-none">
                          {zh ? '教师平时分评分 (0-100)' : 'Teacher Score (0-100)'}
                        </label>
                        <div className="flex gap-2">
                          <input
                            id={`teacher_score_input_${sub.id}`}
                            type="number"
                            min="0"
                            max="100"
                            disabled={isConfirmed}
                            value={currentScore}
                            onChange={(e) => setScores(prev => ({ ...prev, [sub.id]: Math.min(100, Math.max(0, Number(e.target.value))) }))}
                            className="bg-white border border-slate-250 rounded-lg text-xs font-bold text-slate-700 px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none w-20 shadow-4xs disabled:opacity-50 disabled:bg-slate-50"
                          />
                          <input
                            type="range"
                            min="0"
                            max="100"
                            disabled={isConfirmed}
                            value={currentScore}
                            onChange={(e) => setScores(prev => ({ ...prev, [sub.id]: Number(e.target.value) }))}
                            className="flex-1 accent-indigo-650 disabled:opacity-40 cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* Weight micro configuration */}
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-[10px] font-bold text-slate-600 select-none">
                            {zh ? '打分占比 (教师权重)' : 'Teacher Score Weight'}
                          </label>
                          <span className="text-[10px] font-bold text-slate-400">
                            {zh ? `学生互评: ${pWeight}%` : `Peer: ${pWeight}%`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id={`teacher_weight_input_${sub.id}`}
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            disabled={isConfirmed}
                            value={tWeight}
                            onChange={(e) => handleIndividualTeacherWeightChange(sub.id, Number(e.target.value))}
                            className="flex-1 accent-indigo-650 disabled:opacity-40 cursor-pointer"
                          />
                          <span className="text-xs font-extrabold text-indigo-750 w-9 text-right">{tWeight}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Teacher Feedback Comment */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-655 mb-1 select-none">
                        {zh ? '教师评价评语' : 'Teacher Comments & Feedback'}
                      </label>
                      <textarea
                        id={`teacher_comment_input_${sub.id}`}
                        disabled={isConfirmed}
                        value={currentComment}
                        placeholder={zh ? '在此输入对学生作业作品的改进指导意见及评语。' : 'Enter guiding feedback for this student.'}
                        onChange={(e) => setComments(prev => ({ ...prev, [sub.id]: e.target.value }))}
                        rows={2}
                        className="w-full bg-white border border-slate-250 rounded-lg text-xs p-2 focus:ring-1 focus:ring-indigo-500 outline-none shadow-4xs disabled:opacity-50 disabled:bg-slate-50 resize-none font-medium text-slate-700"
                      />
                    </div>

                    {/* Real-time Calculation Sync Strip */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2 border-t border-slate-100 mt-1">
                      {/* Formula preview */}
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg border flex items-center justify-center shrink-0 ${isConfirmed ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
                          <Database size={14} />
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium">
                          <div>
                            {zh ? '平时总分计算公式' : 'Calculated Final Grade'}:
                          </div>
                          <div className="font-bold text-slate-700 mt-0.5 animate-formula">
                            {tWeight}% × <span className="text-indigo-650 font-bold">{currentScore}</span>
                            {sub.peerReviews.length > 0 && ` + ${pWeight}% × ${sub.peerAverageScore}`}
                            {` = `}
                            <span className={isConfirmed ? 'text-emerald-700 font-black text-xs' : 'text-indigo-700 font-black text-xs'}>
                              {isConfirmed ? (sub.grade?.calculated_final_score || finalScorePreview) : finalScorePreview}
                            </span>
                            {zh ? '分' : ' pts'}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      {!isConfirmed && (
                        <div className="flex gap-2 justify-end shrink-0">
                          <button
                            id={`teacher_draft_btn_${sub.id}`}
                            type="button"
                            disabled={!!submitting[sub.id]}
                            onClick={() => handleGrade(sub.id, 'draft')}
                            className="px-3 py-1.5 bg-white border border-slate-350 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-55 flex items-center gap-1.5 shadow-4xs cursor-pointer select-none disabled:opacity-50"
                          >
                            <Save size={12} />
                            {submitting[sub.id] === 'draft' ? (zh ? '保存中...' : 'Saving...') : (zh ? '暂存草稿' : 'Save Draft')}
                          </button>
                          <button
                            id={`teacher_confirm_btn_${sub.id}`}
                            type="button"
                            disabled={!!submitting[sub.id]}
                            onClick={() => handleGrade(sub.id, 'confirmed')}
                            className="px-3.5 py-1.5 bg-indigo-600 border border-indigo-700 rounded-lg text-xs font-bold text-white hover:bg-indigo-700 flex items-center gap-1.5 shadow-3xs cursor-pointer select-none disabled:opacity-50"
                          >
                            <Send size={12} />
                            {submitting[sub.id] === 'confirmed' ? (zh ? '同步中...' : 'Syncing...') : (zh ? '确认并同步' : 'Confirm & Sync')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
