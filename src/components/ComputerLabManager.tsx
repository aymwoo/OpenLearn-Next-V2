import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LayoutTemplate,
  Plus,
  Trash2,
  Edit2,
  Monitor,
  HelpCircle,
  Info,
  Check,
  X,
  Users,
  Sparkles,
  RotateCcw,
  Save,
  UserCheck,
  UserX,
  AlertCircle,
  Loader2,
  Layers,
  ArrowRightLeft,
} from 'lucide-react';

export interface ComputerLab {
  id: string;
  room_number: string;
  rows: number;
  cols: number;
  created_at: number;
}

export interface ClassItem {
  id: string;
  name: string;
  lab_id?: string | null;
  [key: string]: any;
}

export interface StudentItem {
  id: string;
  name: string;
  student_number?: string;
  [key: string]: any;
}

export interface AssignedSeat {
  student_id: string;
  row_idx: number;
  col_idx: number;
  student_name?: string;
  student_number?: string;
}

export interface ComputerLabManagerProps {
  computerLabs: ComputerLab[];
  onRefresh: () => void | Promise<void>;
  lang: 'zh' | 'en';
  classes?: ClassItem[];
}

export function ComputerLabManager({ computerLabs, onRefresh, lang, classes: propsClasses }: ComputerLabManagerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingLabId, setEditingLabId] = useState<string | null>(null);

  // Form states for creating/editing physical lab
  const [roomNumber, setRoomNumber] = useState('');
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(6);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Selected lab for preview / seating
  const [selectedLabId, setSelectedLabId] = useState<string | null>(
    computerLabs.length > 0 ? computerLabs[0].id : null,
  );

  const activePreviewLab = computerLabs.find((lab) => lab.id === (selectedLabId || computerLabs[0]?.id));

  // --- Classes & Seating state ---
  const [internalClasses, setInternalClasses] = useState<ClassItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(() => {
    const activeLab = computerLabs[0];
    if (!activeLab) return null;
    const bound = (propsClasses || []).find((c) => c.lab_id === activeLab.id);
    return bound ? bound.id : null;
  });
  const [classStudents, setClassStudents] = useState<StudentItem[]>([]);
  const [assignedSeats, setAssignedSeats] = useState<AssignedSeat[]>([]);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [savingSeats, setSavingSeats] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [selectedStudentToPlace, setSelectedStudentToPlace] = useState<StudentItem | null>(null);

  // Load classes if not passed via props
  useEffect(() => {
    if (propsClasses && propsClasses.length > 0) {
      setInternalClasses(propsClasses);
    } else {
      fetch('/api/classes')
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          if (Array.isArray(data)) setInternalClasses(data);
        })
        .catch((err) => console.error('Failed to fetch classes in ComputerLabManager:', err));
    }
  }, [propsClasses]);

  const classes = propsClasses && propsClasses.length > 0 ? propsClasses : internalClasses;

  // Classes associated with active lab
  const boundClasses = useMemo(() => {
    if (!activePreviewLab) return [];
    return classes.filter((c) => c.lab_id === activePreviewLab.id);
  }, [classes, activePreviewLab]);

  // When active lab changes, check if current class still applies or auto-select bound class
  useEffect(() => {
    if (!activePreviewLab) return;
    if (selectedClassId) {
      const cls = classes.find((c) => c.id === selectedClassId);
      // Keep selected class if user picked one
      return;
    }
    // Auto-select bound class if there's any bound class and none selected
    const bound = classes.find((c) => c.lab_id === activePreviewLab.id);
    if (bound) {
      setSelectedClassId(bound.id);
    }
  }, [activePreviewLab?.id, classes]);

  // Fetch seats and students when selectedClassId or activePreviewLab changes
  const loadClassSeatsAndStudents = useCallback(async (classId: string, labId?: string) => {
    setLoadingSeats(true);
    setError('');
    setSelectedStudentToPlace(null);
    try {
      const [seatsRes, studentsRes] = await Promise.all([
        fetch(`/api/classes/${classId}/seats`),
        fetch(`/api/classes/${classId}/students`),
      ]);

      let studentsList: StudentItem[] = [];
      if (studentsRes.ok) {
        studentsList = await studentsRes.json();
        setClassStudents(studentsList);
      }

      if (seatsRes.ok) {
        const seatsData = await seatsRes.json();
        const rawSeats: AssignedSeat[] = seatsData.seats || [];
        // Map with student names and numbers if missing
        const studentMap = new Map(studentsList.map((s) => [s.id, s]));
        const enrichedSeats = rawSeats.map((s) => {
          const st = studentMap.get(s.student_id);
          return {
            ...s,
            student_name: s.student_name || st?.name || '',
            student_number: s.student_number || st?.student_number || '',
          };
        });
        setAssignedSeats(enrichedSeats);
      }
      setIsDirty(false);
    } catch (err: any) {
      console.error('Error loading seating:', err);
      setError(err.message || 'Failed to load class seating data');
    } finally {
      setLoadingSeats(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClassId) {
      loadClassSeatsAndStudents(selectedClassId, activePreviewLab?.id);
    } else {
      setClassStudents([]);
      setAssignedSeats([]);
      setIsDirty(false);
      setSelectedStudentToPlace(null);
    }
  }, [selectedClassId, loadClassSeatsAndStudents]);

  // Derived seating lookups
  const seatMap = useMemo(() => {
    const map = new Map<string, AssignedSeat>();
    for (const seat of assignedSeats) {
      map.set(`${seat.row_idx}_${seat.col_idx}`, seat);
    }
    return map;
  }, [assignedSeats]);

  const assignedStudentIds = useMemo(() => {
    return new Set(assignedSeats.map((s) => s.student_id));
  }, [assignedSeats]);

  const unassignedStudents = useMemo(() => {
    return classStudents
      .filter((s) => !assignedStudentIds.has(s.id))
      .sort((a, b) =>
        String(a.student_number ?? a.name ?? '').localeCompare(
          String(b.student_number ?? b.name ?? ''),
          'zh-Hans-CN',
          { numeric: true },
        ),
      );
  }, [classStudents, assignedStudentIds]);

  // Interactive seat handlers
  const handleSeatClick = (rIdx: number, cIdx: number) => {
    if (!selectedClassId || !activePreviewLab) return;

    const existing = seatMap.get(`${rIdx}_${cIdx}`);

    if (selectedStudentToPlace) {
      // Place student at this seat
      const newSeat: AssignedSeat = {
        student_id: selectedStudentToPlace.id,
        row_idx: rIdx,
        col_idx: cIdx,
        student_name: selectedStudentToPlace.name,
        student_number: selectedStudentToPlace.student_number,
      };

      setAssignedSeats((prev) => {
        // Remove this student from wherever they were, and remove old occupant of this seat
        const filtered = prev.filter(
          (s) => s.student_id !== selectedStudentToPlace.id && !(s.row_idx === rIdx && s.col_idx === cIdx),
        );
        return [...filtered, newSeat];
      });

      setSelectedStudentToPlace(null);
      setIsDirty(true);
      return;
    }

    if (existing) {
      // Pick up existing student to move/swap
      const st = classStudents.find((s) => s.id === existing.student_id) || {
        id: existing.student_id,
        name: existing.student_name || 'Student',
        student_number: existing.student_number || '',
      };
      setSelectedStudentToPlace(st);
    }
  };

  const handleRemoveSeat = (e: React.MouseEvent, rIdx: number, cIdx: number) => {
    e.stopPropagation();
    setAssignedSeats((prev) => prev.filter((s) => !(s.row_idx === rIdx && s.col_idx === cIdx)));
    setIsDirty(true);
  };

  const handleAutoAssign = () => {
    if (!activePreviewLab || unassignedStudents.length === 0) return;

    // Collect all empty coordinates in row-major order
    const emptyCoords: [number, number][] = [];
    for (let r = 0; r < activePreviewLab.rows; r++) {
      for (let c = 0; c < activePreviewLab.cols; c++) {
        if (!seatMap.has(`${r}_${c}`)) {
          emptyCoords.push([r, c]);
        }
      }
    }

    if (emptyCoords.length === 0) return;

    const toAssign = unassignedStudents.slice(0, emptyCoords.length);
    const newSeatsToAdd: AssignedSeat[] = toAssign.map((st, idx) => {
      const [r, c] = emptyCoords[idx];
      return {
        student_id: st.id,
        row_idx: r,
        col_idx: c,
        student_name: st.name,
        student_number: st.student_number,
      };
    });

    setAssignedSeats((prev) => [...prev, ...newSeatsToAdd]);
    setIsDirty(true);
    setSelectedStudentToPlace(null);
  };

  const handleClearAllSeats = () => {
    if (assignedSeats.length === 0) return;
    if (
      !confirm(
        lang === 'zh'
          ? '确定要清空当前班级在该机房的所有机位排座吗？'
          : 'Are you sure you want to clear all seat assignments for this class in this lab?',
      )
    ) {
      return;
    }
    setAssignedSeats([]);
    setIsDirty(true);
    setSelectedStudentToPlace(null);
  };

  const handleSaveSeats = async () => {
    if (!selectedClassId || !activePreviewLab) return;
    try {
      setSavingSeats(true);
      setError('');
      setSaveSuccessMsg('');

      const res = await fetch(`/api/classes/${selectedClassId}/seats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lab_id: activePreviewLab.id,
          seats: assignedSeats.map((s) => ({
            student_id: s.student_id,
            row_idx: s.row_idx,
            col_idx: s.col_idx,
          })),
        }),
      });

      if (res.ok) {
        setIsDirty(false);
        setSaveSuccessMsg(
          lang === 'zh'
            ? '统一机房排座已成功持久化至系统 student_seats 数据表！'
            : 'Seating assignments saved to system student_seats table successfully!',
        );
        onRefresh();
        setTimeout(() => setSaveSuccessMsg(''), 4000);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save seats');
      }
    } catch (err: any) {
      setError(err.message || 'Network error saving seats');
    } finally {
      setSavingSeats(false);
    }
  };

  // Physical lab management handlers
  const handleOpenCreate = () => {
    setRoomNumber('');
    setRows(5);
    setCols(6);
    setError('');
    setEditingLabId(null);
    setIsCreating(true);
  };

  const handleOpenEdit = (lab: ComputerLab) => {
    setRoomNumber(lab.room_number);
    setRows(lab.rows);
    setCols(lab.cols);
    setError('');
    setEditingLabId(lab.id);
    setIsCreating(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomNumber.trim()) {
      setError(lang === 'zh' ? '请输入机房编号/名称' : 'Please enter room name or number');
      return;
    }
    if (rows <= 0 || rows > 15) {
      setError(lang === 'zh' ? '行数应在 1 至 15 之间' : 'Rows should be between 1 and 15');
      return;
    }
    if (cols <= 0 || cols > 15) {
      setError(lang === 'zh' ? '列数应在 1 至 15 之间' : 'Columns should be between 1 and 15');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const url = editingLabId ? `/api/labs/${editingLabId}` : '/api/labs';
      const method = editingLabId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_number: roomNumber.trim(),
          rows,
          cols,
        }),
      });

      if (res.ok) {
        onRefresh();
        setIsCreating(false);
        setEditingLabId(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Server error saving lab');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        lang === 'zh'
          ? '确定要删除该机房吗？删除后对应的座位分配也会被重置。'
          : 'Are you sure you want to delete this lab? Seat mappings will be cleared.',
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/labs/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onRefresh();
        if (selectedLabId === id) {
          setSelectedLabId(null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" id="lab_manager_root">
      {/* Upper header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-gray-200 gap-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <LayoutTemplate className="text-indigo-600" size={24} />
            {lang === 'zh' ? '统一机房座位管理' : 'Unified Computer Lab Seating'}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {lang === 'zh'
              ? '维护物理机房规格及其行列排列规则，并直接根据班级信息读取并编排系统中已存的统一机房座位数据（student_seats 表）。'
              : 'Maintain physical lab layouts and manage unified student seat allocations directly synced with existing system data tables.'}
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all focus:ring-2 focus:ring-indigo-500 cursor-pointer"
        >
          <Plus size={14} />
          {lang === 'zh' ? '新增机房规则' : 'New Lab Config'}
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5 overflow-hidden">
        {/* Left Side: Labs directory list */}
        <div className="lg:col-span-4 flex flex-col min-h-0 bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center shrink-0">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
              {lang === 'zh' ? '机房列表' : 'Computer Labs'}
            </span>
            <span className="bg-gray-200 text-gray-700 font-bold px-2 py-0.5 rounded-full text-xs">
              {computerLabs.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {computerLabs.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-gray-400 h-full">
                <LayoutTemplate size={40} className="mb-2 opacity-30" />
                <p className="text-xs font-medium">
                  {lang === 'zh' ? '暂无机房编号规则' : 'No Computer Labs configured yet.'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {lang === 'zh'
                    ? '点击右上角按钮添加首个机房规格。'
                    : 'Click the button above to add your first computer room.'}
                </p>
              </div>
            ) : (
              computerLabs.map((lab) => {
                const isSelected = activePreviewLab?.id === lab.id;
                const labAssociatedClasses = classes.filter((c) => c.lab_id === lab.id);
                return (
                  <div
                    key={lab.id}
                    onClick={() => {
                      setSelectedLabId(lab.id);
                      setIsCreating(false);
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 group ${
                      isSelected
                        ? 'border-indigo-300 bg-indigo-50/60 shadow-xs ring-1 ring-indigo-200'
                        : 'border-gray-150 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg ${
                            isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'
                          }`}
                        >
                          <Monitor size={16} />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                            {lab.room_number}
                          </div>
                          <div className="text-xs text-gray-400 font-mono mt-0.5">
                            {lab.rows} {lang === 'zh' ? '行' : 'Rows'} × {lab.cols} {lang === 'zh' ? '列' : 'Cols'}
                            <span className="mx-1.5">•</span>
                            {lab.rows * lab.cols} {lang === 'zh' ? '个机位' : 'Seats'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(lab);
                          }}
                          className="p-1 text-gray-500 hover:text-indigo-600 hover:bg-white rounded transition-colors"
                          title={lang === 'zh' ? '编辑规则' : 'Edit Rule'}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(lab.id);
                          }}
                          className="p-1 text-gray-500 hover:text-rose-600 hover:bg-white rounded transition-colors"
                          title={lang === 'zh' ? '删除机房间' : 'Delete Lab'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Associated classes tags */}
                    {labAssociatedClasses.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-gray-100/80">
                        <span className="text-[10px] text-gray-400 font-medium">
                          {lang === 'zh' ? '绑定班级:' : 'Bound:'}
                        </span>
                        {labAssociatedClasses.map((cls) => (
                          <span
                            key={cls.id}
                            className="text-[10px] font-semibold bg-indigo-100/70 text-indigo-700 px-1.5 py-0.5 rounded-md"
                          >
                            {cls.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Interactive layout renderer or edit form */}
        <div className="lg:col-span-8 flex flex-col min-h-0 bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden">
          {isCreating ? (
            /* Creating modal pane */
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
              <div className="p-4 border-b border-gray-100 bg-gray-50 font-bold text-xs text-gray-700 uppercase tracking-wider shrink-0 flex items-center justify-between">
                <span>
                  {editingLabId
                    ? lang === 'zh'
                      ? '编辑机房规则'
                      : 'Edit Lab Seating'
                    : lang === 'zh'
                      ? '创建全新上机机房'
                      : 'Create Computer Lab'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-1.5">
                    <Info size={14} />
                    <span>{error}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                    {lang === 'zh' ? '机房编号 / 场所名称 *' : 'Lab Name / Number *'}
                  </label>
                  <input
                    type="text"
                    value={roomNumber}
                    onChange={(e) => setRoomNumber(e.target.value)}
                    placeholder={
                      lang === 'zh' ? '例如：305综合机房、软创中心、Lab A' : 'e.g. Lab 404, Software Sandbox, Suite C'
                    }
                    className="w-full text-xs p-2.5 border border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-xl mt-1.5"
                    maxLength={32}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                      {lang === 'zh' ? '排列行数 (Rows) *' : 'Rows Direction *'}
                    </label>
                    <input
                      type="number"
                      value={rows}
                      onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                      min={1}
                      max={15}
                      className="w-full text-xs p-2.5 border border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-xl mt-1.5"
                      required
                    />
                    <span className="text-xs text-gray-400 block mt-0.5">
                      {lang === 'zh' ? '上下方向机位数 (最大15行)' : 'Horizontal sets count (Max 15)'}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                      {lang === 'zh' ? '排列列数 (Columns) *' : 'Columns Direction *'}
                    </label>
                    <input
                      type="number"
                      value={cols}
                      onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
                      min={1}
                      max={15}
                      className="w-full text-xs p-2.5 border border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded-xl mt-1.5"
                      required
                    />
                    <span className="text-xs text-gray-400 block mt-0.5">
                      {lang === 'zh' ? '左右方向机位数 (最大15列)' : 'Vertical sets count (Max 15)'}
                    </span>
                  </div>
                </div>

                {/* Simulated visual scale widget */}
                <div className="border border-dashed border-gray-200 bg-gray-50/50 p-4 rounded-xl">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">
                    {lang === 'zh' ? '布局网格缩略结构' : 'Layout Aspect Schema'}
                  </span>
                  <div className="flex flex-col gap-1 items-center justify-center p-3 bg-white rounded-lg border border-gray-100 min-h-[120px]">
                    <div className="flex flex-col gap-1">
                      {Array.from({ length: Math.min(rows, 6) }).map((_, rIdx) => (
                        <div key={rIdx} className="flex gap-1 justify-center">
                          {Array.from({ length: Math.min(cols, 8) }).map((_, cIdx) => (
                            <div
                              key={cIdx}
                              className="w-4 h-4 rounded bg-indigo-100 border border-indigo-200 shrink-0"
                            />
                          ))}
                          {cols > 8 && (
                            <div className="w-4 text-xs text-gray-400 flex items-center justify-center">...</div>
                          )}
                        </div>
                      ))}
                      {rows > 6 && <div className="text-xs text-center text-gray-400 mt-1">...</div>}
                    </div>
                    <span className="text-xs text-gray-450 mt-3 font-medium">
                      配置容量：{rows} × {cols} = {rows * cols} 座位
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-gray-100 shrink-0 flex items-center justify-end gap-2 bg-gray-50">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl transition-all cursor-pointer"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                >
                  <Check size={14} />
                  <span>
                    {submitting
                      ? lang === 'zh'
                        ? '提交中...'
                        : 'Saving...'
                      : lang === 'zh'
                        ? '提交保存'
                        : 'Save Config'}
                  </span>
                </button>
              </div>
            </form>
          ) : (
            /* Layout structural Preview & Class Seating */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Header toolbar with class selection and action buttons */}
              <div className="p-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Users size={14} className="text-indigo-600" />
                    {lang === 'zh' ? '班级机位联动：' : 'Class Seating Link:'}
                  </span>
                  <select
                    value={selectedClassId || ''}
                    onChange={(e) => setSelectedClassId(e.target.value ? e.target.value : null)}
                    className="text-xs font-semibold bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                  >
                    <option value="">
                      {lang === 'zh' ? '📐 物理规格总览 (无班级)' : '📐 Physical Blueprint (No Class)'}
                    </option>
                    {classes.map((cls) => {
                      const isBound = cls.lab_id === activePreviewLab?.id;
                      return (
                        <option key={cls.id} value={cls.id}>
                          {cls.name} {isBound ? (lang === 'zh' ? '★ 已绑定此机房' : '★ Bound') : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {selectedClassId && activePreviewLab && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAutoAssign}
                      disabled={unassignedStudents.length === 0}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title={lang === 'zh' ? '将未排座学生按学号依次填入空闲机位' : 'Auto assign unplaced students'}
                    >
                      <Sparkles size={13} />
                      <span>{lang === 'zh' ? '一键排座' : 'Auto Fill'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAllSeats}
                      disabled={assignedSeats.length === 0}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-gray-100 hover:bg-rose-50 text-gray-600 hover:text-rose-600 border border-gray-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title={lang === 'zh' ? '清空当前班级排座' : 'Clear Seating'}
                    >
                      <RotateCcw size={13} />
                      <span>{lang === 'zh' ? '清空' : 'Clear'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveSeats}
                      disabled={savingSeats || (!isDirty && !activePreviewLab)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-xs transition-all cursor-pointer ${
                        isDirty
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed'
                      }`}
                    >
                      {savingSeats ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      <span>
                        {savingSeats
                          ? lang === 'zh'
                            ? '保存中...'
                            : 'Saving...'
                          : isDirty
                            ? lang === 'zh'
                              ? '保存排座 (已修改)'
                              : 'Save (Modified)'
                            : lang === 'zh'
                              ? '已保存'
                              : 'Saved'}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* Status or Alert Banners */}
              {saveSuccessMsg && (
                <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs px-4 py-2 flex items-center gap-1.5 animate-fadeIn">
                  <Check size={14} className="text-emerald-600 shrink-0" />
                  <span className="font-medium">{saveSuccessMsg}</span>
                </div>
              )}
              {error && (
                <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2 flex items-center gap-1.5">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {activePreviewLab ? (
                <div className="flex-1 flex flex-col min-h-0 bg-slate-950 text-white overflow-hidden relative">
                  {/* Classroom podium indicator */}
                  <div className="py-2.5 flex justify-center shrink-0 border-b border-slate-900 bg-slate-950/80 backdrop-blur-xs z-10">
                    <div className="w-56 bg-slate-900 border border-slate-700 py-1 rounded text-center text-xs font-bold text-slate-300 uppercase tracking-widest select-none shadow-sm flex items-center justify-center gap-1.5">
                      <span>📽️ {lang === 'zh' ? '讲台 / 教师主荧幕' : 'Classroom Stage / Screen'}</span>
                    </div>
                  </div>

                  {/* Seat Grid Viewport */}
                  <div className="flex-1 overflow-auto p-4 flex flex-col items-center">
                    {loadingSeats ? (
                      <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
                        <Loader2 size={24} className="animate-spin text-indigo-400" />
                        <span className="text-xs">
                          {lang === 'zh' ? '正在读取统一机房座位数据...' : 'Loading lab seating data...'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5 py-2 max-w-full">
                        {Array.from({ length: activePreviewLab.rows }).map((_, rIdx) => (
                          <div key={rIdx} className="flex gap-2.5 justify-center items-center">
                            <span className="text-xs font-bold font-mono text-slate-500 w-6 text-right select-none pr-0.5">
                              R{rIdx + 1}
                            </span>
                            {Array.from({ length: activePreviewLab.cols }).map((_, cIdx) => {
                              const seat = seatMap.get(`${rIdx}_${cIdx}`);
                              const isOccupied = !!seat;
                              const isTargetPlacement =
                                selectedStudentToPlace &&
                                (!isOccupied || seat.student_id !== selectedStudentToPlace.id);

                              return (
                                <div
                                  key={cIdx}
                                  onClick={() => handleSeatClick(rIdx, cIdx)}
                                  className={`group relative rounded-xl flex flex-col items-center justify-center transition-all select-none shadow-sm cursor-pointer ${
                                    selectedClassId ? 'w-20 h-14' : 'w-11 h-11'
                                  } ${
                                    isOccupied
                                      ? 'bg-slate-850 border border-indigo-500/70 hover:border-indigo-400 shadow-indigo-950/50'
                                      : isTargetPlacement
                                        ? 'bg-indigo-950/40 border border-dashed border-indigo-400 hover:bg-indigo-900/50 ring-1 ring-indigo-400/50 animate-pulse'
                                        : 'bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                                  }`}
                                >
                                  {isOccupied ? (
                                    <>
                                      {/* Occupied Seat Card */}
                                      <div className="w-full h-full p-1.5 flex flex-col justify-between items-center text-center">
                                        <div className="flex items-center justify-between w-full px-0.5">
                                          <span className="text-[10px] font-mono text-indigo-300/80">
                                            {rIdx + 1}-{cIdx + 1}
                                          </span>
                                          {selectedClassId && (
                                            <button
                                              type="button"
                                              onClick={(e) => handleRemoveSeat(e, rIdx, cIdx)}
                                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-400 p-0.5 rounded transition-opacity"
                                              title={lang === 'zh' ? '移出此座位' : 'Unseat student'}
                                            >
                                              <X size={11} />
                                            </button>
                                          )}
                                        </div>

                                        <div className="font-bold text-xs text-white truncate max-w-[70px] leading-tight">
                                          {seat.student_name || 'Student'}
                                        </div>

                                        <div className="text-[9px] font-mono text-slate-400 truncate max-w-[70px]">
                                          {seat.student_number || `ID:${seat.student_id.slice(-4)}`}
                                        </div>
                                      </div>

                                      {/* Tooltip */}
                                      <div className="absolute bottom-16 bg-slate-900 text-white text-xs rounded-lg px-2.5 py-1.5 hidden group-hover:block whitespace-nowrap z-30 font-sans border border-indigo-700 shadow-2xl pointer-events-none">
                                        <div className="font-bold text-indigo-300">{seat.student_name}</div>
                                        <div className="text-[10px] text-slate-400 font-mono">
                                          {lang === 'zh' ? '学号：' : 'No: '}
                                          {seat.student_number || seat.student_id}
                                        </div>
                                        <div className="text-[10px] text-slate-300 mt-0.5">
                                          {lang === 'zh'
                                            ? `第 ${rIdx + 1} 排，第 ${cIdx + 1} 列`
                                            : `Row ${rIdx + 1}, Col ${cIdx + 1}`}
                                        </div>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      {/* Empty Seat Card */}
                                      <Monitor
                                        size={selectedClassId ? 14 : 15}
                                        className={
                                          isTargetPlacement
                                            ? 'text-indigo-400 animate-bounce'
                                            : 'text-slate-600 opacity-60'
                                        }
                                      />
                                      <span className="text-[10px] font-mono text-slate-500 mt-0.5">
                                        {rIdx + 1}-{cIdx + 1}
                                      </span>

                                      {/* Tooltip */}
                                      <div className="absolute bottom-12 bg-slate-900 text-white text-xs rounded px-2 py-1 hidden group-hover:block whitespace-nowrap z-30 font-sans border border-slate-700 shadow-xl pointer-events-none">
                                        {selectedStudentToPlace
                                          ? lang === 'zh'
                                            ? `点击安排 [${selectedStudentToPlace.name}] 到第 ${rIdx + 1} 排第 ${cIdx + 1} 列`
                                            : `Place [${selectedStudentToPlace.name}] here`
                                          : lang === 'zh'
                                            ? `第 ${rIdx + 1} 排第 ${cIdx + 1} 列 (空闲)`
                                            : `Row ${rIdx + 1} / Column ${cIdx + 1} (Empty)`}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bottom section: Unassigned students tray OR lab specs summary */}
                  {selectedClassId ? (
                    <div className="border-t border-slate-900 bg-slate-900/90 p-3 shrink-0 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-300 flex items-center gap-1.5">
                            <Users size={13} className="text-indigo-400" />
                            {lang === 'zh' ? '待排座学生池：' : 'Unassigned Students Pool:'}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {unassignedStudents.length} {lang === 'zh' ? '人未排' : 'unplaced'} /{' '}
                            {classStudents.length} {lang === 'zh' ? '人总计' : 'total'}
                          </span>
                          {selectedStudentToPlace && (
                            <span className="bg-indigo-900/80 text-indigo-300 border border-indigo-700 text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                              <span>
                                {lang === 'zh'
                                  ? `当前选择: ${selectedStudentToPlace.name} (点击上方空位落座)`
                                  : `Selected: ${selectedStudentToPlace.name} (click empty seat)`}
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedStudentToPlace(null)}
                                className="hover:text-white"
                              >
                                <X size={10} />
                              </button>
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] font-mono text-slate-400">
                          {lang === 'zh' ? '机房已占：' : 'Occupied: '}
                          <span className="text-indigo-400 font-bold">{assignedSeats.length}</span> /{' '}
                          {activePreviewLab.rows * activePreviewLab.cols}
                        </div>
                      </div>

                      {/* Chips of unassigned students */}
                      {unassignedStudents.length === 0 ? (
                        <div className="text-xs text-slate-500 py-1 italic flex items-center gap-1">
                          <UserCheck size={13} className="text-emerald-400" />
                          <span>
                            {lang === 'zh'
                              ? '当前班级全部学生均已成功分配机位！'
                              : 'All students in this class have been assigned seats!'}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-h-16 pr-2">
                          {unassignedStudents.map((st) => {
                            const isSelected = selectedStudentToPlace?.id === st.id;
                            return (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() =>
                                  setSelectedStudentToPlace(isSelected ? null : st)
                                }
                                className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer flex items-center gap-1.5 ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white border-indigo-400 ring-2 ring-indigo-400/50 shadow-md'
                                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-indigo-500 hover:bg-slate-750'
                                }`}
                              >
                                <span>{st.name}</span>
                                {st.student_number && (
                                  <span className="text-[10px] font-mono text-slate-400">{st.student_number}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Pure Physical Lab Blueprint footer */
                    <div className="border-t border-slate-900 bg-slate-900/60 p-3 shrink-0 flex items-center justify-between text-xs text-slate-400 select-none">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-3.5 h-3.5 rounded bg-slate-800 border border-slate-700 flex items-center justify-center p-0.5">
                            <Monitor size={10} className="text-indigo-400 opacity-60" />
                          </div>
                          <span>{lang === 'zh' ? '标准上机终端' : 'Console Terminals'}</span>
                        </div>
                        {boundClasses.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500">{lang === 'zh' ? '已绑定班级:' : 'Bound Classes:'}</span>
                            {boundClasses.map((bc) => (
                              <button
                                key={bc.id}
                                type="button"
                                onClick={() => setSelectedClassId(bc.id)}
                                className="text-indigo-400 hover:text-indigo-300 underline font-semibold text-xs cursor-pointer ml-1"
                              >
                                {bc.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="font-mono text-slate-500">
                        {lang === 'zh' ? '总行数：' : 'Rows: '}
                        <span className="text-indigo-400 font-bold">{activePreviewLab.rows}</span> |
                        {lang === 'zh' ? ' 总列数：' : ' Columns: '}
                        <span className="text-indigo-400 font-bold">{activePreviewLab.cols}</span> |
                        {lang === 'zh' ? ' 配置席位：' : ' Total: '}
                        <span className="text-white font-bold">
                          {activePreviewLab.rows * activePreviewLab.cols}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-400 h-full">
                  <Monitor size={48} className="opacity-20 mb-3" />
                  <p className="text-xs font-medium">
                    {lang === 'zh' ? '请选择一个机房以预览其座位图' : 'Please select a lab config to preview details.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
