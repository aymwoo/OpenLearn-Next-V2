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

      // 1. Courseware 查询（支持 uuid 或 id 匹配）
      let courseware = kernelContainer.db
        .prepare('SELECT * FROM courseware WHERE uuid = ? OR id = ?')
        .get(uuid, uuid) as any;

      // 2. 若 courseware 未命中，尝试向系统资源库 system_resources 回溯检索并动态自愈登记
      if (!courseware) {
        const resRow = kernelContainer.db.prepare('SELECT * FROM system_resources WHERE id = ?').get(uuid) as any;
        if (resRow) {
          const entryName =
            resRow.name && (resRow.name.endsWith('.html') || resRow.name.endsWith('.htm'))
              ? path.basename(resRow.name.replace(/\\/g, '/'))
              : 'index.html';
          const createdAt = resRow.created_at || Date.now();
          kernelContainer.db
            .prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(resRow.id, resRow.id, resRow.name, resRow.type || 'html', entryName, createdAt);
          courseware = {
            id: resRow.id,
            uuid: resRow.id,
            name: resRow.name,
            type: resRow.type || 'html',
            entry: entryName,
            created_at: createdAt,
          };
        }
      }

      if (!courseware) {
        return res.status(404).send('Courseware not found');
      }

      const storageDir = path.resolve(process.cwd(), 'storage', 'courseware', courseware.uuid);

      // 3. 磁盘物理目录检测与自动补全 / 自愈（若存储目录不存在或为空，尝试从 system_resources 还原）
      if (!fs.existsSync(storageDir) || fs.readdirSync(storageDir).length === 0) {
        let resRow = kernelContainer.db
          .prepare('SELECT * FROM system_resources WHERE id = ? OR id = ?')
          .get(courseware.uuid, courseware.id) as any;
        if (!resRow && courseware.name) {
          const nameCandidate = courseware.name.endsWith('.html') ? courseware.name : `${courseware.name}.html`;
          resRow = kernelContainer.db
            .prepare('SELECT * FROM system_resources WHERE name = ? OR name = ?')
            .get(courseware.name, nameCandidate) as any;
        }

        if (resRow && resRow.content) {
          fs.mkdirSync(storageDir, { recursive: true });
          if (resRow.type === 'html') {
            const originalName =
              resRow.name && (resRow.name.endsWith('.html') || resRow.name.endsWith('.htm'))
                ? path.basename(resRow.name.replace(/\\/g, '/'))
                : courseware.entry || 'index.html';
            const safeEntry = path.basename(originalName.replace(/\\/g, '/'));
            fs.writeFileSync(path.resolve(storageDir, safeEntry), resRow.content, 'utf8');
            if (safeEntry !== 'index.html') {
              fs.writeFileSync(path.resolve(storageDir, 'index.html'), resRow.content, 'utf8');
            }
          } else if (resRow.type === 'folder') {
            try {
              const files = JSON.parse(resRow.content || '[]');
              for (const f of files) {
                if (f.path && f.content !== undefined) {
                  const cleanRel = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
                  const target = path.resolve(storageDir, cleanRel);
                  if (target.startsWith(storageDir)) {
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    const isBin = /\.(png|jpe?g|gif|webp|ico)$/i.test(cleanRel);
                    if (isBin) {
                      const cleanBase64 = f.content.replace(/^data:[^;]+;base64,/, '');
                      fs.writeFileSync(target, Buffer.from(cleanBase64, 'base64'));
                    } else {
                      fs.writeFileSync(target, f.content, 'utf8');
                    }
                  }
                }
              }
            } catch (e) {
              console.error('[bridge] Failed to unpack folder resource to storageDir:', e);
            }
          }
        }
      }

      // 4. 入口文件路径确定
      if (!subpath || subpath === '') {
        subpath = courseware.entry || 'index.html';
      }

      let filePath = path.resolve(storageDir, subpath);
      if (!filePath.startsWith(storageDir)) {
        return res.status(403).send('Access denied');
      }

      // 5. 容错与智能入口重定向 / 自愈：如果指定 subpath（如 index.html）在磁盘上不存在
      if (!fs.existsSync(filePath) && fs.existsSync(storageDir)) {
        const dirEntries = fs.readdirSync(storageDir);
        const isLookingForEntry =
          !subpath ||
          subpath === '' ||
          subpath === 'index.html' ||
          subpath === 'index.htm' ||
          subpath === courseware.entry;

        if (isLookingForEntry) {
          // 查找优先级：courseware.entry > courseware.name 对应 html > 根目录下任意首个 .html / .htm 文件
          let candidate = dirEntries.find(
            (f) => f === courseware.entry && fs.statSync(path.join(storageDir, f)).isFile(),
          );
          if (!candidate && courseware.name) {
            const nameCandidate = courseware.name.endsWith('.html') ? courseware.name : `${courseware.name}.html`;
            candidate = dirEntries.find(
              (f) =>
                (f === nameCandidate || f.toLowerCase() === nameCandidate.toLowerCase()) &&
                fs.statSync(path.join(storageDir, f)).isFile(),
            );
          }
          if (!candidate) {
            candidate = dirEntries.find((f) => {
              const lower = f.toLowerCase();
              return (
                (lower.endsWith('.html') || lower.endsWith('.htm')) && fs.statSync(path.join(storageDir, f)).isFile()
              );
            });
          }

          if (candidate) {
            filePath = path.resolve(storageDir, candidate);
            // 自愈：确保 storageDir 下同时生成 index.html 副本，保障后续标准访问
            try {
              const indexHtmlPath = path.resolve(storageDir, 'index.html');
              if (!fs.existsSync(indexHtmlPath)) {
                fs.copyFileSync(filePath, indexHtmlPath);
              }
              if (courseware.entry !== candidate) {
                kernelContainer.db
                  .prepare('UPDATE courseware SET entry = ? WHERE id = ?')
                  .run(candidate, courseware.id);
                courseware.entry = candidate;
              }
            } catch (healErr) {
              console.warn('[bridge] Failed to self-heal index.html or courseware entry:', healErr);
            }
          } else {
            // 若根目录下无 html 文件，扫描首层子目录（针对打包时最外层套了一层文件夹的 ZIP）
            for (const entry of dirEntries) {
              const subDirPath = path.join(storageDir, entry);
              if (fs.statSync(subDirPath).isDirectory()) {
                const subEntries = fs.readdirSync(subDirPath);
                const subCandidate =
                  subEntries.find((f) => f.toLowerCase() === 'index.html' || f.toLowerCase() === 'index.htm') ||
                  subEntries.find((f) => f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm'));
                if (subCandidate) {
                  const redirectPath = `${entry}/${subCandidate}`;
                  return res.redirect(`/runtime/${uuid}/${redirectPath}`);
                }
              }
            }
          }
        }
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(`File not found: ${subpath}`);
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const dirFiles = fs.readdirSync(filePath);
        const htmlFile =
          dirFiles.find((f) => f.toLowerCase() === 'index.html' || f.toLowerCase() === 'index.htm') ||
          dirFiles.find((f) => f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm'));
        if (htmlFile) {
          const base = subpath ? (subpath.endsWith('/') ? subpath : subpath + '/') : '';
          return res.redirect(`/runtime/${uuid}/${base}${htmlFile}`);
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
        res.setHeader(
          'Content-Security-Policy',
          "sandbox allow-scripts allow-forms allow-downloads; default-src 'self' 'unsafe-inline' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src-attr 'unsafe-inline'; style-src-attr 'unsafe-inline';",
        );
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
