import React, { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';

export function MathGraphWrapper({ 
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
  const [equation, setEquation] = useState<string>(data.equation || "Math.sin(x)");
  const [points, setPoints] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [containerDimensions, setContainerDimensions] = useState({ width: 400, height: 300 });
  const graphContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!graphContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerDimensions({
          width: entry.contentRect.width || 400,
          height: entry.contentRect.height || 300
        });
      }
    });
    observer.observe(graphContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      const generatedPoints = [];
      const centerX = containerDimensions.width / 2;
      const centerY = containerDimensions.height / 2;
      for (let xUnit = -10; xUnit <= 10; xUnit += 0.2) {
         const x = xUnit;
         const y = eval(equation);
         if (typeof y !== 'number' || isNaN(y)) continue;
         const px = centerX + x * 20; // scale 20, center centerX
         const py = centerY - y * 20; // scale 20, center centerY
         generatedPoints.push(`${px},${py}`);
      }
      setPoints(generatedPoints.join(' '));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, [equation, containerDimensions]);

  const handleBlur = () => {
    if (onElementUpdate && equation !== data.equation) {
       onElementUpdate(elementId, { ...data, equation });
    }
  };

  return (
    <div className="w-full h-full bg-white border border-gray-300 rounded-lg shadow-xl overflow-hidden flex flex-col font-mono text-sm" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-gray-100 text-gray-700 px-3 py-1.5 flex justify-between items-center text-xs border-b border-gray-300 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
         <span className="flex items-center gap-1 font-semibold text-gray-600">Math Graph Sandbox</span>
         <button 
           onClick={onDelete} 
           onPointerDown={e => e.stopPropagation()}
           className="p-1 hover:bg-gray-200 rounded-full text-gray-500 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center" 
           title="删除组件"
         >
           <Trash2 size={13} />
         </button>
      </div>
      <div className="p-3 border-b border-gray-200 flex-none flex flex-col gap-1">
         <span className="text-gray-500 text-xs">y = f(x)</span>
         <input 
            type="text" 
            value={equation} 
            onChange={e => setEquation(e.target.value)}
            onBlur={handleBlur}
            className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-indigo-500 font-mono text-xs"
            placeholder="e.g. Math.sin(x) * x"
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
         />
         {error && <div className="text-red-500 text-[10px] mt-1">{error}</div>}
      </div>
      <div className="flex-1 relative overflow-hidden bg-white min-h-0" ref={graphContainerRef}>
          <svg width={containerDimensions.width} height={containerDimensions.height} viewBox={`0 0 ${containerDimensions.width} ${containerDimensions.height}`} className="absolute top-0 left-0">
             {/* Grid */}
             <line x1={containerDimensions.width / 2} y1="0" x2={containerDimensions.width / 2} y2={containerDimensions.height} stroke="#e5e7eb" strokeWidth="1" />
             <line x1="0" y1={containerDimensions.height / 2} x2={containerDimensions.width} y2={containerDimensions.height / 2} stroke="#e5e7eb" strokeWidth="1" />
             {/* Path */}
             {points && <polyline points={points} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />}
          </svg>
      </div>
    </div>
  );
}
