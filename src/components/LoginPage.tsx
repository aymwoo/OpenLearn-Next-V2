import React, { useState, useEffect, useRef } from 'react';
import {
  Lock,
  User,
  Users,
  Shield,
  GraduationCap,
  ArrowRight,
  AlertCircle,
  KeyRound,
  Search,
  X,
  Check,
} from 'lucide-react';
import { useThemeStore } from '../store/themeStore';

interface PublicClassOption {
  id: string;
  name: string;
}

interface StudentLookupItem {
  name: string;
  studentNumber: string;
  classes: string[];
}

const HAN_CHAR_RE = /\p{Script=Han}/u;

function isLookupNameValid(rawName: string): boolean {
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.length > 64) return false;
  return HAN_CHAR_RE.test(trimmed) || trimmed.replace(/\s+/g, '').length >= 2;
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

function getBuildAppVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__.trim() : '';
}

/** 构建期注入的 commit 短哈希；vitest 等未注入环境下降级为空串。 */
function getBuildCommit(): string {
  return typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__.trim().slice(0, 7) : '';
}

function formatVersionBadge(rawVersion: string): string {
  const cleaned = rawVersion.trim().replace(/^v/i, '');
  return cleaned ? `v${cleaned}` : '';
}

export const LoginPage = React.memo(function LoginPage({ onLoginSuccess, lang }: LoginPageProps) {
  const [activeTab, setActiveTab] = useState<'teacher' | 'student'>('teacher');
  const [siteInfo, setSiteInfo] = useState<LoginSiteInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string>(getBuildAppVersion);
  // 种子账号仍在用默认口令（口令 = 用户名）时才为真 —— 服务端判定，改密后自动转 false
  const [defaultSeedAccounts, setDefaultSeedAccounts] = useState<string[]>([]);

  const loginLayout = useThemeStore((s) => s.resolvedLayouts.login);

  // Teacher credentials state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [teacherError, setTeacherError] = useState('');
  const [teacherSubmitting, setTeacherSubmitting] = useState(false);

  // Student credentials & lookup state
  const [manualStudentId, setManualStudentId] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [studentError, setStudentError] = useState('');
  const [studentSubmitting, setStudentSubmitting] = useState(false);

  const [allowPublicStudentLookup, setAllowPublicStudentLookup] = useState(true);
  const [isLookupOpen, setIsLookupOpen] = useState(false);
  const [publicClasses, setPublicClasses] = useState<PublicClassOption[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [lookupName, setLookupName] = useState('');
  const [lookupClassId, setLookupClassId] = useState('');
  const [lookupResults, setLookupResults] = useState<StudentLookupItem[]>([]);
  const [lookupTruncated, setLookupTruncated] = useState(false);
  const [lookupHasSearched, setLookupHasSearched] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');

  const lookupDialogRef = useRef<HTMLDialogElement>(null);
  const lookupInputRef = useRef<HTMLInputElement>(null);
  const studentPasswordInputRef = useRef<HTMLInputElement>(null);
  const pressedOutsideRef = useRef(false);

  useEffect(() => {
    const fetchSiteInfo = async () => {
      try {
        const res = await fetch('/api/site-settings');
        if (res.ok) {
          const data = await res.json();
          setSiteInfo(data);
          setAllowPublicStudentLookup(data?.allowPublicStudentLookup !== false);
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

  useEffect(() => {
    let cancelled = false;
    const fetchInstanceVersion = async () => {
      try {
        const res = await fetch('/health');
        if (!res.ok) return;
        const data = await res.json();
        const runtimeVersion = typeof data?.version === 'string' ? data.version.trim() : '';
        if (!cancelled && runtimeVersion) {
          setAppVersion(runtimeVersion);
        }
      } catch {
        // 降级保留构建期注入的 __APP_VERSION__
      }
    };
    fetchInstanceVersion();
    return () => {
      cancelled = true;
    };
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

  const fetchPublicClasses = async () => {
    setClassesLoading(true);
    try {
      const res = await fetch('/api/auth/public-classes');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.items)) {
          setPublicClasses(data.items);
        }
      }
    } catch {
      // 公开班级列表加载失败时保留「全部班级」过滤，不阻塞按姓名查询
    } finally {
      setClassesLoading(false);
    }
  };

  const openLookupDialog = () => {
    setLookupError('');
    setIsLookupOpen(true);
    const el = lookupDialogRef.current;
    if (el) {
      if (typeof el.showModal === 'function') {
        if (!el.open) el.showModal();
      } else {
        el.setAttribute('open', '');
      }
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => lookupInputRef.current?.focus());
    } else {
      lookupInputRef.current?.focus();
    }
    if (publicClasses.length === 0) {
      void fetchPublicClasses();
    }
  };

  const closeLookupDialog = () => {
    const el = lookupDialogRef.current;
    if (el) {
      if (typeof el.close === 'function' && el.open) {
        el.close();
      } else {
        el.removeAttribute('open');
      }
    }
    setIsLookupOpen(false);
  };

  const handleLookupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError('');
    if (!isLookupNameValid(lookupName)) {
      setLookupError(
        lang === 'zh'
          ? '请输入至少 2 个字符（或至少 1 个汉字）进行查询'
          : 'Please enter at least 2 characters (or 1 Chinese character)',
      );
      lookupInputRef.current?.focus();
      return;
    }

    setLookupLoading(true);
    try {
      const params = new URLSearchParams({ name: lookupName.trim() });
      if (lookupClassId) {
        params.set('classId', lookupClassId);
      }
      const res = await fetch(`/api/auth/student-lookup?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLookupResults([]);
        setLookupTruncated(false);
        setLookupHasSearched(false);
        setLookupError(
          data?.error || (lang === 'zh' ? '查询失败，请稍后重试' : 'Lookup failed. Please try again later.'),
        );
        return;
      }
      setLookupResults(Array.isArray(data?.items) ? data.items : []);
      setLookupTruncated(Boolean(data?.truncated));
      setLookupHasSearched(true);
    } catch {
      setLookupError(lang === 'zh' ? '网络连接异常，请重试' : 'Network connection failure. Please try again.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSelectLookedUpStudent = (studentNumber: string) => {
    setManualStudentId(studentNumber);
    setStudentError('');
    closeLookupDialog();
    studentPasswordInputRef.current?.focus();
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setStudentError('');
    const finalStudentId = manualStudentId.trim();
    if (!finalStudentId) {
      setStudentError(lang === 'zh' ? '请输入学号' : 'Please enter Student ID');
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

  const versionBadge = formatVersionBadge(appVersion);
  const buildCommit = getBuildCommit();

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
        {versionBadge && (
          <span
            data-testid="login-version-badge"
            className="text-primary-ink font-medium text-xs bg-primary-theme/15 px-2 py-0.5 rounded-full border border-primary-theme/30 theme-accent-badge"
          >
            {versionBadge}
          </span>
        )}
        {versionBadge && buildCommit && (
          <span data-testid="login-build-commit" className="font-mono text-[10px] text-subtle">
            {buildCommit}
          </span>
        )}
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="student-access-key" className="text-xs font-medium text-muted flex items-center gap-1.5">
                <User size={13} />
                {lang === 'zh' ? '学号 / Student ID' : 'Student Access Key'}
              </label>
              {allowPublicStudentLookup && (
                <button
                  type="button"
                  onClick={openLookupDialog}
                  className="text-xs font-semibold text-primary-ink hover:text-primary-ink-hover inline-flex items-center gap-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded px-1 py-0.5 transition-colors"
                >
                  <Search size={12} aria-hidden="true" />
                  <span>{lang === 'zh' ? '忘记学号？查询学号' : 'Forgot ID? Look up'}</span>
                </button>
              )}
            </div>
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
              }}
              placeholder={lang === 'zh' ? '输入您的学号' : 'Enter your Student ID'}
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
              ref={studentPasswordInputRef}
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

      {/* 原生模态 <dialog>（独立于登录 <form>，避免表单嵌套） */}
      <dialog
        ref={lookupDialogRef}
        id="student-lookup-dialog"
        aria-labelledby="student-lookup-dialog-title"
        {...({ closedby: 'any' } as Record<string, string>)}
        onClose={() => {
          if (lookupDialogRef.current) {
            lookupDialogRef.current.returnValue = '';
          }
          setIsLookupOpen(false);
        }}
        onPointerDown={(e) => {
          if (typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype) return;
          const rect = e.currentTarget.getBoundingClientRect();
          pressedOutsideRef.current =
            e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
        }}
        onPointerUp={(e) => {
          if (typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const releasedOutside =
            e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
          if (pressedOutsideRef.current && releasedOutside) {
            closeLookupDialog();
          }
          pressedOutsideRef.current = false;
        }}
        className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-theme bg-surface text-main shadow-2xl p-0 overflow-hidden"
      >
        {isLookupOpen && (
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-theme/15 text-primary-ink">
                  <Search size={16} aria-hidden="true" />
                </span>
                <h2 id="student-lookup-dialog-title" className="text-base font-bold text-main truncate">
                  {lang === 'zh' ? '自助查询学号' : 'Student ID Lookup'}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeLookupDialog}
                aria-label={lang === 'zh' ? '关闭学号查询弹窗' : 'Close student ID lookup dialog'}
                className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface-secondary transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <form
              role="search"
              onSubmit={handleLookupSubmit}
              className="space-y-3"
              aria-labelledby="student-lookup-dialog-title"
            >
              <div className="space-y-1.5">
                <label htmlFor="student-lookup-class" className="text-xs font-medium text-muted block">
                  {lang === 'zh' ? '所在班级（可选，用于区分重名）' : 'Class (optional, narrows duplicate names)'}
                </label>
                <select
                  id="student-lookup-class"
                  name="classId"
                  value={lookupClassId}
                  onChange={(e) => setLookupClassId(e.target.value)}
                  disabled={classesLoading}
                  className="w-full bg-surface-secondary border border-theme focus:border-primary-theme focus:ring-1 focus:ring-primary-theme rounded-xl text-xs sm:text-sm p-2.5 text-main outline-none transition-colors cursor-pointer"
                >
                  <option value="">{lang === 'zh' ? '全部班级' : 'All classes'}</option>
                  {publicClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="student-lookup-name" className="text-xs font-medium text-muted block">
                  {lang === 'zh' ? '学生姓名' : 'Student Name'}{' '}
                  <span className="text-rose-500" aria-hidden="true">
                    *
                  </span>
                </label>
                <input
                  ref={lookupInputRef}
                  id="student-lookup-name"
                  name="studentName"
                  type="search"
                  autoFocus
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="search"
                  maxLength={64}
                  required
                  aria-describedby="student-lookup-name-help"
                  aria-invalid={lookupError ? 'true' : undefined}
                  value={lookupName}
                  onChange={(e) => {
                    setLookupName(e.target.value);
                    if (lookupError) setLookupError('');
                  }}
                  placeholder={lang === 'zh' ? '输入姓名或名字关键词（如：张伟）' : 'Enter student name or keyword'}
                  className="w-full bg-surface-secondary border border-theme focus:border-primary-theme focus:ring-1 focus:ring-primary-theme rounded-xl text-xs sm:text-sm p-2.5 text-main outline-none placeholder-muted transition-colors"
                />
                <p id="student-lookup-name-help" className="text-xs text-subtle">
                  {lang === 'zh'
                    ? '支持精确或模糊匹配，至少输入 2 个字符（或 1 个汉字），单次最多展示 10 条记录。'
                    : 'Exact or partial match (at least 2 characters or 1 Chinese character; up to 10 results).'}
                </p>
              </div>

              <button
                type="submit"
                disabled={lookupLoading}
                className="w-full bg-primary-theme hover:opacity-95 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
              >
                <Search size={14} aria-hidden="true" />
                <span>
                  {lookupLoading
                    ? lang === 'zh'
                      ? '正在查询...'
                      : 'Searching...'
                    : lang === 'zh'
                      ? '查询学号'
                      : 'Look Up Student ID'}
                </span>
              </button>
            </form>

            <div role="status" aria-live="polite" className="space-y-2">
              {lookupError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/40 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" aria-hidden="true" />
                  <span>{lookupError}</span>
                </div>
              )}

              {!lookupError && lookupHasSearched && lookupResults.length === 0 && (
                <div className="p-4 rounded-xl border border-theme bg-surface-secondary text-center text-xs text-muted">
                  {lang === 'zh'
                    ? '未找到匹配的学生记录，请检查姓名拼写或切换班级后再试。'
                    : 'No matching student found. Please check the spelling or try another class.'}
                </div>
              )}

              {lookupTruncated && (
                <div className="p-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs">
                  {lang === 'zh'
                    ? '匹配结果超过 10 条，仅展示前 10 条。请输入更完整的姓名或选择班级缩小范围。'
                    : 'More than 10 matches found (showing top 10). Enter a fuller name or select a class to narrow results.'}
                </div>
              )}
            </div>

            {lookupResults.length > 0 && (
              <ul
                className="max-h-60 overflow-y-auto space-y-2 pr-0.5"
                aria-label={lang === 'zh' ? '查询结果' : 'Lookup results'}
              >
                {lookupResults.map((item) => {
                  const classLabel =
                    item.classes.length > 0
                      ? item.classes.join(lang === 'zh' ? '、' : ', ')
                      : lang === 'zh'
                        ? '未分班'
                        : 'Unassigned';
                  return (
                    <li
                      key={`${item.studentNumber}-${item.name}`}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-theme bg-surface-secondary/70"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-main truncate">{item.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-surface border border-theme text-muted truncate max-w-[12rem]">
                            {classLabel}
                          </span>
                        </div>
                        <p className="text-xs text-primary-ink">
                          {lang === 'zh' ? '学号：' : 'ID: '}
                          <span className="font-mono font-semibold select-all">{item.studentNumber}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectLookedUpStudent(item.studentNumber)}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-primary-theme hover:opacity-95 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        <Check size={13} aria-hidden="true" />
                        <span>{lang === 'zh' ? '使用此学号' : 'Use ID'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </dialog>
    </main>
  );
});
