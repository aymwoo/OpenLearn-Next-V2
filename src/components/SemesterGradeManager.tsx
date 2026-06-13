import React, { useState, useEffect } from 'react';
import { 
  ClipboardList, 
  Settings2, 
  Plus, 
  Trash2, 
  Award, 
  Sparkles, 
  Loader2, 
  Check, 
  X, 
  BookOpen, 
  ArrowRight, 
  Save, 
  AlertCircle,
  TrendingUp,
  AwardIcon
} from 'lucide-react';

interface Student {
  id: string;
  name: string;
  student_number?: string;
}

interface SemesterGradeManagerProps {
  classId: string;
  className: string;
  students: Student[];
  lang: 'zh' | 'en';
}

interface GradeWeights {
  attendance_weight: number;
  progress_weight: number;
  assignment_weight: number;
  exam_weight: number;
}

interface StudentGradeReport {
  studentId: string;
  studentName: string;
  studentNumber: string;
  attendanceScore: number;
  progressScore: number;
  assignmentScore: number;
  examScore: number;
  totalScore: number;
  gradeLevel: string;
  teacherEvaluation: string;
  aiEvaluation: string;
  isArchived: boolean;
}

interface Exam {
  id: string;
  title: string;
  description: string;
  max_score: number;
  created_at: number;
}

export function SemesterGradeManager({ classId, className, students, lang }: SemesterGradeManagerProps) {
  // Tab states: 'overview' | 'exams' | 'weights'
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'exams' | 'weights'>('overview');
  const [semesterName, setSemesterName] = useState('2026年春季学期');
  
  // Loading & Message states
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  
  // Grade reports & weights states
  const [gradeReports, setGradeReports] = useState<StudentGradeReport[]>([]);
  const [weights, setWeights] = useState<GradeWeights>({
    attendance_weight: 0.15,
    progress_weight: 0.25,
    assignment_weight: 0.35,
    exam_weight: 0.25
  });

  // Weights configuration inputs (temporary percentages)
  const [weightInputs, setWeightInputs] = useState({
    attendance: '15',
    progress: '25',
    assignment: '35',
    exam: '25'
  });

  // Exams states
  const [exams, setExams] = useState<Exam[]>([]);
  const [showAddExam, setShowAddExam] = useState(false);
  const [newExamTitle, setNewExamTitle] = useState('');
  const [newExamDesc, setNewExamDesc] = useState('');
  const [newExamMaxScore, setNewExamMaxScore] = useState(100);
  
  // Enter exam score states
  const [activeScoreExam, setActiveScoreExam] = useState<Exam | null>(null);
  const [examStudentScores, setExamStudentScores] = useState<Record<string, { score: string; notes: string }>>({});

  // AI loading status for each student
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});

  // Fetch weights and grades on mount
  useEffect(() => {
    fetchGradesAndWeights();
    fetchExams();
  }, [classId, semesterName]);

  const fetchGradesAndWeights = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/classes/${classId}/semester-grades?semesterName=${encodeURIComponent(semesterName)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setGradeReports(data.students);
          setWeights(data.weights);
          setWeightInputs({
            attendance: Math.round(data.weights.attendance_weight * 100).toString(),
            progress: Math.round(data.weights.progress_weight * 100).toString(),
            assignment: Math.round(data.weights.assignment_weight * 100).toString(),
            exam: Math.round(data.weights.exam_weight * 100).toString()
          });
        }
      }
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: lang === 'zh' ? '获取成绩数据失败' : 'Failed to fetch grade data' });
    } finally {
      setLoading(false);
    }
  };

  const fetchExams = async () => {
    try {
      const response = await fetch(`/api/classes/${classId}/exams`);
      if (response.ok) {
        const data = await response.json();
        setExams(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Weight updates
  const handleSaveWeights = async () => {
    const att = Number(weightInputs.attendance);
    const prog = Number(weightInputs.progress);
    const assign = Number(weightInputs.assignment);
    const ex = Number(weightInputs.exam);

    const sum = att + prog + assign + ex;
    if (sum !== 100) {
      setMessage({
        type: 'error',
        text: lang === 'zh' ? '四项权重比例相加必须等于 100%' : 'All four weights must sum up to 100%'
      });
      return;
    }

    try {
      const response = await fetch(`/api/classes/${classId}/grade-weights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendance_weight: att / 100,
          progress_weight: prog / 100,
          assignment_weight: assign / 100,
          exam_weight: ex / 100
        })
      });

      if (response.ok) {
        setMessage({
          type: 'success',
          text: lang === 'zh' ? '🎉 权重设置保存成功！' : '🎉 Grade weights saved successfully!'
        });
        fetchGradesAndWeights();
      } else {
        throw new Error();
      }
    } catch {
      setMessage({ type: 'error', text: lang === 'zh' ? '保存权重失败' : 'Failed to save weights' });
    }
  };

  // Add a new exam
  const handleAddExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExamTitle.trim()) return;

    try {
      const response = await fetch(`/api/classes/${classId}/exams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newExamTitle,
          description: newExamDesc,
          max_score: newExamMaxScore
        })
      });

      if (response.ok) {
        setMessage({ type: 'success', text: lang === 'zh' ? '🎉 测试卷创建成功！' : '🎉 Exam created successfully!' });
        setShowAddExam(false);
        setNewExamTitle('');
        setNewExamDesc('');
        setNewExamMaxScore(100);
        fetchExams();
        fetchGradesAndWeights();
      }
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: lang === 'zh' ? '添加测试卷失败' : 'Failed to add exam' });
    }
  };

  // Open enter scores panel
  const handleOpenScores = async (exam: Exam) => {
    setActiveScoreExam(exam);
    try {
      const response = await fetch(`/api/exams/${exam.id}/scores`);
      if (response.ok) {
        const scoresData = await response.json();
        const scoreMap: Record<string, { score: string; notes: string }> = {};
        students.forEach(s => {
          scoreMap[s.id] = { score: '', notes: '' };
        });
        scoresData.forEach((s: any) => {
          scoreMap[s.student_id] = {
            score: s.score !== null && s.score !== undefined ? s.score.toString() : '',
            notes: s.notes || ''
          };
        });
        setExamStudentScores(scoreMap);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Save exam scores
  const handleSaveScores = async () => {
    if (!activeScoreExam) return;

    const payload = Object.entries(examStudentScores).map(([studentId, val]) => {
      const data = val as { score: string; notes: string };
      return {
        studentId,
        score: data.score.trim() === '' ? null : Number(data.score),
        notes: data.notes
      };
    });

    try {
      const response = await fetch(`/api/exams/${activeScoreExam.id}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: payload })
      });

      if (response.ok) {
        setMessage({ type: 'success', text: lang === 'zh' ? '🎉 分数录入保存成功！' : '🎉 Scores saved successfully!' });
        setActiveScoreExam(null);
        fetchGradesAndWeights();
      }
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: lang === 'zh' ? '保存分数失败' : 'Failed to save scores' });
    }
  };

  // Generate AI comment for a student
  const handleGenerateAIComment = async (studentId: string) => {
    setAiLoading(prev => ({ ...prev, [studentId]: true }));
    try {
      const response = await fetch(`/api/classes/${classId}/students/${studentId}/semester-ai-evaluation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ semesterName })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.aiEvaluation) {
          // Update AI comment in local state
          setGradeReports(prev => prev.map(report => {
            if (report.studentId === studentId) {
              return { ...report, aiEvaluation: data.aiEvaluation };
            }
            return report;
          }));
          setMessage({
            type: 'success',
            text: lang === 'zh' ? '✨ AI 评语已成功生成！' : '✨ AI evaluation generated!'
          });
        }
      } else {
        const err = await response.json();
        throw new Error(err.error || 'AI request failed');
      }
    } catch (e: any) {
      console.error(e);
      setMessage({
        type: 'error',
        text: lang === 'zh' 
          ? `AI 生成评语失败: ${e.message || '请确保已配置 AI Provider'}` 
          : `AI Generation failed: ${e.message || 'Check AI configurations'}`
      });
    } finally {
      setAiLoading(prev => ({ ...prev, [studentId]: false }));
    }
  };

  // Update teacher manual comment
  const handleTeacherCommentChange = (studentId: string, value: string) => {
    setGradeReports(prev => prev.map(report => {
      if (report.studentId === studentId) {
        return { ...report, teacherEvaluation: value };
      }
      return report;
    }));
  };

  // Save/Archive all reports
  const handleArchiveReports = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/classes/${classId}/semester-reports/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semesterName,
          reports: gradeReports
        })
      });

      if (response.ok) {
        setMessage({
          type: 'success',
          text: lang === 'zh' ? '💾 学期成绩与评语已归档保存成功！' : '💾 Semester reports saved and archived!'
        });
        fetchGradesAndWeights();
      }
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: lang === 'zh' ? '归档保存失败' : 'Failed to archive reports' });
    } finally {
      setLoading(false);
    }
  };

  const currentTotalWeight = Number(weightInputs.attendance) + Number(weightInputs.progress) + Number(weightInputs.assignment) + Number(weightInputs.exam);

  return (
    <div className="flex-1 flex flex-col font-sans p-4 bg-white select-none">
      {/* Top Header Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 mb-4 gap-3 shrink-0 text-left">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
            <ClipboardList size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 text-left">
              {lang === 'zh' ? `【${className}】期末综合总评与计算` : `Semester Grade: ${className}`}
            </h2>
            <p className="text-[10px] text-slate-400 mt-0.5 text-left">
              {lang === 'zh' ? '多维度评估学生考勤率、课程进度、作业以及考试分数' : 'Assess attendance, progress, assignments, and test scores'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {lang === 'zh' ? '学期名' : 'Semester'}
          </label>
          <select
            value={semesterName}
            onChange={(e) => setSemesterName(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg py-1 px-2.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
          >
            <option value="2026年春季学期">2026年春季学期</option>
            <option value="2025年秋季学期">2025年秋季学期</option>
            <option value="2025年春季学期">2025年春季学期</option>
          </select>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div className={`p-3 text-xs mb-4 rounded-xl border flex items-center justify-between animate-in slide-in-from-top-2 duration-200 shrink-0 ${
          message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
          message.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <div className="flex items-center gap-2">
            <AlertCircle size={14} />
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="hover:opacity-70">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Mode Switches */}
      <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl mb-4 self-start border border-slate-200/20 shrink-0">
        <button
          onClick={() => { setActiveSubTab('overview'); setActiveScoreExam(null); }}
          className={`py-1 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeSubTab === 'overview'
              ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/30'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Award size={12} />
          <span>{lang === 'zh' ? '成绩总览与评语' : 'Grades & Evaluatons'}</span>
        </button>
        <button
          onClick={() => { setActiveSubTab('exams'); setActiveScoreExam(null); }}
          className={`py-1 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeSubTab === 'exams'
              ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/30'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen size={12} />
          <span>{lang === 'zh' ? '测试卷录分' : 'Exams & Quizzes'}</span>
        </button>
        <button
          onClick={() => { setActiveSubTab('weights'); setActiveScoreExam(null); }}
          className={`py-1 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeSubTab === 'weights'
              ? 'bg-white text-indigo-600 shadow-xs font-bold border border-slate-200/30'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Settings2 size={12} />
          <span>{lang === 'zh' ? '计算权重配比' : 'Formula Weights'}</span>
        </button>
      </div>

      {/* Sub Tabs Panels */}
      <div className="flex-1 overflow-y-auto min-h-0 text-left">
        {loading ? (
          <div className="h-48 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin text-indigo-600" size={20} />
            <span className="text-xs text-slate-500">{lang === 'zh' ? '正在计算中，请稍候...' : 'Computing semester grades...'}</span>
          </div>
        ) : activeSubTab === 'overview' ? (
          <div className="flex flex-col gap-4 h-full">
            {/* Grid stats overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 shrink-0 text-left">
              <div className="bg-slate-50/50 border border-slate-200/40 p-3 rounded-2xl">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide text-left">{lang === 'zh' ? '出勤均分权重' : 'Attendance Weight'}</div>
                <div className="text-base font-black text-slate-800 mt-1 text-left">{Math.round(weights.attendance_weight * 100)}%</div>
              </div>
              <div className="bg-slate-50/50 border border-slate-200/40 p-3 rounded-2xl">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide text-left">{lang === 'zh' ? '课程进度权重' : 'Progress Weight'}</div>
                <div className="text-base font-black text-slate-800 mt-1 text-left">{Math.round(weights.progress_weight * 100)}%</div>
              </div>
              <div className="bg-slate-50/50 border border-slate-200/40 p-3 rounded-2xl">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide text-left">{lang === 'zh' ? '作业成绩权重' : 'Assignments Weight'}</div>
                <div className="text-base font-black text-slate-800 mt-1 text-left">{Math.round(weights.assignment_weight * 100)}%</div>
              </div>
              <div className="bg-slate-50/50 border border-slate-200/40 p-3 rounded-2xl">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide text-left">{lang === 'zh' ? '测验考试权重' : 'Exams Weight'}</div>
                <div className="text-base font-black text-slate-800 mt-1 text-left">{Math.round(weights.exam_weight * 100)}%</div>
              </div>
            </div>

            {/* Main reports table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs bg-white">
              <div className="max-w-full overflow-x-auto">
                <table className="w-full text-left border-collapse table-auto text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-gray-500 font-bold text-[10px] uppercase tracking-wide">
                      <th className="p-3 w-[70px]">{lang === 'zh' ? '学号' : 'ID'}</th>
                      <th className="p-3 w-[90px]">{lang === 'zh' ? '姓名' : 'Name'}</th>
                      <th className="p-3 text-center w-[75px]">{lang === 'zh' ? '考勤分' : 'Attn'}</th>
                      <th className="p-3 text-center w-[75px]">{lang === 'zh' ? '进度分' : 'Prog'}</th>
                      <th className="p-3 text-center w-[75px]">{lang === 'zh' ? '作业分' : 'Assgn'}</th>
                      <th className="p-3 text-center w-[75px]">{lang === 'zh' ? '测验分' : 'Exam'}</th>
                      <th className="p-3 text-center w-[80px]">{lang === 'zh' ? '总评得分' : 'Total'}</th>
                      <th className="p-3 text-center w-[60px]">{lang === 'zh' ? '等级' : 'Grade'}</th>
                      <th className="p-3">{lang === 'zh' ? '手写评语 / AI 温馨期末评语' : 'Teacher & AI Evaluation Comments'}</th>
                      <th className="p-3 text-center w-[100px]">{lang === 'zh' ? 'AI 评价' : 'AI Bot'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {gradeReports.map(report => (
                      <tr key={report.studentId} className="hover:bg-slate-50/40 transition-colors">
                        <td className="p-3 font-mono text-slate-400 text-[10px]">{report.studentNumber || '-'}</td>
                        <td className="p-3 font-bold text-slate-800">{report.studentName}</td>
                        <td className="p-3 text-center font-medium text-slate-600">{report.attendanceScore}分</td>
                        <td className="p-3 text-center font-medium text-slate-600">{report.progressScore}分</td>
                        <td className="p-3 text-center font-medium text-slate-600">{report.assignmentScore}分</td>
                        <td className="p-3 text-center font-medium text-slate-600">{report.examScore}分</td>
                        <td className="p-3 text-center font-extrabold text-indigo-700 bg-indigo-50/20">{report.totalScore}分</td>
                        <td className="p-3 text-center">
                          <span className={`inline-block w-6 h-6 leading-6 text-center rounded-lg font-black text-xs ${
                            report.gradeLevel === 'A' ? 'bg-emerald-100 text-emerald-800' :
                            report.gradeLevel === 'B' ? 'bg-sky-100 text-sky-800' :
                            report.gradeLevel === 'C' ? 'bg-amber-100 text-amber-800' :
                            report.gradeLevel === 'D' ? 'bg-orange-100 text-orange-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {report.gradeLevel}
                          </span>
                        </td>
                        <td className="p-3 space-y-2 text-left">
                          <input
                            type="text"
                            value={report.teacherEvaluation}
                            onChange={(e) => handleTeacherCommentChange(report.studentId, e.target.value)}
                            placeholder={lang === 'zh' ? '输入老师手写附加评语...' : 'Write custom teacher evaluation...'}
                            className="w-full bg-slate-50 border border-slate-150 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans text-gray-750"
                          />
                          {report.aiEvaluation && (
                            <div className="bg-amber-50/50 border border-amber-100 text-amber-900 rounded-xl p-2.5 text-[11px] leading-relaxed relative animate-in fade-in slide-in-from-left-2 duration-200 text-left">
                              <div className="font-bold text-amber-800 mb-1 flex items-center gap-1 justify-start">
                                <Sparkles size={10} className="text-amber-500 shrink-0" />
                                <span>{lang === 'zh' ? 'AI 温馨推荐评语 (鼓励性)：' : 'AI Suggested evaluation:'}</span>
                              </div>
                              <p className="italic font-medium text-left">{report.aiEvaluation}</p>
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleGenerateAIComment(report.studentId)}
                            disabled={aiLoading[report.studentId]}
                            className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white rounded-xl text-[10px] font-black cursor-pointer shadow-xs hover:shadow-sm transition-all flex items-center justify-center gap-1 w-full disabled:cursor-not-allowed"
                          >
                            {aiLoading[report.studentId] ? (
                              <Loader2 className="animate-spin text-white" size={10} />
                            ) : (
                              <Sparkles size={10} />
                            )}
                            <span>{lang === 'zh' ? '一键生成评语' : 'AI Gen'}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {gradeReports.length === 0 && (
                      <tr>
                        <td colSpan={10} className="p-8 text-center text-xs text-slate-400">
                          {lang === 'zh' ? '当前班级内暂无学生数据' : 'No student reports available'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom Actions */}
            {gradeReports.length > 0 && (
              <div className="flex justify-end gap-2 mt-4 shrink-0">
                <button
                  onClick={handleArchiveReports}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 px-6 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Save size={14} />
                  <span>{lang === 'zh' ? '归档学期成绩与评语' : 'Archive Semester Reports'}</span>
                </button>
              </div>
            )}
          </div>
        ) : activeSubTab === 'exams' ? (
          <div className="flex flex-col gap-4 h-full">
            {activeScoreExam ? (
              /* Score recording panel */
              <div className="bg-slate-50/50 border border-slate-200 p-5 rounded-2xl animate-in zoom-in-95 duration-200 text-left">
                <div className="flex justify-between items-center border-b border-slate-200 pb-3 mb-4">
                  <div className="text-left">
                    <h3 className="text-xs font-black text-slate-800 flex items-center gap-1 justify-start">
                      <BookOpen size={14} className="text-indigo-600 shrink-0" />
                      <span>{lang === 'zh' ? `录分中: 【${activeScoreExam.title}】` : `Entering scores: ${activeScoreExam.title}`}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-1 text-left">
                      {lang === 'zh' ? `满分：${activeScoreExam.max_score} 分` : `Max score: ${activeScoreExam.max_score}`}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveScoreExam(null)}
                    className="p-1 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="max-h-96 overflow-y-auto mb-4 border border-slate-250/60 rounded-xl bg-white">
                  <table className="w-full text-left border-collapse table-auto text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-gray-500 font-semibold text-[10px] uppercase tracking-wide">
                        <th className="p-3">{lang === 'zh' ? '学号' : 'Student ID'}</th>
                        <th className="p-3">{lang === 'zh' ? '姓名' : 'Student Name'}</th>
                        <th className="p-3 text-center w-[120px]">{lang === 'zh' ? '考试得分' : 'Score'}</th>
                        <th className="p-3">{lang === 'zh' ? '得分批注 / 备注' : 'Notes'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students.map(s => {
                        const studentScore = examStudentScores[s.id] || { score: '', notes: '' };
                        return (
                          <tr key={s.id} className="hover:bg-slate-50/20">
                            <td className="p-3 font-mono text-[10px] text-slate-400">{s.student_number || '-'}</td>
                            <td className="p-3 font-bold text-slate-800">{s.name}</td>
                            <td className="p-3 text-center">
                              <div className="inline-flex items-center gap-1.5 justify-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={activeScoreExam.max_score}
                                  value={studentScore.score}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setExamStudentScores(prev => ({
                                      ...prev,
                                      [s.id]: { ...prev[s.id], score: val }
                                    }));
                                  }}
                                  className="w-16 bg-white border border-gray-200 rounded-lg p-1.5 text-center text-xs focus:ring-1 focus:ring-indigo-500 text-gray-800 font-bold"
                                />
                                <span className="text-[10px] text-slate-400">/ {activeScoreExam.max_score}</span>
                              </div>
                            </td>
                            <td className="p-3">
                              <input
                                type="text"
                                value={studentScore.notes}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setExamStudentScores(prev => ({
                                    ...prev,
                                    [s.id]: { ...prev[s.id], notes: val }
                                  }));
                                }}
                                placeholder={lang === 'zh' ? '记入平时发挥、缺考、复习等备注...' : 'Enter note (e.g. absent, late)...'}
                                className="w-full bg-slate-50 border border-slate-150 rounded-lg p-1.5 text-xs focus:outline-none text-gray-700"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setActiveScoreExam(null)}
                    className="border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs py-2 px-4 font-bold cursor-pointer transition-colors"
                  >
                    {lang === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleSaveScores}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs py-2 px-4 font-bold cursor-pointer transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <Save size={12} />
                    <span>{lang === 'zh' ? '保存分数' : 'Save Scores'}</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Exams list & create form */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                {/* Exams List column */}
                <div className="md:col-span-2 flex flex-col gap-3">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                      {lang === 'zh' ? '测试卷列表' : 'Exam Papers List'}
                    </h3>
                    <button
                      onClick={() => setShowAddExam(!showAddExam)}
                      className="text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2 py-1 rounded-lg font-black flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Plus size={10} />
                      <span>{lang === 'zh' ? '创建测试卷' : 'Add Test'}</span>
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">
                    {exams.map(exam => (
                      <div key={exam.id} className="bg-slate-50/50 border border-slate-200 rounded-2xl p-4 flex justify-between items-center hover:bg-slate-50 hover:border-slate-350 transition-all text-left">
                        <div className="space-y-1 text-left">
                          <h4 className="text-xs font-bold text-slate-800 text-left">{exam.title}</h4>
                          {exam.description && (
                            <p className="text-[10px] text-slate-400 leading-normal text-left">{exam.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2 justify-start">
                            <span className="inline-block bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-lg text-[9px] font-bold">
                              {lang === 'zh' ? `总分: ${exam.max_score}分` : `Max: ${exam.max_score}`}
                            </span>
                            <span className="text-[9px] text-slate-400">
                              {new Date(exam.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleOpenScores(exam)}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs py-1.5 px-4 font-bold cursor-pointer shadow-sm transition-colors hover:shadow-md shrink-0 flex items-center gap-1"
                        >
                          <AwardIcon size={12} />
                          <span>{lang === 'zh' ? '登分' : 'Scores'}</span>
                        </button>
                      </div>
                    ))}

                    {exams.length === 0 && (
                      <div className="text-center p-8 border border-dashed border-slate-250 rounded-2xl text-xs text-slate-400">
                        {lang === 'zh' ? '本学期暂未建立任何测试卷，请点击上方“创建测试卷”新增。' : 'No exam records yet. Click Add Test to get started.'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Add Exam panel */}
                {showAddExam && (
                  <form onSubmit={handleAddExam} className="bg-slate-50/50 border border-slate-200 p-4 rounded-2xl flex flex-col gap-4 animate-in slide-in-from-right-3 duration-200 h-fit text-left">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1 pb-2 border-b border-slate-200 justify-start">
                      <Plus size={14} className="text-indigo-600" />
                      <span>{lang === 'zh' ? '创建新测试卷/期中试卷' : 'Add New Exam'}</span>
                    </h3>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 text-left">{lang === 'zh' ? '试卷名称 *' : 'Title *'}</label>
                      <input
                        type="text"
                        required
                        value={newExamTitle}
                        onChange={(e) => setNewExamTitle(e.target.value)}
                        placeholder={lang === 'zh' ? '例如：期中信息技术测验' : 'e.g. Midterm Quiz'}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 text-left">{lang === 'zh' ? '描述信息' : 'Description'}</label>
                      <textarea
                        value={newExamDesc}
                        onChange={(e) => setNewExamDesc(e.target.value)}
                        placeholder={lang === 'zh' ? '对本次考试说明或备注...' : 'Exam notes...'}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-700 min-h-16"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1 text-left">{lang === 'zh' ? '最高总分 (满分)' : 'Max Score'}</label>
                      <input
                        type="number"
                        min={1}
                        value={newExamMaxScore}
                        onChange={(e) => setNewExamMaxScore(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none text-gray-800 font-bold"
                      />
                    </div>

                    <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => setShowAddExam(false)}
                        className="border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs py-1.5 px-3 font-semibold cursor-pointer transition-colors"
                      >
                        {lang === 'zh' ? '取消' : 'Cancel'}
                      </button>
                      <button
                        type="submit"
                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs py-1.5 px-4 font-bold cursor-pointer transition-colors shadow-sm"
                      >
                        {lang === 'zh' ? '创建试卷' : 'Create'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Weights settings panel */
          <div className="max-w-md bg-slate-50/30 border border-slate-200 rounded-2xl p-5 shadow-2xs text-left">
            <h3 className="text-xs font-black text-slate-800 flex items-center gap-1.5 border-b border-slate-200 pb-3 mb-4 justify-start">
              <Settings2 size={16} className="text-indigo-500" />
              <span>{lang === 'zh' ? '自定义期末成绩计算公式权重' : 'Configure Grading Weights'}</span>
            </h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-150">
                <div className="text-xs font-bold text-slate-700">{lang === 'zh' ? '📅 考勤率占比' : 'Attendance Weight'}</div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weightInputs.attendance}
                    onChange={(e) => setWeightInputs(prev => ({ ...prev, attendance: e.target.value }))}
                    className="w-16 bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs focus:ring-1 focus:ring-indigo-500 font-bold text-gray-800"
                  />
                  <span className="text-xs text-slate-400">%</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-150">
                <div className="text-xs font-bold text-slate-700">{lang === 'zh' ? '📈 学习进度占比' : 'Progress Weight'}</div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weightInputs.progress}
                    onChange={(e) => setWeightInputs(prev => ({ ...prev, progress: e.target.value }))}
                    className="w-16 bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs focus:ring-1 focus:ring-indigo-500 font-bold text-gray-800"
                  />
                  <span className="text-xs text-slate-400">%</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-150">
                <div className="text-xs font-bold text-slate-700">{lang === 'zh' ? '📝 作业平均分占比' : 'Assignments Weight'}</div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weightInputs.assignment}
                    onChange={(e) => setWeightInputs(prev => ({ ...prev, assignment: e.target.value }))}
                    className="w-16 bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs focus:ring-1 focus:ring-indigo-500 font-bold text-gray-800"
                  />
                  <span className="text-xs text-slate-400">%</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-150">
                <div className="text-xs font-bold text-slate-700">{lang === 'zh' ? '💯 考试测验分占比' : 'Exams Weight'}</div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weightInputs.exam}
                    onChange={(e) => setWeightInputs(prev => ({ ...prev, exam: e.target.value }))}
                    className="w-16 bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-center text-xs focus:ring-1 focus:ring-indigo-500 font-bold text-gray-800"
                  />
                  <span className="text-xs text-slate-400">%</span>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-200 flex items-center justify-between">
              <div className="text-xs">
                <span className="text-slate-400">{lang === 'zh' ? '当前总权重和：' : 'Total sum: '}</span>
                <span className={`font-black text-sm ${currentTotalWeight === 100 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {currentTotalWeight}%
                </span>
              </div>

              <button
                onClick={handleSaveWeights}
                disabled={currentTotalWeight !== 100}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white font-bold text-xs py-2 px-5 rounded-xl cursor-pointer transition-all flex items-center gap-1 shadow-sm disabled:cursor-not-allowed"
              >
                <Check size={12} />
                <span>{lang === 'zh' ? '更新计算公式' : 'Apply Formula'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
