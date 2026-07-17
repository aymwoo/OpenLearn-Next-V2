// src/index.ts
import {
  IDatabaseToken,
  ISemesterGradeServiceToken
} from "@openlearn/plugin-sdk";
var SDK_SCRIPT_INLINE = `
<script data-openlearn-sdk="0.2.0">
(function(){var e=!!window.parent&&window.parent!==window;function t(n,p){if(!e)return!1;try{window.parent.postMessage({type:n,source:"openlearn-cw-sdk",version:"0.2.0",payload:p||{},timestamp:Date.now()},"*");return!0}catch(r){return!1}}
window.OpenLearn={version:"0.2.0",embedded:e,submit:function(n,p,r){return t("courseware:score",{score:n,total:p,detail:r||null})},complete:function(){return t("courseware:complete",{})},emit:function(n,p){return t("courseware:event",{event:n,data:p||{}})}};
var hb=setInterval(function(){t("courseware:heartbeat",{})},30000);
window.addEventListener("beforeunload",function(){t("courseware:closing",{});clearInterval(hb)});
})();
</script>`;
var SECURITY_CHECKS = [
  { pattern: /<script[^>]*src\s*=\s*["']https?:\/\/(?!cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare)/i, warning: "\u5305\u542B\u5916\u90E8\u811A\u672C\u5F15\u7528\uFF08\u975E\u4FE1\u4EFBCDN\uFF09" },
  { pattern: /\beval\s*\(/i, warning: "\u4F7F\u7528\u4E86 eval()" },
  { pattern: /\bdocument\.cookie\b/i, warning: "\u8BBF\u95EE\u4E86 document.cookie" },
  { pattern: /\bfetch\s*\(\s*["']https?:\/\//i, warning: "\u5411\u5916\u90E8 URL \u53D1\u8D77 fetch \u8BF7\u6C42" },
  { pattern: /XMLHttpRequest/i, warning: "\u4F7F\u7528\u4E86 XMLHttpRequest" },
  { pattern: /\blocalStorage\b/i, warning: "\u4F7F\u7528\u4E86 localStorage" },
  { pattern: /new\s+Function\s*\(/i, warning: "\u4F7F\u7528\u4E86 new Function() \u52A8\u6001\u6267\u884C" }
];
function scanSecurity(html) {
  const warnings = [];
  for (const check of SECURITY_CHECKS) {
    if (check.pattern.test(html)) {
      warnings.push(check.warning);
    }
  }
  return { warnings, safe: warnings.length === 0 };
}
function hasSDKCall(html) {
  return /OpenLearn\.submit\s*\(/.test(html) || /openlearn-cw-sdk/.test(html) || /courseware:score/.test(html);
}
function injectSDK(html) {
  if (hasSDKCall(html))
    return html;
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, `${SDK_SCRIPT_INLINE}
</body>`);
  }
  return html + SDK_SCRIPT_INLINE;
}
function buildAnalysisPrompt(html) {
  const snippet = html.slice(0, 8e3);
  return `\u5206\u6790\u4EE5\u4E0B HTML \u8BFE\u4EF6\u7684 JavaScript \u4EE3\u7801\u548C DOM \u7ED3\u6784\uFF0C\u627E\u51FA\u6210\u7EE9\u91C7\u96C6\u65B9\u6848\u3002

\u8FD4\u56DE\u7EAF JSON\uFF08\u4E0D\u8981 Markdown \u4EE3\u7801\u5757\uFF09\uFF1A

{
  "scoreSource": "dom" | "js_var" | "url_hash",
  "scoreSelector": "CSS \u9009\u62E9\u5668\uFF0C\u5B9A\u4F4D\u5230\u663E\u793A\u6210\u7EE9\u7684\u5143\u7D20",
  "totalSelector": "CSS \u9009\u62E9\u5668\uFF0C\u5B9A\u4F4D\u5230\u663E\u793A\u603B\u5206\u7684\u5143\u7D20\uFF08\u5982\u65E0\u5219 null\uFF09",
  "triggerEvent": "button_click" | "form_submit" | "dom_appear",
  "triggerSelector": "CSS \u9009\u62E9\u5668\uFF0C\u5B9A\u4F4D\u89E6\u53D1\u6210\u7EE9\u663E\u793A\u7684\u6309\u94AE/\u8868\u5355",
  "jsVarName": "\u5982\u679C\u6210\u7EE9\u5B58\u5728 JS \u53D8\u91CF\u4E2D\uFF0C\u5199\u51FA\u53D8\u91CF\u540D\uFF0C\u5426\u5219 null",
  "confidence": 0.0-1.0 \u8868\u793A\u5206\u6790\u53EF\u4FE1\u5EA6
}

\u89C4\u5219\uFF1A
- scoreSelector \u5FC5\u987B\u80FD\u552F\u4E00\u5B9A\u4F4D\u5230\u6210\u7EE9\u5143\u7D20
- \u5982\u679C\u627E\u4E0D\u5230\u660E\u786E\u7684\u6210\u7EE9\u673A\u5236\uFF0C\u8BBE confidence \u4E3A 0

HTML:
${snippet}`;
}
function isAiAvailable(db) {
  try {
    const provider = db.prepare("SELECT id FROM ai_providers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1").get();
    if (provider)
      return true;
    if (typeof process !== "undefined" && process.env && process.env.GEMINI_API_KEY)
      return true;
  } catch (e) {
  }
  return false;
}
function generateExtractionScript(config) {
  if (config.mode === "sdk")
    return "";
  const ai = config.ai_analysis;
  const manual = config.manual_config;
  const sel = ai?.scoreSelector || manual?.scoreSelector;
  const totalSel = ai?.totalSelector || manual?.totalSelector;
  const trigSel = ai?.triggerSelector || manual?.triggerSelector;
  const mode = config.mode;
  if (mode === "manual_js_var") {
    const varName = ai?.jsVarName || manual?.jsVarName || "__score";
    return `
<script data-openlearn-extractor="auto">
(function(){var v=window["${varName}"];if(v!=null){window.parent.postMessage({type:"courseware:score",source:"ai_injected",payload:{score:typeof v.score!=="undefined"?v.score:v,total:typeof v.total!=="undefined"?v.total:null}}, "*");}})();
</script>`;
  }
  if ((mode === "manual_selector" || mode === "ai_injected") && sel) {
    return `
<script data-openlearn-extractor="auto">
(function(){
  var trigger=document.querySelector("${trigSel || "body"}");
  if(!trigger)return;
  trigger.addEventListener("click",function(){
    setTimeout(function(){
      var s=document.querySelector("${sel}");
      var t=${totalSel ? `document.querySelector("${totalSel}")` : "null"};
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
  return "";
}
var API_BASE = "http://127.0.0.1:9000";
async function resourceWrite(ctx, name, content) {
  try {
    const res = await fetch(`${API_BASE}/api/resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: "html", content })
    });
    const data = await res.json();
    if (data.error) {
      ctx.log.warn(`resource.create failed: ${data.error}`);
      return null;
    }
    return data.id || null;
  } catch (e) {
    ctx.log.warn(`resource.create error for ${name}: ${e.message}`);
    return null;
  }
}
async function resourceRead(ctx, id) {
  try {
    const res = await fetch(`${API_BASE}/api/resources/${id}`);
    if (!res.ok) {
      ctx.log.warn(`resource.get HTTP ${res.status} for ${id}`);
      return null;
    }
    const row = await res.json();
    return row?.content || null;
  } catch (e) {
    ctx.log.warn(`resource.get error for ${id}: ${e.message}`);
    return null;
  }
}
async function resourceDelete(ctx, id) {
  try {
    await fetch(`${API_BASE}/api/resources/${id}`, { method: "DELETE" });
  } catch (e) {
  }
}
var src_default = {
  manifest: {
    id: "@courseware-hub/plugin",
    name: "\u8BFE\u4EF6\u4E2D\u5FC3",
    version: "0.2.0",
    description: "AI\u8BFE\u4EF6\u5206\u53D1\u4E0E\u6210\u7EE9\u91C7\u96C6\u3002\u4E0A\u4F20\u4EA4\u4E92\u5F0FHTML\u8BFE\u4EF6\uFF0C\u5B66\u751F\u7AEF\u6E32\u67D3\uFF0C\u81EA\u52A8\u6355\u83B7\u6210\u7EE9\u5E76\u56DE\u4F20\u5B66\u4E60\u7CFB\u7EDF\u3002",
    author: "OpenLearn Developer",
    requires: [
      "@openlearn/core:ICommandBusService@^1.0.0",
      "@openlearn/core:IActionRegistryService@^1.0.0",
      "@openlearn/core:IEventBusService@^1.0.0",
      "@openlearn/core:IDatabase@^1.0.0",
      "@openlearn/core:IAIService@^1.0.0",
      "@openlearn/core:IStorageService@^1.0.0",
      "@openlearn/core:ICapabilityService@^1.0.0",
      "@openlearn/core:ISemesterGradeService@^1.0.0"
    ],
    capabilitiesProposed: [
      "courseware:read",
      "courseware:write",
      "courseware:admin",
      "lesson:read",
      "vfs:read",
      "vfs:write"
    ],
    classroomTools: [
      { id: "courseware-hub-teacher", name: "\u8BFE\u4EF6\u7BA1\u7406", icon: "BookOpen", commandType: "whiteboard.draw", payload: { lessonId: "$lessonId", type: "plugin", data: JSON.stringify({ pluginId: "@courseware-hub/plugin", title: "\u8BFE\u4EF6\u7BA1\u7406", teacherWidgetId: "courseware-hub-teacher", studentWidgetId: "courseware-hub-student", width: 900, height: 600 }) } }
    ],
    engines: { openlearn: ">=5.1.0" }
  },
  async activate(ctx) {
    const commandBus = ctx.services.commandBus;
    const eventBus = ctx.services.eventBus;
    const actionRegistry = ctx.services.actionRegistry;
    const db = await ctx.resolve(IDatabaseToken);
    const cwTable = ctx.db.table("coursewares");
    await ctx.db.ensureTable("coursewares", `
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
    const scTable = ctx.db.table("scores");
    await ctx.db.ensureTable("scores", `
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
    const hbTable = ctx.db.table("heartbeats");
    await ctx.db.ensureTable("heartbeats", `
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courseware_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      progress_data TEXT DEFAULT '{}',
      heartbeat_count INTEGER DEFAULT 1,
      first_heartbeat TEXT DEFAULT (datetime('now')),
      last_heartbeat TEXT DEFAULT (datetime('now')),
      UNIQUE(courseware_id, student_id)
    `);
    await commandBus.registerHandler("courseware.upload", {
      async execute(cmd) {
        const p = cmd.payload;
        const title = p.title || "\u672A\u547D\u540D\u8BFE\u4EF6";
        const htmlContent = p.html_content || "";
        const scan = scanSecurity(htmlContent);
        ctx.log.info(`Security scan: ${scan.warnings.length} warnings, safe=${scan.safe}`);
        let coursewareKey = p.courseware_key;
        let nextVersion = 1;
        if (coursewareKey) {
          const latest = await db.prepare(
            `SELECT MAX(version) as mv FROM ${cwTable} WHERE courseware_key = ?`
          ).get(coursewareKey);
          nextVersion = (latest?.mv || 0) + 1;
        } else {
          coursewareKey = globalThis.crypto.randomUUID();
        }
        let injected = htmlContent;
        let extractionConfig = { mode: "sdk", security_warnings: scan.warnings };
        if (!hasSDKCall(htmlContent)) {
          if (isAiAvailable(db)) {
            try {
              const aiResponse = await ctx.services.ai.generateText(buildAnalysisPrompt(htmlContent));
              const analysis = JSON.parse(aiResponse || "{}");
              if (analysis.confidence && analysis.confidence >= 0.7) {
                extractionConfig = { mode: "ai_injected", ai_analysis: analysis, security_warnings: scan.warnings };
                const extractScript = generateExtractionScript(extractionConfig);
                injected = htmlContent + extractScript;
                ctx.log.info(`AI analysis: mode=${analysis.scoreSource} confidence=${analysis.confidence}`);
              } else {
                injected = injectSDK(htmlContent);
                extractionConfig.ai_analysis = {
                  scoreSource: "dom",
                  triggerEvent: "button_click",
                  confidence: analysis.confidence || 0
                };
                ctx.log.info(`AI confidence low (${analysis.confidence || 0}), using SDK`);
              }
            } catch (err) {
              ctx.log.warn(`AI analysis failed: ${err.message}, using SDK injection`);
              injected = injectSDK(htmlContent);
            }
          } else {
            injected = injectSDK(htmlContent);
          }
        } else {
          injected = injectSDK(htmlContent);
        }
        const rowId = globalThis.crypto.randomUUID();
        const origLabel = `${coursewareKey}/v${nextVersion}/original`;
        const injectedLabel = `${coursewareKey}/v${nextVersion}/injected`;
        const origId = await resourceWrite(ctx, origLabel, htmlContent);
        const injectedId = await resourceWrite(ctx, injectedLabel, injected);
        if (!origId || !injectedId) {
          return { error: "vfs_write_failed", message: "VFS \u5B58\u50A8\u5931\u8D25\uFF0C\u8BFE\u4EF6\u672A\u4FDD\u5B58" };
        }
        await db.prepare(`
          INSERT INTO ${cwTable} (id, courseware_key, version, title, description, html_vfs_path, injected_html_vfs_path, extraction_config, security_warnings, pass_score, target_classes, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(
          rowId,
          coursewareKey,
          nextVersion,
          title,
          p.description || "",
          origId,
          injectedId,
          JSON.stringify(extractionConfig),
          JSON.stringify(scan.warnings),
          p.pass_score || 60,
          JSON.stringify(p.target_classes || []),
          p.status || "draft"
        );
        if (nextVersion > 1) {
          await db.prepare(
            `UPDATE ${cwTable} SET status = 'archived', updated_at = datetime('now') WHERE courseware_key = ? AND version < ? AND status = 'published'`
          ).run(coursewareKey, nextVersion);
        }
        await eventBus.publish({
          type: "courseware.uploaded",
          source: ctx.pluginId,
          payload: {
            id: rowId,
            courseware_key: coursewareKey,
            version: nextVersion,
            title,
            extraction_mode: extractionConfig.mode,
            security_warnings: scan.warnings
          }
        });
        return {
          id: rowId,
          courseware_key: coursewareKey,
          version: nextVersion,
          extraction_mode: extractionConfig.mode,
          security_warnings: scan.warnings
        };
      }
    });
    await commandBus.registerHandler("courseware.query", {
      async execute(cmd) {
        const p = cmd.payload;
        const params = [];
        const where = [];
        if (p.status) {
          where.push("cw.status = ?");
          params.push(p.status);
        }
        if (p.search) {
          where.push("cw.title LIKE ?");
          params.push(`%${p.search}%`);
        }
        if (p.courseware_key) {
          where.push("cw.courseware_key = ?");
          params.push(p.courseware_key);
        }
        const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const limit = Math.min(p.limit || 50, 200);
        const offset = p.offset || 0;
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
        `).get(...params);
        const results = rows.map(async (r) => {
          const stats = await db.prepare(
            `SELECT COUNT(*) as submissions, ROUND(AVG(score), 1) as avg_score FROM ${scTable} WHERE courseware_id = ?`
          ).get(r.id);
          return {
            ...r,
            extraction_config: JSON.parse(r.extraction_config || "{}"),
            security_warnings: JSON.parse(r.security_warnings || "[]"),
            target_classes: JSON.parse(r.target_classes || "[]"),
            stats: { submissions: stats.submissions || 0, avg_score: stats.avg_score || 0 }
          };
        });
        return { items: results, total: count.total };
      }
    });
    await commandBus.registerHandler("courseware.query_versions", {
      async execute(cmd) {
        const p = cmd.payload;
        const rows = await db.prepare(
          `SELECT id, courseware_key, version, title, status, extraction_config, created_at FROM ${cwTable} WHERE courseware_key = ? ORDER BY version DESC`
        ).all(p.courseware_key);
        return {
          items: rows.map((r) => ({
            ...r,
            extraction_config: JSON.parse(r.extraction_config || "{}")
          }))
        };
      }
    });
    await commandBus.registerHandler("courseware.publish", {
      async execute(cmd) {
        const p = cmd.payload;
        await db.prepare(
          `UPDATE ${cwTable} SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(p.status, p.id);
        await eventBus.publish({
          type: "courseware.published",
          source: ctx.pluginId,
          payload: { id: p.id, status: p.status }
        });
        return { id: p.id, status: p.status };
      }
    });
    await commandBus.registerHandler("courseware.delete", {
      async execute(cmd) {
        const p = cmd.payload;
        const cw = await db.prepare(`SELECT courseware_key FROM ${cwTable} WHERE id = ?`).get(p.id);
        if (!cw)
          return { error: "not_found" };
        const allVersions = await db.prepare(
          `SELECT html_vfs_path, injected_html_vfs_path FROM ${cwTable} WHERE courseware_key = ?`
        ).all(cw.courseware_key);
        await db.prepare(`DELETE FROM ${scTable} WHERE courseware_id IN (SELECT id FROM ${cwTable} WHERE courseware_key = ?)`).run(cw.courseware_key);
        await db.prepare(`DELETE FROM ${hbTable} WHERE courseware_id IN (SELECT id FROM ${cwTable} WHERE courseware_key = ?)`).run(cw.courseware_key);
        await db.prepare(`DELETE FROM ${cwTable} WHERE courseware_key = ?`).run(cw.courseware_key);
        for (const v of allVersions) {
          await resourceDelete(ctx, v.html_vfs_path);
          await resourceDelete(ctx, v.injected_html_vfs_path);
        }
        await eventBus.publish({
          type: "courseware.deleted",
          source: ctx.pluginId,
          payload: { courseware_key: cw.courseware_key }
        });
        return { deleted: true };
      }
    });
    await commandBus.registerHandler("courseware.submit_score", {
      async execute(cmd) {
        const p = cmd.payload;
        const cw = await db.prepare(`SELECT version FROM ${cwTable} WHERE id = ?`).get(p.courseware_id);
        const existing = await db.prepare(
          `SELECT id FROM ${scTable} WHERE courseware_id = ? AND student_id = ?`
        ).get(p.courseware_id, p.student_id);
        if (existing) {
          return { duplicate: true, existing_id: existing.id };
        }
        const scoreId = globalThis.crypto.randomUUID();
        await db.prepare(`
          INSERT INTO ${scTable} (id, courseware_id, courseware_version, student_id, student_name, score, total, detail, submit_source, time_spent, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          scoreId,
          p.courseware_id,
          cw?.version || 1,
          p.student_id,
          p.student_name || "",
          p.score,
          p.total,
          JSON.stringify(p.detail || {}),
          p.submit_source || "unknown",
          p.time_spent || 0
        );
        try {
          const gradeService = await ctx.resolve(ISemesterGradeServiceToken);
          await gradeService.saveGrade({
            studentId: p.student_id,
            pluginId: ctx.pluginId,
            resourceId: p.courseware_id,
            score: p.score,
            total: p.total
          });
          ctx.log.info(`Semester grade saved for student ${p.student_id}`);
        } catch (err) {
          ctx.log.warn(`Semester grade save failed: ${err.message}`);
        }
        await eventBus.publish({
          type: "courseware.score_submitted",
          source: ctx.pluginId,
          payload: {
            courseware_id: p.courseware_id,
            student_id: p.student_id,
            score: p.score,
            total: p.total
          }
        });
        return { id: scoreId, saved: true };
      }
    });
    await commandBus.registerHandler("courseware.get_html", {
      async execute(cmd) {
        const p = cmd.payload;
        const row = await db.prepare(
          `SELECT injected_html_vfs_path, extraction_config FROM ${cwTable} WHERE id = ?`
        ).get(p.id);
        if (!row)
          return { error: "not_found" };
        const html = await resourceRead(ctx, row.injected_html_vfs_path);
        if (!html)
          return { error: "vfs_read_failed" };
        return {
          html,
          extraction_config: JSON.parse(row.extraction_config || "{}")
        };
      }
    });
    await commandBus.registerHandler("courseware.query_scores", {
      async execute(cmd) {
        const p = cmd.payload;
        const where = ["courseware_id = ?"];
        const params = [p.courseware_id];
        if (p.student_id) {
          where.push("student_id = ?");
          params.push(p.student_id);
        }
        const rows = await db.prepare(
          `SELECT * FROM ${scTable} WHERE ${where.join(" AND ")} ORDER BY submitted_at DESC`
        ).all(...params);
        return { items: rows };
      }
    });
    await commandBus.registerHandler("courseware.update_extraction", {
      async execute(cmd) {
        const p = cmd.payload;
        const config = p.extraction_config;
        const row = await db.prepare(
          `SELECT html_vfs_path, injected_html_vfs_path FROM ${cwTable} WHERE id = ?`
        ).get(p.id);
        if (!row)
          return { error: "not_found" };
        const origHtml = await resourceRead(ctx, row.html_vfs_path);
        if (!origHtml)
          return { error: "vfs_read_failed" };
        let injected = origHtml;
        if (config.mode === "sdk") {
          injected = injectSDK(origHtml);
        } else if (config.mode === "ai_injected" || config.mode === "manual_selector" || config.mode === "manual_js_var") {
          injected = injectSDK(origHtml);
          const extractScript = generateExtractionScript(config);
          if (extractScript) {
            injected = injected.replace("</body>", `${extractScript}</body>`);
          }
        }
        await resourceWrite(ctx, row.injected_html_vfs_path, injected);
        await db.prepare(`
          UPDATE ${cwTable} SET extraction_config = ?, updated_at = datetime('now') WHERE id = ?
        `).run(JSON.stringify(config), p.id);
        return { id: p.id, extraction_mode: config.mode };
      }
    });
    await commandBus.registerHandler("courseware.get_detail", {
      async execute(cmd) {
        const p = cmd.payload;
        const row = await db.prepare(
          `SELECT id, courseware_key, version, title, description, extraction_config, security_warnings, pass_score, target_classes, status, created_at, updated_at FROM ${cwTable} WHERE id = ?`
        ).get(p.id);
        if (!row)
          return { error: "not_found" };
        const stats = await db.prepare(
          `SELECT COUNT(*) as submissions, ROUND(AVG(score), 1) as avg_score, MAX(score) as max_score, MIN(score) as min_score FROM ${scTable} WHERE courseware_id = ?`
        ).get(p.id);
        const passCount = await db.prepare(
          `SELECT COUNT(*) as c FROM ${scTable} WHERE courseware_id = ? AND (score * 100.0 / total) >= ?`
        ).get(p.id, row.pass_score);
        return {
          ...row,
          extraction_config: JSON.parse(row.extraction_config || "{}"),
          security_warnings: JSON.parse(row.security_warnings || "[]"),
          target_classes: JSON.parse(row.target_classes || "[]"),
          stats: {
            submissions: stats.submissions || 0,
            avg_score: stats.avg_score || 0,
            max_score: stats.max_score || 0,
            min_score: stats.min_score || 0,
            pass_rate: stats.submissions > 0 ? (passCount.c / stats.submissions * 100).toFixed(1) : 0
          }
        };
      }
    });
    await commandBus.registerHandler("courseware.open_panel", {
      async execute(cmd) {
        const p = cmd.payload;
        const lessonId = p?.lessonId;
        if (lessonId) {
          const result = await commandBus.execute({
            commandType: "whiteboard.draw",
            payload: {
              lessonId,
              type: "plugin",
              data: JSON.stringify({
                pluginId: "@courseware-hub/plugin",
                title: "\u8BFE\u4EF6\u7BA1\u7406",
                teacherWidgetId: "courseware-hub-teacher",
                studentWidgetId: "courseware-hub-student",
                width: 900,
                height: 600
              })
            },
            actorId: "plugin:courseware-hub"
          });
          return { panel: "teacher", elementId: result?.elementId };
        }
        return { panel: "teacher" };
      }
    });
    await commandBus.registerHandler("courseware.dashboard_stats", {
      async execute() {
        const total = await db.prepare(`
          SELECT COUNT(DISTINCT courseware_key) as c FROM ${cwTable}
        `).get();
        const published = await db.prepare(`
          SELECT COUNT(DISTINCT courseware_key) as c FROM ${cwTable}
          INNER JOIN (SELECT courseware_key, MAX(version) as mv FROM ${cwTable} GROUP BY courseware_key) latest
            ON ${cwTable}.courseware_key = latest.courseware_key AND ${cwTable}.version = latest.mv
          WHERE ${cwTable}.status = 'published'
        `).get();
        const submissions = await db.prepare(`SELECT COUNT(*) as c FROM ${scTable}`).get();
        const avg = await db.prepare(`SELECT ROUND(AVG(score), 1) as a FROM ${scTable}`).get();
        return {
          total_coursewares: total.c,
          published_coursewares: published.c,
          total_submissions: submissions.c,
          avg_score: avg.a || 0
        };
      }
    });
    await commandBus.registerHandler("courseware.heartbeat", {
      async execute(cmd) {
        const p = cmd.payload;
        await db.prepare(`
          INSERT INTO ${hbTable} (courseware_id, student_id, progress_data, heartbeat_count, first_heartbeat, last_heartbeat)
          VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
          ON CONFLICT(courseware_id, student_id) DO UPDATE SET
            progress_data = ?,
            heartbeat_count = heartbeat_count + 1,
            last_heartbeat = datetime('now')
        `).run(
          p.courseware_id,
          p.student_id,
          JSON.stringify(p.progress_data || {}),
          JSON.stringify(p.progress_data || {})
        );
        return { ok: true };
      }
    });
    await commandBus.registerHandler("courseware.query_heartbeats", {
      async execute(cmd) {
        const p = cmd.payload;
        const rows = await db.prepare(
          `SELECT * FROM ${hbTable} WHERE courseware_id = ?${p.student_id ? " AND student_id = ?" : ""} ORDER BY last_heartbeat DESC`
        ).all(p.courseware_id, ...p.student_id ? [p.student_id] : []);
        return { items: rows };
      }
    });
    await commandBus.registerHandler("courseware.test_extraction", {
      async execute(cmd) {
        const p = cmd.payload;
        const config = p.extraction_config;
        const script = generateExtractionScript(config);
        return { valid: !!script, script };
      }
    });
    await commandBus.registerHandler("courseware.get_original_html", {
      async execute(cmd) {
        const p = cmd.payload;
        const row = await db.prepare(
          `SELECT html_vfs_path FROM ${cwTable} WHERE id = ?`
        ).get(p.id);
        if (!row)
          return { error: "not_found" };
        const html = await resourceRead(ctx, row.html_vfs_path);
        if (!html)
          return { error: "vfs_read_failed" };
        return { html };
      }
    });
    await actionRegistry.register({
      id: "courseware-upload",
      commandType: "courseware.upload",
      description: "\u4E0A\u4F20HTML\u8BFE\u4EF6\u3002\u4E0A\u4F20AI\u751F\u6210\u7684\u4EA4\u4E92\u5F0FHTML\u8BFE\u4EF6\uFF0C\u7CFB\u7EDF\u81EA\u52A8\u5206\u6790\u6210\u7EE9\u91C7\u96C6\u65B9\u5F0F\u3002\u5982\u63D0\u4F9Bcourseware_key\u5219\u521B\u5EFA\u65B0\u7248\u672C\u3002",
      capabilityRequired: "courseware:write",
      inputSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "\u8BFE\u4EF6\u6807\u9898" },
          description: { type: "STRING", description: "\u8BFE\u4EF6\u63CF\u8FF0" },
          html_content: { type: "STRING", description: "HTML\u8BFE\u4EF6\u5B8C\u6574\u6E90\u7801" },
          courseware_key: { type: "STRING", description: "\u66F4\u65B0\u5DF2\u6709\u8BFE\u4EF6\u65F6\u63D0\u4F9B\uFF0C\u7559\u7A7A\u5219\u65B0\u5EFA" },
          pass_score: { type: "INTEGER", description: "\u53CA\u683C\u7EBF\u5206\u6570\uFF0C\u9ED8\u8BA460" }
        },
        required: ["title", "html_content"]
      }
    });
    await actionRegistry.register({
      id: "courseware-list",
      commandType: "courseware.query",
      description: "\u67E5\u8BE2\u8BFE\u4EF6\u5E93\u4E2D\u7684\u8BFE\u4EF6\u5217\u8868\uFF0C\u6309\u5173\u952E\u8BCD\u641C\u7D22\u6216\u6309\u72B6\u6001\u7B5B\u9009\u3002\u8FD4\u56DE\u6BCF\u4E2A\u8BFE\u4EF6\u7684\u6700\u65B0\u7248\u672C\u3002",
      capabilityRequired: "courseware:read",
      inputSchema: {
        type: "OBJECT",
        properties: {
          status: { type: "STRING", description: "\u7B5B\u9009\u72B6\u6001\uFF1Adraft/published/archived" },
          search: { type: "STRING", description: "\u641C\u7D22\u5173\u952E\u8BCD\uFF0C\u5339\u914D\u6807\u9898" }
        },
        required: []
      }
    });
    await actionRegistry.register({
      id: "courseware-publish",
      commandType: "courseware.publish",
      description: "\u53D1\u5E03\u6216\u53D6\u6D88\u53D1\u5E03\u6307\u5B9A\u7248\u672C\u7684\u8BFE\u4EF6\u3002\u53D1\u5E03\u540E\u5B66\u751F\u7AEF\u53EF\u89C1\u3002",
      capabilityRequired: "courseware:admin",
      isHighRisk: true,
      inputSchema: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "\u8BFE\u4EF6\u7248\u672CID" },
          status: { type: "STRING", description: "\u76EE\u6807\u72B6\u6001\uFF1Apublished \u6216 draft" }
        },
        required: ["id", "status"]
      }
    });
    await actionRegistry.register({
      id: "courseware-delete",
      commandType: "courseware.delete",
      description: "\u5220\u9664\u8BFE\u4EF6\u53CA\u5176\u6240\u6709\u7248\u672C\u3001\u6210\u7EE9\u6570\u636E\u548CVFS\u6587\u4EF6\u3002",
      capabilityRequired: "courseware:admin",
      isHighRisk: true,
      inputSchema: {
        type: "OBJECT",
        properties: { id: { type: "STRING", description: "\u8BFE\u4EF6\u7248\u672CID" } },
        required: ["id"]
      }
    });
    await actionRegistry.register({
      id: "courseware-query-scores",
      commandType: "courseware.query_scores",
      description: "\u67E5\u8BE2\u8BFE\u4EF6\u7684\u5B66\u751F\u6210\u7EE9\u5217\u8868\u3002",
      capabilityRequired: "courseware:read",
      inputSchema: {
        type: "OBJECT",
        properties: { courseware_id: { type: "STRING", description: "\u8BFE\u4EF6\u7248\u672CID" } },
        required: ["courseware_id"]
      }
    });
    eventBus.subscribe("courseware.score_submitted", async (event) => {
      ctx.log.info(
        `Score: cw=${event.payload.courseware_id} student=${event.payload.student_id} score=${event.payload.score}/${event.payload.total}`
      );
    });
    ctx.log.info("courseware-hub v0.2.0 activated");
  },
  async deactivate() {
  }
};
export {
  src_default as default
};
