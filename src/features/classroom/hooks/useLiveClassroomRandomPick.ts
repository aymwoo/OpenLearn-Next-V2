import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { getOptionalSocket } from '../../../services/socket-service';
import type { ClassroomSyncChannel } from '../../../services/classroom-sync-channel';

export function useLiveClassroomRandomPick(options: {
  students: { id: string; name?: string }[];
  selectedLesson: string | null;
  liveClassSelectedClassId: string | null;
  onlineStudentIds: string[];
  activeStudentLessons: Record<string, string>;
  lang: string;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  setLiveClassFeed: Dispatch<SetStateAction<any[]>>;
  syncChannelRef: MutableRefObject<ClassroomSyncChannel | null>;
}) {
  const {
    students,
    selectedLesson,
    liveClassSelectedClassId,
    onlineStudentIds,
    activeStudentLessons,
    lang,
    addToast,
    setLiveClassFeed,
    syncChannelRef,
  } = options;

  const [isDrawing, setIsDrawing] = useState(false);
  const [activeDrawStudentId, setActiveDrawStudentId] = useState<string | null>(null);
  const [selectedDrawStudentIds, setSelectedDrawStudentIds] = useState<string[]>([]);
  const drawTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawRecoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (drawTickTimerRef.current) clearTimeout(drawTickTimerRef.current);
      if (drawRecoverTimerRef.current) clearTimeout(drawRecoverTimerRef.current);
    };
  }, []);

  const handleRandomPick = useCallback(() => {
    if (students.length === 0 || isDrawing) return;

    const drawPool = students.filter(
      (s) => onlineStudentIds.includes(s.id) && activeStudentLessons[s.id] === selectedLesson,
    );

    if (drawPool.length === 0) {
      addToast(
        lang === 'zh' ? '⚠️ 无法抽问' : '⚠️ Cannot Draw',
        lang === 'zh' ? '当前课堂中没有已进入的活跃学生。' : 'No students have entered the classroom yet.',
        'warning',
      );
      return;
    }

    setIsDrawing(true);

    let count = 0;
    const maxTicks = 18;
    let currentInterval = 75;

    const tick = () => {
      const randIndex = Math.floor(Math.random() * drawPool.length);
      const randomStudent = drawPool[randIndex];
      setActiveDrawStudentId(randomStudent.id);

      count++;
      if (count < maxTicks) {
        if (count > maxTicks - 5) {
          currentInterval += 45;
        }
        drawTickTimerRef.current = setTimeout(tick, currentInterval);
      } else {
        const finalStudent = drawPool[randIndex];
        setActiveDrawStudentId(null);
        setIsDrawing(false);

        setSelectedDrawStudentIds((prev) => {
          if (prev.includes(finalStudent.id)) return prev;
          return [...prev, finalStudent.id];
        });

        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: 'success',
            message: `🎯 随机提问抽选：学生 [${finalStudent.name}] 被抽中回答问题！`,
          },
          ...prev,
        ]);

        addToast(
          lang === 'zh' ? '🎯 随机提问抽选' : '🎯 Student Drawn',
          lang === 'zh'
            ? `恭喜学生 [${finalStudent.name}] 被抽中回答问题！`
            : `Student [${finalStudent.name}] was selected to answer!`,
          'success',
        );

        if (syncChannelRef.current) {
          syncChannelRef.current.broadcastPickStudent(finalStudent.id, finalStudent.name ?? finalStudent.id);
        } else {
          const socket = getOptionalSocket();
          if (socket) {
            socket.emit('teacher-pick-student', {
              studentId: finalStudent.id,
              studentName: finalStudent.name,
              lessonId: selectedLesson,
              classId: liveClassSelectedClassId,
            });
          }
        }

        if (drawRecoverTimerRef.current) clearTimeout(drawRecoverTimerRef.current);
        drawRecoverTimerRef.current = setTimeout(() => {
          setSelectedDrawStudentIds((prev) => prev.filter((id) => id !== finalStudent.id));
        }, 8000);
      }
    };

    if (drawTickTimerRef.current) clearTimeout(drawTickTimerRef.current);
    drawTickTimerRef.current = setTimeout(tick, currentInterval);
  }, [
    students,
    isDrawing,
    onlineStudentIds,
    activeStudentLessons,
    selectedLesson,
    lang,
    addToast,
    setLiveClassFeed,
    syncChannelRef,
    liveClassSelectedClassId,
  ]);

  return {
    isDrawing,
    activeDrawStudentId,
    selectedDrawStudentIds,
    handleRandomPick,
  };
}
