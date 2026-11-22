/**
 * 教学模式包目录接口。
 *
 * 供课程向导渲染「交付模式」选项：内置白板 / 学案 + 已激活插件声明的
 * `contributes['mode.pack']`。只读，登录用户即可访问。
 *
 * 阶段 8 起附带能力诊断：插件声明了 `adapterIds` / `channels` 但当前未注册时，
 * 目录条目带 `warnings`，便于管理员在向导里发现「装了包但成绩/消息不可用」。
 */
import type { Request, Response } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ISubmissionRegistryToken, type SubmissionRegistry } from '../../packages/core/submission-adapter/index.js';
import { IClassroomMessageServiceToken, type IClassroomMessageService } from '../../packages/core/di/interfaces.js';
import type { ClassroomMessageService } from '../../packages/core/di/classroom-message-service.js';
import type { ServerContext } from '../context.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { listModePacks, type ModePackCapabilities } from '../services/mode-pack-catalog.js';

async function readCapabilities(): Promise<ModePackCapabilities | undefined> {
  try {
    const registry = await kernelContainer.serviceRegistry.resolve<SubmissionRegistry>(ISubmissionRegistryToken);
    const messages =
      await kernelContainer.serviceRegistry.resolve<IClassroomMessageService>(IClassroomMessageServiceToken);
    return {
      adapterIds: new Set(registry.list().map((adapter) => adapter.descriptor.id)),
      channelNames: new Set((messages as ClassroomMessageService).listChannels().map((channel) => channel.name)),
    };
  } catch {
    // 服务未就绪时跳过诊断，不影响目录返回。
    return undefined;
  }
}

export function registerModePackRoutes(ctx: ServerContext): void {
  ctx.app.get('/api/mode-packs', requireScopedAuth('authenticated'), async (_req: Request, res: Response) => {
    const capabilities = await readCapabilities();
    const packs = listModePacks(capabilities);
    res.json({ ok: true, data: packs, total: packs.length });
  });
}
