import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/AccessibleDialog';

export interface CreateClassButtonProps {
  lang: 'zh' | 'en';
  fetchClasses: () => Promise<void>;
}

export function CreateClassButton({ lang, fetchClasses }: CreateClassButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);

  const close = () => {
    if (saving) return;
    setOpen(false);
    setName('');
    setError(null);
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('请输入班级名称', 'Please enter a class name'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        setError(t('创建失败，请重试', 'Failed to create class'));
        return;
      }
      setOpen(false);
      setName('');
      await fetchClasses();
    } catch {
      setError(t('网络错误，请重试', 'Network error, please retry'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg font-medium shadow-sm transition-colors cursor-pointer"
      >
        <Plus size={14} /> {t('创建班级', 'Create Class')}
      </button>

      <AccessibleDialog
        open={open}
        onClose={close}
        ariaLabelledBy="create-class-dialog-title"
        closedBy="closerequest"
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle id="create-class-dialog-title" icon={<Plus size={18} />}>
            {t('创建班级', 'Create Class')}
          </DialogTitle>
          <DialogCloseButton label={t('关闭弹窗', 'Close dialog')} onClick={close} />
        </DialogHeader>

        <form noValidate onSubmit={(e) => void handleSubmit(e)}>
          <DialogBody className="space-y-2">
            <label htmlFor="create-class-name" className="block text-sm text-muted">
              {t('班级名称', 'Class name')}
            </label>
            <input
              id="create-class-name"
              name="className"
              type="text"
              autoFocus
              required
              maxLength={50}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder={t('请输入班级名称', 'Enter class name')}
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? 'create-class-name-error' : undefined}
              className="w-full border border-theme bg-surface rounded-lg px-3 py-2 text-sm text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
            />
            {error && (
              <p id="create-class-name-error" role="alert" className="text-xs text-rose-500">
                {error}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <DialogButton variant="secondary" onClick={close} disabled={saving}>
              {t('取消', 'Cancel')}
            </DialogButton>
            <DialogButton variant="primary" type="submit" disabled={saving}>
              {saving ? t('创建中…', 'Creating…') : t('创建', 'Create')}
            </DialogButton>
          </DialogFooter>
        </form>
      </AccessibleDialog>
    </>
  );
}
