import type { PluginContext } from '@openlearn/plugin-sdk';
import { IDatabaseToken } from '@openlearn/plugin-sdk';

export interface GateVerificationPayload {
  studentId: string;
  lessonId: string;
  segmentId?: string;
  gateType?: string;
  params?: Record<string, unknown>;
  readOnly?: boolean;
}

export interface GateVerificationResult {
  allowed: boolean;
  reason?: string;
  progress?: {
    current: number;
    target: number;
    unit?: string;
  };
}

export interface LabSubmissionPayload {
  studentId: string;
  lessonId: string;
  score?: number;
  isPassed?: boolean;
  detail?: Record<string, unknown>;
}

export default {
  manifest: {
    id: 'ext-interactive-lab',
    name: '虚拟探究实验与竞赛模式增强套件',
    version: '1.0.0',
    main: 'index.js',
  },

  activate: async (ctx: PluginContext) => {
    const { log, services, db } = ctx;
    const { commandBus, actionRegistry, eventBus } = services;

    log.info('[InteractiveLab] 增强套件正在激活并初始化教学模式与门禁判定...');

    // 1. 注册自定义教学模式到核心数据库 teaching_modes 表
    let rawDb: any = null;
    try {
      rawDb = await ctx.resolve(IDatabaseToken);
      if (rawDb?.prepare) {
        // 确保 teaching_modes 表存在（防止尚未执行迁移的测试环境缺表）
        rawDb.exec(`
          CREATE TABLE IF NOT EXISTS teaching_modes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            name_en TEXT,
            description TEXT,
            description_en TEXT,
            icon TEXT,
            color TEXT,
            is_builtin INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 100,
            created_at INTEGER NOT NULL,
            updated_at INTEGER
          );
        `);

        const existing = rawDb.prepare('SELECT id FROM teaching_modes WHERE id = ?').get('mode-arena-compete');
        const now = Date.now();
        if (!existing) {
          rawDb
            .prepare(
              `INSERT INTO teaching_modes
                (id, name, name_en, description, description_en, icon, color, is_builtin, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, 150, ?, ?)`,
            )
            .run(
              'mode-arena-compete',
              '班级对抗竞赛模式',
              'Arena Competition Mode',
              '小组对抗、抢答限时争锋、实时大屏积分榜与多维战报',
              'Team competition, timed speed-quiz, and real-time live arena scoreboard',
              'Trophy',
              'amber',
              now,
              now,
            );
          log.info('[InteractiveLab] 自定义教学模式「班级对抗竞赛模式 (mode-arena-compete)」已成功写入数据库');
        }
      }
    } catch (err: any) {
      log.warn('[InteractiveLab] 教学模式写入跳过或受限:', err?.message || err);
    }

    // 2. 建立插件私有持久化表用于记录学生探究实验完成状态
    await db.ensureTable(
      'lab_submissions',
      `id TEXT PRIMARY KEY,
       student_id TEXT NOT NULL,
       lesson_id TEXT NOT NULL,
       score INTEGER NOT NULL,
       is_passed INTEGER NOT NULL,
       detail_json TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL`,
    );

    // 3. 注册环节门禁判定 Action 与命令处理器
    // 注意：capabilityRequired 必须严格为 segment:gate_eval，exposeToAgent 须为 false
    await actionRegistry.register({
      id: 'circuit.verify_gate',
      description: 'Evaluate circuit simulation completion gate for students',
      commandType: 'circuit.verify_gate',
      capabilityRequired: 'segment:gate_eval',
      exposeToAgent: false,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: { type: 'STRING' },
          lessonId: { type: 'STRING' },
          segmentId: { type: 'STRING' },
        },
      },
    });

    await commandBus.registerHandler('circuit.verify_gate', {
      execute: async (command: any): Promise<GateVerificationResult> => {
        const payload: GateVerificationPayload = command.payload || {};
        const { studentId, lessonId } = payload;
        log.info(`[InteractiveLab] 收到环节门禁判定请求: studentId=${studentId}, lessonId=${lessonId}`);

        if (!studentId || !lessonId) {
          return {
            allowed: false,
            reason: '缺少必要参数 (studentId 或 lessonId)',
            progress: { current: 0, target: 1, unit: '次' },
          };
        }

        try {
          const tbl = db.table('lab_submissions');
          const row = rawDb
            ? (rawDb
                .prepare(
                  `SELECT score, is_passed FROM ${tbl} WHERE student_id = ? AND lesson_id = ? ORDER BY updated_at DESC LIMIT 1`,
                )
                .get(studentId, lessonId) as { score?: number; is_passed?: number } | undefined)
            : undefined;

          if (row && (row.is_passed === 1 || (row.score ?? 0) >= 60)) {
            return {
              allowed: true,
              reason: '虚拟电路探究实验已成功通关',
              progress: { current: 1, target: 1, unit: '次' },
            };
          }

          return {
            allowed: false,
            reason: '请先在白板「虚拟电路探究器」中闭合电路并提交实验报告',
            progress: { current: 0, target: 1, unit: '次' },
          };
        } catch (err: any) {
          log.error('[InteractiveLab] 环节门禁计算异常，执行 fail-closed 拦截:', err?.message || err);
          return {
            allowed: false,
            reason: '门禁验证服务繁忙，请稍后重试',
            progress: { current: 0, target: 1, unit: '次' },
          };
        }
      },
    });

    // 4. 注册实验提交 Action 与命令处理器
    await actionRegistry.register({
      id: 'circuit.submit_lab',
      description: 'Submit circuit inquiry lab results for student',
      commandType: 'circuit.submit_lab',
      capabilityRequired: 'lesson:read',
      exposeToAgent: false,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: { type: 'STRING' },
          lessonId: { type: 'STRING' },
          score: { type: 'INTEGER' },
          isPassed: { type: 'BOOLEAN' },
        },
      },
    });

    await commandBus.registerHandler('circuit.submit_lab', {
      execute: async (command: any) => {
        const payload: LabSubmissionPayload = command.payload || {};
        const { studentId, lessonId, score = 100, isPassed = true, detail = {} } = payload;

        if (!studentId || !lessonId) {
          throw new Error('studentId and lessonId are required');
        }

        const now = Date.now();
        const id = `lab_${studentId}_${lessonId}_${now}`;
        const tbl = db.table('lab_submissions');

        if (rawDb) {
          rawDb
            .prepare(
              `INSERT OR REPLACE INTO ${tbl}
                (id, student_id, lesson_id, score, is_passed, detail_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(id, studentId, lessonId, score, isPassed ? 1 : 0, JSON.stringify(detail), now, now);
        }

        // 广播实验通过事件
        await eventBus.publish({
          id: `evt_${id}`,
          type: 'ext-interactive-lab.lab_submitted',
          source: 'plugin.ext-interactive-lab',
          payload: { id, studentId, lessonId, score, isPassed, timestamp: now },
          timestamp: now,
        });

        log.info(`[InteractiveLab] 学生 ${studentId} 成功提交探究实验，分数: ${score}, 通过: ${isPassed}`);
        return { success: true, submissionId: id, studentId, lessonId, isPassed };
      },
    });

    // 5. 注册实验状态查询 Action
    await actionRegistry.register({
      id: 'circuit.query_status',
      description: 'Query student circuit inquiry lab completion status',
      commandType: 'circuit.query_status',
      capabilityRequired: 'lesson:read',
      exposeToAgent: false,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: { type: 'STRING' },
          lessonId: { type: 'STRING' },
        },
      },
    });

    await commandBus.registerHandler('circuit.query_status', {
      execute: async (command: any) => {
        const { studentId, lessonId } = command.payload || {};
        const tbl = db.table('lab_submissions');
        const row = rawDb
          ? (rawDb
              .prepare(
                `SELECT score, is_passed, created_at, updated_at FROM ${tbl} WHERE student_id = ? AND lesson_id = ? ORDER BY updated_at DESC LIMIT 1`,
              )
              .get(studentId, lessonId) as Record<string, unknown> | undefined)
          : undefined;

        return {
          submitted: !!row,
          isPassed: row?.is_passed === 1,
          score: row?.score ?? 0,
          record: row || null,
        };
      },
    });

    log.info('[InteractiveLab] 增强套件服务初始化完成');
  },

  deactivate: async () => {
    // 插件停用：命令与 Action 由宿主 ResourceTracker 自动反注册，保持轻量无参
  },
};
