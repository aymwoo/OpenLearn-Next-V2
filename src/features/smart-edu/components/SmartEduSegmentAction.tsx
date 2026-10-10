import React, { useState } from 'react';
import { Film, Check } from 'lucide-react';
import type { EditorSegmentActionSlotProps } from '../../../plugin-host/types';

export function SmartEduSegmentAction({ segment, onPatch, readOnly }: EditorSegmentActionSlotProps) {
  const [added, setAdded] = useState(false);

  if (readOnly) return null;

  const handleInsertResource = () => {
    if (!segment) return;
    const currentDesc = segment.description || '';
    const addonText = `\n> 🌐 【国家智慧教育平台·资源切片】已关联教育部审定课标微课视频 (smartedu.cn/v/${segment.id || 'res'})`;
    if (!currentDesc.includes('国家智慧教育平台')) {
      onPatch?.({ description: (currentDesc + addonText).trim() });
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    }
  };

  return (
    <button
      onClick={handleInsertResource}
      className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-[11px] font-medium transition flex items-center space-x-1"
      title="从国家平台关联教育部新课标配套微课切片"
    >
      {added ? <Check className="w-3 h-3 text-emerald-400" /> : <Film className="w-3 h-3 text-amber-400" />}
      <span>{added ? '已关联微课' : '国家微课'}</span>
    </button>
  );
}
