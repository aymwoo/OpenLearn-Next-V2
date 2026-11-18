import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { listFromEnvelope } from '../../../utils/listEnvelope.js';
import { onSocketInstance } from '../../../services/socket-service';
import { isModePacksEnabled } from '../mode-pack';
import { normalizeSegmentType } from '../../../../packages/core/plugin-host/mode-pack';
import { FINISHED_STATUSES, IN_PROGRESS_STATUSES } from '../LiveSubmissionsPanel';
import type { TeacherMiddleTab } from '../map-teacher-middle-tab';

export type PluginSubmissionRow = {
  id: string;
  studentId: string;
  studentName?: string | null;
  source: { pluginId: string; adapterId: string; modeId?: string };
  kind: string;
  status: string;
  score?: number | null;
  submittedAt?: number | null;
};

export function useLiveClassroomSubmissions(options: {
  selectedLesson: string | null;
  liveClassSelectedClassId: string | null;
  middleTab: TeacherMiddleTab;
  timelineSegments: { id: string; type?: string }[];
  activeSegmentId: string | null;
  students: { id: string; name?: string }[];
  lang: string;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  fetchStudents: () => Promise<void>;
}) {
  const {
    selectedLesson,
    liveClassSelectedClassId,
    middleTab,
    timelineSegments,
    activeSegmentId,
    students,
    lang,
    addToast,
    fetchStudents,
  } = options;

  const [attempts, setAttempts] = useState<any[]>([]);
  const [pluginSubmissions, setPluginSubmissions] = useState<PluginSubmissionRow[]>([]);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<any | null>(null);
  const [rawPayload, setRawPayload] = useState<any | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [submissionFilter, setSubmissionFilter] = useState<'all' | 'submitted' | 'started'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [autoRecordRule, setAutoRecordRule] = useState<{
    enabled: boolean;
    minCompletion: number;
    strategy: 'latest' | 'highest';
  }>({
    enabled: false,
    minCompletion: 0,
    strategy: 'latest',
  });
  const [autoRecordRuleLoaded, setAutoRecordRuleLoaded] = useState(false);
  const [savingAutoRecordRule, setSavingAutoRecordRule] = useState(false);
  const [autoRecordReport, setAutoRecordReport] = useState<{ recorded: number; skipped: number } | null>(null);
  const [autoRecordRunning, setAutoRecordRunning] = useState(false);

  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);
  const stableAddToast = useCallback(
    (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') =>
      addToastRef.current(title, message, type),
    [],
  );

  const fetchAttempts = useCallback(async () => {
    setLoadingAttempts(true);
    try {
      const res = await fetch('/api/courseware/attempts?pageSize=all');
      if (res.ok) {
        const data = listFromEnvelope<any>(await res.json());
        setAttempts(data);
      }
    } catch (e) {
      console.error('Failed to fetch attempts', e);
    } finally {
      setLoadingAttempts(false);
    }
  }, []);

  const fetchPluginSubmissions = useCallback(async () => {
    if (!selectedLesson) return;
    try {
      const params = new URLSearchParams({ lessonId: selectedLesson });
      if (liveClassSelectedClassId) params.set('classId', liveClassSelectedClassId);
      if (isModePacksEnabled()) {
        const seg = timelineSegments.find((s) => s.id === activeSegmentId) as { type?: string } | undefined;
        const t = normalizeSegmentType(seg?.type);
        if (t === 'xuean' || t.startsWith('xuean:')) params.set('modeId', 'xuean');
      }
      const res = await fetch(`/api/classroomflowserver/submissions?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setPluginSubmissions(Array.isArray(data?.submissions) ? data.submissions : []);
      }
    } catch {
      // 提交适配器未启用时保持空列表
    }
  }, [selectedLesson, liveClassSelectedClassId, activeSegmentId, timelineSegments]);

  const handleGradePluginSubmission = useCallback(
    async (adapterId: string, submissionId: string, score: number) => {
      try {
        const res = await fetch(`/api/classroomflowserver/submissions/${encodeURIComponent(adapterId)}/grade`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionId,
            lessonId: selectedLesson,
            classId: liveClassSelectedClassId,
            score,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fetchPluginSubmissions();
      } catch (e) {
        console.error('grade plugin submission failed', e);
      }
    },
    [selectedLesson, liveClassSelectedClassId, fetchPluginSubmissions],
  );

  useEffect(() => {
    if (middleTab === 'submissions') {
      fetchAttempts();
      fetchPluginSubmissions();
    }
  }, [middleTab, fetchPluginSubmissions, fetchAttempts]);

  useEffect(() => {
    let detach: (() => void) | null = null;
    const off = onSocketInstance((socket) => {
      detach?.();
      const handler = () => {
        fetchAttempts();
      };
      socket.on('courseware-attempt-updated', handler);
      detach = () => {
        if (typeof socket.off === 'function') socket.off('courseware-attempt-updated', handler);
      };
    });
    return () => {
      off();
      detach?.();
    };
  }, [fetchAttempts]);

  const handlePromoteAttempt = async (attemptId: string) => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      addToast(
        lang === 'zh' ? '⚠️ 无法操作' : '⚠️ Action Prevented',
        lang === 'zh' ? '请先在顶部栏选择要绑定的课节和班级。' : 'Please select lesson and class first.',
        'warning',
      );
      return;
    }
    try {
      const res = await fetch(`/api/courseware/attempts/${attemptId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: selectedLesson,
          classId: liveClassSelectedClassId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        addToast(
          lang === 'zh' ? '✓ 学习数据已保存' : '✓ Data Recorded',
          lang === 'zh'
            ? `成功将该数据存入数据库！分数: ${data.score}，已同步更新至学生学习进度。`
            : `Successfully recorded submission! Score: ${data.score}.`,
          'success',
        );
        fetchAttempts();
        await fetchStudents();
      } else {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Server error');
      }
    } catch (err: any) {
      addToast(
        lang === 'zh' ? '❌ 保存失败' : '❌ Save Failed',
        err.message || 'Error occurred while saving.',
        'warning',
      );
    }
  };

  const handleMarkAbsent = async (studentId: string, coursewareId: string | undefined) => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      addToast(
        lang === 'zh' ? '⚠️ 无法操作' : '⚠️ Action Prevented',
        lang === 'zh' ? '请先在顶部栏选择要绑定的课节和班级。' : 'Please select lesson and class first.',
        'warning',
      );
      return;
    }
    if (!coursewareId) {
      addToast(
        lang === 'zh' ? '⚠️ 无法标记缺考' : '⚠️ Cannot Mark Absent',
        lang === 'zh' ? '该提交缺少课件标识。' : 'Missing courseware identity.',
        'warning',
      );
      return;
    }
    try {
      const res = await fetch('/api/courseware/attempts/mark-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: selectedLesson,
          classId: liveClassSelectedClassId,
          studentId,
          coursewareId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(
          lang === 'zh' ? '✓ 已标记缺考' : '✓ Marked Absent',
          lang === 'zh'
            ? `已将【${data.coursewareName ?? '该课件'}】成绩标记为缺考（结算按 0 分计）。学生补交不会自动覆盖，教师改判请手动录入。`
            : `Marked as absent for ${data.coursewareName ?? 'the courseware'}. Manual recording overrides this.`,
          'success',
        );
        fetchAttempts();
        await fetchStudents();
      } else {
        throw new Error(data.error || 'Server error');
      }
    } catch (err: any) {
      addToast(
        lang === 'zh' ? '❌ 标记缺考失败' : '❌ Mark Absent Failed',
        err.message || 'Error occurred while marking absent.',
        'warning',
      );
    }
  };

  const loadAutoRecordRule = useCallback(async () => {
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType: 'courseware.get_score_config', payload: { coursewareId: '*' } }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const config = json?.result ?? json;
      setAutoRecordRule({
        enabled: Boolean(config?.auto_record_enabled ?? config?.autoRecordEnabled),
        minCompletion: Number(config?.auto_record_min_completion ?? config?.autoRecordMinCompletion ?? 0) || 0,
        strategy:
          config?.auto_record_strategy === 'highest' || config?.autoRecordStrategy === 'highest' ? 'highest' : 'latest',
      });
    } catch {
      // 静默：规则读取失败不应阻断页面
    } finally {
      setAutoRecordRuleLoaded(true);
    }
  }, []);

  const saveAutoRecordRule = async (next: {
    enabled: boolean;
    minCompletion: number;
    strategy: 'latest' | 'highest';
  }) => {
    const previous = autoRecordRule;
    setAutoRecordRule(next);
    setSavingAutoRecordRule(true);
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandType: 'courseware.save_score_config',
          payload: {
            coursewareId: '*',
            autoRecordEnabled: next.enabled,
            autoRecordMinCompletion: next.minCompletion,
            autoRecordStrategy: next.strategy,
          },
        }),
      });
      if (!res.ok) throw new Error('Failed to save rule');
      const json = await res.json();
      if (json && json.success === false) throw new Error(json.error || 'save_score_config rejected');
      stableAddToast(
        lang === 'zh' ? '✓ 规则已保存' : '✓ Rule Saved',
        next.enabled
          ? lang === 'zh'
            ? `学生提交课件后将自动录入学期成绩（完成度门槛 ${Math.round(next.minCompletion * 100)}%）`
            : `Scores will be recorded automatically (completion ≥ ${Math.round(next.minCompletion * 100)}%)`
          : lang === 'zh'
            ? '已关闭自动录入，仍可逐条手动录入'
            : 'Auto-record disabled; manual recording still available',
        'success',
      );
    } catch (e) {
      setAutoRecordRule(previous);
      console.error('[LiveClassroomView] save auto-record rule failed:', e);
      stableAddToast(
        lang === 'zh' ? '❌ 规则保存失败' : '❌ Failed to save rule',
        lang === 'zh' ? '请检查网络后重试。' : 'Please retry.',
        'warning',
      );
    } finally {
      setSavingAutoRecordRule(false);
    }
  };

  const runAutoRecord = useCallback(
    async (silent = false) => {
      if (!selectedLesson || !liveClassSelectedClassId) return;
      setAutoRecordRunning(true);
      try {
        const res = await fetch('/api/courseware/attempts/auto-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId: selectedLesson, classId: liveClassSelectedClassId }),
        });
        if (!res.ok) throw new Error('auto-record failed');
        const data = await res.json();
        setAutoRecordReport({ recorded: data.recorded ?? 0, skipped: data.skipped ?? 0 });
        if ((data.recorded ?? 0) > 0) {
          await fetchAttempts();
        }
        if (!silent) {
          stableAddToast(
            lang === 'zh' ? '✓ 自动录入完成' : '✓ Auto-record done',
            lang === 'zh'
              ? `已录入 ${data.recorded ?? 0} 条，跳过 ${data.skipped ?? 0} 条（已录入 / 无分数 / 未达门槛）`
              : `Recorded ${data.recorded ?? 0}, skipped ${data.skipped ?? 0}`,
            'success',
          );
        }
      } catch {
        if (!silent) {
          stableAddToast(
            lang === 'zh' ? '❌ 自动录入失败' : '❌ Auto-record failed',
            lang === 'zh' ? '请稍后重试，或使用逐条手动录入。' : 'Please retry or record manually.',
            'warning',
          );
        }
      } finally {
        setAutoRecordRunning(false);
      }
    },
    [selectedLesson, liveClassSelectedClassId, fetchAttempts, stableAddToast, lang],
  );

  const handleViewRaw = async (attempt: any) => {
    setSelectedAttempt(attempt);
    setLoadingRaw(true);
    setRawPayload(null);
    try {
      const res = await fetch(`/api/courseware/attempts/${attempt.attemptId}/raw`);
      if (res.ok) {
        const data = await res.json();
        setRawPayload(data);
      } else {
        setRawPayload({ error: 'Failed to load raw data' });
      }
    } catch (e: any) {
      setRawPayload({ error: e.message || 'Error loading data' });
    } finally {
      setLoadingRaw(false);
    }
  };

  useEffect(() => {
    if (middleTab !== 'submissions') return;
    void loadAutoRecordRule();
  }, [middleTab, loadAutoRecordRule]);

  useEffect(() => {
    if (middleTab !== 'submissions' || !autoRecordRuleLoaded || !autoRecordRule.enabled) return;
    if (!selectedLesson || !liveClassSelectedClassId) return;
    void runAutoRecord(true);
  }, [middleTab, autoRecordRuleLoaded, selectedLesson, liveClassSelectedClassId, runAutoRecord]);

  const classStudentIds = liveClassSelectedClassId ? students.map((s) => s.id) : [];
  const classFilteredAttempts = liveClassSelectedClassId
    ? attempts.filter((a) => classStudentIds.includes(a.studentId))
    : attempts;
  const displayAttempts = useMemo(
    () =>
      classFilteredAttempts.filter((a) => {
        const matchesSearch =
          a.studentName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.coursewareName?.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus =
          submissionFilter === 'all' ||
          (submissionFilter === 'submitted' && FINISHED_STATUSES.includes(a.status)) ||
          (submissionFilter === 'started' && IN_PROGRESS_STATUSES.includes(a.status));

        return matchesSearch && matchesStatus;
      }),
    [classFilteredAttempts, searchQuery, submissionFilter],
  );

  return {
    attempts,
    setAttempts,
    pluginSubmissions,
    loadingAttempts,
    selectedAttempt,
    setSelectedAttempt,
    rawPayload,
    loadingRaw,
    submissionFilter,
    setSubmissionFilter,
    searchQuery,
    setSearchQuery,
    autoRecordRule,
    autoRecordRuleLoaded,
    savingAutoRecordRule,
    saveAutoRecordRule,
    autoRecordReport,
    runAutoRecord,
    autoRecordRunning,
    fetchAttempts,
    fetchPluginSubmissions,
    handleGradePluginSubmission,
    handlePromoteAttempt,
    handleMarkAbsent,
    handleViewRaw,
    displayAttempts,
  };
}
