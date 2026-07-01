/**
 * ext-student-groups — 学生分组管理插件
 *
 * 功能：
 * - 学生自行创建小组，其他同学加入
 * - 老师手动分配小组
 * - 老师一键自动随机分配小组
 * - 任命/更换组长
 * - 课堂工具栏快速入口
 * - AI Agent 可调用全部分组命令
 */
import type Database from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { IDatabaseToken } from '../../core/di/interfaces.js';
import type { PluginContext } from '../../core/plugin-host/types.js';

// ── 类型定义 ──────────────────────────────────────────────────────────────

interface StudentGroup {
  id: string;
  class_id: string;
  name: string;
  description: string;
  created_by: string;        // actorId，'student:<id>' 或 'teacher:<id>'
  created_by_name: string;    // 创建者显示名
  created_at: number;
}

interface GroupMember {
  group_id: string;
  student_id: string;
  student_name: string;
  role: 'leader' | 'member';
  joined_at: number;
}

// ── 表名前缀（由 ctx.db.table 自动添加前缀） ──────────────────────────────

let GROUPS_TABLE = '';
let MEMBERS_TABLE = '';

// ── 辅助函数：安全获取数据库 ──────────────────────────────────────────────

let _db: Database.Database | null = null;
async function getDb(ctx: PluginContext): Promise<Database.Database> {
  if (!_db) {
    _db = await ctx.resolve(IDatabaseToken) as Database.Database;
  }
  return _db;
}

// ── 激活入口 ──────────────────────────────────────────────────────────────

export default {
  manifest: {
    id: 'ext-student-groups',
    name: '学生分组管理',
    version: '1.0.0',
    main: 'index.js',
    description: '学生分组管理，支持自建小组/老师分配/自动分组/组长任命',
    author: 'Edu-OS 插件生态社区',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:IStorageService@^1.0.0',
    ],
    capabilitiesProposed: ['management:read', 'management:write'],
    classroomTools: [
      {
        id: 'tool-group-create',
        name: '创建小组',
        icon: 'Users',
        description: '在当前班级中手动创建一个新的学生小组',
        commandType: 'group.create',
        payload: { classId: '$classId', name: '', description: '教师手动创建' },
      },
      {
        id: 'tool-group-auto-assign',
        name: '自动分组',
        icon: 'Shuffle',
        description: '将当前班级学生随机自动分配到小组',
        commandType: 'group.auto_assign',
        payload: { classId: '$classId', groupCount: 4, strategy: 'random' },
      },
      {
        id: 'tool-group-list',
        name: '查看分组',
        icon: 'List',
        description: '查看当前班级所有小组及成员',
        commandType: 'group.list',
        payload: { classId: '$classId' },
      },
    ],
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;

    // 初始化表名（使用平台前缀确保隔离）
    GROUPS_TABLE = ctx.db.table('student_groups');
    MEMBERS_TABLE = ctx.db.table('student_group_members');

    // 创建数据库表
    await ctx.db.ensureTable('student_groups', [
      'id TEXT PRIMARY KEY',
      'class_id TEXT NOT NULL',
      'name TEXT NOT NULL',
      'description TEXT DEFAULT \'\'',
      'created_by TEXT NOT NULL',
      'created_by_name TEXT DEFAULT \'\'',
      'created_at INTEGER NOT NULL',
    ].join(', '));
    await ctx.db.ensureTable('student_group_members', [
      'group_id TEXT NOT NULL',
      'student_id TEXT NOT NULL',
      'student_name TEXT DEFAULT \'\'',
      'role TEXT NOT NULL DEFAULT \'member\'',
      'joined_at INTEGER NOT NULL',
      'PRIMARY KEY (group_id, student_id)',
    ].join(', '));

    console.log(`[ext-student-groups] Tables created: ${GROUPS_TABLE}, ${MEMBERS_TABLE}`);

    // ═══════════════════════════════════════════════════════════════════════
    // 1. group.create — 创建小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-create',
      commandType: 'group.create',
      description:
        '创建一个新的学生小组。学生可自行创建（自己自动加入），教师可为班级创建小组。',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          name: { type: 'STRING', description: '小组名称（如 "第一组"、"数学兴趣组"）' },
          description: { type: 'STRING', description: '小组描述（可选）' },
        },
        required: ['classId', 'name'],
      },
    });

    await commandBus.registerHandler('group.create', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);
        const actorId = command.actorId || 'system';

        const groupId = uuidv7();
        const now = Date.now();

        // 获取创建者名称
        let createdByName = actorId;
        if (actorId.startsWith('student:')) {
          const studentId = actorId.replace('student:', '');
          const student = db.prepare('SELECT name FROM students WHERE id = ?').get(studentId) as any;
          if (student) createdByName = student.name;
        } else if (actorId.startsWith('user:')) {
          const userId = actorId.replace('user:', '');
          const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as any;
          if (user) createdByName = user.name;
        }

        db.prepare(
          `INSERT INTO ${GROUPS_TABLE} (id, class_id, name, description, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(groupId, payload.classId, payload.name, payload.description || '', actorId, createdByName, now);

        await eventBus.publish({
          id: uuidv7(),
          type: 'group.created',
          source: 'ext-student-groups',
          payload: { groupId, classId: payload.classId, name: payload.name, createdBy: actorId },
          timestamp: now,
          correlationId: command.id,
        });

        return { success: true, groupId, name: payload.name };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. group.join — 学生加入小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-join',
      commandType: 'group.join',
      description: '学生加入指定的已有小组',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'STRING', description: '要加入的小组 ID' },
          studentId: { type: 'STRING', description: '学生的 ID' },
          studentName: { type: 'STRING', description: '学生姓名（可选，自动从数据库获取）' },
        },
        required: ['groupId', 'studentId'],
      },
    });

    await commandBus.registerHandler('group.join', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);
        const now = Date.now();

        // 检查小组是否存在
        const group = db.prepare(`SELECT * FROM ${GROUPS_TABLE} WHERE id = ?`).get(payload.groupId) as any;
        if (!group) {
          throw new Error(`小组 ${payload.groupId} 不存在`);
        }

        // 获取学生姓名
        let studentName = payload.studentName || '';
        if (!studentName) {
          const student = db.prepare('SELECT name FROM students WHERE id = ?').get(payload.studentId) as any;
          if (student) studentName = student.name;
        }

        // 检查是否已在小组中
        const existing = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`,
        ).get(payload.groupId, payload.studentId);
        if (existing) {
          throw new Error(`学生 ${studentName || payload.studentId} 已在该小组中`);
        }

        // 检查学生是否已在同一班级的其他小组中
        const otherGroup = db.prepare(`
          SELECT m.* FROM ${MEMBERS_TABLE} m
          JOIN ${GROUPS_TABLE} g ON m.group_id = g.id
          WHERE m.student_id = ? AND g.class_id = ?
        `).get(payload.studentId, group.class_id);
        if (otherGroup) {
          // 先从旧小组中移除
          db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`).run(
            (otherGroup as any).group_id, payload.studentId,
          );
        }

        // 加入新小组（第一个成员自动成为组长）
        const memberCount = db.prepare(
          `SELECT COUNT(*) as count FROM ${MEMBERS_TABLE} WHERE group_id = ?`,
        ).get(payload.groupId) as any;
        const role = memberCount.count === 0 ? 'leader' : 'member';

        db.prepare(
          `INSERT INTO ${MEMBERS_TABLE} (group_id, student_id, student_name, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(payload.groupId, payload.studentId, studentName, role, now);

        await eventBus.publish({
          id: uuidv7(),
          type: 'group.member_joined',
          source: 'ext-student-groups',
          payload: {
            groupId: payload.groupId,
            classId: group.class_id,
            studentId: payload.studentId,
            studentName,
            role,
          },
          timestamp: now,
          correlationId: command.id,
        });

        return {
          success: true,
          groupId: payload.groupId,
          studentId: payload.studentId,
          studentName,
          role,
          message: `学生 ${studentName || payload.studentId} 已加入小组「${group.name}」${role === 'leader' ? '，并自动成为组长' : ''}`,
        };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. group.leave — 学生退出小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-leave',
      commandType: 'group.leave',
      description: '学生退出当前所在小组',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'STRING', description: '小组 ID' },
          studentId: { type: 'STRING', description: '学生 ID' },
        },
        required: ['groupId', 'studentId'],
      },
    });

    await commandBus.registerHandler('group.leave', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);
        const now = Date.now();

        const member = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`,
        ).get(payload.groupId, payload.studentId) as any;
        if (!member) {
          throw new Error('该学生不在该小组中');
        }

        db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`).run(
          payload.groupId, payload.studentId,
        );

        // 如果退出的成员是组长，将组长转移给下一个成员
        if (member.role === 'leader') {
          const nextMember = db.prepare(
            `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? ORDER BY joined_at ASC LIMIT 1`,
          ).get(payload.groupId) as any;
          if (nextMember) {
            db.prepare(`UPDATE ${MEMBERS_TABLE} SET role = 'leader' WHERE group_id = ? AND student_id = ?`).run(
              payload.groupId, nextMember.student_id,
            );
          }
        }

        await eventBus.publish({
          id: uuidv7(),
          type: 'group.member_left',
          source: 'ext-student-groups',
          payload: { groupId: payload.groupId, studentId: payload.studentId, wasLeader: member.role === 'leader' },
          timestamp: now,
          correlationId: command.id,
        });

        return { success: true, message: '已退出小组' };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. group.assign_leader — 任命/更换组长
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-assign-leader',
      commandType: 'group.assign_leader',
      description: '任命指定学生为小组组长（原组长降为普通成员）',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'STRING', description: '小组 ID' },
          studentId: { type: 'STRING', description: '要任命为组长的学生 ID' },
        },
        required: ['groupId', 'studentId'],
      },
    });

    await commandBus.registerHandler('group.assign_leader', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);
        const now = Date.now();

        // 检查该学生是否在小组中
        const member = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`,
        ).get(payload.groupId, payload.studentId) as any;
        if (!member) {
          throw new Error('该学生不在该小组中');
        }

        // 将所有成员设为 member
        db.prepare(`UPDATE ${MEMBERS_TABLE} SET role = 'member' WHERE group_id = ?`).run(payload.groupId);

        // 将指定学生设为 leader
        db.prepare(`UPDATE ${MEMBERS_TABLE} SET role = 'leader' WHERE group_id = ? AND student_id = ?`).run(
          payload.groupId, payload.studentId,
        );

        const group = db.prepare(`SELECT name FROM ${GROUPS_TABLE} WHERE id = ?`).get(payload.groupId) as any;

        await eventBus.publish({
          id: uuidv7(),
          type: 'group.leader_assigned',
          source: 'ext-student-groups',
          payload: { groupId: payload.groupId, studentId: payload.studentId, studentName: member.student_name },
          timestamp: now,
          correlationId: command.id,
        });

        return {
          success: true,
          message: `已将 ${member.student_name || payload.studentId} 任命为小组「${group?.name || payload.groupId}」的组长`,
        };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 5. group.auto_assign — 自动随机分配小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-auto-assign',
      commandType: 'group.auto_assign',
      description:
        '自动将班级中的所有学生随机分配到指定数量的小组。可选清空现有分组后重新分配。',
      capabilityRequired: 'management:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          groupCount: { type: 'INTEGER', description: '分组数量（默认 4 组）' },
          strategy: { type: 'STRING', description: '分配策略：random（随机）或 balanced（均衡）（可选，默认 random）' },
          clearExisting: { type: 'BOOLEAN', description: '是否清空该班级现有分组后重新分配（可选，默认 true）' },
        },
        required: ['classId'],
      },
    });

    await commandBus.registerHandler('group.auto_assign', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);
        const now = Date.now();

        const groupCount = payload.groupCount || 4;
        const strategy = payload.strategy || 'random';
        const clearExisting = payload.clearExisting !== false;

        // 获取班级学生
        let students: any[] = [];
        try {
          const result = await commandBus.execute({
            id: uuidv7(),
            type: 'class.get_students',
            actorId: 'plugin-ext-student-groups',
            payload: { classId: payload.classId },
            timestamp: Date.now(),
          });
          if (result && (result as any).students) {
            students = (result as any).students;
          }
        } catch (e) {
          console.error('[ext-student-groups] 获取班级学生失败:', e);
          throw new Error('无法获取班级学生列表');
        }

        if (students.length === 0) {
          throw new Error('该班级中没有学生，无法分组');
        }

        if (groupCount > students.length) {
          throw new Error(`分组数量（${groupCount}）不能超过学生人数（${students.length}）`);
        }

        if (groupCount < 1) {
          throw new Error('分组数量至少为 1');
        }

        // 清空现有分组
        if (clearExisting) {
          const oldGroups = db.prepare(`SELECT id FROM ${GROUPS_TABLE} WHERE class_id = ?`).all(payload.classId) as any[];
          for (const g of oldGroups) {
            db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ?`).run(g.id);
          }
          db.prepare(`DELETE FROM ${GROUPS_TABLE} WHERE class_id = ?`).run(payload.classId);
        }

        // 打乱学生顺序（Fisher-Yates 洗牌）
        const shuffled = [...students];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // 创建小组并分配学生
        const groupIds: string[] = [];
        const groupNames: string[] = [];
        for (let i = 0; i < groupCount; i++) {
          const groupId = uuidv7();
          const groupName = `第${i + 1}组`;
          groupIds.push(groupId);
          groupNames.push(groupName);

          db.prepare(
            `INSERT INTO ${GROUPS_TABLE} (id, class_id, name, description, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(groupId, payload.classId, groupName, '系统自动分组', 'system', '系统自动分配', now);
        }

        // 将打乱后的学生分配到各组
        const assignments: Array<{ groupId: string; groupName: string; studentId: string; studentName: string; isLeader: boolean }> = [];
        for (let i = 0; i < shuffled.length; i++) {
          const groupIndex = i % groupCount;
          const student = shuffled[i];
          const isFirstInGroup = i < groupCount; // 每组第一个学生自动成为组长
          const role = isFirstInGroup ? 'leader' : 'member';

          db.prepare(
            `INSERT INTO ${MEMBERS_TABLE} (group_id, student_id, student_name, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
          ).run(groupIds[groupIndex], student.id, student.name, role, now);

          assignments.push({
            groupId: groupIds[groupIndex],
            groupName: groupNames[groupIndex],
            studentId: student.id,
            studentName: student.name,
            isLeader: isFirstInGroup,
          });
        }

        await eventBus.publish({
          id: uuidv7(),
          type: 'group.auto_assigned',
          source: 'ext-student-groups',
          payload: {
            classId: payload.classId,
            groupCount,
            studentCount: students.length,
            strategy,
          },
          timestamp: now,
          correlationId: command.id,
        });

        return {
          success: true,
          groupCount,
          studentCount: students.length,
          strategy,
          groups: groupIds.map((id, i) => ({ id, name: groupNames[i] })),
          assignments: assignments.map(a => ({
            groupName: a.groupName,
            studentName: a.studentName,
            isLeader: a.isLeader,
          })),
          message: `已将 ${students.length} 名学生随机分配到 ${groupCount} 个小组`,
        };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 6. group.list — 列出班级所有小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-list',
      commandType: 'group.list',
      description: '列出指定班级的所有小组及其成员',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
        },
        required: ['classId'],
      },
    });

    await commandBus.registerHandler('group.list', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);

        const groups = db.prepare(
          `SELECT * FROM ${GROUPS_TABLE} WHERE class_id = ? ORDER BY created_at ASC`,
        ).all(payload.classId) as StudentGroup[];

        const result = [];
        for (const group of groups) {
          const members = db.prepare(
            `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? ORDER BY role DESC, joined_at ASC`,
          ).all(group.id) as GroupMember[];
          result.push({ ...group, members, memberCount: members.length });
        }

        return { success: true, classId: payload.classId, groups: result, totalGroups: result.length };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 7. group.get_members — 获取小组成员
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-get-members',
      commandType: 'group.get_members',
      description: '获取指定小组的所有成员信息',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'STRING', description: '小组 ID' },
        },
        required: ['groupId'],
      },
    });

    await commandBus.registerHandler('group.get_members', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);

        const group = db.prepare(`SELECT * FROM ${GROUPS_TABLE} WHERE id = ?`).get(payload.groupId) as any;
        if (!group) {
          throw new Error(`小组 ${payload.groupId} 不存在`);
        }

        const members = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? ORDER BY role DESC, joined_at ASC`,
        ).all(payload.groupId) as GroupMember[];

        return { success: true, group, members, memberCount: members.length };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 8. group.delete — 删除小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-delete',
      commandType: 'group.delete',
      description: '删除指定小组及其所有成员关系（高风险操作）',
      capabilityRequired: 'management:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'STRING', description: '要删除的小组 ID' },
        },
        required: ['groupId'],
      },
    });

    await commandBus.registerHandler('group.delete', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);
        const now = Date.now();

        const group = db.prepare(`SELECT * FROM ${GROUPS_TABLE} WHERE id = ?`).get(payload.groupId) as any;
        if (!group) {
          throw new Error(`小组 ${payload.groupId} 不存在`);
        }

        db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ?`).run(payload.groupId);
        db.prepare(`DELETE FROM ${GROUPS_TABLE} WHERE id = ?`).run(payload.groupId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'group.deleted',
          source: 'ext-student-groups',
          payload: { groupId: payload.groupId, classId: group.class_id, name: group.name },
          timestamp: now,
          correlationId: command.id,
        });

        return { success: true, message: `小组「${group.name}」已删除` };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 9. group.kick — 踢出成员
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-kick',
      commandType: 'group.kick',
      description: '将指定学生从小组中移除（踢出）',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'STRING', description: '小组 ID' },
          studentId: { type: 'STRING', description: '要移除的学生 ID' },
        },
        required: ['groupId', 'studentId'],
      },
    });

    await commandBus.registerHandler('group.kick', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);
        const now = Date.now();

        const member = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`,
        ).get(payload.groupId, payload.studentId) as any;
        if (!member) {
          throw new Error('该学生不在该小组中');
        }

        db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`).run(
          payload.groupId, payload.studentId,
        );

        // 如果踢出的是组长，将组长转移给下一个成员
        if (member.role === 'leader') {
          const nextMember = db.prepare(
            `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? ORDER BY joined_at ASC LIMIT 1`,
          ).get(payload.groupId) as any;
          if (nextMember) {
            db.prepare(`UPDATE ${MEMBERS_TABLE} SET role = 'leader' WHERE group_id = ? AND student_id = ?`).run(
              payload.groupId, nextMember.student_id,
            );
          }
        }

        await eventBus.publish({
          id: uuidv7(),
          type: 'group.member_kicked',
          source: 'ext-student-groups',
          payload: { groupId: payload.groupId, studentId: payload.studentId, studentName: member.student_name },
          timestamp: now,
          correlationId: command.id,
        });

        return { success: true, message: `已将 ${member.student_name || payload.studentId} 从小组中移除` };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 10. group.get_student_group — 查询学生所属小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-get-student-group',
      commandType: 'group.get_student_group',
      description: '查询指定学生在某个班级中所属的小组',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          studentId: { type: 'STRING', description: '学生 ID' },
        },
        required: ['classId', 'studentId'],
      },
    });

    await commandBus.registerHandler('group.get_student_group', {
      async execute(command) {
        const payload = command.payload as any;
        const db = await getDb(ctx);

        const memberRow = db.prepare(`
          SELECT m.*, g.name as group_name, g.description as group_description
          FROM ${MEMBERS_TABLE} m
          JOIN ${GROUPS_TABLE} g ON m.group_id = g.id
          WHERE m.student_id = ? AND g.class_id = ?
        `).get(payload.studentId, payload.classId) as any;

        if (!memberRow) {
          return { success: true, group: null, message: '该学生尚未加入任何小组' };
        }

        return {
          success: true,
          group: {
            groupId: memberRow.group_id,
            groupName: memberRow.group_name,
            groupDescription: memberRow.group_description,
            role: memberRow.role,
            joinedAt: memberRow.joined_at,
          },
        };
      },
    });

    console.log('[ext-student-groups] 学生分组管理插件已激活（10 条命令已注册）');
  },
};
