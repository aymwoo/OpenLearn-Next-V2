import React, { useState, useEffect } from 'react';
import { Lock, User, Users, Shield, GraduationCap, ArrowRight, AlertCircle, KeyRound } from 'lucide-react';
import { listFromEnvelope } from '../utils/listEnvelope.js';
import { useThemeStore } from '../store/themeStore';

interface Student {
  id: string;
  name: string;
  email: string;
  student_number?: string;
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

interface LoginSiteInfo {
  siteName: string;
  slogan: string;
  logoUrl: string | null;
}

export const LoginPage = React.memo(function LoginPage({ onLoginSuccess, lang }: LoginPageProps) {
  const [activeTab, setActiveTab] = useState<'teacher' | 'student'>('teacher');
  const [siteInfo, setSiteInfo] = useState<LoginSiteInfo | null>(null);
  // 种子账号仍在用默认口令（口令 = 用户名）时才为真 —— 服务端判定，改密后自动转 false
  const [defaultSeedAccounts, setDefaultSeedAccounts] = useState<string[]>([]);

  const loginLayout = useThemeStore((s) => s.resolvedLayouts.login);

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
    const fetchStudents = async () => {
      try {
        const res = await fetch('/api/students?pageSize=all');
        if (res.ok) {
          const data = listFromEnvelope<any>(await res.json());
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

  useEffect(() => {
    const fetchSiteInfo = async () => {
      try {
        const res = await fetch('/api/site-settings');
        if (res.ok) {
          const data = await res.json();
          setSiteInfo(data);
        }
      } catch (err) {
        console.warn('Failed to fetch site settings for login branding:', err);
      }
    };
    fetchSiteInfo();
  }, []);

  useEffect(() => {
    const fetchSeedStatus = async () => {
      try {
        const res = await fetch('/api/auth/seed-status');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.defaultAccounts)) {
            setDefaultSeedAccounts(data.defaultAccounts);
          }
        }
      } catch {
        // Ignored on public status check
      }
    };
    fetchSeedStatus();
  }, []);

  const handleTeacherLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeacherError('');
    setTeacherSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entrance: 'teacher', username: username.trim(), password }),
      });
      if (res.ok) {
        const data = await res.json();
        onLoginSuccess(data.session);
      } else {
        const errData = await res.json();
        setTeacherError(errData.error || (lang === 'zh' ? '用户名或密码错误' : 'Invalid credentials'));
      }
    } catch {
      setTeacherError(lang === 'zh' ? '网络连接异常，请重试' : 'Network connection failure. Please try again.');
    } finally {
      setTeacherSubmitting(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setStudentError('');
    const finalStudentId = manualStudentId.trim() || selectedStudentId;
    if (!finalStudentId) {
      setStudentError(lang === 'zh' ? '请选择或输入学号' : 'Please select or input Student ID');
      return;
    }
    if (!studentPassword.trim()) {
      setStudentError(lang === 'zh' ? '请输入个人密码或班级临时密码' : 'Please enter your password or class passcode');
      return;
    }
    setStudentSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entrance: 'student',
          studentId: finalStudentId,
          password: studentPassword.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onLoginSuccess(data.session);
      } else {
        const errData = await res.json();
        setStudentError(errData.error || (lang === 'zh' ? '找不到该学生记录' : 'Student record not found'));
      }
    } catch {
      setStudentError(lang === 'zh' ? '网络连接异常，请重试' : 'Network connection failure. Please try again.');
    } finally {
      setStudentSubmitting(false);
    }
  };

  const arrangement = loginLayout.arrangement;
  const isSplit = arrangement === 'split-left' || arrangement === 'split-right';
  const justifyCardClass =
    loginLayout.cardPosition === 'start'
      ? 'items-start'
      : loginLayout.cardPosition === 'end'
        ? 'items-end'
        : 'items-center';

  const brandBlock = (
    <div key="brand" data-login-region="brand" className={isSplit ? 'text-left space-y-3' : 'text-center mb-6'}>
      {siteInfo?.logoUrl ? (
        <img
          src={siteInfo.logoUrl}
          alt={siteInfo.siteName || 'logo'}
          width={64}
          height={64}
          fetchPriority="high"
          decoding="async"
          className={`${isSplit ? '' : 'inline-block'} h-16 w-16 object-contain mb-3 rounded-xl`}
        />
      ) : (
        <div
          className="inline-flex items-center justify-center p-3 bg-primary-theme rounded-2xl shadow-lg mb-3 text-white"
          data-theme-control="badge"
        >
          <GraduationCap size={32} />
        </div>
      )}
      <h1
        className={`text-2xl sm:text-3xl font-black text-main tracking-tight flex items-center ${isSplit ? 'justify-start' : 'justify-center'} gap-2`}
      >
        {siteInfo?.siteName || 'OpenLearn Next'}{' '}
        <span className="text-primary-ink font-medium text-xs bg-primary-theme/15 px-2 py-0.5 rounded-full border border-primary-theme/30 theme-accent-badge">
          V2.0
        </span>
      </h1>
      <p className="text-muted text-xs sm:text-sm mt-1">
        {siteInfo?.slogan ||
          (lang === 'zh' ? '下一代智能数字化学习系统' : 'Next-Generation Intelligent Digital Learning Platform')}
      </p>
    </div>
  );

  const seedHintBlock =
    defaultSeedAccounts.length > 0 ? (
      <div
        key="seed-hint"
        data-login-region="seed-hint"
        className="mb-5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2"
        id="login_default_credential_hint"
      >
        <KeyRound size={14} className="shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <p className="font-bold">
            {lang === 'zh' ? '首次安装？可以直接用默认口令登录' : 'First run? Sign in with the default password'}
          </p>
          <p className="font-mono break-all">{defaultSeedAccounts.map((name) => `${name} / ${name}`).join('  ·  ')}</p>
          <p className="opacity-85 leading-relaxed">
            {lang === 'zh'
              ? '口令与账号名相同。登录后会强制你改密，改完这条提示自动消失。'
              : 'Password equals the username. You will be required to change it right after signing in.'}
          </p>
        </div>
      </div>
    ) : null;

  const authFormBlock = (
    <div key="auth-form" data-login-region="auth-form">
      {/* Custom Tab Switcher */}
      <div className="flex bg-surface-secondary p-1 rounded-xl border border-theme gap-1 mb-6">
        <button
          type="button"
          onClick={() => setActiveTab('teacher')}
          data-theme-control="tab"
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
            activeTab === 'teacher'
              ? 'bg-primary-theme text-white shadow-md'
              : 'text-muted hover:text-main hover:bg-surface/60'
          }`}
        >
          <Shield size={14} aria-hidden="true" />
          {lang === 'zh' ? '教师与管理端' : 'Teacher / Staff Portal'}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('student')}
          data-theme-control="tab"
          className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer ${
            activeTab === 'student'
              ? 'bg-primary-theme text-white shadow-md'
              : 'text-muted hover:text-main hover:bg-surface/60'
          }`}
        >
          <Users size={14} aria-hidden="true" />
          {lang === 'zh' ? '学生自助端' : 'Student Self-Service'}
        </button>
      </div>

      {activeTab === 'teacher' ? (
        <form onSubmit={handleTeacherLogin} className="space-y-4">
          {teacherError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/40 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{teacherError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="teacher-username" className="text-xs font-medium text-muted flex items-center gap-1.5">
              <User size={13} />
              {lang === 'zh' ? '教工账户名 / username' : 'Staff Username'}
            </label>
            <input
              id="teacher-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={lang === 'zh' ? '输入教工账户名' : 'Enter staff username'}
              data-theme-control="input"
              className="w-full bg-surface-secondary border border-theme focus:border-primary-theme focus:ring-1 focus:ring-primary-theme rounded-xl text-xs sm:text-sm p-3 text-main outline-none placeholder-muted transition-colors"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="teacher-password" className="text-xs font-medium text-muted flex items-center gap-1.5">
              <Lock size={13} />
              {lang === 'zh' ? '输入登录密码 / password' : 'Access Password'}
            </label>
            <input
              id="teacher-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={lang === 'zh' ? '输入登录密码' : 'Enter access password'}
              data-theme-control="input"
              className="w-full bg-surface-secondary border border-theme focus:border-primary-theme focus:ring-1 focus:ring-primary-theme rounded-xl text-xs sm:text-sm p-3 text-main outline-none placeholder-muted transition-colors"
              required
            />
          </div>

          <button
            type="submit"
            disabled={teacherSubmitting}
            data-theme-control="submit"
            className="w-full mt-6 bg-primary-theme hover:opacity-95 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-lg active:scale-[0.98]"
          >
            <span>
              {teacherSubmitting
                ? lang === 'zh'
                  ? '鉴权登录中...'
                  : 'Authorizing...'
                : lang === 'zh'
                  ? '安全验证登录'
                  : 'Authorized Sign In'}
            </span>
            <ArrowRight size={15} />
          </button>
        </form>
      ) : (
        <form onSubmit={handleStudentLogin} className="space-y-4">
          {studentError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/40 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{studentError}</span>
            </div>
          )}

          {students.length > 0 ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted flex items-center gap-1.5">
                <GraduationCap size={14} />
                {lang === 'zh' ? '从学生花名册中快速选择' : 'Quick Access Student Select'}
              </label>
              <select
                value={selectedStudentId}
                onChange={(e) => {
                  setSelectedStudentId(e.target.value);
                  setManualStudentId('');
                }}
                data-theme-control="input"
                className="w-full bg-surface-secondary border border-theme focus:border-primary-theme focus:ring-1 focus:ring-primary-theme rounded-xl text-xs sm:text-sm p-3 text-main outline-none transition-colors cursor-pointer"
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name} ({student.student_number || student.id})
                  </option>
                ))}
              </select>
              <p className="text-xs text-subtle font-medium">
                {lang === 'zh'
                  ? '✨ 在沙盒调试中，你可以直接下拉选择已有的学生账户一键登录为该生。'
                  : '✨ Sandbox help: Quick select existing students on file to simulate as student.'}
              </p>
            </div>
          ) : null}

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-theme" />
            <span className="flex-shrink mx-3 text-xs font-bold text-subtle uppercase tracking-wider">
              {lang === 'zh' ? '或手动输入学号' : 'Or input key manually'}
            </span>
            <div className="flex-grow border-t border-theme" />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="student-access-key" className="text-xs font-medium text-muted flex items-center gap-1.5">
              <User size={13} />
              {lang === 'zh' ? '学号 / Student ID' : 'Student Access Key'}
            </label>
            <input
              id="student-access-key"
              name="studentAccessKey"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={manualStudentId}
              onChange={(e) => {
                setManualStudentId(e.target.value);
                setSelectedStudentId('');
              }}
              placeholder={lang === 'zh' ? '手工输入您的特有学号' : 'Enter specific numeric ID code'}
              data-theme-control="input"
              className="w-full bg-surface-secondary border border-theme focus:border-primary-theme focus:ring-1 focus:ring-primary-theme rounded-xl text-xs sm:text-sm p-3 text-main outline-none placeholder-muted transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="student-password" className="text-xs font-medium text-muted flex items-center gap-1.5">
              <Lock size={13} />
              {lang === 'zh' ? '个人密码 / 临时班级密码' : 'Personal Password / Class Passcode'}
            </label>
            <input
              id="student-password"
              name="studentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={studentPassword}
              onChange={(e) => setStudentPassword(e.target.value)}
              placeholder={lang === 'zh' ? '输入个人密码或临时班级密码' : 'Enter personal password or class passcode'}
              data-theme-control="input"
              className="w-full bg-surface-secondary border border-theme focus:border-primary-theme focus:ring-1 focus:ring-primary-theme rounded-xl text-xs sm:text-sm p-3 text-main outline-none placeholder-muted transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={studentSubmitting}
            data-theme-control="submit"
            className="w-full mt-6 bg-primary-theme hover:opacity-95 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-lg active:scale-[0.98]"
          >
            <span>
              {studentSubmitting
                ? lang === 'zh'
                  ? '正在连接学生终端...'
                  : 'Entering Desk...'
                : lang === 'zh'
                  ? '登录学生智慧桌面'
                  : 'Login Interactive Desk'}
            </span>
            <ArrowRight size={15} />
          </button>
        </form>
      )}
    </div>
  );

  const orderedSingleColumnBlocks: Record<string, React.ReactNode> = {
    brand: brandBlock,
    'seed-hint': seedHintBlock,
    'auth-form': authFormBlock,
  };

  return (
    <main
      id="login_page_container"
      data-theme-bg-canvas="login"
      data-login-arrangement={arrangement}
      className={`min-h-screen bg-app text-main flex flex-col ${justifyCardClass} justify-center p-4 sm:p-8 relative overflow-hidden font-sans transition-colors duration-200`}
    >
      {/* Decorative theme-tinted atmosphere blobs */}
      <div className="pointer-events-none absolute top-[-10%] left-[-10%] w-[40rem] h-[40rem] rounded-full bg-primary-theme/10 blur-3xl -z-10" />
      <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] w-[35rem] h-[35rem] rounded-full bg-primary-theme/10 blur-3xl -z-10" />

      {isSplit ? (
        <div
          className={`w-full max-w-4xl flex flex-col ${
            arrangement === 'split-right' ? 'lg:flex-row-reverse' : 'lg:flex-row'
          } items-center gap-8 lg:gap-12`}
        >
          <div className="flex-1 w-full max-w-md space-y-4">
            {brandBlock}
            {seedHintBlock}
          </div>
          <div
            id="login_card"
            data-theme-surface="card"
            className="w-full max-w-md bg-surface/95 backdrop-blur-md rounded-2xl border border-theme shadow-2xl p-6 sm:p-8"
          >
            {authFormBlock}
          </div>
        </div>
      ) : (
        <div
          id="login_card"
          data-theme-surface="card"
          className={`w-full ${arrangement === 'top-banner' ? 'max-w-lg' : 'max-w-md'} bg-surface/95 backdrop-blur-md rounded-2xl border border-theme shadow-2xl p-6 sm:p-8 flex flex-col`}
        >
          {loginLayout.order.map((regionId) => orderedSingleColumnBlocks[regionId])}
        </div>
      )}
    </main>
  );
});
