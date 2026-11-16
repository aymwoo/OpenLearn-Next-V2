import { useRef, useState } from 'react';
import { exportActivityPack, importActivityPack } from './p1-api';

export function ActivityPackTransferButtons({
  lessonId,
  lang,
  onImported,
}: {
  lessonId?: string;
  lang: 'zh' | 'en';
  onImported?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetLessonId, setTargetLessonId] = useState(lessonId || '');

  const download = async (id: string) => {
    setBusy(true);
    try {
      const { blob, filename } = await exportActivityPack(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2" data-testid="activity-pack-transfer-buttons">
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const id = targetLessonId || lessonId;
          if (!file || !id) {
            window.alert(lang === 'zh' ? '请先选择要导入到的课节' : 'Choose a lesson first');
            return;
          }
          setBusy(true);
          void importActivityPack(id, file)
            .then((result) => {
              const unresolved = result.unresolvedBindings?.length
                ? lang === 'zh'
                  ? `\n有 ${result.unresolvedBindings.length} 项资源需在学案编排器中重新关联。`
                  : `\n${result.unresolvedBindings.length} resource(s) must be relinked in the pack editor.`
                : '';
              const warning = result.warnings.length ? `\n${result.warnings.join('\n')}` : '';
              window.alert(
                (lang === 'zh' ? '学案包已导入，默认未发布。' : 'Pack imported as unpublished.') + unresolved + warning,
              );
              onImported?.();
            })
            .catch((err) => window.alert(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false));
        }}
      />
      <button
        type="button"
        id="import-activity-pack-btn"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 font-semibold rounded-lg"
      >
        {lang === 'zh' ? '导入学案包' : 'Import activity pack'}
      </button>
      {lessonId && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void download(lessonId)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 font-semibold rounded-lg"
        >
          {lang === 'zh' ? '导出学案包' : 'Export activity pack'}
        </button>
      )}
      {!lessonId && (
        <input
          className="hidden"
          value={targetLessonId}
          onChange={(event) => setTargetLessonId(event.target.value)}
          data-testid="activity-pack-import-lesson-id"
        />
      )}
    </div>
  );
}

export function ImportActivityPackToolbarButton({
  lang,
  lessons,
  onImported,
}: {
  lang: 'zh' | 'en';
  lessons: Array<{ id: string; title: string }>;
  onImported?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [lessonId, setLessonId] = useState(lessons[0]?.id || '');
  const [busy, setBusy] = useState(false);

  return (
    <div className="relative" data-testid="import-activity-pack-toolbar">
      <button
        type="button"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 font-semibold rounded-lg"
        onClick={() => setOpen((value) => !value)}
      >
        {lang === 'zh' ? '导入学案包' : 'Import activity pack'}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-64 flex flex-col gap-2">
          <select
            className="border border-gray-200 rounded px-2 py-1 text-xs"
            value={lessonId}
            onChange={(event) => setLessonId(event.target.value)}
          >
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </select>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file || !lessonId) return;
              setBusy(true);
              void importActivityPack(lessonId, file)
                .then((result) => {
                  const unresolved = result.unresolvedBindings?.length
                    ? lang === 'zh'
                      ? `\n有 ${result.unresolvedBindings.length} 项资源需在学案编排器中重新关联。`
                      : `\n${result.unresolvedBindings.length} resource(s) must be relinked in the pack editor.`
                    : '';
                  const warning = result.warnings.length ? `\n${result.warnings.join('\n')}` : '';
                  window.alert(
                    (lang === 'zh' ? '学案包已导入，默认未发布。' : 'Pack imported as unpublished.') +
                      unresolved +
                      warning,
                  );
                  setOpen(false);
                  onImported?.();
                })
                .catch((err) => window.alert(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          />
          <button
            type="button"
            disabled={busy || !lessonId}
            className="px-2 py-1 text-xs bg-sky-600 text-white rounded"
            onClick={() => inputRef.current?.click()}
          >
            {lang === 'zh' ? '选择 zip 导入' : 'Choose zip'}
          </button>
        </div>
      )}
    </div>
  );
}
