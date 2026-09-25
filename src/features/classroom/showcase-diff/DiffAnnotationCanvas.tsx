import React, { useRef, useState, useCallback, useEffect } from 'react';
import type {
  DiffToolType,
  DiffAnnotationStroke,
  DiffStamp,
  DiffStampType,
  DiffPoint,
} from './types';
import { DIFF_STAMP_PRESETS } from './diff-presets';

export interface DiffAnnotationCanvasProps {
  activeTool: DiffToolType;
  activeColor: string;
  activeStampType: DiffStampType;
  strokes: DiffAnnotationStroke[];
  setStrokes: React.Dispatch<React.SetStateAction<DiffAnnotationStroke[]>>;
  stamps: DiffStamp[];
  setStamps: React.Dispatch<React.SetStateAction<DiffStamp[]>>;
  isOverlayActive: boolean;
}

export const DiffAnnotationCanvas: React.FC<DiffAnnotationCanvasProps> = ({
  activeTool,
  activeColor,
  activeStampType,
  strokes,
  setStrokes,
  stamps,
  setStamps,
  isOverlayActive,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [laserPos, setLaserPos] = useState<DiffPoint | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentStrokeRef = useRef<DiffAnnotationStroke | null>(null);

  // 激光笔拖尾定时清除
  const laserTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isOverlayActive || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const point: DiffPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (activeTool === 'laser') {
        setLaserPos(point);
        return;
      }

      if (activeTool === 'stamp') {
        const preset = DIFF_STAMP_PRESETS.find((p) => p.type === activeStampType);
        const newStamp: DiffStamp = {
          id: `stamp-${Date.now()}-${Math.random()}`,
          x: point.x,
          y: point.y,
          type: activeStampType,
          label: preset?.label ?? '思维剖析',
          color: activeColor,
          screenIndex: 0,
        };
        setStamps((prev) => [...prev, newStamp]);
        return;
      }

      if (activeTool === 'highlighter' || activeTool === 'pen') {
        setIsDrawing(true);
        const newStroke: DiffAnnotationStroke = {
          id: `stroke-${Date.now()}-${Math.random()}`,
          tool: activeTool,
          color: activeColor,
          width: activeTool === 'highlighter' ? 18 : 3,
          opacity: activeTool === 'highlighter' ? 0.45 : 1,
          points: [point],
        };
        currentStrokeRef.current = newStroke;
        setStrokes((prev) => [...prev, newStroke]);
      }
    },
    [activeTool, activeColor, activeStampType, isOverlayActive, setStamps, setStrokes],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isOverlayActive || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const point: DiffPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (activeTool === 'laser') {
        setLaserPos(point);
        if (laserTimerRef.current) clearTimeout(laserTimerRef.current);
        laserTimerRef.current = setTimeout(() => {
          setLaserPos(null);
        }, 1200);
        return;
      }

      if (isDrawing && currentStrokeRef.current) {
        currentStrokeRef.current.points.push(point);
        const strokeId = currentStrokeRef.current.id;
        setStrokes((prev) =>
          prev.map((s) => (s.id === strokeId ? { ...s, points: [...currentStrokeRef.current!.points] } : s)),
        );
      }
    },
    [activeTool, isDrawing, isOverlayActive, setStrokes],
  );

  const handlePointerUp = useCallback(() => {
    setIsDrawing(false);
    currentStrokeRef.current = null;
  }, []);

  const removeStamp = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeTool === 'eraser') {
      setStamps((prev) => prev.filter((st) => st.id !== id));
    }
  };

  useEffect(() => {
    return () => {
      if (laserTimerRef.current) clearTimeout(laserTimerRef.current);
    };
  }, []);

  if (!isOverlayActive) return null;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      data-testid="diff-annotation-overlay"
      className={`absolute inset-0 z-20 overflow-hidden select-none ${
        activeTool === 'laser'
          ? 'cursor-none'
          : activeTool === 'stamp'
            ? 'cursor-copy'
            : activeTool === 'eraser'
              ? 'cursor-cell'
              : 'cursor-crosshair'
      }`}
      style={{ touchAction: 'none' }}
    >
      {/* 矢量笔迹图层 */}
      <svg className="w-full h-full pointer-events-none absolute inset-0">
        {strokes.map((stroke) => {
          if (stroke.points.length < 2) return null;
          const d = stroke.points.reduce(
            (acc, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`),
            '',
          );
          return (
            <path
              key={stroke.id}
              d={d}
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeOpacity={stroke.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          );
        })}
      </svg>

      {/* 思维印章图层 */}
      {stamps.map((stamp) => {
        const preset = DIFF_STAMP_PRESETS.find((p) => p.type === stamp.type);
        return (
          <div
            key={stamp.id}
            onClick={(e) => removeStamp(stamp.id, e)}
            style={{
              left: `${stamp.x}px`,
              top: `${stamp.y}px`,
              transform: 'translate(-50%, -50%)',
            }}
            className={`absolute z-30 px-2.5 py-1 rounded-full border shadow-lg flex items-center gap-1 text-xs font-bold backdrop-blur-md transition-transform hover:scale-105 pointer-events-auto ${
              preset?.bgColor ?? 'bg-amber-500/20'
            } ${preset?.borderColor ?? 'border-amber-500/40'} ${preset?.textColor ?? 'text-amber-500'}`}
          >
            <span>{preset?.icon}</span>
            <span>{preset?.shortLabel ?? stamp.label}</span>
          </div>
        );
      })}

      {/* 动态激光笔焦点与光晕拖尾 */}
      {activeTool === 'laser' && laserPos && (
        <div
          data-testid="laser-pointer-cursor"
          style={{
            left: `${laserPos.x}px`,
            top: `${laserPos.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
          className="absolute pointer-events-none z-40 flex items-center justify-center"
        >
          <div className="w-6 h-6 rounded-full bg-red-500/30 animate-ping absolute" />
          <div className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_15px_#ef4444] border-2 border-white" />
        </div>
      )}
    </div>
  );
};
