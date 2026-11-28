import path from 'path';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ICoursewareRuntimeScriptRegistryToken } from '../../packages/core/di/interfaces.js';
import { getCookieToken, getValidSession } from '../middleware/auth.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { sanitizeExternalFontsInHtml } from '../../packages/core/security/font-sanitizer.js';
import { resolveHookTelemetryPolicy } from '../services/runtime-policies.js';
import { adapterScriptsForProtocol, type CoursewareProtocol } from '../../packages/courseware-adapters/index.js';
import { resolveCoursewareProtocol } from '../utils/courseware-protocol.js';
import { resolveOrCreateCoursewareAttempt } from '../utils/courseware-attempt.js';

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
  "sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'self'; default-src 'self' 'unsafe-inline' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src-attr 'unsafe-inline'; style-src-attr 'unsafe-inline'; connect-src 'self' blob: data:;";

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

/**
 * 解析请求对应的宿主 origin（`<proto>://<host>`），供桥接 SDK 出站消息定向。
 *
 * 单一实现：`injectLmsSdk`（/runtime、/api/resources、/api/courseware 直出 HTML）
 * 与 `/bridge.js` 路由（白板 srcDoc 路径）共用，避免两处 proto 推导逻辑漂移。
 * Host 缺失时返回空串——上层桥接会据此 fail-closed（见 bridge.js `__lmsHostOrigin`）。
 */
export function resolveRequestHostOrigin(req: any): string {
  try {
    const host = (req?.headers?.host || req?.get?.('host') || '').toString().trim();
    if (!host) return '';
    const protoHeader = (req?.headers?.['x-forwarded-proto'] || '').toString().split(',')[0].trim();
    const proto =
      protoHeader === 'https' || protoHeader === 'http'
        ? protoHeader
        : req?.protocol === 'https' || req?.secure
          ? 'https'
          : 'http';
    return `${proto}://${host}`;
  } catch {
    return '';
  }
}

export interface LmsInjectionLaunch {
  /** token 声明的 attempt（优先于现场创建） */
  attemptId?: string;
  /** token 声明的用户 id，用于注入 __LMS_STUDENT__.student_id */
  userId?: string;
  /** token 声明的课节 id（当前仅随 token 传递，供后续审计/路由使用） */
  lessonId?: string;
  /** 覆盖注入的学习者 id / 名称（缺省从 userId 与会话推导） */
  learnerId?: string;
  learnerName?: string;
  classId?: string;
  role?: string;
}

export interface LmsInjectionOptions {
  /** 已解析的课件包协议；缺省时按课件 id/uuid 现场解析 */
  protocol?: CoursewareProtocol;
  /** v2 access token 声明；存在时不再创建 guest/新 attempt */
  launch?: LmsInjectionLaunch;
  /** 原始 launch token（`?ct=`），注入给桥接以便后续上报携带 */
  launchToken?: string;
}

export function injectLmsSdk(
  htmlContent: string,
  req: any,
  cwInfo: { id: string; name: string; uuid: string },
  options: LmsInjectionOptions = {},
) {
  const token = getCookieToken(req);
  const session = token ? getValidSession(token) : null;
  const launch = options.launch;

  // v2 token 已绑定 attempt/user：直接采用声明，不再为匿名访问者创建 guest attempt。
  let studentInfo: { student_id: string; student_name: string; class_id: string; attempt_id: string };
  if (launch?.attemptId) {
    studentInfo = {
      student_id: launch.learnerId || launch.userId || 'guest',
      student_name: launch.learnerName || (launch.role === 'teacher' ? 'Teacher (Test)' : 'Guest Student'),
      class_id: launch.classId || '',
      attempt_id: launch.attemptId,
    };
  } else {
    const resolved = resolveOrCreateCoursewareAttempt(kernelContainer.db, cwInfo.id, session);
    studentInfo = {
      student_id: resolved.learnerId,
      student_name: resolved.learnerName,
      class_id: resolved.classId,
      attempt_id: resolved.attemptId,
    };
  }

  const protocol =
    options.protocol ?? resolveCoursewareProtocol({ id: cwInfo.id, uuid: cwInfo.uuid, name: cwInfo.name });
  const adapterScripts = adapterScriptsForProtocol(protocol);
  const adapterManaged = adapterScripts.length > 0;
  const renderAdapter = (script: (typeof adapterScripts)[number]) =>
    `\n<!-- Courseware Adapter (${script.protocol}/${script.id}) -->\n<script>${script.source}</script>`;
  const adapterHead = adapterScripts
    .filter((script) => script.position === 'head')
    .map(renderAdapter)
    .join('');
  const adapterBody = adapterScripts
    .filter((script) => script.position === 'body-end')
    .map(renderAdapter)
    .join('');

  const runtimeScripts = collectCoursewareRuntimeScripts(cwInfo);

  // P4 修复：向课件注入宿主 origin，供桥接 SDK 入站校验（防同页恶意 iframe 伪造命令/进度）
  const hostOrigin = resolveRequestHostOrigin(req);

  const injection = `
<!-- LMS Courseware SDK Inject -->
<script>
window.__LMS_STUDENT__ = ${JSON.stringify(studentInfo)};
window.__LMS_HOST_ORIGIN__ = ${JSON.stringify(hostOrigin)};
window.__LMS_ENFORCE_ORIGIN__ = ${process.env.NODE_ENV === 'production'};
window.__LMS_HOOK_TELEMETRY__ = ${resolveHookTelemetryPolicy(kernelContainer.db).enabled ? 'true' : 'false'};
window.__LMS_COURSEWARE__ = {
  uuid: ${JSON.stringify(cwInfo.uuid)},
  name: ${JSON.stringify(cwInfo.name)},
  protocol: ${JSON.stringify(protocol)}
};
window.__LMS_ADAPTER_MANAGED__ = ${adapterManaged ? 'true' : 'false'};
window.__LMS_LAUNCH_TOKEN__ = ${JSON.stringify(options.launchToken || '')};
</script>
<script>${BRIDGE_SDK_CODE}</script>${adapterHead}${runtimeScripts.head}
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

  // Issue #518：移除外部 Google Fonts 引用，避免违反宿主/沙箱 CSP 或内网离线阻塞，并注入系统回退字体
  html = sanitizeExternalFontsInHtml(html).html;

  if (html.toLowerCase().includes('<head>')) {
    html = html.replace(/<head>/i, `<head>${injection}`);
  } else if (html.toLowerCase().includes('<html>')) {
    html = html.replace(/<html>/i, `<html><head>${injection}</head>`);
  } else {
    html = injection + html;
  }

  // 插件注册的 body-end 脚本 + 协议适配器：放在 Bridge SDK 之后、且尽量靠后，
  // 确保能观察到课件自己的 DOM，也保证 window.LMS 已就绪。
  const bodyEndScripts = `${runtimeScripts.bodyEnd}${adapterBody}`;
  if (bodyEndScripts) {
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${bodyEndScripts}</body>`);
    } else {
      html += bodyEndScripts;
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
