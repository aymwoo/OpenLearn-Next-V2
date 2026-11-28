/**
 * 互动课件协议适配器（聚合出口）。
 *
 * 设计约束（与 Gitee Issue IKYP8P 对齐）：
 * - 不新建运行时、不新建成绩表；适配器只把外部协议翻译进现有 `window.LMS`；
 * - 新课件继续使用官方 SDK，不发明平行的 `platform.reportScore`；
 * - 协议识别与脚本选择集中在本包，服务端只按结果拼接。
 */
export * from './types.js';
export * from './protocol.js';
export * from './completion.js';
export { SCORM12_ADAPTER_SCRIPT } from './scorm12.js';
export { SCORM2004_ADAPTER_SCRIPT } from './scorm2004.js';
export { XAPI_ADAPTER_SCRIPT } from './xapi.js';
export { H5P_ADAPTER_SCRIPT } from './h5p.js';

import type { CoursewareAdapterScript, CoursewareProtocol } from './types.js';
import { SCORM12_ADAPTER_SCRIPT } from './scorm12.js';
import { SCORM2004_ADAPTER_SCRIPT } from './scorm2004.js';
import { XAPI_ADAPTER_SCRIPT } from './xapi.js';
import { H5P_ADAPTER_SCRIPT } from './h5p.js';

/** 按协议返回需要注入 iframe 的适配器脚本（无适配器时返回空数组）。 */
export function adapterScriptsForProtocol(protocol: CoursewareProtocol): CoursewareAdapterScript[] {
  if (protocol === 'scorm-12') {
    return [{ id: 'scorm-12-runtime', protocol, position: 'head', source: SCORM12_ADAPTER_SCRIPT }];
  }
  if (protocol === 'scorm-2004') {
    return [{ id: 'scorm-2004-runtime', protocol, position: 'head', source: SCORM2004_ADAPTER_SCRIPT }];
  }
  if (protocol === 'xapi') {
    return [{ id: 'xapi-statements', protocol, position: 'head', source: XAPI_ADAPTER_SCRIPT }];
  }
  if (protocol === 'h5p') {
    return [{ id: 'h5p-bridge', protocol, position: 'head', source: H5P_ADAPTER_SCRIPT }];
  }
  return [];
}
