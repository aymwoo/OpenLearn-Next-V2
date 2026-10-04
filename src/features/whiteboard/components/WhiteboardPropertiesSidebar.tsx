import React from 'react';
import {
  Settings,
  Undo2,
  Redo2,
  X,
  Trash2,
  Plus,
  Paintbrush,
  Loader2,
} from 'lucide-react';
import { AssignmentBindingField } from './AssignmentBindingField';
import { AssignmentPeerProgressPanel } from './AssignmentPeerProgressPanel';
import { propertyEditorRegistry } from '../properties/PropertyEditorRegistry';
import { paletteItemRegistry } from '../../teacher/lesson-editor/palette-item-registry';

export interface WhiteboardPropertiesSidebarProps {
  isEditMode: boolean;
  selectedShapeId: string | null;
  setSelectedShapeId: (id: string | null) => void;
  activePropertiesElementId: string | null;
  setActivePropertiesElementId: (id: string | null) => void;
  safeElements: Array<{ id: string; type: string; data: string; [key: string]: any }>;
  editingProperties: any;
  handleLocalPropChange: (key: string, val: any) => void;
  handlePropBlur: (key: string, val: any) => void;
  handleNumericPropBlur: (key: string, val: any) => void;
  handlePropsUpdate: (propsToUpdate: any) => void;
  handleUpdateElementData: (props: any) => void;
  handleElementDelete: (id: string) => void;
  handleUndoProp: () => void;
  handleRedoProp: () => void;
  propertyUndoStack: Record<string, any[]>;
  propertyRedoStack: Record<string, any[]>;
  isSyncing: boolean;
  lessonId: string;
  classId?: string | null;
  fullscreenBroadcastClassId?: string | null;
  coursewares: any[];
  fetchCoursewares: (opts?: any) => Promise<any>;
  setZipCandidates: (candidates: any[]) => void;
  setZipUploadInfo: (info: { uuid: string; name: string }) => void;
  setShowEntrySelector: (show: boolean) => void;
  handleAddOption: () => void;
  handleRemoveOption: (idx: number) => void;
  handleOptionChangeLocal: (idx: number, val: string) => void;
  handleOptionBlur: (idx: number, val: string) => void;
}

export const WhiteboardPropertiesSidebar: React.FC<WhiteboardPropertiesSidebarProps> = ({
  isEditMode,
  selectedShapeId,
  setSelectedShapeId,
  activePropertiesElementId,
  setActivePropertiesElementId,
  safeElements,
  editingProperties,
  handleLocalPropChange,
  handlePropBlur,
  handleNumericPropBlur,
  handlePropsUpdate,
  handleUpdateElementData,
  handleElementDelete,
  handleUndoProp,
  handleRedoProp,
  propertyUndoStack,
  propertyRedoStack,
  isSyncing,
  lessonId,
  classId,
  fullscreenBroadcastClassId,
  coursewares,
  fetchCoursewares,
  setZipCandidates,
  setZipUploadInfo,
  setShowEntrySelector,
  handleAddOption,
  handleRemoveOption,
  handleOptionChangeLocal,
  handleOptionBlur,
}) => {
  if (!isEditMode || !selectedShapeId || !editingProperties) {
    return null;
  }

  const selectedEl = safeElements.find((e) => e.id === selectedShapeId);
  if (!selectedEl) return null;

  // 窗体类小组件仅在用户显式点击标题栏“属性图标”或右键菜单“配置组件属性”时展开侧栏
  const isWidget =
    [
      'plugin',
      'hello-world',
      'rollcall',
      'quiz',
      'assignment',
      'html-applet',
      'code-sandbox',
      'math-graph',
      'presentation',
    ].includes(selectedEl.type) || paletteItemRegistry.has(selectedEl.type);
  if (isWidget && activePropertiesElementId !== selectedShapeId) {
    return null;
  }

  return (
    <div
      className="w-80 h-full max-h-full bg-surface border-l border-theme flex flex-col font-sans text-xs select-none shadow-xl shrink-0 z-20 animate-in slide-in-from-right duration-200 text-main"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 顶栏 */}
      <div className="px-4 py-3 border-b border-theme bg-surface-secondary flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <Settings size={15} className="text-muted animate-spin" style={{ animationDuration: '6s' }} />
          <span className="font-bold text-main text-sm">属性编辑器</span>
        </div>
        <div className="flex items-center gap-1.5 font-sans">
          {/* 撤销 (Undo) 按钮 */}
          <button
            onClick={handleUndoProp}
            disabled={(propertyUndoStack[selectedShapeId] || []).length === 0}
            className={`p-1 rounded-lg transition-all flex items-center justify-center gap-1 border border-transparent select-none cursor-pointer ${
              (propertyUndoStack[selectedShapeId] || []).length === 0
                ? 'text-subtle bg-transparent border-transparent opacity-40 cursor-not-allowed'
                : 'text-main bg-surface hover:bg-surface-secondary hover:border-theme active:bg-surface-secondary'
            }`}
            title="撤销属性修改"
          >
            <Undo2 size={13} />
            {(propertyUndoStack[selectedShapeId] || []).length > 0 && (
              <span className="text-xs font-bold text-muted">
                {(propertyUndoStack[selectedShapeId] || []).length}
              </span>
            )}
          </button>

          {/* 重做 (Redo) 按钮 */}
          <button
            onClick={handleRedoProp}
            disabled={(propertyRedoStack[selectedShapeId] || []).length === 0}
            className={`p-1 rounded-lg transition-all flex items-center justify-center gap-1 border border-transparent select-none cursor-pointer ${
              (propertyRedoStack[selectedShapeId] || []).length === 0
                ? 'text-subtle bg-transparent border-transparent opacity-40 cursor-not-allowed'
                : 'text-main bg-surface hover:bg-surface-secondary hover:border-theme active:bg-surface-secondary'
            }`}
            title="重做属性修改"
          >
            <Redo2 size={13} />
            {(propertyRedoStack[selectedShapeId] || []).length > 0 && (
              <span className="text-xs font-bold text-muted">
                {(propertyRedoStack[selectedShapeId] || []).length}
              </span>
            )}
          </button>

          <div className="h-4 w-px bg-border-theme mx-0.5 shrink-0" />

          <button
            onClick={() => {
              setActivePropertiesElementId(null);
              setSelectedShapeId(null);
            }}
            className="text-muted hover:text-main hover:bg-surface-secondary p-1 rounded-full transition-all cursor-pointer"
            title="关闭属性编辑器"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 基本标签和信息 */}
        <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted text-xs font-bold uppercase tracking-wider">组件类型</span>
            <span className="px-2 py-0.5 bg-primary-theme-light text-primary-theme rounded text-xs font-bold uppercase tracking-wider">
              {selectedEl.type}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-xs font-bold uppercase tracking-wider">组件标识</span>
            <span className="font-mono text-muted text-xs truncate max-w-[155px]" title={selectedEl.id}>
              {selectedEl.id}
            </span>
          </div>
        </div>

        {/* 通用属性: X, Y 坐标及宽高 */}
        <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
          <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5 flex items-center gap-1.5">
            物理定位 & 尺寸
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">X 坐标</label>
              <input
                type="number"
                value={Math.round(editingProperties.x ?? 0)}
                onChange={(e) => handleLocalPropChange('x', parseFloat(e.target.value) || 0)}
                onBlur={(e) => handleNumericPropBlur('x', e.target.value)}
                className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
              />
            </div>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">Y 坐标</label>
              <input
                type="number"
                value={Math.round(editingProperties.y ?? 0)}
                onChange={(e) => handleLocalPropChange('y', parseFloat(e.target.value) || 0)}
                onBlur={(e) => handleNumericPropBlur('y', e.target.value)}
                className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
              />
            </div>
          </div>

          {selectedEl.type !== 'pen' && selectedEl.type !== 'circle' && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="block text-xs text-muted font-semibold mb-1">宽度 (Width)</label>
                <input
                  type="number"
                  min="50"
                  value={Math.round(editingProperties.width ?? 300)}
                  onChange={(e) => handleLocalPropChange('width', parseFloat(e.target.value) || 50)}
                  onBlur={(e) => handleNumericPropBlur('width', e.target.value)}
                  className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
                />
              </div>
              <div>
                <label className="block text-xs text-muted font-semibold mb-1">高度 (Height)</label>
                <input
                  type="number"
                  min="50"
                  value={Math.round(editingProperties.height ?? 300)}
                  onChange={(e) => handleLocalPropChange('height', parseFloat(e.target.value) || 50)}
                  onBlur={(e) => handleNumericPropBlur('height', e.target.value)}
                  className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
                />
              </div>
            </div>
          )}

          {selectedEl.type === 'circle' && (
            <div className="mt-2">
              <label className="block text-xs text-muted font-semibold mb-1">半径 (Radius)</label>
              <input
                type="number"
                min="5"
                value={Math.round(editingProperties.radius ?? 50)}
                onChange={(e) => handleLocalPropChange('radius', parseFloat(e.target.value) || 5)}
                onBlur={(e) => handleNumericPropBlur('radius', e.target.value)}
                className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
              />
            </div>
          )}
        </div>

        {/* 插件注册的属性编辑器 —— 优先于硬编码编辑器 */}
        {(() => {
          const PluginEditor = propertyEditorRegistry.get(selectedEl.type);
          if (PluginEditor) {
            return (
              <PluginEditor
                elementId={selectedEl.id}
                elementType={selectedEl.type}
                data={editingProperties}
                updateData={handlePropsUpdate}
                lessonId={lessonId}
                onClose={() => setSelectedShapeId(null)}
              />
            );
          }

          // 如果未注册专用属性编辑器，但存在 PaletteItemConfig，按其 editFields 自动渲染通用表单
          const pluginPaletteConfig = paletteItemRegistry.get(selectedEl.type);
          if (pluginPaletteConfig) {
            const fields = pluginPaletteConfig.editFields || [];
            return (
              <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
                <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5 flex items-center justify-between">
                  <span>{pluginPaletteConfig.labelZh} 配置</span>
                  <span className="text-xs text-muted font-normal">插件扩展</span>
                </h4>
                {fields.length === 0 ? (
                  <div>
                    <label className="block text-xs text-muted font-semibold mb-1">标题 (Title)</label>
                    <input
                      type="text"
                      value={editingProperties.title || ''}
                      onChange={(e) => handleLocalPropChange('title', e.target.value)}
                      onBlur={(e) => handlePropBlur('title', e.target.value)}
                      className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
                      placeholder="组件标题..."
                    />
                  </div>
                ) : (
                  fields.map((field) => {
                    const val = editingProperties[field.key] ?? '';
                    if (field.kind === 'textarea') {
                      return (
                        <div key={field.key}>
                          <label className="block text-xs text-muted font-semibold mb-1">
                            {field.labelZh}
                          </label>
                          <textarea
                            value={val}
                            onChange={(e) => handleLocalPropChange(field.key, e.target.value)}
                            onBlur={(e) => handlePropBlur(field.key, e.target.value)}
                            className="w-full h-20 p-2 border border-theme rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main resize-none font-medium leading-relaxed"
                            placeholder={field.placeholderZh || ''}
                          />
                        </div>
                      );
                    }
                    if (field.kind === 'select') {
                      return (
                        <div key={field.key}>
                          <label className="block text-xs text-muted font-semibold mb-1">
                            {field.labelZh}
                          </label>
                          <select
                            value={val}
                            onChange={(e) => {
                              handleLocalPropChange(field.key, e.target.value);
                              handlePropBlur(field.key, e.target.value);
                            }}
                            className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-primary-theme"
                          >
                            <option value="">请选择...</option>
                            {(field.options || []).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    }
                    return (
                      <div key={field.key}>
                        <label className="block text-xs text-muted font-semibold mb-1">{field.labelZh}</label>
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => handleLocalPropChange(field.key, e.target.value)}
                          onBlur={(e) => handlePropBlur(field.key, e.target.value)}
                          className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
                          placeholder={field.placeholderZh || ''}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            );
          }

          return null;
        })()}

        {/* 1. QUIZ (测验配置) */}
        {selectedEl.type === 'quiz' && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">随堂测验配置</h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">测验题目 (Question)</label>
              <textarea
                value={editingProperties.question || ''}
                onChange={(e) => handleLocalPropChange('question', e.target.value)}
                onBlur={(e) => handlePropBlur('question', e.target.value)}
                className="w-full h-20 p-2 border border-theme rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main resize-none font-medium leading-relaxed"
                placeholder="编写问题描述..."
              />
            </div>

            {/* Correct answer selector */}
            {(editingProperties.options || []).length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
                <label className="block text-xs text-amber-500 font-bold mb-1.5">
                  ⚠️ 正确答案 (Correct Answer)
                </label>
                <select
                  value={editingProperties.correctAnswer || ''}
                  onChange={(e) => {
                    handleLocalPropChange('correctAnswer', e.target.value);
                    handlePropBlur('correctAnswer', e.target.value);
                  }}
                  className={`w-full px-2 py-1.5 border rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer ${
                    editingProperties.correctAnswer
                      ? 'border-green-500/40 bg-green-500/10 text-green-600'
                      : 'border-amber-500/40 bg-surface text-main'
                  }`}
                >
                  <option value="">-- 请选择正确答案 --</option>
                  {(editingProperties.options || []).map((opt: string, idx: number) => (
                    <option key={idx} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {!editingProperties.correctAnswer && (
                  <p className="text-xs text-amber-500 mt-1">未设置正确答案将无法自动判分</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs text-muted font-semibold">选项列表 (Options)</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {(editingProperties.options || []).map((opt: string, idx: number) => {
                  const optionLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                  const label = optionLabels[idx] || idx + 1;
                  return (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="font-bold text-main bg-surface-secondary rounded px-1.5 py-1 text-center shrink-0 min-w-[22px]">
                        {label}
                      </span>
                      <input
                        type="text"
                        value={opt || ''}
                        onChange={(e) => handleOptionChangeLocal(idx, e.target.value)}
                        onBlur={(e) => handleOptionBlur(idx, e.target.value)}
                        className="flex-1 px-2 py-1 border border-theme rounded-lg text-xs font-medium bg-surface text-main"
                      />
                      <button
                        onClick={() => handleRemoveOption(idx)}
                        title="删除选项"
                        className="text-muted hover:text-rose-500 hover:bg-rose-500/10 p-1 rounded-md shrink-0 transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={handleAddOption}
                className="w-full mt-2 py-1 bg-surface-secondary hover:bg-surface-secondary text-main font-bold border border-theme rounded-lg flex items-center justify-center gap-1 transition-all text-xs cursor-pointer"
              >
                <Plus size={12} /> 添加选项
              </button>
            </div>
          </div>
        )}

        {/* 2. ASSIGNMENT (作业配置) */}
        {selectedEl.type === 'assignment' && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">作业选项配置</h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">作业任务标题 (Title)</label>
              <input
                type="text"
                value={editingProperties.title || ''}
                onChange={(e) => handleLocalPropChange('title', e.target.value)}
                onBlur={(e) => handlePropBlur('title', e.target.value)}
                className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
                placeholder="作业名..."
              />
            </div>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">详细作业要求描述</label>
              <textarea
                value={editingProperties.description || ''}
                onChange={(e) => handleLocalPropChange('description', e.target.value)}
                onBlur={(e) => handlePropBlur('description', e.target.value)}
                className="w-full h-24 p-2 border border-theme rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main resize-none font-medium leading-relaxed"
                placeholder="请输入详细的作业指南..."
              />
            </div>
            <AssignmentBindingField
              lessonId={lessonId}
              classId={classId || fullscreenBroadcastClassId || undefined}
              elementId={selectedEl.id}
              value={editingProperties.assignmentId || ''}
              draftTitle={editingProperties.title || ''}
              draftDescription={editingProperties.description || ''}
              onChange={(assignmentId) => {
                handleLocalPropChange('assignmentId', assignmentId);
                void handlePropBlur('assignmentId', assignmentId);
              }}
            />
            {editingProperties.assignmentId ? (
              <AssignmentPeerProgressPanel
                key={String(editingProperties.assignmentId)}
                assignmentId={String(editingProperties.assignmentId)}
              />
            ) : null}
          </div>
        )}

        {/* 3. CODE SANDBOX 和 HTML APPLET 和 Sandbox */}
        {(selectedEl.type === 'code-sandbox' || selectedEl.type === 'html-applet') && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5 flex justify-between items-center">
              <span>动态运行代码定制</span>
              {selectedEl.type === 'html-applet' && (
                <span className="text-xs bg-primary-theme-light text-primary-theme px-1.5 py-0.5 rounded-full font-bold">
                  HTML Applet
                </span>
              )}
            </h4>

            {selectedEl.type === 'html-applet' && (
              <div className="space-y-3 border-b border-theme pb-3">
                <div>
                  <label className="block text-xs text-primary-theme font-bold mb-1">
                    选择互动网络课件 (ZIP/HTML):
                  </label>
                  <select
                    value={editingProperties.coursewareUuid || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      handlePropsUpdate({ coursewareUuid: val, resourceId: '' });
                    }}
                    className="w-full text-xs p-2 bg-surface-secondary border border-theme hover:border-primary-theme rounded-lg text-main focus:outline-none focus:ring-1 focus:ring-primary-theme transition-all font-semibold"
                  >
                    <option value="">-- 使用自定义沙箱代码 --</option>
                    {coursewares.map((c) => (
                      <option key={c.id} value={c.uuid}>
                        📁 [互动课件] {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bg-surface-secondary p-2.5 rounded-xl border border-theme text-xs text-muted space-y-2">
                  <span className="font-bold text-main block">上传新课件 (自动生成独立运行实例):</span>
                  <label className="w-full flex flex-col items-center justify-center p-3 bg-indigo-50 hover:bg-indigo-100 border border-dashed border-indigo-300 hover:border-indigo-400 rounded-lg cursor-pointer text-center transition-all">
                    <span className="font-bold text-indigo-700 text-xs">
                      ✨ 上传互动网络课件 (.zip / .html)
                    </span>
                    <span className="text-xs text-indigo-500 mt-0.5">
                      支持多文件打包 ZIP 或单页 HTML，自动接入 LMS Bridge
                    </span>
                    <input
                      type="file"
                      accept=".zip,.html,.htm"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        const reader = new FileReader();
                        reader.onload = async (event) => {
                          const result = event.target?.result as string;
                          try {
                            const res = await fetch('/api/courseware/upload', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: file.name.replace(/\.[^/.]+$/, ''),
                                filename: file.name,
                                base64Data: result,
                              }),
                            });
                            if (res.ok) {
                              const data = await res.json();
                              if (data.need_select_entry) {
                                setZipCandidates(data.candidates);
                                setZipUploadInfo({ uuid: data.uuid, name: data.name });
                                setShowEntrySelector(true);
                              } else {
                                handlePropsUpdate({ coursewareUuid: data.uuid, resourceId: '' });
                                fetchCoursewares({ force: true });
                              }
                            } else {
                              const errData = await res.json();
                              alert('上传失败: ' + (errData.error || res.statusText));
                            }
                          } catch (err) {
                            console.error('Courseware upload failed:', err);
                          }
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
              </div>
            )}

            {(!editingProperties.coursewareUuid || selectedEl.type === 'code-sandbox') && (
              <div>
                <label className="block text-xs text-slate-400 font-semibold mb-1">
                  沙箱程序代码 (Source Code)
                </label>
                <textarea
                  value={editingProperties.code || ''}
                  onChange={(e) => handleLocalPropChange('code', e.target.value)}
                  onBlur={(e) => handlePropBlur('code', e.target.value)}
                  className="w-full h-48 p-3 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-900 text-slate-100 resize-none leading-relaxed"
                  placeholder="// 编写交互沙箱代码..."
                />
              </div>
            )}
          </div>
        )}

        {/* 4. MATH GRAPH */}
        {selectedEl.type === 'math-graph' && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">函数解析拟合</h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">函数表达式 y = f(x)</label>
              <input
                type="text"
                value={editingProperties.equation || ''}
                onChange={(e) => handleLocalPropChange('equation', e.target.value)}
                onBlur={(e) => handlePropBlur('equation', e.target.value)}
                className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
              />
              <p className="text-xs text-muted mt-1 leading-snug">
                支持标准 JS 表达式。 示例：
                <br />• <code className="bg-surface-secondary px-1 rounded">Math.sin(x)</code> 正负弦波形
                <br />• <code className="bg-surface-secondary px-1 rounded">Math.cos(x) * x</code> 振幅衰减
              </p>
            </div>
          </div>
        )}

        {/* 5. PRESENTATION */}
        {selectedEl.type === 'presentation' && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">幻灯片 Markdown 文案</h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">Markdown 源代码</label>
              <textarea
                value={editingProperties.markdown || ''}
                onChange={(e) => handleLocalPropChange('markdown', e.target.value)}
                onBlur={(e) => handlePropBlur('markdown', e.target.value)}
                className="w-full h-64 p-2.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme resize-none font-medium leading-relaxed bg-surface text-main"
                placeholder="修改 Markdown 内容..."
              />
            </div>
          </div>
        )}

        {/* 6. TEXT (文字颜色样式) */}
        {selectedEl.type === 'text' && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">文字属性管理</h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">文本内容</label>
              <input
                type="text"
                value={editingProperties.text || ''}
                onChange={(e) => handleLocalPropChange('text', e.target.value)}
                onBlur={(e) => handlePropBlur('text', e.target.value)}
                className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
              />
            </div>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">文字大小 (FontSize)</label>
              <input
                type="number"
                min="10"
                max="100"
                value={editingProperties.fontSize || 16}
                onChange={(e) => handleLocalPropChange('fontSize', parseInt(e.target.value) || 10)}
                onBlur={(e) => handleNumericPropBlur('fontSize', e.target.value)}
                className="w-full px-2 py-1.5 border border-theme rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary-theme bg-surface text-main"
              />
            </div>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">文字填充颜色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editingProperties.color || '#000000'}
                  onChange={(e) => handleLocalPropChange('color', e.target.value)}
                  onBlur={(e) => handlePropBlur('color', e.target.value)}
                  className="w-8 h-8 rounded border border-theme cursor-pointer shrink-0 bg-surface"
                />
                <span className="font-mono text-xs text-muted">{editingProperties.color || '#000000'}</span>
              </div>
            </div>
          </div>
        )}

        {/* 7. RECTANGLE 和 SHAPE */}
        {(selectedEl.type === 'rectangle' || selectedEl.type === 'shape') && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">矩形样式配置</h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">外边框颜色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editingProperties.stroke || '#000000'}
                  onChange={(e) => handleLocalPropChange('stroke', e.target.value)}
                  onBlur={(e) => handlePropBlur('stroke', e.target.value)}
                  className="w-8 h-8 rounded border border-theme cursor-pointer shrink-0 bg-surface"
                />
                <span className="font-mono text-xs text-muted">{editingProperties.stroke || '#000000'}</span>
              </div>
            </div>
          </div>
        )}

        {/* 8. CIRCLE */}
        {selectedEl.type === 'circle' && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">圆形样式配置</h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">外边框颜色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editingProperties.stroke || '#000000'}
                  onChange={(e) => handleLocalPropChange('stroke', e.target.value)}
                  onBlur={(e) => handlePropBlur('stroke', e.target.value)}
                  className="w-8 h-8 rounded border border-theme cursor-pointer shrink-0 bg-surface"
                />
                <span className="font-mono text-xs text-muted">{editingProperties.stroke || '#000000'}</span>
              </div>
            </div>
          </div>
        )}

        {/* 9. PEN */}
        {selectedEl.type === 'pen' && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">线条样式配置</h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">折线颜色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editingProperties.color || '#000000'}
                  onChange={(e) => handleLocalPropChange('color', e.target.value)}
                  onBlur={(e) => handlePropBlur('color', e.target.value)}
                  className="w-8 h-8 rounded border border-theme cursor-pointer shrink-0 bg-surface"
                />
                <span className="font-mono text-xs text-muted">{editingProperties.color || '#000000'}</span>
              </div>
            </div>
          </div>
        )}

        {/* 10. HIGHLIGHTER */}
        {selectedEl.type === 'highlighter' && (
          <div className="bg-surface p-3 rounded-xl border border-theme shadow-sm space-y-3">
            <h4 className="font-bold text-main text-xs border-b border-theme pb-1.5">
              高亮荧光标记 (Highlighter)
            </h4>
            <div>
              <label className="block text-xs text-muted font-semibold mb-1">荧光笔颜色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editingProperties.color || '#facc15'}
                  onChange={(e) => handleLocalPropChange('color', e.target.value)}
                  onBlur={(e) => handlePropBlur('color', e.target.value)}
                  className="w-8 h-8 rounded border border-theme cursor-pointer shrink-0 bg-surface"
                />
                <span className="font-mono text-xs text-muted">{editingProperties.color || '#facc15'}</span>
              </div>
            </div>
          </div>
        )}

        <div className="text-xs text-muted text-center select-none pt-2 font-medium">
          提示：属性在失焦或修改时自动同步，多端可见。
        </div>
      </div>

      {/* 底部操作按钮 */}
      <div className="p-3 border-t border-slate-200 bg-white flex flex-col gap-2 shrink-0">
        <button
          onClick={() => handleUpdateElementData(editingProperties)}
          disabled={isSyncing}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition-all shadow-sm hover:shadow active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 text-xs"
        >
          {isSyncing ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              正在广播同步...
            </>
          ) : (
            <>
              <Paintbrush size={13} />
              应用修改并强制同步
            </>
          )}
        </button>
        <button
          onClick={() => {
            handleElementDelete(selectedShapeId);
            setSelectedShapeId(null);
          }}
          className="w-full py-2 bg-red-50 hover:bg-red-105 text-red-650 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 border border-red-200 cursor-pointer text-xs"
        >
          <Trash2 size={13} />
          删除当前组件
        </button>
      </div>
    </div>
  );
};
