import { describe, it, expect, afterEach } from 'vitest';
import { Kernel } from '../../core/kernel/index.js';

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

    // Verify it is loaded and active
    const plugins = kernel.pluginHost.listPlugins();
    const votePlugin = plugins.find(p => p.name === '课堂实时投票与抽奖转盘');
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
