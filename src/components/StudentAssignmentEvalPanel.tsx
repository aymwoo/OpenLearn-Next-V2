import React, { useState, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  MessageSquare, 
  Star, 
  User, 
  RefreshCw, 
  AlertCircle, 
  FileCheck, 
  Award, 
  Clock 
} from 'lucide-react';

interface StudentAssignmentEvalPanelProps {
  lessonId: string;
  studentId: string;
  lang: 'zh' | 'en';
  addToast: (title: string, message: string, type: 'info' | 'success' | 'warning') => void;
}

export function StudentAssignmentEvalPanel({
  lessonId,
  studentId,
  lang,
  addToast
}: StudentAssignmentEvalPanelProps) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [myStatus, setMyStatus] = useState<any>(null);
  const [allSubmissions, setAllSubmissions] = useState<any[]>([]);
  
  // Submit state
  const [filePath, setFilePath] = useState('/files/my-homework.pdf');
  const [submitLoading, setSubmitLoading] = useState(false);

  // Peer review states (mapped by submissionId)
  const [reviewScores, setReviewScores] = useState<Record<string, number>>({});
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [reviewLoading, setReviewLoading] = useState<Record<string, boolean>>({});

  const zh = lang === 'zh';

  const fetchData = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      // 1. Fetch current student's status (my submission, reviews written, final grade)
      const statusRes = await fetch(`/api/lessons/${lessonId}/students/${studentId}/eval-status`);
      const statusData = await statusRes.json();
      setMyStatus(statusData);

      // 2. Fetch all submissions for peer reviews
      const subsRes = await fetch(`/api/lessons/${lessonId}/eval-submissions`);
      const subsData = await subsRes.json();
      setAllSubmissions(subsData);
    } catch (e: any) {
      console.error('Error fetching eval data:', e);
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
    if (lessonId && studentId) {
      fetchData();
    }
  }, [lessonId, studentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filePath.trim()) return;

    setSubmitLoading(true);
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'assignment.submit',
          payload: {
            lessonId,
            studentId,
            filePath: filePath.trim()
          }
        })
      });

      const data = await res.json();
      if (data.success) {
        addToast(
          zh ? '作业提交成功' : 'Assignment Submitted',
          zh ? `成功提交版本 ${data.result.version}！` : `Successfully submitted version ${data.result.version}!`,
          'success'
        );
        fetchData(true);
      } else {
        throw new Error(data.error || 'Failed to submit assignment');
      }
    } catch (err: any) {
      addToast(
        zh ? '提交失败' : 'Submission Failed',
        err.message,
        'warning'
      );
    } finally {
      setSubmitLoading(false);
    }
  };

  const handlePeerReview = async (submissionId: string, peerStudentId: string) => {
    const score = reviewScores[submissionId];
    const comment = reviewComments[submissionId] || '';

    if (score === undefined || isNaN(score) || score < 0 || score > 100) {
      addToast(
        zh ? '评分无效' : 'Invalid Score',
        zh ? '分数必须在 0 到 100 之间！' : 'Score must be between 0 and 100!',
        'warning'
      );
      return;
    }

    setReviewLoading(prev => ({ ...prev, [submissionId]: true }));
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'assignment.peer_review',
          payload: {
            submissionId,
            reviewerId: studentId,
            score: Number(score),
            comment
          }
        })
      });

      const data = await res.json();
      if (data.success) {
        addToast(
          zh ? '互评提交成功' : 'Review Submitted',
          zh ? '成功对同学的作品完成了评价！' : 'Successfully completed review for classmate!',
          'success'
        );
        // Clear inputs for this submission
        setReviewComments(prev => {
          const next = { ...prev };
          delete next[submissionId];
          return next;
        });
        fetchData(true);
      } else {
        throw new Error(data.error || 'Failed to submit review');
      }
    } catch (err: any) {
      addToast(
        zh ? '评价提交失败' : 'Review Failed',
        err.message,
        'warning'
      );
    } finally {
      setReviewLoading(prev => ({ ...prev, [submissionId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-12 text-gray-500">
        <RefreshCw className="animate-spin text-indigo-500 mb-2" size={32} />
        <p>{zh ? '正在读取作业互评状态...' : 'Loading assignment status...'}</p>
      </div>
    );
  }

  const mySubmission = myStatus?.submission;
  const myGrade = myStatus?.grade;
  const myReviewsWritten = myStatus?.reviewsWritten || [];
  
  // Classmate submissions (exclude current student)
  const peerSubmissions = allSubmissions.filter(sub => sub.student_id !== studentId);

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-y-auto pr-2">
      {/* Left Column: My Submission & Grade */}
      <div className="w-full lg:w-5/12 flex flex-col gap-6">
        
        {/* Panel A: Submission upload */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 shadow-3xs text-left">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 select-none">
              <Upload size={16} className="text-indigo-650" />
              {zh ? '我的作业提交' : 'My Assignment Submission'}
            </h3>
            <button 
              onClick={() => fetchData(true)}
              className="p-1 hover:bg-slate-200/50 rounded transition-colors text-slate-550"
              title={zh ? '刷新数据' : 'Refresh Data'}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>

          {mySubmission ? (
            <div className="bg-white border border-slate-200 p-4 rounded-xl space-y-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="bg-emerald-50 text-emerald-600 p-2.5 rounded-lg border border-emerald-100">
                  <FileCheck size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 font-medium">
                    {zh ? '当前已提交版本' : 'Currently Submitted Version'}
                  </p>
                  <p className="text-sm font-semibold text-slate-700 truncate">
                    {mySubmission.file_path.split('/').pop()}
                  </p>
                </div>
                <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-200">
                  V{mySubmission.version}
                </span>
              </div>

              <div className="border-t border-slate-100 pt-2.5 flex justify-between items-center text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {zh ? '更新时间:' : 'Updated At:'} {new Date(mySubmission.updated_at).toLocaleString()}
                </span>
                <span className="font-mono text-slate-350 select-all truncate max-w-[120px]" title={mySubmission.file_path}>
                  {mySubmission.file_path}
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-xl flex items-start gap-3 mb-4 text-left">
              <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={16} />
              <div className="text-xs text-amber-700">
                <p className="font-bold">{zh ? '未提交作业' : 'No Submission Yet'}</p>
                <p className="mt-1">{zh ? '在此上传提交后，其他同学将可以对您的作业进行评分互评。' : 'Once submitted, other students can view and peer-review your work.'}</p>
              </div>
            </div>
          )}

          {/* Form to submit/overwrite */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                {zh ? '输入作品文件路径 / 虚拟路径' : 'Simulated File Path'}
              </label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/files/homework.pdf"
                  required
                  className="flex-1 bg-white border border-slate-200 px-3 py-2 text-xs rounded-lg text-slate-700 focus:outline-none focus:border-indigo-400 font-mono transition-colors"
                />
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="bg-indigo-650 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-3xs"
                >
                  {submitLoading ? (
                    <RefreshCw className="animate-spin" size={13} />
                  ) : (
                    <Upload size={13} />
                  )}
                  {mySubmission ? (zh ? '重新提交' : 'Re-submit') : (zh ? '上传作品' : 'Submit')}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Panel B: My Grade & Review Results */}
        {mySubmission && (
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 shadow-3xs text-left">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-4 select-none">
              <Award size={16} className="text-pink-650" />
              {zh ? '我的平时学习得分' : 'My Score & Feedback'}
            </h3>

            {myGrade ? (
              <div className="space-y-4">
                <div className="bg-white border border-slate-200 p-4 rounded-xl flex items-center justify-between shadow-3xs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      {zh ? '学期对接总分' : 'Weighted Final Grade'}
                    </span>
                    <h2 className="text-3xl font-extrabold text-indigo-700 font-mono mt-1">
                      {myGrade.calculated_final_score} <span className="text-xs text-slate-455 font-normal">/ 100</span>
                    </h2>
                  </div>

                  <div className="text-right">
                    <span className={`inline-block px-2.5 py-1 text-[10px] font-bold rounded-lg border ${
                      myGrade.status === 'confirmed' 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                        : 'bg-amber-50 text-amber-700 border-amber-100'
                    }`}>
                      {myGrade.status === 'confirmed' 
                        ? (zh ? '已确认同步' : 'Synced') 
                        : (zh ? '教师评分草稿' : 'Draft')}
                    </span>
                    <p className="text-[9px] text-slate-400 mt-1.5 font-medium">
                      {zh ? `教师分 ${myGrade.teacher_score} (占 ${(myGrade.teacher_weight*100).toFixed(0)}%)` : `Teacher ${myGrade.teacher_score} (${(myGrade.teacher_weight*100).toFixed(0)}%)`}
                    </p>
                    <p className="text-[9px] text-slate-400 mt-0.5 font-medium">
                      {zh ? `学生互评 (占 ${(myGrade.peer_weight*100).toFixed(0)}%)` : `Peer Review (${(myGrade.peer_weight*100).toFixed(0)}%)`}
                    </p>
                  </div>
                </div>

                {myGrade.teacher_comment && (
                  <div className="bg-slate-100/60 p-3 rounded-lg border border-slate-200 flex gap-2">
                    <MessageSquare size={14} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-bold text-slate-500">{zh ? '教师寄语' : 'Teacher Comments'}</p>
                      <p className="text-xs text-slate-650 mt-0.5">{myGrade.teacher_comment}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-150 p-4 rounded-xl flex items-center justify-center text-slate-400 italic text-xs py-8">
                {zh ? '教师尚未确认最终成绩与权重折算。' : 'Teacher grading is in progress.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Column: Classmates Peer Review */}
      <div className="flex-grow bg-slate-50 border border-slate-200/80 rounded-2xl p-5 shadow-3xs flex flex-col min-h-[400px] text-left">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 mb-4 shrink-0 select-none">
          <User size={16} className="text-teal-650" />
          {zh ? '同学作业互评公开板' : 'Classmate Submissions for Peer Review'}
        </h3>

        {peerSubmissions.length === 0 ? (
          <div className="flex-grow flex items-center justify-center text-slate-400 italic text-xs py-12 border border-dashed border-slate-200 rounded-xl bg-white">
            {zh ? '当前暂无同学提交作业作品。' : 'No classmate submissions available yet.'}
          </div>
        ) : (
          <div className="flex-grow overflow-y-auto space-y-4 pr-1">
            {peerSubmissions.map((peerSub) => {
              // Check if current student already reviewed this classmate
              const existingReview = myReviewsWritten.find((r: any) => r.submission_id === peerSub.id);
              
              // Load form inputs
              const score = reviewScores[peerSub.id] !== undefined 
                ? reviewScores[peerSub.id] 
                : (existingReview ? existingReview.score : 85);
              const comment = reviewComments[peerSub.id] !== undefined 
                ? reviewComments[peerSub.id] 
                : (existingReview ? existingReview.comment : '');
              const submittingReview = reviewLoading[peerSub.id] || false;

              return (
                <div key={peerSub.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-3xs flex flex-col gap-3">
                  {/* Classmate metadata */}
                  <div className="flex justify-between items-start border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs select-none">
                        {peerSub.student_name ? peerSub.student_name[0] : '?'}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-700">
                          {peerSub.student_name || peerSub.student_id}
                        </h4>
                        <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-0.5 truncate max-w-[200px]" title={peerSub.file_path}>
                          <FileText size={11} className="text-slate-350" />
                          {peerSub.file_path.split('/').pop()} (V{peerSub.version})
                        </p>
                      </div>
                    </div>

                    <a 
                      href={peerSub.file_path} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-indigo-650 hover:text-indigo-800 transition-colors border border-indigo-100 px-2 py-1 rounded bg-indigo-50/50 hover:bg-indigo-50"
                    >
                      {zh ? '下载查阅' : 'Download File'}
                    </a>
                  </div>

                  {/* Submission review status */}
                  {existingReview && (
                    <div className="bg-emerald-50/50 border border-emerald-100 p-2.5 rounded-lg flex items-start gap-2 text-xs text-emerald-800">
                      <CheckCircle className="text-emerald-500 shrink-0 mt-0.5" size={14} />
                      <div className="flex-1">
                        <p className="font-bold flex items-center gap-1">
                          {zh ? `我已评分：${existingReview.score} 分` : `My Score: ${existingReview.score} pts`}
                        </p>
                        {existingReview.comment && (
                          <p className="text-[11px] text-emerald-700/80 mt-0.5 italic">
                            "{existingReview.comment}"
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Rating form */}
                  <div className="bg-slate-50/60 border border-slate-100 rounded-lg p-3 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {zh ? '滑动或输入互评分数' : 'Peer Rating'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={score}
                          onChange={(e) => {
                            const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                            setReviewScores(prev => ({ ...prev, [peerSub.id]: val }));
                          }}
                          className="w-12 text-center text-xs font-bold font-mono border border-slate-200 rounded px-1 py-0.5 bg-white text-indigo-750"
                        />
                        <span className="text-[10px] text-slate-400 font-bold">{zh ? '分' : 'pts'}</span>
                      </div>
                    </div>

                    <input 
                      type="range"
                      min="0"
                      max="100"
                      value={score}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setReviewScores(prev => ({ ...prev, [peerSub.id]: val }));
                      }}
                      className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-650"
                    />

                    <div className="flex gap-2">
                      <textarea
                        rows={1}
                        value={comment}
                        onChange={(e) => {
                          setReviewComments(prev => ({ ...prev, [peerSub.id]: e.target.value }));
                        }}
                        placeholder={zh ? '简要评语反馈...' : 'Brief feedback comment...'}
                        className="flex-1 bg-white border border-slate-200 px-2 py-1 text-xs rounded-lg text-slate-700 focus:outline-none focus:border-indigo-400 resize-none transition-colors"
                      />
                      <button
                        onClick={() => handlePeerReview(peerSub.id, peerSub.student_id)}
                        disabled={submittingReview}
                        className="bg-indigo-650 hover:bg-indigo-700 text-white font-bold text-xs px-3 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center"
                      >
                        {submittingReview ? (
                          <RefreshCw className="animate-spin" size={13} />
                        ) : (
                          <Star size={13} />
                        )}
                        <span className="ml-1 shrink-0">{existingReview ? (zh ? '修改评分' : 'Update') : (zh ? '确认提交' : 'Submit')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
