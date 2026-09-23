import React from 'react';
import { X, FileCheck2, CheckCircle2, Award, Sparkles } from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

export interface PeerReviewRubricModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PeerReviewRubricModal: React.FC<PeerReviewRubricModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div
      id="peer-review-rubric-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
    >
      <div className="bg-[#131b2e] border border-[#2d3449] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#171f33] border-b border-[#2d3449] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#ca8100]/20 text-[#ffb95f] flex items-center justify-center border border-[#ca8100]/30">
              <FileCheck2 size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#dae2fd]">随堂交叉互评量规细则</h2>
              <p className="text-[11px] text-[#908fa0]">三维评价基准 · 激励互助逆向思考</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#908fa0] hover:text-white hover:bg-[#222a3d] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto">
          {/* Dimension 1 */}
          <div className="bg-[#171f33] rounded-xl p-4 border border-[#2d3449]/60 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-[#8083ff]/20 text-[#c0c1ff] font-mono text-xs font-bold flex items-center justify-center">
                  1
                </span>
                <span className="text-sm font-semibold text-[#dae2fd]">算法逻辑正确性 (40% 权重)</span>
              </div>
              <span className="text-[10px] font-mono text-[#4edea3] bg-[#00a572]/20 px-2 py-0.5 rounded">
                全班达标率 98%
              </span>
            </div>
            <ul className="text-xs text-[#c7c4d7] space-y-1.5 pl-8 list-disc">
              <li><strong className="text-white">5.0分（优秀）：</strong>算法逻辑自适应，无死循环或边界越界，自适应笔触与角度动态计算完全闭合。</li>
              <li><strong className="text-white">4.0分（良好）：</strong>核心功能正常，少数极端情况存在未自增或微小卡顿。</li>
              <li><strong className="text-white">3.0分（需改进）：</strong>存在语法报错或死循环，需在互评中指明行号与修复要点。</li>
            </ul>
          </div>

          {/* Dimension 2 */}
          <div className="bg-[#171f33] rounded-xl p-4 border border-[#2d3449]/60 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-[#00a572]/20 text-[#4edea3] font-mono text-xs font-bold flex items-center justify-center">
                  2
                </span>
                <span className="text-sm font-semibold text-[#dae2fd]">代码规范与缩进 (30% 权重)</span>
              </div>
              <span className="text-[10px] font-mono text-[#4edea3] bg-[#00a572]/20 px-2 py-0.5 rounded">
                全班达标率 96%
              </span>
            </div>
            <ul className="text-xs text-[#c7c4d7] space-y-1.5 pl-8 list-disc">
              <li><strong className="text-white">5.0分（优秀）：</strong>遵循 PEP8 规范，严格对齐 4 空格缩进，变量语义化规范清晰，关键算子附有说明注释。</li>
              <li><strong className="text-white">4.0分（良好）：</strong>缩进基本统一，可读性良好。</li>
              <li><strong className="text-white">3.0分（需改进）：</strong>Tab 与空格混用，循环体代码未有效缩进。</li>
            </ul>
          </div>

          {/* Dimension 3 */}
          <div className="bg-[#171f33] rounded-xl p-4 border border-[#2d3449]/60 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-[#ca8100]/20 text-[#ffb95f] font-mono text-xs font-bold flex items-center justify-center">
                  3
                </span>
                <span className="text-sm font-semibold text-[#dae2fd]">创意美感与拓展 (30% 权重)</span>
              </div>
              <span className="text-[10px] font-mono text-[#ffb95f] bg-[#ca8100]/20 px-2 py-0.5 rounded">
                全班达标率 92%
              </span>
            </div>
            <ul className="text-xs text-[#c7c4d7] space-y-1.5 pl-8 list-disc">
              <li><strong className="text-white">5.0分（优秀）：</strong>巧妙运用数学模运算（`i % 3`）或外角定理，呈现层次丰富的动态发散图形。</li>
              <li><strong className="text-white">4.0分（良好）：</strong>图形规则美观，配色和谐。</li>
              <li><strong className="text-white">3.0分（需改进）：</strong>单色基础图形，未探索步长或角度变化。</li>
            </ul>
          </div>

          {/* Third-Party Custom Dimension Slot */}
          <ExtensionPointRenderer slot="peer_review.rubric.dimension" />
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-[#171f33] border-t border-[#2d3449] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#c0c1ff] text-[#1000a9] font-semibold text-xs hover:bg-white transition-colors"
          >
            我已知晓
          </button>
        </div>
      </div>
    </div>
  );
};
