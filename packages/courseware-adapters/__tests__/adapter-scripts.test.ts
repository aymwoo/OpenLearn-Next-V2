import { describe, it, expect } from 'vitest';
import { adapterScriptsForProtocol } from '../index.js';

/** 轻量语法校验：脚本最终要嵌进课件 <script>，解析失败会在运行期整段失效。 */
function parseable(source: string): boolean {
  try {
    new Function(source);
    return true;
  } catch {
    return false;
  }
}

describe('courseware adapter scripts', () => {
  it('html 不注入任何适配器', () => {
    expect(adapterScriptsForProtocol('html')).toEqual([]);
  });

  it('SCORM 1.2 暴露 window.API 且可解析', () => {
    const scripts = adapterScriptsForProtocol('scorm-12');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].position).toBe('head');
    expect(scripts[0].source).toContain('window.API = api');
    expect(scripts[0].source).toContain('LMSInitialize');
    expect(scripts[0].source).toContain('cmi.core.score.raw');
    expect(scripts[0].source).toContain("protocol: 'scorm-12'");
    expect(parseable(scripts[0].source)).toBe(true);
  });

  it('SCORM 2004 暴露 window.API_1484_11 且可解析', () => {
    const scripts = adapterScriptsForProtocol('scorm-2004');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].source).toContain('window.API_1484_11 = api');
    expect(scripts[0].source).toContain('cmi.completion_status');
    expect(scripts[0].source).toContain('cmi.score.scaled');
    expect(scripts[0].source).toContain("protocol: 'scorm-2004'");
    expect(parseable(scripts[0].source)).toBe(true);
  });

  it('xAPI 同时覆盖 ADL 包装与 /statements 网络拦截', () => {
    const scripts = adapterScriptsForProtocol('xapi');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].source).toContain('window.ADL');
    expect(scripts[0].source).toContain('XAPIWrapper');
    expect(scripts[0].source).toContain('statements');
    expect(scripts[0].source).toContain("protocol: 'xapi'");
    expect(parseable(scripts[0].source)).toBe(true);
  });

  it('H5P 监听 postMessage 与 externalDispatcher', () => {
    const scripts = adapterScriptsForProtocol('h5p');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].source).toContain("window.addEventListener('message'");
    expect(scripts[0].source).toContain('externalDispatcher');
    expect(scripts[0].source).toContain('setFinished');
    expect(scripts[0].source).toContain("protocol: 'h5p'");
    expect(parseable(scripts[0].source)).toBe(true);
  });
});
