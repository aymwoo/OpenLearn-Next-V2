import React, { useEffect, useState } from 'react';
import { Timer, AlertTriangle } from 'lucide-react';

interface CountdownTimerProps {
  assignmentId: string;
  timeLimitMinutes: number;
  onTimeUp: () => void;
  isSubmitted: boolean;
}

export function CountdownTimer({ assignmentId, timeLimitMinutes, onTimeUp, isSubmitted }: CountdownTimerProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (isSubmitted || !timeLimitMinutes || timeLimitMinutes <= 0) {
      setSecondsRemaining(null);
      return;
    }

    const timerKey = `quiz_timer_start_${assignmentId}`;
    let startTimestampStr = sessionStorage.getItem(timerKey);
    let startTimestamp = startTimestampStr ? parseInt(startTimestampStr, 10) : null;

    if (!startTimestamp) {
      startTimestamp = Date.now();
      sessionStorage.setItem(timerKey, startTimestamp.toString());
    }

    const totalSeconds = timeLimitMinutes * 60;

    const updateTimer = () => {
      const elapsedSeconds = Math.floor((Date.now() - (startTimestamp as number)) / 1000);
      const remaining = totalSeconds - elapsedSeconds;

      if (remaining <= 0) {
        setSecondsRemaining(0);
        onTimeUp();
      } else {
        setSecondsRemaining(remaining);
      }
    };

    updateTimer(); // run once immediately
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [assignmentId, timeLimitMinutes, isSubmitted, onTimeUp]);

  if (!timeLimitMinutes || timeLimitMinutes <= 0) {
    return null;
  }

  if (isSubmitted) {
    return (
      <div className="flex items-center gap-2 font-sans text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200">
        <Timer size={14} />
        <span>Time Limit: {timeLimitMinutes} mins (Completed)</span>
      </div>
    );
  }

  if (secondsRemaining === null) {
    return null;
  }

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const isLow = secondsRemaining < 60; // Less than 1 minute remaining

  return (
    <div className={`flex items-center gap-3 font-sans px-4 py-2.5 rounded-xl border transition-all ${
      isLow 
        ? 'bg-red-50 text-red-700 border-red-200 animate-pulse font-bold' 
        : secondsRemaining < 180 
          ? 'bg-amber-50 text-amber-700 border-amber-200 font-semibold' 
          : 'bg-indigo-50 text-indigo-700 border-indigo-100'
    }`}>
      <Timer size={16} className={isLow ? 'text-red-600 animate-pulse' : 'text-indigo-600'} />
      <div className="flex-1 flex justify-between items-center text-xs gap-4">
        <div>
          <span className="font-medium">Time Remaining:</span>
          <span className="font-mono ml-1 text-sm bg-black/5 text-slate-800 px-1.5 py-0.5 rounded font-bold">
            {mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}
          </span>
        </div>
        {isLow && (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-red-600 font-bold animate-pulse">
            <AlertTriangle size={12} /> Time is almost up!
          </span>
        )}
      </div>
    </div>
  );
}
