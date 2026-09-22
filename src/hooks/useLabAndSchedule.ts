import { useState, useCallback } from 'react';
import type { ScheduleType, AttendanceType } from '../store/appStore';

export function useLabAndSchedule() {
  const [computerLabs, setComputerLabs] = useState<any[]>([]);
  const [loadingLabs, setLoadingLabs] = useState(false);
  const [classSeats, setClassSeats] = useState<{ lab_id: string | null; seats: any[] }>({
    lab_id: null,
    seats: [],
  });
  const [savingSeats, setSavingSeats] = useState(false);

  const [todaySchedules, setTodaySchedules] = useState<any[]>([]);
  const [classSchedulesMap, setClassSchedulesMap] = useState<Record<string, ScheduleType[]>>({});
  const [scheduleAttendanceMap, setScheduleAttendanceMap] = useState<Record<string, AttendanceType[]>>({});
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);
  const [newScheduleDate, setNewScheduleDate] = useState<string>('');
  const [newScheduleLessonId, setNewScheduleLessonId] = useState<string>('');

  const fetchLabs = useCallback(async () => {
    try {
      setLoadingLabs(true);
      const res = await fetch('/api/labs');
      if (res.ok) setComputerLabs(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLabs(false);
    }
  }, []);

  const fetchClassSeats = useCallback(async (classId: string) => {
    try {
      const res = await fetch(`/api/classes/${classId}/seats`);
      if (res.ok) {
        const data = await res.json();
        setClassSeats(data);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchTodaySchedules = useCallback(async () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const res = await fetch(`/api/schedules/today?date=${todayStr}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.schedules) {
          setTodaySchedules(data.schedules);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch today schedules', e);
    }
  }, []);

  const fetchClassSchedules = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/classes/${id}/schedules`);
      if (res.ok) {
        const data = await res.json();
        setClassSchedulesMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  }, []);

  const fetchScheduleAttendance = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/schedules/${id}/attendance`);
      if (res.ok) {
        const data = await res.json();
        setScheduleAttendanceMap((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {}
  }, []);

  return {
    computerLabs,
    setComputerLabs,
    loadingLabs,
    setLoadingLabs,
    fetchLabs,
    classSeats,
    setClassSeats,
    savingSeats,
    setSavingSeats,
    fetchClassSeats,
    todaySchedules,
    setTodaySchedules,
    fetchTodaySchedules,
    classSchedulesMap,
    setClassSchedulesMap,
    fetchClassSchedules,
    scheduleAttendanceMap,
    setScheduleAttendanceMap,
    fetchScheduleAttendance,
    expandedScheduleId,
    setExpandedScheduleId,
    newScheduleDate,
    setNewScheduleDate,
    newScheduleLessonId,
    setNewScheduleLessonId,
  };
}
