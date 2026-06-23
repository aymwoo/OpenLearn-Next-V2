import { v7 as uuidv7 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
  IPluginHostToken,
} from '../core/di/interfaces.js';
import type { PluginContext } from '../core/plugin-host/types.js';
import { hasDataSubmission, hasScoreDisplay, injectScoreSubmissionUsingAI } from './ai-submit-injector.js';

function copyFolderSync(src: string, dest: string) {
  if ((fs as any).cpSync) {
    (fs as any).cpSync(src, dest, { recursive: true });
  } else {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((child) => {
      const srcChild = path.join(src, child);
      const destChild = path.join(dest, child);
      if (fs.lstatSync(srcChild).isDirectory()) {
        copyFolderSync(srcChild, destChild);
      } else {
        fs.copyFileSync(srcChild, destChild);
      }
    });
  }
}

export const BuiltinPlugin = {
  manifest: {
    id: '@openlearn/plugin-builtin',
    name: '课堂核心插件',
    version: '1.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:IPluginHost@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read', 'lesson:write', 'whiteboard:read', 'whiteboard:write'],
  },
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);
    const pluginHost = await ctx.resolve(IPluginHostToken);

    // 1. LESSON HANDLER
    const createLessonCmdType = 'lesson.create';
    await actionRegistry.register({
      id: 'core-lesson-create',
      commandType: createLessonCmdType,
      description: '创建新课程，输入标题和可选的初始内容',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: '课程标题' },
          content: { type: 'STRING', description: '课程的初始 Markdown 内容，请生成一段简短的介绍或教学大纲' }
        },
        required: ['title', 'content']
      }
    });

    await commandBus.registerHandler(createLessonCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const lessonId = uuidv7();
        
        const stmt = db.prepare('INSERT INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
        stmt.run(lessonId, payload.title, payload.content || '', Date.now(), Date.now());

        await eventBus.publish({
          id: uuidv7(),
          type: 'lesson.created',
          source: 'builtin.lesson',
          payload: { id: lessonId, title: payload.title },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { lessonId };
      }
    });

    // 1.5 LESSON UPDATE HANDLER
    const updateLessonCmdType = 'lesson.update';
    await actionRegistry.register({
      id: 'core-lesson-update',
      commandType: updateLessonCmdType,
      description: '更新已有课程的内容',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '要更新的课程 ID' },
          content: { type: 'STRING', description: '课程的新 Markdown 内容' }
        },
        required: ['lessonId', 'content']
      }
    });

    await commandBus.registerHandler(updateLessonCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const stmt = db.prepare('UPDATE lessons SET content = ?, updated_at = ? WHERE id = ?');
        stmt.run(payload.content, Date.now(), payload.lessonId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'lesson.updated',
          source: 'builtin.lesson',
          payload: { id: payload.lessonId },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { lessonId: payload.lessonId };
      }
    });

    // 1.6 LESSON UPDATE TIMELINE HANDLER
    const updateTimelineCmdType = 'lesson.update_timeline';
    await actionRegistry.register({
      id: 'core-lesson-update-timeline',
      commandType: updateTimelineCmdType,
      description: '设置或更新课程的完整环节时间线列表',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '要更新的课程 ID' },
          timeline: { type: 'STRING', description: '环节时间线的 JSON 字符串或数组' }
        },
        required: ['lessonId', 'timeline']
      }
    });

    await commandBus.registerHandler(updateTimelineCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        let timelineStr = '';
        if (typeof payload.timeline === 'string') {
          timelineStr = payload.timeline;
        } else if (Array.isArray(payload.timeline)) {
          timelineStr = JSON.stringify(payload.timeline);
        } else {
          timelineStr = JSON.stringify([]);
        }

        const stmt = db.prepare('UPDATE lessons SET timeline = ?, updated_at = ? WHERE id = ?');
        stmt.run(timelineStr, Date.now(), payload.lessonId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'lesson.timeline_updated',
          source: 'builtin.lesson',
          payload: { id: payload.lessonId, timeline: timelineStr },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { lessonId: payload.lessonId, success: true };
      }
    });

    // 1.7 LESSON ADD TIMELINE SEGMENT HANDLER
    const addSegmentCmdType = 'lesson.add_segment';
    await actionRegistry.register({
      id: 'core-lesson-add-segment',
      commandType: addSegmentCmdType,
      description: '向课程时间线添加一个环节（如：讲授、互动练习、测验、休息）',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '要编辑的课程 ID' },
          title: { type: 'STRING', description: '本环节的标题' },
          duration: { type: 'STRING', description: '本环节的时长（如：10m、15m、5m）' },
          type: { type: 'STRING', description: '活动类型（lecture、practice、quiz、break）' },
          notes: { type: 'STRING', description: '可选的环节教学指导、提示或白板指令' },
          color: { type: 'STRING', description: '可选的 Tailwind 背景边框类名或颜色名' },
          index: { type: 'INTEGER', description: '插入的位置索引（可选，默认为末尾追加）' }
        },
        required: ['lessonId', 'title', 'duration', 'type']
      }
    });

    await commandBus.registerHandler(addSegmentCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const lesson = db.prepare('SELECT timeline FROM lessons WHERE id = ?').get(payload.lessonId) as any;
        if (!lesson) {
          throw new Error(`Lesson ${payload.lessonId} not found`);
        }

        let segments: any[] = [];
        if (lesson.timeline) {
          try {
            segments = typeof lesson.timeline === 'string' ? JSON.parse(lesson.timeline) : lesson.timeline;
            if (!Array.isArray(segments)) segments = [];
          } catch (e) {
            segments = [];
          }
        }

        const newSegment = {
          id: uuidv7(),
          title: payload.title,
          duration: payload.duration,
          type: payload.type,
          notes: payload.notes || '',
          color: payload.color || 'bg-indigo-50 border-indigo-200 text-indigo-700'
        };

        const insertIndex = typeof payload.index === 'number' ? payload.index : segments.length;
        segments.splice(insertIndex, 0, newSegment);

        const timelineStr = JSON.stringify(segments);
        db.prepare('UPDATE lessons SET timeline = ?, updated_at = ? WHERE id = ?').run(timelineStr, Date.now(), payload.lessonId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'lesson.timeline_updated',
          source: 'builtin.lesson',
          payload: { id: payload.lessonId, timeline: timelineStr },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { lessonId: payload.lessonId, segment: newSegment, success: true };
      }
    });

    // 1.75 LESSON REMOVE TIMELINE SEGMENT HANDLER
    const removeSegmentCmdType = 'lesson.remove_segment';
    await actionRegistry.register({
      id: 'core-lesson-remove-segment',
      commandType: removeSegmentCmdType,
      description: '通过 ID 或索引从课程时间线中删除环节',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '要编辑的课程 ID' },
          segmentId: { type: 'STRING', description: '要删除的环节 ID（如未提供索引则必填）' },
          index: { type: 'INTEGER', description: '要删除的环节位置索引（如未提供 segmentId 则必填）' }
        },
        required: ['lessonId']
      }
    });

    await commandBus.registerHandler(removeSegmentCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const lesson = db.prepare('SELECT timeline FROM lessons WHERE id = ?').get(payload.lessonId) as any;
        if (!lesson) {
          throw new Error(`Lesson ${payload.lessonId} not found`);
        }

        let segments: any[] = [];
        if (lesson.timeline) {
          try {
            segments = typeof lesson.timeline === 'string' ? JSON.parse(lesson.timeline) : lesson.timeline;
            if (!Array.isArray(segments)) segments = [];
          } catch (e) {
            segments = [];
          }
        }

        let deletedSegment: any = null;
        if (payload.segmentId) {
          const initialLen = segments.length;
          deletedSegment = segments.find(s => s.id === payload.segmentId);
          segments = segments.filter(s => s.id !== payload.segmentId);
          if (segments.length === initialLen) {
            throw new Error(`Segment with ID ${payload.segmentId} was not found in lesson timeline`);
          }
        } else if (typeof payload.index === 'number') {
          if (payload.index < 0 || payload.index >= segments.length) {
            throw new Error(`Timeline index ${payload.index} out of bounds (length: ${segments.length})`);
          }
          deletedSegment = segments[payload.index];
          segments.splice(payload.index, 1);
        } else {
          throw new Error('Either segmentId or index must be specified');
        }

        const timelineStr = JSON.stringify(segments);
        db.prepare('UPDATE lessons SET timeline = ?, updated_at = ? WHERE id = ?').run(timelineStr, Date.now(), payload.lessonId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'lesson.timeline_updated',
          source: 'builtin.lesson',
          payload: { id: payload.lessonId, timeline: timelineStr },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { lessonId: payload.lessonId, deletedSegment, success: true };
      }
    });

    // 1.8 LESSON DELETE HANDLER
    const deleteLessonCmdType = 'lesson.delete';
    await actionRegistry.register({
      id: 'core-lesson-delete',
      commandType: deleteLessonCmdType,
      description: '删除课程。此为高风险操作。',
      capabilityRequired: 'lesson:delete',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '要删除的课程 ID' }
        },
        required: ['lessonId']
      }
    });

    await commandBus.registerHandler(deleteLessonCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const stmt = db.prepare('DELETE FROM lessons WHERE id = ?');
        stmt.run(payload.lessonId);
        
        db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(payload.lessonId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'lesson.deleted',
          source: 'builtin.lesson',
          payload: { id: payload.lessonId },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true };
      }
    });

    // 2. WHITEBOARD HANDLER
    const drawWhiteboardCmdType = 'whiteboard.draw';
    // 前端 renderElement 支持的元素类型白名单。
    // AI Agent 若使用不在列表中的 type，将被拒绝并引导至专用工具。
    const KNOWN_ELEMENT_TYPES = [
      'pen', 'highlighter',          // 自由绘制
      'rectangle', 'circle',         // 几何形状
      'text',                        // 文本
      'quiz', 'rollcall',            // 课堂互动（优先使用 quiz.create / quiz_pro.create）
      'assignment',                  // 作业
      'hello-world', 'html-applet', 'code-sandbox', 'math-graph', 'presentation', // 小组件
    ];
    await actionRegistry.register({
      id: 'core-whiteboard-draw',
      commandType: drawWhiteboardCmdType,
      description: '在课程白板上绘制基础图形或文本。'
        + ' 支持：rectangle, circle, text, pen, highlighter。'
        + ' ⚠️ 创建测验请用 quiz.create 或 quiz_pro.create（自动处理题型格式）。'
        + ' 创建点名请用 rollcall 相关工具。',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          type: { type: 'STRING', description: '元素类型（仅基础图形/文本）。quiz/rollcall 请用专用工具：' + KNOWN_ELEMENT_TYPES.filter(t => !['quiz', 'rollcall', 'assignment'].includes(t)).join(', ') },
          data: { type: 'STRING', description: '元素配置的 JSON 字符串' },
          segmentId: { type: 'STRING', description: '关联的课堂环节 ID（可选）' },
          page: { type: 'NUMBER', description: '元素所属页码（可选，默认 0）' }
        },
        required: ['lessonId', 'type', 'data']
      }
    });

    await commandBus.registerHandler(drawWhiteboardCmdType, {
      async execute(command) {
        const payload = command.payload as any;

        // 类型白名单校验：拒绝未知类型，引导调用方使用正确工具
        if (!KNOWN_ELEMENT_TYPES.includes(payload.type)) {
          const hint = payload.type === 'quiz' ? ''
            : (payload.type && (payload.type.includes('quiz') || payload.type.includes('question'))
              ? ` 提示：创建测验请使用 quiz.create 或 quiz_pro.create 工具。`
              : ` 已知类型：${KNOWN_ELEMENT_TYPES.join(', ')}。`);
          throw new Error(`不支持的元素类型 "${payload.type}"。${hint}`);
        }

        const elementId = uuidv7();

        // 方案 C：在 whiteboard.draw 层面补齐 segmentId 和 page 元数据。
        // 优先使用调用方显式传入的值，否则尝试从现有上下文中推导。
        // 这确保所有元素——无论通过插件、前端还是 AI Agent 创建——都携带正确的上下文信息。
        let dataStr = payload.data;
        try {
          const dataObj = JSON.parse(dataStr);
          // segmentId: 调用方传入 > 已有 > 不设置（让前端回退到分段过滤或全局可见）
          if (payload.segmentId && !dataObj.segmentId) {
            dataObj.segmentId = payload.segmentId;
          }
          // page: 调用方传入 > 已有 > 默认 0
          if (payload.page !== undefined && dataObj.page === undefined) {
            dataObj.page = payload.page;
          } else if (dataObj.page === undefined) {
            dataObj.page = 0;
          }
          dataStr = JSON.stringify(dataObj);
        } catch {
          // 如果 data 不是合法 JSON，保持原样存入
        }

        const stmt = db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)');
        stmt.run(elementId, payload.lessonId, payload.type, dataStr, Date.now());

        await eventBus.publish({
          id: uuidv7(),
          type: 'whiteboard.element_drawn',
          source: 'builtin.whiteboard',
          payload: { elementId, lessonId: payload.lessonId, type: payload.type },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { elementId };
      }
    });

    // 3. WHITEBOARD UPDATE HANDLER
    const updateWhiteboardCmdType = 'whiteboard.update';
    await actionRegistry.register({
      id: 'core-whiteboard-update',
      commandType: updateWhiteboardCmdType,
      description: '更新白板上已有的元素',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          elementId: { type: 'STRING', description: '元素 ID' },
          data: { type: 'STRING', description: '元素配置的新 JSON 字符串' }
        },
        required: ['lessonId', 'elementId', 'data']
      }
    });

    await commandBus.registerHandler(updateWhiteboardCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const stmt = db.prepare('UPDATE whiteboard_elements SET data = ? WHERE id = ? AND lesson_id = ?');
        stmt.run(payload.data, payload.elementId, payload.lessonId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'whiteboard.element_updated',
          source: 'builtin.whiteboard',
          payload: { elementId: payload.elementId, lessonId: payload.lessonId },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true };
      }
    });

    // 4. WHITEBOARD DELETE HANDLER
    const deleteWhiteboardCmdType = 'whiteboard.delete';
    await actionRegistry.register({
      id: 'core-whiteboard-delete',
      commandType: deleteWhiteboardCmdType,
      description: '从白板中删除已有元素',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: 'ID of the lesson' },
          elementId: { type: 'STRING', description: 'ID of the element' }
        },
        required: ['lessonId', 'elementId']
      }
    });

    await commandBus.registerHandler(deleteWhiteboardCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const stmt = db.prepare('DELETE FROM whiteboard_elements WHERE id = ? AND lesson_id = ?');
        stmt.run(payload.elementId, payload.lessonId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'whiteboard.element_deleted',
          source: 'builtin.whiteboard',
          payload: { elementId: payload.elementId, lessonId: payload.lessonId },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true };
      }
    });

    // 5. WHITEBOARD CLEAR HANDLER
    const clearWhiteboardCmdType = 'whiteboard.clear';
    await actionRegistry.register({
      id: 'core-whiteboard-clear',
      commandType: clearWhiteboardCmdType,
      description: '清空指定课程白板上的所有元素',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: 'ID of the lesson' }
        },
        required: ['lessonId']
      }
    });

    await commandBus.registerHandler(clearWhiteboardCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const stmt = db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?');
        stmt.run(payload.lessonId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'whiteboard.cleared',
          source: 'builtin.whiteboard',
          payload: { lessonId: payload.lessonId },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true };
      }
    });

    // 6. PLUGIN INSTALL HANDLER
    const installPluginCmdType = 'plugin.install';
    await actionRegistry.register({
      id: 'core-plugin-install',
      commandType: installPluginCmdType,
      description: '安装自定义 JavaScript 插件源码。此为高风险操作。',
      capabilityRequired: 'plugin:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          sourceCode: { type: 'STRING', description: '插件的完整 JavaScript 源代码' }
        },
        required: ['sourceCode']
      }
    });

    await commandBus.registerHandler(installPluginCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const manifest = await pluginHost.installPlugin(payload.sourceCode);
        return { success: true, manifest };
      }
    });

    // 6.5. PLUGIN INSTALL ZIP HANDLER
    const installPluginZipCmdType = 'plugin.install_zip';
    await actionRegistry.register({
      id: 'core-plugin-install-zip',
      commandType: installPluginZipCmdType,
      description: '通过包含 index.js（或 plugin.js）和 manifest.json 的 ZIP 文件安装自定义插件',
      capabilityRequired: 'plugin:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          base64Data: { type: 'STRING', description: 'ZIP 文件的 Base64 编码数据' },
          filename: { type: 'STRING', description: 'ZIP 文件名（可选）' }
        },
        required: ['base64Data']
      }
    });

    await commandBus.registerHandler(installPluginZipCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const base64Content = payload.base64Data.replace(/^data:[^;]+;base64,/, '');
        const fileBuffer = Buffer.from(base64Content, 'base64');
        const manifest = await pluginHost.installPluginFromZip(fileBuffer);
        return { success: true, manifest };
      }
    });

    // 7. PLUGIN TOGGLE HANDLER
    const togglePluginCmdType = 'plugin.toggle';
    await actionRegistry.register({
      id: 'core-plugin-toggle',
      commandType: togglePluginCmdType,
      description: '切换已安装插件的状态（启用/禁用）。此为高风险操作。',
      capabilityRequired: 'plugin:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          pluginId: { type: 'STRING', description: '插件的唯一数据库 ID' }
        },
        required: ['pluginId']
      }
    });

    await commandBus.registerHandler(togglePluginCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const newStatus = await pluginHost.togglePlugin(payload.pluginId);
        return { success: true, status: newStatus };
      }
    });

    // 7.5. PLUGIN UNINSTALL HANDLER
    const uninstallPluginCmdType = 'plugin.uninstall';
    await actionRegistry.register({
      id: 'core-plugin-uninstall',
      commandType: uninstallPluginCmdType,
      description: '从系统中卸载并彻底删除插件。此为高风险操作。',
      capabilityRequired: 'plugin:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          pluginId: { type: 'STRING', description: '插件的唯一数据库 ID' }
        },
        required: ['pluginId']
      }
    });

    await commandBus.registerHandler(uninstallPluginCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        await pluginHost.uninstallPlugin(payload.pluginId);
        return { success: true };
      }
    });

    // 8. USER LIST HANDLER
    const listUsersCmdType = 'user.list';
    await actionRegistry.register({
      id: 'core-user-list',
      commandType: listUsersCmdType,
      description: '列出所有已注册的教师和管理员账户',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          role: { type: 'STRING', description: '按角色筛选：administrator（管理员）或 teacher（教师）（可选）' }
        }
      }
    });

    await commandBus.registerHandler(listUsersCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        let query = 'SELECT id, username, role, name, status, created_at FROM users';
        const params: any[] = [];
        if (payload.role) {
          query += ' WHERE role = ?';
          params.push(payload.role);
        }
        query += ' ORDER BY created_at DESC';
        const users = db.prepare(query).all(...params);
        return users;
      }
    });

    // 9. USER CREATE HANDLER
    const createUserCmdType = 'user.create';
    await actionRegistry.register({
      id: 'core-user-create',
      commandType: createUserCmdType,
      description: '创建新的教师或管理员账户',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          username: { type: 'STRING', description: '用于登录的唯一用户名' },
          password: { type: 'STRING', description: '明文登录密码' },
          role: { type: 'STRING', description: '用户角色：administrator 或 teacher' },
          name: { type: 'STRING', description: '用户显示名称' },
          status: { type: 'STRING', description: '初始状态：active（启用）或 disabled（禁用）（可选）' }
        },
        required: ['username', 'password', 'role', 'name']
      }
    });

    await commandBus.registerHandler(createUserCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { username, password, role, name, status = 'active' } = payload;
        
        if (!username || !password || !role || !name) {
          throw new Error('username, password, role, and name are required');
        }
        
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
          throw new Error('Username is already taken');
        }
        
        const id = 'usr_' + Math.random().toString(36).slice(2, 10);
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        
        db.prepare(
          'INSERT INTO users (id, username, password_hash, role, name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(id, username, hash, role, name, status, Date.now());

        await eventBus.publish({
          id: uuidv7(),
          type: 'user.created',
          source: 'builtin.user',
          payload: { id, username, role, name, status },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true, id, username, role, name, status };
      }
    });

    // 10. USER UPDATE HANDLER
    const updateUserCmdType = 'user.update';
    await actionRegistry.register({
      id: 'core-user-update',
      commandType: updateUserCmdType,
      description: '更新已有用户账户的信息',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: '要更新的用户唯一 ID' },
          username: { type: 'STRING', description: '新用户名（可选）' },
          password: { type: 'STRING', description: '新明文密码（可选）' },
          role: { type: 'STRING', description: '新角色：administrator 或 teacher（可选）' },
          name: { type: 'STRING', description: '新显示名称（可选）' },
          status: { type: 'STRING', description: '新状态：active 或 disabled（可选）' }
        },
        required: ['userId']
      }
    });

    await commandBus.registerHandler(updateUserCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { userId, username, password, role, name, status } = payload;
        
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
        if (!user) {
          throw new Error(`User with ID ${userId} not found`);
        }
        
        if (username && username !== user.username) {
          const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
          if (existing) {
            throw new Error('Username is already taken');
          }
        }

        const updates: string[] = [];
        const params: any[] = [];

        if (username !== undefined) {
          updates.push('username = ?');
          params.push(username);
        }
        if (password !== undefined && password !== '') {
          updates.push('password_hash = ?');
          const hash = crypto.createHash('sha256').update(password).digest('hex');
          params.push(hash);
        }
        if (role !== undefined) {
          updates.push('role = ?');
          params.push(role);
        }
        if (name !== undefined) {
          updates.push('name = ?');
          params.push(name);
        }
        if (status !== undefined) {
          updates.push('status = ?');
          params.push(status);
        }

        if (updates.length === 0) {
          return { success: true, message: 'No fields updated' };
        }

        params.push(userId);
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        db.prepare(query).run(...params);

        await eventBus.publish({
          id: uuidv7(),
          type: 'user.updated',
          source: 'builtin.user',
          payload: { id: userId, username, role, name, status },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true };
      }
    });

    // 11. USER DELETE HANDLER
    const deleteUserCmdType = 'user.delete';
    await actionRegistry.register({
      id: 'core-user-delete',
      commandType: deleteUserCmdType,
      description: '删除用户账户。此为高风险操作。',
      capabilityRequired: 'management:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          userId: { type: 'STRING', description: '要删除的用户唯一 ID' }
        },
        required: ['userId']
      }
    });

    await commandBus.registerHandler(deleteUserCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { userId } = payload;

        const userToDelete = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
        if (!userToDelete) {
          throw new Error(`User with ID ${userId} not found`);
        }

        if (userToDelete.role === 'administrator') {
          const adminCountObj = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE role = ?').get('administrator') as any;
          if (adminCountObj.cnt <= 1) {
            throw new Error('Cannot delete the only remaining administrator account');
          }
        }

        db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'user.deleted',
          source: 'builtin.user',
          payload: { id: userId },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true };
      }
    });

    // --- COURSEWARE UPLOAD HANDLER ---
    const uploadCoursewareCmdType = 'courseware.upload';
    await actionRegistry.register({
      id: 'core-courseware-upload',
      commandType: uploadCoursewareCmdType,
      description: '上传单个 HTML 页面或 ZIP 交互式课件包',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '课件名称' },
          filename: { type: 'STRING', description: '上传文件的文件名' },
          base64Data: { type: 'STRING', description: '文件的 Base64 数据（可带 data:URI 前缀）' }
        },
        required: ['name', 'filename', 'base64Data']
      }
    });

    await commandBus.registerHandler(uploadCoursewareCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { name, filename, base64Data } = payload;
        
        const ext = path.extname(filename).toLowerCase();
        if (ext !== '.html' && ext !== '.htm' && ext !== '.zip') {
          throw new Error('Only .html, .htm and .zip files are supported for courseware');
        }

        const uuid = uuidv7();
        const storageDir = path.resolve(process.cwd(), 'storage', 'courseware', uuid);
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true });
        }

        const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');
        const fileBuffer = Buffer.from(base64Content, 'base64');

        if (ext === '.html' || ext === '.htm') {
          const entryName = filename;
          fs.writeFileSync(path.join(storageDir, entryName), fileBuffer);

          const coursewareId = 'cw_' + crypto.randomBytes(8).toString('hex');
          db.prepare(
            'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(coursewareId, uuid, name, 'html', entryName, Date.now());

          await eventBus.publish({
            id: uuidv7(),
            type: 'courseware.uploaded',
            source: 'builtin.courseware',
            payload: { id: coursewareId, uuid, name, entry: entryName },
            timestamp: Date.now(),
            correlationId: command.id
          });

          // Let's check for AI version injection
          try {
            const htmlContent = fileBuffer.toString('utf-8');
            if (!hasDataSubmission(htmlContent) && hasScoreDisplay(htmlContent)) {
              const modified = await injectScoreSubmissionUsingAI(db, htmlContent);
              if (modified && modified !== htmlContent) {
                const newUuid = uuidv7();
                const newCwId = 'cw_' + crypto.randomBytes(8).toString('hex');
                const newStorageDir = path.resolve(process.cwd(), 'storage', 'courseware', newUuid);
                fs.mkdirSync(newStorageDir, { recursive: true });
                fs.writeFileSync(path.join(newStorageDir, entryName), modified);

                db.prepare(
                  'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
                ).run(newCwId, newUuid, `[自动提交版] ${name}`, 'html', entryName, Date.now() + 10);

                await eventBus.publish({
                  id: uuidv7(),
                  type: 'courseware.uploaded',
                  source: 'builtin.courseware',
                  payload: { id: newCwId, uuid: newUuid, name: `[自动提交版] ${name}`, entry: entryName },
                  timestamp: Date.now() + 10,
                  correlationId: command.id
                });
              }
            }
          } catch (aiErr) {
            console.error('Failed to create AI auto-submit version for html upload:', aiErr);
          }

          return { success: true, id: coursewareId, uuid, name, entry: entryName };
        } else {
          // Zip file unzipping - using direct load since JSZip is required
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          let loadedZip;
          try {
            loadedZip = await zip.loadAsync(fileBuffer);
          } catch (zipErr: any) {
            throw new Error('Failed to parse ZIP archive: ' + zipErr.message);
          }

          // Write files to storage
          const files: string[] = [];
          for (const [relativePath, file] of Object.entries(loadedZip.files)) {
            const fileObj = file as any;
            if (!fileObj.dir) {
              const destPath = path.resolve(storageDir, relativePath);
              if (!destPath.startsWith(storageDir)) {
                throw new Error('Directory traversal attempt detected in ZIP archive');
              }
              const parentDir = path.dirname(destPath);
              if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
              }
              const fileContent = await fileObj.async('nodebuffer');
              fs.writeFileSync(destPath, fileContent);
              files.push(relativePath);
            }
          }

          // Candidates scan
          const primaryCandidates = files.filter(f => {
            const base = path.basename(f).toLowerCase();
            return base === 'index.html' || base === 'index.htm' || base === 'main.html' || base === 'lesson.html';
          });

          let entry = '';
          if (primaryCandidates.length === 1) {
            entry = primaryCandidates[0];
          } else if (primaryCandidates.length > 1) {
            const rootIndex = primaryCandidates.find(f => f.toLowerCase() === 'index.html');
            if (rootIndex) {
              entry = rootIndex;
            }
          }

          const allHtmlCandidates = files.filter(f => {
            const extName = path.extname(f).toLowerCase();
            return extName === '.html' || extName === '.htm';
          });

          if (!entry) {
            if (allHtmlCandidates.length === 1) {
              entry = allHtmlCandidates[0];
            }
          }

          if (entry) {
            const coursewareId = 'cw_' + crypto.randomBytes(8).toString('hex');
            db.prepare(
              'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(coursewareId, uuid, name, 'folder', entry, Date.now());

            await eventBus.publish({
              id: uuidv7(),
              type: 'courseware.uploaded',
              source: 'builtin.courseware',
              payload: { id: coursewareId, uuid, name, entry },
              timestamp: Date.now(),
              correlationId: command.id
            });

            // Check for AI version injection
            try {
              const entryPath = path.join(storageDir, entry);
              if (fs.existsSync(entryPath)) {
                const htmlContent = fs.readFileSync(entryPath, 'utf-8');
                if (!hasDataSubmission(htmlContent) && hasScoreDisplay(htmlContent)) {
                  const modified = await injectScoreSubmissionUsingAI(db, htmlContent);
                  if (modified && modified !== htmlContent) {
                    const newUuid = uuidv7();
                    const newCwId = 'cw_' + crypto.randomBytes(8).toString('hex');
                    const newStorageDir = path.resolve(process.cwd(), 'storage', 'courseware', newUuid);
                    copyFolderSync(storageDir, newStorageDir);
                    fs.writeFileSync(path.join(newStorageDir, entry), modified);

                    db.prepare(
                      'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
                    ).run(newCwId, newUuid, `[自动提交版] ${name}`, 'folder', entry, Date.now() + 10);

                    await eventBus.publish({
                      id: uuidv7(),
                      type: 'courseware.uploaded',
                      source: 'builtin.courseware',
                      payload: { id: newCwId, uuid: newUuid, name: `[自动提交版] ${name}`, entry },
                      timestamp: Date.now() + 10,
                      correlationId: command.id
                    });
                  }
                }
              }
            } catch (aiErr) {
              console.error('Failed to create AI auto-submit version for zip auto-confirm:', aiErr);
            }

            return { success: true, id: coursewareId, uuid, name, entry };
          } else {
            if (allHtmlCandidates.length === 0) {
              throw new Error('No HTML entry page found in ZIP archive');
            }
            return {
              success: true,
              need_select_entry: true,
              candidates: allHtmlCandidates,
              uuid,
              name
            };
          }
        }
      }
    });

    // --- COURSEWARE CONFIRM ENTRY HANDLER ---
    const confirmCoursewareCmdType = 'courseware.confirm';
    await actionRegistry.register({
      id: 'core-courseware-confirm',
      commandType: confirmCoursewareCmdType,
      description: '确认选择 ZIP 课件包的入口页面',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          uuid: { type: 'STRING', description: '上传课件的已生成 UUID' },
          name: { type: 'STRING', description: '课件名称' },
          entry: { type: 'STRING', description: '选定的入口 HTML 文件路径' }
        },
        required: ['uuid', 'name', 'entry']
      }
    });

    await commandBus.registerHandler(confirmCoursewareCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { uuid, name, entry } = payload;

        const coursewareId = 'cw_' + crypto.randomBytes(8).toString('hex');
        db.prepare(
          'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(coursewareId, uuid, name, 'folder', entry, Date.now());

        await eventBus.publish({
          id: uuidv7(),
          type: 'courseware.confirmed',
          source: 'builtin.courseware',
          payload: { id: coursewareId, uuid, name, entry },
          timestamp: Date.now(),
          correlationId: command.id
        });

        // Check for AI version injection
        try {
          const storageDir = path.resolve(process.cwd(), 'storage', 'courseware', uuid);
          const entryPath = path.join(storageDir, entry);
          if (fs.existsSync(entryPath)) {
            const htmlContent = fs.readFileSync(entryPath, 'utf-8');
            if (!hasDataSubmission(htmlContent) && hasScoreDisplay(htmlContent)) {
              const modified = await injectScoreSubmissionUsingAI(db, htmlContent);
              if (modified && modified !== htmlContent) {
                const newUuid = uuidv7();
                const newCwId = 'cw_' + crypto.randomBytes(8).toString('hex');
                const newStorageDir = path.resolve(process.cwd(), 'storage', 'courseware', newUuid);
                copyFolderSync(storageDir, newStorageDir);
                fs.writeFileSync(path.join(newStorageDir, entry), modified);

                db.prepare(
                  'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
                ).run(newCwId, newUuid, `[自动提交版] ${name}`, 'folder', entry, Date.now() + 10);

                await eventBus.publish({
                  id: uuidv7(),
                  type: 'courseware.confirmed',
                  source: 'builtin.courseware',
                  payload: { id: newCwId, uuid: newUuid, name: `[自动提交版] ${name}`, entry },
                  timestamp: Date.now() + 10,
                  correlationId: command.id
                });
              }
            }
          }
        } catch (aiErr) {
          console.error('Failed to create AI auto-submit version for manual confirm:', aiErr);
        }

        return { success: true, id: coursewareId, uuid, name, entry };
      }
    });

    // --- COURSEWARE SUBMIT ATTEMPT HANDLER ---
    const submitAttemptCmdType = 'courseware.submit_attempt';
    await actionRegistry.register({
      id: 'core-courseware-submit-attempt',
      commandType: submitAttemptCmdType,
      description: '提交或记录学生课件运行的进度/结果',
      capabilityRequired: 'student:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          attemptId: { type: 'STRING', description: '尝试 ID' },
          score: { type: 'NUMBER', description: '分数（满分 100）' },
          comment: { type: 'STRING', description: 'LMS 或教师评语' },
          completion: { type: 'NUMBER', description: '完成状态（0 到 1）' },
          status: { type: 'STRING', description: '尝试状态：active（进行中）或 completed（已完成）' },
          extra: { type: 'OBJECT', description: '额外参数' }
        },
        required: ['attemptId']
      }
    });

    await commandBus.registerHandler(submitAttemptCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { attemptId, score, comment, completion, status, extra = {} } = payload;

        // 1. Log to raw submission
        const rawId = 'raw_' + crypto.randomBytes(8).toString('hex');
        db.prepare(
          'INSERT INTO submission_raw (id, attempt_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(rawId, attemptId, 'submit_lms', JSON.stringify({ score, comment, completion, status, ...extra }), Date.now());

        // 2. Update status of the attempt
        if (status === 'completed') {
          db.prepare('UPDATE courseware_attempt SET finished_at = ?, status = ? WHERE id = ?')
            .run(Date.now(), 'completed', attemptId);
        }

        // 3. Update standardized results
        const existing = db.prepare('SELECT * FROM submission_result WHERE attempt_id = ?').get(attemptId) as any;
        if (!existing) {
          db.prepare(
            'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            'res_' + crypto.randomBytes(8).toString('hex'),
            attemptId,
            score !== undefined ? score : null,
            comment || null,
            completion !== undefined ? completion : null,
            JSON.stringify(extra)
          );
        } else {
          const finalScore = score !== undefined ? score : existing.score;
          const finalComment = comment || existing.comment;
          const finalCompletion = completion !== undefined ? completion : existing.completion;
          
          let mergedExtra = {};
          try {
            mergedExtra = JSON.parse(existing.extra_json || '{}');
          } catch (e) {}
          mergedExtra = { ...mergedExtra, ...extra };

          db.prepare(
            'UPDATE submission_result SET score = ?, comment = ?, completion = ?, extra_json = ? WHERE attempt_id = ?'
          ).run(finalScore, finalComment, finalCompletion, JSON.stringify(mergedExtra), attemptId);
        }

        await eventBus.publish({
          id: uuidv7(),
          type: 'courseware.attempt_submitted',
          source: 'builtin.courseware',
          payload: { attemptId, score, comment, completion, status },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true };
      }
    });

    // --- COURSEWARE GET RAW DATA HANDLER ---
    const getAttemptRawDataCmdType = 'courseware.get_attempt_raw_data';
    await actionRegistry.register({
      id: 'core-courseware-get-attempt-raw-data',
      commandType: getAttemptRawDataCmdType,
      description: 'Get all captured raw events/submits for a student attempt',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          attemptId: { type: 'STRING', description: 'ID of the attempt to query' }
        },
        required: ['attemptId']
      }
    });

    await commandBus.registerHandler(getAttemptRawDataCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { attemptId } = payload;
        const rows = db.prepare('SELECT * FROM submission_raw WHERE attempt_id = ? ORDER BY created_at ASC').all(attemptId);
        return rows;
      }
    });

    // --- COURSEWARE LIST HANDLER ---
    const listCoursewareCmdType = 'courseware.list';
    await actionRegistry.register({
      id: 'core-courseware-list',
      commandType: listCoursewareCmdType,
      description: 'List all uploaded interactive coursewares',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {}
      }
    });

    await commandBus.registerHandler(listCoursewareCmdType, {
      async execute() {
        const rows = db.prepare('SELECT * FROM courseware ORDER BY created_at DESC').all();
        return rows;
      }
    });

    // --- COURSEWARE DELETE HANDLER ---
    const deleteCoursewareCmdType = 'courseware.delete';
    await actionRegistry.register({
      id: 'core-courseware-delete',
      commandType: deleteCoursewareCmdType,
      description: 'Delete a courseware and remove all its local files',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'ID of the courseware to delete' }
        },
        required: ['id']
      }
    });

    await commandBus.registerHandler(deleteCoursewareCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const { id } = payload;
        const courseware = db.prepare('SELECT uuid FROM courseware WHERE id = ?').get(id) as any;
        if (courseware) {
          db.prepare('DELETE FROM courseware WHERE id = ?').run(id);
          const storageDir = path.resolve(process.cwd(), 'storage', 'courseware', courseware.uuid);
          if (fs.existsSync(storageDir)) {
            fs.rmSync(storageDir, { recursive: true, force: true });
          }
          await eventBus.publish({
            id: uuidv7(),
            type: 'courseware.deleted',
            source: 'builtin.courseware',
            payload: { id },
            timestamp: Date.now(),
            correlationId: command.id
          });
        }
        return { success: true };
      }
    });
  },
  deactivate: async () => {
    // Cleanups automatically handled by ResourceTracker
  }
};

