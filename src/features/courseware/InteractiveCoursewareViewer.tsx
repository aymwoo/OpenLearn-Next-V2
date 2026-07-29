import React, { useState, useEffect, useRef } from 'react';
import { X, Globe, Maximize2, Minimize2 } from 'lucide-react';

interface InteractiveCoursewareViewerProps {
  coursewareId: string | null;
  onClose?: () => void;
}

export function InteractiveCoursewareViewer({ coursewareId, onClose }: InteractiveCoursewareViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement && document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    const element = containerRef.current;
    if (!element) return;

    if (!document.fullscreenElement) {
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if ((element as any).webkitRequestFullscreen) {
        (element as any).webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    }
  };

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
    <div ref={containerRef} className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 select-none">
          <Globe size={16} className="text-indigo-500" />
          <span className="font-semibold text-sm text-gray-700">Interactive Courseware</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-1 hover:bg-gray-200 rounded-lg text-gray-500 transition-colors cursor-pointer"
            title={isFullscreen ? "退出全屏" : "全屏播放"}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-lg text-gray-500 transition-colors cursor-pointer">
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 relative bg-white">
        <iframe
          src={`/api/courseware/${coursewareId}`}
          sandbox="allow-scripts allow-same-origin allow-downloads allow-forms"
          allowFullScreen
          className="w-full h-full border-none"
          title="Interactive Courseware"
        />
      </div>
    </div>
  );
}
