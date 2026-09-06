import path from 'path';
import fs from 'fs';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { injectLmsSdk } from './shared.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';

export function registerBridgeRoutes(ctx: ServerContext) {
  const { app } = ctx;

  app.get('/bridge.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(BRIDGE_SDK_CODE);
  });

  app.get('/runtime/:uuid', (req, res, next) => {
    if (req.path.endsWith('/')) return next();
    res.redirect(`/runtime/${req.params.uuid}/`);
  });

  app.get('/runtime/:uuid/*', (req, res) => {
    try {
      const { uuid } = req.params;
      let subpath = req.params[0] || '';
      
      const courseware = kernelContainer.db.prepare('SELECT * FROM courseware WHERE uuid = ?').get(uuid) as any;
      if (!courseware) {
        return res.status(404).send('Courseware not found');
      }

      if (!subpath || subpath === '') {
        subpath = courseware.entry;
      }

      const storageDir = path.resolve(process.cwd(), 'storage', 'courseware', uuid);
      const filePath = path.resolve(storageDir, subpath);
      if (!filePath.startsWith(storageDir)) {
        return res.status(403).send('Access denied');
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(`File not found: ${subpath}`);
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const indexHtml = path.join(filePath, 'index.html');
        if (fs.existsSync(indexHtml)) {
          return res.redirect(`/runtime/${uuid}/${subpath.endsWith('/') ? subpath : subpath + '/'}index.html`);
        }
        return res.status(404).send('Directory index not found');
      }

      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'text/plain; charset=utf-8';
      if (ext === '.html' || ext === '.htm') contentType = 'text/html; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css; charset=utf-8';
      else if (ext === '.js' || ext === '.mjs') contentType = 'application/javascript; charset=utf-8';
      else if (ext === '.json') contentType = 'application/json; charset=utf-8';
      else if (ext === '.svg') contentType = 'image/svg+xml; charset=utf-8';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.gif') contentType = 'image/gif';
      else if (ext === '.webp') contentType = 'image/webp';
      else if (ext === '.ico') contentType = 'image/x-icon';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');

      const isHtml = ext === '.html' || ext === '.htm';
      if (isHtml) {
        let html = fs.readFileSync(filePath, 'utf8');
        html = injectLmsSdk(html, req, { id: courseware.id, name: courseware.name, uuid: courseware.uuid });
        return res.send(html);
      } else {
        return res.sendFile(filePath);
      }
    } catch (e: any) {
      sendSafeError(res, e, 500, 'Failed to load courseware runtime file');
    }
  });

  // Fetch db data
}
