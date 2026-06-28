import React, { useState } from 'react';
import { MessageSquare, Wand2, Plus, Trash2, PenTool, LayoutTemplate, Globe, Code, Puzzle, Blocks, Download, Upload, Paperclip, Terminal, ChevronUp, ChevronDown, ChevronRight, FileText, Shield, ShieldAlert, Check, X, Folder, File as FileIcon, Activity, Users, BarChart2, ClipboardList, Send, FileBadge, PlayCircle, Loader2, Calendar as CalendarIcon, CheckCircle2, Bell, BookOpen, Settings, PanelRightClose, PanelRightOpen, Home, Presentation, HelpCircle, Search, Settings2, Percent, ListFilter, Clock, Sparkles, Eye, Maximize2, Minimize2, Database, Shuffle } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { translations } from '../../i18n';
import { Markdown } from 'react-markdown';

interface HelpViewProps {
  registeredCommands: any[];
  onRefresh: () => void;
}

export function HelpView({ registeredCommands, onRefresh }: HelpViewProps) {
  const lang = useAppStore((s) => s.lang);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'vfs' | 'edu' | 'mgmt' | 'proc' | 'ai' | 'plugin'>('all');
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null);
  const [commandPayloads, setCommandPayloads] = useState<Record<string, string>>({});
  const [executionResults, setExecutionResults] = useState<Record<string, { success: boolean; data?: any; error?: string; loading?: boolean }>>({});
  
  const [activeTab, setActiveTab] = useState<'commands' | 'sdk_guide' | 'user_guide'>('commands');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const categories = [
    { id: 'all', name: '全部命令', icon: Blocks },
    { id: 'edu', name: '教学与画板', icon: BookOpen },
    { id: 'mgmt', name: '班级与学生', icon: Users },
    { id: 'vfs', name: '虚拟文件系统', icon: Folder },
    { id: 'proc', name: '进程控制', icon: Terminal },
    { id: 'ai', name: 'AI 规划生成', icon: Wand2 },
    { id: 'plugin', name: '第三方插件', icon: Puzzle }
  ];

  const getCommandCategory = (commandType: string): string => {
    if (commandType.startsWith('vfs.')) return 'vfs';
    if (commandType.startsWith('lesson.') || commandType.startsWith('whiteboard.')) return 'edu';
    if (commandType.startsWith('class.') || commandType.startsWith('student.') || commandType.startsWith('assignment.') || commandType.startsWith('attendance.') || commandType.startsWith('schedule.')) return 'mgmt';
    if (commandType.startsWith('process.')) return 'proc';
    if (commandType.startsWith('ai.')) return 'ai';
    return 'plugin';
  };

  const generateInitialPayload = (schema: any): string => {
    if (!schema || schema.type !== 'OBJECT') return '{}';
    const payload: Record<string, any> = {};
    if (schema.properties) {
      Object.keys(schema.properties).forEach(key => {
        const prop = schema.properties[key];
        if (prop.type === 'ARRAY') {
          payload[key] = prop.items?.type === 'STRING' ? ["选项 A", "选项 B", "选项 C"] : [];
        } else if (prop.type === 'INTEGER' || prop.type === 'NUMBER') {
          payload[key] = 100;
        } else if (prop.type === 'BOOLEAN') {
          payload[key] = true;
        } else {
          if (key.toLowerCase().includes('id')) {
            payload[key] = 'auto-id-or-current';
          } else if (key.toLowerCase().includes('name')) {
            payload[key] = '测试名称';
          } else if (key.toLowerCase().includes('content')) {
            payload[key] = '# 初始内容\n这是一个通过命令创建的组件或段落。';
          } else {
            payload[key] = prop.description || '示例参数';
          }
        }
      });
    }
    return JSON.stringify(payload, null, 2);
  };

  const handleExecute = async (cmdType: string, actionId: string) => {
    const rawPayload = commandPayloads[actionId] || '{}';
    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(rawPayload);
    } catch (e: any) {
      setExecutionResults(prev => ({
        ...prev,
        [actionId]: { success: false, error: `Invalid JSON Payload: ${e.message}` }
      }));
      return;
    }

    setExecutionResults(prev => ({
      ...prev,
      [actionId]: { loading: true, success: false }
    }));

    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType: cmdType, payload: parsedPayload })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setExecutionResults(prev => ({
          ...prev,
          [actionId]: { success: true, data: data.result }
        }));
      } else {
        setExecutionResults(prev => ({
          ...prev,
          [actionId]: { success: false, error: data.error || 'Server execution failed' }
        }));
      }
    } catch (err: any) {
      setExecutionResults(prev => ({
        ...prev,
        [actionId]: { success: false, error: err.message || 'Fetch failed' }
      }));
    }
  };

  const filteredCommands = registeredCommands.filter(cmd => {
    const matchesSearch = 
      cmd.id.toLowerCase().includes(search.toLowerCase()) ||
      cmd.commandType.toLowerCase().includes(search.toLowerCase()) ||
      cmd.description.toLowerCase().includes(search.toLowerCase());
    
    const cat = getCommandCategory(cmd.commandType);
    const matchesCategory = selectedCategory === 'all' || cat === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const pluginBoilerplateCode = `/**
 * Edu-OS 插件开发完整示例 (ESM 规范)
 * 思维导图与随堂卡片插件 — 演示完整的插件开发流程
 */
export default {
  // 1. 插件基础声明 manifest（同步导出，用于安装时校验）
  manifest: {
    id: "ext-mindmap-assistant",
    name: "思维导图与画板卡片扩展",
    version: "1.1.0",
    capabilitiesProposed: [
      "whiteboard:write",
      "vfs:read"
    ]
  },

  // 2. 激活入口 activate — 接收 PluginContext，可访问全部内核服务
  activate: async (ctx) => {
    // 从 ctx.services 解构需用的内核服务
    const { commandBus, actionRegistry, eventBus } = ctx.services;

    // ── 注册 Action（AI Agent 可发现的工具声明）──
    await actionRegistry.register({
      id: 'ext-mindmap-generate',
      commandType: 'mindmap.create',
      description: '为当前白板一键生成结构化的知识思维导图卡片',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '关联的课堂课时 ID' },
          topic:    { type: 'STRING', description: '思维导图的中心主题名称' },
          nodes:    { type: 'ARRAY', items: { type: 'STRING' }, description: '脑图的子分支节点列表' }
        },
        required: ['lessonId', 'topic', 'nodes']
      }
    });

    // ── 注册命令处理器 ──
    await commandBus.registerHandler('mindmap.create', {
      execute: async (command) => {
        const { lessonId, topic, nodes } = command.payload;

        // 调用内核 whiteboard.draw 在画板上绘制思维导图
        const drawCmd = commandBus.createCommand(
          'whiteboard.draw',
          { lessonId, type: 'text', data: JSON.stringify({
              text: \`📊 \${topic}\\n\${nodes.map((n,i) => \`\${i+1}. \${n}\`).join('\\n')}\`,
              x: 200, y: 120, fontSize: 18, fill: '#4f46e5'
            }) },
          command.actorId
        );
        const drawResult = await commandBus.execute(drawCmd);

        // 发布事件通知前端刷新
        await eventBus.publish({
          id: crypto.randomUUID?.() ?? 'evt_' + Date.now(),
          type: 'mindmap.created',
          source: 'ext-mindmap',
          payload: { lessonId, topic },
          timestamp: Date.now()
        });

        return { success: true, elementId: drawResult?.elementId, topic };
      }
    });
  },

  // 3. 可选：停用清理
  deactivate: async () => {
    console.log('[Mindmap] Plugin deactivated, resources auto-cleaned by PluginHost');
  }
};`;

  const pluginInteractiveCode = `/**
 * Edu-OS 智能作业批改插件 — 演示 AI + 事件订阅 + 数据库操作
 */
export default {
  manifest: {
    id: "ext-grading-assistant",
    name: "智能随堂作业辅助批改插件",
    version: "1.0.2",
    capabilitiesProposed: ["assignment:write", "ai:assist"]
  },
  activate: async (ctx) => {
    const { commandBus, actionRegistry, eventBus, ai } = ctx.services;
    // 通过 DI 解析数据库和存储服务
    const db = await ctx.resolve('@openlearn/core:IDatabase');
    const storage = ctx.services.storage;

    // ── 注册 Action ──
    await actionRegistry.register({
      id: 'ext-assignment-auto-diagnose',
      commandType: 'assignment.diagnose',
      description: '针对学生作业提交进行 AI 自动诊断打分并生成评语',
      capabilityRequired: 'assignment:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING', description: '作业 ID' },
          studentId:    { type: 'STRING', description: '学生 ID' },
          scoreRatio:   { type: 'NUMBER', description: '算法评定分数（0-100）' }
        },
        required: ['assignmentId', 'studentId', 'scoreRatio']
      }
    });

    // ── 注册命令处理器 ──
    await commandBus.registerHandler('assignment.diagnose', {
      execute: async (command) => {
        const { assignmentId, studentId, scoreRatio } = command.payload;

        // 1. 使用 AI 服务生成评语
        const aiFeedback = await ai.generateText(
          \`学生得分 \${scoreRatio}/100，请用中文写一句鼓励性评语（20字以内）\`,
          { temperature: 0.7 }
        );

        // 2. 调用内核 grading 命令
        await commandBus.execute(
          commandBus.createCommand('assignment.grade_submission', {
            assignmentId, studentId,
            grade: scoreRatio >= 90 ? 'A+' : scoreRatio >= 75 ? 'B' : 'C',
            feedback: aiFeedback || '继续加油！',
            status: 'graded'
          }, command.actorId)
        );

        // 3. 持久化诊断记录
        await storage.set(\`diagnosis:\${assignmentId}:\${studentId}\`, {
          scoreRatio, aiFeedback, timestamp: Date.now()
        });

        return { success: true, feedback: aiFeedback };
      }
    });

    // ── 订阅事件：自动监听新提交 ──
    await eventBus.subscribe('courseware.attempt_submitted', async (event) => {
      console.log('[Grading] New submission:', event.payload);
      // 可在此自动触发 AI 批改...
    });
  }
};`;

  const pluginExamCode = `/**
 * Edu-OS 智能考试系统插件 — 演示自建表 + ctx.db + 完整 CRUD
 */
export default {
  manifest: {
    id: "ext-exam-system",
    name: "智能考试与自测系统插件",
    version: "1.0.1",
    capabilitiesProposed: ["exam:write", "exam:read", "whiteboard:write"]
  },

  activate: async (ctx) => {
    const { commandBus, actionRegistry } = ctx.services;
    const db = ctx.db;  // 插件自建表 API（命名空间隔离）

    // ── 初始化插件专用表（幂等）──
    await db.ensureTable('exams', \`
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      duration_minutes INTEGER DEFAULT 45,
      created_at INTEGER
    \`);
    await db.ensureTable('submissions', \`
      exam_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      answers TEXT,
      score REAL,
      graded_at INTEGER,
      PRIMARY KEY (exam_id, student_id)
    \`);

    // ── 注册 Action：创建考试 ──
    await actionRegistry.register({
      id: 'ext-exam-create',
      commandType: 'exam.create',
      description: '为指定课时创建一份限时考试试卷',
      capabilityRequired: 'exam:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId:        { type: 'STRING',  description: '关联课时 ID' },
          title:           { type: 'STRING',  description: '试卷标题' },
          questions:       { type: 'ARRAY',   description: '题目列表（JSON 数组）' },
          durationMinutes: { type: 'INTEGER', description: '考试限时（分钟，默认 45）' }
        },
        required: ['lessonId', 'title', 'questions']
      }
    });

    // ── 注册处理器：exam.create ──
    await commandBus.registerHandler('exam.create', {
      execute: async (command) => {
        const { lessonId, title, questions, durationMinutes } = command.payload;
        const examId = 'ex_' + Math.random().toString(36).slice(2, 10);
        // 使用带前缀的表名写入
        const stmt = (await ctx.resolve('@openlearn/core:IDatabase'))
          .prepare(\`INSERT INTO \${db.table('exams')} (id, lesson_id, title, content, duration_minutes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)\`);
        stmt.run(examId, lessonId, title, JSON.stringify(questions), durationMinutes || 45, Date.now());
        return { success: true, examId };
      }
    });

    // ── 注册处理器：exam.publish（发布到白板）──
    await commandBus.registerHandler('exam.publish', {
      execute: async (command) => {
        const { lessonId } = command.payload;
        const coreDb = await ctx.resolve('@openlearn/core:IDatabase');
        const exam = coreDb.prepare(
          \`SELECT * FROM \${db.table('exams')} WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1\`
        ).get(lessonId) as any;
        if (!exam) throw new Error('该课时下无试卷，请先 exam.create');

        await commandBus.execute(commandBus.createCommand('whiteboard.draw', {
          lessonId, type: 'html-applet',
          data: JSON.stringify({ examId: exam.id, title: exam.title, questions: JSON.parse(exam.content), durationMinutes: exam.duration_minutes })
        }, command.actorId));

        return { success: true, examId: exam.id };
      }
    });
  },

  deactivate: async () => {
    console.log('[Exam System] Deactivated — tables preserved for data safety');
  }
};`;

  return (
    <div className="flex-1 flex flex-col h-full bg-white text-gray-900 border border-gray-200 rounded-2xl shadow-sm overflow-hidden m-1">
      {/* 灵活响应式的双通道渐变背景页头 */}
      <div className="px-6 py-5 bg-gradient-to-r from-indigo-50 via-purple-50 to-indigo-50/20 shrink-0 border-b border-gray-150 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <HelpCircle className="text-indigo-600" size={24} />
            教育实验操作系统：内核帮助与开发中心 (Edu-OS Reference Hub)
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            本页动态显示当前 Edu-OS 内核的可用动作指令，并向开发者提供完整的第三方插件开发指南与交互式代码范例。
          </p>
        </div>
        
        {/* 子标签页选项卡 */}
        <div className="flex bg-neutral-100 p-0.5 rounded-xl border border-neutral-200 self-start md:self-center shrink-0 shadow-inner">
          <button
            onClick={() => setActiveTab('commands')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 ${
              activeTab === 'commands'
                ? 'bg-white text-indigo-700 shadow-sm font-bold border border-neutral-200/50'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Terminal size={12} />
            <span>指令总线调试 (Command Debugger)</span>
          </button>
          <button
            onClick={() => setActiveTab('sdk_guide')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 ${
              activeTab === 'sdk_guide'
                ? 'bg-white text-indigo-700 shadow-sm font-bold border border-neutral-200/50'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Puzzle size={12} />
            <span>插件开发指南 (Plugin SDK Guide)</span>
          </button>
          <button
            onClick={() => setActiveTab('user_guide')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center gap-1.5 ${
              activeTab === 'user_guide'
                ? 'bg-white text-indigo-700 shadow-sm font-bold border border-neutral-200/50'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <BookOpen size={12} />
            <span>系统使用教程 (User Guide)</span>
          </button>
        </div>
      </div>

      {activeTab === 'commands' ? (
        <>
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-4 shrink-0 col-span-1">
            <div className="relative">
              <Terminal className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input 
                type="text"
                placeholder="通过命令类型、描述或 Action ID 搜索活跃指令..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {categories.map(cat => {
                const CatIcon = cat.icon;
                const isActive = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id as any)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      isActive 
                        ? 'bg-indigo-600 text-white shadow shadow-indigo-200 scale-102 font-bold' 
                        : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <CatIcon size={13} />
                    <span>{cat.name}</span>
                    {cat.id === 'all' ? (
                      <span className={`ml-1 text-[10px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-indigo-700/80 text-white' : 'bg-gray-100 text-gray-500'}`}>{registeredCommands.length}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
            {filteredCommands.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-gray-400">
                <ShieldAlert size={48} className="text-gray-300 mb-4 animate-pulse" />
                <h3 className="font-semibold text-gray-700">没有找到匹配的指令</h3>
                <p className="text-xs text-gray-500 mt-1">请尝试清空查询条件或检查当前的插件状态</p>
              </div>
            ) : (
              <div className="space-y-4 max-w-5xl mx-auto">
                {filteredCommands.map(cmd => {
                  const isExpanded = expandedCommandId === cmd.id;
                  const cat = getCommandCategory(cmd.commandType);
                  const isHighRisk = cmd.isHighRisk;

                  if (commandPayloads[cmd.id] === undefined) {
                    commandPayloads[cmd.id] = generateInitialPayload(cmd.inputSchema);
                  }

                  const execResult = executionResults[cmd.id];

                  return (
                    <div 
                      key={cmd.id}
                      className={`bg-white rounded-xl border transition-all duration-200 overflow-hidden shadow-sm hover:shadow ${
                        isExpanded ? 'border-indigo-400 ring-1 ring-indigo-100' : isHighRisk ? 'border-orange-200 hover:border-orange-300' : 'border-gray-200 hover:border-indigo-200'
                      }`}
                    >
                      <div 
                        onClick={() => {
                          setExpandedCommandId(isExpanded ? null : cmd.id);
                        }}
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50/30 transition-colors select-none"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg shrink-0 ${
                            isHighRisk ? 'bg-orange-50 text-orange-600' : 'bg-indigo-50 text-indigo-600'
                          }`}>
                            {cat === 'vfs' ? <Folder size={18} /> : 
                             cat === 'edu' ? <BookOpen size={18} /> :
                             cat === 'mgmt' ? <Users size={18} /> :
                             cat === 'proc' ? <Terminal size={18} /> :
                             cat === 'ai' ? <Wand2 size={18} /> : <Puzzle size={18} />}
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-bold text-sm bg-gray-100 text-gray-800 px-2 py-0.5 rounded border border-gray-200">
                                {cmd.commandType}
                              </span>
                              {isHighRisk && (
                                <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded font-extrabold px-1.5 py-0.5 uppercase tracking-wide flex items-center gap-0.5">
                                  ⚠️ 高风险操作
                                </span>
                              )}
                              <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 py-0.5">
                                🔒 {cmd.capabilityRequired || '无公开权限'}
                              </span>
                            </div>
                            <p className="text-gray-600 text-xs mt-1.5 font-medium line-clamp-1">{cmd.description}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 self-end sm:self-auto">
                          <span className="text-[10px] text-gray-400 font-mono hidden md:inline">ID: {cmd.id}</span>
                          <button 
                            className={`text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded-lg font-semibold border hover:bg-gray-200 transition-all flex items-center gap-1 ${
                              isExpanded ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : ''
                            }`}
                          >
                            {isExpanded ? '折叠面板' : '交互调试 Shell'}
                            <ChevronRight size={12} className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-gray-100 bg-gray-50/50 p-5 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white rounded-lg border border-gray-200 p-4">
                              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-gray-100 pb-2">
                                <Activity size={12} className="text-gray-400" />
                                入参规范 (JSON Schema Definition)
                              </h4>
                              
                              {cmd.inputSchema?.properties ? (
                                <div className="space-y-3 font-mono text-[11px]">
                                  {Object.keys(cmd.inputSchema.properties).map(propName => {
                                    const prop = cmd.inputSchema.properties[propName];
                                    const isRequired = cmd.inputSchema.required?.includes(propName);
                                    return (
                                      <div key={propName} className="flex flex-col gap-1 border-b border-gray-50 last:border-b-0 pb-1.5">
                                        <div className="flex items-baseline gap-1.5">
                                          <span className="text-indigo-600 font-semibold">{propName}</span>
                                          <span className="text-gray-400 text-[10px]">({prop.type})</span>
                                          {isRequired && (
                                            <span className="text-red-500 text-[9px] font-bold bg-red-50 border border-red-100 rounded px-1">REQUIRED</span>
                                          )}
                                        </div>
                                        {prop.description && (
                                          <span className="text-gray-500 font-sans leading-relaxed text-xs">{prop.description}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 italic">该命令不需要接收任何入参负载 (Payload)。</p>
                              )}
                            </div>

                            <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col">
                              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-gray-100 pb-2 justify-between">
                                <span className="flex items-center gap-1.5">
                                  <Terminal size={12} className="text-gray-400" />
                                  Payload 调试区
                                </span>
                                <button 
                                  onClick={() => {
                                    setCommandPayloads(prev => ({
                                      ...prev,
                                      [cmd.id]: generateInitialPayload(cmd.inputSchema)
                                    }));
                                  }}
                                  className="text-[9px] text-indigo-600 hover:underline hover:text-indigo-800 uppercase tracking-wider"
                                >
                                  恢复默认模版
                                </button>
                              </h4>

                              <label className="text-[10px] font-semibold text-gray-400 block mb-1">Payload JSON:</label>
                              <textarea
                                value={commandPayloads[cmd.id] || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setCommandPayloads(prev => ({ ...prev, [cmd.id]: val }));
                                }}
                                rows={6}
                                className="w-full font-mono text-[11px] p-2.5 bg-gray-900 text-indigo-300 border border-gray-800 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none leading-relaxed flex-1 shadow-inner"
                              />

                              <div className="mt-3 flex justify-end">
                                <button
                                  onClick={() => handleExecute(cmd.commandType, cmd.id)}
                                  disabled={execResult?.loading}
                                  className={`px-4 py-2 text-xs font-bold font-sans text-white hover:shadow-md active:scale-95 transition-all flex items-center gap-1.5 rounded-lg ${
                                    isHighRisk 
                                      ? 'bg-red-600 hover:bg-red-700' 
                                      : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500'
                                  } disabled:opacity-50`}
                                >
                                  {execResult?.loading ? (
                                    <>
                                      <Loader2 size={13} className="animate-spin" />
                                      <span>内核正在调度总线...</span>
                                    </>
                                  ) : (
                                    <>
                                      <PlayCircle size={13} />
                                      <span>提交执行指令 (Deploy Command)</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {execResult && (
                            <div className={`p-4 rounded-xl border flex flex-col font-mono text-[11px] leading-relaxed relative ${
                              execResult.loading 
                                ? 'bg-gray-50 border-gray-200' 
                                : execResult.success 
                                  ? 'bg-green-50/50 border-green-200 text-green-900' 
                                  : 'bg-red-50/50 border-red-200 text-red-900'
                            }`}>
                              <div className="absolute top-2 right-3 uppercase text-[10px] font-bold text-gray-400">
                                Console Output log
                              </div>
                              
                              <div className="font-bold flex items-center gap-1.5 mb-1 bg-transparent border-0 p-0 text-xs text-neutral-800">
                                {execResult.loading ? (
                                  <span className="text-gray-500">⏳ COMMAND QUEUED...</span>
                                ) : execResult.success ? (
                                  <span className="text-green-700 flex items-center gap-1"><CheckCircle2 size={14} /> STATUS: 200 SUCCESS (Action Completed)</span>
                                ) : (
                                  <span className="text-red-700 flex items-center gap-1"><X size={14} /> STATUS: 500 INTERNAL_BUS_ERROR</span>
                                )}
                              </div>

                              {!execResult.loading && (
                                <pre className="mt-2 p-3 bg-gray-900/95 text-gray-200 rounded-lg overflow-x-auto border border-gray-800 shadow-inner max-h-56 select-all font-mono">
                                  {execResult.success 
                                    ? JSON.stringify(execResult.data, null, 2)
                                    : execResult.error
                                  }
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : activeTab === 'sdk_guide' ? (
        /* 插件开发指南与 API 参考 (Plugin SDK Guide & API Reference) */
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          <div className="max-w-5xl mx-auto space-y-6">

            {/* 顶部总揽 */}
            <div className="bg-white rounded-2xl border border-indigo-100 p-6 shadow-sm flex flex-col md:flex-row gap-5 items-start">
              <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl shrink-0">
                <Puzzle size={28} />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-gray-900">Edu-OS 插件开发指南 & API 参考</h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Edu-OS 基于 <span className="font-semibold text-indigo-600">CommandBus（命令总线）</span> + <span className="font-semibold text-indigo-600">EventBus（事件总线）</span> 微内核架构。
                  插件通过标准 ESM 模块导出 <code className="bg-gray-100 text-rose-600 px-1 rounded text-[10px]">activate(ctx)</code> 函数接收 <span className="font-semibold">PluginContext</span>，
                  进而访问 7 大内核服务。本页提供完整的 API 参考、参数说明和可运行示例。
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">🔄 DI 依赖注入</span>
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-medium">🔒 能力安全模型</span>
                  <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full font-medium">⚡ 热重载 + Worker 隔离</span>
                  <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-100 px-2 py-0.5 rounded-full font-medium">📦 ESM + CommonJS 双格式</span>
                </div>
              </div>
            </div>

            {/* ═══════════ Manifest 字段参考 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <FileText size={14} className="text-indigo-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">Manifest 字段参考（manifest.json / 内联导出）</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-left">
                      <th className="px-4 py-2 font-semibold text-gray-600 w-32">字段</th>
                      <th className="px-4 py-2 font-semibold text-gray-600 w-16">类型</th>
                      <th className="px-4 py-2 font-semibold text-gray-600 w-16">必需</th>
                      <th className="px-4 py-2 font-semibold text-gray-600">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">id</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-red-50 text-red-600 border border-red-100 rounded px-1.5 text-[10px] font-bold">必需</span></td>
                      <td className="px-4 py-2 text-gray-600">全局唯一插件标识。约定格式：<code className="bg-gray-100 px-1 rounded text-[10px]">ext-&lt;name&gt;</code>，如 ext-hello-world</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">name</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-red-50 text-red-600 border border-red-100 rounded px-1.5 text-[10px] font-bold">必需</span></td>
                      <td className="px-4 py-2 text-gray-600">插件的人类可读名称，显示在 UI 插件列表中</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">version</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-red-50 text-red-600 border border-red-100 rounded px-1.5 text-[10px] font-bold">必需</span></td>
                      <td className="px-4 py-2 text-gray-600">语义化版本号，如 <code className="bg-gray-100 px-1 rounded text-[10px]">1.0.0</code>。用于依赖版本检查</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">main</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-amber-50 text-amber-600 border border-amber-100 rounded px-1.5 text-[10px] font-bold">ZIP 必需</span></td>
                      <td className="px-4 py-2 text-gray-600">ZIP 包入口文件名，如 <code className="bg-gray-100 px-1 rounded text-[10px]">index.js</code>。内联安装无需此字段</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">description</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-gray-100 text-gray-500 border border-gray-200 rounded px-1.5 text-[10px]">可选</span></td>
                      <td className="px-4 py-2 text-gray-600">插件功能简述，显示在插件中心</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">author</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-gray-100 text-gray-500 border border-gray-200 rounded px-1.5 text-[10px]">可选</span></td>
                      <td className="px-4 py-2 text-gray-600">插件作者信息</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">capabilitiesProposed</td>
                      <td className="px-4 py-2 text-gray-500">string[]</td>
                      <td className="px-4 py-2"><span className="bg-gray-100 text-gray-500 border border-gray-200 rounded px-1.5 text-[10px]">可选</span></td>
                      <td className="px-4 py-2 text-gray-600">插件申请的权限列表。如 <code className="bg-gray-100 px-1 rounded text-[10px]">whiteboard:write</code>、<code className="bg-gray-100 px-1 rounded text-[10px]">lesson:read</code></td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">requires</td>
                      <td className="px-4 py-2 text-gray-500">string[]</td>
                      <td className="px-4 py-2"><span className="bg-gray-100 text-gray-500 border border-gray-200 rounded px-1.5 text-[10px]">可选</span></td>
                      <td className="px-4 py-2 text-gray-600">强依赖服务 Token 列表。格式：<code className="bg-gray-100 px-1 rounded text-[10px]">@openlearn/core:IServiceName@^1.0.0</code>。版本不匹配 → 激活失败</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">optional</td>
                      <td className="px-4 py-2 text-gray-500">string[]</td>
                      <td className="px-4 py-2"><span className="bg-gray-100 text-gray-500 border border-gray-200 rounded px-1.5 text-[10px]">可选</span></td>
                      <td className="px-4 py-2 text-gray-600">可选依赖服务列表。格式同 requires，版本不匹配仅警告，不影响激活</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">classroomTools</td>
                      <td className="px-4 py-2 text-gray-500">object[]</td>
                      <td className="px-4 py-2"><span className="bg-gray-100 text-gray-500 border border-gray-200 rounded px-1.5 text-[10px]">可选</span></td>
                      <td className="px-4 py-2 text-gray-600">课堂工具栏注册。每项包含 <code className="bg-gray-100 px-1 rounded text-[10px]">id, name, icon, commandType, payload</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ═══════════ PluginContext API 参考 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Terminal size={14} className="text-emerald-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">PluginContext — activate(ctx) 上下文对象</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-left">
                      <th className="px-4 py-2 font-semibold text-gray-600 w-32">属性/方法</th>
                      <th className="px-4 py-2 font-semibold text-gray-600">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">ctx.pluginId</td>
                      <td className="px-4 py-2 text-gray-600"><span className="text-gray-400">string</span> — 当前插件 ID（manifest.id）</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">ctx.manifest</td>
                      <td className="px-4 py-2 text-gray-600"><span className="text-gray-400">Manifest</span> — 插件的完整 manifest 对象（含 id, name, version, requires 等）</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold whitespace-nowrap">ctx.services</td>
                      <td className="px-4 py-2 text-gray-600"><span className="text-gray-400">object</span> — 包含 7 个内核服务接口的代理对象（见下方服务参考），所有资源自动追踪，停用自动清理</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold whitespace-nowrap">ctx.resolve(token)</td>
                      <td className="px-4 py-2 text-gray-600"><span className="text-gray-400">{'<T>'}</span> — DI 容器解析。参数为 Token 实例或字符串标识符，返回注册的服务实例（如数据库连接、PluginHost）</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold whitespace-nowrap">ctx.require(name)</td>
                      <td className="px-4 py-2 text-gray-600"><span className="text-gray-400">{'<any>'}</span> — 引用主应用共享模块。白名单：recharts, react-markdown, jspdf, jspdf-autotable, lucide-react, uuid, xlsx</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-indigo-600 font-semibold">ctx.db</td>
                      <td className="px-4 py-2 text-gray-600"><span className="text-gray-400">PluginDatabaseAPI</span> — 插件自建表 API（命名空间隔离），包含 ensureTable(), table(), dropAllTables()</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ═══════════ ctx.services 7 大服务 API ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Database size={14} className="text-amber-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">ctx.services — 7 大内核服务完整 API</h4>
              </div>
              <div className="p-4 space-y-5 text-xs">

                {/* CommandBus */}
                <div className="border border-indigo-100 rounded-xl p-4 bg-indigo-50/20">
                  <h5 className="font-bold text-indigo-700 mb-2 flex items-center gap-1.5">
                    <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-mono">services.commandBus</span>
                    ICommandBusService — 命令总线
                  </h5>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex gap-2"><span className="font-mono text-indigo-600 shrink-0 w-48">execute(command)</span><span className="text-gray-500">执行命令，走完整拦截器管道（权限检查→高危审批→handler）</span></div>
                    <div className="flex gap-2"><span className="font-mono text-indigo-600 shrink-0 w-48">registerHandler(type, {'{execute}'})</span><span className="text-gray-500">注册命令处理器。返回 Promise&lt;void&gt;，资源自动追踪</span></div>
                    <div className="flex gap-2"><span className="font-mono text-indigo-600 shrink-0 w-48">unregisterHandler(type)</span><span className="text-gray-500">取消注册命令处理器</span></div>
                    <div className="flex gap-2"><span className="font-mono text-indigo-600 shrink-0 w-48">createCommand(type, payload, actorId, metadata?)</span><span className="text-gray-500">创建标准 PlatformCommand 信封，自动生成 id + timestamp</span></div>
                  </div>
                </div>

                {/* EventBus */}
                <div className="border border-emerald-100 rounded-xl p-4 bg-emerald-50/20">
                  <h5 className="font-bold text-emerald-700 mb-2 flex items-center gap-1.5">
                    <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-mono">services.eventBus</span>
                    IEventBusService — 事件总线
                  </h5>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex gap-2"><span className="font-mono text-emerald-600 shrink-0 w-48">publish(event)</span><span className="text-gray-500">发布事件。event 含 id, type, source, payload, timestamp。source 自动加 plugin: 前缀</span></div>
                    <div className="flex gap-2"><span className="font-mono text-emerald-600 shrink-0 w-48">subscribe(eventType, fn)</span><span className="text-gray-500">订阅事件，支持通配符 *。资源自动追踪，停用自动取消</span></div>
                    <div className="flex gap-2"><span className="font-mono text-emerald-600 shrink-0 w-48">unsubscribe(eventType, fn)</span><span className="text-gray-500">取消订阅</span></div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-emerald-100">
                    <span className="text-[10px] font-semibold text-gray-500">常用系统事件:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {['lesson.created','lesson.updated','lesson.deleted','whiteboard.element_drawn','whiteboard.element_updated','whiteboard.cleared','courseware.attempt_submitted','assignment.graded','student.registered','approval.requested','process.spawned','process.killed'].map(ev => (
                        <code key={ev} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[9.5px] font-mono">{ev}</code>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ActionRegistry */}
                <div className="border border-purple-100 rounded-xl p-4 bg-purple-50/20">
                  <h5 className="font-bold text-purple-700 mb-2 flex items-center gap-1.5">
                    <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-mono">services.actionRegistry</span>
                    IActionRegistryService — AI 工具注册表
                  </h5>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex gap-2"><span className="font-mono text-purple-600 shrink-0 w-48">register(descriptor)</span><span className="text-gray-500">注册 AI Agent 可发现的工具。descriptor: {'{id, commandType, description, inputSchema, capabilityRequired, isHighRisk?}'}</span></div>
                    <div className="flex gap-2"><span className="font-mono text-purple-600 shrink-0 w-48">unregister(id)</span><span className="text-gray-500">取消注册 Action</span></div>
                    <div className="flex gap-2"><span className="font-mono text-purple-600 shrink-0 w-48">getAllActions()</span><span className="text-gray-500">返回所有已注册 ActionDescriptor[]</span></div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-purple-100">
                    <span className="text-[10px] font-semibold text-gray-500">inputSchema 类型映射（JSON Schema → 前端表单）:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {['STRING→文本框','INTEGER→数字输入','NUMBER→数字输入','BOOLEAN→开关','ARRAY→数组编辑器','OBJECT→嵌套对象'].map(s => (
                        <code key={s} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[9.5px] font-mono">{s}</code>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Capability */}
                <div className="border border-orange-100 rounded-xl p-4 bg-orange-50/20">
                  <h5 className="font-bold text-orange-700 mb-2 flex items-center gap-1.5">
                    <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded text-[10px] font-mono">services.capability</span>
                    ICapabilityService — 权限守卫
                  </h5>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex gap-2"><span className="font-mono text-orange-600 shrink-0 w-48">grant(actorId, cap)</span><span className="text-gray-500">授予权限，如 grant('user-123', 'lesson:read')</span></div>
                    <div className="flex gap-2"><span className="font-mono text-orange-600 shrink-0 w-48">revokeAll(actorId)</span><span className="text-gray-500">撤销某角色的全部权限</span></div>
                    <div className="flex gap-2"><span className="font-mono text-orange-600 shrink-0 w-48">check(actorId, cap)</span><span className="text-gray-500">检查权限，返回 boolean。支持通配符 lesson:*</span></div>
                  </div>
                </div>

                {/* Process */}
                <div className="border border-cyan-100 rounded-xl p-4 bg-cyan-50/20">
                  <h5 className="font-bold text-cyan-700 mb-2 flex items-center gap-1.5">
                    <span className="bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded text-[10px] font-mono">services.processManager</span>
                    IProcessService — 后台进程管理
                  </h5>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex gap-2"><span className="font-mono text-cyan-600 shrink-0 w-48">spawn(name, taskType, payload)</span><span className="text-gray-500">启动后台进程，返回 processId</span></div>
                    <div className="flex gap-2"><span className="font-mono text-cyan-600 shrink-0 w-48">kill(processId)</span><span className="text-gray-500">终止进程</span></div>
                    <div className="flex gap-2"><span className="font-mono text-cyan-600 shrink-0 w-48">registerHandler(taskType, handler)</span><span className="text-gray-500">注册进程任务处理器。handler 签名: (id, payload, state, log, updateState) =&gt; void</span></div>
                    <div className="flex gap-2"><span className="font-mono text-cyan-600 shrink-0 w-48">registerInterval(name, ms, tickFn)</span><span className="text-gray-500">注册定时任务，tickFn 接收 log 回调。返回 processId</span></div>
                  </div>
                </div>

                {/* Storage */}
                <div className="border border-rose-100 rounded-xl p-4 bg-rose-50/20">
                  <h5 className="font-bold text-rose-700 mb-2 flex items-center gap-1.5">
                    <span className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded text-[10px] font-mono">services.storage</span>
                    IStorageService — 持久化 KV 存储
                  </h5>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex gap-2"><span className="font-mono text-rose-600 shrink-0 w-48">get(key)</span><span className="text-gray-500">读取键值。自动 JSON.parse。不存在返回 null。命名空间按 pluginId 隔离</span></div>
                    <div className="flex gap-2"><span className="font-mono text-rose-600 shrink-0 w-48">set(key, value)</span><span className="text-gray-500">写入键值。自动 JSON.stringify。底层 SQLite plugin_storage 表</span></div>
                    <div className="flex gap-2"><span className="font-mono text-rose-600 shrink-0 w-48">delete(key)</span><span className="text-gray-500">删除键值。键不存在时不报错</span></div>
                  </div>
                </div>

                {/* AI */}
                <div className="border border-violet-100 rounded-xl p-4 bg-violet-50/20">
                  <h5 className="font-bold text-violet-700 mb-2 flex items-center gap-1.5">
                    <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[10px] font-mono">services.ai</span>
                    IAIService — AI 文本生成
                  </h5>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex gap-2"><span className="font-mono text-violet-600 shrink-0 w-48">generateText(prompt, options?)</span><span className="text-gray-500">调用配置的 AI 提供商生成文本。options: {'{systemInstruction?, temperature?}'}。两层回退：第三方API → Gemini SDK</span></div>
                  </div>
                </div>

              </div>
            </div>

            {/* ═══════════ ActionDescriptor 类型参考 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Search size={14} className="text-purple-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">ActionDescriptor — 完整字段参考</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-left">
                      <th className="px-4 py-2 font-semibold text-gray-600 w-36">字段</th>
                      <th className="px-4 py-2 font-semibold text-gray-600 w-20">类型</th>
                      <th className="px-4 py-2 font-semibold text-gray-600 w-16">必需</th>
                      <th className="px-4 py-2 font-semibold text-gray-600">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-purple-600 font-semibold">id</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-red-50 text-red-600 border border-red-100 rounded px-1.5 text-[10px] font-bold">必需</span></td>
                      <td className="px-4 py-2 text-gray-600">全局唯一 Action ID。约定前缀 <code className="bg-gray-100 px-1 rounded text-[10px]">ext-&lt;plugin&gt;-</code>，如 <code className="bg-gray-100 px-1 rounded text-[10px]">ext-quiz-create</code></td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-purple-600 font-semibold">commandType</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-red-50 text-red-600 border border-red-100 rounded px-1.5 text-[10px] font-bold">必需</span></td>
                      <td className="px-4 py-2 text-gray-600">命令类型标识符，命名空间格式。如 <code className="bg-gray-100 px-1 rounded text-[10px]">quiz.create</code>、<code className="bg-gray-100 px-1 rounded text-[10px]">exam.publish</code></td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-purple-600 font-semibold">description</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-red-50 text-red-600 border border-red-100 rounded px-1.5 text-[10px] font-bold">必需</span></td>
                      <td className="px-4 py-2 text-gray-600">AI Agent 可见的功能描述。用自然语言说明何时使用。如 <code className="bg-gray-100 px-1 rounded text-[10px]">为指定课时创建限时考试试卷</code></td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-purple-600 font-semibold">inputSchema</td>
                      <td className="px-4 py-2 text-gray-500">object</td>
                      <td className="px-4 py-2"><span className="bg-red-50 text-red-600 border border-red-100 rounded px-1.5 text-[10px] font-bold">必需</span></td>
                      <td className="px-4 py-2 text-gray-600">JSON Schema 参数定义（见下方详细说明）。顶层 type 必须为 <code className="bg-gray-100 px-1 rounded text-[10px]">OBJECT</code></td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-purple-600 font-semibold">capabilityRequired</td>
                      <td className="px-4 py-2 text-gray-500">string</td>
                      <td className="px-4 py-2"><span className="bg-red-50 text-red-600 border border-red-100 rounded px-1.5 text-[10px] font-bold">必需</span></td>
                      <td className="px-4 py-2 text-gray-600">执行此 Action 所需的能力字符串。如 <code className="bg-gray-100 px-1 rounded text-[10px]">whiteboard:write</code>。传空字符串表示无权限要求</td>
                    </tr>
                    <tr className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-purple-600 font-semibold">isHighRisk</td>
                      <td className="px-4 py-2 text-gray-500">boolean</td>
                      <td className="px-4 py-2"><span className="bg-gray-100 text-gray-500 border border-gray-200 rounded px-1.5 text-[10px]">可选</span></td>
                      <td className="px-4 py-2 text-gray-600">标记为高风险操作。AI Agent 调用时将进入审批队列，需教师人工确认。默认 false</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* inputSchema 详细说明 */}
              <div className="p-4 border-t border-gray-100 space-y-3 text-xs">
                <h5 className="font-bold text-gray-700">inputSchema JSON Schema 类型详解</h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  {[
                    {type:'STRING', desc:'字符串。用于文本、ID、URL 等', example:'"title": { "type": "STRING", "description": "课程标题" }'},
                    {type:'INTEGER', desc:'整数。用于计数、索引、分钟数', example:'"count": { "type": "INTEGER", "description": "题目数量" }'},
                    {type:'NUMBER', desc:'浮点数。用于分数、百分比、坐标', example:'"score": { "type": "NUMBER", "description": "得分 (0-100)" }'},
                    {type:'BOOLEAN', desc:'布尔值。用于开关、是否标记', example:'"isPublished": { "type": "BOOLEAN", "description": "是否发布" }'},
                    {type:'ARRAY', desc:'数组。需配合 items 指定元素类型', example:'"tags": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "标签列表" }'},
                    {type:'OBJECT', desc:'嵌套对象。用于复杂结构', example:'"filter": { "type": "OBJECT", "properties": {...}, "description": "过滤条件" }'},
                  ].map(item => (
                    <div key={item.type} className="bg-gray-50 rounded-lg p-3 border border-gray-100 space-y-1">
                      <div className="flex items-center gap-2">
                        <code className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{item.type}</code>
                        <span className="font-semibold text-gray-700">{item.desc}</span>
                      </div>
                      <pre className="text-[9.5px] font-mono text-gray-500 bg-white p-1.5 rounded border border-gray-100 overflow-x-auto">{item.example}</pre>
                    </div>
                  ))}
                </div>
                <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100 text-[11px] text-indigo-800">
                  <span className="font-bold">required 数组：</span>列出必须提供的参数名。前端根据此数组在字段旁显示 REQUIRED 标记，AI Agent 也会被引导填充这些字段。
                </div>
              </div>
            </div>

            {/* ═══════════ PlatformCommand & PlatformEvent 信封 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Database size={14} className="text-slate-600" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">核心数据结构：PlatformCommand & PlatformEvent</h4>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* PlatformCommand */}
                <div className="border border-indigo-100 rounded-xl p-4 bg-indigo-50/10 space-y-2">
                  <h5 className="font-bold text-indigo-700">PlatformCommand&lt;T&gt;</h5>
                  <p className="text-[11px] text-gray-500">命令总线中传递的标准命令信封，由 <code className="bg-gray-100 px-1 rounded text-[10px]">createCommand()</code> 或手动构造。</p>
                  <table className="w-full text-[10px]">
                    <thead><tr className="text-left text-gray-400"><th className="py-1 pr-2">字段</th><th className="py-1 pr-2">类型</th><th className="py-1">说明</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {[
                        ['id','string','唯一命令 ID（uuid v7）'],
                        ['type','string','命令类型，如 "lesson.create"'],
                        ['actorId','string','执行者标识，如 "plugin:ext-quiz"'],
                        ['payload','T','命令负载数据，类型由 handler 定义'],
                        ['timestamp','number','Unix 毫秒时间戳'],
                        ['metadata?','object','可选元数据：correlationId, agentDelegated, undoable'],
                      ].map(([f,t,d]) => (
                        <tr key={f}><td className="py-1 pr-2 font-mono text-indigo-600">{f}</td><td className="py-1 pr-2 text-gray-500">{t}</td><td className="py-1 text-gray-600">{d}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* PlatformEvent */}
                <div className="border border-emerald-100 rounded-xl p-4 bg-emerald-50/10 space-y-2">
                  <h5 className="font-bold text-emerald-700">PlatformEvent</h5>
                  <p className="text-[11px] text-gray-500">事件总线中传递的标准事件信封，由 <code className="bg-gray-100 px-1 rounded text-[10px]">eventBus.publish()</code> 发布。</p>
                  <table className="w-full text-[10px]">
                    <thead><tr className="text-left text-gray-400"><th className="py-1 pr-2">字段</th><th className="py-1 pr-2">类型</th><th className="py-1">说明</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {[
                        ['id','string','唯一事件 ID（uuid v7）'],
                        ['type','string','事件类型（过去式），如 "lesson.created"'],
                        ['source','string','事件来源。插件自动加 "plugin:" 前缀'],
                        ['payload','any','事件负载数据'],
                        ['timestamp','number','Unix 毫秒时间戳'],
                        ['correlationId?','string','关联的命令 ID，用于追踪命令→事件链'],
                      ].map(([f,t,d]) => (
                        <tr key={f}><td className="py-1 pr-2 font-mono text-emerald-600">{f}</td><td className="py-1 pr-2 text-gray-500">{t}</td><td className="py-1 text-gray-600">{d}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ═══════════ ctx.db PluginDatabaseAPI + ctx.require ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Database size={14} className="text-teal-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">ctx.db — 插件自建表 API & ctx.require — 共享模块</h4>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* ctx.db */}
                <div className="border border-teal-100 rounded-xl p-4 bg-teal-50/10 space-y-2">
                  <h5 className="font-bold text-teal-700">PluginDatabaseAPI</h5>
                  <p className="text-[11px] text-gray-500">命名空间隔离的 SQLite 操作。表名自动加 <code className="bg-gray-100 px-1 rounded text-[10px]">plugin_{'{pluginId}'}_</code> 前缀。</p>
                  <div className="space-y-2 text-[11px]">
                    <div>
                      <code className="font-mono text-teal-600 font-semibold">ensureTable(name, schema)</code>
                      <p className="text-gray-500 mt-0.5">幂等建表。schema 为 SQL 列定义字符串。</p>
                      <pre className="text-[9.5px] bg-gray-900 text-green-400 p-1.5 rounded mt-1 overflow-x-auto">{`await ctx.db.ensureTable('scores',
  'id TEXT PRIMARY KEY, student_id TEXT, score REAL')`}</pre>
                    </div>
                    <div>
                      <code className="font-mono text-teal-600 font-semibold">table(name)</code>
                      <p className="text-gray-500 mt-0.5">返回带前缀的完整表名，用于手写 SQL。</p>
                      <pre className="text-[9.5px] bg-gray-900 text-green-400 p-1.5 rounded mt-1 overflow-x-auto">{`const fullName = ctx.db.table('scores');
// => "plugin_ext-quiz_scores"
db.prepare(\`SELECT * FROM \${fullName}\`).all()`}</pre>
                    </div>
                    <div>
                      <code className="font-mono text-teal-600 font-semibold">dropAllTables()</code>
                      <p className="text-gray-500 mt-0.5">删除该插件创建的所有表。卸载时由 PluginHost 自动调用。</p>
                    </div>
                  </div>
                </div>
                {/* ctx.require */}
                <div className="border border-violet-100 rounded-xl p-4 bg-violet-50/10 space-y-2">
                  <h5 className="font-bold text-violet-700">ctx.require(moduleName)</h5>
                  <p className="text-[11px] text-gray-500">引用主应用共享模块。仅白名单中的模块可被加载。</p>
                  <table className="w-full text-[10px]">
                    <thead><tr className="text-left text-gray-400"><th className="py-1 pr-2">模块名</th><th className="py-1">用途</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {[
                        ['uuid','生成唯一 ID（uuid v4/v7）'],
                        ['recharts','图表库（BarChart, LineChart 等）'],
                        ['react-markdown','Markdown 渲染'],
                        ['jspdf','PDF 生成'],
                        ['jspdf-autotable','PDF 表格插件'],
                        ['lucide-react','图标库'],
                        ['xlsx','Excel 读写（可选）'],
                      ].map(([m,d]) => (
                        <tr key={m}><td className="py-1 pr-2 font-mono text-violet-600">{m}</td><td className="py-1 text-gray-600">{d}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bg-amber-50 rounded-lg p-2 border border-amber-100 text-[10px] text-amber-800 mt-2">
                    非白名单模块调用将抛出 Error。前端插件通过 FrontendPluginHost 单独注入 konva/react-konva 等纯 ESM 库。
                  </div>
                </div>
              </div>
            </div>

            {/* ═══════════ DI Token 参考 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Settings size={14} className="text-gray-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">依赖注入 Token 参考（ctx.resolve 可用标识符）</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-left">
                      <th className="px-4 py-2 font-semibold text-gray-600">Token 标识符</th>
                      <th className="px-4 py-2 font-semibold text-gray-600">类型</th>
                      <th className="px-4 py-2 font-semibold text-gray-600">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 font-mono text-[11px]">
                    {[
                      ['@openlearn/core:ICommandBusService','ICommandBusService','命令总线（等同于 services.commandBus）'],
                      ['@openlearn/core:IEventBusService','IEventBusService','事件总线（等同于 services.eventBus）'],
                      ['@openlearn/core:IActionRegistryService','IActionRegistryService','Action 注册表（等同于 services.actionRegistry）'],
                      ['@openlearn/core:ICapabilityService','ICapabilityService','权限守卫（等同于 services.capability）'],
                      ['@openlearn/core:IProcessService','IProcessService','进程管理（等同于 services.processManager）'],
                      ['@openlearn/core:IStorageService','IStorageService','KV 存储（等同于 services.storage）'],
                      ['@openlearn/core:IAIService','IAIService','AI 服务（等同于 services.ai）'],
                      ['@openlearn/core:IDatabase','better-sqlite3 Database','原始 SQLite 数据库连接，支持 prepare/exec/run'],
                      ['@openlearn/core:IPluginHost','PluginHost','插件主机实例，可调用 installPlugin/getPlugin 等'],
                    ].map(([tok, type, desc]) => (
                      <tr key={tok} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2 text-indigo-600">{tok}</td>
                        <td className="px-4 py-2 text-gray-500">{type}</td>
                        <td className="px-4 py-2 text-gray-600">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ═══════════ 示例 1：思维导图插件 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-2">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded"><Code size={16} /></div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">示例 1：思维导图插件 — 注册 Action + 处理器 + 发布事件</h4>
                    <p className="text-[10px] text-gray-500 mt-0.5">演示 ctx.services 解构、Action 注册、createCommand 创建信封、eventBus.publish 发布事件</p>
                  </div>
                </div>
                <button onClick={() => handleCopy('tpl1', pluginBoilerplateCode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${
                    copiedId === 'tpl1' ? 'bg-emerald-50 text-emerald-700 border border-emerald-250' : 'bg-white text-indigo-600 border border-indigo-150 hover:bg-indigo-50'
                  }`}>
                  {copiedId === 'tpl1' ? <Check size={12} /> : <FileText size={12} />}
                  <span>{copiedId === 'tpl1' ? '已复制！' : '复制代码'}</span>
                </button>
              </div>
              <pre className="text-xs font-mono p-5 bg-gray-950 text-gray-200 overflow-x-auto leading-relaxed max-h-[360px] shadow-inner select-all">{pluginBoilerplateCode}</pre>
            </div>

            {/* ═══════════ 示例 2：AI 批改插件 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-2">
                  <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded"><Code size={16} /></div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">示例 2：AI 作业批改插件 — 演示 AI + 事件订阅 + 存储 + DI</h4>
                    <p className="text-[10px] text-gray-500 mt-0.5">演示 ctx.resolve 获取数据库、services.ai 生成文本、services.storage 持久化、eventBus 订阅</p>
                  </div>
                </div>
                <button onClick={() => handleCopy('tpl2', pluginInteractiveCode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${
                    copiedId === 'tpl2' ? 'bg-emerald-50 text-emerald-700 border border-emerald-250' : 'bg-white text-emerald-600 border border-emerald-150 hover:bg-emerald-50'
                  }`}>
                  {copiedId === 'tpl2' ? <Check size={12} /> : <FileText size={12} />}
                  <span>{copiedId === 'tpl2' ? '已复制！' : '复制代码'}</span>
                </button>
              </div>
              <pre className="text-xs font-mono p-5 bg-gray-950 text-gray-200 overflow-x-auto leading-relaxed max-h-[360px] shadow-inner select-all">{pluginInteractiveCode}</pre>
            </div>

            {/* ═══════════ 示例 3：考试系统 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-start gap-2">
                  <div className="p-1.5 bg-amber-50 text-amber-600 rounded"><Code size={16} /></div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-900">示例 3：考试系统插件 — 演示 ctx.db 自建表 + deactivate 清理</h4>
                    <p className="text-[10px] text-gray-500 mt-0.5">演示 ctx.db.ensureTable 建表、ctx.db.table 获取带前缀表名、deactivate 生命周期</p>
                  </div>
                </div>
                <button onClick={() => handleCopy('tpl3', pluginExamCode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 ${
                    copiedId === 'tpl3' ? 'bg-emerald-50 text-emerald-700 border border-emerald-250' : 'bg-white text-amber-600 border border-amber-150 hover:bg-amber-50'
                  }`}>
                  {copiedId === 'tpl3' ? <Check size={12} /> : <FileText size={12} />}
                  <span>{copiedId === 'tpl3' ? '已复制！' : '复制代码'}</span>
                </button>
              </div>
              <pre className="text-xs font-mono p-5 bg-gray-950 text-gray-200 overflow-x-auto leading-relaxed max-h-[360px] shadow-inner select-all">{pluginExamCode}</pre>
            </div>

            {/* ═══════════ 生命周期 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Activity size={14} className="text-blue-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">插件生命周期 & 状态机</h4>
              </div>
              <div className="p-4 text-xs text-gray-600 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold text-gray-500">状态转换:</span>
                  {['INSTALLED','→','ACTIVATING','→','ACTIVE','→','DEACTIVATING','→','INACTIVE'].map((s,i) => (
                    <span key={i} className={i % 2 === 0 ? 'bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded font-mono text-[10px] font-bold' : 'text-gray-400'}>{s}</span>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <span className="font-bold text-gray-700">activate(ctx)</span>
                    <p className="text-gray-500 mt-0.5">插件激活入口。在此注册 handlers、actions、事件订阅。PluginHost 自动追踪所有资源，停用时自动清理。</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <span className="font-bold text-gray-700">deactivate()</span>
                    <p className="text-gray-500 mt-0.5">可选。自定义清理逻辑（关闭连接、保存状态等）。PluginHost 在 deactivate 之后自动 dispose 所有追踪资源。</p>
                  </div>
                </div>
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-100 text-[11px]">
                  <span className="font-bold text-amber-800">⚠️ ERROR 状态</span>
                  <p className="text-amber-700 mt-0.5">激活过程中抛出异常 → 状态变为 ERROR。PluginHost 自动回滚所有已注册资源。可通过重新激活恢复（重试从 INSTALLED 态开始）。</p>
                </div>
              </div>
            </div>

            {/* ═══════════ 能力（Capability）参考 ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Shield size={14} className="text-orange-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">能力（Capability）权限字符串完整列表</h4>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {[
                  {domain:'课程 (Lesson)', items:['lesson:read','lesson:write','lesson:delete']},
                  {domain:'白板 (Whiteboard)', items:['whiteboard:read','whiteboard:write']},
                  {domain:'班级 (Class)', items:['class:read','class:write','class:delete']},
                  {domain:'学生 (Student)', items:['student:read','student:write','student:delete']},
                  {domain:'作业 (Assignment)', items:['assignment:read','assignment:write']},
                  {domain:'排课 (Schedule)', items:['schedule:read','schedule:write']},
                  {domain:'考勤 (Attendance)', items:['attendance:read','attendance:write']},
                  {domain:'考试 (Exam)', items:['exam:read','exam:write']},
                  {domain:'虚拟文件系统 (VFS)', items:['vfs:read','vfs:write']},
                  {domain:'AI 辅助', items:['ai:assist','ai:generate']},
                  {domain:'插件管理', items:['plugin:install','plugin:manage']},
                  {domain:'全局管理', items:['management:read','management:write']},
                ].map(group => (
                  <div key={group.domain} className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">{group.domain}</span>
                    <div className="flex flex-wrap gap-1">
                      {group.items.map(cap => (
                        <code key={cap} className="bg-white text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-mono border border-gray-150">{cap}</code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 pb-4 text-[10px] text-gray-400">
                通配符支持：<code className="bg-gray-100 px-1 rounded">lesson:*</code> 匹配所有 lesson 子权限。admin 角色自动拥有所有权限。
              </div>
            </div>

            {/* ═══════════ 常见模式 / Recipes ═══════════ */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                <Code size={14} className="text-rose-500" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">常见开发模式 / Recipes</h4>
              </div>
              <div className="p-4 space-y-4 text-xs">
                {/* Recipe 1 */}
                <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                  <h5 className="font-bold text-gray-800 mb-2">🔄 调用其他插件/内核的命令（命令编排）</h5>
                  <pre className="text-[10px] font-mono bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto">
{`// 方式 1: 使用 createCommand + execute（推荐）
const cmd = commandBus.createCommand('whiteboard.draw', {
  lessonId: 'lesson-123',
  type: 'text',
  data: JSON.stringify({ text: 'Hello', x: 100, y: 100 })
}, command.actorId);
const result = await commandBus.execute(cmd);

// 方式 2: 手动构造命令信封
const result = await commandBus.execute({
  id: crypto.randomUUID(),
  type: 'whiteboard.draw',
  actorId: \`plugin:\${ctx.manifest.id}\`,
  payload: { lessonId: 'lesson-123', type: 'text', data: '...' },
  timestamp: Date.now()
});`}</pre>
                </div>
                {/* Recipe 2 */}
                <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                  <h5 className="font-bold text-gray-800 mb-2">📡 监听系统事件并响应</h5>
                  <pre className="text-[10px] font-mono bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto">
{`// 订阅课程创建事件，自动触发后续操作
await eventBus.subscribe('lesson.created', async (event) => {
  const { id, title } = event.payload;
  console.log(\`新课程: \${title} (\${id})\`);
  // 例如：自动为该课程创建关联测验
  await commandBus.execute(commandBus.createCommand(
    'quiz.create', { lessonId: id, topic: title }, event.source
  ));
});
// 订阅所有白板操作（通配符暂不支持，需逐个订阅）`}</pre>
                </div>
                {/* Recipe 3 */}
                <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                  <h5 className="font-bold text-gray-800 mb-2">💾 插件持久化数据</h5>
                  <pre className="text-[10px] font-mono bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto">
{`// 简单 KV 存储 — 适合配置、缓存、少量数据
await ctx.services.storage.set('lastRun', Date.now());
await ctx.services.storage.set('config', { theme: 'dark', autoApprove: true });
const config = await ctx.services.storage.get('config'); // 自动 JSON.parse

// 自建表 — 适合大量结构化数据、需要查询的场景
await ctx.db.ensureTable('results', \`
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL,
  score REAL, feedback TEXT, created_at INTEGER
\`);
const db = await ctx.resolve('@openlearn/core:IDatabase');
const rows = db.prepare(
  \`SELECT * FROM \${ctx.db.table('results')} WHERE score > ?\`
).all(80);`}</pre>
                </div>
                {/* Recipe 4 */}
                <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                  <h5 className="font-bold text-gray-800 mb-2">🤖 调用 AI 服务</h5>
                  <pre className="text-[10px] font-mono bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto">
{`// 基础文本生成
const reply = await ctx.services.ai.generateText(
  '请用中文写一段鼓励学生的话',
  { temperature: 0.7 }
);

// 带 system instruction
const result = await ctx.services.ai.generateText(
  '分析以下学生提交的编程作业质量',
  { systemInstruction: '你是编程教师，请给出1-10的评分和一句评语', temperature: 0.3 }
);
// AI 服务自动回退：第三方API → Gemini SDK`}</pre>
                </div>
                {/* Recipe 5 */}
                <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
                  <h5 className="font-bold text-gray-800 mb-2">⏱ 后台定时任务</h5>
                  <pre className="text-[10px] font-mono bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto">
{`// 每 30 分钟自动检查过期作业
await ctx.services.processManager.registerInterval(
  'auto-grade-check', 30 * 60 * 1000,
  async (log) => {
    log('开始检查过期作业...');
    // 执行检查逻辑...
    log('检查完成');
  }
);
// registerHandler 注册后台任务类型，然后 spawn 启动实例
await ctx.services.processManager.registerHandler('batch-grade',
  async (processId, payload, state, log, updateState) => {
    for (const item of payload.items) {
      await processItem(item);
      updateState({ processed: (state.processed||0) + 1 });
    }
    log('批量处理完成');
  }
);
const pid = await ctx.services.processManager.spawn(
  '期末批改', 'batch-grade', { items: [...] }
);`}</pre>
                </div>
              </div>
            </div>

            {/* ═══════════ 部署指南 ═══════════ */}
            <div className="bg-gradient-to-br from-indigo-900 to-indigo-950 rounded-2xl p-6 text-white space-y-4 shadow-md">
              <h4 className="text-xs font-bold tracking-wide flex items-center gap-2 text-indigo-200 uppercase">
                <Sparkles size={14} /> 安装、测试与部署流程
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-1 text-xs leading-relaxed text-indigo-100">
                <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/40 space-y-2">
                  <div className="h-6 w-6 font-mono font-bold bg-indigo-500/25 border border-indigo-400 text-indigo-300 rounded-lg flex items-center justify-center">1</div>
                  <h5 className="font-bold text-white text-xs">{lang === 'zh' ? '开发 & 内联安装' : 'Dev & Inline Install'}</h5>
                  <p className="text-indigo-250 text-[11px] leading-relaxed">{lang === 'zh' ? '复制上方示例代码，修改 manifest 和业务逻辑。在「插件中心」→「导入新插件」粘贴源码。内联安装无需 ZIP — 系统自动存入 SQLite。' : 'Copy examples above, modify manifest and logic. Paste source code via Plugins → Import. No ZIP needed — auto-stored in SQLite.'}</p>
                </div>
                <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/40 space-y-2">
                  <div className="h-6 w-6 font-mono font-bold bg-indigo-500/25 border border-indigo-400 text-indigo-300 rounded-lg flex items-center justify-center">2</div>
                  <h5 className="font-bold text-white text-xs">{lang === 'zh' ? 'ZIP 打包发布' : 'ZIP Packaging'}</h5>
                  <p className="text-indigo-250 text-[11px] leading-relaxed">{lang === 'zh' ? 'manifest.json + index.js 打包为 ZIP。manifest 中指定 main: index.js。通过上传 ZIP 安装，支持 esbuild 预处理。' : 'Bundle manifest.json + index.js as ZIP. Set "main": "index.js" in manifest. Upload ZIP to install with esbuild pre-processing.'}</p>
                </div>
                <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/40 space-y-2">
                  <div className="h-6 w-6 font-mono font-bold bg-indigo-500/25 border border-indigo-400 text-indigo-300 rounded-lg flex items-center justify-center">3</div>
                  <h5 className="font-bold text-white text-xs">{lang === 'zh' ? '调试 & 热重载' : 'Debug & Hot Reload'}</h5>
                  <p className="text-indigo-250 text-[11px] leading-relaxed">{lang === 'zh' ? '激活插件后回到本页顶部「指令总线调试」点击刷新，新注册的 Action 立即可见。输入 payload 直接执行，观察返回结果和事件日志。' : 'After activation, return to Command Debugger tab and refresh. New Actions appear immediately. Test with payload execution and observe results.'}</p>
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : (
        /* 系统使用教程 (User Guide) */
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
  "data": "{\"x\":120,\"y\":80,\"w\":150,\"h\":60,\"stroke\":\"#6366f1\",\"fill\":\"#e0e7ff\"}"
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
                      onClick={() => handleCopy('guide_cmd_draw_map', '{\n  "lessonId": "lesson-101",\n  "type": "mindmap",\n  "data": "{\\\"title\\\":\\\"光电效应\\\",\\\"branches\\\":[\\\"赫兹发现\\\",\\\"爱因斯坦解释\\\"]}"\n}')}
                      className="text-[10px] text-amber-700 hover:underline font-sans font-bold"
                    >
                      {copiedId === 'guide_cmd_draw_map' ? '已复制' : '复制 Payload'}
                    </button>
                  </div>
                  <pre className="font-mono text-[9px] text-amber-900/70 overflow-x-auto">
{`{
  "lessonId": "lesson-101",
  "type": "mindmap",
  "data": "{"title\","branches\":["赫兹发现\","爱因斯坦解释\"]}"
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

                  {/* Flow Steps */}
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

              {/* Architecture text */}
              <div className="text-xs text-slate-300 leading-relaxed space-y-3">
                <p>
                  HTML Applet 是 Edu-OS 系统架构中用以承载高级虚拟物理实验、交互式小游戏、或第三方考试系统的微网页插件。Applet 被封装运行在宿主页面的 <code className="bg-slate-800 text-indigo-300 px-1 rounded font-mono">iframe</code> 沙箱容器中。
                </p>
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-[11px]">
                  <span className="font-bold text-white flex items-center gap-1.5"><Sparkles size={12} className="text-indigo-400" /> 上下游双向通信流深度解析：</span>
                  <ul className="list-disc list-inside space-y-1.5 text-slate-400">
                    <li><strong>运行上下文注入：</strong>当 iframe 加载 Applet 时，Edu-OS 会通过 URL Search Parameters 自动向其传递运行时环境变量（如 <code className="font-mono text-emerald-400 bg-slate-900 px-1 rounded">?studentId=std_uuid&lessonId=les_uuid</code>），Applet 内部通过解析 URL 参数即可获知当前操作者的身份与课时信息。</li>
                    <li><strong>成绩捕获与成绩监听器 (Grade Listener)：</strong>宿主窗口实时在全局挂载消息监听函数。一旦捕获到来自 iframe 内部抛出的成绩包后，会自动将该包封装为内核的 <code className="font-mono text-emerald-400 bg-slate-900 px-1 rounded">assignment.grade_submission</code> 指令动作，推送回 CommandBus 核心。</li>
                    <li><strong>成绩总账更新：</strong>总线处理器解析入参，计算总分偏差并自动更新 SQLite 数据库中的成绩账本，从而驱动当前页面的"学期成绩趋势折线图"和"学情成长轨迹雷达图"实时重新渲染。</li>
                  </ul>
                </div>
              </div>

              {/* Three-step details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs leading-relaxed pt-2">
                
                {/* step 1 */}
                <div className="space-y-2 p-4 rounded-xl bg-slate-900/60 border border-slate-800/80">
                  <span className="text-indigo-400 font-bold uppercase tracking-wider block text-[10.5px]">A. 课件包打包与沙箱规范</span>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    Applet 包必须保证包含一个 <code className="bg-slate-800 text-rose-400 px-1 rounded font-mono">index.html</code> 入口。所有引用的 Javascript、CSS、静态图片等资源必须使用相对路径引用。在 iframe 中运行时，页面自动获得受限的沙箱沙盒权限，防止恶意重定向。
                  </p>
                </div>

                {/* step 2 */}
                <div className="space-y-2 p-4 rounded-xl bg-slate-900/60 border border-slate-800/80">
                  <span className="text-indigo-400 font-bold uppercase tracking-wider block text-[10.5px]">B. 写入 VFS (虚拟文件系统)</span>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    您可通过总线的 <code className="bg-slate-800 text-rose-400 px-1 rounded font-mono">vfs.write_file</code> 指令，将编写好的 HTML 源码或二进制包热重载注入到 Edu-OS 虚拟系统中：
                  </p>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[9px] font-mono text-emerald-400 overflow-x-auto relative mt-2">
                    <button
                      onClick={() => handleCopy('guide_cmd_vfs', '{\n  "path": "/applets/electric_lab.html",\n  "content": "<!DOCTYPE html><html><body><h1>模拟实验室</h1></body></html>"\n}')}
                      className="absolute right-2 top-2 text-[8px] text-indigo-400 hover:underline font-sans"
                    >
                      {copiedId === 'guide_cmd_vfs' ? '已复制' : '复制命令'}
                    </button>
                    {`vfs.write_file:
{
  "path": "/applets/electric_lab.html",
  "content": "<!DOCTYPE html><html>..."
}`}
                  </div>
                </div>

                {/* step 3 */}
                <div className="space-y-2 p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 flex flex-col justify-between">
                  <div>
                    <span className="text-indigo-400 font-bold uppercase tracking-wider block text-[10.5px]">C. AI 监听回传工作流</span>
                    <p className="text-slate-300 text-[11px] leading-relaxed">
                      Edu-OS 宿主页面的监听函数会过滤不安全的跨源消息，仅捕获特定的成绩上报信包，将分数和学情评语即时解析，写入数据库。
                    </p>
                  </div>
                  <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 text-[10px] text-indigo-250 flex items-center gap-1.5 mt-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                    <span>支持自动评级 (A+ 至 C) 及 AI 生成的随堂反馈语</span>
                  </div>
                </div>

              </div>

              {/* Code Box: Complete HTML Template Demo */}
              <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden mt-4">
                <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-xs">
                  <span className="font-mono text-slate-300">完整的 Applet 单页交互及成绩上报模版 (Complete Template Source)</span>
                  <button
                    onClick={() => handleCopy('applet_full_code', `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>Edu-OS 实验 Applet 模版</title>\n  <style>\n    body { font-family: sans-serif; padding: 20px; background: #fafafa; color: #333; }\n    .card { background: white; border: 1px solid #ddd; padding: 20px; border-radius: 12px; max-width: 400px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }\n    button { background: #6366f1; color: white; border: none; padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; }\n  </style>\n</head>\n<body>\n  <div class="card">\n    <h3>物理虚拟实验室：凸透镜成像实验</h3>\n    <p id="env-info" style="font-size: 11px; color: #666;">正在加载上下文环境...</p>\n    <button onclick="submitExperimentScore()">提交实验成绩 (95分)</button>\n  </div>\n\n  <script>\n    // 1. 获取 URL 注入的上下文变量\n    const params = new URLSearchParams(window.location.search);\n    const studentId = params.get('studentId') || '未知学生';\n    const lessonId = params.get('lessonId') || '当前课时';\n    document.getElementById('env-info').innerText = '当前操作学生 ID: ' + studentId + ' | 关联课时: ' + lessonId;\n\n    // 2. 派发 postMessage 信包上报成绩到宿主内核\n    function submitExperimentScore() {\n      if (window.parent) {\n        window.parent.postMessage({\n          type: "grade_submission", // 信包头部\n          score: 95,                // 考核数值成绩 (0-100)\n          feedback: "光路调整正确，透镜成像倍率推导无误。" // 随堂评语\n        }, "*");\n        alert("成绩已通过 postMessage 成功投递回 Edu-OS 内核！");\n      }\n    }\n  </script>\n</body>\n</html>`)}
                    className="text-[10px] text-indigo-400 hover:underline"
                  >
                    {copiedId === 'applet_full_code' ? '已复制' : '复制完整 HTML 示例'}
                  </button>
                </div>
                <pre className="text-[10.5px] font-mono p-4 text-emerald-300 overflow-x-auto leading-relaxed select-all">
{`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Edu-OS 实验 Applet 模版</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #fafafa; color: #333; }
    .card { background: white; border: 1px solid #ddd; padding: 20px; border-radius: 12px; max-width: 400px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    button { background: #6366f1; color: white; border: none; padding: 10px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h3>物理虚拟实验室：凸透镜成像实验</h3>
    <p id="env-info" style="font-size: 11px; color: #666;">正在加载上下文环境...</p>
    <button onclick="submitExperimentScore()">提交实验成绩 (95分)</button>
  </div>

  <script>
    // 1. 获取 URL 注入的上下文变量
    const params = new URLSearchParams(window.location.search);
    const studentId = params.get('studentId') || '未知学生';
    const lessonId = params.get('lessonId') || '当前课时';
    document.getElementById('env-info').innerText = '当前操作学生 ID: ' + studentId + ' | 关联课时: ' + lessonId;

    // 2. 派发 postMessage 信包上报成绩到宿主内核
    function submitExperimentScore() {
      if (window.parent) {
        window.parent.postMessage({
          type: "grade_submission", // 信包头部
          score: 95,                // 考核数值成绩 (0-100)
          feedback: "光路调整正确，透镜成像倍率推导无误。" // 随堂评语
        }, "*");
        alert("成绩已通过 postMessage 成功投递回 Edu-OS 内核！");
      }
    }
  </script>
</body>
</html>`}
                </pre>
              </div>

            </div>

          </div>
        </div>
      )}

      <div className="p-4 border-t border-gray-100 bg-gray-50/40 shrink-0 flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span>ActionRegistry Core Driver Localhost : Online Syncing</span>
        </div>
        <div>
          Total Registered Handlers: <span className="font-mono text-gray-600 font-semibold">{registeredCommands.length}</span>
        </div>
      </div>
    </div>
  );
}
const generateTemplateContent = (title: string, category: string): string => {
  const normalizedTitle = title ? title.trim() : "New Course";
  switch (category) {
    case 'Mathematics':
      return `# ${normalizedTitle}\n\n## 101 Course Core Foundations\nWelcome to our mathematics laboratory. This course is designed to break down abstract calculations into visual whiteboard proofs and real-world application models.\n\n### 📐 Key Theorems & Proof Matrix\n- **Formula A**: $E = mc^2$ or equivalent derivative parameters\n- **Core Axiom**: For every linear projection, a finite dimension defines its trace.\n\n### 实践演练随堂真题 Practice Problems\n1. Calculate the local optima for the function on the interactive workspace.\n2. Prove the uniqueness of the residual limit under Gaussian conditions.\n\n### 📥 Homework Assignment Task\nIdentify three real-world physical structures implementing these spatial principles and coordinate maps.`;
    
    case 'ComputerScience':
      return `# ${normalizedTitle}\n\n## 💻 Technical Exploration & Engineering Lab\nThis session acts as an immersive sandbox exploring core algorithmic structures, optimization mechanics, and data abstractions.\n\n### ⚙️ Core Lecture Blueprint & Pseudocode\n\`\`\`python\ndef optimize_weights(data, factor=0.01):\n    # Initialize local metrics\n    scores = [x * factor for x in data]\n    return sum(scores) / len(scores)\n\`\`\`\n\n### ⚡ Laboratory Workspace Drill\n- **Objective**: Develop a linear hash-map with zero-collision distribution.\n- **Action**: Use the interactive canvas to sketch data pipelines.\n\n### 📝 Post-Class Evaluation\nWrite a 200-word critique analyzing memory-locality vs execution-speed trade-offs in low-level registers.`;
    
    case 'Literature':
      return `# ${normalizedTitle}\n\n## ✍️ Literary Critical Analysis Seminar\nThis curriculum evaluates textual aesthetics, semantic patterns, subtextual symbols, and historical contexts across classic paradigms.\n\n### 🏛️ Classic Textual Excerpts\n> "Reality represents a state of constant translation between what is experienced and what is chronicled."\n\n### 💭 Critique Evaluation Metrics\n- **Theme Assessment**: Analyze structural ironies within contemporary essays.\n- **Author Intention**: Focus on pacing triggers and character foils.\n\n### 💬 Classroom Collaborative Debate Topics\nDoes digital notation diminish the biological connection to textual journaling? Discuss under 15 minutes framework.`;
    
    case 'Physics':
      return `# ${normalizedTitle}\n\n## ⚡ Experimental Physics & Natural Science Sandbox\nIn this session, theoretical models undergo practical validation through interactive virtual whiteboard modeling and numerical measurements.\n\n### 🔬 Key Mechanical Principles & Constraints\n- **Axiom 1**: Momentum is conserved in closed coordinate vectors.\n- **Axiom 2**: Resistance is directly proportional to temperature factors.\n\n### 🛠️ Lab Step-by-Step Procedure\n1. Plot the force vectors acting on the balance coordinate vertices.\n2. Measure the velocity coefficients across three alternate trial loops.\n\n### 📝 Homework Assignment Evaluation\nCalculate energy loss ratios using standard mathematical integrals in your journal.`;
    
    case 'History':
      return `# ${normalizedTitle}\n\n## 🏛️ Geopolitical Context Mapping & Historical Context\nThis course explores historical trends, decision frameworks, resource patterns, and socio-economic influences that shaped modern civilization.\n\n### 🗺️ Context Timeline Focus\n- **Phase A**: Resource migration patterns along major trade waterways.\n- **Phase B**: Strategic institutional reforms and cultural integration cycles.\n\n### 🔍 Primary Source Critique Work\nAnalyze the 18th-century legislative documents for bias, context gaps, and underlying socio-economic drivers.\n\n### 💬 Group Discussion Prompts\nHow did geography influence the longevity of ancient administrative models?`;
    
    case 'Art':
      return `# ${normalizedTitle}\n\n## 🎨 Visual Composition & Creative Sketching Studio\nA workshop focusing on aesthetic principles, negative space ratios, visual balance, and dynamic typography models.\n\n### 🖌️ Design Principles\n- **Golden Spiral**: Align critical focal points with recursive visual arcs.\n- **Chiaroscuro**: Leverage deep high-contrast shading to establish three-dimensional form.\n\n### 🛠️ Whiteboard Practical Sandbox Project\nCollaborate on the dynamic canvas to draft a raw responsive layout using minimal monochromatic blocks.\n\n### 🎨 Portfolio Task\nSubmit three divergent conceptual drafts representing active space constraints.`;

    default:
      return `# ${normalizedTitle}\n\n## 🔮 Multidisciplinary Advanced Exploration & Research\nThis course integrates cross-subject paradigms, cognitive practices, and critical reasoning methods.\n\n### 📚 Course Syllabus Modules\n- **Module 1**: Core theoretical grounding and conceptual models.\n- **Module 2**: Practical exercises combining research and action.\n\n### 📝 Interactive Classroom Tasks\n1. Formulate 2 key research queries aligning with this lecture.\n2. Sketch the systemic flow diagram depicting interaction factors.\n\n### 📥 Assignment Brief\nDraft a 300-word integration proposal based on today's whiteboard exercises.`;
  }
};

