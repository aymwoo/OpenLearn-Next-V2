import React from 'react';
import { Award, ShieldCheck } from 'lucide-react';
import type { CourseCardBadgeSlotProps } from '../../../plugin-host/types';

export function SmartEduCourseBadge({ course }: CourseCardBadgeSlotProps) {
  if (!course) return null;

  let meta: any = null;
  try {
    if (typeof course.content === 'string' && course.content.startsWith('{')) {
      const parsed = JSON.parse(course.content);
      meta = parsed.smartEduMetadata;
    }
  } catch {
    meta = null;
  }

  // 也支持标题带【国家精品课】的前缀检测
  const isSmartEduTitle = typeof course.title === 'string' && course.title.includes('国家精品课');

  if (!meta && !isSmartEduTitle) return null;

  const awardLabel =
    meta?.awardLevel === 'ministry_excellent'
      ? '部优示范课'
      : meta?.awardLevel === 'national_silver'
        ? '国二等奖'
        : '国家精品课';

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-xs tracking-tight"
      title={meta ? `国家智慧教育平台认证精品课 · 证书号: ${meta.code || 'SED-2026'}` : '国家智慧教育平台认证课程'}
    >
      <Award className="w-3 h-3 text-amber-400 shrink-0" />
      <span>{awardLabel}</span>
    </span>
  );
}
