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
  },

  deactivate(_ctx: any) {
    // 停用清理
  },
};
