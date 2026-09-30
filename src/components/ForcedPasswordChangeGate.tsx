import React, { useState } from 'react';
import { KeyRound, Loader2, LogOut, ShieldAlert } from 'lucide-react';

/**
 * SEC-AUTH-06: 默认密码强制改密门。
 *
 * 种子账号（admin/admin、teacher/teacher）登录后会话带 `mustChangePassword` 标记：
 * 前端用本组件替换整个应用外壳，直到改密成功；服务端另有 `enforcePasswordChanged`
 * 中间件对非 GET 的 API 调用兜底拦截（防止绕过前端直接调写接口）。
 *
 * 改密走既有 `POST /api/auth/change-password`（旧密码校验 + 强度校验 + 踢其他设备），
 * 成功后服务端同步清除当前会话的标记，前端刷新会话即恢复应用。
 */
interface ForcedPasswordChangeGateProps {
  lang: 'zh' | 'en';
  username?: string;
  onDone: () => void;
  onLogout: () => void;
}

export default function ForcedPasswordChangeGate({ lang, username, onDone, onLogout }: ForcedPasswordChangeGateProps) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const zh = lang === 'zh';

  const validate = (): string | null => {
    if (!oldPwd || !newPwd || !confirmPwd) return zh ? '请填写完整' : 'All fields are required';
    if (newPwd.length < 8) return zh ? '新密码至少 8 位' : 'Password must be at least 8 characters long';
    if (!/[a-zA-Z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
      return zh ? '新密码需同时包含字母和数字' : 'Password must contain both letters and numbers';
    }
    if (newPwd === oldPwd) return zh ? '新密码不能与当前密码相同' : 'New password must differ from the current one';
    if (newPwd !== confirmPwd) return zh ? '两次输入的新密码不一致' : 'Passwords do not match';
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || (zh ? '修改失败，请重试' : 'Change failed, please retry'));
        return;
      }
      onDone();
    } catch {
      setError(zh ? '网络异常，请重试' : 'Network error, please retry');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-amber-100">
            <ShieldAlert size={20} className="text-amber-600" />
          </div>
          <h1 className="text-lg font-bold text-slate-800">{zh ? '安全要求：修改默认密码' : 'Security: Change Default Password'}</h1>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed mb-5">
          {zh
            ? `当前账号${username ? `（${username}）` : ''}仍在使用初始默认密码，存在被接管的风险。请设置新密码后继续使用平台；修改前所有数据变更已被暂时冻结。`
            : `This account${username ? ` (${username})` : ''} still uses the initial default password. Set a new password to continue; data changes are frozen until then.`}
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{zh ? '当前密码' : 'Current password'}</label>
            <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} className={inputCls} autoComplete="current-password" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{zh ? '新密码（至少 8 位，含字母和数字）' : 'New password (8+ chars, letters & numbers)'}</label>
            <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className={inputCls} autoComplete="new-password" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{zh ? '确认新密码' : 'Confirm new password'}</label>
            <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className={inputCls} autoComplete="new-password" />
          </div>
        </div>

        {error && (
          <div data-testid="force-change-error" className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          data-testid="force-change-submit"
          className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          {zh ? '修改密码并继续' : 'Change password and continue'}
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 text-xs font-medium transition-colors cursor-pointer"
        >
          <LogOut size={13} />
          {zh ? '退出登录' : 'Log out'}
        </button>
      </div>
    </div>
  );
}
