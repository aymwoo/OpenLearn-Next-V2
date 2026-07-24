import { X, User as UserIcon } from 'lucide-react';
import type { SessionType } from '../types/app';
import type { Language } from '../i18n';

interface ProfileModalProps {
  open: boolean;
  session: SessionType;
  lang: Language;
  onClose: () => void;
}

/**
 * 个人资料弹窗（Step ① 只读视图）。
 * 当前仅展示 name / username / 角色；编辑 name 的能力在 P7 后续步骤接入。
 */
export function ProfileModal({ open, session, lang, onClose }: ProfileModalProps) {
  if (!open) return null;
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  const roleLabel =
    session.role === 'teacher'
      ? session.subRole === 'administrator'
        ? t('管理员', 'Administrator')
        : t('教师', 'Teacher')
      : t('学生', 'Student');

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <dt className="text-sm text-gray-400">{label}</dt>
      <dd className="text-sm font-medium text-gray-800 truncate max-w-[60%]" title={value}>
        {value}
      </dd>
    </div>
  );

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

          <dl>
            <Row label={t('显示名称', 'Display Name')} value={session.name} />
            <Row label={t('用户名（登录账号）', 'Username (login)')} value={session.username || '-'} />
            <Row label={t('角色', 'Role')} value={roleLabel} />
          </dl>
        </div>
      </div>
    </div>
  );
}
