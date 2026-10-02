import React from 'react';
import { Eye, LogOut, X } from 'lucide-react';
import { useOptionalAppData } from '../context/AppDataContext';

export interface ImpersonationBannerProps {
  session?: any;
  activeRole?: 'teacher' | 'student';
  setActiveRole?: (role: 'teacher' | 'student') => void;
  isStudentLiveMode?: boolean;
  isStudentPreviewMode?: boolean;
  lang?: 'zh' | 'en';
  students?: any[];
  activeStudentId?: string | null;
}

export function ImpersonationBanner(props: ImpersonationBannerProps) {
  const appData = useOptionalAppData();

  const session = props.session !== undefined ? props.session : appData?.session;
  const activeRole = props.activeRole ?? appData?.activeRole ?? 'teacher';
  const setActiveRole = props.setActiveRole ?? appData?.setActiveRole ?? (() => {});
  const isStudentLiveMode = props.isStudentLiveMode ?? appData?.isStudentLiveMode ?? false;
  const isStudentPreviewMode = props.isStudentPreviewMode ?? appData?.isStudentPreviewMode ?? false;
  const lang = (props.lang ?? appData?.lang ?? 'zh') as 'zh' | 'en';
  const students = props.students ?? appData?.students ?? [];
  const activeStudentId = props.activeStudentId !== undefined ? props.activeStudentId : (appData?.activeStudentId ?? null);

  if (!(session?.role === 'teacher' && activeRole === 'student' && !isStudentLiveMode)) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-500 text-white px-6 py-1.5 flex items-center justify-between text-xs font-medium shadow-sm z-30 shrink-0 border-b border-amber-600/30">
      <div className="flex items-center gap-2.5">
        <span className="bg-black/20 text-amber-100 px-2 py-0.5 rounded font-bold uppercase tracking-wider text-xs flex items-center gap-1">
          <Eye size={12} />
          {lang === 'zh'
            ? isStudentPreviewMode
              ? '学生视角预览'
              : '学生模拟模式'
            : isStudentPreviewMode
              ? 'Student Preview'
              : 'Student View Mode'}
        </span>
        <span>
          {lang === 'zh'
            ? `您当前正在以学生身份（${students.find((s) => s.id === activeStudentId)?.name || '未选择'}）预览系统界面与交互。`
            : `You are currently previewing the platform as student (${students.find((s) => s.id === activeStudentId)?.name || 'None'}).`}
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          // 备课预览标签页里没有教师端可回，直接关闭该标签页
          if (isStudentPreviewMode) {
            window.close();
            return;
          }
          setActiveRole('teacher');
        }}
        className="bg-white text-amber-800 hover:bg-amber-50 active:bg-amber-100 font-bold px-3 py-1 rounded-md shadow-xs transition-all flex items-center gap-1.5 cursor-pointer text-xs"
      >
        {isStudentPreviewMode ? <X size={13} /> : <LogOut size={13} />}
        {lang === 'zh'
          ? isStudentPreviewMode
            ? '关闭此预览标签页'
            : '退出模拟并返回教师端'
          : isStudentPreviewMode
            ? 'Close Preview Tab'
            : 'Exit Student View'}
      </button>
    </div>
  );
}

export default ImpersonationBanner;
