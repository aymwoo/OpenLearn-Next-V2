/**
 * useSessionBootstrap — 会话引导与账号生命周期（C1-R2e）。
 *
 * 原 App.tsx 内联 state / effect / 函数迁入：会话恢复（auth/session）、
 * DB 状态心跳、站点设置拉取、登录成功/登出/语言切换。
 * session 本体在 appStore；activeRole/activeStudentId 由本 hook 持有并向上冒泡。
 */
import { useEffect, useState } from 'react';
import { appStore, useAppStore } from '../store/appStore';
import {
  fetchDbStatus,
  fetchAuthSession,
  fetchSiteSettings as fetchSiteSettingsApi,
  postLogout,
} from '../services/sessionService.js';

export function useSessionBootstrap(deps: { fetchStudents: () => Promise<void> }) {
  const { fetchStudents } = deps;
  const session = useAppStore((s) => s.session);
  const setSession = useAppStore((s) => s.setSession);
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);

  const [activeRole, setActiveRole] = useState<'teacher' | 'student'>('teacher');
  const [dbConnected, setDbConnected] = useState<boolean>(true);
  const [dbStatus, setDbStatus] = useState<'normal' | 'warning' | 'error'>('normal');
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // DB 状态心跳：登录后每 5 秒检查
  useEffect(() => {
    if (!session) return;
    const checkDb = async () => {
      try {
        const { ok, status, data } = await fetchDbStatus();
        if (ok) {
          if (data.status === 'warning' || data.warning) {
            setDbStatus('warning');
          } else {
            setDbStatus('normal');
          }
          setDbConnected(true);
        } else if (status === 429 || status === 503) {
          setDbStatus('warning');
          setDbConnected(true);
        } else {
          setDbStatus('error');
          setDbConnected(false);
        }
      } catch (err) {
        setDbStatus('error');
        setDbConnected(false);
      }
    };
    checkDb();
    const interval = setInterval(checkDb, 5000);
    return () => clearInterval(interval);
  }, [session]);

  // Load platform site settings (logo / name / slogan) so branding slots render globally
  useEffect(() => {
    const fetchSiteSettings = async () => {
      try {
        const { ok, data } = await fetchSiteSettingsApi();
        if (ok) {
          appStore.getState().setSiteInfo({
            siteName: data.siteName || '',
            slogan: data.slogan || '',
            logoUrl: data.logoUrl || null,
          });
        }
      } catch (err) {
        console.warn('Failed to fetch site settings:', err);
      }
    };
    fetchSiteSettings();
  }, []);

  const toggleLanguage = () => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  };

  const handleLoginSuccess = (newSession: any) => {
    setSession(newSession);
    if (newSession.role === 'teacher') {
      setActiveRole('teacher');
      // 教师/管理员登录后的默认首页：互动课堂（管理员 role 同为 teacher，靠 subRole 区分）
      appStore.getState().setTeacherTab('live_class');
    } else {
      setActiveRole('student');
      setActiveStudentId(newSession.studentId);
      fetchStudents();
    }
  };

  const handleLogout = async () => {
    try {
      await postLogout();
    } catch (e) {
      console.error('Logout failed', e);
    }
    setSession(null);
  };

  return {
    session,
    setSession,
    lang,
    setLang,
    activeRole,
    setActiveRole,
    setActiveStudentId,
    activeStudentId,
    dbConnected,
    dbStatus,
    profileOpen,
    setProfileOpen,
    handleLoginSuccess,
    handleLogout,
    toggleLanguage,
  };
}
