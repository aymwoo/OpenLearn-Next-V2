import { Lock } from 'lucide-react';
import type { SegmentAccessState } from './useSegmentAccess';

export function SegmentGateBanner({ access, lang }: { access: SegmentAccessState; lang: 'zh' | 'en' }) {
  if (!access.segmentId) return null;
  if (access.status === 'loading' || access.status === 'idle') {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" role="status">
        {lang === 'zh' ? '正在核对进入条件' : 'Checking entry conditions'}
      </div>
    );
  }
  if (access.status !== 'locked') return null;
  const failed = access.gates.filter((gate) => !gate.allowed);
  return (
    <div
      data-testid="segment-gate-lock"
      role="status"
      className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900"
    >
      <div className="flex items-start gap-2">
        <Lock size={14} className="mt-0.5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{lang === 'zh' ? '本环节尚未解锁' : 'This segment is locked'}</p>
          <p className="mt-0.5 leading-snug">
            {access.reason || (lang === 'zh' ? '未满足进入条件' : 'Conditions not met')}
          </p>
          {failed.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {failed.map((gate) => (
                <li key={`${gate.type}-${gate.reason || ''}`}>
                  {gate.reason || gate.type}
                  {gate.progress
                    ? `（${gate.progress.current}/${gate.progress.target}${gate.progress.unit || ''}）`
                    : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
