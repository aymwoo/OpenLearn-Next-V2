import { useState } from 'react';
import { X, User as UserIcon } from 'lucide-react';
import type { SessionType } from '../types/app';
import type { Language } from '../i18n';

interface ProfileModalProps {
  open: boolean;
  session: SessionType;
  lang: Language;
  onClose: () => void;
  onSaved: (name: string) => void;
}

/**
 * 个人资料弹窗（Step ② 起支持编辑显示名称 name）。
 * 保存调用自服务端点 /api/auth/profile，仅更新当前登录用户自身，不改用户名/角色。
 */
export function ProfileModal({ open, session, lang, onClose, onSaved }: ProfileModalProps) {
  const [name, setName] = useState(session.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setError(lang === 'zh' ? '网络错误，请重试' : 'Network error, please retry');
    } finally {
      setSaving(false);
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

        <div className="p-5">
          <div className="flex items-center gap-3 mb-5">
            <span className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <UserIcon size={28} />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-800 truncate">{session.name}</p>
              <p className="text-xs text-gray-400">{roleLabel}</p>
            </div>
          </div>

          <div className="space-y-4">
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

            <div className="flex items-center justify-between py-2 border-t border-gray-100">
              <span className="text-sm text-gray-400">{t('用户名（登录账号）', 'Username (login)')}</span>
              <span className="text-sm font-medium text-gray-700 truncate max-w-[60%]" title={session.username}>
                {session.username || '-'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-gray-100">
              <span className="text-sm text-gray-400">{t('角色', 'Role')}</span>
              <span className="text-sm font-medium text-gray-700">{roleLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
