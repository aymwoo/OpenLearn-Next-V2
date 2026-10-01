import path from 'path';
import fs from 'fs';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { injectLmsSdk, collectCoursewareRuntimeScripts, setCoursewareDocumentCsp } from './shared.js';
import { verifyCoursewareToken } from '../utils/courseware-access.js';
import { isPathInsideRoot } from '../utils/path-guard.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';

export function registerBridgeRoutes(ctx: ServerContext) {
  const { app } = ctx;

  // 白板 srcDoc 路径（`src/features/whiteboard/utils/bridgeUtils.ts` 注入 `<script src="/bridge.js">`）
  // 无法走服务端 HTML 拼接，因此这里把同一套「课件运行时脚本」一并下发，
  // 让手工 HTML 白板/内联课件也能被平台原生监视器覆盖。
  app.get('/bridge.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const cw = typeof req.query.cw === 'string' ? req.query.cw : '';
    const cwName = typeof req.query.name === 'string' ? req.query.name : '';
    let runtimeScripts = '';
    try {
      const scripts = collectCoursewareRuntimeScripts({ id: cw, name: cwName, uuid: cw });
      runtimeScripts = scripts.head + scripts.bodyEnd;
    } catch (e) {
      runtimeScripts = '';
    }
    res.send(runtimeScripts ? `${BRIDGE_SDK_CODE}\n${runtimeScripts}` : BRIDGE_SDK_CODE);
  });

  app.get('/runtime/:uuid', (req, res, next) => {
    if (req.path.endsWith('/')) return next();
    res.redirect(`/runtime/${req.params.uuid}/`);
  });

  app.get('/runtime/:uuid/*', (req, res) => {
    try {
      const { uuid } = req.params;
      let subpath = req.params[0] || '';

      // SEC-AUTH: /runtime 原先完全无鉴权 —— 未认证者可读取任意课件文件，且触发
      // courseware 行自动登记（INSERT）与磁盘自愈写。沙箱 iframe 的请求不带会话
      // cookie，无法 requireAuth，改为以下放行规则（缺一不可的判据见各注释）：
      // 1. `?ct=` 短时 HMAC token：父页面（已认证）经 /api/courseware/:id/access-token
      //    铸造，与 uuid 绑定 —— 覆盖无 Sec-Fetch 元数据的旧浏览器/特殊 webview
      // 2. `Sec-Fetch-Site: same-origin`：父应用同源上下文发起（缩略图/父页面直接取资源）
      // 3. `Sec-Fetch-Dest` 存在且非 `document`：沙箱 iframe（opaque origin）内发起的
      //    子资源/子框架请求 —— 其 initiator 为不透明 origin，Site 恒为 cross-site，
      //    只能以「浏览器自动添加了 Dest 元数据且非顶级文档导航」判定
      // 直连（地址栏 Dest=document、curl 无元数据）→ 401，且早于任何 DB/磁盘写。
      // 外部站点 iframe 嵌入由下方 HTML 响应的 `frame-ancestors 'self'` 挡下；
      // 伪造 Sec-Fetch 头仅限非浏览器客户端（残余风险已知，资源本身非机密）。
      const hasToken = verifyCoursewareToken(uuid, typeof req.query.ct === 'string' ? req.query.ct : null);
      const dest = req.headers['sec-fetch-dest'];
      const site = req.headers['sec-fetch-site'];
      const browserInitiated =
        site === 'same-origin' || (typeof dest === 'string' && dest !== '' && dest !== 'document');
      if (!hasToken && !browserInitiated) {
        return res.status(401).send('Courseware access token missing or invalid');
      }

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
                  // SEC-LOW-01: 严格根内判定；磁盘缓存自愈路径，越界条目告警跳过不阻塞
                  if (!isPathInsideRoot(storageDir, target)) {
                    console.warn('[bridge] skip path escape:', f.path);
                    continue;
                  }
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
      // SEC-LOW-01: 严格根内判定（裸 startsWith 前缀可被同级目录逃逸）
      if (!isPathInsideRoot(storageDir, filePath)) {
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
        // SEC-AUTH: frame-ancestors 'self' 挡外部站点嵌入（本自有 CSP 覆盖 Helmet 全局头）
        setCoursewareDocumentCsp(res);
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
