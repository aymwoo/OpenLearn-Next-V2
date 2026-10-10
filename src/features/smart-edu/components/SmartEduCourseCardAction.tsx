import React, { useState } from 'react';
import { UploadCloud, CheckCircle2, Loader2 } from 'lucide-react';
import type { CourseCardActionSlotProps } from '../../../plugin-host/types';

export function SmartEduCourseCardAction({ course, onRefresh }: CourseCardActionSlotProps) {
  const [submitting, setSubmitting] = useState(false);
  const [reported, setReported] = useState(false);

  if (!course) return null;

  const handleReport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setSubmitting(true);
      const res = await fetch('/api/external/smart-edu/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: course.id,
          reportData: { title: course.title, lastSync: Date.now() },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setReported(true);
        setTimeout(() => setReported(false), 2500);
        onRefresh?.();
      } else {
        alert(data.error || '上报失败');
      }
    } catch (err: any) {
      alert(err.message || '网络连接异常');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleReport}
      disabled={submitting}
      className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-700/50 rounded-lg text-xs transition flex items-center gap-1"
      title="同步本课教案与元数据至国家智慧教育公共服务平台"
    >
      {submitting ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
      ) : reported ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <UploadCloud className="w-3.5 h-3.5" />
      )}
      <span className="text-[11px]">国家云</span>
    </button>
  );
}
