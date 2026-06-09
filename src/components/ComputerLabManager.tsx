import React, { useState } from 'react';
import { LayoutTemplate, Plus, Trash2, Edit2, Monitor, HelpCircle, Info, Check, X } from 'lucide-react';

interface ComputerLab {
  id: string;
  room_number: string;
  rows: number;
  cols: number;
  created_at: number;
}

interface ComputerLabManagerProps {
  computerLabs: ComputerLab[];
  onRefresh: () => void;
  lang: 'zh' | 'en';
}

export function ComputerLabManager({ computerLabs, onRefresh, lang }: ComputerLabManagerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingLabId, setEditingLabId] = useState<string | null>(null);
  
  // Form states
  const [roomNumber, setRoomNumber] = useState('');
  const [rows, setRows] = useState(5);
  const [cols, setCols] = useState(6);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Selected lab for grid preview
  const [selectedLabId, setSelectedLabId] = useState<string | null>(
    computerLabs.length > 0 ? computerLabs[0].id : null
  );

  const activePreviewLab = computerLabs.find(lab => lab.id === (selectedLabId || (computerLabs[0]?.id)));

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
          cols
        })
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
    if (!confirm(lang === 'zh' ? '确定要删除该机房吗？删除后对应的座位分配也会被重置。' : 'Are you sure you want to delete this lab? Seat mappings will be cleared.')) {
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
              ? '创建和维护物理机房编号及其行列排列规则。在此处配置机房，然后可在“班级详情”页面为班级学生分配具体的上机机位。'
              : 'Create and specify physical computer lab configurations. Once configured here, assign student seats inside each Class Details panel.'}
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
        <div className="lg:col-span-5 flex flex-col min-h-0 bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center shrink-0">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
              {lang === 'zh' ? '机房列表' : 'Computer Labs'}
            </span>
            <span className="bg-gray-200 text-gray-700 font-bold px-2 py-0.5 rounded-full text-[10px]">
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
                <p className="text-[10px] text-gray-500 mt-1">
                  {lang === 'zh' ? '点击右上角按钮添加首个机房规格。' : 'Click the button above to add your first computer room.'}
                </p>
              </div>
            ) : (
              computerLabs.map(lab => {
                const isSelected = activePreviewLab?.id === lab.id;
                return (
                  <div
                    key={lab.id}
                    onClick={() => setSelectedLabId(lab.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                      isSelected 
                        ? 'border-indigo-200 bg-indigo-50/50 shadow-xs' 
                        : 'border-gray-150 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'}`}>
                        <Monitor size={16} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-800">{lab.room_number}</div>
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">
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
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Interactive layout renderer or edit form */}
        <div className="lg:col-span-7 flex flex-col min-h-0 bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden">
          {isCreating ? (
            /* Creating modal pane */
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
              <div className="p-4 border-b border-gray-100 bg-gray-50 font-bold text-xs text-gray-700 uppercase tracking-wider shrink-0 flex items-center justify-between">
                <span>{editingLabId ? (lang === 'zh' ? '编辑机房规则' : 'Edit Lab Seating') : (lang === 'zh' ? '创建全新上机机房' : 'Create Computer Lab')}</span>
                <button type="button" onClick={() => setIsCreating(false)} className="text-gray-400 hover:text-gray-600">
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
                    placeholder={lang === 'zh' ? '例如：305综合机房、软创中心、Lab A' : 'e.g. Lab 404, Software Sandbox, Suite C'}
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
                    <span className="text-[10px] text-gray-400 block mt-0.5">{lang === 'zh' ? '上下方向机位数 (最大15行)' : 'Horizontal sets count (Max 15)'}</span>
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
                    <span className="text-[10px] text-gray-400 block mt-0.5">{lang === 'zh' ? '左右方向机位数 (最大15列)' : 'Vertical sets count (Max 15)'}</span>
                  </div>
                </div>

                {/* Simulated visual scale widget */}
                <div className="border border-dashed border-gray-200 bg-gray-50/50 p-4 rounded-xl">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">{lang === 'zh' ? '布局网格缩略结构' : 'Layout Aspect Schema'}</span>
                  <div className="flex flex-col gap-1 items-center justify-center p-3 bg-white rounded-lg border border-gray-100 min-h-[120px]">
                    <div className="flex flex-col gap-1">
                      {Array.from({ length: Math.min(rows, 6) }).map((_, rIdx) => (
                        <div key={rIdx} className="flex gap-1 justify-center">
                          {Array.from({ length: Math.min(cols, 8) }).map((_, cIdx) => (
                            <div key={cIdx} className="w-4 h-4 rounded bg-indigo-100 border border-indigo-200 shrink-0" />
                          ))}
                          {cols > 8 && <div className="w-4 text-[10px] text-gray-400 flex items-center justify-center">...</div>}
                        </div>
                      ))}
                      {rows > 6 && <div className="text-[10px] text-center text-gray-400 mt-1">...</div>}
                    </div>
                    <span className="text-[10px] text-gray-450 mt-3 font-medium">配置容量：{rows} × {cols} = {rows * cols} 座位</span>
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
                  <span>{submitting ? (lang === 'zh' ? '提交中...' : 'Saving...') : (lang === 'zh' ? '提交保存' : 'Save Config')}</span>
                </button>
              </div>
            </form>
          ) : (
            /* Layout structural Preview */
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 border-b border-gray-100 bg-gray-50 font-bold text-xs text-gray-700 uppercase tracking-wider shrink-0">
                <span>{lang === 'zh' ? '物理排列布局预览' : 'Physical Classroom Layout Preview'}</span>
              </div>

              {activePreviewLab ? (
                <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center bg-slate-950 text-white min-h-[300px]">
                  {/* Classroom podium / front indicator */}
                  <div className="w-48 bg-slate-800 border border-slate-700 py-1.5 rounded text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-10 select-none shadow-md shrink-0">
                    {lang === 'zh' ? '📽️ 讲台 / 主荧幕' : '📽️ Classroom Teacher Stage / Screen'}
                  </div>

                  <div className="flex flex-col gap-3 py-4 max-w-full">
                    {Array.from({ length: activePreviewLab.rows }).map((_, rIdx) => (
                      <div key={rIdx} className="flex gap-3 justify-center items-center">
                        <span className="text-[10px] font-bold font-mono text-slate-500 w-6 text-right select-none pr-1">R{rIdx + 1}</span>
                        {Array.from({ length: activePreviewLab.cols }).map((_, cIdx) => (
                          <div
                            key={cIdx}
                            className="group relative w-10 h-10 rounded-lg flex flex-col items-center justify-center bg-slate-800 border border-slate-700 hover:border-indigo-500 hover:bg-slate-750 font-mono text-[9px] font-semibold text-indigo-400 transition-all select-none shadow-sm cursor-help"
                          >
                            <Monitor size={14} className="opacity-40" />
                            <span className="text-[8px] text-slate-400 mt-0.5">{rIdx + 1}-{cIdx + 1}</span>
                            
                            {/* Hover tooltip */}
                            <div className="absolute bottom-11 bg-indigo-950 text-white text-[9px] rounded px-2 py-1 hidden group-hover:block whitespace-nowrap z-30 font-sans border border-indigo-800 shadow-xl font-medium">
                              {lang === 'zh' ? `第 ${rIdx + 1} 排，第 ${cIdx + 1} 列` : `Row ${rIdx + 1} / Column ${cIdx + 1}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="mt-8 flex items-center justify-center gap-6 text-[10px] text-slate-400 shrink-0 select-none border-t border-slate-900 pt-4 w-full">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded bg-slate-800 border border-slate-700 flex items-center justify-center p-0.5">
                        <Monitor size={10} className="text-indigo-400 opacity-40" />
                      </div>
                      <span>{lang === 'zh' ? '预备上机位置 / 终端' : 'Empty seat console terminals'}</span>
                    </div>
                    <div className="font-mono text-slate-500">
                      {lang === 'zh' ? '总行数：' : 'Rows: '}<span className="text-indigo-400 font-bold">{activePreviewLab.rows}</span> | 
                      {lang === 'zh' ? ' 总列数：' : ' Columns: '}<span className="text-indigo-400 font-bold">{activePreviewLab.cols}</span> | 
                      {lang === 'zh' ? ' 配置席位：' : ' Total: '}<span className="text-white font-bold">{activePreviewLab.rows * activePreviewLab.cols}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-400 h-full">
                  <Monitor size={48} className="opacity-20 mb-3" />
                  <p className="text-xs font-medium">{lang === 'zh' ? '请选择一个机房以预览其座位图' : 'Please select a lab config to preview details.'}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
