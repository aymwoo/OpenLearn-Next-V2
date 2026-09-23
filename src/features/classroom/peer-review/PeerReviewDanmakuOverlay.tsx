import React, { useState, useEffect } from 'react';
import { MessageSquare, Mic, Send } from 'lucide-react';
import type { DanmakuItem } from './types';

export interface PeerReviewDanmakuOverlayProps {
  isVisible: boolean;
  danmakuList: DanmakuItem[];
  onSendDanmaku?: (text: string, type?: 'text' | 'voice') => void;
  isAnonymous?: boolean;
}

export const PeerReviewDanmakuOverlay: React.FC<PeerReviewDanmakuOverlayProps> = ({
  isVisible,
  danmakuList,
  onSendDanmaku,
  isAnonymous = false,
}) => {
  const [inputText, setInputText] = useState('');
  const [showInput, setShowInput] = useState(false);

  if (!isVisible) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendDanmaku?.(inputText.trim(), 'text');
    setInputText('');
  };

  const handleSendVoice = () => {
    onSendDanmaku?.('语音弹幕 · 点赞神仙算法！', 'voice');
  };

  return (
    <div
      id="peer-review-danmaku-overlay"
      className="absolute inset-0 pointer-events-none overflow-hidden z-20"
    >
      {/* Floating Danmaku Items */}
      {danmakuList.map((item) => (
        <div
          key={item.id}
          className="absolute whitespace-nowrap animate-danmaku-slide pointer-events-auto"
          style={{
            top: `${item.topPercent}%`,
            right: '-100%',
          }}
        >
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#131b2e]/85 backdrop-blur-md border border-[#2d3449] shadow-lg text-xs text-[#dae2fd]">
            {item.type === 'voice' ? (
              <span className="flex items-center gap-1 text-[#4edea3] font-mono text-[11px]">
                <Mic size={12} className="animate-pulse" />
                <span>{item.voiceDuration || 3}s</span>
              </span>
            ) : (
              <span className="text-sm">💬</span>
            )}
            <span className="text-[#c0c1ff] font-medium">
              {isAnonymous && item.sender.length > 1 ? `${item.sender[0]}**` : item.sender}:
            </span>
            <span className={item.color || 'text-white'}>{item.text}</span>
          </div>
        </div>
      ))}

      {/* Floating quick input trigger at bottom right */}
      <div className="absolute bottom-4 right-4 pointer-events-auto flex items-center gap-2">
        {showInput ? (
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-1.5 bg-[#131b2e]/95 backdrop-blur-md border border-[#2d3449] p-1.5 rounded-full shadow-xl"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="发送大屏实时弹幕..."
              className="bg-transparent px-3 py-1 text-xs text-white placeholder-[#908fa0] focus:outline-none w-48"
            />
            <button
              type="submit"
              className="p-1.5 rounded-full bg-[#c0c1ff] text-[#1000a9] hover:bg-white transition-colors"
              title="发送"
            >
              <Send size={13} />
            </button>
            <button
              type="button"
              onClick={handleSendVoice}
              className="p-1.5 rounded-full bg-[#171f33] hover:bg-[#222a3d] text-[#4edea3] transition-colors"
              title="发送语音弹幕"
            >
              <Mic size={13} />
            </button>
            <button
              type="button"
              onClick={() => setShowInput(false)}
              className="px-2 text-xs text-[#908fa0] hover:text-white"
            >
              收起
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowInput(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#131b2e]/90 hover:bg-[#222a3d] backdrop-blur-md border border-[#2d3449] text-xs text-[#c7c4d7] hover:text-white shadow-lg transition-colors cursor-pointer"
          >
            <MessageSquare size={13} className="text-[#c0c1ff]" />
            <span>发弹幕</span>
          </button>
        )}
      </div>
    </div>
  );
};
