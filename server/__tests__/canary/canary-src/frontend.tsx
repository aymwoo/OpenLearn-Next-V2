import React, { useState } from 'react';

export default {
  activate(ctx: any) {
    // 注册 7.1 教师主导航 Tab
    ctx.ui.registerExtensionPoint('teacher.tab', {
      id: 'canary-tab',
      label: '金丝雀',
      icon: 'Bird',
      component: function CanaryTabPanel(props: any) {
        const [pingResult, setPingResult] = useState<string>('等待调用');
        const [loading, setLoading] = useState(false);

        const handlePing = async () => {
          setLoading(true);
          try {
            let res: any;
            if (typeof ctx.invokeCommand === 'function') {
              res = await ctx.invokeCommand('canary.ping', { from: 'frontend' });
            } else if (ctx.services?.frontendApi?.post) {
              res = await ctx.services.frontendApi.post('/api/plugins/execute-command', {
                type: 'canary.ping',
                payload: { from: 'frontend' },
              });
            } else {
              const fetchRes = await fetch('/api/plugins/execute-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'canary.ping', payload: { from: 'frontend' } }),
              });
              res = await fetchRes.json();
            }
            setPingResult(JSON.stringify(res));
          } catch (e: any) {
            setPingResult(`错误: ${e?.message ?? e}`);
          } finally {
            setLoading(false);
          }
        };

        return (
          <div data-testid="canary-teacher-tab-panel" className="p-8 max-w-4xl mx-auto space-y-6">
            <div className="bg-white border rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🐤</span>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">金丝雀探针控制台</h1>
                  <p className="text-sm text-gray-500">已成功通过 React 扩展点挂载到教师端主面板</p>
                </div>
              </div>

              <div className="mt-6 p-4 bg-gray-50 rounded-xl space-y-2 text-sm font-mono">
                <div>
                  <span className="text-gray-400">Props lessonId: </span>
                  <span data-testid="canary-prop-lesson-id" className="font-semibold">{String(props?.lessonId ?? 'null')}</span>
                </div>
                <div>
                  <span className="text-gray-400">Props classId: </span>
                  <span data-testid="canary-prop-class-id" className="font-semibold">{String(props?.classId ?? 'null')}</span>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t flex flex-col gap-3">
                <button
                  data-testid="canary-ping-button"
                  onClick={handlePing}
                  disabled={loading}
                  className="w-fit px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition shadow-sm disabled:opacity-50"
                >
                  {loading ? '通信中...' : '测试前后端互通 (canary.ping)'}
                </button>
                <div className="text-sm">
                  <span className="text-gray-500">探针回显响应：</span>
                  <code data-testid="canary-ping-output" className="px-2 py-1 bg-gray-100 rounded text-indigo-700 font-mono">
                    {pingResult}
                  </code>
                </div>
              </div>
            </div>
          </div>
        );
      },
    });

    // 注册 7.2 学生视图
    ctx.ui.registerExtensionPoint('student.view', {
      id: 'canary-student-view',
      label: '金丝雀学生面板',
      component: function CanaryStudentPanel(props: any) {
        return (
          <div data-testid="canary-student-panel" className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <h3 className="font-bold text-blue-900">金丝雀学生端探针</h3>
            <p className="text-sm text-blue-700">
              注入学生 ID: <span data-testid="canary-student-id">{props?.studentId ?? 'none'}</span>
            </p>
          </div>
        );
      },
    });

    // 注册 7.4 锚点槽位 (before rollcall, position 10)
    ctx.ui.registerExtensionPoint('anchor:whiteboard-toolbar:rollcall', {
      id: 'canary-anchor-rollcall-btn',
      label: '探针锚点',
      position: 10,
      placement: 'before',
      component: function CanaryAnchorButton(_props: any) {
        return (
          <button
            data-testid="canary-anchor-rollcall-btn"
            title="探针快捷操作"
            className="p-2 rounded-xl text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition flex items-center justify-center text-xs"
          >
            🐤
          </button>
        );
      },
    });

    // 注册 7.5.a 机房座位图工具栏按钮
    ctx.ui.registerExtensionPoint('classroom.seating.toolbar', {
      id: 'canary-seating-toolbar',
      label: '探针机房按钮',
      component: function CanarySeatingToolbar(props: any) {
        return (
          <div
            data-testid="canary-seating-toolbar"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-medium text-indigo-700 shadow-2xs"
          >
            <span>🐤 机房监控: {props?.lab?.room_number ?? '未指定'}</span>
          </div>
        );
      },
    });

    // 注册 7.5.b 机房座位图图例项
    ctx.ui.registerExtensionPoint('classroom.seating.legend', {
      id: 'canary-seating-legend',
      label: '探针图例',
      component: function CanarySeatingLegend(_props: any) {
        return (
          <span data-testid="canary-seating-legend" className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-xs" />
            <span>探针就绪</span>
          </span>
        );
      },
    });

    // 注册 7.5.c 机房座位图底部汇总指标卡片
    ctx.ui.registerExtensionPoint('classroom.seating.summary', {
      id: 'canary-seating-summary',
      label: '探针汇总',
      component: function CanarySeatingSummary(props: any) {
        return (
          <div
            data-testid="canary-seating-summary"
            className="col-span-full p-3 bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-150 rounded-xl flex items-center justify-between text-xs text-indigo-950 font-sans shadow-2xs"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">🐤</span>
              <span className="font-bold">金丝雀座位探针</span>
            </div>
            <div className="flex items-center gap-4 font-mono">
              <span data-testid="canary-summary-total">已排座: {props?.stats?.assignedCount ?? 0}</span>
              <span data-testid="canary-summary-class">班级: {props?.classId ?? 'none'}</span>
            </div>
          </div>
        );
      },
    });

    // 注册 7.5.d 座位卡片角标
    ctx.ui.registerExtensionPoint('classroom.seating.seat_badge', {
      id: 'canary-seat-badge',
      label: '探针徽章',
      component: function CanarySeatBadge(props: any) {
        return (
          <span
            data-testid="canary-seat-badge"
            data-student-id={props?.student?.id ?? ''}
            className="absolute -top-1 -right-1 text-xs select-none"
            title={`探针挂载: ${props?.student?.name ?? ''}`}
          >
            🐤
          </span>
        );
      },
    });

    // 注册 7.9 白板自动保存状态与操作
    ctx.ui.registerExtensionPoint('whiteboard.autosave.status', {
      id: 'canary-autosave-status',
      label: '探针自动保存状态',
      component: function CanaryAutosaveStatus(props: any) {
        return (
          <div
            data-testid="canary-autosave-status"
            className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-medium flex items-center gap-1.5"
          >
            <span>🐤 云端镜像</span>
            <span data-testid="canary-autosave-lesson-id" className="font-mono text-2xs">{props?.lessonId ?? 'none'}</span>
          </div>
        );
      },
    });

    ctx.ui.registerExtensionPoint('whiteboard.autosave.action', {
      id: 'canary-autosave-action',
      label: '探针即时快照',
      component: function CanaryAutosaveAction(props: any) {
        return (
          <button
            data-testid="canary-autosave-action-btn"
            onClick={() => props?.flush?.()}
            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 rounded-full text-xs font-bold transition cursor-pointer"
          >
            立即固化
          </button>
        );
      },
    });
  },

  deactivate(_ctx: any) {
    // 停用清理
  },
};
