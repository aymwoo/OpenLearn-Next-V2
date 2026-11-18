import { useMemo, useCallback, type Dispatch, type SetStateAction } from 'react';
import { resolvePluginCommandType } from '../../../../packages/core/plugin-host/plugin-namespace';

export function useClassroomPluginTools(options: {
  plugins: { id: string; status: string; manifest: unknown }[];
  selectedLesson: string | null;
  liveClassSelectedClassId: string | null;
  activeSegmentId: string | null;
  lang: string;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  setLiveClassFeed: Dispatch<SetStateAction<any[]>>;
  onOpenCoursewareHub?: () => void;
  fetchElements: (lessonId: string) => void;
}) {
  const {
    plugins,
    selectedLesson,
    liveClassSelectedClassId,
    activeSegmentId,
    lang,
    addToast,
    setLiveClassFeed,
    onOpenCoursewareHub,
    fetchElements,
  } = options;

  const activePlugins = plugins.filter((p) => p.status === 'active');
  const classroomTools = useMemo(
    () =>
      Array.from(
        new Map(
          activePlugins
            .flatMap((p) => {
              try {
                const manifestObj = typeof p.manifest === 'string' ? JSON.parse(p.manifest) : p.manifest;
                const legacyTools = manifestObj.classroomTools || [];
                const modernTools = manifestObj.contributes?.['classroom.tool'] || [];
                return [...legacyTools, ...modernTools].map((t: any) => ({
                  ...t,
                  pluginId: p.id,
                  manifestId: manifestObj.id,
                }));
              } catch {
                return [];
              }
            })
            .map((t) => [t.id, t]),
        ).values(),
      ),
    [activePlugins],
  );

  const handleExecuteTool = useCallback(
    async (tool: any) => {
      if (!selectedLesson) {
        addToast(
          lang === 'zh' ? '⚠️ 请选择课节' : '⚠️ Select Lesson',
          lang === 'zh' ? '请先选择要授课的课节。' : 'Please select a lesson first.',
          'warning',
        );
        return;
      }

      const needsClass = JSON.stringify(tool.payload || '').includes('$classId');
      if (needsClass && !liveClassSelectedClassId) {
        addToast(
          lang === 'zh' ? '⚠️ 请选择班级' : '⚠️ Select Class',
          lang === 'zh' ? '该工具需要指定上课班级，请在顶部先选择班级。' : 'Please select class first for this tool.',
          'warning',
        );
        return;
      }

      setLiveClassFeed((prev) => [
        {
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          type: 'info',
          message: `正在运行插件工具 [${tool.name}]...`,
        },
        ...prev,
      ]);

      try {
        const resolvedPayload = JSON.parse(
          JSON.stringify(tool.payload || {})
            .replace(/\$classId/g, liveClassSelectedClassId || '')
            .replace(/\$lessonId/g, selectedLesson || ''),
        );

        if (resolvedPayload.type === 'plugin' && resolvedPayload.data) {
          try {
            const dataObj = JSON.parse(resolvedPayload.data);
            if (!dataObj.segmentId && activeSegmentId) {
              dataObj.segmentId = activeSegmentId;
              resolvedPayload.data = JSON.stringify(dataObj);
            }
          } catch {
            /* ignore */
          }
        }

        const KERNEL_COMMAND_RE = /^(whiteboard|lesson|assignment|class|student|vfs|plugin|ai|agent|system)\./;
        const prefixedCommandType =
          !KERNEL_COMMAND_RE.test(tool.commandType) && tool.manifestId
            ? resolvePluginCommandType(tool.commandType, tool.manifestId)
            : tool.commandType;
        const res = await fetch('/api/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandType: prefixedCommandType,
            payload: resolvedPayload,
          }),
        });

        if (res.ok) {
          if (
            onOpenCoursewareHub &&
            (tool.id === 'courseware-hub-teacher' || tool.commandType === 'courseware.open_panel')
          ) {
            onOpenCoursewareHub();
          }
          setLiveClassFeed((prev) => [
            {
              id: Math.random().toString(),
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              type: 'success',
              message: `插件工具 [${tool.name}] 执行完毕，数据成功下发。`,
            },
            ...prev,
          ]);
          addToast(
            lang === 'zh' ? '✓ 工具下发成功' : '✓ Tool Synchronized',
            lang === 'zh'
              ? `工具 [${tool.name}] 已成功在当前白板上部署并投射。`
              : `Tool [${tool.name}] synchronized successfully.`,
            'success',
          );
          await fetchElements(selectedLesson);
        } else {
          const data = await res.json();
          throw new Error(data.error || 'Server error');
        }
      } catch (err: any) {
        setLiveClassFeed((prev) => [
          {
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type: 'error',
            message: `运行插件工具 [${tool.name}] 失败: ${err.message}`,
          },
          ...prev,
        ]);
        addToast(lang === 'zh' ? '❌ 运行失败' : '❌ Tool Failed', err.message || 'Execution error', 'warning');
      }
    },
    [
      selectedLesson,
      addToast,
      lang,
      liveClassSelectedClassId,
      activeSegmentId,
      onOpenCoursewareHub,
      fetchElements,
      setLiveClassFeed,
    ],
  );

  return { classroomTools, handleExecuteTool };
}
