import React, { useEffect, useMemo, useState } from 'react';
import {
  Monitor,
  Users,
  Wifi,
  WifiOff,
  LayoutGrid,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';

/**
 * ComputerLabSeatingMap —— 机房座位图组件。
 *
 * 读取已有的 computer_labs + student_seats 表数据，展示班级学生在机房的物理座位分布。
 * 在线状态通过 onlineStudentIds（WebSocket）实时显示。
 *
 * 数据来源：
 *  - GET /api/classes/:classId/seats → { lab_id, seats: [{ student_id, row_idx, col_idx }] }
 *  - GET /api/labs → [{ id, room_number, rows, cols }]
 *
 * 插件扩展槽位：
 *  - classroom.seating.toolbar: 工具栏右侧按钮
 *  - classroom.seating.legend: 图例区追加
 *  - classroom.seating.seat_badge: 每个座位内徽章
 *  - classroom.seating.seat_actions: 座位右键菜单项
 *  - classroom.seating.summary: 底部汇总区追加
 */

export interface SeatAssignment {
  student_id: string;
  row_idx: number;
  col_idx: number;
}

export interface ComputerLab {
  id: string;
  room_number: string;
  rows: number;
  cols: number;
}

export interface ComputerLabSeatingMapProps {
  classId: string;
  students: any[];
  onlineStudentIds: string[];
  lang: 'zh' | 'en';
  /** 测试注入点 */
  fetcher?: typeof fetch;
}

interface SeatingData {
  lab: ComputerLab | null;
  seats: SeatAssignment[];
}

export function ComputerLabSeatingMap({
  classId,
  students,
  onlineStudentIds,
  lang,
  fetcher = fetch,
}: ComputerLabSeatingMapProps) {
  const zh = lang === 'zh';
  const [data, setData] = useState<SeatingData>({ lab: null, seats: [] });
  const [labs, setLabs] = useState<ComputerLab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [seatsRes, labsRes] = await Promise.all([
          fetcher(`/api/classes/${classId}/seats`),
          fetcher('/api/labs'),
        ]);
        if (cancelled) return;
        const seatsData = seatsRes.ok ? await seatsRes.json() : { lab_id: null, seats: [] };
        const labsData = labsRes.ok ? await labsRes.json() : [];
        const lab = labsData.find((l: ComputerLab) => l.id === seatsData.lab_id) || null;
        setData({ lab, seats: seatsData.seats || [] });
        setLabs(labsData);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId, fetcher]);

  const studentMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of students) {
      map.set(s.id, s);
    }
    return map;
  }, [students]);

  const seatGrid = useMemo(() => {
    if (!data.lab) return null;
    const { rows, cols } = data.lab;
    const grid: (SeatAssignment | null)[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => null),
    );
    for (const seat of data.seats) {
      if (seat.row_idx >= 0 && seat.row_idx < rows && seat.col_idx >= 0 && seat.col_idx < cols) {
        grid[seat.row_idx][seat.col_idx] = seat;
      }
    }
    return grid;
  }, [data]);

  const stats = useMemo(() => {
    const totalSeats = data.lab ? data.lab.rows * data.lab.cols : 0;
    const assignedCount = data.seats.length;
    const onlineCount = data.seats.filter((s) => onlineStudentIds.includes(s.student_id)).length;
    const emptySeats = totalSeats - assignedCount;
    return { totalSeats, assignedCount, onlineCount, emptySeats };
  }, [data, onlineStudentIds]);

  if (loading) {
    return (
      <div className="bg-surface border border-theme rounded-2xl p-5 shadow-sm flex items-center justify-center gap-2">
        <RefreshCw size={14} className="animate-spin text-primary-theme" />
        <span className="text-xs text-muted">{zh ? '加载座位图...' : 'Loading seating map...'}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-rose-200 dark:border-rose-800 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
          <AlertCircle size={14} />
          <span className="text-xs font-semibold">{zh ? '加载失败' : 'Load failed'}: {error}</span>
        </div>
      </div>
    );
  }

  if (!data.lab) {
    return (
      <div className="bg-surface border border-theme rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <LayoutGrid size={16} className="text-primary-theme" />
          <h3 className="text-sm font-black text-main">
            {zh ? '机房座位图' : 'Computer Lab Seating Map'}
          </h3>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <HelpCircle size={32} className="text-muted mb-3" />
          <p className="text-xs text-muted font-medium">
            {zh
              ? '该班级尚未分配机房'
              : 'No computer lab assigned to this class'}
          </p>
          <p className="text-2xs text-subtle mt-1">
            {zh
              ? '请在「班级管理」→「座位安排」中为该班级分配机房并设置座位'
              : 'Go to Classes → Seating to assign a lab and configure seats'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-theme rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LayoutGrid size={16} className="text-primary-theme" />
          <h3 className="text-sm font-black text-main">
            {zh ? '机房座位图' : 'Computer Lab Seating Map'}
          </h3>
          <span className="text-2xs font-semibold text-muted px-2 py-0.5 rounded-lg bg-surface-secondary border border-theme">
            {data.lab.room_number}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Plugin toolbar extension */}
          <ExtensionPointRenderer
            slot="classroom.seating.toolbar"
            lang={lang}
            slotProps={{ classId, lab: data.lab, stats }}
          />
        </div>
      </div>

      {/* Seating Grid */}
      <div className="flex flex-col gap-3">
        {/* Teacher desk indicator */}
        <div className="flex justify-center">
          <div className="bg-surface-secondary border border-theme rounded-xl px-6 py-2 flex items-center gap-2">
            <Monitor size={14} className="text-primary-theme" />
            <span className="text-2xs font-bold text-main">
              {zh ? '教师机' : 'Teacher Station'}
            </span>
          </div>
        </div>

        {/* Grid */}
        {seatGrid && (
          <div className="bg-surface-secondary border border-theme rounded-xl p-4">
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${data.lab.cols}, minmax(0, 1fr))`,
              }}
            >
              {seatGrid.flatMap((row, rowIdx) =>
                row.map((seat, colIdx) => {
                  const student = seat ? studentMap.get(seat.student_id) : null;
                  const isOnline = seat ? onlineStudentIds.includes(seat.student_id) : false;
                  const seatLabel = String.fromCharCode(65 + rowIdx) + String(colIdx + 1).padStart(2, '0');

                  return (
                    <SeatCell
                      key={`${rowIdx}-${colIdx}`}
                      seatLabel={seatLabel}
                      student={student}
                      isOnline={isOnline}
                      hasSeat={!!seat}
                      lang={lang}
                      classId={classId}
                      seat={seat}
                    />
                  );
                }),
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-2xs">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-300 dark:bg-emerald-900/50 dark:border-emerald-700" />
          <span className="text-muted font-medium">
            {zh ? `在线 (${stats.onlineCount})` : `Online (${stats.onlineCount})`}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-slate-100 border border-slate-300 dark:bg-slate-800 dark:border-slate-600" />
          <span className="text-muted font-medium">
            {zh ? `离线 (${stats.assignedCount - stats.onlineCount})` : `Offline (${stats.assignedCount - stats.onlineCount})`}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-surface border border-dashed border-theme" />
          <span className="text-muted font-medium">
            {zh ? `空位 (${stats.emptySeats})` : `Empty (${stats.emptySeats})`}
          </span>
        </span>
        {/* Plugin legend extension */}
        <ExtensionPointRenderer
          slot="classroom.seating.legend"
          lang={lang}
          slotProps={{ classId, stats }}
        />
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          icon={Users}
          label={zh ? '已分配座位' : 'Assigned Seats'}
          value={stats.assignedCount}
          total={stats.totalSeats}
          lang={lang}
        />
        <SummaryCard
          icon={Wifi}
          label={zh ? '当前在线' : 'Currently Online'}
          value={stats.onlineCount}
          total={stats.assignedCount}
          lang={lang}
          tone="emerald"
        />
        <SummaryCard
          icon={WifiOff}
          label={zh ? '在线率' : 'Online Rate'}
          value={stats.assignedCount > 0 ? Math.round((stats.onlineCount / stats.assignedCount) * 100) : 0}
          suffix="%"
          lang={lang}
          tone={stats.onlineCount === stats.assignedCount ? 'emerald' : 'amber'}
        />
      </div>

      {/* Plugin summary extension */}
      <ExtensionPointRenderer
        slot="classroom.seating.summary"
        lang={lang}
        slotProps={{ classId, stats, onlineStudentIds }}
      />
    </div>
  );
}

function SeatCell({
  seatLabel,
  student,
  isOnline,
  hasSeat,
  lang,
  classId,
  seat,
}: {
  seatLabel: string;
  student: any | null;
  isOnline: boolean;
  hasSeat: boolean;
  lang: 'zh' | 'en';
  classId: string;
  seat: SeatAssignment | null;
}) {
  const zh = lang === 'zh';

  const bgColor = !hasSeat
    ? 'bg-surface border-dashed border-theme-subtle'
    : isOnline
      ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/70'
      : 'bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-700';

  const statusDot = !hasSeat
    ? null
    : isOnline
      ? 'bg-emerald-500'
      : 'bg-slate-400 dark:bg-slate-500';

  return (
    <div
      className={`relative rounded-lg border p-1.5 flex flex-col items-center gap-0.5 min-h-[56px] transition-colors ${bgColor}`}
      title={
        !hasSeat
          ? zh ? '空座位' : 'Empty seat'
          : `${student?.name ?? '?'}${isOnline ? (zh ? ' (在线)' : ' (online)') : (zh ? ' (离线)' : ' (offline)')}`
      }
    >
      {/* Seat label */}
      <span className="text-2xs font-mono font-bold text-muted leading-none">{seatLabel}</span>

      {/* Student info or empty */}
      {student ? (
        <>
          <span className="text-2xs text-main truncate w-full text-center leading-tight font-medium">
            {(student.name ?? '').slice(0, 3)}
          </span>
          {/* Status dot */}
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          {/* Plugin seat badge extension */}
          <ExtensionPointRenderer
            slot="classroom.seating.seat_badge"
            lang={lang}
            slotProps={{ seat, student, isOnline, classId }}
          />
        </>
      ) : hasSeat ? (
        <span className="text-2xs text-subtle italic">
          {zh ? '未分配' : 'Unassigned'}
        </span>
      ) : (
        <span className="text-2xs text-subtle/50">—</span>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  total,
  suffix,
  lang,
  tone = 'default',
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  total?: number;
  suffix?: string;
  lang: 'zh' | 'en';
  tone?: 'default' | 'emerald' | 'amber';
}) {
  const toneClasses = {
    default: 'text-main',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
  };

  return (
    <div className="bg-surface-secondary border border-theme rounded-xl p-3 flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-surface border border-theme flex items-center justify-center shrink-0">
        <Icon size={14} className="text-primary-theme" />
      </div>
      <div className="min-w-0">
        <div className="text-2xs text-muted truncate">{label}</div>
        <div className={`text-sm font-black font-mono leading-none mt-0.5 ${toneClasses[tone]}`}>
          {value}
          {total !== undefined && <span className="text-2xs text-muted font-normal">/{total}</span>}
          {suffix && <span className="text-2xs text-muted font-normal">{suffix}</span>}
        </div>
      </div>
    </div>
  );
}
