import { kernelContainer } from '../core/kernel/index.js';
import { v7 as uuidv7 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { hasDataSubmission, hasScoreDisplay, injectScoreSubmissionUsingAI } from './ai-submit-injector.js';


export function bootstrapBuiltinPlugins() {
  const { commandBus, actionRegistry, db, eventBus } = kernelContainer;

  // 1. LESSON HANDLER
  const createLessonCmdType = 'lesson.create';
  actionRegistry.register({
    id: 'core-lesson-create',
    commandType: createLessonCmdType,
    description: 'Create a new lesson with title and optional initial content',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Title of the lesson' },
        content: { type: 'STRING', description: 'Initial markdown content of the lesson. Please generate a short introductory paragraph or syllabus.' }
      },
      required: ['title', 'content']
    }
  });

  commandBus.registerHandler(createLessonCmdType, {
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
  actionRegistry.register({
    id: 'core-lesson-update',
    commandType: updateLessonCmdType,
    description: 'Update the content of an existing lesson',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID of the lesson to update' },
        content: { type: 'STRING', description: 'New markdown content of the lesson.' }
      },
      required: ['lessonId', 'content']
    }
  });

  commandBus.registerHandler(updateLessonCmdType, {
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
  actionRegistry.register({
    id: 'core-lesson-update-timeline',
    commandType: updateTimelineCmdType,
    description: 'Set or update the complete timeline segment list of a lesson (环节表更新)',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID of the lesson to update' },
        timeline: { type: 'STRING', description: 'JSON string or array of timeline segments' }
      },
      required: ['lessonId', 'timeline']
    }
  });

  commandBus.registerHandler(updateTimelineCmdType, {
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
  actionRegistry.register({
    id: 'core-lesson-add-segment',
    commandType: addSegmentCmdType,
    description: 'Add a single segment/phase to the lesson timeline (e.g. Lecture, Interactive Practice, Quiz, Break)',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID of the lesson to edit' },
        title: { type: 'STRING', description: 'Title of this segment' },
        duration: { type: 'STRING', description: 'Duration of this segment (e.g., 10m, 15m, 5m)' },
        type: { type: 'STRING', description: 'Type of activity (lecture, practice, quiz, break)' },
        notes: { type: 'STRING', description: 'Optional instruction guide, prompts or whiteboard directives for this Segment' },
        color: { type: 'STRING', description: 'Optional Tailwind background border class or color name' },
        index: { type: 'INTEGER', description: 'Insert index position (optional, defaults to adding at the end)' }
      },
      required: ['lessonId', 'title', 'duration', 'type']
    }
  });

  commandBus.registerHandler(addSegmentCmdType, {
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
  actionRegistry.register({
    id: 'core-lesson-remove-segment',
    commandType: removeSegmentCmdType,
    description: 'Remove high-level timetable segments from a lesson timeline by ID or Index',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID of the lesson to edit' },
        segmentId: { type: 'STRING', description: 'ID of the segment to remove (required if index is omitted)' },
        index: { type: 'INTEGER', description: 'Index position of the segment to remove (required if segmentId is omitted)' }
      },
      required: ['lessonId']
    }
  });

  commandBus.registerHandler(removeSegmentCmdType, {
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
  actionRegistry.register({
    id: 'core-lesson-delete',
    commandType: deleteLessonCmdType,
    description: 'Delete a lesson. This is a high-risk operation.',
    capabilityRequired: 'lesson:delete',
    isHighRisk: true,
    inputSchema: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID of the lesson to delete' }
      },
      required: ['lessonId']
    }
  });

  commandBus.registerHandler(deleteLessonCmdType, {
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
  actionRegistry.register({
    id: 'core-whiteboard-draw',
    commandType: drawWhiteboardCmdType,
    description: 'Draw an element (shape, text) on the whiteboard for a given lesson',
    capabilityRequired: 'whiteboard:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID of the lesson to attach the drawing to' },
        type: { type: 'STRING', description: 'Type of element: rectangle, circle, text' },
        data: { type: 'STRING', description: 'JSON string of the element configuration (e.g. dimensions, color, text)' }
      },
      required: ['lessonId', 'type', 'data']
    }
  });

  commandBus.registerHandler(drawWhiteboardCmdType, {
    async execute(command) {
      const payload = command.payload as any;
      const elementId = uuidv7();

      const stmt = db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)');
      stmt.run(elementId, payload.lessonId, payload.type, payload.data, Date.now());

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
  actionRegistry.register({
    id: 'core-whiteboard-update',
    commandType: updateWhiteboardCmdType,
    description: 'Update an existing element on the whiteboard',
    capabilityRequired: 'whiteboard:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID of the lesson' },
        elementId: { type: 'STRING', description: 'ID of the element' },
        data: { type: 'STRING', description: 'New JSON string of the element configuration' }
      },
      required: ['lessonId', 'elementId', 'data']
    }
  });

  commandBus.registerHandler(updateWhiteboardCmdType, {
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
  actionRegistry.register({
    id: 'core-whiteboard-delete',
    commandType: deleteWhiteboardCmdType,
    description: 'Delete an existing element from the whiteboard',
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

  commandBus.registerHandler(deleteWhiteboardCmdType, {
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
  actionRegistry.register({
    id: 'core-whiteboard-clear',
    commandType: clearWhiteboardCmdType,
    description: 'Clear all elements from the whiteboard for a given lesson',
    capabilityRequired: 'whiteboard:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        lessonId: { type: 'STRING', description: 'ID of the lesson' }
      },
      required: ['lessonId']
    }
  });

  commandBus.registerHandler(clearWhiteboardCmdType, {
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
  actionRegistry.register({
    id: 'core-plugin-install',
    commandType: installPluginCmdType,
    description: 'Install a custom JavaScript plugin source code. This is a high-risk operation.',
    capabilityRequired: 'plugin:write',
    isHighRisk: true,
    inputSchema: {
      type: 'OBJECT',
      properties: {
        sourceCode: { type: 'STRING', description: 'The complete JavaScript source code of the plugin.' }
      },
      required: ['sourceCode']
    }
  });

  commandBus.registerHandler(installPluginCmdType, {
    async execute(command) {
      const payload = command.payload as any;
      const manifest = await kernelContainer.pluginRuntime.installPlugin(payload.sourceCode);
      return { success: true, manifest };
    }
  });

  // 7. PLUGIN TOGGLE HANDLER
  const togglePluginCmdType = 'plugin.toggle';
  actionRegistry.register({
    id: 'core-plugin-toggle',
    commandType: togglePluginCmdType,
    description: 'Toggle the status of an installed plugin between active and disabled. This is a high-risk operation.',
    capabilityRequired: 'plugin:write',
    isHighRisk: true,
    inputSchema: {
      type: 'OBJECT',
      properties: {
        pluginId: { type: 'STRING', description: 'The unique database ID of the plugin.' }
      },
      required: ['pluginId']
    }
  });

  commandBus.registerHandler(togglePluginCmdType, {
    async execute(command) {
      const payload = command.payload as any;
      const newStatus = await kernelContainer.pluginRuntime.togglePlugin(payload.pluginId);
      return { success: true, status: newStatus };
    }
  });

  // 8. USER LIST HANDLER
  const listUsersCmdType = 'user.list';
  actionRegistry.register({
    id: 'core-user-list',
    commandType: listUsersCmdType,
    description: 'List all registered teacher and administrator accounts',
    capabilityRequired: 'management:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        role: { type: 'STRING', description: 'Filter by role: administrator or teacher (optional)' }
      }
    }
  });

  commandBus.registerHandler(listUsersCmdType, {
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
  actionRegistry.register({
    id: 'core-user-create',
    commandType: createUserCmdType,
    description: 'Create a new teacher or administrator account',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        username: { type: 'STRING', description: 'Unique username for login' },
        password: { type: 'STRING', description: 'Plaintext login password' },
        role: { type: 'STRING', description: 'Role of the user: administrator or teacher' },
        name: { type: 'STRING', description: 'Display name of the user' },
        status: { type: 'STRING', description: 'Initial status: active or disabled (optional)' }
      },
      required: ['username', 'password', 'role', 'name']
    }
  });

  commandBus.registerHandler(createUserCmdType, {
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
  actionRegistry.register({
    id: 'core-user-update',
    commandType: updateUserCmdType,
    description: 'Update an existing user account details',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        userId: { type: 'STRING', description: 'The unique ID of the user to update' },
        username: { type: 'STRING', description: 'New username (optional)' },
        password: { type: 'STRING', description: 'New plaintext password to update (optional)' },
        role: { type: 'STRING', description: 'New role: administrator or teacher (optional)' },
        name: { type: 'STRING', description: 'New display name (optional)' },
        status: { type: 'STRING', description: 'New status: active or disabled (optional)' }
      },
      required: ['userId']
    }
  });

  commandBus.registerHandler(updateUserCmdType, {
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
  actionRegistry.register({
    id: 'core-user-delete',
    commandType: deleteUserCmdType,
    description: 'Delete a user account. This is a high-risk operation.',
    capabilityRequired: 'management:write',
    isHighRisk: true,
    inputSchema: {
      type: 'OBJECT',
      properties: {
        userId: { type: 'STRING', description: 'The unique ID of the user to delete' }
      },
      required: ['userId']
    }
  });

  commandBus.registerHandler(deleteUserCmdType, {
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

  // --- COURSEWARE UPLOAD HANDLER ---
  const uploadCoursewareCmdType = 'courseware.upload';
  actionRegistry.register({
    id: 'core-courseware-upload',
    commandType: uploadCoursewareCmdType,
    description: 'Upload a single HTML page or a ZIP package of interactive courseware',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Name of the courseware' },
        filename: { type: 'STRING', description: 'Filename of the uploaded file' },
        base64Data: { type: 'STRING', description: 'Base64 data of the file (can start with data:URI prefix)' }
      },
      required: ['name', 'filename', 'base64Data']
    }
  });

  commandBus.registerHandler(uploadCoursewareCmdType, {
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
        // Zip file unzipping
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
        // First, check index.html, main.html, lesson.html
        const primaryCandidates = files.filter(f => {
          const base = path.basename(f).toLowerCase();
          return base === 'index.html' || base === 'index.htm' || base === 'main.html' || base === 'lesson.html';
        });

        let entry = '';
        if (primaryCandidates.length === 1) {
          entry = primaryCandidates[0];
        } else if (primaryCandidates.length > 1) {
          // Check if there is an exact match for index.html at root
          const rootIndex = primaryCandidates.find(f => f.toLowerCase() === 'index.html');
          if (rootIndex) {
            entry = rootIndex;
          }
        }

        // If no primary candidates, search for any HTML files
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
          // Automatic entry selection
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
          // Let teacher choose from allHtmlCandidates
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
  actionRegistry.register({
    id: 'core-courseware-confirm',
    commandType: confirmCoursewareCmdType,
    description: 'Confirm selection of entry page for a ZIP courseware package',
    capabilityRequired: 'lesson:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        uuid: { type: 'STRING', description: 'Generated UUID of the uploaded courseware' },
        name: { type: 'STRING', description: 'Name of the courseware' },
        entry: { type: 'STRING', description: 'Selected entry HTML file path' }
      },
      required: ['uuid', 'name', 'entry']
    }
  });

  commandBus.registerHandler(confirmCoursewareCmdType, {
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
  actionRegistry.register({
    id: 'core-courseware-submit-attempt',
    commandType: submitAttemptCmdType,
    description: 'Submit or record progress/results from a student courseware run',
    capabilityRequired: 'student:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        attemptId: { type: 'STRING', description: 'ID of the attempt' },
        score: { type: 'NUMBER', description: 'Score out of 100' },
        comment: { type: 'STRING', description: 'LMS or teacher comment' },
        completion: { type: 'NUMBER', description: 'Completion status (0 to 1)' },
        status: { type: 'STRING', description: 'Attempt status: active or completed' },
        extra: { type: 'OBJECT', description: 'Extra parameters' }
      },
      required: ['attemptId']
    }
  });

  commandBus.registerHandler(submitAttemptCmdType, {
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
  actionRegistry.register({
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

  commandBus.registerHandler(getAttemptRawDataCmdType, {
    async execute(command) {
      const payload = command.payload as any;
      const { attemptId } = payload;
      const rows = db.prepare('SELECT * FROM submission_raw WHERE attempt_id = ? ORDER BY created_at ASC').all(attemptId);
      return rows;
    }
  });

  // --- COURSEWARE LIST HANDLER ---
  const listCoursewareCmdType = 'courseware.list';
  actionRegistry.register({
    id: 'core-courseware-list',
    commandType: listCoursewareCmdType,
    description: 'List all uploaded interactive coursewares',
    capabilityRequired: 'lesson:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {}
    }
  });

  commandBus.registerHandler(listCoursewareCmdType, {
    async execute(command) {
      const rows = db.prepare('SELECT * FROM courseware ORDER BY created_at DESC').all();
      return rows;
    }
  });

  // --- COURSEWARE DELETE HANDLER ---
  const deleteCoursewareCmdType = 'courseware.delete';
  actionRegistry.register({
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

  commandBus.registerHandler(deleteCoursewareCmdType, {
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
}
