import React, { useState, useMemo } from 'react';

export function useStudentNotifications(
  activeRole: 'teacher' | 'student',
  studentDashboardData: any,
  lang: 'zh' | 'en',
) {
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  const [selectedNotificationForModal, setSelectedNotificationForModal] = useState<any | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const studentNotifications = useMemo(() => {
    if (activeRole !== 'student' || !studentDashboardData) return [];
    const notifs = [];
    const assignments = studentDashboardData.assignments || [];
    for (const a of assignments) {
      if (!a.submission_status) {
        notifs.push({
          id: `new-${a.id}`,
          type: 'new_assignment',
          title: lang === 'zh' ? '新发布作业' : 'New Assignment',
          message: lang === 'zh' ? `您有一项新作业："${a.title}"` : `You have a new assignment: ${a.title}`,
          date: a.created_at,
          relatedId: a.id,
        });
      } else if (a.submission_status === 'graded') {
        const hasFeedback = !!a.feedback;
        notifs.push({
          id: `graded-${a.id}`,
          type: 'graded',
          title: hasFeedback
            ? lang === 'zh'
              ? '收到新成绩与反馈'
              : 'Grade & Feedback Posted'
            : lang === 'zh'
              ? '新成绩发布'
              : 'Assignment Graded',
          message: hasFeedback
            ? lang === 'zh'
              ? `您的作业"${a.title}"已评分，得分：${a.score}%。反馈："${a.feedback}"`
              : `Your assignment "${a.title}" was graded. Score: ${a.score}%. Teacher feedback: "${a.feedback}"`
            : lang === 'zh'
              ? `您的作业"${a.title}"已评分，得分：${a.score}%`
              : `Your assignment "${a.title}" was graded. Score: ${a.score}%`,
          date: a.submitted_at || a.created_at,
          relatedId: a.id,
        });
      }
    }

    const rollcalls = studentDashboardData.rollcalls || [];
    for (const r of rollcalls) {
      notifs.push({
        id: r.id,
        type: 'rollcall_picked',
        title: lang === 'zh' ? '⚡️ 随机提问选中通知' : '⚡️ Random Pick Notification',
        message:
          lang === 'zh'
            ? `您已被老师在课程"${r.lesson_title || '课堂'}"中随机选中提问！请立即确认您的出勤与注意。`
            : `You have been randomly picked by the teacher in lesson "${r.lesson_title || 'Class'}"! Please pay immediate attention.`,
        date: r.picked_time,
        relatedId: r.lesson_id,
      });
    }

    return notifs.sort((a: any, b: any) => b.date - a.date);
  }, [activeRole, studentDashboardData, lang]);

  const unreadNotifications = useMemo(() => {
    return studentNotifications.filter((n) => !readNotifications.has(n.id));
  }, [studentNotifications, readNotifications]);

  return {
    studentNotifications,
    unreadNotifications,
    readNotifications,
    setReadNotifications,
    selectedNotificationForModal,
    setSelectedNotificationForModal,
    isNotificationsOpen,
    setIsNotificationsOpen,
  };
}
