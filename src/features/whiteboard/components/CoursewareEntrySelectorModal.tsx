import React from 'react';

export interface CoursewareZipUploadInfo {
  uuid: string;
  name: string;
}

export interface CoursewareEntrySelectorModalProps {
  showEntrySelector: boolean;
  setShowEntrySelector: (show: boolean) => void;
  zipUploadInfo: CoursewareZipUploadInfo | null;
  zipCandidates: string[];
  handlePropsUpdate: (update: { coursewareUuid?: string; resourceId?: string }) => void;
  fetchCoursewares: () => void;
}

export const CoursewareEntrySelectorModal: React.FC<CoursewareEntrySelectorModalProps> = ({
  showEntrySelector,
  setShowEntrySelector,
  zipUploadInfo,
  zipCandidates,
  handlePropsUpdate,
  fetchCoursewares
}) => {
  if (!showEntrySelector || !zipUploadInfo) return null;

  return (
    <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4 font-sans">
      <div className="bg-white rounded-xl shadow-2xl overflow-hidden max-w-sm w-full border border-gray-100 flex flex-col scale-100 pointer-events-auto">
        <div className="px-5 py-4 border-b border-gray-150/60 bg-gray-50 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-gray-800 text-sm">选择课件入口页面</h3>
          <button onClick={() => setShowEntrySelector(false)} className="text-gray-400 hover:text-gray-650 transition-colors text-xl font-light cursor-pointer">×</button>
        </div>
        <div className="p-5 flex-1 min-h-0 space-y-3">
          <p className="text-xs text-gray-600 leading-relaxed font-medium">ZIP压缩包中含有多个HTML文件，请选择一个作为课件入口：</p>
          <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50 space-y-1">
            {zipCandidates.map(c => (
              <button
                key={c}
                onClick={async () => {
                  try {
                    const res = await fetch('/api/courseware/confirm', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        uuid: zipUploadInfo.uuid,
                        name: zipUploadInfo.name,
                        entry: c
                      })
                    });
                    if (res.ok) {
                      const data = await res.json();
                      handlePropsUpdate({ coursewareUuid: data.uuid, resourceId: '' });
                      setShowEntrySelector(false);
                      fetchCoursewares();
                    }
                  } catch (err) {
                    console.error('Failed to confirm entry point:', err);
                  }
                }}
                className="w-full text-left p-2 rounded hover:bg-indigo-50 hover:text-indigo-700 text-xs font-semibold font-mono truncate transition-all cursor-pointer"
              >
                📄 {c}
              </button>
            ))}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2 text-xs shrink-0">
          <button
            onClick={() => setShowEntrySelector(false)}
            className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors font-medium border border-gray-200 cursor-pointer"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
};
