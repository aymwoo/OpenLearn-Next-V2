import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';
import { WidgetTitleBar } from './WidgetTitleBar';

/**
 * Visible limitation for the whiteboard code runner.
 * Replaces the old "isolated Web Worker" status line, which hid that a
 * same-origin worker's fetch sent the page session cookie.
 */
export const CODE_SANDBOX_DESCRIPTION = 'Pure computation only. No page session, cookies, document, or LMS API.';

const SANDBOX_MESSAGE_SOURCE = 'openlearn-code-sandbox';

const SANDBOX_WORKER_PREAMBLE = [
  "'use strict';",
  'const denied = function sandboxDenied() {',
  "  throw new Error('Credentialed network is disabled in this sandbox');",
  '};',
  "const blocked = ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','Worker','SharedWorker','Request','WebTransport'];",
  'for (const name of blocked) {',
  '  try {',
  '    Object.defineProperty(self, name, { configurable: false, enumerable: true, writable: false, value: denied });',
  '  } catch (e) {}',
  '  let obj = Object.getPrototypeOf(self);',
  '  while (obj) {',
  '    if (Object.getOwnPropertyDescriptor(obj, name)) {',
  '      try {',
  '        Object.defineProperty(obj, name, { configurable: false, enumerable: true, writable: false, value: denied });',
  '      } catch (e2) {}',
  '    }',
  '    obj = Object.getPrototypeOf(obj);',
  '  }',
  '}',
  "try { Object.defineProperty(self, 'Function', { configurable: false, writable: false, value: denied }); } catch (e) {}",
  "try { Object.defineProperty(self, 'eval', { configurable: false, writable: false, value: denied }); } catch (e) {}",
  'try {',
  "  Object.defineProperty(Function.prototype, 'constructor', { configurable: false, writable: false, value: denied });",
  '} catch (e) {}',
  'try {',
  '  let nav = self.navigator;',
  '  while (nav) {',
  "    if (Object.getOwnPropertyDescriptor(nav, 'sendBeacon')) {",
  '      try {',
  "        Object.defineProperty(nav, 'sendBeacon', { configurable: false, writable: false, value: denied });",
  '      } catch (e2) {}',
  '    }',
  '    nav = Object.getPrototypeOf(nav);',
  '  }',
  '} catch (e) {}',
  "if (typeof document !== 'undefined' && document) {",
  '  try {',
  "    Object.defineProperty(document, 'cookie', {",
  '      configurable: false,',
  '      get() { return ""; },',
  '      set() {},',
  '    });',
  '  } catch (e) {}',
  '}',
  'const logs = [];',
  'console.log = (...args) => {',
  '  logs.push(args.map((a) => {',
  "    if (typeof a === 'object' && a !== null) {",
  '      try { return JSON.stringify(a); } catch (e) { return String(a); }',
  '    }',
  '    return String(a);',
  "  }).join(' '));",
  '};',
  '(async () => {',
  '  try {',
  '    const value = await (async function () {',
].join('\n');

const SANDBOX_WORKER_EPILOGUE = [
  '    })();',
  '    if (value !== undefined) logs.push("Return: " + String(value));',
  '    self.postMessage({ source: "openlearn-code-sandbox", success: true, logs: logs.join("\\n") });',
  '  } catch (err) {',
  '    self.postMessage({',
  '      source: "openlearn-code-sandbox",',
  '      success: false,',
  '      error: err && err.message ? err.message : String(err),',
  '      logs: logs.join("\\n"),',
  '    });',
  '  }',
  '})();',
  '',
].join('\n');

/**
 * Worker source for one snippet. The parent page never evaluates the snippet:
 * it is text inside a blob worker. Network globals are replaced before the
 * snippet runs, so fetch cannot send the page's session cookie.
 *
 * An opaque iframe (`sandbox="allow-scripts"`) cannot run this under the
 * production CSP (`script-src 'self' blob:'`): inline scripts are blocked, and
 * the opaque document cannot load a blob script created by the parent.
 */
export function buildSandboxWorkerSource(userCode: string): string {
  return `${SANDBOX_WORKER_PREAMBLE}\n${userCode}\n${SANDBOX_WORKER_EPILOGUE}`;
}

/** Reject syntax that can still perform a credentialed module fetch. */
export function getSandboxRunBlock(userCode: string): string | null {
  const importCall = /(^|[^.\w$])import\s*\(/m.test(userCode);
  const importDecl = /(^|\n)\s*import\s+[\w*{]/m.test(userCode);
  if (importCall || importDecl) {
    return `Error: ${CODE_SANDBOX_DESCRIPTION}`;
  }
  return null;
}

interface SandboxWorkerMessage {
  source?: string;
  success?: boolean;
  logs?: string;
  error?: string;
}

interface ActiveRun {
  worker: Worker;
  url: string;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
}

export function CodeSandboxWrapper({
  elementId,
  data,
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete,
  readOnly = false,
  isMinimized = false,
  isMaximized = false,
  hidden = false,
  isPropertiesOpen = false,
  onOpenProperties,
  onMinimize,
  onRestore,
  onMaximize,
  onBrowserFullscreen,
}: {
  elementId: string;
  data: any;
  readOnly?: boolean;
  onElementUpdate?: (id: string, data: any) => Promise<void>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onDelete: () => void;
  isMinimized?: boolean;
  isMaximized?: boolean;
  /** 浏览器全屏时隐藏标题栏（宿主统一注入） */
  hidden?: boolean;
  isPropertiesOpen?: boolean;
  onOpenProperties?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onMaximize?: () => void;
  /** 整个浏览器全屏（脱离白板 + 原生全屏），由宿主统一注入 */
  onBrowserFullscreen?: () => void;
}) {
  const [code, setCode] = useState(data.code || "console.log('Hello from sandbox!');");
  const [output, setOutput] = useState('');
  const activeRef = useRef<ActiveRun | null>(null);

  useEffect(() => {
    return () => {
      const active = activeRef.current;
      if (!active) return;
      active.settled = true;
      if (active.timer !== undefined) clearTimeout(active.timer);
      active.worker.terminate();
      URL.revokeObjectURL(active.url);
      activeRef.current = null;
    };
  }, []);

  /**
   * 服务端图元数据 → 本地 state 的反向同步。
   *
   * 教师端改代码后会持久化并广播刷新，学生端的 `data` 因此会变；
   * 若不回填，本地 `code` 会一直停在打开时的那份，学生看到的仍是旧代码。
   * 范式与 `RevealPresentationWrapper` 一致。
   */
  useEffect(() => {
    if (data.code !== undefined && data.code !== code) {
      setCode(data.code);
    }
  }, [data.code]);

  const stopActive = () => {
    const active = activeRef.current;
    if (!active || active.settled) return;
    active.settled = true;
    if (active.timer !== undefined) clearTimeout(active.timer);
    active.worker.terminate();
    URL.revokeObjectURL(active.url);
    activeRef.current = null;
  };

  const runCode = () => {
    const blocked = getSandboxRunBlock(code);
    if (blocked) {
      stopActive();
      setOutput(blocked);
      return;
    }

    stopActive();
    setOutput(`Running. ${CODE_SANDBOX_DESCRIPTION}`);

    const workerUrl = URL.createObjectURL(
      new Blob([buildSandboxWorkerSource(code)], { type: 'application/javascript' }),
    );
    let worker: Worker;
    try {
      worker = new Worker(workerUrl);
    } catch (e: unknown) {
      URL.revokeObjectURL(workerUrl);
      const message = e instanceof Error ? e.message : String(e);
      setOutput(`Failed to start the sandbox: ${message}`);
      return;
    }

    const active: ActiveRun = { worker, url: workerUrl, settled: false };

    const finish = (text: string) => {
      if (active.settled) return;
      active.settled = true;
      if (active.timer !== undefined) clearTimeout(active.timer);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      if (activeRef.current === active) activeRef.current = null;
      setOutput(text);
    };

    active.timer = setTimeout(() => {
      finish('Execution timed out (3000ms limit). Worker terminated.');
    }, 3000);
    activeRef.current = active;

    worker.onmessage = (event: MessageEvent<SandboxWorkerMessage>) => {
      const payload = event.data;
      if (!payload || payload.source !== SANDBOX_MESSAGE_SOURCE) return;
      if (payload.success) {
        finish(payload.logs || 'Code executed successfully (no output)');
      } else {
        finish((payload.logs ? payload.logs + '\n' : '') + 'Error: ' + (payload.error || 'unknown error'));
      }
    };

    worker.onerror = (event) => {
      finish(`Worker Error: ${event.message || 'unknown error'}`);
    };
  };

  const handleBlur = () => {
    if (onElementUpdate && code !== data.code) {
      onElementUpdate(elementId, { ...data, code });
    }
  };

  return (
    <div
      className="w-full h-full bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden flex flex-col font-mono text-sm"
      style={{ pointerEvents: readOnly ? 'none' : 'auto' }}
    >
      <WidgetTitleBar
        title={data.title || 'JS Sandbox'}
        icon={<Terminal size={13} className="text-emerald-500" />}
        readOnly={readOnly}
        isMinimized={isMinimized}
        isMaximized={isMaximized}
        hidden={hidden}
        isPropertiesOpen={isPropertiesOpen}
        themeColor="default"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onOpenProperties={onOpenProperties}
        onMinimize={onMinimize}
        onRestore={onRestore}
        onMaximize={onMaximize}
        onBrowserFullscreen={onBrowserFullscreen}
        onDelete={onDelete}
        extraActions={
          !readOnly ? (
            <button
              type="button"
              onClick={runCode}
              onPointerDown={(e) => e.stopPropagation()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 rounded shadow text-xs cursor-pointer font-sans mr-1"
            >
              Run
            </button>
          ) : null
        }
      />
      {!isMinimized && (
        <>
          <p
            data-testid="code-sandbox-description"
            className="px-3 py-1 text-[10px] leading-snug text-amber-200/90 bg-gray-950 border-b border-gray-800 shrink-0"
          >
            {CODE_SANDBOX_DESCRIPTION}
          </p>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onBlur={handleBlur}
            className="w-full flex-1 min-h-0 bg-gray-900 text-green-400 p-3 focus:outline-none resize-none font-mono text-xs"
            placeholder="// Write JS here"
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
          />
          {output && (
            <div className="bg-black text-gray-400 p-2 border-t border-gray-800 h-24 overflow-y-auto whitespace-pre-wrap text-xs shrink-0">
              {output}
            </div>
          )}
        </>
      )}
    </div>
  );
}
