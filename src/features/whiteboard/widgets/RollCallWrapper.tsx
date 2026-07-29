import React, { useState } from 'react';
import { Sparkles, Trash2, UserCheck, HelpCircle, Shuffle } from 'lucide-react';

export function RollCallWrapper({
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
  const allStudents = data.allStudents || [
    { id: "mock-s-1", name: "张明", email: "zhangming@edu-os.org" },
    { id: "mock-s-2", name: "李华", email: "lihua@edu-os.org" },
    { id: "mock-s-3", name: "王超", email: "wangchao@edu-os.org" },
    { id: "mock-s-4", name: "赵丽", email: "zhaoli@edu-os.org" },
    { id: "mock-s-5", name: "钱科", email: "qianke@edu-os.org" },
    { id: "mock-s-6", name: "孙雪", email: "sunxue@edu-os.org" }
  ];
  
  const [selectedStudent, setSelectedStudent] = useState<any>(data.selectedStudent || null);
  const [isRolling, setIsRolling] = useState(false);
  const [tempName, setTempName] = useState<string>('');

  const pickStudent = () => {
    if (allStudents.length === 0 || isRolling) return;
    
    setIsRolling(true);
    let counter = 0;
    const totalFlips = 16;
    const intervalTime = 80;

    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * allStudents.length);
      setTempName(allStudents[idx].name);
      counter++;

      if (counter >= totalFlips) {
        clearInterval(interval);
        const finalIdx = Math.floor(Math.random() * allStudents.length);
        const picked = allStudents[finalIdx];
        setSelectedStudent(picked);
        setIsRolling(false);

        // Save selected back to whiteboard
        if (onElementUpdate) {
          onElementUpdate(elementId, {
            ...data,
            selectedStudent: picked,
            pickedTime: new Date().toISOString(),
            status: 'picked'
          });
        }
      }
    }, intervalTime);
  };

  return (
    <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 border border-indigo-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans select-none" style={{ pointerEvents: 'auto' }}>
      <div 
        className="bg-indigo-950/80 text-indigo-200 px-3 py-2 flex justify-between items-center text-xs font-semibold border-b border-indigo-900/50 cursor-move select-none shrink-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="flex items-center gap-1.5 text-indigo-300">
          <Sparkles size={13} className="animate-pulse text-indigo-400" />
          <span>随机点名助手 (Picker Ext)</span>
        </span>
        <button 
          onClick={onDelete} 
          onPointerDown={e => e.stopPropagation()}
          className="p-1 hover:bg-indigo-900/60 rounded text-indigo-400 hover:text-red-450 transition-colors cursor-pointer" 
          title="删除组件"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="flex-1 p-3.5 flex flex-col justify-between min-h-0 text-white gap-2">
        
        {/* Name Selector View */}
        <div className="w-full flex-1 flex flex-col items-center justify-center p-2 rounded-lg bg-indigo-950/50 border border-indigo-900/30">
          {isRolling ? (
            <div className="text-center space-y-2">
              <div className="text-[10px] text-indigo-300 uppercase tracking-widest animate-pulse font-semibold">检索班级学生中...</div>
              <div className="text-2xl font-extrabold text-amber-300 scale-105 tracking-wider font-sans">
                {tempName}
              </div>
            </div>
          ) : selectedStudent ? (
            <div className="text-center space-y-1.5">
              <div className="text-[9px] text-indigo-400 uppercase tracking-widest font-semibold flex items-center justify-center gap-1">
                <UserCheck size={11} className="text-emerald-400 animate-bounce" />
                <span>抽中的幸运学生</span>
              </div>
              <div className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-300 tracking-wider">
                {selectedStudent.name}
              </div>
              <div className="text-[9px] text-indigo-300/70 font-mono overflow-hidden text-ellipsis max-w-full">
                {selectedStudent.email || "No Email Account"}
              </div>
            </div>
          ) : (
            <div className="text-center space-y-1">
              <HelpCircle size={28} className="text-indigo-400/80 mx-auto animate-pulse" />
              <div className="text-xs text-indigo-300 font-semibold">随机抽取摇奖板</div>
              <p className="text-[9px] text-indigo-400/60 leading-tight">将在白板上演示随机滚动，对课堂提问大有裨益</p>
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="w-full shrink-0 flex flex-col items-center gap-1" onPointerDown={e => e.stopPropagation()}>
          <button
            onClick={pickStudent}
            disabled={isRolling}
            className="w-full py-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-750 text-white font-bold text-[11px] uppercase tracking-wider rounded-lg shadow-md active:scale-97 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
          >
            <Shuffle size={12} className={isRolling ? 'animate-spin' : ''} />
            <span>{isRolling ? '滚轮运转中...' : selectedStudent ? '重新随机点名' : '开始随机点名'}</span>
          </button>
          
          <div className="text-[8.5px] text-indigo-400/60 text-center font-mono">
            班级人数：{allStudents.length} 人 • 内核总线热同步
          </div>
        </div>

      </div>
    </div>
  );
}
