import React from 'react';
import { Sparkles, X, CheckCircle2 } from 'lucide-react';
import { useOptionalAppData } from '../context/AppDataContext';
import { ClassroomSyncChannel } from '../services/classroom-sync-channel';
import { postStudentReadNotification } from '../services/progressService.js';
import { StudentInteractiveOverlay } from '../features/student/StudentInteractiveOverlay';

export interface ClassroomOverlaysProps {
  pickedAnnouncement?: any;
  setPickedAnnouncement?: (val: any) => void;
  pickedAlertData?: any;
  setPickedAlertData?: (val: any) => void;
  lang?: 'zh' | 'en';
  selectedLesson?: string | null;
  liveClassSelectedClassId?: string | null;
  activeStudentId?: string | null;
  students?: any[];
  activeRole?: 'teacher' | 'student';
  isStudentLiveMode?: boolean;
  liveStudentParam?: string | null;
  addToast?: any;
  setReadNotifications?: any;
}

export function ClassroomOverlays(props: ClassroomOverlaysProps) {
  const appData = useOptionalAppData();

  const pickedAnnouncement = props.pickedAnnouncement !== undefined ? props.pickedAnnouncement : appData?.pickedAnnouncement;
  const setPickedAnnouncement = props.setPickedAnnouncement ?? appData?.setPickedAnnouncement;
  const pickedAlertData = props.pickedAlertData !== undefined ? props.pickedAlertData : appData?.pickedAlertData;
  const setPickedAlertData = props.setPickedAlertData ?? appData?.setPickedAlertData;
  const lang = (props.lang ?? appData?.lang ?? 'zh') as 'zh' | 'en';
  const selectedLesson = props.selectedLesson !== undefined ? props.selectedLesson : (appData?.selectedLesson ?? null);
  const liveClassSelectedClassId = props.liveClassSelectedClassId !== undefined ? props.liveClassSelectedClassId : (appData?.liveClassSelectedClassId ?? null);
  const activeStudentId = props.activeStudentId !== undefined ? props.activeStudentId : (appData?.activeStudentId ?? null);
  const students = props.students ?? appData?.students ?? [];
  const activeRole = props.activeRole ?? appData?.activeRole ?? 'teacher';
  const isStudentLiveMode = props.isStudentLiveMode ?? appData?.isStudentLiveMode ?? false;
  const liveStudentParam = props.liveStudentParam !== undefined ? props.liveStudentParam : (appData?.liveStudentParam ?? null);
  const addToast = props.addToast ?? appData?.addToast ?? (() => {});
  const setReadNotifications = props.setReadNotifications ?? appData?.setReadNotifications ?? (() => {});

  return (
    <>
      {/* 全班随机抽问结果通知横幅 (Classroom Pick Announcement Banner) */}
      {pickedAnnouncement && !pickedAlertData && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9990] animate-in slide-in-from-top-4 duration-300 pointer-events-auto max-w-lg w-auto">
          <div className="flex items-center gap-3 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full shadow-xl shadow-amber-500/25 backdrop-blur-xs text-sm font-bold border border-amber-300/40">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
            </span>
            <Sparkles size={16} className="text-amber-200 shrink-0" />
            <span className="truncate">
              {lang === 'zh'
                ? `🎯 课堂抽问：老师随机抽中了【${pickedAnnouncement.studentName}】同学回答问题！`
                : `🎯 Classroom Pick: Teacher randomly selected [${pickedAnnouncement.studentName}] to answer!`}
            </span>
            {setPickedAnnouncement && (
              <button
                type="button"
                onClick={() => setPickedAnnouncement(null)}
                className="ml-2 hover:bg-white/20 rounded-full p-1 transition-colors cursor-pointer text-white/80 hover:text-white shrink-0"
                aria-label="Close announcement"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 课堂随机提问/点名互动应答模态框 (Student Picked Alert Modal - 着重提示被抽中学生) */}
      {pickedAlertData && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-surface border-4 border-amber-500 rounded-3xl shadow-2xl shadow-amber-500/40 ring-8 ring-amber-500/20 p-7 max-w-md w-full text-center space-y-5 animate-in zoom-in-95 duration-300">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 bg-amber-500/30 rounded-full animate-ping" />
              <div className="relative w-20 h-20 bg-gradient-to-tr from-amber-500 to-orange-500 text-white rounded-full flex items-center justify-center shadow-lg shadow-amber-500/40">
                <Sparkles size={40} className="animate-pulse" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black text-main tracking-tight">
                {lang === 'zh' ? '⚡️ 闪电抽问：老师抽中了你！' : '⚡️ Classroom Pick: Teacher Selected You!'}
              </h3>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-black text-lg">
                <span>🎯</span>
                <span>{pickedAlertData.studentName}</span>
              </div>
              <p className="text-sm text-muted leading-relaxed">
                {lang === 'zh' ? (
                  <>老师在课堂随机抽问中抽中了你，请立即集中注意力参与互动回答！</>
                ) : (
                  <>The teacher selected you in the classroom random pick. Please respond and participate now!</>
                )}
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  const channel = new ClassroomSyncChannel(undefined, selectedLesson, liveClassSelectedClassId);
                  channel.acknowledgePick(pickedAlertData.studentId);
                  channel.destroy();
                  if (pickedAlertData.rollcallId) {
                    const rollcallId = pickedAlertData.rollcallId;
                    if (activeStudentId) {
                      postStudentReadNotification(activeStudentId, rollcallId).catch(console.error);
                    }
                    setReadNotifications((prev: Set<string>) => new Set(prev).add(rollcallId));
                  }
                  setPickedAlertData?.(null);
                  addToast(
                    lang === 'zh' ? '🙋‍♂️ 已确认答到' : '🙋‍♂️ Acknowledged',
                    lang === 'zh' ? '已向老师中控台发送举手答到信号！' : 'Sent acknowledge signal to teacher!',
                    'success',
                  );
                }}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-black text-base rounded-2xl shadow-xl shadow-amber-500/35 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={20} />
                <span>
                  {lang === 'zh' ? '🙋‍♂️ 我已准备好 / 确认答到 (反馈给老师)' : '🙋‍♂️ Ready / Acknowledge to Teacher'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 学生端实时互动浮层 (Pacing Signals, Quick Polls, Buzzer, 60s Exit Ticket) */}
      {(activeRole === 'student' || isStudentLiveMode) && (
        <StudentInteractiveOverlay
          lessonId={selectedLesson}
          studentId={activeStudentId || liveStudentParam || undefined}
          studentName={students.find((s) => s.id === (activeStudentId || liveStudentParam))?.name || undefined}
          lang={lang as any}
        />
      )}
    </>
  );
}

export default ClassroomOverlays;
