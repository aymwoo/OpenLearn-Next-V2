import { describe, it, expect, afterEach } from 'vitest';
import { Kernel } from '../../core/kernel/index.js';
import { IDatabaseToken } from '../../core/di/interfaces.js';

describe('Raffle & Vote Plugin Integration Test', () => {
  let kernel: Kernel;

  afterEach(async () => {
    if (kernel) {
      const activePlugins = kernel.pluginHost.listPlugins();
      for (const plugin of activePlugins) {
        if (plugin.state === 'active') {
          try {
            await kernel.pluginHost.deactivatePlugin(plugin.id);
          } catch (e) {}
        }
      }
    }
  });

  it('should create a vote, cast votes, and export results successfully', async () => {
    // 1. Delete existing plugin rows to ensure a clean test run
    const { db } = await import('../../core/db/index.js');
    db.prepare("DELETE FROM plugins WHERE id = 'ext-raffle-vote' OR manifest LIKE '%ext-raffle-vote%'").run();

    // 2. Initialize kernel
    kernel = new Kernel();
    await kernel.ready;

    const pluginId = '@openlearn/plugin-raffle-vote';
    const RaffleVotePlugin = {
      manifest: {
        id: pluginId,
        name: '课堂实时投票与抽奖转盘',
        version: '1.0.0',
        main: 'index.js',
        entry: 'index.js',
        capabilitiesProposed: ['whiteboard:write', 'vfs:write']
      },
      activate: async (ctx: any) => {
        const commandBus = ctx.services.commandBus!;
        const actionRegistry = ctx.services.actionRegistry!;
        await ctx.db.ensureTable('votes', 'id TEXT PRIMARY KEY, lesson_id TEXT, title TEXT, options TEXT, element_ids TEXT, created_at INTEGER');
        await ctx.db.ensureTable('votes_cast', 'vote_id TEXT, option_index INTEGER, voter_id TEXT, timestamp INTEGER');

        await actionRegistry.register({
          id: 'ext-vote-create',
          commandType: 'vote.create',
          description: '发起投票',
          capabilityRequired: 'whiteboard:write',
        });

        await actionRegistry.register({
          id: 'ext-vote-cast',
          commandType: 'vote.cast',
          description: '投票',
          capabilityRequired: 'whiteboard:write',
        });

        await actionRegistry.register({
          id: 'ext-vote-export',
          commandType: 'vote.export',
          description: '导出投票',
          capabilityRequired: 'vfs:write',
        });

        await actionRegistry.register({
          id: 'ext-raffle-draw',
          commandType: 'raffle.draw',
          description: '抽奖',
          capabilityRequired: 'whiteboard:write',
        });

        await commandBus.registerHandler('vote.create', {
          execute: async (command: any) => {
            const dbInstance = await ctx.resolve(IDatabaseToken);
            const { lessonId, title, options } = command.payload as any;
            const voteId = 'vote_' + Math.random().toString(36).slice(2, 10);
            const x = 150, y = 150;
            const bgHeight = 65 + options.length * 45;
            const bgDraw = await commandBus.execute({
              id: 'draw_bg_' + voteId,
              type: 'whiteboard.draw',
              payload: { lessonId, type: 'rectangle', data: JSON.stringify({ x, y, width: 380, height: bgHeight, fill: '#f8fafc' }) }
            }) as any;

            const optionElementIds: any[] = [];
            for (let i = 0; i < options.length; i++) {
              const barDraw = await commandBus.execute({
                id: 'draw_bar_' + voteId + '_' + i,
                type: 'whiteboard.draw',
                payload: { lessonId, type: 'rectangle', data: JSON.stringify({ x: x + 20, y: y + 50 + i * 45, width: 15, height: 18, fill: '#38bdf8' }) }
              }) as any;
              const labelDraw = await commandBus.execute({
                id: 'draw_label_' + voteId + '_' + i,
                type: 'whiteboard.draw',
                payload: { lessonId, type: 'text', data: JSON.stringify({ x: x + 20, y: y + 50 + i * 45 + 20, text: options[i] + ': 0 票 (0%)', fontSize: 12, fill: '#475569' }) }
              }) as any;
              optionElementIds.push({ barId: barDraw?.elementId, labelId: labelDraw?.elementId });
            }

            const tblVotes = ctx.db.table('votes');
            await dbInstance.prepare('INSERT INTO ' + tblVotes + ' (id, lesson_id, title, options, element_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
              voteId, lessonId, title, JSON.stringify(options), JSON.stringify({ bgId: bgDraw?.elementId, options: optionElementIds, x, y }), Date.now()
            );
            return { success: true, voteId };
          }
        });

        await commandBus.registerHandler('vote.cast', {
          execute: async (command: any) => {
            const dbInstance = await ctx.resolve(IDatabaseToken);
            const { lessonId, voteId, optionIndex, voterId } = command.payload as any;
            const tblVotes = ctx.db.table('votes');
            const tblCast = ctx.db.table('votes_cast');

            const voteConfig = await dbInstance.prepare('SELECT * FROM ' + tblVotes + ' WHERE id = ? AND lesson_id = ?').get(voteId, lessonId) as any;
            if (!voteConfig) throw new Error('找不到指定的投票活动');
            const options = JSON.parse(voteConfig.options);
            const elementIds = JSON.parse(voteConfig.element_ids);

            const checkVoted = await dbInstance.prepare('SELECT count(*) as count FROM ' + tblCast + ' WHERE vote_id = ? AND voter_id = ?').get(voteId, voterId) as any;
            if (checkVoted.count > 0) throw new Error('不可重复投票');

            await dbInstance.prepare('INSERT INTO ' + tblCast + ' (vote_id, option_index, voter_id, timestamp) VALUES (?, ?, ?, ?)').run(voteId, optionIndex, voterId, Date.now());
            const allVotes = await dbInstance.prepare('SELECT option_index, count(*) as count FROM ' + tblCast + ' WHERE vote_id = ? GROUP BY option_index').all(voteId) as any[];
            const counts: Record<number, number> = {};
            options.forEach((_: any, i: number) => { counts[i] = 0; });
            let total = 0;
            allVotes.forEach((v: any) => { counts[v.option_index] = v.count; total += v.count; });

            for (let i = 0; i < options.length; i++) {
              const count = counts[i];
              const pct = total > 0 ? (count / total) : 0;
              const barWidth = Math.max(15, pct * 280);
              const refs = elementIds.options[i];
              await commandBus.execute({
                id: 'update_bar_' + Math.random().toString(36).slice(2),
                type: 'whiteboard.update',
                payload: { lessonId, elementId: refs.barId, data: JSON.stringify({ x: elementIds.x + 20, y: elementIds.y + 50 + i * 45, width: barWidth, height: 18, fill: '#38bdf8' }) }
              });
              await commandBus.execute({
                id: 'update_label_' + Math.random().toString(36).slice(2),
                type: 'whiteboard.update',
                payload: { lessonId, elementId: refs.labelId, data: JSON.stringify({ x: elementIds.x + 20, y: elementIds.y + 50 + i * 45 + 20, text: options[i] + ': ' + count + ' 票 (' + Math.round(pct * 100) + '%)', fontSize: 12, fill: '#374151' }) }
              });
            }
            return { success: true, totalVotes: total };
          }
        });

        await commandBus.registerHandler('vote.export', {
          execute: async (command: any) => {
            const { voteId, filename } = command.payload as any;
            const fn = filename || ('vote_results_' + voteId + '.xlsx');
            const dummyExcel = Buffer.from('mock-excel-content').toString('base64');
            await commandBus.execute({
              id: 'export_vfs_excel_' + Math.random().toString(36).slice(2),
              type: 'vfs.write_file',
              payload: { path: '/exports/' + fn, content: dummyExcel }
            });
            return { success: true, path: '/exports/' + fn, format: 'xlsx' };
          }
        });

        await commandBus.registerHandler('raffle.draw', {
          execute: async (command: any) => {
            const { candidates } = command.payload as any;
            const winner = candidates[Math.floor(Math.random() * candidates.length)];
            return { success: true, winner };
          }
        });
      }
    };

    db.prepare('INSERT OR REPLACE INTO plugins (id, name, manifest, source_code, status, created_at, execution_mode) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      pluginId,
      '课堂实时投票与抽奖转盘',
      JSON.stringify(RaffleVotePlugin.manifest),
      '// preloaded',
      'installed',
      Date.now(),
      'inline'
    );

    kernel.pluginHost.registerPreloadedPlugin(pluginId, RaffleVotePlugin);
    await kernel.pluginHost.activatePlugin(pluginId);

    // Verify it is loaded and active
    const plugins = kernel.pluginHost.listPlugins();
    const votePlugin = plugins.find(
      (p: any) =>
        p.name === '课堂实时投票与抽奖转盘' ||
        p.manifest?.name === '课堂实时投票与抽奖转盘' ||
        p.id === pluginId ||
        p.manifest?.id === pluginId,
    );
    expect(votePlugin).toBeDefined();
    expect(votePlugin!.state).toBe('active');

    // Grant capabilities
    kernel.capabilityGuard.grant('user-teacher', 'whiteboard:write');
    kernel.capabilityGuard.grant('user-student-1', 'whiteboard:write');
    kernel.capabilityGuard.grant('user-student-2', 'whiteboard:write');
    kernel.capabilityGuard.grant('user-teacher', 'vfs:write');

    // 3. Create a vote
    const createResult = await kernel.commandBus.execute({
      id: 'cmd-vote-create',
      type: 'vote.create',
      actorId: 'user-teacher',
      payload: {
        lessonId: 'test-lesson-id',
        title: '你喜欢 JavaScript 吗？',
        options: ['非常喜欢', '一般般', '讨厌']
      }
    }) as any;

    expect(createResult.success).toBe(true);
    expect(createResult.voteId).toBeDefined();
    const voteId = createResult.voteId;

    // 4. Cast votes
    const cast1 = await kernel.commandBus.execute({
      id: 'cmd-vote-cast-1',
      type: 'vote.cast',
      actorId: 'user-student-1',
      payload: {
        lessonId: 'test-lesson-id',
        voteId,
        optionIndex: 0,
        voterId: 'student_001'
      }
    }) as any;
    expect(cast1.success).toBe(true);
    expect(cast1.totalVotes).toBe(1);

    const cast2 = await kernel.commandBus.execute({
      id: 'cmd-vote-cast-2',
      type: 'vote.cast',
      actorId: 'user-student-2',
      payload: {
        lessonId: 'test-lesson-id',
        voteId,
        optionIndex: 1,
        voterId: 'student_002'
      }
    }) as any;
    expect(cast2.success).toBe(true);
    expect(cast2.totalVotes).toBe(2);

    // 5. Export vote results
    const exportResult = await kernel.commandBus.execute({
      id: 'cmd-vote-export',
      type: 'vote.export',
      actorId: 'user-teacher',
      payload: {
        voteId,
        filename: 'test_vote_export.xlsx'
      }
    }) as any;
    expect(exportResult.success).toBe(true);
    expect(exportResult.path).toBeDefined();
    expect(exportResult.format).toBe('xlsx');

    // Verify it is written to VFS in the database
    const vfsNode = db.prepare('SELECT * FROM vfs_nodes WHERE name = ?').get('test_vote_export.xlsx') as any;
    expect(vfsNode).toBeDefined();

    // 6. Draw raffle
    const raffleResult = await kernel.commandBus.execute({
      id: 'cmd-raffle-draw',
      type: 'raffle.draw',
      actorId: 'user-teacher',
      payload: {
        lessonId: 'test-lesson-id',
        candidates: ['Alice', 'Bob', 'Charlie']
      }
    }) as any;
    expect(raffleResult.success).toBe(true);
    expect(raffleResult.winner).toBeDefined();
    expect(['Alice', 'Bob', 'Charlie']).toContain(raffleResult.winner);
  });
});
