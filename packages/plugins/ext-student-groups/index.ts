/**
 * ext-student-groups — 学生分组管理插件
 *
 * 功能：
 * - 学生自行创建小组，其他同学加入（首成员自动成为组长）
 * - 教师手动分配 / 一键自动随机分配（Fisher-Yates 洗牌）
 * - 任命/更换组长，组长退出自动转移
 * - 同班级重复加入检测（自动从旧小组移出）
 * - 课堂工具栏快速入口 + AI Agent 可调用全部分组命令
 *
 * 自包含设计：无外部导入，所有依赖内联。
 */

// ── 内联 Token 定义（避免运行时导入依赖） ────────────────────────────────
const IDatabaseToken = {
  name: '@openlearn/core:IDatabase',
  version: '1.0.0',
};

// ── 内联 UUID 生成（简化版，uuid v7 风格：时间戳前缀 + 随机后缀） ────────
function generateId(): string {
  const timestamp = Date.now().toString(36).padStart(8, '0');
  const random1 = Math.random().toString(36).slice(2, 10).padStart(8, '0');
  const random2 = Math.random().toString(36).slice(2, 14).padStart(12, '0');
  return `${timestamp}-${random1.slice(0, 4)}-4${random1.slice(5, 8)}-${'89ab'.charAt(Math.floor(Math.random() * 4))}${random2.slice(1, 4)}-${random2.slice(4, 16)}`;
}

// ── 简化事件发布（避免依赖 eventBus 类型） ────────────────────────────────
function publishEvent(eventBus: any, type: string, source: string, payload: any, correlationId?: string) {
  eventBus.publish({
    id: generateId(),
    type,
    source,
    payload,
    timestamp: Date.now(),
    correlationId,
  }).catch(() => {}); // 事件发布失败不影响主流程
}

// ── 表名前缀存储 ──────────────────────────────────────────────────────────
let GROUPS_TABLE = '';
let MEMBERS_TABLE = '';

// ── 数据库缓存 ────────────────────────────────────────────────────────────
let _db: any = null;
async function getDb(ctx: any): Promise<any> {
  if (!_db) {
    _db = await ctx.resolve(IDatabaseToken);
  }
  return _db;
}

// ── 插件导出 ──────────────────────────────────────────────────────────────
export default {
  manifest: {
    id: 'ext-student-groups',
    name: '学生分组管理',
    version: '1.0.0',
    main: 'index.ts',
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

  activate: async (ctx: any) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;

    // 初始化表名（平台前缀确保隔离）
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

    console.log(`[ext-student-groups] Tables ready: ${GROUPS_TABLE}, ${MEMBERS_TABLE}`);

    // ═══════════════════════════════════════════════════════════════════════
    // 1. group.create — 创建小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-create',
      commandType: 'group.create',
      description: '创建一个新的学生小组。学生可自行创建（自己自动加入），教师可为班级创建小组。',
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
      async execute(command: any) {
        const payload = command.payload;
        const db = await getDb(ctx);
        const actorId = command.actorId || 'system';

        const groupId = generateId();
        const now = Date.now();

        let createdByName = actorId;
        if (actorId.startsWith('student:')) {
          const sid = actorId.replace('student:', '');
          const s = db.prepare('SELECT name FROM students WHERE id = ?').get(sid);
          if (s) createdByName = s.name;
        } else if (actorId.startsWith('user:')) {
          const uid = actorId.replace('user:', '');
          const u = db.prepare('SELECT name FROM users WHERE id = ?').get(uid);
          if (u) createdByName = u.name;
        }

        db.prepare(
          `INSERT INTO ${GROUPS_TABLE} (id, class_id, name, description, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(groupId, payload.classId, payload.name, payload.description || '', actorId, createdByName, now);

        publishEvent(eventBus, 'group.created', 'ext-student-groups',
          { groupId, classId: payload.classId, name: payload.name, createdBy: actorId }, command.id);

        return { success: true, groupId, name: payload.name };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. group.join — 加入小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-join',
      commandType: 'group.join',
      description: '学生加入指定的已有小组，第一个成员自动成为组长。若学生已在同班级其他小组，会自动移出。',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          groupId: { type: 'STRING', description: '要加入的小组 ID' },
          studentId: { type: 'STRING', description: '学生的 ID' },
          studentName: { type: 'STRING', description: '学生姓名（可选，自动获取）' },
        },
        required: ['groupId', 'studentId'],
      },
    });

    await commandBus.registerHandler('group.join', {
      async execute(command: any) {
        const payload = command.payload;
        const db = await getDb(ctx);
        const now = Date.now();

        const group = db.prepare(`SELECT * FROM ${GROUPS_TABLE} WHERE id = ?`).get(payload.groupId);
        if (!group) throw new Error(`小组 ${payload.groupId} 不存在`);

        let studentName = payload.studentName || '';
        if (!studentName) {
          const s = db.prepare('SELECT name FROM students WHERE id = ?').get(payload.studentId);
          if (s) studentName = s.name;
        }

        const existing = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`,
        ).get(payload.groupId, payload.studentId);
        if (existing) throw new Error(`学生 ${studentName || payload.studentId} 已在该小组中`);

        // 检查同班级其他小组并移出
        const otherGroup = db.prepare(`
          SELECT m.group_id FROM ${MEMBERS_TABLE} m
          JOIN ${GROUPS_TABLE} g ON m.group_id = g.id
          WHERE m.student_id = ? AND g.class_id = ?
        `).get(payload.studentId, group.class_id);
        if (otherGroup) {
          db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`).run(
            otherGroup.group_id, payload.studentId,
          );
        }

        const countRow: any = db.prepare(
          `SELECT COUNT(*) as cnt FROM ${MEMBERS_TABLE} WHERE group_id = ?`,
        ).get(payload.groupId);
        const role = countRow.cnt === 0 ? 'leader' : 'member';

        db.prepare(
          `INSERT INTO ${MEMBERS_TABLE} (group_id, student_id, student_name, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(payload.groupId, payload.studentId, studentName, role, now);

        publishEvent(eventBus, 'group.member_joined', 'ext-student-groups', {
          groupId: payload.groupId, classId: group.class_id, studentId: payload.studentId, studentName, role,
        }, command.id);

        return {
          success: true, groupId: payload.groupId, studentId: payload.studentId, studentName, role,
          message: `学生 ${studentName || payload.studentId} 已加入小组「${group.name}」${role === 'leader' ? '，并自动成为组长' : ''}`,
        };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. group.leave — 退出小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-leave',
      commandType: 'group.leave',
      description: '学生退出当前所在小组。若退出者为组长，自动转移给下一个成员。',
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
      async execute(command: any) {
        const payload = command.payload;
        const db = await getDb(ctx);

        const member = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`,
        ).get(payload.groupId, payload.studentId);
        if (!member) throw new Error('该学生不在该小组中');

        db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`).run(
          payload.groupId, payload.studentId,
        );

        // 组长退出时转移
        if (member.role === 'leader') {
          const next = db.prepare(
            `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? ORDER BY joined_at ASC LIMIT 1`,
          ).get(payload.groupId);
          if (next) {
            db.prepare(`UPDATE ${MEMBERS_TABLE} SET role = 'leader' WHERE group_id = ? AND student_id = ?`).run(
              payload.groupId, next.student_id,
            );
          }
        }

        publishEvent(eventBus, 'group.member_left', 'ext-student-groups', {
          groupId: payload.groupId, studentId: payload.studentId, wasLeader: member.role === 'leader',
        }, command.id);

        return { success: true, message: '已退出小组' };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. group.assign_leader — 任命组长
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-assign-leader',
      commandType: 'group.assign_leader',
      description: '任命指定学生为小组组长（原组长降为普通成员）。',
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
      async execute(command: any) {
        const payload = command.payload;
        const db = await getDb(ctx);

        const member = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`,
        ).get(payload.groupId, payload.studentId);
        if (!member) throw new Error('该学生不在该小组中');

        db.prepare(`UPDATE ${MEMBERS_TABLE} SET role = 'member' WHERE group_id = ?`).run(payload.groupId);
        db.prepare(`UPDATE ${MEMBERS_TABLE} SET role = 'leader' WHERE group_id = ? AND student_id = ?`).run(
          payload.groupId, payload.studentId,
        );

        const group = db.prepare(`SELECT name FROM ${GROUPS_TABLE} WHERE id = ?`).get(payload.groupId);

        publishEvent(eventBus, 'group.leader_assigned', 'ext-student-groups', {
          groupId: payload.groupId, studentId: payload.studentId, studentName: member.student_name,
        }, command.id);

        return {
          success: true,
          message: `已将 ${member.student_name || payload.studentId} 任命为小组「${group?.name || payload.groupId}」的组长`,
        };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 5. group.auto_assign — 自动随机分配
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-auto-assign',
      commandType: 'group.auto_assign',
      description: '自动将班级所有学生随机分配到指定数量的小组（Fisher-Yates 洗牌算法）。可选清空现有分组。',
      capabilityRequired: 'management:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          groupCount: { type: 'INTEGER', description: '分组数量（默认 4 组）' },
          strategy: { type: 'STRING', description: '分配策略：random（随机，默认）' },
          clearExisting: { type: 'BOOLEAN', description: '是否清空现有分组（默认 true）' },
        },
        required: ['classId'],
      },
    });

    await commandBus.registerHandler('group.auto_assign', {
      async execute(command: any) {
        const payload = command.payload;
        const db = await getDb(ctx);
        const now = Date.now();

        const groupCount = payload.groupCount || 4;
        const clearExisting = payload.clearExisting !== false;

        // 获取班级学生
        let students: any[] = [];
        try {
          const result = await commandBus.execute({
            id: generateId(),
            type: 'class.get_students',
            actorId: 'plugin-ext-student-groups',
            payload: { classId: payload.classId },
            timestamp: Date.now(),
          });
          if (result && result.students) students = result.students;
        } catch (e) {
          console.error('[ext-student-groups] 获取班级学生失败:', e);
          throw new Error('无法获取班级学生列表');
        }

        if (students.length === 0) throw new Error('该班级中没有学生，无法分组');
        if (groupCount > students.length) throw new Error(`分组数量（${groupCount}）不能超过学生人数（${students.length}）`);
        if (groupCount < 1) throw new Error('分组数量至少为 1');

        // 清空现有分组
        if (clearExisting) {
          const oldGroups = db.prepare(`SELECT id FROM ${GROUPS_TABLE} WHERE class_id = ?`).all(payload.classId);
          for (const g of oldGroups) {
            db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ?`).run((g as any).id);
          }
          db.prepare(`DELETE FROM ${GROUPS_TABLE} WHERE class_id = ?`).run(payload.classId);
        }

        // Fisher-Yates 洗牌
        const shuffled = [...students];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // 创建小组并分配学生
        const groupIds: string[] = [];
        const groupNames: string[] = [];
        for (let i = 0; i < groupCount; i++) {
          const gid = generateId();
          const gname = `第${i + 1}组`;
          groupIds.push(gid);
          groupNames.push(gname);
          db.prepare(
            `INSERT INTO ${GROUPS_TABLE} (id, class_id, name, description, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(gid, payload.classId, gname, '系统自动分组', 'system', '系统自动分配', now);
        }

        const assignments: any[] = [];
        for (let i = 0; i < shuffled.length; i++) {
          const gIdx = i % groupCount;
          const s = shuffled[i];
          const isLeader = i < groupCount;
          db.prepare(
            `INSERT INTO ${MEMBERS_TABLE} (group_id, student_id, student_name, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
          ).run(groupIds[gIdx], s.id, s.name, isLeader ? 'leader' : 'member', now);
          assignments.push({ groupName: groupNames[gIdx], studentName: s.name, isLeader });
        }

        publishEvent(eventBus, 'group.auto_assigned', 'ext-student-groups', {
          classId: payload.classId, groupCount, studentCount: students.length,
        }, command.id);

        return {
          success: true, groupCount, studentCount: students.length,
          groups: groupIds.map((id, i) => ({ id, name: groupNames[i] })),
          assignments,
          message: `已将 ${students.length} 名学生随机分配到 ${groupCount} 个小组`,
        };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 6. group.list — 列出所有小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-list',
      commandType: 'group.list',
      description: '列出指定班级的所有小组及其成员。',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: { classId: { type: 'STRING', description: '班级 ID' } },
        required: ['classId'],
      },
    });

    await commandBus.registerHandler('group.list', {
      async execute(command: any) {
        const db = await getDb(ctx);
        const groups = db.prepare(
          `SELECT * FROM ${GROUPS_TABLE} WHERE class_id = ? ORDER BY created_at ASC`,
        ).all(command.payload.classId);

        const result = [];
        for (const group of groups) {
          const members = db.prepare(
            `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? ORDER BY role DESC, joined_at ASC`,
          ).all(group.id);
          result.push({ ...group, members, memberCount: members.length });
        }

        return { success: true, classId: command.payload.classId, groups: result, totalGroups: result.length };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 7. group.get_members — 获取小组成员
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-get-members',
      commandType: 'group.get_members',
      description: '获取指定小组的所有成员信息。',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: { groupId: { type: 'STRING', description: '小组 ID' } },
        required: ['groupId'],
      },
    });

    await commandBus.registerHandler('group.get_members', {
      async execute(command: any) {
        const db = await getDb(ctx);
        const group = db.prepare(`SELECT * FROM ${GROUPS_TABLE} WHERE id = ?`).get(command.payload.groupId);
        if (!group) throw new Error(`小组 ${command.payload.groupId} 不存在`);
        const members = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? ORDER BY role DESC, joined_at ASC`,
        ).all(command.payload.groupId);
        return { success: true, group, members, memberCount: members.length };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 8. group.delete — 删除小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-delete',
      commandType: 'group.delete',
      description: '删除指定小组及其所有成员关系（高风险操作）。',
      capabilityRequired: 'management:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: { groupId: { type: 'STRING', description: '要删除的小组 ID' } },
        required: ['groupId'],
      },
    });

    await commandBus.registerHandler('group.delete', {
      async execute(command: any) {
        const db = await getDb(ctx);
        const group = db.prepare(`SELECT * FROM ${GROUPS_TABLE} WHERE id = ?`).get(command.payload.groupId);
        if (!group) throw new Error(`小组 ${command.payload.groupId} 不存在`);

        db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ?`).run(command.payload.groupId);
        db.prepare(`DELETE FROM ${GROUPS_TABLE} WHERE id = ?`).run(command.payload.groupId);

        publishEvent(eventBus, 'group.deleted', 'ext-student-groups', {
          groupId: command.payload.groupId, classId: group.class_id, name: group.name,
        }, command.id);

        return { success: true, message: `小组「${group.name}」已删除` };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 9. group.kick — 踢出成员
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-kick',
      commandType: 'group.kick',
      description: '将指定学生从小组中移除。若被踢者为组长，自动转移给下一个成员。',
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
      async execute(command: any) {
        const payload = command.payload;
        const db = await getDb(ctx);

        const member = db.prepare(
          `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`,
        ).get(payload.groupId, payload.studentId);
        if (!member) throw new Error('该学生不在该小组中');

        db.prepare(`DELETE FROM ${MEMBERS_TABLE} WHERE group_id = ? AND student_id = ?`).run(
          payload.groupId, payload.studentId,
        );

        if (member.role === 'leader') {
          const next = db.prepare(
            `SELECT * FROM ${MEMBERS_TABLE} WHERE group_id = ? ORDER BY joined_at ASC LIMIT 1`,
          ).get(payload.groupId);
          if (next) {
            db.prepare(`UPDATE ${MEMBERS_TABLE} SET role = 'leader' WHERE group_id = ? AND student_id = ?`).run(
              payload.groupId, next.student_id,
            );
          }
        }

        publishEvent(eventBus, 'group.member_kicked', 'ext-student-groups', {
          groupId: payload.groupId, studentId: payload.studentId, studentName: member.student_name,
        }, command.id);

        return { success: true, message: `已将 ${member.student_name || payload.studentId} 从小组中移除` };
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 10. group.get_student_group — 查询学生所属小组
    // ═══════════════════════════════════════════════════════════════════════
    await actionRegistry.register({
      id: 'ext-student-groups-get-student-group',
      commandType: 'group.get_student_group',
      description: '查询指定学生在某个班级中所属的小组。',
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
      async execute(command: any) {
        const payload = command.payload;
        const db = await getDb(ctx);

        const row = db.prepare(`
          SELECT m.*, g.name as group_name, g.description as group_description
          FROM ${MEMBERS_TABLE} m
          JOIN ${GROUPS_TABLE} g ON m.group_id = g.id
          WHERE m.student_id = ? AND g.class_id = ?
        `).get(payload.studentId, payload.classId);

        if (!row) return { success: true, group: null, message: '该学生尚未加入任何小组' };

        return {
          success: true,
          group: {
            groupId: row.group_id, groupName: row.group_name,
            groupDescription: row.group_description, role: row.role, joinedAt: row.joined_at,
          },
        };
      },
    });

    console.log('[ext-student-groups] 学生分组管理插件已激活（10 条命令已注册）');
  },
};
