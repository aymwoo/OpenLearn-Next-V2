/**
 * courseware-hub — AI 课件分发与成绩采集插件 v0.2.0
 *
 * 更新：
 *   - VFS 存储替代 DB 存 HTML
 *   - 不可变版本管理
 *   - 学习心跳追踪
 *   - 基础安全扫描
 */
import type { PluginContext } from '@openlearn/plugin-sdk';
import {
  IDatabaseToken,
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ISemesterGradeServiceToken,
} from '@openlearn/plugin-sdk';

// ============================================================
// 类型
// ============================================================

interface ExtractionConfig {
  mode: 'sdk' | 'ai_injected' | 'manual_selector' | 'manual_js_var' | 'manual_entry';
  ai_analysis?: {
    scoreSource: 'dom' | 'js_var' | 'url_hash';
    scoreSelector?: string;
    totalSelector?: string;
    triggerEvent: 'button_click' | 'form_submit' | 'dom_appear';
    triggerSelector?: string;
    jsVarName?: string;
    confidence: number;
  };
  manual_config?: {
    scoreSelector?: string;
    totalSelector?: string;
    triggerSelector?: string;
    triggerEvent?: string;
    jsVarName?: string;
    valueTransform?: string;
  };
  injected_script?: string;
  security_warnings?: string[];
}

interface SecurityScanResult {
  warnings: string[];
  safe: boolean;
}

// ============================================================
// 常量
// ============================================================


const SDK_SCRIPT_INLINE = `
<script data-openlearn-sdk="0.2.0">
(function(){var e=!!window.parent&&window.parent!==window;function t(n,p){if(!e)return!1;try{window.parent.postMessage({type:n,source:"openlearn-cw-sdk",version:"0.2.0",payload:p||{},timestamp:Date.now()},"*");return!0}catch(r){return!1}}
window.OpenLearn={version:"0.2.0",embedded:e,submit:function(n,p,r){return t("courseware:score",{score:n,total:p,detail:r||null})},complete:function(){return t("courseware:complete",{})},emit:function(n,p){return t("courseware:event",{event:n,data:p||{}})}};
var hb=setInterval(function(){t("courseware:heartbeat",{})},30000);
window.addEventListener("beforeunload",function(){t("courseware:closing",{});clearInterval(hb)});
})();
</script>`;

// ============================================================
// 安全扫描
// ============================================================

const SECURITY_CHECKS: { pattern: RegExp; warning: string }[] = [
  { pattern: /<script[^>]*src\s*=\s*["']https?:\/\/(?!cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare)/i, warning: '包含外部脚本引用（非信任CDN）' },
  { pattern: /\beval\s*\(/i, warning: '使用了 eval()' },
  { pattern: /\bdocument\.cookie\b/i, warning: '访问了 document.cookie' },
  { pattern: /\bfetch\s*\(\s*["']https?:\/\//i, warning: '向外部 URL 发起 fetch 请求' },
  { pattern: /XMLHttpRequest/i, warning: '使用了 XMLHttpRequest' },
  { pattern: /\blocalStorage\b/i, warning: '使用了 localStorage' },
  { pattern: /new\s+Function\s*\(/i, warning: '使用了 new Function() 动态执行' },
];

function scanSecurity(html: string): SecurityScanResult {
  const warnings: string[] = [];
  for (const check of SECURITY_CHECKS) {
    if (check.pattern.test(html)) {
      warnings.push(check.warning);
    }
  }
  return { warnings, safe: warnings.length === 0 };
}

// ============================================================
// HTML 处理
// ============================================================

function hasSDKCall(html: string): boolean {
  return /OpenLearn\.submit\s*\(/.test(html)
    || /openlearn-cw-sdk/.test(html)
    || /courseware:score/.test(html);
}

function injectSDK(html: string): string {
  if (hasSDKCall(html)) return html;
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, `${SDK_SCRIPT_INLINE}\n</body>`);
  }
  return html + SDK_SCRIPT_INLINE;
}

function buildAnalysisPrompt(html: string): string {
  const snippet = html.slice(0, 8000);
  return `分析以下 HTML 课件的 JavaScript 代码和 DOM 结构，找出成绩采集方案。

返回纯 JSON（不要 Markdown 代码块）：

{
  "scoreSource": "dom" | "js_var" | "url_hash",
  "scoreSelector": "CSS 选择器，定位到显示成绩的元素",
  "totalSelector": "CSS 选择器，定位到显示总分的元素（如无则 null）",
  "triggerEvent": "button_click" | "form_submit" | "dom_appear",
  "triggerSelector": "CSS 选择器，定位触发成绩显示的按钮/表单",
  "jsVarName": "如果成绩存在 JS 变量中，写出变量名，否则 null",
  "confidence": 0.0-1.0 表示分析可信度
}

规则：
- scoreSelector 必须能唯一定位到成绩元素
- 如果找不到明确的成绩机制，设 confidence 为 0

HTML:\n${snippet}`;
}

function isAiAvailable(db: any): boolean {
  try {
    const provider = db.prepare("SELECT id FROM ai_providers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1").get();
    if (provider) return true;
    if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) return true;
  } catch (e) {}
  return false;
}

function generateExtractionScript(config: ExtractionConfig): string {
  if (config.mode === 'sdk') return '';

  const ai = config.ai_analysis;
  const manual = config.manual_config;
  const sel = ai?.scoreSelector || manual?.scoreSelector;
  const totalSel = ai?.totalSelector || manual?.totalSelector;
  const trigSel = ai?.triggerSelector || manual?.triggerSelector;
  const mode = config.mode;

  if (mode === 'manual_js_var') {
    const varName = ai?.jsVarName || manual?.jsVarName || '__score';
    return `
<script data-openlearn-extractor="auto">
(function(){var v=window["${varName}"];if(v!=null){window.parent.postMessage({type:"courseware:score",source:"ai_injected",payload:{score:typeof v.score!=="undefined"?v.score:v,total:typeof v.total!=="undefined"?v.total:null}}, "*");}})();
</script>`;
  }

  if ((mode === 'manual_selector' || mode === 'ai_injected') && sel) {
    return `
<script data-openlearn-extractor="auto">
(function(){
  var trigger=document.querySelector("${trigSel || 'body'}");
  if(!trigger)return;
  trigger.addEventListener("click",function(){
    setTimeout(function(){
      var s=document.querySelector("${sel}");
      var t=${totalSel ? `document.querySelector("${totalSel}")` : 'null'};
      if(s){
        var sc=parseFloat(s.textContent||s.value);
        var tt=t?parseFloat(t.textContent||t.value):null;
        if(!isNaN(sc)){
          window.parent.postMessage({type:"courseware:score",source:"ai_injected",payload:{score:sc,total:tt||undefined}},"*");
        }
      }
    },500);
  });
})();
</script>`;
  }
  return '';
}

// ============================================================
// 资源辅助函数（通过系统资源库命令总线接口）
// ============================================================

const API_BASE = 'http://127.0.0.1:9000';

async function resourceWrite(ctx: PluginContext, name: string, content: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/resources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'html', content }),
    });
    const data = await res.json() as any;
    if (data.error) { ctx.log.warn(`resource.create failed: ${data.error}`); return null; }
    return data.id || null;
  } catch (e: any) {
    ctx.log.warn(`resource.create error for ${name}: ${e.message}`);
    return null;
  }
}

async function resourceRead(ctx: PluginContext, id: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/resources/${id}`);
    if (!res.ok) { ctx.log.warn(`resource.get HTTP ${res.status} for ${id}`); return null; }
    const row = await res.json() as any;
    return row?.content || null;
  } catch (e: any) {
    ctx.log.warn(`resource.get error for ${id}: ${e.message}`);
    return null;
  }
}

async function resourceDelete(ctx: PluginContext, id: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/resources/${id}`, { method: 'DELETE' });
  } catch (e: any) {
    // 删除失败不阻塞
  }
}

// ============================================================
// DB 辅助
// ============================================================

interface CoursewareRow {
  id: string;
  courseware_key: string;
  version: number;
  title: string;
  description: string;
  html_vfs_path: string;
  injected_html_vfs_path: string;
  extraction_config: string;
  security_warnings: string;
  pass_score: number;
  target_classes: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// activate
// ============================================================

export default {
  manifest: {
    id: '@courseware-hub/plugin',
    name: '课件中心',
    version: '0.2.0',
    description: 'AI课件分发与成绩采集。上传交互式HTML课件，学生端渲染，自动捕获成绩并回传学习系统。',
    author: 'OpenLearn Developer',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:IAIService@^1.0.0',
      '@openlearn/core:IStorageService@^1.0.0',
      '@openlearn/core:ICapabilityService@^1.0.0',
      '@openlearn/core:ISemesterGradeService@^1.0.0',
    ],
    capabilitiesProposed: [
      'courseware:read', 'courseware:write', 'courseware:admin',
      'lesson:read', 'vfs:read', 'vfs:write',
    ],
    classroomTools: [
      { id: 'courseware-hub-teacher', name: '课件管理', icon: 'BookOpen', commandType: 'whiteboard.draw', payload: { lessonId: '$lessonId', type: 'plugin', data: JSON.stringify({ pluginId: '@courseware-hub/plugin', title: '课件管理', teacherWidgetId: 'courseware-hub-teacher', studentWidgetId: 'courseware-hub-student', width: 900, height: 600 }) } },
    ],
    engines: { openlearn: '>=5.1.0' },
  },

  async activate(ctx: PluginContext) {
    const commandBus = ctx.services.commandBus;
    const eventBus = ctx.services.eventBus;
    const actionRegistry = ctx.services.actionRegistry;
    const db = await ctx.resolve(IDatabaseToken);

    const cwTable = ctx.db.table('coursewares');
    await ctx.db.ensureTable('coursewares', `
      id TEXT PRIMARY KEY,
      courseware_key TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      html_vfs_path TEXT NOT NULL,
      injected_html_vfs_path TEXT NOT NULL,
      extraction_config TEXT DEFAULT '{"mode":"sdk"}',
      security_warnings TEXT DEFAULT '[]',
      pass_score INTEGER DEFAULT 60,
      target_classes TEXT DEFAULT '[]',
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    `);

    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_cw_key ON ${cwTable}(courseware_key);`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_cw_key_version ON ${cwTable}(courseware_key, version DESC);`).run();

    const scTable = ctx.db.table('scores');
    await ctx.db.ensureTable('scores', `
      id TEXT PRIMARY KEY,
      courseware_id TEXT NOT NULL,
      courseware_version INTEGER NOT NULL DEFAULT 1,
      student_id TEXT NOT NULL,
      student_name TEXT DEFAULT '',
      score REAL NOT NULL,
      total REAL NOT NULL,
      detail TEXT DEFAULT '{}',
      submit_source TEXT DEFAULT 'sdk',
      time_spent INTEGER DEFAULT 0,
      submitted_at TEXT DEFAULT (datetime('now'))
    `);

    const hbTable = ctx.db.table('heartbeats');
    await ctx.db.ensureTable('heartbeats', `
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseware_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      progress_data TEXT DEFAULT '{}',
      heartbeat_count INTEGER DEFAULT 1,
      first_heartbeat TEXT DEFAULT (datetime('now')),
      last_heartbeat TEXT DEFAULT (datetime('now')),
      UNIQUE(courseware_id, student_id)
    `);

    // ============================================================
    // Command Handlers
    // ============================================================

    /** 上传课件（创建新版本） */
    await commandBus.registerHandler('courseware.upload', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const title = p.title || '未命名课件';
        const htmlContent = p.html_content || '';

        // 安全检查
        const scan = scanSecurity(htmlContent);
        ctx.log.info(`Security scan: ${scan.warnings.length} warnings, safe=${scan.safe}`);

        // 确定 courseware_key：如果是更新已有课件则复用
        let coursewareKey = p.courseware_key;
        let nextVersion = 1;

        if (coursewareKey) {
          const latest = await db.prepare(
            `SELECT MAX(version) as mv FROM ${cwTable} WHERE courseware_key = ?`
          ).get(coursewareKey) as any;
          nextVersion = (latest?.mv || 0) + 1;
        } else {
          coursewareKey = globalThis.crypto.randomUUID();
        }

        // AI 分析 + SDK 注入
        let injected = htmlContent;
        let extractionConfig: ExtractionConfig = { mode: 'sdk', security_warnings: scan.warnings };

        if (!hasSDKCall(htmlContent)) {
          if (isAiAvailable(db)) {
            try {
              const aiResponse = await ctx.services.ai.generateText(buildAnalysisPrompt(htmlContent));
              const analysis = JSON.parse(aiResponse || '{}');
              if (analysis.confidence && analysis.confidence >= 0.7) {
                extractionConfig = { mode: 'ai_injected', ai_analysis: analysis, security_warnings: scan.warnings };
                const extractScript = generateExtractionScript(extractionConfig);
                injected = htmlContent + extractScript;
                ctx.log.info(`AI analysis: mode=${analysis.scoreSource} confidence=${analysis.confidence}`);
              } else {
                injected = injectSDK(htmlContent);
                extractionConfig.ai_analysis = {
                  scoreSource: 'dom', triggerEvent: 'button_click', confidence: analysis.confidence || 0,
                };
                ctx.log.info(`AI confidence low (${analysis.confidence || 0}), using SDK`);
              }
            } catch (err: any) {
              ctx.log.warn(`AI analysis failed: ${err.message}, using SDK injection`);
              injected = injectSDK(htmlContent);
            }
          } else {
            injected = injectSDK(htmlContent);
          }
        } else {
          injected = injectSDK(htmlContent);
        }

        // 写入 VFS
        const rowId = globalThis.crypto.randomUUID();

        const origLabel = `${coursewareKey}/v${nextVersion}/original`;
        const injectedLabel = `${coursewareKey}/v${nextVersion}/injected`;

        const origId = await resourceWrite(ctx, origLabel, htmlContent);
        const injectedId = await resourceWrite(ctx, injectedLabel, injected);

        if (!origId || !injectedId) {
          return { error: 'vfs_write_failed', message: 'VFS 存储失败，课件未保存' };
        }

        // 写入 DB
        await db.prepare(`
          INSERT INTO ${cwTable} (id, courseware_key, version, title, description, html_vfs_path, injected_html_vfs_path, extraction_config, security_warnings, pass_score, target_classes, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(
          rowId, coursewareKey, nextVersion, title, p.description || '',
          origId, injectedId, JSON.stringify(extractionConfig),
          JSON.stringify(scan.warnings),
          p.pass_score || 60, JSON.stringify(p.target_classes || []),
          p.status || 'draft',
        );

        // 新版本上传时，旧版本自动归档
        if (nextVersion > 1) {
          await db.prepare(
            `UPDATE ${cwTable} SET status = 'archived', updated_at = datetime('now') WHERE courseware_key = ? AND version < ? AND status = 'published'`
          ).run(coursewareKey, nextVersion);
        }

        await eventBus.publish({
          id: globalThis.crypto.randomUUID(),
          type: 'courseware.uploaded',
          source: ctx.pluginId,
          timestamp: Date.now(),
          payload: {
            id: rowId, courseware_key: coursewareKey, version: nextVersion,
            title, extraction_mode: extractionConfig.mode,
            security_warnings: scan.warnings,
          },
        });

        return {
          id: rowId, courseware_key: coursewareKey, version: nextVersion,
          extraction_mode: extractionConfig.mode,
          security_warnings: scan.warnings,
        };
      },
    });

    /** 查询课件列表（每 courseware_key 只返回最新版本） */
    await commandBus.registerHandler('courseware.query', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const params: any[] = [];
        const where: string[] = [];

        if (p.status) { where.push('cw.status = ?'); params.push(p.status); }
        if (p.search) { where.push('cw.title LIKE ?'); params.push(`%${p.search}%`); }
        if (p.courseware_key) { where.push('cw.courseware_key = ?'); params.push(p.courseware_key); }

        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
        const limit = Math.min(p.limit || 50, 200);
        const offset = p.offset || 0;

        // 子查询取最新版本
        const rows = await db.prepare(`
          SELECT cw.* FROM ${cwTable} cw
          INNER JOIN (
            SELECT courseware_key, MAX(version) as max_ver FROM ${cwTable} GROUP BY courseware_key
          ) latest ON cw.courseware_key = latest.courseware_key AND cw.version = latest.max_ver
          ${whereClause}
          ORDER BY cw.updated_at DESC LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        const count = await db.prepare(`
          SELECT COUNT(DISTINCT cw.courseware_key) as total FROM ${cwTable} cw
          ${whereClause}
        `).get(...params) as any;

        const results = await Promise.all((rows as CoursewareRow[]).map(async r => {
          const stats = await db.prepare(
            `SELECT COUNT(*) as submissions, ROUND(AVG(score), 1) as avg_score FROM ${scTable} WHERE courseware_id = ?`
          ).get(r.id) as any;
          return {
            ...r,
            extraction_config: JSON.parse(r.extraction_config || '{}'),
            security_warnings: JSON.parse(r.security_warnings || '[]'),
            target_classes: JSON.parse(r.target_classes || '[]'),
            stats: { submissions: stats?.submissions || 0, avg_score: stats?.avg_score || 0 },
          };
        }));

        return { items: results, total: count.total };
      },
    });

    /** 查询课件的所有版本 */
    await commandBus.registerHandler('courseware.query_versions', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const rows = await db.prepare(
          `SELECT id, courseware_key, version, title, status, extraction_config, created_at FROM ${cwTable} WHERE courseware_key = ? ORDER BY version DESC`
        ).all(p.courseware_key);

        return {
          items: (rows as any[]).map(r => ({
            ...r,
            extraction_config: JSON.parse(r.extraction_config || '{}'),
          })),
        };
      },
    });

    /** 发布/取消发布课件 */
    await commandBus.registerHandler('courseware.publish', {
      async execute(cmd) {
        const p = cmd.payload as any;
        await db.prepare(
          `UPDATE ${cwTable} SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(p.status, p.id);

        await eventBus.publish({
          id: globalThis.crypto.randomUUID(),
          type: 'courseware.published',
          source: ctx.pluginId,
          timestamp: Date.now(),
          payload: { id: p.id, status: p.status },
        });

        return { id: p.id, status: p.status };
      },
    });

    /** 删除课件（所有版本 + 所有成绩 + VFS 文件） */
    await commandBus.registerHandler('courseware.delete', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const cw = await db.prepare(`SELECT courseware_key FROM ${cwTable} WHERE id = ?`).get(p.id) as any;
        if (!cw) return { error: 'not_found' };

        // 获取所有版本的 VFS 路径用于清理
        const allVersions = await db.prepare(
          `SELECT html_vfs_path, injected_html_vfs_path FROM ${cwTable} WHERE courseware_key = ?`
        ).all(cw.courseware_key) as any[];

        // 删除成绩
        await db.prepare(`DELETE FROM ${scTable} WHERE courseware_id IN (SELECT id FROM ${cwTable} WHERE courseware_key = ?)`).run(cw.courseware_key);
        // 删除心跳
        await db.prepare(`DELETE FROM ${hbTable} WHERE courseware_id IN (SELECT id FROM ${cwTable} WHERE courseware_key = ?)`).run(cw.courseware_key);
        // 删除课件
        await db.prepare(`DELETE FROM ${cwTable} WHERE courseware_key = ?`).run(cw.courseware_key);

        // 清理 VFS
        for (const v of allVersions) {
          await resourceDelete(ctx, v.html_vfs_path);
          await resourceDelete(ctx, v.injected_html_vfs_path);
        }

        await eventBus.publish({
          id: globalThis.crypto.randomUUID(),
          type: 'courseware.deleted',
          source: ctx.pluginId,
          timestamp: Date.now(),
          payload: { courseware_key: cw.courseware_key },
        });

        return { deleted: true };
      },
    });

    /** 提交成绩 */
    await commandBus.registerHandler('courseware.submit_score', {
      async execute(cmd) {
        const p = cmd.payload as any;

        // 查询课件版本信息
        const cw = await db.prepare(`SELECT version FROM ${cwTable} WHERE id = ?`).get(p.courseware_id) as any;

        // 防重复
        const existing = await db.prepare(
          `SELECT id FROM ${scTable} WHERE courseware_id = ? AND student_id = ?`
        ).get(p.courseware_id, p.student_id);

        if (existing) {
          return { duplicate: true, existing_id: (existing as any).id };
        }

        const scoreId = globalThis.crypto.randomUUID();
        await db.prepare(`
          INSERT INTO ${scTable} (id, courseware_id, courseware_version, student_id, student_name, score, total, detail, submit_source, time_spent, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          scoreId, p.courseware_id, cw?.version || 1,
          p.student_id, p.student_name || '',
          p.score, p.total, JSON.stringify(p.detail || {}),
          p.submit_source || 'unknown', p.time_spent || 0,
        );

        // 回传学期成绩
        try {
          const gradeService = await ctx.resolve(ISemesterGradeServiceToken);
          await gradeService.saveGrade({
            studentId: p.student_id,
            pluginId: ctx.pluginId,
            resourceId: p.courseware_id,
            score: p.score,
            total: p.total,
          });
          ctx.log.info(`Semester grade saved for student ${p.student_id}`);
        } catch (err: any) {
          ctx.log.warn(`Semester grade save failed: ${err.message}`);
        }

        await eventBus.publish({
          id: globalThis.crypto.randomUUID(),
          type: 'courseware.score_submitted',
          source: ctx.pluginId,
          timestamp: Date.now(),
          payload: {
            courseware_id: p.courseware_id, student_id: p.student_id,
            score: p.score, total: p.total,
          },
        });

        return { id: scoreId, saved: true };
      },
    });

    /** 获取课件 HTML（从 VFS 读取） */
    await commandBus.registerHandler('courseware.get_html', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const row = await db.prepare(
          `SELECT injected_html_vfs_path, extraction_config FROM ${cwTable} WHERE id = ?`
        ).get(p.id) as any;

        if (!row) return { error: 'not_found' };

        const html = await resourceRead(ctx, row.injected_html_vfs_path);
        if (!html) return { error: 'vfs_read_failed' };

        return {
          html,
          extraction_config: JSON.parse(row.extraction_config || '{}'),
        };
      },
    });

    /** 查询成绩列表 */
    await commandBus.registerHandler('courseware.query_scores', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const where: string[] = ['courseware_id = ?'];
        const params: any[] = [p.courseware_id];

        if (p.student_id) { where.push('student_id = ?'); params.push(p.student_id); }

        const rows = await db.prepare(
          `SELECT * FROM ${scTable} WHERE ${where.join(' AND ')} ORDER BY submitted_at DESC`
        ).all(...params);

        return { items: rows };
      },
    });

    /** 更新提取配置 */
    await commandBus.registerHandler('courseware.update_extraction', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const config = p.extraction_config as ExtractionConfig;

        const row = await db.prepare(
          `SELECT html_vfs_path, injected_html_vfs_path FROM ${cwTable} WHERE id = ?`
        ).get(p.id) as any;
        if (!row) return { error: 'not_found' };

        // 重新生成注入版本并写回 VFS
        const origHtml = await resourceRead(ctx, row.html_vfs_path);
        if (!origHtml) return { error: 'vfs_read_failed' };

        let injected = origHtml;
        if (config.mode === 'sdk') {
          injected = injectSDK(origHtml);
        } else if (config.mode === 'ai_injected' || config.mode === 'manual_selector' || config.mode === 'manual_js_var') {
          injected = injectSDK(origHtml);
          const extractScript = generateExtractionScript(config);
          if (extractScript) {
            injected = injected.replace('</body>', `${extractScript}</body>`);
          }
        }

        await resourceWrite(ctx, row.injected_html_vfs_path, injected);

        await db.prepare(`
          UPDATE ${cwTable} SET extraction_config = ?, updated_at = datetime('now') WHERE id = ?
        `).run(JSON.stringify(config), p.id);

        return { id: p.id, extraction_mode: config.mode };
      },
    });

    /** 课件详情 */
    await commandBus.registerHandler('courseware.get_detail', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const row = await db.prepare(
          `SELECT id, courseware_key, version, title, description, extraction_config, security_warnings, pass_score, target_classes, status, created_at, updated_at FROM ${cwTable} WHERE id = ?`
        ).get(p.id) as any;

        if (!row) return { error: 'not_found' };

        const stats = await db.prepare(
          `SELECT COUNT(*) as submissions, ROUND(AVG(score), 1) as avg_score, MAX(score) as max_score, MIN(score) as min_score FROM ${scTable} WHERE courseware_id = ?`
        ).get(p.id) as any;

        const passCount = await db.prepare(
          `SELECT COUNT(*) as c FROM ${scTable} WHERE courseware_id = ? AND (score * 100.0 / total) >= ?`
        ).get(p.id, row.pass_score) as any;

        return {
          ...row,
          extraction_config: JSON.parse(row.extraction_config || '{}'),
          security_warnings: JSON.parse(row.security_warnings || '[]'),
          target_classes: JSON.parse(row.target_classes || '[]'),
          stats: {
            submissions: stats.submissions || 0,
            avg_score: stats.avg_score || 0,
            max_score: stats.max_score || 0,
            min_score: stats.min_score || 0,
            pass_rate: stats.submissions > 0 ? (passCount.c / stats.submissions * 100).toFixed(1) : 0,
          },
        };
      },
    });

    /** 仪表盘统计 */

    /** classroomTools 入口 — 委托 whiteboard.draw 创建插件元素 */
    await commandBus.registerHandler('courseware.open_panel', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const lessonId = p?.lessonId;
        if (lessonId) {
          // Delegate to the kernel whiteboard.draw command to create a plugin card
          const result = await commandBus.execute({
            commandType: 'whiteboard.draw',
            payload: {
              lessonId,
              type: 'plugin',
              data: JSON.stringify({
                pluginId: '@courseware-hub/plugin',
                title: '课件管理',
                teacherWidgetId: 'courseware-hub-teacher',
                studentWidgetId: 'courseware-hub-student',
                width: 900,
                height: 600,
              }),
            },
            actorId: 'plugin:courseware-hub',
          });
          return { panel: 'teacher', elementId: (result as any)?.elementId };
        }
        return { panel: 'teacher' };
      },
    });

    await commandBus.registerHandler('courseware.dashboard_stats', {
      async execute() {
        const total = await db.prepare(`
          SELECT COUNT(DISTINCT courseware_key) as c FROM ${cwTable}
        `).get() as any;
        const published = await db.prepare(`
          SELECT COUNT(DISTINCT courseware_key) as c FROM ${cwTable}
          INNER JOIN (SELECT courseware_key, MAX(version) as mv FROM ${cwTable} GROUP BY courseware_key) latest
            ON ${cwTable}.courseware_key = latest.courseware_key AND ${cwTable}.version = latest.mv
          WHERE ${cwTable}.status = 'published'
        `).get() as any;
        const submissions = await db.prepare(`SELECT COUNT(*) as c FROM ${scTable}`).get() as any;
        const avg = await db.prepare(`SELECT ROUND(AVG(score), 1) as a FROM ${scTable}`).get() as any;

        return {
          total_coursewares: total.c,
          published_coursewares: published.c,
          total_submissions: submissions.c,
          avg_score: avg.a || 0,
        };
      },
    });

    /** 学习心跳 */
    await commandBus.registerHandler('courseware.heartbeat', {
      async execute(cmd) {
        const p = cmd.payload as any;
        await db.prepare(`
          INSERT INTO ${hbTable} (courseware_id, student_id, progress_data, heartbeat_count, first_heartbeat, last_heartbeat)
          VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
          ON CONFLICT(courseware_id, student_id) DO UPDATE SET
            progress_data = ?,
            heartbeat_count = heartbeat_count + 1,
            last_heartbeat = datetime('now')
        `).run(
          p.courseware_id, p.student_id,
          JSON.stringify(p.progress_data || {}),
          JSON.stringify(p.progress_data || {}),
        );
        return { ok: true };
      },
    });

    /** 查询学习心跳 */
    await commandBus.registerHandler('courseware.query_heartbeats', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const rows = await db.prepare(
          `SELECT * FROM ${hbTable} WHERE courseware_id = ?${p.student_id ? ' AND student_id = ?' : ''} ORDER BY last_heartbeat DESC`
        ).all(p.courseware_id, ...(p.student_id ? [p.student_id] : []));
        return { items: rows };
      },
    });

    /** 测试提取配置 */
    await commandBus.registerHandler('courseware.test_extraction', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const config: ExtractionConfig = p.extraction_config;
        const script = generateExtractionScript(config);
        return { valid: !!script, script };
      },
    });

    /** 获取原始 HTML（教师端调试用） */
    await commandBus.registerHandler('courseware.get_original_html', {
      async execute(cmd) {
        const p = cmd.payload as any;
        const row = await db.prepare(
          `SELECT html_vfs_path FROM ${cwTable} WHERE id = ?`
        ).get(p.id) as any;
        if (!row) return { error: 'not_found' };
        const html = await resourceRead(ctx, row.html_vfs_path);
        if (!html) return { error: 'vfs_read_failed' };
        return { html };
      },
    });

    // ============================================================
    // Action 注册
    // ============================================================

    await actionRegistry.register({
      id: 'courseware-upload',
      commandType: 'courseware.upload',
      description: '上传HTML课件。上传AI生成的交互式HTML课件，系统自动分析成绩采集方式。如提供courseware_key则创建新版本。',
      capabilityRequired: 'courseware:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: '课件标题' },
          description: { type: 'STRING', description: '课件描述' },
          html_content: { type: 'STRING', description: 'HTML课件完整源码' },
          courseware_key: { type: 'STRING', description: '更新已有课件时提供，留空则新建' },
          pass_score: { type: 'INTEGER', description: '及格线分数，默认60' },
        },
        required: ['title', 'html_content'],
      },
    });

    await actionRegistry.register({
      id: 'courseware-list',
      commandType: 'courseware.query',
      description: '查询课件库中的课件列表，按关键词搜索或按状态筛选。返回每个课件的最新版本。',
      capabilityRequired: 'courseware:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          status: { type: 'STRING', description: '筛选状态：draft/published/archived' },
          search: { type: 'STRING', description: '搜索关键词，匹配标题' },
        },
        required: [],
      },
    });

    await actionRegistry.register({
      id: 'courseware-publish',
      commandType: 'courseware.publish',
      description: '发布或取消发布指定版本的课件。发布后学生端可见。',
      capabilityRequired: 'courseware:admin',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: '课件版本ID' },
          status: { type: 'STRING', description: '目标状态：published 或 draft' },
        },
        required: ['id', 'status'],
      },
    });

    await actionRegistry.register({
      id: 'courseware-delete',
      commandType: 'courseware.delete',
      description: '删除课件及其所有版本、成绩数据和VFS文件。',
      capabilityRequired: 'courseware:admin',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING', description: '课件版本ID' } },
        required: ['id'],
      },
    });

    await actionRegistry.register({
      id: 'courseware-query-scores',
      commandType: 'courseware.query_scores',
      description: '查询课件的学生成绩列表。',
      capabilityRequired: 'courseware:read',
      inputSchema: {
        type: 'OBJECT',
        properties: { courseware_id: { type: 'STRING', description: '课件版本ID' } },
        required: ['courseware_id'],
      },
    });

    // Event 订阅
    eventBus.subscribe('courseware.score_submitted', async (event) => {
      ctx.log.info(
        `Score: cw=${event.payload.courseware_id} student=${event.payload.student_id} score=${event.payload.score}/${event.payload.total}`
      );
    });

    ctx.log.info('courseware-hub v0.2.0 activated');
  },

  async deactivate() {},
};
