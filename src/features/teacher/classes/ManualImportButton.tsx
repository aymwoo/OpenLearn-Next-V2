import { Upload } from 'lucide-react';

export interface ManualImportButtonProps {
  lang: 'zh' | 'en';
  setImportError: (value: string | null) => void;
  setImportSuccess: (value: string | null) => void;
  setShowImportModal: (value: boolean) => void;
}

export function ManualImportButton({
  lang,
  setImportError,
  setImportSuccess,
  setShowImportModal,
}: ManualImportButtonProps) {
  return (
    <button
      onClick={() => {
        setImportError(null);
        setImportSuccess(null);
        setShowImportModal(true);
      }}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-200 rounded-lg font-medium cursor-pointer"
    >
      <Upload size={14} /> {lang === 'zh' ? '手动导入数据' : 'Manual Import'}
    </button>
  );
}
