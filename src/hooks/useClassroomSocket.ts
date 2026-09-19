import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { FrontendAPIService } from '../services/frontend-api';
import { SocketService } from '../services/socket-service';
import { UIService } from '../services/ui-service';
import { StorageService } from '../services/storage-service';
import { whiteboardViewStore } from '../store/whiteboardViewStore';
import type { Lesson, StudentType } from '../types/app';

export interface UseClassroomSocketOptions {
  session: any;
  host: any;
  activeRole: 'teacher' | 'student';
  activeStudentId: string | null;
  selectedLesson: string | null;
  activeSegmentId: string | null;
  studentViewStatus: 'dashboard' | 'lesson' | 'assignment';
  lang: 'zh' | 'en';
  students: StudentType[];
  addToast: (title: string, msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  setOnlineStudentIds: (ids: string[]) => void;
  setActiveStudentLessons: (map: Record<string, string>) => void;
  setLessons: (updater: (prev: Lesson[]) => Lesson[]) => void;
  setActiveSegmentId: (id: string | null) => void;
  setLiveClassStudentProgress: (updater: (prev: any[]) => any[]) => void;
  setLiveClassAcknowledgedMap: (updater: (prev: Map<string, boolean>) => Map<string, boolean>) => void;
  setLiveClassFeed: (updater: (prev: any[]) => any[]) => void;
  setSelectedLesson: (id: string | null) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  studentLessonTab: 'whiteboard' | 'courseware' | 'assignment';
  setStudentLessonTab: (tab: 'whiteboard' | 'courseware' | 'assignment') => void;
  /** 当前打开的作业（教师最大化打断作业工作区时需暂存并在退出后写回） */
  selectedAssignment: any | null;
  setSelectedAssignment: (assignment: any | null) => void;
  setLocalProgressPercent: (percent: number) => void;
  fetchStudentDashboard: (id: string) => Promise<void> | void;
  fetchStudents: () => Promise<void> | void;
  fetchElements: (roomId: string) => Promise<void> | void;
}

export function useClassroomSocket(options: UseClassroomSocketOptions) {
  const {
    session,
    host,
    activeRole,
    activeStudentId,
    selectedLesson,
    activeSegmentId,
    studentViewStatus,
    lang,
    students,
    addToast,
    setOnlineStudentIds,
    setActiveStudentLessons,
    setLessons,
    setActiveSegmentId,
    setLiveClassStudentProgress,
    setLiveClassAcknowledgedMap,
    setLiveClassFeed,
    setSelectedLesson,
    setStudentViewStatus,
    studentLessonTab,
    setStudentLessonTab,
    selectedAssignment,
    setSelectedAssignment,
    setLocalProgressPercent,
    fetchStudentDashboard,
    fetchStudents,
    fetchElements,
  } = options;

  const socketRef = useRef<any>(null);
  const activeRoleRef = useRef(activeRole);
  const activeStudentIdRef = useRef(activeStudentId);
  const langRef = useRef(lang);
  const studentsRef = useRef(students);
  const addToastRef = useRef(addToast);
  const selectedLessonRef = useRef(selectedLesson);
  const selectedAssignmentRef = useRef<any>(null);
  const studentViewStatusRef = useRef(studentViewStatus);
  const studentLessonTabRef = useRef(studentLessonTab);
  /**
   * 被教师「最大化视图」打断前的学生视图。
   * 教师在互动课堂里最大化组件时会把学生强行拉到该课节的白板全屏，
   * 退出最大化后按这里记录的信息原路返回。
   */
  const interruptedViewRef = useRef<{
    viewStatus: 'dashboard' | 'lesson' | 'assignment';
    lessonTab: 'whiteboard' | 'courseware' | 'assignment';
    lessonId: string | null;
    assignment: any | null;
  } | null>(null);

  useEffect(() => {
    activeRoleRef.current = activeRole;
  }, [activeRole]);
  useEffect(() => {
    activeStudentIdRef.current = activeStudentId;
  }, [activeStudentId]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    studentsRef.current = students;
  }, [students]);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);
  useEffect(() => {
    selectedLessonRef.current = selectedLesson;
  }, [selectedLesson]);
  useEffect(() => {
    studentViewStatusRef.current = studentViewStatus;
  }, [studentViewStatus]);
  useEffect(() => {
    studentLessonTabRef.current = studentLessonTab;
  }, [studentLessonTab]);
  useEffect(() => {
    selectedAssignmentRef.current = selectedAssignment;
  }, [selectedAssignment]);
  // Main Socket Connection & Event Registration
  useEffect(() => {
    if (!session) return;
    const socket = io();
    socketRef.current = socket;

    // Initialize frontend PluginHost services after socket connection
    if (!host.isInitialized()) {
      host.initialize(
        new FrontendAPIService(),
        new SocketService(socket),
        new UIService(addToastRef.current),
        new StorageService('__app__'),
      );
    }

    // Register student presence
    if (activeRoleRef.current === 'student' && activeStudentIdRef.current) {
      socket.emit('register-student', {
        studentId: activeStudentIdRef.current,
        name: studentsRef.current.find((s) => s.id === activeStudentIdRef.current)?.name || activeStudentIdRef.current,
      });
    }

    // Join global whiteboard broadcast room
    socket.emit('join-room', 'whiteboard-broadcast');

    socket.on(
      'presence-update',
      (data: { onlineStudentIds: string[]; activeStudentLessons: Record<string, string> }) => {
        setOnlineStudentIds(data.onlineStudentIds);
        setActiveStudentLessons(data.activeStudentLessons);
      },
    );

    socket.on('lesson-progress-mode-changed', (data: any) => {
      const { lessonId, progressMode, progressConditions } = data;
      setLessons((prev) =>
        prev.map((l) => {
          if (l.id === lessonId) {
            return {
              ...l,
              progress_mode: progressMode,
              progress_conditions: progressConditions,
            };
          }
          return l;
        }),
      );
    });

    socket.on('student-active-segment-changed', (data: any) => {
      const { activeSegmentId } = data;
      setActiveSegmentId(activeSegmentId);
    });

    socket.on('student-pinged', (data: any) => {
      const msg =
        data.message ||
        (langRef.current === 'zh'
          ? '⚠️ 学习进度预警：老师注意到您的进度有些落后，请抓紧时间跟上！'
          : '⚠️ Progress Alert: The teacher noticed you are falling behind. Please keep up!');
      addToast(langRef.current === 'zh' ? '⚠️ 学习进度预警' : '⚠️ Progress Warning', msg, 'warning');
    });

    socket.on('student-progress-updated', (data: any) => {
      const { studentId, progressPercent, completed } = data;
      setLiveClassStudentProgress((prev) => {
        const index = prev.findIndex((p) => p.student_id === studentId);
        if (index !== -1) {
          const next = [...prev];
          next[index] = {
            ...next[index],
            progress_percent: progressPercent,
            completed: completed ? 1 : 0,
          };
          return next;
        } else {
          return [
            ...prev,
            {
              student_id: studentId,
              progress_percent: progressPercent,
              completed: completed ? 1 : 0,
            },
          ];
        }
      });
    });

    socket.on('assignment-graded-toast', (data: any) => {
      if (
        activeRoleRef.current === 'student' &&
        activeStudentIdRef.current &&
        data.studentId === activeStudentIdRef.current
      ) {
        const titleText = data.assignmentTitle || data.assignmentId;
        const msg =
          langRef.current === 'zh'
            ? `您的作业"${titleText}"已完成评分！得分：${data.score}%。建议反馈已收到，快去查看。`
            : `Your assignment "${titleText}" was graded. Score: ${data.score}%. Tutoring feedback has been posted.`;

        addToast(langRef.current === 'zh' ? '🎓 作业已评分' : '🎓 Assignment Graded', msg, 'success');

        fetchStudentDashboard(activeStudentIdRef.current);
      }
    });

    socket.on('student-picked', (data: any) => {
      if (
        activeRoleRef.current === 'student' &&
        activeStudentIdRef.current &&
        data.studentId === activeStudentIdRef.current
      ) {
        const msg =
          langRef.current === 'zh'
            ? `闪电警报！您已被老师在课程随机提问点名中抽中！请立即集中注意力参与课堂。`
            : `Attention alert! You have been randomly picked by the teacher! Please pay immediate attention.`;

        addToast(langRef.current === 'zh' ? '⚡️ 随机点名提问' : '⚡️ Classroom Pick Alert', msg, 'warning');

        fetchStudentDashboard(activeStudentIdRef.current);
      }

      setLiveClassFeed((prev) => [
        {
          id: `feed-pick-${data.studentId}-${data.pickedTime || Date.now()}`,
          time: new Date(data.pickedTime || Date.now()).toLocaleTimeString(),
          type: 'picked',
          message:
            langRef.current === 'zh'
              ? `点名互动：随机抽中学生【${data.studentName}】。`
              : `Classroom Pick: Randomly selected student "${data.studentName}".`,
        },
        ...prev,
      ]);
    });

    socket.on('student-acknowledged', (data: any) => {
      const { studentId } = data;
      setLiveClassAcknowledgedMap((prev) => {
        const next = new Map(prev);
        next.set(studentId, true);
        return next;
      });
      setLiveClassFeed((prev) => [
        {
          id: `feed-ack-${studentId}-${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          type: 'checkin',
          message:
            langRef.current === 'zh'
              ? `学生已确认收到提问点名（学生 ID: ${studentId}）。`
              : `Student acknowledged the classroom call (Student ID: ${studentId}).`,
        },
        ...prev,
      ]);
      fetchStudents();
    });

    socket.on('class-lock-status-changed', (data: any) => {
      const { lessonId, locked } = data;
      if (activeRoleRef.current === 'student' && activeStudentIdRef.current) {
        Promise.resolve(fetchStudents()).then(() => {
          if (locked && lessonId) {
            setSelectedLesson(lessonId);
            setStudentViewStatus('lesson');
            addToast(
              langRef.current === 'zh' ? '🔒 课程已被锁定' : '🔒 Lesson Locked',
              langRef.current === 'zh'
                ? '老师已锁定当前授课，您将无法切换到其他页面。'
                : 'The teacher has locked the active lesson. You cannot leave this page.',
              'info',
            );
          }
        });
        fetchStudentDashboard(activeStudentIdRef.current);
      } else {
        fetchStudents();
      }
    });

    socket.on('whiteboard-sync', (data: any) => {
      const { roomId, type } = data || {};
      if (type === 'refresh' && roomId) {
        fetchElements(roomId);
        if (!selectedLessonRef.current && activeRoleRef.current === 'student') {
          setSelectedLesson(roomId);
          setStudentViewStatus('lesson');
        }
        socket.emit('join-room', roomId);
      }
    });

    /**
     * 恢复被「教师最大化视图」打断前的学生视图。
     * 同一次中断只捕获一次，因此反复 maximize 不会覆盖最初的位置。
     */
    const restoreInterruptedView = () => {
      whiteboardViewStore.getState().clearRemoteFullscreen();
      const interrupted = interruptedViewRef.current;
      interruptedViewRef.current = null;
      if (!interrupted) return;
      setStudentLessonTab(interrupted.lessonTab);
      if (interrupted.viewStatus === 'assignment') {
        // 作业对象在中断时被暂存，答题状态（quizStudentAnswers）始终在 App 层，
        // 因此原样回到原来的作业工作区
        setSelectedAssignment(interrupted.assignment ?? null);
        if (interrupted.lessonId) setSelectedLesson(interrupted.lessonId);
        setStudentViewStatus('assignment');
      }
    };

    /**
     * 教师端最大化 / 退出最大化白板组件。
     *
     * 事件由服务端投递到课节房间 **和** 班级房间，因此学生无论处于
     * 课节白板、互动课件、作业标签页还是作业工作区都能收到。
     */
    socket.on('whiteboard-fullscreen-changed', (data: { lessonId?: string; elementId?: string | null }) => {
      if (activeRoleRef.current !== 'student') return;
      const targetLesson = data?.lessonId;
      const elementId = data?.elementId ?? null;

      if (!elementId) {
        // 教师退出最大化（或离开白板 / 元素被删 / 重连兜底）：原路返回
        restoreInterruptedView();
        return;
      }
      if (!targetLesson) return;

      // 仅在学生确实在听这节授课时才打断：
      //  - 课节视图：必须是同一节课（避免把自学另一节课的学生拉走）
      //  - 作业工作区：不论手上是哪份作业（含从学习面板直接打开的）
      // 停留在学习面板的学生不打扰。
      const viewStatus = studentViewStatusRef.current;
      const isAttending =
        viewStatus === 'lesson' ? selectedLessonRef.current === targetLesson : viewStatus === 'assignment';
      if (!isAttending) return;

      if (!whiteboardViewStore.getState().remoteFullscreenElementId) {
        interruptedViewRef.current = {
          viewStatus,
          lessonTab: studentLessonTabRef.current,
          lessonId: selectedLessonRef.current,
          // 仅作业工作区需要暂存 / 写回作业上下文
          assignment: viewStatus === 'assignment' ? selectedAssignmentRef.current : null,
        };
      }

      whiteboardViewStore.getState().setRemoteFullscreenElementId(elementId);
      if (viewStatus === 'assignment') {
        // 清空作业上下文，避免 useAppPolling 同时拉取「作业白板」与「课节白板」
        // 两个房间的 elements 互相覆盖；教师退出时再写回
        setSelectedAssignment(null);
      }
      setSelectedLesson(targetLesson);
      fetchElements(targetLesson);
      setStudentViewStatus('lesson');
      setStudentLessonTab('whiteboard');
    });

    // 安全网：教师端崩溃 / 断线时收不到「退出最大化」广播，
    // 学生重连后清空远程最大化状态并恢复被打断的视图，避免被永久困在
    // 不可自行退出的全屏里。
    socket.on('connect', () => {
      restoreInterruptedView();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session, activeRole, activeStudentId]);

  // Student enters/leaves lesson room
  useEffect(() => {
    if (socketRef.current && activeRole === 'student' && activeStudentId) {
      if (studentViewStatus === 'lesson' && selectedLesson) {
        socketRef.current.emit('enter-lesson', {
          studentId: activeStudentId,
          lessonId: selectedLesson,
        });

        fetch(`/api/students/${activeStudentId}/progress`)
          .then((res) => res.json())
          .then((progressData) => {
            if (Array.isArray(progressData)) {
              const currentProg = progressData.find((p: any) => p.lesson_id === selectedLesson);
              setLocalProgressPercent(currentProg ? currentProg.progress_percent : 0);
            }
          })
          .catch(console.error);
      } else {
        socketRef.current.emit('leave-lesson', { studentId: activeStudentId });
      }
    }
  }, [studentViewStatus, selectedLesson, activeRole, activeStudentId]);

  // Teacher broadcasts active segment
  useEffect(() => {
    if (activeRole === 'teacher' && selectedLesson && activeSegmentId && socketRef.current) {
      socketRef.current.emit('teacher-broadcast-segment', {
        lessonId: selectedLesson,
        activeSegmentId,
      });
    }
  }, [activeSegmentId, selectedLesson, activeRole]);

  return {
    socketRef,
  };
}
