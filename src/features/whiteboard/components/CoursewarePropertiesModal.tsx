import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  Save,
  Globe,
  Upload,
  Maximize2,
  RefreshCw,
  Code,
  FileCode,
  AlertCircle,
} from 'lucide-react';
import type { HtmlAppletPayload } from '../canvas-model/types';

export type HtmlAppletData = HtmlAppletPayload & {
  width?: number;
  height?: number;
  [key: string]: any;
};

export interface CoursewarePropertiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  element: { id: string; type: string; data: string; [key: string]: any } | null;
  coursewares?: Array<{ id: string; uuid: string; name: string }>;
  fetchCoursewares?: (opts?: any) => Promise<any>;
  onApplyTemporary: (elementId: string, updatedData: HtmlAppletData) => void;
  onSavePermanent?: (elementId: string, updatedData: HtmlAppletData) => Promise<void> | void;
}

export const CoursewarePropertiesModal: React.FC<CoursewarePropertiesModalProps> = ({
  isOpen,
  onClose,
  element,
  coursewares = [],
  fetchCoursewares,
  onApplyTemporary,
  onSavePermanent,
}) => {
  // 解析元素初始属性
  const parsedData: HtmlAppletData = React.useMemo(() => {
    if (!element?.data) return { title: 'Interactive Courseware' };
    try {
      return typeof element.data === 'string' ? JSON.parse(element.data) : element.data;
    } catch {
      return { title: 'Interactive Courseware' };
    }
  }, [element]);

  // 表单状态
  const [title, setTitle] = useState(parsedData.title || 'Interactive Courseware');
  const [width, setWidth] = useState<number>(Number(parsedData.width) || 800);
  const [height, setHeight] = useState<number>(Number(parsedData.height) || 600);
  const [coursewareUuid, setCoursewareUuid] = useState(parsedData.coursewareUuid || '');
  const [code, setCode] = useState(parsedData.code || '');
  const [isTemporary, setIsTemporary] = useState(true); // 默认保护模式：仅本次课堂临时生效
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 同步元素数据到表单
  useEffect(() => {
    if (isOpen && element) {
      setTitle(parsedData.title || 'Interactive Courseware');
      setWidth(Number(parsedData.width) || 800);
      setHeight(Number(parsedData.height) || 600);
      setCoursewareUuid(parsedData.coursewareUuid || '');
      setCode(parsedData.code || '');
      setIsTemporary(true); // 每次打开重置为安全的临时模式
      setUploadError(null);
    }
  }, [isOpen, element, parsedData]);

  // 键盘 Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !element) return null;

  // 上传新课件包处理
  const handleUploadCourseware = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    try {
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
          const json = await res.json();
          if (res.ok && json.uuid) {
            setCoursewareUuid(json.uuid);
            if (fetchCoursewares) await fetchCoursewares({ force: true });
          } else {
            setUploadError(json.error || '课件上传失败');
          }
        } catch (err: any) {
          setUploadError(err.message || '网络异常');
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadError(err.message || '读取文件失败');
      setIsUploading(false);
    }
  };

  // 提交修改
  const handleApply = async () => {
    const updatedData: HtmlAppletData = {
      ...parsedData,
      title: title.trim() || 'Interactive Courseware',
      width: Math.max(300, width),
      height: Math.max(200, height),
      coursewareUuid: coursewareUuid || undefined,
      code: !coursewareUuid ? code : undefined,
    };

    if (isTemporary) {
      // 仅本次课堂临时生效：不调用 PUT 接口，只走内存更新与广播
      onApplyTemporary(element.id, updatedData);
    } else if (onSavePermanent) {
      // 同步覆盖原课程模板
      await onSavePermanent(element.id, updatedData);
    }

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-150"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="courseware-props-modal-title"
    >
      <div
        className="w-full max-w-xl bg-surface border border-theme rounded-2xl shadow-2xl flex flex-col overflow-hidden text-main font-sans animate-in zoom-in-95 duration-150"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="px-5 py-4 border-b border-theme bg-surface-secondary/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-primary-theme/10 text-primary-theme border border-primary-theme/20">
              <Globe size={18} />
            </span>
            <div>
              <h3 id="courseware-props-modal-title" className="text-sm font-bold text-main leading-tight">
                课堂课件属性临时调整
              </h3>
              <p className="text-xs text-muted mt-0.5">
                实时调节互动课件展示属性与数据源
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface-secondary transition-colors cursor-pointer"
            title="关闭窗口"
          >
            <X size={16} />
          </button>
        </div>

        {/* 核心配置表单内容区 */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* 1. 课件标题 */}
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">课件展示标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入课件窗口标题..."
              className="w-full px-3 py-2 text-xs bg-surface border border-theme hover:border-primary-theme/60 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-theme/20 text-main transition-all font-medium"
            />
          </div>

          {/* 2. 窗口尺寸与预设快捷调整 */}
          <div className="bg-surface-secondary/40 p-3.5 rounded-xl border border-theme space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-main flex items-center gap-1.5">
                <Maximize2 size={13} className="text-muted" />
                画布中窗口尺寸 (宽 × 高)
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setWidth(800);
                    setHeight(600);
                  }}
                  className="px-2 py-0.5 rounded-md text-2xs bg-surface border border-theme text-muted hover:text-primary-theme hover:border-primary-theme/50 transition-colors"
                >
                  800×600 (4:3)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWidth(960);
                    setHeight(540);
                  }}
                  className="px-2 py-0.5 rounded-md text-2xs bg-surface border border-theme text-muted hover:text-primary-theme hover:border-primary-theme/50 transition-colors"
                >
                  960×540 (16:9)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWidth(1200);
                    setHeight(675);
                  }}
                  className="px-2 py-0.5 rounded-md text-2xs bg-surface border border-theme text-muted hover:text-primary-theme hover:border-primary-theme/50 transition-colors"
                >
                  1200×675 (大屏)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-2xs text-muted mb-1">宽度 (Width, px)</label>
                <input
                  type="number"
                  min={300}
                  max={2400}
                  step={20}
                  value={width}
                  onChange={(e) => setWidth(parseInt(e.target.value, 10) || 300)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-surface border border-theme rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-theme text-main"
                />
              </div>
              <div>
                <label className="block text-2xs text-muted mb-1">高度 (Height, px)</label>
                <input
                  type="number"
                  min={200}
                  max={1800}
                  step={20}
                  value={height}
                  onChange={(e) => setHeight(parseInt(e.target.value, 10) || 200)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-surface border border-theme rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-theme text-main"
                />
              </div>
            </div>
          </div>

          {/* 3. 课件数据源选择 */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-muted">
              关联课件源 (选择现有课件包或使用独立代码)
            </label>

            {/* 下拉选择系统已有课件 */}
            <div className="flex gap-2">
              <select
                value={coursewareUuid}
                onChange={(e) => setCoursewareUuid(e.target.value)}
                className="flex-1 px-3 py-2 text-xs bg-surface border border-theme hover:border-primary-theme/60 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-theme text-main font-medium"
              >
                <option value="">-- 使用下方手写 HTML/JS 代码 --</option>
                {coursewares.map((cw) => (
                  <option key={cw.id || cw.uuid} value={cw.uuid}>
                    📦 [互动课件] {cw.name}
                  </option>
                ))}
              </select>

              {/* 上传新课件按钮 */}
              <label
                className={`px-3 py-2 text-xs rounded-xl border border-primary-theme/30 bg-primary-theme/5 hover:bg-primary-theme/10 text-primary-theme font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                  isUploading ? 'opacity-50 pointer-events-none' : ''
                }`}
                title="上传本地互动课件包 (.zip / .html)"
              >
                {isUploading ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Upload size={13} />
                )}
                <span>{isUploading ? '正在上传...' : '上传新课件'}</span>
                <input
                  type="file"
                  accept=".zip,.html,.htm"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadCourseware(f);
                  }}
                />
              </label>
            </div>

            {uploadError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* 当无课件 UUID 时展示手写 HTML / JS 代码框 */}
            {!coursewareUuid && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-2xs text-muted flex items-center gap-1 font-semibold">
                    <Code size={12} />
                    自定义沙箱代码 (HTML / JavaScript):
                  </span>
                  <span className="text-2xs text-muted/80">已自动注入 LMS Bridge SDK</span>
                </div>
                <textarea
                  rows={5}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="<!DOCTYPE html><html><body><h1>互动演示</h1>...</body></html>"
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-secondary/70 border border-theme rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-theme text-main"
                />
              </div>
            )}
          </div>

          {/* 4. 核心保护开关：仅本次课堂临时生效 vs 同步更新原课程设置 */}
          <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isTemporary}
                onChange={(e) => setIsTemporary(e.target.checked)}
                className="mt-0.5 rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-emerald-600" />
                  仅在本次课堂临时生效（推荐，不覆盖课程设置中的课件内容）
                </span>
                <p className="text-2xs text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                  {isTemporary
                    ? '当前修改仅即时同步给本堂课的学生设备，不会修改原教案数据库，其他平行班级复用不受影响。'
                    : '警告：已取消临时保护，点击应用后将直接持久化更新原课程教案中的课件配置！'}
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* 底部按钮栏 */}
        <div className="px-5 py-3 border-t border-theme bg-surface-secondary/30 flex items-center justify-between">
          <span className="text-xs text-muted">
            {isTemporary ? '⚡ 即时生效，安全无污染' : '💾 将同步写回课程数据库'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-muted hover:text-main hover:bg-surface-secondary border border-transparent transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-primary-theme hover:bg-primary-theme/90 text-white shadow-sm flex items-center gap-1.5 transition-transform active:scale-95 cursor-pointer"
            >
              <Save size={13} />
              <span>{isTemporary ? '临时应用至本课' : '保存并更新课程'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
