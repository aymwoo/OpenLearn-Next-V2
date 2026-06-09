import React from 'react';
import { X, Globe } from 'lucide-react';

interface InteractiveCoursewareViewerProps {
  coursewareId: string | null;
  onClose?: () => void;
}

export function InteractiveCoursewareViewer({ coursewareId, onClose }: InteractiveCoursewareViewerProps) {
  if (!coursewareId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-300">
        <Globe size={48} className="mb-4 text-gray-300 opacity-50" />
        <h3 className="text-lg font-medium text-gray-700">No Courseware Selected</h3>
        <p className="mt-2 text-sm text-center">Please select a courseware from the list to view it interactively.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-indigo-500" />
          <span className="font-semibold text-sm text-gray-700">Interactive Courseware</span>
        </div>
        {onClose && (
           <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded text-gray-500">
             <X size={16} />
           </button>
        )}
      </div>
      <div className="flex-1 relative bg-white">
        <iframe
          src={`/api/courseware/${coursewareId}`}
          sandbox="allow-scripts allow-same-origin"
          className="w-full h-full border-none"
          title="Interactive Courseware"
        />
      </div>
    </div>
  );
}
