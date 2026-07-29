import React from 'react';
import {
  BookOpen,
  Users,
  LayoutTemplate,
  Sparkles,
  PenTool,
  PlayCircle,
  Globe
} from 'lucide-react';

export interface UserGuideViewerProps {
  copiedId: string | null;
  handleCopy: (id: string, text: string) => void;
}

export const UserGuideViewer: React.FC<UserGuideViewerProps> = ({
  copiedId,
  handleCopy
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Top welcome banner */}
        <div className="bg-gradient-to-r from-indigo-900 to-indigo-950 rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row gap-5 items-start">
          <div className="p-4 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-2xl shrink-0">
            <BookOpen size={32} />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              Edu-OS 核心系统主要特性使用教程
              <span className="text-[10px] bg-indigo-500/30 text-indigo-200 border border-indigo-500/50 px-2 py-0.5 rounded-full font-normal">v2.1.0 LTS</span>
            </h3>
            <p className="text-xs text-indigo-200 leading-relaxed">
              本指南为教育实验操作系统 (Edu-OS) 的深度使用手册。详细阐述如何使用内核指令管理班级与学生、基于大纲结构化推进课件时间轴、在互动白板中动态注入脑图和测验元素、启动全屏锁定与签到的教学控制流，以及编写并集成支持 AI 成绩回传的 HTML Applet 实验组件。
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="text-[10px] bg-indigo-800/40 text-indigo-150 border border-indigo-700/50 px-2 py-0.5 rounded-full font-medium">🏫 班级与学生指令集</span>
              <span className="text-[10px] bg-emerald-800/40 text-emerald-150 border border-emerald-700/50 px-2 py-0.5 rounded-full font-medium">📋 课程大纲时间轴同步</span>
              <span className="text-[10px] bg-amber-800/40 text-amber-150 border border-amber-700/50 px-2 py-0.5 rounded-full font-medium">🎨 协作白板指令渲染</span>
              <span className="text-[10px] bg-sky-800/40 text-sky-150 border border-sky-700/50 px-2 py-0.5 rounded-full font-medium">🚀 postMessage 成绩监听</span>
            </div>
          </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Card 1: Commands for Class/Student Management */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 border-b border-gray-100 pb-3 text-indigo-600 font-bold">
                <div className="p-2 bg-indigo-50 rounded-xl">
                  <Users size={20} />
                </div>
                <div>
                  <h4 className="text-sm text-gray-900">1. 使用核心指令管理班级与学生</h4>
                  <p className="text-[11px] text-gray-400 font-normal mt-0.5">Administrative CLI & Capability Model</p>
                </div>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed mt-3">
                Edu-OS 采用权限隔离的<strong>能力安全模型 (Capability Model)</strong>。任何行政、学籍以及课表排期修改，底层最终都会被封装为非对称的内核指令，经由分布式指令总线进行安全校验与事务落库。
              </p>

              <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 text-[11px] text-indigo-900 space-y-1.5 mt-3">
                <span className="font-bold block">🔒 核心访问权限声明 (RBAC Capabilities):</span>
                <ul className="list-disc list-inside space-y-1 text-gray-600 text-[10.5px]">
                  <li><code className="bg-white/80 px-1 rounded border border-indigo-150">class:write</code>：允许创建/删除行政班级。</li>
                  <li><code className="bg-white/80 px-1 rounded border border-indigo-150">student:write</code>：允许注册学生、修改学籍或修改设备锁定状态。</li>
                  <li><code className="bg-white/80 px-1 rounded border border-indigo-150">schedule:write</code>：允许编排课程，或临时将某一日期的课程替换为星期几的常规课表。</li>
                </ul>
              </div>
            </div>
            
            <div className="space-y-3 font-mono text-[11px] mt-4">
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-150 relative">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-indigo-600 font-bold">A. 创建班级 (class.create)</span>
                  <button
                    onClick={() => handleCopy('guide_cmd_class', '{\n  "name": "高三一班",\n  "description": "物理实验班"\n}')}
                    className="text-[10px] text-indigo-600 hover:underline hover:text-indigo-800 font-sans"
                  >
                    {copiedId === 'guide_cmd_class' ? '已复制' : '复制参数'}
                  </button>
                </div>
                <pre className="text-[10px] text-gray-500 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`{
  "name": "高三一班",
  "description": "2026届物理实验班"
}`}
                </pre>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 border border-gray-150 relative">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-indigo-600 font-bold">B. 注册学生 (student.register)</span>
                  <button
                    onClick={() => handleCopy('guide_cmd_student', '{\n  "name": "李华",\n  "email": "lihua@openlearn.org",\n  "password": "mypassword123"\n}')}
                    className="text-[10px] text-indigo-600 hover:underline hover:text-indigo-800 font-sans"
                  >
                    {copiedId === 'guide_cmd_student' ? '已复制' : '复制参数'}
                  </button>
                </div>
                <pre className="text-[10px] text-gray-500 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`{
  "name": "李华",
  "email": "lihua@openlearn.org",
  "password": "mypassword123"
}`}
                </pre>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 border border-gray-150 relative">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-indigo-600 font-bold">C. 强制学生屏幕锁定 (student.lock_lesson)</span>
                  <button
                    onClick={() => handleCopy('guide_cmd_lock', '{\n  "studentId": "student-uuid-xxxx",\n  "lockedLessonId": "lesson-uuid-yyyy"\n}')}
                    className="text-[10px] text-indigo-600 hover:underline hover:text-indigo-800 font-sans"
                  >
                    {copiedId === 'guide_cmd_lock' ? '已复制' : '复制参数'}
                  </button>
                </div>
                <pre className="text-[10px] text-gray-500 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`{
  "studentId": "student-uuid-xxxx",
  "lockedLessonId": "lesson-uuid-yyyy"
}`}
                </pre>
              </div>
            </div>
          </div>

          {/* Card 2: Course Editing & Timeline */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 border-b border-gray-100 pb-3 text-emerald-600 font-bold">
                <div className="p-2 bg-emerald-50 rounded-xl">
                  <LayoutTemplate size={20} />
                </div>
                <div>
                  <h4 className="text-sm text-gray-900">2. 课程编辑与时间轴推进</h4>
                  <p className="text-[11px] text-gray-400 font-normal mt-0.5">Structure Markdown & Timeline Sync</p>
                </div>
              </div>
              
              <div className="space-y-3 mt-3 text-xs text-gray-600 leading-relaxed">
                <p>
                  在系统"课程管理"中，教师可以使用内置大纲结构化的 Markdown 工具编排课件，或选择数学、计算机科学、文学、物理、历史、艺术模板一键填充结构化实验教案。
                </p>
                
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-150 space-y-1 text-[11px] font-sans">
                  <span className="font-bold text-gray-800 block">📝 大纲解析与进度切片规则：</span>
                  <p className="text-gray-500">
                    系统内核采用递归的 AST 语法分析器，提取文档中的一级标题 (<code className="font-mono text-rose-600 font-semibold bg-gray-100 px-0.5 rounded">#</code>) 与二级标题 (<code className="font-mono text-rose-600 font-semibold bg-gray-100 px-0.5 rounded">##</code>) 作为教学<b>时间轴切片 (Timeline Segments)</b>。
                  </p>
                </div>

                <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100 space-y-2 text-[11px] text-emerald-800">
                  <span className="font-bold flex items-center gap-1"><Sparkles size={12} /> 时间轴实时推进机制 (Sync Protocol)：</span>
                  <ol className="list-decimal list-inside space-y-1 text-gray-600 leading-relaxed">
                    <li>当教师在教学控制台选中大纲某个段落时，前端会通过 WebSocket 通信管道发送一个 <code className="font-mono bg-white text-emerald-700 px-1 rounded border border-emerald-150">sync_timeline</code> 广播包。</li>
                    <li>学生终端捕获该消息包，解析出对应的锚点 DOM ID，并自动执行 DOM 的 <code className="font-mono bg-white text-emerald-700 px-1 rounded border border-emerald-150">.scrollIntoView({"{ behavior: 'smooth' }"})</code> 动画平滑定位。</li>
                    <li>在此模式下，学生终端的大脑侧边滚轮处于<b>阻尼锁定状态</b>，禁止自行向上游或下游浏览，以保证全体学生始终与教师保持完全一致的视野。</li>
                  </ol>
                </div>
              </div>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl border border-gray-150 text-[10px] text-gray-500 leading-relaxed">
              💡 <span className="font-semibold text-gray-700">常规课表与临时调整：</span>如果需要将某一天的课程临时调换为星期几的常规安排（如将下周一临时指定为星期五课表），可在"课表看板"或使用 <code className="bg-gray-100 font-mono text-rose-600 px-1 rounded">schedule.update_date_mapping</code> 指令进行快速热重载，数据库将自动持久化这种临时的映射规则。
            </div>
          </div>

          {/* Card 3: Interactive Whiteboard */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 border-b border-gray-100 pb-3 text-amber-600 font-bold">
                <div className="p-2 bg-amber-50 rounded-xl">
                  <PenTool size={20} />
                </div>
                <div>
                  <h4 className="text-sm text-gray-900">3. 互动协作白板深度原理</h4>
                  <p className="text-[11px] text-gray-400 font-normal mt-0.5">Whiteboard Drawing API & State Serialization</p>
                </div>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed mt-3">
                协作白板采用轻量级矢量序列化格式存储。每一笔涂鸦、矩形、圆形、文本或第三方卡片均被抽象为带有全局唯一 ID 的矢量节点模型，实时在 SQLite 数据库中持久化并在前端的 Canvas/SVG 容器中完成合并渲染。
              </p>

              <div className="p-3 bg-gray-50 rounded-xl border border-gray-150 text-[10.5px] font-mono text-gray-500 space-y-1 mt-3">
                <span className="font-bold text-gray-700 block font-sans">💾 矢量节点序列化数据示例 (SQLite Schema):</span>
                <pre className="text-[9.5px] overflow-x-auto whitespace-pre-wrap">
{`{
  "id": "elt-90928a",
  "type": "rect",
  "data": "{\\"x\\":120,\\"y\\":80,\\"w\\":150,\\"h\\":60,\\"stroke\\":\\"#6366f1\\",\\"fill\\":\\"#e0e7ff\\"}"
}`}
                </pre>
              </div>

              <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-100 text-[11px] text-amber-900 space-y-2 mt-3">
                <span className="font-bold block">💡 互动绘制指令说明 (whiteboard.draw):</span>
                <p className="text-gray-600 leading-relaxed">
                  除了在画板上使用画笔绘图外，插件生态亦可通过向总线派发 <code className="bg-white text-amber-700 border border-amber-150 px-1 rounded font-mono">whiteboard.draw</code> 指令，动态在指定位置绘制结构化的几何内容或思维导图组件。
                </p>
              </div>
            </div>

            <div className="bg-amber-50/50 rounded-xl p-3 border border-amber-100 text-xs text-amber-800 relative mt-4">
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold">A. 动态绘制思维脑图参数示例</span>
                <button
                  onClick={() => handleCopy('guide_cmd_draw_map', '{\n  "lessonId": "lesson-101",\n  "type": "mindmap",\n  "data": "{\\"title\\":\\"光电效应\\",\\"branches\\":[\\"赫兹发现\\",\\"爱因斯坦解释\\"]}"\n}')}
                  className="text-[10px] text-amber-700 hover:underline font-sans font-bold"
                >
                  {copiedId === 'guide_cmd_draw_map' ? '已复制' : '复制 Payload'}
                </button>
              </div>
              <pre className="font-mono text-[9px] text-amber-900/70 overflow-x-auto">
{`{
  "lessonId": "lesson-101",
  "type": "mindmap",
  "data": "{\\"title\\":\\"光电效应\\",\\"branches\\":[\\"赫兹发现\\",\\"爱因斯坦解释\\"]}"
}`}
              </pre>
            </div>
          </div>

          {/* Card 4: Classroom Control & Teaching */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 border-b border-gray-100 pb-3 text-sky-600 font-bold">
                <div className="p-2 bg-sky-50 rounded-xl">
                  <PlayCircle size={20} />
                </div>
                <div>
                  <h4 className="text-sm text-gray-900">4. 现场教学与课堂控制流程</h4>
                  <p className="text-[11px] text-gray-400 font-normal mt-0.5">Live Classroom Lifecycle & WS Protocol</p>
                </div>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed mt-3">
                现场教学是 Edu-OS 实现教师端对全班学生端实时掌控、授课与互动的核心驱动模块。以下是系统推荐的标准课堂控制流：
              </p>

              <div className="space-y-3 text-xs mt-3">
                <div className="flex gap-3 items-start">
                  <div className="h-5 w-5 font-mono font-bold bg-sky-100 border border-sky-200 text-sky-700 rounded-lg flex items-center justify-center shrink-0 mt-0.5">1</div>
                  <div>
                    <span className="font-semibold text-gray-800">课堂通道初始化 (WebSocket Connect)</span>
                    <p className="text-[11px] text-gray-500 mt-0.5">点击"开始上课"后，服务器将为该班级开辟独立的 Room 广播室。所有在该行政班级内的学生设备自动建立双向心跳长连接。</p>
                  </div>
                </div>

                <div className="flex gap-3 items-start">
                  <div className="h-5 w-5 font-mono font-bold bg-sky-100 border border-sky-200 text-sky-700 rounded-lg flex items-center justify-center shrink-0 mt-0.5">2</div>
                  <div>
                    <span className="font-semibold text-gray-800">全屏课件与屏幕强控 (Class Lock)</span>
                    <p className="text-[11px] text-gray-500 mt-0.5">教师启动教学视图后，系统会广播 `class_lock` 事件。学生终端界面被迫最小化非教学区，全屏强制渲染指定的课时 Markdown 文档，拦截一切其他的键盘路由跳转。</p>
                  </div>
                </div>

                <div className="flex gap-3 items-start">
                  <div className="h-5 w-5 font-mono font-bold bg-sky-100 border border-sky-200 text-sky-700 rounded-lg flex items-center justify-center shrink-0 mt-0.5">3</div>
                  <div>
                    <span className="font-semibold text-gray-800">出勤签到统计 (Roll Call & Attendance)</span>
                    <p className="text-[11px] text-gray-500 mt-0.5">教师一键下发签到令牌，学生端界面滑出覆盖式的签到组件。系统利用 WebSocket 增量计数，在教师端看板的考勤环形图中实时计算到课率、迟到率以及旷课名单。</p>
                  </div>
                </div>

                <div className="flex gap-3 items-start">
                  <div className="h-5 w-5 font-mono font-bold bg-sky-100 border border-sky-200 text-sky-700 rounded-lg flex items-center justify-center shrink-0 mt-0.5">4</div>
                  <div>
                    <span className="font-semibold text-gray-800">交互过程感知与动态审计 (Activity Auditing)</span>
                    <p className="text-[11px] text-gray-500 mt-0.5">学生每一次提交的实验数据、成绩变动、签到时刻等操作，均以结构化日志格式推送并在教师端的动态操作审计终端上显示。</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-sky-50/50 rounded-xl border border-sky-100 text-[10.5px] text-sky-850 flex items-center gap-2 mt-4">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span><strong>考勤数据存根：</strong>签到动作一经产生，将自动持久化至底层的 <code className="font-mono text-[10px] bg-white px-1 border border-sky-200 rounded">attendance</code> 表中，随时供导出 PDF 或生成学期报告。</span>
            </div>
          </div>

        </div>

        {/* Bottom Row: HTML Applet Detailed Guide */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-6 space-y-6 shadow-md">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-3 text-indigo-400 font-bold">
            <div className="p-2 bg-slate-800 rounded-xl">
              <Globe size={24} />
            </div>
            <div>
              <h4 className="text-base text-white">5. HTML Applet 的打包、分发与 AI 成绩监听注入机制</h4>
              <p className="text-[11px] text-slate-400 font-normal mt-0.5">HTML Applet Architecture & parent.postMessage Interface Spec</p>
            </div>
          </div>

          <div className="text-xs text-slate-300 leading-relaxed space-y-3">
            <p>
              HTML Applet 是 Edu-OS 系统架构中用以承载高级虚拟物理实验、交互式小游戏、或第三方考试系统的微网页插件。Applet 被封装运行在宿主页面的 <code className="bg-slate-800 text-indigo-300 px-1 rounded font-mono">iframe</code> 沙箱容器中。
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
