import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { CourseListToolbarActionSlotProps } from '../../../plugin-host/types';
import { SmartEduImportModal } from './SmartEduImportModal';

export function SmartEduCourseToolbarAction({ onRefresh, lang = 'zh' }: CourseListToolbarActionSlotProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="px-3 py-1.5 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 hover:from-amber-500/30 hover:to-yellow-500/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-sm transition active:scale-98"
        title="从国家智慧教育公共服务平台 (smartedu.cn) 导入国家级精品课与微课资源"
      >
        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
        <span>国家平台导入</span>
      </button>

      <SmartEduImportModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={onRefresh}
        lang={lang}
      />
    </>
  );
}
