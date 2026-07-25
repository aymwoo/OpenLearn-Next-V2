import { useState, useRef, type ChangeEvent } from 'react';
import { X, User as UserIcon, KeyRound, CheckCircle2 } from 'lucide-react';
import type { SessionType } from '../types/app';
import type { Language } from '../i18n';

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
  const [name, setName] = useState(session.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 头像上传
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // 修改密码区块
  const [showPwd, setShowPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
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

  const handleSave = async () => {
    if (!changed || saving) return;
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

  const pwdValid =
    oldPwd.length > 0 &&
    newPwd.length >= 8 &&
    /[a-zA-Z]/.test(newPwd) &&
    /[0-9]/.test(newPwd) &&
    newPwd === confirmPwd;

  const handleChangePwd = async () => {
    if (!pwdValid || pwdSaving) return;
    setPwdSaving(true);
    setPwdError(null);
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
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{t('个人资料', 'Profile')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
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
          <div>
            <label className="block text-sm text-gray-500 mb-1">{t('显示名称', 'Display Name')}</label>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <button
                onClick={handleSave}
                disabled={!changed || saving}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-40 enabled:hover:bg-indigo-700 transition-colors cursor-pointer shrink-0"
              >
                {saving ? t('保存中…', 'Saving…') : t('保存', 'Save')}
              </button>
            </div>
            {error && <p className="text-xs text-rose-500 mt-1">{error}</p>}
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <KeyRound size={16} className="text-gray-400" />
                {t('修改密码', 'Change Password')}
              </span>
              {!showPwd && !pwdSuccess && (
                <button
                  onClick={() => {
                    setShowPwd(true);
                    setPwdError(null);
                  }}
                  className="text-sm text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  {t('修改', 'Edit')}
                </button>
              )}
            </div>

            {pwdSuccess && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 size={16} />
                {t('密码已修改，其他设备的登录已失效', 'Password changed. Other devices were logged out.')}
              </p>
            )}

            {showPwd && (
              <div className="mt-3 space-y-3">
                <input
                  type="password"
                  value={oldPwd}
                  onChange={(e) => setOldPwd(e.target.value)}
                  placeholder={t('当前密码', 'Current password')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder={t('新密码（≥8 位，含字母和数字）', 'New password (≥8 chars, letters + numbers)')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder={t('确认新密码', 'Confirm new password')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                {pwdError && <p className="text-xs text-rose-500">{pwdError}</p>}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setShowPwd(false);
                      setOldPwd('');
                      setNewPwd('');
                      setConfirmPwd('');
                      setPwdError(null);
                    }}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
                  >
                    {t('取消', 'Cancel')}
                  </button>
                  <button
                    onClick={handleChangePwd}
                    disabled={!pwdValid || pwdSaving}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-40 enabled:hover:bg-indigo-700 transition-colors cursor-pointer"
                  >
                    {pwdSaving ? t('提交中…', 'Submitting…') : t('提交', 'Submit')}
                  </button>
                </div>
              </div>
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
      </div>
    </div>
  );
}
