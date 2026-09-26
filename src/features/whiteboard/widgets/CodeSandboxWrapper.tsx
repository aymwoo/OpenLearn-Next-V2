import React, { useState } from 'react';
import { Terminal } from 'lucide-react';
import { WidgetTitleBar } from './WidgetTitleBar';

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
  isPropertiesOpen = false,
  onOpenProperties,
  onMinimize,
  onRestore,
  onMaximize,
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
  isPropertiesOpen?: boolean;
  onOpenProperties?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onMaximize?: () => void;
}) {
  const [code, setCode] = useState(data.code || "console.log('Hello from sandbox!');");
  const [output, setOutput] = useState('');

  const runCode = () => {
    setOutput('Running in isolated Web Worker...');
    try {
      // 在独立的 Web Worker 沙箱中执行不可信代码，隔离 window / document / localStorage
      const workerScript = `
        const logs = [];
        const originalLog = console.log;
        console.log = (...args) => {
          logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
        };
        self.onmessage = function(e) {
          try {
            const fn = new Function(e.data);
            const res = fn();
            if (res !== undefined) logs.push('Return: ' + String(res));
            self.postMessage({ success: true, logs: logs.join('\\n') });
          } catch (err) {
            self.postMessage({ success: false, error: err.message, logs: logs.join('\\n') });
          }
        };
      `;
      const blob = new Blob([workerScript], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);

      const timer = setTimeout(() => {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        setOutput('Execution timed out (3000ms limit). Worker terminated.');
      }, 3000);

      worker.onmessage = (e) => {
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        if (e.data.success) {
          setOutput(e.data.logs || 'Code executed successfully (no output)');
        } else {
          setOutput((e.data.logs ? e.data.logs + '\n' : '') + 'Error: ' + e.data.error);
        }
      };

      worker.onerror = (err) => {
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        setOutput(`Worker Error: ${err.message}`);
      };

      worker.postMessage(code);
    } catch (e: any) {
      setOutput(`Failed to spawn isolated worker: ${e.message}`);
    }
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
        isPropertiesOpen={isPropertiesOpen}
        themeColor="default"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onOpenProperties={onOpenProperties}
        onMinimize={onMinimize}
        onRestore={onRestore}
        onMaximize={onMaximize}
        onDelete={onDelete}
        extraActions={
          !readOnly ? (
            <button
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
