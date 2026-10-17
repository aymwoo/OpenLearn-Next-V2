import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';

/**
 * Issue #94: 学生默认密码非阻塞提示横幅。
 *
 * 学生以初始默认口令 123456 登录后会话携带 `usedDefaultPassword` 标记：
 * 不再强制改密（不阻塞进课节奏，接口也不被拦截），仅展示本横幅引导到
 * 「个人资料」修改密码。关闭状态按 userId 记入 localStorage，刷新后不再打扰。
 */
export function StudentDefaultPasswordBanner({
  userId,
  lang,
  onOpenProfile,
}: {
  userId?: string;
  lang: 'zh' | 'en';
  onOpenProfile: () => void;
}) {
  const dismissKey = `edu_os_default_pwd_hint_dismissed_${userId || 'unknown'}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissKey) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey, '1');
    } catch {
      /* 隐私模式下 localStorage 不可用时忽略，仅本次会话内生效 */
    }
  };

  const zh = lang === 'zh';
  return (
    <div
      id="student_default_password_banner"
      role="status"
      className="flex items-center gap-2 px-4 py-1.5 text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-b border-amber-200 dark:border-amber-900/50"
    >
      <KeyRound size={13} className="shrink-0" aria-hidden="true" />
      <span className="flex-1">
        {zh
          ? '你当前仍在使用初始默认密码，建议尽快修改以保护账号安全。'
          : 'You are still using the initial default password. Please change it soon to protect your account.'}
      </span>
      <button
        type="button"
        onClick={onOpenProfile}
        className="shrink-0 px-2 py-0.5 rounded-md font-semibold bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-100 border border-amber-300 dark:border-amber-800 transition-colors"
      >
        {zh ? '去修改' : 'Change now'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={zh ? '关闭提示' : 'Dismiss hint'}
        className="shrink-0 p-1 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
