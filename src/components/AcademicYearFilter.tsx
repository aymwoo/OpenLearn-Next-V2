import React from 'react';

export interface AcademicYearFilterProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  lang?: 'zh' | 'en';
  includeAll?: boolean;
  className?: string;
}

export function AcademicYearFilter({
  value,
  options,
  onChange,
  lang = 'zh',
  includeAll = true,
  className = '',
}: AcademicYearFilterProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-semibold ${className}`}
      aria-label={lang === 'zh' ? '学年筛选' : 'Academic year filter'}
    >
      {includeAll && <option value="all">{lang === 'zh' ? '全部学年' : 'All academic years'}</option>}
      {options.map((year) => (
        <option key={year} value={year}>
          {year}
        </option>
      ))}
    </select>
  );
}
