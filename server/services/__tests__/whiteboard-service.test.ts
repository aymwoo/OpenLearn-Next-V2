import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { runStartupMigrations } from '../../bootstrap-db.js';
import { WhiteboardService } from '../whiteboard-service.js';

describe('WhiteboardService 领域服务单元测试 (E3 深化)', () => {
  let service: WhiteboardService;
  const db = kernelContainer.db;

  const testLessonId = 'les-test-wb-01';
  const testAssignmentWbId = 'assignment-test-wb-01';
  const testElementId = 'elem-wb-01';

  const commandLog: any[] = [];
  const mockCommandBus = {
    createCommand: (type: string, payload: any, actorId: string, meta: any) => ({
      type,
      payload,
      actorId,
      meta,
    }),
    execute: async (cmd: any) => {
      commandLog.push(cmd);
      return { success: true, cmdType: cmd.type };
    },
  };

  beforeAll(async () => {
    service = new WhiteboardService(db, mockCommandBus);
    await runStartupMigrations(db as unknown as import('../../bootstrap-db.js').MigrationDb); // strict: Database/MigrationDb 端口漂移，运行时相容
    const now = Date.now();

    // 清理脏数据
    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id IN (?, ?, ?, ?)').run(
      testLessonId,
      `snapshot-${testLessonId}`,
      testAssignmentWbId,
      'les-test-wb-nosnap',
    );

    // 种子元素
    db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      testElementId,
      testLessonId,
      'text',
      JSON.stringify({ text: '牛顿力学导学' }),
      now,
    );
  });

  describe('1. 白板元素检索与首次自动快照 (getWhiteboardElements)', () => {
    it('首次访问常规课节白板时自动创建快照备份与标记', () => {
      const elements = service.getWhiteboardElements(testLessonId);
      expect(elements).toHaveLength(1);
      expect(elements[0].id).toBe(testElementId);

      // 验证快照表中生成了备份与 marker
      const snapshotElements = db
        .prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?')
        .all(`snapshot-${testLessonId}`) as any[];

      expect(snapshotElements.length).toBe(2); // 1 marker + 1 element copy
      const marker = snapshotElements.find((e) => e.type === 'snapshot_marker');
      const elemCopy = snapshotElements.find((e) => e.id === `snapshot-${testElementId}`);
      expect(marker).toBeDefined();
      expect(elemCopy).toBeDefined();
    });

    it('二次访问白板时保持幂等，不会重复插入快照', () => {
      service.getWhiteboardElements(testLessonId);
      const snapshotElements = db
        .prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?')
        .all(`snapshot-${testLessonId}`);
      expect(snapshotElements.length).toBe(2);
    });

    it('作业白板 (assignment-*) 不会触发快照创建', () => {
      db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'elem-asg-01',
        testAssignmentWbId,
        'pen',
        '{}',
        Date.now(),
      );

      service.getWhiteboardElements(testAssignmentWbId);

      const count = db
        .prepare('SELECT count(*) as count FROM whiteboard_elements WHERE lesson_id = ?')
        .get(`snapshot-${testAssignmentWbId}`) as any;
      expect(count.count).toBe(0);
    });
  });

  describe('2. 白板重置与快照回滚 (resetWhiteboard)', () => {
    it('作业白板重置时直接清空所有元素', () => {
      const res = service.resetWhiteboard(testAssignmentWbId);
      expect(res.success).toBe(true);
      expect(res.message).toContain('empty');

      const remaining = db
        .prepare('SELECT count(*) as count FROM whiteboard_elements WHERE lesson_id = ?')
        .get(testAssignmentWbId) as any;
      expect(remaining.count).toBe(0);
    });

    it('常规课节白板重置时在事务内原子恢复至初始快照状态', () => {
      // 在当前白板额外增加涂鸦元素
      db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'elem-extra-dirty',
        testLessonId,
        'pen',
        '{"strokes":[]}',
        Date.now(),
      );

      let currentCount = (
        db.prepare('SELECT count(*) as count FROM whiteboard_elements WHERE lesson_id = ?').get(testLessonId) as any
      ).count;
      expect(currentCount).toBe(2);

      // 执行重置回滚
      const res = service.resetWhiteboard(testLessonId);
      expect(res.success).toBe(true);
      expect(res.message).toContain('start state');

      // 验证恢复为初始的 1 个元素
      const restored = db.prepare('SELECT * FROM whiteboard_elements WHERE lesson_id = ?').all(testLessonId) as any[];
      expect(restored).toHaveLength(1);
      expect(restored[0].id).toBe(testElementId); // 剥离了 snapshot- 前缀
      expect(restored[0].type).toBe('text');
    });

    it('无快照时重置直接清空', () => {
      const noSnapId = 'les-test-wb-nosnap';
      db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
        'elem-nosnap-01',
        noSnapId,
        'shape',
        '{}',
        Date.now(),
      );

      const res = service.resetWhiteboard(noSnapId);
      expect(res.success).toBe(true);
      expect(res.message).toContain('no snapshot');

      const remaining = db
        .prepare('SELECT count(*) as count FROM whiteboard_elements WHERE lesson_id = ?')
        .get(noSnapId) as any;
      expect(remaining.count).toBe(0);
    });
  });

  describe('3. CommandBus 指令调度 (draw / update / clear / delete)', () => {
    it('drawElement 应构造并执行 whiteboard.draw 命令', async () => {
      const res = await service.drawElement({
        lessonId: testLessonId,
        type: 'shape',
        data: { kind: 'rectangle' },
        actorId: 'teacher-01',
      });
      expect(res.success).toBe(true);
      expect(res.cmdType).toBe('whiteboard.draw');
    });

    it('updateElement 应构造并执行 whiteboard.update 命令', async () => {
      const res = await service.updateElement({
        lessonId: testLessonId,
        elementId: testElementId,
        data: { text: '新标题' },
        actorId: 'teacher-01',
      });
      expect(res.success).toBe(true);
      expect(res.cmdType).toBe('whiteboard.update');
    });

    it('clearWhiteboard 应构造并执行 whiteboard.clear 命令', async () => {
      const res = await service.clearWhiteboard(testLessonId, 'teacher-01');
      expect(res.success).toBe(true);
      expect(res.cmdType).toBe('whiteboard.clear');
    });

    it('deleteElement 应构造并执行 whiteboard.delete 命令', async () => {
      const res = await service.deleteElement(testLessonId, testElementId, 'teacher-01');
      expect(res.success).toBe(true);
      expect(res.cmdType).toBe('whiteboard.delete');
    });
  });

  describe('4. 合并写（IKYMW8：过期快照不得回滚并发字段）', () => {
    const mergeLessonId = 'les-test-wb-merge';
    const mergeElementId = 'elem-wb-merge';

    beforeEach(() => {
      db.prepare(
        'INSERT OR REPLACE INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(
        mergeElementId,
        mergeLessonId,
        'presentation',
        JSON.stringify({
          fileType: 'pptx',
          fileUrl: '/api/files/x',
          slideX: 1,
          slideCount: 5,
          isFullscreenSynced: true,
          isFullscreenForced: true,
          title: '课件',
        }),
        Date.now(),
      );
      commandLog.length = 0;
    });

    it('updateElement 应把对象载荷与库内现有 data 顶层浅合并后下发', async () => {
      // 模拟 PPTX 进放映时序：翻页/放映刚写入后，viewer 晚到的 slideCount
      // 只带 slideCount 一个字段，不得把 slideX / isFullscreenForced 回滚。
      await service.updateElement({ lessonId: mergeLessonId, elementId: mergeElementId, data: { slideCount: 6 } });
      const cmd = commandLog.at(-1);
      expect(cmd.type).toBe('whiteboard.update');
      const stored = JSON.parse(cmd.payload.data);
      expect(stored.slideCount).toBe(6);
      expect(stored.slideX).toBe(1);
      expect(stored.isFullscreenForced).toBe(true);
      expect(stored.isFullscreenSynced).toBe(true);
      expect(stored.title).toBe('课件');
    });

    it('updateElement 应保留载荷未携带的既有字段（翻页增量写）', async () => {
      await service.updateElement({ lessonId: mergeLessonId, elementId: mergeElementId, data: { slideX: 3 } });
      const stored = JSON.parse(commandLog.at(-1).payload.data);
      expect(stored.slideX).toBe(3);
      expect(stored.isFullscreenForced).toBe(true);
      expect(stored.fileUrl).toBe('/api/files/x');
    });

    it('updateElement 载荷显式写入的键应覆盖库内值（退出放映 / 清空字段）', async () => {
      // 先把上一步的增量写「落库」（mock commandBus 不写库，这里手工持久化），
      // 再验证显式键覆盖 + 未提及字段保留。
      const row = db.prepare('SELECT data FROM whiteboard_elements WHERE id = ?').get(mergeElementId) as {
        data: string;
      };
      const persisted = JSON.parse(row.data);
      persisted.slideX = 3;
      db.prepare('UPDATE whiteboard_elements SET data = ? WHERE id = ?').run(JSON.stringify(persisted), mergeElementId);

      await service.updateElement({
        lessonId: mergeLessonId,
        elementId: mergeElementId,
        data: { isFullscreenForced: false, fileUrl: '' },
      });
      const stored = JSON.parse(commandLog.at(-1).payload.data);
      expect(stored.isFullscreenForced).toBe(false);
      expect(stored.fileUrl).toBe('');
      expect(stored.slideX).toBe(3);
    });

    it('数组等非普通对象载荷保持整包替换语义（与既有调用方兼容）', async () => {
      await service.updateElement({
        lessonId: mergeLessonId,
        elementId: mergeElementId,
        data: { options: ['甲', '乙'], question: '1+1=?' },
      });
      const stored = JSON.parse(commandLog.at(-1).payload.data);
      expect(stored.options).toEqual(['甲', '乙']);
      expect(stored.question).toBe('1+1=?');
    });

    it('mergeWhiteboardElementData：非法 JSON 的库内数据退回整包替换', async () => {
      db.prepare('UPDATE whiteboard_elements SET data = ? WHERE id = ?').run('not-json{{', mergeElementId);
      await service.updateElement({ lessonId: mergeLessonId, elementId: mergeElementId, data: { slideX: 2 } });
      const stored = JSON.parse(commandLog.at(-1).payload.data);
      expect(stored).toEqual({ slideX: 2 });
    });

    it('mergeWhiteboardElementData：元素不存在（无库内数据）时整包写入', async () => {
      await service.updateElement({
        lessonId: mergeLessonId,
        elementId: 'elem-wb-merge-missing',
        data: { slideX: 0 },
      });
      const stored = JSON.parse(commandLog.at(-1).payload.data);
      expect(stored).toEqual({ slideX: 0 });
    });
  });
});
