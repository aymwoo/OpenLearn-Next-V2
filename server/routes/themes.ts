import express from 'express';
import path from 'node:path';
import { BUILTIN_THEME_IDS, ThemeValidationError, isBuiltinThemeId } from '../../packages/core/themes/theme-spec.js';
import { MAX_THEME_ZIP_BYTES } from '../../packages/core/themes/theme-package.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';
import { ThemeService, getThemeActorFromSession } from '../services/theme-service.js';
import type { Session } from '../middleware/auth.js';

interface ThemeAuthenticatedRequest extends express.Request {
  session?: Session | null;
}

function actorFromRequest(req: express.Request) {
  const session = (req as ThemeAuthenticatedRequest).session;
  if (!session) {
    throw new ThemeValidationError('Authentication session required', 'UNAUTHORIZED');
  }
  return getThemeActorFromSession(session);
}

function mapThemeErrorStatus(err: ThemeValidationError): number {
  switch (err.code) {
    case 'UPLOADER_MISMATCH':
      return 403;
    case 'VERSION_NOT_HIGHER':
      return 409;
    case 'THEME_NOT_FOUND':
      return 404;
    default:
      return 400;
  }
}

export function registerThemeRoutes(ctx: ServerContext): void {
  const { app } = ctx;
  const getService = () => new ThemeService(kernelContainer.db);

  // Anonymous pre-login endpoint: ONLY visual defaults and public catalog summaries, zero user data.
  app.get('/api/themes/public', (_req, res) => {
    try {
      res.json(getService().getPublicPreLoginState());
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // Serve validated static assets belonging to a theme version
  app.get('/api/themes/:id/assets/:version/*', (req, res) => {
    try {
      const themeId = String(req.params.id || '');
      const version = String(req.params.version || '');
      const relAsset = String((req.params as Record<string, string>)['0'] || '');
      const resolvedFile = getService().resolveThemeAssetFile(themeId, version, relAsset);
      if (!resolvedFile) {
        return res.status(404).json({ error: 'Theme asset not found' });
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      if (path.extname(resolvedFile).toLowerCase() === '.svg') {
        res.setHeader('Content-Security-Policy', 'sandbox');
      }
      return res.sendFile(resolvedFile, { dotfiles: 'deny' });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // Shared authenticated theme catalog
  app.get('/api/themes', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const actor = actorFromRequest(req);
      res.json({
        builtinThemes: BUILTIN_THEME_IDS,
        themes: getService().listCatalog(actor),
      });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // Account-isolated current user theme preferences & resolved active bundle
  app.get('/api/themes/me', requireScopedAuth('self'), (req, res) => {
    try {
      const actor = actorFromRequest(req);
      res.json(getService().getUserThemeState(actor.principalKey));
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // Update current user's isolated theme / version / mode / basic appearance overrides
  app.put('/api/themes/me', requireScopedAuth('self'), (req, res) => {
    try {
      const actor = actorFromRequest(req);
      const { themeId, installedVersion, mode, appearanceOverrides } = req.body || {};
      const next = getService().updateUserThemePreference(actor.principalKey, {
        themeId,
        installedVersion,
        mode,
        appearanceOverrides,
      });
      res.json(next);
    } catch (e) {
      if (e instanceof ThemeValidationError) {
        return res.status(mapThemeErrorStatus(e)).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e);
    }
  });

  // One-click failsafe recovery endpoint for current account
  app.post('/api/themes/me/reset', requireScopedAuth('self'), (req, res) => {
    try {
      const actor = actorFromRequest(req);
      res.json(getService().resetUserThemePreference(actor.principalKey));
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // Install / upgrade third-party theme ZIP package (available to all authenticated roles)
  app.post(
    '/api/themes/install',
    requireScopedAuth('authenticated'),
    express.raw({
      type: ['application/zip', 'application/octet-stream', 'application/x-zip-compressed'],
      limit: MAX_THEME_ZIP_BYTES + 64 * 1024,
    }),
    async (req, res) => {
      try {
        const actor = actorFromRequest(req);
        let zipBuffer: Buffer | null = null;

        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
          zipBuffer = req.body;
        } else if (req.body && typeof req.body === 'object' && typeof req.body.zipBase64 === 'string') {
          const base64Clean = req.body.zipBase64.replace(/^data:[^;]+;base64,/, '');
          zipBuffer = Buffer.from(base64Clean, 'base64');
        }

        if (!zipBuffer || zipBuffer.length === 0) {
          return res.status(400).json({ error: '请上传有效的主题 .zip 压缩包' });
        }

        const result = await getService().installThemePackage(zipBuffer, actor);
        res.status(result.isUpdate ? 200 : 201).json(result);
      } catch (e) {
        if (e instanceof ThemeValidationError) {
          return res.status(mapThemeErrorStatus(e)).json({ error: e.message, code: e.code });
        }
        sendSafeError(res, e);
      }
    },
  );

  // Fetch bundle spec for previewing an active catalog theme
  app.get('/api/themes/:id/bundle', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const themeId = String(req.params.id || '');
      const version = typeof req.query.version === 'string' ? req.query.version : undefined;
      const lookup = getService().getThemeBundle(themeId, version);
      if (lookup.status !== 'active' || !lookup.bundle) {
        return res.status(404).json({ error: '主题不可用或不存在' });
      }
      res.json({
        bundle: lookup.bundle,
        compatible: lookup.compatible,
        compatibilityReason: lookup.compatibilityReason,
      });
    } catch (e) {
      sendSafeError(res, e);
    }
  });

  // Export portable theme .zip bundle
  app.get('/api/themes/:id/export', requireScopedAuth('authenticated'), async (req, res) => {
    try {
      const themeId = String(req.params.id || '');
      if (isBuiltinThemeId(themeId)) {
        return res
          .status(400)
          .json({ error: '系统内置主题无需导出为第三方包，可使用主题设计器基于内置预设导出自定义包' });
      }
      const version = typeof req.query.version === 'string' ? req.query.version : undefined;
      const exported = await getService().exportThemeZip(themeId, version);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.send(exported.buffer);
    } catch (e) {
      if (e instanceof ThemeValidationError) {
        return res.status(mapThemeErrorStatus(e)).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e);
    }
  });

  // Administrator-only governance: disable / re-enable / delete catalog themes
  app.post('/api/themes/:id/disable', requireAuth('administrator'), (req, res) => {
    try {
      const item = getService().setThemeStatus(String(req.params.id || ''), 'disabled');
      res.json({ success: true, theme: item });
    } catch (e) {
      if (e instanceof ThemeValidationError) {
        return res.status(mapThemeErrorStatus(e)).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e);
    }
  });

  app.post('/api/themes/:id/enable', requireAuth('administrator'), (req, res) => {
    try {
      const item = getService().setThemeStatus(String(req.params.id || ''), 'active');
      res.json({ success: true, theme: item });
    } catch (e) {
      if (e instanceof ThemeValidationError) {
        return res.status(mapThemeErrorStatus(e)).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e);
    }
  });

  app.delete('/api/themes/:id', requireAuth('administrator'), (req, res) => {
    try {
      getService().deleteTheme(String(req.params.id || ''));
      res.json({ success: true });
    } catch (e) {
      if (e instanceof ThemeValidationError) {
        return res.status(mapThemeErrorStatus(e)).json({ error: e.message, code: e.code });
      }
      sendSafeError(res, e);
    }
  });
}
