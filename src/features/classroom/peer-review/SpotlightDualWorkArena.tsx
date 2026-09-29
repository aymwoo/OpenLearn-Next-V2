import React, { useState } from 'react';
import {
  GitCompare,
  Star,
  Maximize2,
  Share2,
  Edit3,
  CheckCircle2,
  Code,
  Flame,
  TrendingUp,
  Sparkles,
  FileQuestion,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import type { SpotlightWorkItem, TeacherPeerAnnotation } from './types';

export interface SpotlightDualWorkArenaProps {
  workA: SpotlightWorkItem;
  workB: SpotlightWorkItem;
  annotations: TeacherPeerAnnotation[];
  isAnonymous?: boolean;
  onFullscreenCanvas?: () => void;
  onSyncSandboxToClass?: () => void;
  onAddAnnotation?: (content: string) => void;
}

export const SpotlightDualWorkArena: React.FC<SpotlightDualWorkArenaProps> = ({
  workA,
  workB,
  annotations,
  isAnonymous = false,
  onFullscreenCanvas,
  onSyncSandboxToClass,
  onAddAnnotation,
}) => {
  const [activeTab, setActiveTab] = useState<'visual' | 'code'>('visual');
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNote, setNewNote] = useState('');

  const maskName = (name: string, isAnon: boolean) => {
    if (!isAnon) return name;
    if (name.length <= 1) return name;
    return `${name[0]}**`;
  };

  const handleNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    onAddAnnotation?.(newNote.trim());
    setNewNote('');
    setShowAddNote(false);
  };

  return (
    <div id="spotlight-dual-work-arena" className="flex flex-col gap-4 w-full select-none">
      {/* 1. Main Showcase Header */}
      <div className="bg-[#131b2e] p-4 rounded-xl border border-[#2d3449]/60 flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#8083ff]/20 flex items-center justify-center text-[#c0c1ff] border border-[#8083ff]/30">
            <GitCompare size={20} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-[#dae2fd]">大屏焦点作品对比赏析</h1>
              <span className="px-2 py-0.5 rounded bg-[#ca8100]/20 text-[#ffb95f] font-mono text-[10px] font-semibold flex items-center gap-1 border border-[#ca8100]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ffb95f] animate-ping" />
                教师激光笔协同标记中
              </span>
            </div>
            <span className="text-xs text-[#c7c4d7] mt-0.5">
              标杆创新解法 ({maskName(workA.studentName, isAnonymous)}) ⟷ 经典逆风翻盘解法 (
              {maskName(workB.studentName, isAnonymous)})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onSyncSandboxToClass && (
            <button
              type="button"
              onClick={onSyncSandboxToClass}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#171f33] hover:bg-[#222a3d] text-[#c7c4d7] hover:text-white border border-[#2d3449]/60 transition-colors text-xs font-medium"
              title="将对比沙箱推送到全班学生机"
            >
              <Share2 size={14} className="text-[#4edea3]" />
              <span>同步沙箱至全班</span>
            </button>
          )}

          {onFullscreenCanvas && (
            <button
              type="button"
              onClick={onFullscreenCanvas}
              className="p-2 rounded-lg bg-[#171f33] hover:bg-[#222a3d] text-[#c7c4d7] hover:text-white border border-[#2d3449]/60 transition-colors"
              title="全屏沉浸投影"
            >
              <Maximize2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Dual Work Sandbox Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SUB-CARD A：作品 A（学生名/标题来自真实 workA 入参） */}
        <div className="bg-[#131b2e] rounded-xl p-4 flex flex-col gap-3 border border-[#2d3449]/60 shadow-md relative">
          {/* Card Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#8083ff] text-white flex items-center justify-center font-bold text-xs shadow-sm">
                {isAnonymous ? 'A' : workA.studentInitial}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-[#dae2fd]">
                  {maskName(workA.studentName, isAnonymous)} (作品 A)
                </span>
                <span className="text-[11px] font-mono text-[#908fa0]">{workA.workSubtitle}</span>
              </div>
            </div>

            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#ca8100]/20 text-[#ffb95f] border border-[#ca8100]/30">
              <Star size={13} className="text-[#ffb95f] fill-[#ffb95f]" />
              <span className="font-mono text-xs font-semibold">
                {typeof workA.rating === 'number' ? workA.rating.toFixed(1) : '—'}
              </span>
              <span className="text-[10px] text-[#908fa0]">({workA.reviewCount ?? 0}评)</span>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5">
            {workA.badges.map((b, idx) => (
              <span key={idx} className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${b.colorClass}`}>
                {b.label}
              </span>
            ))}
          </div>

          {/*
            作品预览：渲染**学生真实作答内容**（由 usePeerReviewData 从 submission_raw 提取）。
            此前这里是一段写死的五边形 SVG —— 与任何真实作品无关，投到大屏上会让学生
            以为那就是该同学的作品。无真实内容时明确说明，不画假图形。
          */}
          <div
            data-testid={`work-preview-${workA.slot}`}
            className="w-full h-44 rounded-lg bg-[#060e20] flex flex-col justify-center relative overflow-hidden border border-[#2d3449]/60"
          >
            {workA.codeLines && workA.codeLines.length > 0 ? (
              <pre className="px-4 py-3 font-mono text-[11px] leading-5 text-[#dae2fd] overflow-y-auto max-h-full whitespace-pre-wrap break-words">
                {workA.codeLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={line.isHighlight ? 'text-[#4edea3]' : ''}
                    style={{ paddingLeft: `${(line.indent || 0) * 12}px` }}
                  >
                    {line.text}
                  </div>
                ))}
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-6 text-center">
                <FileQuestion size={28} className="text-[#4a5570]" />
                <span className="text-[11px] text-[#908fa0] leading-relaxed">
                  该作品没有可展示的作答内容
                  <br />
                  <span className="text-[10px] opacity-70">（原始作答流水为空或为纯数值型）</span>
                </span>
              </div>
            )}
            {workA.workContent && (
              <span className="absolute bottom-2 right-2 text-[10px] font-mono text-[#908fa0] bg-[#131b2e]/90 px-1.5 py-0.5 rounded border border-[#2d3449]/50">
                真实作答 · {workA.workContent.eventCount} 条事件
              </span>
            )}
          </div>

          {/*
            原本此处还有一个独立的「Code Snippet」区块，与上方预览区渲染同一份
            codeLines（内容重复两遍）。预览区已承担展示职责，这里改为只补充
            逐行 comment（预览区不渲染 comment，避免噪音）。
          */}
          {workA.codeLines?.some((l) => l.comment) ? (
            <div className="bg-[#060e20] rounded-lg p-3 font-mono text-[11px] leading-5 border border-[#2d3449]/60 overflow-x-auto text-[#dae2fd]">
              <div className="text-[#908fa0] mb-1"># {workA.codeTitle ?? ''}</div>
              {workA.codeLines
                .filter((l) => l.comment)
                .map((line, idx) => (
                  <div key={idx} className={line.isHighlight ? 'bg-[#8083ff]/20 px-1 rounded -mx-1' : ''}>
                    <span className="text-[#908fa0]">{line.comment}</span>
                  </div>
                ))}
            </div>
          ) : null}
        </div>

        {/* SUB-CARD B：作品 B（学生名/标题来自真实 workB 入参） */}
        <div className="bg-[#131b2e] rounded-xl p-4 flex flex-col gap-3 border border-[#2d3449]/60 shadow-md relative">
          {/* Card Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#00a572] text-white flex items-center justify-center font-bold text-xs shadow-sm">
                {isAnonymous ? 'B' : workB.studentInitial}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-[#dae2fd]">
                  {maskName(workB.studentName, isAnonymous)} (作品 B)
                </span>
                <span className="text-[11px] font-mono text-[#908fa0]">{workB.workSubtitle}</span>
              </div>
            </div>

            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#ca8100]/20 text-[#ffb95f] border border-[#ca8100]/30">
              <Star size={13} className="text-[#ffb95f] fill-[#ffb95f]" />
              <span className="font-mono text-xs font-semibold">
                {typeof workB.rating === 'number' ? workB.rating.toFixed(1) : '—'}
              </span>
              <span className="text-[10px] text-[#908fa0]">({workB.reviewCount ?? 0}评)</span>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5">
            {workB.badges.map((b, idx) => (
              <span key={idx} className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${b.colorClass}`}>
                {b.label}
              </span>
            ))}
          </div>

          {/*
            与作品 A 同理：渲染学生真实作答内容，不再用写死的旋转矩形示意。
          */}
          <div
            data-testid={`work-preview-${workB.slot}`}
            className="w-full h-44 rounded-lg bg-[#060e20] flex flex-col justify-center relative overflow-hidden border border-[#2d3449]/60"
          >
            {workB.codeLines && workB.codeLines.length > 0 ? (
              <pre className="px-4 py-3 font-mono text-[11px] leading-5 text-[#dae2fd] overflow-y-auto max-h-full whitespace-pre-wrap break-words">
                {workB.codeLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={line.isHighlight ? 'text-[#4edea3]' : ''}
                    style={{ paddingLeft: `${(line.indent || 0) * 12}px` }}
                  >
                    {line.text}
                  </div>
                ))}
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-6 text-center">
                <FileQuestion size={28} className="text-[#4a5570]" />
                <span className="text-[11px] text-[#908fa0] leading-relaxed">
                  该作品没有可展示的作答内容
                  <br />
                  <span className="text-[10px] opacity-70">（原始作答流水为空或为纯数值型）</span>
                </span>
              </div>
            )}
            {workB.workContent && (
              <span className="absolute bottom-2 right-2 text-[10px] font-mono text-[#908fa0] bg-[#131b2e]/90 px-1.5 py-0.5 rounded border border-[#2d3449]/50">
                真实作答 · {workB.workContent.eventCount} 条事件
              </span>
            )}
          </div>

          {/* Code Snippet with Success Fix Highlight */}
          {workB.codeLines?.some((l) => l.comment) ? (
            <div className="bg-[#060e20] rounded-lg p-3 font-mono text-[11px] leading-5 border border-[#2d3449]/60 overflow-x-auto text-[#dae2fd]">
              <div className="text-[#908fa0] mb-1"># {workB.codeTitle ?? ''}</div>
              {workB.codeLines
                .filter((l) => l.comment)
                .map((line, idx) => (
                  <div key={idx} className={line.isSuccess ? 'bg-[#00a572]/20 px-1 rounded -mx-1' : ''}>
                    <span className="text-[#4edea3] text-[10px]">{line.comment}</span>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* 3. Floating Teacher / Student Annotation Layer */}
      <div className="bg-[#131b2e] rounded-xl p-4 flex flex-col gap-3 border border-[#2d3449]/60 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 size={16} className="text-[#ffb95f]" />
            <span className="text-xs font-semibold text-[#dae2fd]">协同板书标注与点评审阅</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[#908fa0]">{annotations.length} 条实时批注挂载</span>
            {onAddAnnotation && (
              <button
                type="button"
                onClick={() => setShowAddNote(!showAddNote)}
                className="text-[11px] text-[#c0c1ff] hover:text-white font-medium transition-colors"
              >
                {showAddNote ? '取消批注' : '+ 追加教师批注'}
              </button>
            )}
          </div>
        </div>

        {/* Add note input form */}
        {showAddNote && (
          <form onSubmit={handleNoteSubmit} className="flex gap-2">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="输入大屏协同批注要点..."
              className="flex-1 px-3 py-1.5 rounded-lg bg-[#060e20] border border-[#2d3449] text-xs text-[#dae2fd] placeholder-[#908fa0] focus:outline-none focus:border-[#8083ff]"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-[#c0c1ff] text-[#1000a9] font-semibold text-xs hover:bg-[#8083ff] hover:text-white transition-colors"
            >
              发送批注
            </button>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {annotations.map((ann) => (
            <div
              key={ann.id}
              className="bg-[#171f33] p-3 rounded-lg flex flex-col gap-1.5 relative overflow-hidden border border-[#2d3449]/50"
            >
              <div className="w-1 absolute left-0 top-0 bottom-0" style={{ backgroundColor: ann.borderColor }} />
              <div className="flex items-center justify-between pl-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                      ann.authorType === 'teacher' ? 'bg-[#8083ff] text-white' : 'bg-[#00a572] text-white'
                    }`}
                  >
                    {ann.authorRole}
                  </span>
                  <span className="text-xs font-semibold text-[#dae2fd]">{maskName(ann.authorName, isAnonymous)}</span>
                </div>
                <span className="text-[10px] font-mono text-[#908fa0]">{ann.timeAgo}</span>
              </div>
              <p className="text-xs text-[#dae2fd] pl-2 leading-relaxed">{ann.content}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Third-Party Custom Showcase Widget Extension Slot */}
      <ExtensionPointRenderer slot="peer_review.showcase.widget" />
    </div>
  );
};
