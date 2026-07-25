import { useEffect, useRef, useState } from 'react';
import { User, LogOut, ChevronDown } from 'lucide-react';
import type { SessionType } from '../types/app';
import type { Language } from '../i18n';

interface UserMenuProps {
  session: SessionType;
  lang: Language;
  onLogout: () => void;
  onProfile: () => void;
}

/**
 * 右上角用户菜单：将原本「用户名 + 安全登出」收敛为一个圆形头像按钮，
 * 点击弹出菜单（个人资料 / 注销登录）。当前无头像数据，按钮内显示默认人形图标。
 * 注销登录复用既有 /api/auth/logout（server.ts:2890）；个人资料打开 ProfileModal。
 */
export function UserMenu({ session, lang, onLogout, onProfile }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open]);

  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={session.name}
        className="flex items-center gap-1 rounded-full p-1 hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 overflow-hidden">
          {session.avatar ? (
            <img src={session.avatar} alt={session.name} className="w-full h-full object-cover" />
          ) : (
            <User size={20} />
          )}
        </span>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-52 bg-white border border-gray-200 shadow-lg rounded-xl z-50 overflow-hidden py-1"
        >
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-800 truncate" title={session.name}>
              {session.name}
            </p>
            <p className="text-xs text-gray-400 truncate">{session.username}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onProfile();
            }}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
          >
            <User size={16} className="text-gray-400" />
            {t('个人资料', 'Profile')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <LogOut size={16} />
            {t('注销登录', 'Sign Out')}
          </button>
        </div>
      )}
    </div>
  );
}
