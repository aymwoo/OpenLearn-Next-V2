import React, { useState, useEffect } from 'react';
import { Lock, User, Users, Shield, GraduationCap, ArrowRight, AlertCircle, Sparkles } from 'lucide-react';

interface Student {
  id: string;
  name: string;
  email: string;
}

interface LoginPageProps {
  onLoginSuccess: (session: {
    role: 'teacher' | 'student';
    userId?: string;
    username?: string;
    subRole?: 'administrator' | 'teacher';
    name: string;
    studentId?: string;
    email?: string;
  }) => void;
  lang: 'zh' | 'en';
}

export function LoginPage({ onLoginSuccess, lang }: LoginPageProps) {
  const [activeTab, setActiveTab] = useState<'teacher' | 'student'>('teacher');
  
  // Teacher credentials state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [teacherError, setTeacherError] = useState('');
  const [teacherSubmitting, setTeacherSubmitting] = useState(false);

  // Student list state
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [manualStudentId, setManualStudentId] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [studentError, setStudentError] = useState('');
  const [studentSubmitting, setStudentSubmitting] = useState(false);

  useEffect(() => {
    // Fetch students list for easy sandbox entry
    const fetchStudents = async () => {
      try {
        const res = await fetch('/api/students');
        if (res.ok) {
          const data = await res.json();
          setStudents(data);
          if (data.length > 0) {
            setSelectedStudentId(data[0].id);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch student roster for login selection:', err);
      }
    };
    fetchStudents();
  }, []);

  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setTeacherError(lang === 'zh' ? '请输入完整的用户名和密码。' : 'Please fill in both key fields.');
      return;
    }

    try {
      setTeacherError('');
      setTeacherSubmitting(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entrance: 'teacher',
          username: username.trim(),
          password: password
        })
      });

      if (res.ok) {
        const data = await res.json();
        onLoginSuccess({
          role: 'teacher',
          userId: data.userId,
          username: data.username,
          subRole: data.subRole, // 'administrator' | 'teacher'
          name: data.name
        });
      } else {
        const errData = await res.json();
        setTeacherError(errData.error || (lang === 'zh' ? '用户名或密码不正确' : 'Invalid username or password'));
      }
    } catch (err) {
      setTeacherError(lang === 'zh' ? '网络连接异常，请重试' : 'Network communication failure. Please try again.');
    } finally {
      setTeacherSubmitting(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalStudentId = selectedStudentId || manualStudentId.trim();
    if (!finalStudentId) {
      setStudentError(lang === 'zh' ? '请选择或输入学号/学生标识。' : 'Please select or enter your Student ID.');
      return;
    }
    if (!studentPassword.trim()) {
      setStudentError(lang === 'zh' ? '请输入个人密码或临时班级密码。' : 'Please enter your personal password or temporary class passcode.');
      return;
    }

    try {
      setStudentError('');
      setStudentSubmitting(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entrance: 'student',
          studentId: finalStudentId,
          password: studentPassword.trim()
        })
      });

      if (res.ok) {
        const data = await res.json();
        onLoginSuccess({
          role: 'student',
          studentId: data.studentId,
          name: data.name,
          email: data.email
        });
      } else {
        const errData = await res.json();
        setStudentError(errData.error || (lang === 'zh' ? '找不到该学生记录' : 'Student record not found'));
      }
    } catch (err) {
      setStudentError(lang === 'zh' ? '网络连接异常，请重试' : 'Network connection failure. Please try again.');
    } finally {
      setStudentSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans" id="login_page_container">
      {/* Background Decorative Blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40rem] h-[40rem] rounded-full bg-indigo-500/10 blur-3xl -z-10" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[35rem] h-[35rem] rounded-full bg-violet-500/10 blur-3xl -z-10" />

      <div className="w-full max-w-md bg-slate-950/85 backdrop-blur-md rounded-2xl border border-slate-800 shadow-2xl p-6 sm:p-8" id="login_card">
        {/* App Greeting/Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-gradient-to-tr from-indigo-500 to-indigo-600 rounded-2xl shadow-lg border border-indigo-400/20 mb-4 text-white">
            <GraduationCap size={32} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center justify-center gap-2">
            AI EDU OS <span className="text-indigo-400 font-medium text-xs bg-indigo-500/20 px-2 py-0.5 rounded-full border border-indigo-400/20">V1.5</span>
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-2">
            {lang === 'zh' ? '智能教室分布式操作系统' : 'Intelligent Classroom Distributed OS Platform'}
          </p>
        </div>

        {/* Custom Tab Switcher */}
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 gap-1 mb-6">
          <button
            onClick={() => setActiveTab('teacher')}
            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 focus:outline-none ${
              activeTab === 'teacher'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Shield size={14} />
            {lang === 'zh' ? '教师与管理端' : 'Teacher / Staff Portal'}
          </button>
          
          <button
            onClick={() => setActiveTab('student')}
            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 focus:outline-none ${
              activeTab === 'student'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Users size={14} />
            {lang === 'zh' ? '学生自助端' : 'Student Self-Service'}
          </button>
        </div>

        {activeTab === 'teacher' ? (
          /* TEACHER LOGIN FORM */
          <form onSubmit={handleTeacherLogin} className="space-y-4">
            {teacherError && (
              <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{teacherError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <User size={13} />
                {lang === 'zh' ? '教工账户名 / username' : 'Staff Username'}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={lang === 'zh' ? '默认管理员: admin / 普通教师: teacher' : 'e.g. admin or teacher'}
                className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-xs sm:text-sm p-3 text-white outline-none placeholder-slate-500 transition-colors"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <Lock size={13} />
                {lang === 'zh' ? '输入登录密码 / password' : 'Access Password'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={lang === 'zh' ? '默认管理员: admin / 普通教师: teacher' : 'e.g. admin or teacher'}
                className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-xs sm:text-sm p-3 text-white outline-none placeholder-slate-500 transition-colors"
                required
              />
            </div>

            <button
              type="submit"
              disabled={teacherSubmitting}
              className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
            >
              <span>{teacherSubmitting ? (lang === 'zh' ? '鉴权登录中...' : 'Authorizing...') : (lang === 'zh' ? '安全验证登录' : 'Authorized Sign In')}</span>
              <ArrowRight size={15} />
            </button>
          </form>
        ) : (
          /* STUDENT LOGIN FORM */
          <form onSubmit={handleStudentLogin} className="space-y-4">
            {studentError && (
              <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{studentError}</span>
              </div>
            )}

            {students.length > 0 ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                  <GraduationCap size={14} />
                  {lang === 'zh' ? '从学生花名册中快速选择' : 'Quick Access Student Select'}
                </label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => {
                    setSelectedStudentId(e.target.value);
                    setManualStudentId('');
                  }}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-xs sm:text-sm p-3 text-white outline-none transition-colors cursor-pointer"
                >
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.name} ({student.id})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 font-medium">
                  {lang === 'zh' ? '✨ 在沙盒调试中，你可以直接下拉选择已有的学生账户一键登录为该生。' : '✨ Sandbox help: Quick select existing students on file to simulate as student.'}
                </p>
              </div>
            ) : null}

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-850"></div>
              <span className="flex-shrink mx-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">{lang === 'zh' ? '或手动输入学号' : 'Or input key manually'}</span>
              <div className="flex-grow border-t border-slate-850"></div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <User size={13} />
                {lang === 'zh' ? '学号 / Student ID' : 'Student Access Key'}
              </label>
              <input
                type="text"
                value={manualStudentId}
                onChange={(e) => {
                  setManualStudentId(e.target.value);
                  setSelectedStudentId('');
                }}
                placeholder={lang === 'zh' ? '手工输入您的特有学号' : 'Enter specific numeric ID code'}
                className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-xs sm:text-sm p-3 text-white outline-none placeholder-slate-500 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                <Lock size={13} />
                {lang === 'zh' ? '个人密码 / 临时班级密码' : 'Personal Password / Class Passcode'}
              </label>
              <input
                type="password"
                required
                value={studentPassword}
                onChange={(e) => setStudentPassword(e.target.value)}
                placeholder={lang === 'zh' ? '输入个人密码 (默认: 123456) 或临时班级密码' : 'Enter standard password (default: 123456) or active class code'}
                className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-xs sm:text-sm p-3 text-white outline-none placeholder-slate-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={studentSubmitting}
              className="w-full mt-6 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
            >
              <span>{studentSubmitting ? (lang === 'zh' ? '正在连接学生终端...' : 'Entering Desk...') : (lang === 'zh' ? '登录学生智慧桌面' : 'Login Interactive Desk')}</span>
              <ArrowRight size={15} />
            </button>
          </form>
        )}

        {/* Dev tip on how to switch back/toggle accounts */}
        <div className="mt-8 pt-4 border-t border-slate-900 flex justify-center items-center gap-1.5 text-[10px] text-slate-500 text-center select-none">
          <Sparkles size={11} className="text-indigo-400" />
          <span>{lang === 'zh' ? '系统预设超级管理员：admin password: admin' : 'Built-in Super Administrative account: admin / admin'}</span>
        </div>
      </div>
    </div>
  );
}
