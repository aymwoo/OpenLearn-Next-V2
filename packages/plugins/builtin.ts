import { kernelContainer } from '../core/kernel/index.js';
import { v7 as uuidv7 } from 'uuid';

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
}
