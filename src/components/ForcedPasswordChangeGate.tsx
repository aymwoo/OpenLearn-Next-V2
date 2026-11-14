import React, { useRef, useState } from 'react';
import { KeyRound, Loader2, LogOut, ShieldAlert } from 'lucide-react';
import { PasswordInput } from './PasswordInput';

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

interface FieldErrors {
  old?: string;
  new?: string;
  confirm?: string;
}

export default function ForcedPasswordChangeGate({ lang, username, onDone, onLogout }: ForcedPasswordChangeGateProps) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const oldPwdRef = useRef<HTMLInputElement>(null);
  const newPwdRef = useRef<HTMLInputElement>(null);
  const confirmPwdRef = useRef<HTMLInputElement>(null);

  const zh = lang === 'zh';

  const validate = (): { message: string | null; fields: FieldErrors; firstInvalid?: HTMLInputElement | null } => {
    if (!oldPwd) {
      const msg = zh ? '请输入当前密码' : 'Current password is required';
      return { message: msg, fields: { old: msg }, firstInvalid: oldPwdRef.current };
    }
    if (!newPwd) {
      const msg = zh ? '请输入新密码' : 'New password is required';
      return { message: msg, fields: { new: msg }, firstInvalid: newPwdRef.current };
    }
    if (newPwd.length < 8) {
      const msg = zh ? '新密码至少 8 位' : 'Password must be at least 8 characters long';
      return { message: msg, fields: { new: msg }, firstInvalid: newPwdRef.current };
    }
    if (!/[a-zA-Z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
      const msg = zh ? '新密码需同时包含字母和数字' : 'Password must contain both letters and numbers';
      return { message: msg, fields: { new: msg }, firstInvalid: newPwdRef.current };
    }
    if (newPwd === oldPwd) {
      const msg = zh ? '新密码不能与当前密码相同' : 'New password must differ from the current one';
      return { message: msg, fields: { new: msg }, firstInvalid: newPwdRef.current };
    }
    if (!confirmPwd) {
      const msg = zh ? '请再次确认新密码' : 'Please confirm the new password';
      return { message: msg, fields: { confirm: msg }, firstInvalid: confirmPwdRef.current };
    }
    if (newPwd !== confirmPwd) {
      const msg = zh ? '两次输入的新密码不一致' : 'Passwords do not match';
      return { message: msg, fields: { confirm: msg }, firstInvalid: confirmPwdRef.current };
    }
    return { message: null, fields: {} };
  };

  const submit = async () => {
    const v = validate();
    if (v.message) {
      setFieldErrors(v.fields);
      setError(v.message);
      v.firstInvalid?.focus();
      return;
    }
    setSubmitting(true);
    setFieldErrors({});
    setError(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json.error || (zh ? '修改失败，请重试' : 'Change failed, please retry');
        setError(msg);
        setFieldErrors({ old: msg });
        oldPwdRef.current?.focus();
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
    'w-full px-3 py-2 pr-10 rounded-lg bg-white border border-slate-300 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

  return (
    <main className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-amber-100">
            <ShieldAlert size={20} className="text-amber-600" aria-hidden="true" />
          </div>
          <h1 id="forced-change-heading" className="text-lg font-bold text-slate-800">
            {zh ? '安全要求：修改默认密码' : 'Security: Change Default Password'}
          </h1>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed mb-5">
          {zh
            ? `当前账号${username ? `（${username}）` : ''}仍在使用初始默认密码，存在被接管的风险。请设置新密码后继续使用平台；修改前所有数据变更已被暂时冻结。`
            : `This account${username ? ` (${username})` : ''} still uses the initial default password. Set a new password to continue; data changes are frozen until then.`}
        </p>

        <form
          aria-labelledby="forced-change-heading"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-3">
            <PasswordInput
              id="force-old-password"
              name="old_password"
              label={zh ? '当前密码' : 'Current password'}
              value={oldPwd}
              onChange={(val) => {
                setOldPwd(val);
                if (fieldErrors.old) setFieldErrors((prev) => ({ ...prev, old: undefined }));
              }}
              autoComplete="current-password"
              required
              enterKeyHint="next"
              lang={lang}
              className={inputCls}
              error={fieldErrors.old}
              inputRef={oldPwdRef}
            />
            <PasswordInput
              id="force-new-password"
              name="new_password"
              label={zh ? '新密码' : 'New password'}
              hint={
                zh
                  ? '至少 8 位，需同时包含字母和数字，且不能与当前密码相同'
                  : 'At least 8 characters with letters and numbers, different from current password'
              }
              value={newPwd}
              onChange={(val) => {
                setNewPwd(val);
                if (fieldErrors.new) setFieldErrors((prev) => ({ ...prev, new: undefined }));
              }}
              autoComplete="new-password"
              required
              minLength={8}
              enterKeyHint="next"
              lang={lang}
              className={inputCls}
              error={fieldErrors.new}
              inputRef={newPwdRef}
            />
            <PasswordInput
              id="force-confirm-password"
              name="confirm_password"
              label={zh ? '确认新密码' : 'Confirm new password'}
              value={confirmPwd}
              onChange={(val) => {
                setConfirmPwd(val);
                if (fieldErrors.confirm) setFieldErrors((prev) => ({ ...prev, confirm: undefined }));
              }}
              autoComplete="new-password"
              required
              minLength={8}
              enterKeyHint="done"
              lang={lang}
              className={inputCls}
              error={fieldErrors.confirm}
              inputRef={confirmPwdRef}
            />
          </div>

          {error && (
            <div
              data-testid="force-change-error"
              role="alert"
              className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            data-testid="force-change-submit"
            className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            {zh ? '修改密码并继续' : 'Change password and continue'}
          </button>
        </form>

        <button
          type="button"
          onClick={onLogout}
          className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 text-xs font-medium transition-colors cursor-pointer"
        >
          <LogOut size={13} />
          {zh ? '退出登录' : 'Log out'}
        </button>
      </div>
    </main>
  );
}
