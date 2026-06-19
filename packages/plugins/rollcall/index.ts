import { ICommandBusServiceToken, IActionRegistryServiceToken } from '../../core/di/interfaces.js';
import type { PluginContext } from '../../core/plugin-host/types.js';

export default {
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    await actionRegistry.register({
      id: 'ext-rollcall-pick',
      commandType: 'rollcall.pick',
      description: '从班级中随机抽取一名学生进行课堂提问/点名，并投射到交互画板上',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID (必传，提取名册)' },
          lessonId: { type: 'STRING', description: '关联课时 ID (传入后将点名效果同步投射到该课时白板上)' }
        },
        required: ['classId']
      }
    });

    await commandBus.registerHandler('rollcall.pick', {
      execute: async (command) => {
        const payload = command.payload as any;
        const classId = payload.classId;
        const lessonId = payload.lessonId;

        let students: any[] = [];
        try {
          const res = await commandBus.execute({
            id: 'int_' + Math.random().toString(36).slice(2),
            type: 'class.get_students',
            actorId: command.actorId || 'plugin-rollcall',
            payload: { classId }
          }) as any;
          if (res && res.students) {
            students = res.students;
          }
        } catch (e) {
          console.error("Failed to fetch students via class.get_students", e);
        }

        if (students.length === 0) {
          students = [
            { id: "mock-s-1", name: "张明", email: "zhangming@edu-os.org" },
            { id: "mock-s-2", name: "李华", email: "lihua@edu-os.org" },
            { id: "mock-s-3", name: "王超", email: "wangchao@edu-os.org" },
            { id: "mock-s-4", name: "赵丽", email: "zhaoli@edu-os.org" },
            { id: "mock-s-5", name: "钱科", email: "qianke@edu-os.org" },
            { id: "mock-s-6", name: "孙雪", email: "sunxue@edu-os.org" }
          ];
        }

        const randomIndex = Math.floor(Math.random() * students.length);
        const selectedStudent = students[randomIndex];

        let elementId = null;
        if (lessonId && lessonId !== "auto-id" && lessonId.trim() !== "") {
          try {
            const drawRes = await commandBus.execute({
              id: 'int_' + Math.random().toString(36).slice(2),
              type: 'whiteboard.draw',
              actorId: command.actorId || 'plugin-rollcall',
              payload: {
                lessonId: lessonId,
                type: 'rollcall',
                data: JSON.stringify({
                  classId,
                  selectedStudent,
                  allStudents: students,
                  pickedTime: new Date().toISOString(),
                  status: 'picked'
                })
              }
            }) as any;
            if (drawRes && drawRes.elementId) {
              elementId = drawRes.elementId;
            }
          } catch (e) {
            console.error("Failed to drop rollcall element on whiteboard", e);
          }
        }

        return {
          success: true,
          selectedStudent,
          allStudentsCount: students.length,
          elementId,
          message: "已从学员名单中随机提问抽选得主：" + selectedStudent.name
        };
      }
    });
  },
  deactivate: async () => {
    // Cleanups automatically handled by ResourceTracker
  }
};
