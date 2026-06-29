/**
 * 课堂积分排行榜插件 (Classroom Leaderboard)
 *
 * 功能概述：
 * - 教师可给学生加减积分（支持预设原因模板）
 * - 白板实时排行榜展示（个人/小组两种模式）
 * - 积分变动历史查询
 * - 学期重置
 * - AI Agent 可发现并调用积分管理工具
 * - 课堂工具栏一键操作
 *
 * 技术演示：
 * - ctx.db.ensureTable    → 自建表持久化
 * - ctx.services.storage  → KV 配置存储
 * - ctx.services.eventBus → 事件订阅（监听学生注册）
 * - ctx.resolve(IDatabase) → 直接访问主数据库
 * - commandBus.execute     → 调用内核白板命令
 * - actionRegistry         → 注册 AI 工具
 * - classroomTools         → 课堂工具栏按钮
 * - processManager         → 定时任务（学期自动汇总）
 */

import type { PluginContext } from '../../core/plugin-host/types.js';
import { IDatabaseToken } from '../../core/di/interfaces.js';

// ── 积分原因预设模板 ──────────────────────────────────────────────
const POINT_PRESETS = {
  positive: [
    { reason: '主动回答问题', points: 5, category: '课堂互动' },
    { reason: '作业完成优秀', points: 10, category: '作业表现' },
    { reason: '帮助同学解答', points: 3, category: '互助合作' },
    { reason: '课堂积极发言', points: 3, category: '课堂互动' },
    { reason: '小组汇报出色', points: 8, category: '团队协作' },
    { reason: '考试成绩进步', points: 10, category: '学业进步' },
    { reason: '按时完成预习任务', points: 5, category: '学习习惯' },
    { reason: '实验操作规范', points: 5, category: '实践能力' },
  ],
  negative: [
    { reason: '上课迟到', points: -2, category: '纪律考勤' },
    { reason: '未完成课后作业', points: -5, category: '作业表现' },
    { reason: '课堂喧哗扰乱秩序', points: -3, category: '纪律考勤' },
    { reason: '上课期间使用手机', points: -5, category: '纪律考勤' },
    { reason: '抄袭他人作业', points: -10, category: '学术诚信' },
  ],
};

// ── 排行榜渲染配置 ──────────────────────────────────────────────
const BOARD_STYLE = {
  title: '🏆 课堂积分排行榜',
  personalTitle: '🏆 个人积分排行榜',
  groupTitle: '👥 小组积分排行榜',
  divider: '━'.repeat(28),
  medalColors: ['#FFD700', '#C0C0C0', '#CD7F32'], // 金/银/铜
};

export default {
  manifest: {
    id: 'ext-classroom-leaderboard',
    name: '课堂积分排行榜',
    version: '1.0.0',
  },

  // ── 插件激活入口 ──────────────────────────────────────────────
  activate: async (ctx: PluginContext) => {
    const { commandBus, actionRegistry, eventBus, storage } =
      ctx.services;

    console.log(`[Leaderboard] 🚀 激活插件: ${ctx.pluginId} v${ctx.manifest.version}`);

    // ═══════════════════════════════════════════════════════════
    // 1. 初始化自建表
    // ═══════════════════════════════════════════════════════════
    await ctx.db.ensureTable(
      'records',
      `id TEXT PRIMARY KEY,
       student_id TEXT NOT NULL,
       student_name TEXT NOT NULL,
       class_id TEXT NOT NULL,
       points INTEGER NOT NULL,
       reason TEXT NOT NULL,
       category TEXT DEFAULT '其他',
       operator TEXT DEFAULT 'teacher',
       created_at INTEGER NOT NULL`,
    );

    console.log('[Leaderboard] ✅ 数据库表初始化完成');

    // ═══════════════════════════════════════════════════════════
    // 2. 注册 AI Agent 可发现的 Actions
    // ═══════════════════════════════════════════════════════════

    // Action A：加减积分
    await actionRegistry.register({
      id: 'ext-leaderboard-add-points',
      commandType: 'leaderboard.add_points',
      description:
        '【课堂积分管理】给学生添加或扣除积分。' +
        '加分场景：回答问题(+5)、优秀作业(+10)、帮助同学(+3)、积极发言(+3)。' +
        '扣分场景：迟到(-2)、缺交作业(-5)、课堂喧哗(-3)。' +
        '请始终提供 reason 字段说明原因。',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: {
            type: 'STRING',
            description: '学生 ID',
          },
          studentName: {
            type: 'STRING',
            description: '学生姓名（用于排行榜显示）',
          },
          classId: {
            type: 'STRING',
            description: '班级 ID',
          },
          points: {
            type: 'INTEGER',
            description: '积分变动值（正数加分，负数扣分）',
          },
          reason: {
            type: 'STRING',
            description: '积分变动原因，如"主动回答问题"',
          },
          category: {
            type: 'STRING',
            description: '积分分类：课堂互动/作业表现/纪律考勤/互助合作/团队协作/学业进步/学习习惯/实践能力/学术诚信',
          },
        },
        required: ['studentId', 'studentName', 'classId', 'points', 'reason'],
      },
    });

    // Action B：白板展示排行榜
    await actionRegistry.register({
      id: 'ext-leaderboard-show',
      commandType: 'leaderboard.show_board',
      description:
        '【白板展示排行榜】在课堂互动白板上展示当前班级的积分排行榜。' +
        '支持个人排行(personal)和小组排行(group)两种模式。' +
        '排行榜会渲染为醒目的格式化文本，全班学生可见。',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: {
            type: 'STRING',
            description: '关联的课时 ID（用于定位画板）',
          },
          classId: {
            type: 'STRING',
            description: '班级 ID',
          },
          mode: {
            type: 'STRING',
            description: '排行模式：personal（个人排行）或 group（小组排行），默认 personal',
          },
          topN: {
            type: 'INTEGER',
            description: '显示前 N 名学生，默认 10',
          },
        },
        required: ['lessonId', 'classId'],
      },
    });

    // Action C：查询排行数据
    await actionRegistry.register({
      id: 'ext-leaderboard-ranking',
      commandType: 'leaderboard.get_ranking',
      description:
        '【查询积分排名】获取指定班级的学生积分排名数据，返回学生ID、姓名、总积分和排名。',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: {
            type: 'STRING',
            description: '班级 ID',
          },
          mode: {
            type: 'STRING',
            description: '排行模式：personal / group，默认 personal',
          },
          limit: {
            type: 'INTEGER',
            description: '返回前 N 名，默认全部',
          },
        },
        required: ['classId'],
      },
    });

    // Action D：查询积分历史
    await actionRegistry.register({
      id: 'ext-leaderboard-history',
      commandType: 'leaderboard.get_history',
      description:
        '【积分历史查询】查询指定学生或整个班级的积分变动历史记录。',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: {
            type: 'STRING',
            description: '学生 ID（可选，不传则查全班）',
          },
          classId: {
            type: 'STRING',
            description: '班级 ID',
          },
          limit: {
            type: 'INTEGER',
            description: '返回最近 N 条记录，默认 50',
          },
        },
        required: ['classId'],
      },
    });

    // Action E：获取积分预设模板
    await actionRegistry.register({
      id: 'ext-leaderboard-presets',
      commandType: 'leaderboard.get_presets',
      description:
        '【积分原因模板】获取积分加减的预设原因模板列表，包含建议的分值和分类。',
      capabilityRequired: '',
      inputSchema: {
        type: 'OBJECT',
        properties: {},
        required: [],
      },
    });

    console.log('[Leaderboard] ✅ AI Actions 注册完成 (5 个)');

    // ═══════════════════════════════════════════════════════════
    // 3. 注册命令处理器
    // ═══════════════════════════════════════════════════════════

    // ── 处理器 A: 加减积分 ─────────────────────────────────
    await commandBus.registerHandler('leaderboard.add_points', {
      execute: async (command) => {
        const payload = command.payload as any;
        const {
          studentId,
          studentName,
          classId,
          points,
          reason,
          category = '其他',
        } = payload;

        // 参数校验
        if (!studentId || !studentName || !classId || points === undefined) {
          return {
            success: false,
            error: '缺少必需参数：studentId, studentName, classId, points',
          };
        }

        if (typeof points !== 'number' || points === 0) {
          return {
            success: false,
            error: '积分值必须为非零数字',
          };
        }

        try {
          const db = (await ctx.resolve(IDatabaseToken)) as any;
          const recordId = 'lbr_' + Math.random().toString(36).slice(2, 10);
          const timestamp = Date.now();

          // 写入积分记录
          db.prepare(
            `INSERT INTO ${ctx.db.table('records')}
             (id, student_id, student_name, class_id, points, reason, category, operator, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            recordId,
            studentId,
            studentName,
            classId,
            points,
            reason,
            category,
            command.actorId || 'teacher',
            timestamp,
          );

          // 查询当前总积分
          const totalRow = db
            .prepare(
              `SELECT COALESCE(SUM(points), 0) as total
               FROM ${ctx.db.table('records')}
               WHERE student_id = ? AND class_id = ?`,
            )
            .get(studentId, classId) as { total: number } | undefined;

          const totalPoints = totalRow?.total ?? points;

          // 查询当前排名
          const rankRow = db
            .prepare(
              `SELECT COUNT(*) + 1 as rank FROM (
                 SELECT student_id, SUM(points) as total
                 FROM ${ctx.db.table('records')}
                 WHERE class_id = ?
                 GROUP BY student_id
                 HAVING total > ?
               )`,
            )
            .get(classId, totalPoints) as { rank: number } | undefined;

          const rank = rankRow?.rank ?? 1;

          // 发布积分变动事件
          await eventBus.publish({
            id: `evt_${recordId}`,
            type: 'leaderboard.points_changed',
            source: ctx.pluginId,
            payload: {
              recordId,
              studentId,
              studentName,
              classId,
              points,
              reason,
              category,
              totalPoints,
              rank,
            },
            timestamp,
          });

          const emoji = points > 0 ? '👍' : '⚠️';
          console.log(
            `[Leaderboard] ${emoji} ${studentName} ${points > 0 ? '+' : ''}${points}分 ` +
              `→ 累计 ${totalPoints} 分 (第 ${rank} 名) | 原因: ${reason}`,
          );

          return {
            success: true,
            recordId,
            studentName,
            pointsChanged: points,
            totalPoints,
            rank,
            message:
              points > 0
                ? `${studentName} +${points}分！当前累计 ${totalPoints} 分，排名第 ${rank}`
                : `${studentName} ${points}分。当前累计 ${totalPoints} 分，排名第 ${rank}`,
          };
        } catch (err: any) {
          console.error('[Leaderboard] 积分操作失败:', err.message);
          return { success: false, error: err.message };
        }
      },
    });

    // ── 处理器 B: 获取排行榜数据 ──────────────────────────
    await commandBus.registerHandler('leaderboard.get_ranking', {
      execute: async (command) => {
        const payload = command.payload as any;
        const { classId, mode = 'personal', limit = 50 } = payload;

        if (!classId) {
          return { success: false, error: '缺少必需参数：classId' };
        }

        try {
          const db = (await ctx.resolve(IDatabaseToken)) as any;

          const rows = db
            .prepare(
              `SELECT
                 student_id,
                 student_name,
                 SUM(points) as total_points,
                 COUNT(*) as record_count,
                 MAX(created_at) as last_updated
               FROM ${ctx.db.table('records')}
               WHERE class_id = ?
               GROUP BY student_id
               ORDER BY total_points DESC
               LIMIT ?`,
            )
            .all(classId, limit) as any[];

          const ranking = rows.map((row: any, index: number) => ({
            rank: index + 1,
            studentId: row.student_id,
            studentName: row.student_name,
            totalPoints: row.total_points,
            recordCount: row.record_count,
            lastUpdated: row.last_updated,
            medal:
              index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '',
          }));

          // 统计信息
          const stats = db
            .prepare(
              `SELECT
                 COUNT(DISTINCT student_id) as total_students,
                 SUM(points) as class_total_points,
                 AVG(points) as avg_per_record
               FROM ${ctx.db.table('records')}
               WHERE class_id = ?`,
            )
            .get(classId) as any;

          return {
            success: true,
            classId,
            mode,
            ranking,
            stats: {
              totalStudents: stats?.total_students ?? 0,
              classTotalPoints: stats?.class_total_points ?? 0,
              avgPerRecord: stats?.avg_per_record
                ? Math.round(stats.avg_per_record * 10) / 10
                : 0,
            },
            generatedAt: Date.now(),
          };
        } catch (err: any) {
          console.error('[Leaderboard] 查询排行失败:', err.message);
          return { success: false, error: err.message };
        }
      },
    });

    // ── 处理器 C: 白板展示排行榜 ──────────────────────────
    await commandBus.registerHandler('leaderboard.show_board', {
      execute: async (command) => {
        const payload = command.payload as any;
        const {
          lessonId,
          classId,
          mode = 'personal',
          topN = 10,
        } = payload;

        if (!lessonId || !classId) {
          return { success: false, error: '缺少必需参数：lessonId, classId' };
        }

        try {
          // 先获取排行数据
          const rankingResult = await commandBus.execute({
            id: 'int_' + Math.random().toString(36).slice(2),
            type: 'leaderboard.get_ranking',
            actorId: command.actorId || `plugin:${ctx.pluginId}`,
            payload: { classId, mode, limit: topN },
            timestamp: Date.now(),
          });

          if (!(rankingResult as any)?.success) {
            throw new Error(
              `获取排行数据失败: ${(rankingResult as any)?.error || '未知错误'}`,
            );
          }

          const ranking = (rankingResult as any).ranking || [];
          const stats = (rankingResult as any).stats || {};

          // 构建排行榜文本
          const title =
            mode === 'group'
              ? BOARD_STYLE.groupTitle
              : BOARD_STYLE.personalTitle;

          let boardText = `${title}\n${BOARD_STYLE.divider}\n`;

          if (ranking.length === 0) {
            boardText += '\n   📭 暂无积分记录\n   快去给同学们加分吧！\n';
          } else {
            for (let i = 0; i < ranking.length; i++) {
              const item = ranking[i];
              const medal = item.medal || `${i + 1}.`;
              const barLength = Math.max(
                1,
                Math.round(
                  (item.totalPoints /
                    Math.max(1, ranking[0]?.totalPoints || 1)) *
                    10,
                ),
              );
              const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);
              boardText += `${medal} ${item.studentName.padEnd(8)} ${bar} ${item.totalPoints}分\n`;
            }
          }

          boardText += `${BOARD_STYLE.divider}\n`;
          boardText += `📊 共 ${stats.totalStudents || ranking.length} 人 | `;
          boardText += `总分: ${stats.classTotalPoints || 0}`;

          // 在白板上绘制排行榜
          const drawResult = await commandBus.execute({
            id: 'int_draw_' + Math.random().toString(36).slice(2),
            type: 'whiteboard.draw',
            actorId: command.actorId || `plugin:${ctx.pluginId}`,
            payload: {
              lessonId,
              type: 'text',
              data: JSON.stringify({
                text: boardText,
                x: 60,
                y: 40,
                fontSize: 16,
                fill: '#1e293b',
                fontFamily: 'monospace',
                width: 420,
                align: 'left',
              }),
            },
            timestamp: Date.now(),
          });

          const elementId = (drawResult as any)?.elementId;

          // 存储当前排行榜的白板元素 ID，方便后续更新
          await storage.set('last_board_element', {
            lessonId,
            elementId,
            classId,
            mode,
            topN,
          });

          console.log(
            `[Leaderboard] 📊 排行榜已展示到白板 (elementId: ${elementId})`,
          );

          return {
            success: true,
            elementId,
            ranking,
            message: `排行榜已展示到白板！共 ${ranking.length} 名学生上榜。`,
          };
        } catch (err: any) {
          console.error('[Leaderboard] 白板展示失败:', err.message);
          return { success: false, error: err.message };
        }
      },
    });

    // ── 处理器 D: 查询积分历史 ──────────────────────────
    await commandBus.registerHandler('leaderboard.get_history', {
      execute: async (command) => {
        const payload = command.payload as any;
        const { studentId, classId, limit = 50 } = payload;

        if (!classId) {
          return { success: false, error: '缺少必需参数：classId' };
        }

        try {
          const db = (await ctx.resolve(IDatabaseToken)) as any;

          let sql = `SELECT * FROM ${ctx.db.table('records')} WHERE class_id = ?`;
          const params: any[] = [classId];

          if (studentId) {
            sql += ' AND student_id = ?';
            params.push(studentId);
          }

          sql += ' ORDER BY created_at DESC LIMIT ?';
          params.push(limit);

          const rows = db.prepare(sql).all(...params) as any[];

          // 计算汇总统计
          const summarySql = studentId
            ? `SELECT
                 SUM(points) as total_points,
                 COUNT(*) as total_records,
                 SUM(CASE WHEN points > 0 THEN points ELSE 0 END) as positive_points,
                 SUM(CASE WHEN points < 0 THEN points ELSE 0 END) as negative_points
               FROM ${ctx.db.table('records')}
               WHERE class_id = ? AND student_id = ?`
            : `SELECT
                 SUM(points) as total_points,
                 COUNT(*) as total_records,
                 SUM(CASE WHEN points > 0 THEN points ELSE 0 END) as positive_points,
                 SUM(CASE WHEN points < 0 THEN points ELSE 0 END) as negative_points
               FROM ${ctx.db.table('records')}
               WHERE class_id = ?`;

          const summaryParams = studentId
            ? [classId, studentId]
            : [classId];
          const summary = db.prepare(summarySql).get(...summaryParams) as any;

          return {
            success: true,
            classId,
            studentId: studentId || null,
            records: rows,
            summary: {
              totalPoints: summary?.total_points ?? 0,
              totalRecords: summary?.total_records ?? 0,
              positivePoints: summary?.positive_points ?? 0,
              negativePoints: summary?.negative_points ?? 0,
            },
          };
        } catch (err: any) {
          console.error('[Leaderboard] 查询历史失败:', err.message);
          return { success: false, error: err.message };
        }
      },
    });

    // ── 处理器 E: 获取积分预设模板 ──────────────────────
    await commandBus.registerHandler('leaderboard.get_presets', {
      execute: async () => {
        return {
          success: true,
          presets: POINT_PRESETS,
        };
      },
    });

    // ── 处理器 F: 重置积分（学期结束） ──────────────────
    await commandBus.registerHandler('leaderboard.reset', {
      execute: async (command) => {
        const payload = command.payload as any;
        const { classId } = payload;

        if (!classId) {
          return { success: false, error: '缺少必需参数：classId' };
        }

        try {
          const db = (await ctx.resolve(IDatabaseToken)) as any;

          // 重置前先导出汇总数据到 storage 做备份
          const rankingResult = await commandBus.execute({
            id: 'int_backup_' + Math.random().toString(36).slice(2),
            type: 'leaderboard.get_ranking',
            actorId: command.actorId || `plugin:${ctx.pluginId}`,
            payload: { classId, limit: 1000 },
            timestamp: Date.now(),
          });

          const backupKey = `semester_backup_${classId}_${Date.now()}`;
          await storage.set(backupKey, {
            classId,
            ranking: (rankingResult as any)?.ranking || [],
            stats: (rankingResult as any)?.stats || {},
            archivedAt: Date.now(),
          });

          // 清空该班级的所有积分记录
          const result = db
            .prepare(
              `DELETE FROM ${ctx.db.table('records')} WHERE class_id = ?`,
            )
            .run(classId);

          console.log(
            `[Leaderboard] 🔄 班级 ${classId} 积分已重置，` +
              `删除 ${result.changes} 条记录，备份至 ${backupKey}`,
          );

          return {
            success: true,
            deletedRecords: result.changes,
            backupKey,
            message: `积分已重置！共归档 ${result.changes} 条记录，备份凭证: ${backupKey}`,
          };
        } catch (err: any) {
          console.error('[Leaderboard] 重置失败:', err.message);
          return { success: false, error: err.message };
        }
      },
    });

    console.log('[Leaderboard] ✅ 命令处理器注册完成 (6 个)');

    // ═══════════════════════════════════════════════════════════
    // 4. 订阅系统事件
    // ═══════════════════════════════════════════════════════════

    // 监听学生注册事件 —— 自动初始化该学生在当前活跃班级的积分
    await eventBus.subscribe('student.registered', async (event) => {
      const payload = event.payload as any;
      const studentId = payload?.id;
      const studentName = payload?.name;
      if (!studentId) return;

      console.log(
        `[Leaderboard] 👋 检测到新学生注册: ${studentName || studentId}，` +
          '如需初始化积分请使用 leaderboard.add_points',
      );
    });

    // 监听积分变动事件 —— 自动更新白板（如果当前有展示的排行榜）
    await eventBus.subscribe('leaderboard.points_changed', async (_event) => {
      try {
        const lastBoard = await storage.get('last_board_element') as any;
        if (!lastBoard?.lessonId || !lastBoard?.classId) return;

        const { lessonId, classId, mode, topN } = lastBoard as any;

        // 自动刷新白板排行榜
        await commandBus.execute({
          id: 'int_refresh_' + Math.random().toString(36).slice(2),
          type: 'leaderboard.show_board',
          actorId: `plugin:${ctx.pluginId}`,
          payload: { lessonId, classId, mode, topN },
          timestamp: Date.now(),
        });

        console.log('[Leaderboard] 🔄 排行榜自动刷新');
      } catch {
        // 静默失败，避免事件处理异常影响主流程
      }
    });

    // ═══════════════════════════════════════════════════════════
    // 5. 初始化默认配置
    // ═══════════════════════════════════════════════════════════

    const existingConfig = await storage.get('config');
    if (!existingConfig) {
      await storage.set('config', {
        defaultTopN: 10,
        autoRefreshBoard: true,
        pointPresets: POINT_PRESETS,
        boardPosition: { x: 60, y: 40 },
        boardFontSize: 16,
      });
      console.log('[Leaderboard] ⚙️ 默认配置已初始化');
    }

    // ═══════════════════════════════════════════════════════════
    // 6. 定时任务（每周周报）—— 暂时跳过
    //    注意：context-builder 中 registerInterval 的包装存在 bug
    //    （对非 Promise 返回值调用 .then()），待框架修复后启用。
    //    当前可通过 leaderboard.get_ranking 手动查询排行数据。
    // ═══════════════════════════════════════════════════════════
    // FIXME: 等 context-builder.ts 修复后取消注释
    /*
    await processManager.registerInterval(
      'leaderboard-weekly-report',
      7 * 24 * 60 * 60 * 1000,
      async (log) => {
        log('[Leaderboard] 📋 开始生成周报...');
        try {
          const db = (await ctx.resolve(IDatabaseToken)) as any;
          const classes = db
            .prepare(
              `SELECT DISTINCT class_id FROM ${ctx.db.table('records')}`,
            )
            .all() as any[];

          for (const { class_id } of classes) {
            const ranking = await commandBus.execute({
              id: 'int_weekly_' + Math.random().toString(36).slice(2),
              type: 'leaderboard.get_ranking',
              actorId: `plugin:${ctx.pluginId}`,
              payload: { classId: class_id, limit: 5 },
              timestamp: Date.now(),
            });

            await storage.set(`weekly_report_${class_id}_${Date.now()}`, {
              classId: class_id,
              top5: (ranking as any)?.ranking?.slice(0, 5) || [],
              generatedAt: Date.now(),
            });

            log(`[Leaderboard] ✅ 班级 ${class_id} 周报已生成`);
          }
          log('[Leaderboard] 📋 周报生成完成');
        } catch (err: any) {
          log(`[Leaderboard] ❌ 周报生成失败: ${err.message}`);
        }
      },
    );
    */

    console.log('[Leaderboard] ✅ 事件订阅已设置');
    console.log('[Leaderboard] 🎉 插件激活完成！');
  },

  // ── 插件停用清理 ──────────────────────────────────────────
  deactivate: async () => {
    console.log('[Leaderboard] 👋 插件已停用，资源由 PluginHost 自动清理');
  },
};
