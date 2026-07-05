import { IDatabaseToken } from '../../core/di/interfaces.js';
import type { PluginContext } from '../../core/plugin-host/types.js';

export default {
  manifest: {
    id: "ext-raffle-vote",
    name: "课堂实时投票与抽奖转盘",
    version: "1.0.0"
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    console.log(`[Raffle & Vote Plugin] Activating plugin "${ctx.pluginId}"...`);

    // 1. 创建隔离的数据表（投票与投票详情）
    await ctx.db.ensureTable('votes', 'id TEXT PRIMARY KEY, lesson_id TEXT, title TEXT, options TEXT, element_ids TEXT, created_at INTEGER');
    await ctx.db.ensureTable('votes_cast', 'vote_id TEXT, option_index INTEGER, voter_id TEXT, timestamp INTEGER');

    // 2. 注册开始投票 Action (vote.create)
    await actionRegistry.register({
      id: 'ext-vote-create',
      commandType: 'vote.create',
      description: '在课堂白板上发起一个实时的多选投票，渲染为动态条形图',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          title: { type: 'STRING', description: '投票题目' },
          options: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: '投票的可选选项'
          },
          x: { type: 'NUMBER', description: '画板 X 坐标' },
          y: { type: 'NUMBER', description: '画板 Y 坐标' }
        },
        required: ['lessonId', 'title', 'options']
      }
    });

    // 3. 注册投下选票 Action (vote.cast)
    await actionRegistry.register({
      id: 'ext-vote-cast',
      commandType: 'vote.cast',
      description: '学生对已发起的投票投下一票，实时更新白板的条形图高度',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          voteId: { type: 'STRING', description: '投票活动 ID' },
          optionIndex: { type: 'NUMBER', description: '所选选项的索引（从 0 开始）' },
          voterId: { type: 'STRING', description: '投票人学生 ID' }
        },
        required: ['lessonId', 'voteId', 'optionIndex', 'voterId']
      }
    });

    // 4. 注册导出投票结果 Action (vote.export)
    await actionRegistry.register({
      id: 'ext-vote-export',
      commandType: 'vote.export',
      description: '将当前投票的所有明细及汇总数据导出为 Excel (.xlsx) 或 CSV 存入虚拟文件系统',
      capabilityRequired: 'vfs:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          voteId: { type: 'STRING', description: '需要导出的投票活动 ID' },
          filename: { type: 'STRING', description: '导出的文件名（可选，默认自动生成）' }
        },
        required: ['voteId']
      }
    });

    // 5. 注册抽奖/随机点名 Action (raffle.draw)
    await actionRegistry.register({
      id: 'ext-raffle-draw',
      commandType: 'raffle.draw',
      description: '从班级中随机抽取一名学生作为幸运中奖者，并在画板上展示喜报卡片',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          candidates: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: '抽奖候选人名单（可选，若不传则从选课班级名单中随机抽选）'
          },
          x: { type: 'NUMBER', description: '画板 X 坐标' },
          y: { type: 'NUMBER', description: '画板 Y 坐标' }
        },
        required: ['lessonId']
      }
    });

    // ── 6. 绑定 vote.create 处理器 ──────────────────────────────────────────
    await commandBus.registerHandler('vote.create', {
      execute: async (command) => {
        const db = await ctx.resolve<any>(IDatabaseToken);
        const payload = command.payload as any;
        const { lessonId, title, options } = payload;
        
        const voteId = 'vote_' + Math.random().toString(36).slice(2, 10);
        const x = payload.x !== undefined ? payload.x : 150;
        const y = payload.y !== undefined ? payload.y : 150;

        console.log(`[Raffle & Vote] Creating vote "${title}" for lesson ${lessonId} at (${x}, ${y})`);

        // A. 绘制背景圆角矩形
        const bgHeight = 65 + options.length * 45;
        const bgDraw = await commandBus.execute({
          id: 'draw_bg_' + voteId,
          type: 'whiteboard.draw',
          actorId: command.actorId || `plugin:${ctx.manifest.id}`,
          payload: {
            lessonId,
            type: 'rectangle',
            data: JSON.stringify({
              x, y,
              width: 380,
              height: bgHeight,
              fill: '#f8fafc', // slate-50
              stroke: '#cbd5e1', // slate-300
              strokeWidth: 2,
              cornerRadius: 8
            })
          }
        }) as any;
        const bgElementId = bgDraw?.elementId;

        // B. 绘制投票标题文本
        const titleDraw = await commandBus.execute({
          id: 'draw_title_' + voteId,
          type: 'whiteboard.draw',
          actorId: command.actorId || `plugin:${ctx.manifest.id}`,
          payload: {
            lessonId,
            type: 'text',
            data: JSON.stringify({
              x: x + 15,
              y: y + 15,
              text: `📊 投票: ${title}`,
              fontSize: 15,
              fill: '#0f172a',
              width: 350
            })
          }
        }) as any;
        const titleElementId = titleDraw?.elementId;

        // C. 循环绘制每个选项的条形柱子(rectangle)和选项文本(text)
        const optionElementIds: any[] = [];
        for (let i = 0; i < options.length; i++) {
          // 条形柱（初始票数 0，给极小宽度 15 作为视觉锚点）
          const barDraw = await commandBus.execute({
            id: `draw_bar_${voteId}_${i}`,
            type: 'whiteboard.draw',
            actorId: command.actorId || `plugin:${ctx.manifest.id}`,
            payload: {
              lessonId,
              type: 'rectangle',
              data: JSON.stringify({
                x: x + 20,
                y: y + 50 + i * 45,
                width: 15,
                height: 18,
                fill: '#38bdf8', // sky-400
                strokeWidth: 0,
                cornerRadius: 3
              })
            }
          }) as any;
          
          // 选项文字说明
          const labelDraw = await commandBus.execute({
            id: `draw_label_${voteId}_${i}`,
            type: 'whiteboard.draw',
            actorId: command.actorId || `plugin:${ctx.manifest.id}`,
            payload: {
              lessonId,
              type: 'text',
              data: JSON.stringify({
                x: x + 20,
                y: y + 50 + i * 45 + 20,
                text: `${options[i]}: 0 票 (0%)`,
                fontSize: 12,
                fill: '#475569',
                width: 340
              })
            }
          }) as any;

          optionElementIds.push({
            barId: barDraw?.elementId,
            labelId: labelDraw?.elementId
          });
        }

        // D. 写入隔离数据库 votes 表 (注意这里使用 await 适配异步 Worker 模式)
        const tblVotes = ctx.db.table('votes');
        await db.prepare(`INSERT INTO ${tblVotes} (id, lesson_id, title, options, element_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
          voteId, lessonId, title, JSON.stringify(options), JSON.stringify({
            bgId: bgElementId,
            titleId: titleElementId,
            options: optionElementIds,
            x, y
          }), Date.now()
        );

        return {
          success: true,
          voteId,
          elements: { bgElementId, titleElementId, options: optionElementIds }
        };
      }
    });

    // ── 7. 绑定 vote.cast 处理器 ────────────────────────────────────────────
    await commandBus.registerHandler('vote.cast', {
      execute: async (command) => {
        const db = await ctx.resolve<any>(IDatabaseToken);
        const payload = command.payload as any;
        const { lessonId, voteId, optionIndex, voterId } = payload;

        const tblVotes = ctx.db.table('votes');
        const tblCast = ctx.db.table('votes_cast');

        // A. 查询投票配置 (注意这里使用 await 适配异步 Worker 模式)
        const voteConfig = await db.prepare(`SELECT * FROM ${tblVotes} WHERE id = ? AND lesson_id = ?`).get(voteId, lessonId) as any;
        if (!voteConfig) {
          throw new Error(`找不到指定的投票活动 "${voteId}"`);
        }

        const options = JSON.parse(voteConfig.options);
        const elementIds = JSON.parse(voteConfig.element_ids);

        if (optionIndex < 0 || optionIndex >= options.length) {
          throw new Error(`非法的选项索引 ${optionIndex}`);
        }

        // B. 防止重复投票检查 (注意这里使用 await)
        const checkVoted = await db.prepare(`SELECT count(*) as count FROM ${tblCast} WHERE vote_id = ? AND voter_id = ?`).get(voteId, voterId) as { count: number };
        if (checkVoted.count > 0) {
          throw new Error(`学生 "${voterId}" 已经投过票了，不可重复作答`);
        }

        // C. 插入新选票 (注意这里使用 await)
        await db.prepare(`INSERT INTO ${tblCast} (vote_id, option_index, voter_id, timestamp) VALUES (?, ?, ?, ?)`).run(
          voteId, optionIndex, voterId, Date.now()
        );

        // D. 统计所有选项的最新票数 (注意这里使用 await)
        const allVotes = await db.prepare(`SELECT option_index, count(*) as count FROM ${tblCast} WHERE vote_id = ? GROUP BY option_index`).all(voteId) as { option_index: number, count: number }[];
        
        const counts: Record<number, number> = {};
        let totalVotes = 0;
        for (let i = 0; i < options.length; i++) {
          counts[i] = 0;
        }
        for (const v of allVotes) {
          counts[v.option_index] = v.count;
          totalVotes += v.count;
        }

        // E. 重新计算每项柱状图的宽度，并调用 whiteboard.update 动态更新画板
        for (let i = 0; i < options.length; i++) {
          const count = counts[i];
          const pct = totalVotes > 0 ? (count / totalVotes) : 0;
          
          // 最大宽度 280px (100%)，最小 15px (确保底座可见)
          const barWidth = Math.max(15, pct * 280);
          const optionRefs = elementIds.options[i];

          // F. 更新条形柱宽度
          await commandBus.execute({
            id: 'update_bar_' + Math.random().toString(36).slice(2),
            type: 'whiteboard.update',
            actorId: command.actorId || `plugin:${ctx.manifest.id}`,
            payload: {
              lessonId,
              elementId: optionRefs.barId,
              data: JSON.stringify({
                x: elementIds.x + 20,
                y: elementIds.y + 50 + i * 45,
                width: barWidth,
                height: 18,
                fill: pct === 0 ? '#cbd5e1' : '#38bdf8', // 0 票显示灰色，有票显示亮蓝色
                strokeWidth: 0,
                cornerRadius: 3
              })
            }
          });

          // G. 更新选项票数和百分比文本
          await commandBus.execute({
            id: 'update_label_' + Math.random().toString(36).slice(2),
            type: 'whiteboard.update',
            actorId: command.actorId || `plugin:${ctx.manifest.id}`,
            payload: {
              lessonId,
              elementId: optionRefs.labelId,
              data: JSON.stringify({
                x: elementIds.x + 20,
                y: elementIds.y + 50 + i * 45 + 20,
                text: `${options[i]}: ${count} 票 (${Math.round(pct * 100)}%)`,
                fontSize: 12,
                fill: '#374151',
                width: 340
              })
            }
          });
        }

        // H. 发布选票投递成功事件
        await ctx.services.eventBus.publish({
          id: 'evt_vote_' + Math.random().toString(36).slice(2),
          type: 'vote.cast_succeeded',
          source: 'plugin.raffle_vote',
          payload: { voteId, optionIndex, voterId, totalVotes },
          timestamp: Date.now()
        });

        return { success: true, totalVotes };
      }
    });

    // ── 8. 绑定 vote.export 处理器 ──────────────────────────────────────────
    await commandBus.registerHandler('vote.export', {
      execute: async (command) => {
        const db = await ctx.resolve<any>(IDatabaseToken);
        const payload = command.payload as any;
        const { voteId } = payload;
        
        const tblVotes = ctx.db.table('votes');
        const tblCast = ctx.db.table('votes_cast');

        // A. 查询投票配置与所有选票 (注意使用 await)
        const vote = await db.prepare(`SELECT * FROM ${tblVotes} WHERE id = ?`).get(voteId) as any;
        if (!vote) {
          throw new Error(`找不到指定的投票活动 "${voteId}"`);
        }

        const options = JSON.parse(vote.options);
        const votesCast = await db.prepare(`SELECT * FROM ${tblCast} WHERE vote_id = ? ORDER BY timestamp ASC`).all(voteId) as any[];

        // 统计汇总
        const counts: Record<number, number> = {};
        let total = 0;
        options.forEach((_: any, i: number) => { counts[i] = 0; });
        votesCast.forEach(v => {
          counts[v.option_index] = (counts[v.option_index] || 0) + 1;
          total++;
        });

        const fn = payload.filename || `vote_results_${voteId}.xlsx`;

        // B. 尝试使用 xlsx 导出 Excel，如果没有安装则降级为 CSV 格式导出
        let xlsxMod: any = null;
        try {
          xlsxMod = ctx.require('xlsx');
        } catch {
          console.warn('[Raffle & Vote Plugin] xlsx library is missing. Falling back to CSV export.');
        }

        if (xlsxMod) {
          // B-1. 使用 xlsx 库生成双 Sheet 表格并写入 VFS
          const wb = xlsxMod.utils.book_new();

          // Sheet 1: 汇总
          const summaryRows = options.map((opt: string, i: number) => ({
            '选项': opt,
            '得票数': counts[i],
            '占比': total > 0 ? `${Math.round((counts[i] / total) * 100)}%` : '0%'
          }));
          const wsSummary = xlsxMod.utils.json_to_sheet(summaryRows);
          xlsxMod.utils.book_append_sheet(wb, wsSummary, '投票汇总');

          // Sheet 2: 明细
          const detailRows = votesCast.map(v => ({
            '投票人ID': v.voter_id,
            '所选选项': options[v.option_index],
            '投票时间': new Date(v.timestamp).toISOString()
          }));
          const wsDetails = xlsxMod.utils.json_to_sheet(detailRows);
          xlsxMod.utils.book_append_sheet(wb, wsDetails, '投票明细');

          const excelBuffer = xlsxMod.write(wb, { type: 'buffer', bookType: 'xlsx' });
          
          await commandBus.execute({
            id: 'export_vfs_excel_' + Math.random().toString(36).slice(2),
            type: 'vfs.write_file',
            actorId: command.actorId || `plugin:${ctx.manifest.id}`,
            payload: {
              path: `/exports/${fn}`,
              content: excelBuffer.toString('base64'),
              encoding: 'base64'
            }
          });

          return { success: true, path: `/exports/${fn}`, format: 'xlsx', totalVotes: total };
        } else {
          // B-2. 降级为简易 CSV 格式导出
          let csv = '\uFEFF'; // BOM 头防止中文乱码
          csv += `投票主题,"${vote.title}"\n`;
          csv += `总票数,${total}\n\n`;
          csv += '--- 投票汇总 ---\n';
          csv += '选项,票数,占比\n';
          options.forEach((opt: string, i: number) => {
            const pct = total > 0 ? `${Math.round((counts[i] / total) * 100)}%` : '0%';
            csv += `"${opt.replace(/"/g, '""')}",${counts[i]},${pct}\n`;
          });

          csv += '\n--- 投票明细 ---\n';
          csv += '投票人ID,所选选项,投票时间\n';
          votesCast.forEach(v => {
            csv += `${v.voter_id},"${options[v.option_index].replace(/"/g, '""')}",${new Date(v.timestamp).toISOString()}\n`;
          });

          const csvFilename = fn.replace(/\.xlsx$/i, '.csv');

          await commandBus.execute({
            id: 'export_vfs_csv_' + Math.random().toString(36).slice(2),
            type: 'vfs.write_file',
            actorId: command.actorId || `plugin:${ctx.manifest.id}`,
            payload: {
              path: `/exports/${csvFilename}`,
              content: Buffer.from(csv, 'utf-8').toString('base64'),
              encoding: 'base64'
            }
          });

          return { success: true, path: `/exports/${csvFilename}`, format: 'csv', totalVotes: total };
        }
      }
    });

    // ── 9. 绑定 raffle.draw 处理器 ──────────────────────────────────────────
    await commandBus.registerHandler('raffle.draw', {
      execute: async (command) => {
        const db = await ctx.resolve<any>(IDatabaseToken);
        const payload = command.payload as any;
        const { lessonId } = payload;

        const x = payload.x !== undefined ? payload.x : 200;
        const y = payload.y !== undefined ? payload.y : 200;

        let nameList: string[] = [];

        // A. 如果提供了候选人名单，直接使用
        if (payload.candidates && Array.isArray(payload.candidates) && payload.candidates.length > 0) {
          nameList = payload.candidates;
        } else {
          // B. 否则，从系统课时关联的班级花名册中抽取学生 (注意使用 await)
          try {
            const lesson = await db.prepare('SELECT class_id FROM lessons WHERE id = ?').get(lessonId) as { class_id: string } | undefined;
            if (lesson && lesson.class_id) {
              const students = await db.prepare(`
                SELECT s.name 
                FROM students s
                JOIN class_students cs ON s.id = cs.student_id
                WHERE cs.class_id = ?
              `).all(lesson.class_id) as { name: string }[];
              
              nameList = students.map(s => s.name);
            }
          } catch (e: any) {
            console.warn('[Raffle & Vote Plugin] Failed to fetch students from DB, falling back to mocks:', e.message);
          }
        }

        // C. 如果名单为空，提供一组极具趣味的兜底名字
        if (nameList.length === 0) {
          nameList = ['艾达·洛夫莱斯', '阿兰·图灵', '葛丽丝·霍普', '约翰·冯·诺伊曼', '克劳德·香农', '高德纳'];
        }

        // D. 随机抽选一名中奖者
        const winnerIndex = Math.floor(Math.random() * nameList.length);
        const winnerName = nameList[winnerIndex];

        console.log(`[Raffle & Vote] Drawn winner: ${winnerName} out of ${nameList.length} candidates`);

        // E. 在白板上绘制一个耀眼的喜报框（圆角矩形）
        const bgDraw = await commandBus.execute({
          id: 'draw_raffle_bg_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          actorId: command.actorId || `plugin:${ctx.manifest.id}`,
          payload: {
            lessonId,
            type: 'rectangle',
            data: JSON.stringify({
              x, y,
              width: 320,
              height: 180,
              fill: '#fef08a', // yellow-100 (黄金微风)
              stroke: '#eab308', // yellow-500 (纯金色)
              strokeWidth: 3,
              cornerRadius: 12
            })
          }
        }) as any;

        // F. 绘制中奖提示文本
        await commandBus.execute({
          id: 'draw_raffle_head_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          actorId: command.actorId || `plugin:${ctx.manifest.id}`,
          payload: {
            lessonId,
            type: 'text',
            data: JSON.stringify({
              x: x + 15,
              y: y + 25,
              text: '🎉 课堂幸运抽奖 🎉',
              fontSize: 18,
              fill: '#854d0e', // yellow-800
              width: 290
            })
          }
        });

        // G. 绘制喜报中奖人姓名
        await commandBus.execute({
          id: 'draw_raffle_winner_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          actorId: command.actorId || `plugin:${ctx.manifest.id}`,
          payload: {
            lessonId,
            type: 'text',
            data: JSON.stringify({
              x: x + 20,
              y: y + 80,
              text: `恭喜中奖人: ${winnerName}`,
              fontSize: 22,
              fill: '#b45309', // amber-700
              width: 280
            })
          }
        });

        return {
          success: true,
          winner: winnerName,
          totalCandidates: nameList.length,
          cardElementId: bgDraw?.elementId
        };
      }
    });
  },

  deactivate: async () => {
    console.log('[Raffle & Vote Plugin] Deactivating plugin...');
  }
};
