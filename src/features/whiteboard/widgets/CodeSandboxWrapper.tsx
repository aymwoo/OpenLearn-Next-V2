import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';

export function CodeSandboxWrapper({ 
  elementId, 
  data, 
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete
}: { 
  elementId: string; 
  data: any; 
  onElementUpdate?: (id: string, data: any) => Promise<void>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDelete: () => void;
}) {
  const [code, setCode] = useState(data.code || "console.log('Hello from sandbox!');");
  const [output, setOutput] = useState('');

  const runCode = () => {
    try {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => {
         logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
         originalLog(...args);
      };
      
      const result = eval(code);
      if (result !== undefined) logs.push(`Return: ${result}`);
      setOutput(logs.join('\n'));
      
      console.log = originalLog;
    } catch (e: any) {
      setOutput(`Error: ${e.message}`);
    }
  };

  const handleBlur = () => {
     if (onElementUpdate && code !== data.code) {
        onElementUpdate(elementId, { ...data, code });
     }
  };

  return (
    <div className="w-full h-full bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden flex flex-col font-mono text-sm" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-gray-800 text-gray-300 px-3 py-1.5 flex justify-between items-center text-xs border-b border-gray-700 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
         <span className="flex items-center gap-1">JS Sandbox</span>
         <div className="flex items-center gap-1.5" onPointerDown={e => e.stopPropagation()}>
           <button onClick={runCode} className="bg-green-600 hover:bg-green-500 text-white px-2 py-0.5 rounded shadow text-[10px] cursor-pointer">Run</button>
           <button onClick={onDelete} className="p-0.5 hover:bg-gray-700 rounded text-gray-400 hover:text-red-500 transition-colors cursor-pointer" title="删除组件">
             <Trash2 size={13} />
           </button>
         </div>
      </div>
      <textarea 
         value={code}
         onChange={e => setCode(e.target.value)}
         onBlur={handleBlur}
         className="w-full flex-1 min-h-0 bg-gray-900 text-green-400 p-3 focus:outline-none resize-none font-mono text-xs"
         placeholder="// Write JS here"
         onPointerDown={e => { e.stopPropagation(); }}
         onKeyDown={e => { e.stopPropagation(); }}
      />
      {output && (
        <div className="bg-black text-gray-400 p-2 border-t border-gray-800 h-24 overflow-y-auto whitespace-pre-wrap text-[10px] shrink-0">
           {output}
         </div>
      )}
    </div>
  );
}
