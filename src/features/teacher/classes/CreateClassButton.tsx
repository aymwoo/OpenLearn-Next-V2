import { Plus } from 'lucide-react';

export interface CreateClassButtonProps {
  lang: 'zh' | 'en';
  fetchClasses: () => Promise<void>;
}

export function CreateClassButton({ lang, fetchClasses }: CreateClassButtonProps) {
  return (
    <button
      onClick={async () => {
        const name = window.prompt(lang === 'zh' ? '请输入班级名称:' : 'Enter class name:');
        if (name) {
          const res = await fetch('/api/classes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
          });
          if (res.ok) await fetchClasses();
        }
      }}
      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg font-medium shadow-sm transition-colors cursor-pointer"
    >
      <Plus size={14} /> {lang === 'zh' ? '创建班级' : 'Create Class'}
    </button>
  );
}
