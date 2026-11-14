import { useState, useRef, useEffect, useCallback, type ChangeEvent, type FormEvent } from 'react';
import { X, User as UserIcon, KeyRound, CheckCircle2, Blocks } from 'lucide-react';
import AccessibleDialog from './AccessibleDialog';
import { PasswordInput } from './PasswordInput';
import type { SessionType } from '../types/app';
import type { Language } from '../i18n';
import { AiProvidersPanel, type AIProvider } from '../features/admin/AiProvidersPanel';
import { useOptionalAppData } from '../context/AppDataContext';

interface ProfileModalProps {
  open: boolean;
  session: SessionType;
  lang: Language;
  onClose: () => void;
  onSaved: (name: string) => void;
  /** 头像更新后回调：url 为新头像地址，null 表示已移除 */
  onAvatar?: (avatar: string | null) => void;
}

/**
 * 个人资料弹窗（Step ② 编辑显示名称 + Step ③ 修改密码）。
 * 修改密码调用既有 /api/auth/change-password（旧密码校验 + 强度校验 + 踢其他设备）。
 */
export function ProfileModal({ open, session, lang, onClose, onSaved, onAvatar }: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'ai_providers'>('profile');
  const [name, setName] = useState(session.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appData = useOptionalAppData();
  const [localProviders, setLocalProviders] = useState<AIProvider[]>([]);

  const fetchLocalProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-providers');
      if (res.ok) {
        const data = await res.json();
        setLocalProviders(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (open && activeTab === 'ai_providers') {
      fetchLocalProviders();
    }
  }, [open, activeTab, fetchLocalProviders]);

  const aiProviders = appData?.aiProviders && appData.aiProviders.length > 0 ? appData.aiProviders : localProviders;

  const handleAIProvidersChanged = () => {
    if (appData?.onAIProvidersChanged) {
      appData.onAIProvidersChanged();
    }
    fetchLocalProviders();
  };

  const currentUserId = session.userId || session.id;
  const currentUserRole = session.subRole === 'administrator' ? 'administrator' : session.role;

  // 头像上传
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // 修改密码区块
  const nameInputRef = useRef<HTMLInputElement>(null);
  const oldPwdRef = useRef<HTMLInputElement>(null);
  const newPwdRef = useRef<HTMLInputElement>(null);
  const confirmPwdRef = useRef<HTMLInputElement>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [oldPwdError, setOldPwdError] = useState<string | null>(null);
  const [newPwdError, setNewPwdError] = useState<string | null>(null);
  const [confirmPwdError, setConfirmPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  if (!open) return null;
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  const roleLabel =
    session.role === 'teacher'
      ? session.subRole === 'administrator'
        ? t('管理员', 'Administrator')
        : t('教师', 'Teacher')
      : t('学生', 'Student');

  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== session.name;

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    if (!trimmed) {
      setError(lang === 'zh' ? '显示名称不能为空' : 'Display name is required');
      nameInputRef.current?.focus();
      return;
    }
    if (!changed) {
      setError(lang === 'zh' ? '显示名称未发生变化' : 'Display name is unchanged');
      nameInputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || (lang === 'zh' ? '保存失败' : 'Save failed'));
        return;
      }
      onSaved(data.name ?? trimmed);
    } catch {
      setError(lang === 'zh' ? '网络错误，请重试' : 'Network error, please retry');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePwd = async (e?: FormEvent) => {
    e?.preventDefault();
    if (pwdSaving) return;
    setPwdError(null);
    let nextOldErr: string | null = null;
    let nextNewErr: string | null = null;
    let nextConfirmErr: string | null = null;

    if (!oldPwd) {
      nextOldErr = lang === 'zh' ? '请输入当前密码' : 'Enter your current password';
    }
    if (newPwd.length < 8 || !/[a-zA-Z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
      nextNewErr =
        lang === 'zh' ? '新密码至少 8 位且须包含字母和数字' : 'Use at least 8 characters with letters and numbers';
    }
    if (!confirmPwd) {
      nextConfirmErr = lang === 'zh' ? '请再次输入新密码' : 'Confirm your new password';
    } else if (newPwd !== confirmPwd) {
      nextConfirmErr = lang === 'zh' ? '两次输入的新密码不一致' : 'New passwords do not match';
    }

    setOldPwdError(nextOldErr);
    setNewPwdError(nextNewErr);
    setConfirmPwdError(nextConfirmErr);

    if (nextOldErr) {
      oldPwdRef.current?.focus();
      return;
    }
    if (nextNewErr) {
      newPwdRef.current?.focus();
      return;
    }
    if (nextConfirmErr) {
      confirmPwdRef.current?.focus();
      return;
    }

    setPwdSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwdError(data.error || (lang === 'zh' ? '修改失败' : 'Change failed'));
        return;
      }
      setPwdSuccess(true);
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setOldPwdError(null);
      setNewPwdError(null);
      setConfirmPwdError(null);
      setShowPwd(false);
    } catch {
      setPwdError(lang === 'zh' ? '网络错误，请重试' : 'Network error, please retry');
    } finally {
      setPwdSaving(false);
    }
  };

  const handleAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/auth/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64Data: base64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAvatarError(data.error || (lang === 'zh' ? '上传失败' : 'Upload failed'));
        return;
      }
      onAvatar?.(data.avatar);
    } catch {
      setAvatarError(lang === 'zh' ? '网络错误，请重试' : 'Network error, please retry');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const res = await fetch('/api/auth/avatar', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAvatarError(data.error || (lang === 'zh' ? '移除失败' : 'Remove failed'));
        return;
      }
      onAvatar?.(null);
    } catch {
      setAvatarError(lang === 'zh' ? '网络错误，请重试' : 'Network error, please retry');
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <AccessibleDialog
      open={open}
      onClose={onClose}
      ariaLabel={t('个人资料与 AI 设置', 'Profile & AI Settings')}
      closedBy="any"
      className={`bg-white rounded-2xl shadow-xl overflow-hidden ${
        activeTab === 'ai_providers' ? 'max-w-4xl max-h-[88vh]' : 'max-w-md'
      }`}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-slate-50/50 shrink-0">
        {session.role !== 'student' ? (
          <div className="flex items-center gap-1.5 bg-gray-200/70 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'profile' ? 'bg-white text-indigo-700 shadow-3xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <UserIcon size={13} />
              {t('个人资料', 'Profile')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ai_providers')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'ai_providers'
                  ? 'bg-white text-indigo-700 shadow-3xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Blocks size={13} />
              {t('AI 模型设置', 'AI Providers')}
            </button>
          </div>
        ) : (
          <h3 className="font-semibold text-gray-800">{t('个人资料', 'Profile')}</h3>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('关闭弹窗', 'Close dialog')}
          className="text-gray-400 hover:text-gray-600 cursor-pointer p-1 rounded-full hover:bg-gray-100 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {activeTab === 'ai_providers' ? (
        <div className="flex-1 overflow-y-auto">
          <AiProvidersPanel
            lang={lang === 'zh' ? 'zh' : 'en'}
            aiProviders={aiProviders}
            onAIProvidersChanged={handleAIProvidersChanged}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
          />
        </div>
      ) : (
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* 头像 + 角色 */}
          <div className="flex items-center gap-3">
            <span className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 overflow-hidden">
              {session.avatar ? (
                <img src={session.avatar} alt={session.name} className="w-full h-full object-cover" />
              ) : (
                <UserIcon size={28} />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-800 truncate">{session.name}</p>
              <p className="text-xs text-gray-400">{roleLabel}</p>
              <div className="mt-1.5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={avatarUploading}
                  className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50 cursor-pointer"
                >
                  {avatarUploading
                    ? t('上传中…', 'Uploading…')
                    : session.avatar
                      ? t('更换头像', 'Change avatar')
                      : t('上传头像', 'Upload avatar')}
                </button>
                {session.avatar && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    disabled={avatarUploading}
                    className="text-xs text-rose-500 hover:text-rose-700 disabled:opacity-50 cursor-pointer"
                  >
                    {t('移除', 'Remove')}
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={handleAvatarFile}
              />
            </div>
          </div>
          {avatarError && <p className="text-xs text-rose-500">{avatarError}</p>}

          {/* 显示名称 */}
          <form noValidate onSubmit={(e) => void handleSave(e)}>
            <label htmlFor="profile-display-name" className="block text-sm text-gray-500 mb-1">
              {t('显示名称', 'Display Name')}
            </label>
            <div className="flex gap-2">
              <input
                ref={nameInputRef}
                id="profile-display-name"
                name="displayName"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                maxLength={50}
                aria-invalid={error ? 'true' : 'false'}
                aria-describedby={error ? 'profile-display-name-error' : undefined}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-40 enabled:hover:bg-indigo-700 transition-colors cursor-pointer shrink-0"
              >
                {saving ? t('保存中…', 'Saving…') : t('保存', 'Save')}
              </button>
            </div>
            {error && (
              <p id="profile-display-name-error" role="alert" className="text-xs text-rose-500 mt-1">
                {error}
              </p>
            )}
          </form>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <KeyRound size={16} className="text-gray-400" aria-hidden="true" />
                {t('修改密码', 'Change Password')}
              </span>
              {!showPwd && !pwdSuccess && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPwd(true);
                    setPwdError(null);
                    setOldPwdError(null);
                    setNewPwdError(null);
                    setConfirmPwdError(null);
                  }}
                  className="text-sm text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  {t('修改', 'Edit')}
                </button>
              )}
            </div>

            {pwdSuccess && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 size={16} aria-hidden="true" />
                {t('密码已修改，其他设备的登录已失效', 'Password changed. Other devices were logged out.')}
              </p>
            )}

            {showPwd && (
              <form noValidate onSubmit={(e) => void handleChangePwd(e)} className="mt-3 space-y-3">
                <PasswordInput
                  id="profile-old-password"
                  name="currentPassword"
                  label={t('当前密码', 'Current password')}
                  value={oldPwd}
                  onChange={(v) => {
                    setOldPwd(v);
                    if (oldPwdError) setOldPwdError(null);
                  }}
                  autoComplete="current-password"
                  required
                  enterKeyHint="next"
                  error={oldPwdError}
                  inputRef={oldPwdRef}
                  lang={lang}
                  placeholder={t('当前密码', 'Current password')}
                  className="w-full border border-gray-300 rounded-lg pl-3 pr-10 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  labelClassName="block text-xs font-medium text-gray-600 mb-1"
                />
                <PasswordInput
                  id="profile-new-password"
                  name="newPassword"
                  label={t('新密码', 'New password')}
                  hint={t('至少 8 位，需同时包含字母和数字', 'At least 8 characters with letters and numbers')}
                  value={newPwd}
                  onChange={(v) => {
                    setNewPwd(v);
                    if (newPwdError) setNewPwdError(null);
                  }}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  enterKeyHint="next"
                  error={newPwdError}
                  inputRef={newPwdRef}
                  lang={lang}
                  placeholder={t('输入新密码', 'Enter new password')}
                  className="w-full border border-gray-300 rounded-lg pl-3 pr-10 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  labelClassName="block text-xs font-medium text-gray-600 mb-0.5"
                />
                <PasswordInput
                  id="profile-confirm-password"
                  name="confirmPassword"
                  label={t('确认新密码', 'Confirm new password')}
                  value={confirmPwd}
                  onChange={(v) => {
                    setConfirmPwd(v);
                    if (confirmPwdError) setConfirmPwdError(null);
                  }}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  enterKeyHint="done"
                  error={confirmPwdError}
                  inputRef={confirmPwdRef}
                  lang={lang}
                  placeholder={t('再次输入新密码', 'Re-enter new password')}
                  className="w-full border border-gray-300 rounded-lg pl-3 pr-10 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  labelClassName="block text-xs font-medium text-gray-600 mb-1"
                />
                {pwdError && (
                  <p role="alert" className="text-xs text-rose-500">
                    {pwdError}
                  </p>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPwd(false);
                      setOldPwd('');
                      setNewPwd('');
                      setConfirmPwd('');
                      setPwdError(null);
                      setOldPwdError(null);
                      setNewPwdError(null);
                      setConfirmPwdError(null);
                    }}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
                  >
                    {t('取消', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={pwdSaving}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-40 enabled:hover:bg-indigo-700 transition-colors cursor-pointer"
                  >
                    {pwdSaving ? t('提交中…', 'Submitting…') : t('提交', 'Submit')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* 只读信息 */}
          <div className="border-t border-gray-100 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">{t('用户名（登录账号）', 'Username (login)')}</span>
              <span className="text-sm font-medium text-gray-700 truncate max-w-[60%]" title={session.username}>
                {session.username || '-'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">{t('角色', 'Role')}</span>
              <span className="text-sm font-medium text-gray-700">{roleLabel}</span>
            </div>
          </div>
        </div>
      )}
    </AccessibleDialog>
  );
}
