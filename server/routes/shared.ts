import path from 'path';
import crypto from 'crypto';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ICoursewareRuntimeScriptRegistryToken } from '../../packages/core/di/interfaces.js';
import { getCookieToken } from '../middleware/auth.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';

export { validateMagicBytes, BLOCKED_EXTENSIONS } from '../utils/upload.js';

/**
 * 课件/资源独立直出 HTML 的沙箱 CSP（SEC-NET-02）。
 *
 * 这些文档由平台替第三方课件内容直出（含用户内联脚本/内联事件，无法改造为
 * 无内联形态），因此配**自有宽松 CSP** 覆盖 helmet 全局头。正因这些响应不再
 * 继承全局 CSP，平台自身文档（SPA）的全局 CSP 得以收紧
 * （scriptSrc 去 'unsafe-inline'、connectSrc 去 http:/https:，见 server.ts）。
 *
 * frame-ancestors 'self'：防外部站点嵌入课件内容（本指令在该覆盖头缺失时，
 * 外部站点可任意 iframe 嵌入——见 2026-09-30 安全审计）。
 */
export const COURSEWARE_DOCUMENT_CSP =
  "sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'self'; default-src 'self' 'unsafe-inline' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src-attr 'unsafe-inline'; style-src-attr 'unsafe-inline';";

/** 为课件/资源 HTML 响应设置自有宽松 CSP（覆盖 helmet 全局头）。 */
export function setCoursewareDocumentCsp(res: { setHeader: (name: string, value: string) => void }): void {
  res.setHeader('Content-Security-Policy', COURSEWARE_DOCUMENT_CSP);
}

/**
 * 收集插件通过「课件运行时脚本扩展点」注册的脚本。
 *
 * 课件 iframe 处于 `credentialless` + sandbox（无 allow-same-origin）的 opaque origin 中，
 * 父窗口读不到其内部状态，服务端拼接 HTML 是平台唯一能向课件内投递代码的位置。
 * 注册点缺失或未注册任何脚本时必须完全静默，保证既有渲染路径零影响。
 */
export function collectCoursewareRuntimeScripts(cwInfo: { id: string; name: string; uuid: string }): {
  head: string;
  bodyEnd: string;
} {
  const empty = { head: '', bodyEnd: '' };
  try {
    const registry: any = (kernelContainer as any)?.serviceRegistry?.resolve?.(ICoursewareRuntimeScriptRegistryToken);
    if (!registry || typeof registry.list !== 'function') return empty;
    const scripts: any[] = registry.list({ id: cwInfo.id, uuid: cwInfo.uuid }) || [];
    if (!scripts.length) return empty;
    let head = '';
    let bodyEnd = '';
    for (const script of scripts) {
      if (!script || typeof script.source !== 'string' || !script.source.trim()) continue;
      const tag = `\n<!-- Courseware Runtime Script (${script.owner}/${script.id}) -->\n<script>${script.source}</script>`;
      if (script.position === 'head') head += tag;
      else bodyEnd += tag;
    }
    return { head, bodyEnd };
  } catch (err) {
    console.warn('[injectLmsSdk] 读取课件运行时脚本扩展点失败（已忽略）:', (err as Error).message);
    return empty;
  }
}

export function injectLmsSdk(htmlContent: string, req: any, cwInfo: { id: string; name: string; uuid: string }) {
  const token = getCookieToken(req);
  let studentInfo = {
    student_id: 'guest',
    student_name: 'Guest Student',
    class_id: '',
    attempt_id: 'guest-attempt',
  };

  if (token) {
    const sessionRow = kernelContainer.db.prepare('SELECT * FROM client_sessions WHERE id = ?').get(token) as any;
    if (sessionRow) {
      const session = JSON.parse(sessionRow.session_data);
      if (session.role === 'student') {
        const classRow = kernelContainer.db
          .prepare('SELECT class_id FROM class_students WHERE student_id = ? LIMIT 1')
          .get(session.studentId) as any;

        let attempt = kernelContainer.db
          .prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
          .get(cwInfo.id, session.studentId, 'active') as any;

        if (!attempt) {
          const attemptId = 'att_' + crypto.randomBytes(8).toString('hex');
          kernelContainer.db
            .prepare(
              'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
            )
            .run(attemptId, cwInfo.id, session.studentId, Date.now(), 'active');
          attempt = { id: attemptId };
        }

        studentInfo = {
          student_id: session.studentId,
          student_name: session.name,
          class_id: classRow ? classRow.class_id : '',
          attempt_id: attempt.id,
        };
      } else if (session.role === 'teacher' || session.role === 'administrator') {
        let attempt = kernelContainer.db
          .prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
          .get(cwInfo.id, 'teacher', 'active') as any;

        if (!attempt) {
          const attemptId = 'att_teacher_' + crypto.randomBytes(8).toString('hex');
          kernelContainer.db
            .prepare(
              'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
            )
            .run(attemptId, cwInfo.id, 'teacher', Date.now(), 'active');
          attempt = { id: attemptId };
        }

        studentInfo = {
          student_id: session.userId || 'teacher',
          student_name: (session.name || 'Teacher') + ' (Test)',
          class_id: '',
          attempt_id: attempt.id,
        };
      }
    }
  }

  if (studentInfo.attempt_id === 'guest-attempt') {
    let attempt = kernelContainer.db
      .prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
      .get(cwInfo.id, 'guest', 'active') as any;

    if (!attempt) {
      const attemptId = 'att_guest_' + crypto.randomBytes(8).toString('hex');
      kernelContainer.db
        .prepare(
          'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(attemptId, cwInfo.id, 'guest', Date.now(), 'active');
      attempt = { id: attemptId };
    }
    studentInfo.attempt_id = attempt.id;
  }

  const runtimeScripts = collectCoursewareRuntimeScripts(cwInfo);

  // P4 修复：向课件注入宿主 origin，供桥接 SDK 入站校验（防同页恶意 iframe 伪造命令/进度）
  let hostOrigin = '';
  try {
    const host = (req?.headers?.host || req?.get?.('host') || '').toString().trim();
    if (host) {
      const protoHeader = (req?.headers?.['x-forwarded-proto'] || '').toString().split(',')[0].trim();
      const proto =
        protoHeader === 'https' || protoHeader === 'http'
          ? protoHeader
          : req?.protocol === 'https' || req?.secure
            ? 'https'
            : 'http';
      hostOrigin = `${proto}://${host}`;
    }
  } catch {
    hostOrigin = '';
  }

  const injection = `
<!-- LMS Courseware SDK Inject -->
<script>
window.__LMS_STUDENT__ = ${JSON.stringify(studentInfo)};
window.__LMS_HOST_ORIGIN__ = ${JSON.stringify(hostOrigin)};
window.__LMS_COURSEWARE__ = {
  uuid: ${JSON.stringify(cwInfo.uuid)},
  name: ${JSON.stringify(cwInfo.name)}
};
</script>
<script>${BRIDGE_SDK_CODE}</script>${runtimeScripts.head}
`;

  let html = htmlContent;
  // Strip out the external frog-sdk.js and init-frog.js scripts that crash inside strict sandboxed iframe
  html = html.replace(
    /<script[^>]*src="[^"]*frog-sdk\.js"[^>]*><\/script>/gi,
    '<!-- Removed frog-sdk.js to prevent sandboxed iframe crash -->',
  );
  html = html.replace(
    /<script[^>]*src='[^']*frog-sdk\.js'[^>]*><\/script>/gi,
    '<!-- Removed frog-sdk.js to prevent sandboxed iframe crash -->',
  );
  html = html.replace(
    /<script[^>]*src="[^"]*init-frog\.js"[^>]*><\/script>/gi,
    '<!-- Removed init-frog.js to prevent sandboxed iframe crash -->',
  );
  html = html.replace(
    /<script[^>]*src='[^']*init-frog\.js'[^>]*><\/script>/gi,
    '<!-- Removed init-frog.js to prevent sandboxed iframe crash -->',
  );

  // 移除导航逃逸向量：<base> 可重定向相对资源、<meta http-equiv=refresh> 可跳转（沙箱内已隔离，仍防御性去除）
  html = html.replace(/<base\b[^>]*>/gi, '<!-- Removed base tag -->');
  html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '<!-- Removed meta refresh -->');

  if (html.toLowerCase().includes('<head>')) {
    html = html.replace(/<head>/i, `<head>${injection}`);
  } else if (html.toLowerCase().includes('<html>')) {
    html = html.replace(/<html>/i, `<html><head>${injection}</head>`);
  } else {
    html = injection + html;
  }

  // 插件注册的 body-end 脚本：放在 Bridge SDK 之后、且尽量靠后，确保能观察到课件自己的 DOM
  if (runtimeScripts.bodyEnd) {
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${runtimeScripts.bodyEnd}</body>`);
    } else {
      html += runtimeScripts.bodyEnd;
    }
  }
  return html;
}
export const generateStudentNumber = (db: any): string => {
  const rows = db.prepare('SELECT student_number FROM students WHERE student_number LIKE ?').all('S%') as {
    student_number: string;
  }[];
  let maxSeq = 0;
  for (const row of rows) {
    const numStr = row.student_number || '';
    if (numStr.startsWith('S')) {
      const seqStr = numStr.substring(1);
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `S${nextSeq.toString().padStart(3, '0')}`;
};
