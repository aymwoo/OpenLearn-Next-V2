/**
 * 教学模式包目录接口。
 *
 * 供课程向导渲染「交付模式」选项：内置白板 / 学案 + 已激活插件声明的
 * `contributes['mode.pack']`。只读，登录用户即可访问。
 */
import type { Request, Response } from 'express';
import type { ServerContext } from '../context.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { listModePacks } from '../services/mode-pack-catalog.js';

export function registerModePackRoutes(ctx: ServerContext): void {
  ctx.app.get('/api/mode-packs', requireScopedAuth('authenticated'), (_req: Request, res: Response) => {
    const packs = listModePacks();
    res.json({ ok: true, data: packs, total: packs.length });
  });
}
