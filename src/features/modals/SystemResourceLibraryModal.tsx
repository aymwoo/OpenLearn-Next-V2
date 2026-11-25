import { Dispatch, SetStateAction } from 'react';
import { Globe, Folder, Trash2 } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
import type { VFSNode } from '../../types/app';
import { CloudDrivePanel } from './CloudDriveModal';

interface LibraryResource {
  id: string;
  name: string;
  type: string;
  content: string;
  created_at: string;
}

interface CloudDrivePreviewNode {
  id: string;
  name: string;
  content: string;
}

export interface SystemResourceLibraryModalProps {
  isSystemResourceLibraryOpen: boolean;
  setIsSystemResourceLibraryOpen: (v: boolean) => void;
  lang: 'zh' | 'en';
  systemResourceTab: 'system' | 'cloud';
  setSystemResourceTab: Dispatch<SetStateAction<'system' | 'cloud'>>;
  selectedLibraryResourceId: string | null;
  setSelectedLibraryResourceId: Dispatch<SetStateAction<string | null>>;
  vfsNodes: VFSNode[];
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  cloudDrivePreviewNode: CloudDrivePreviewNode | null;
  setCloudDrivePreviewNode: Dispatch<SetStateAction<CloudDrivePreviewNode | null>>;
  loadingLibraryResources: boolean;
  libraryResources: LibraryResource[];
  fetchLibraryResources: () => void;
}

export function SystemResourceLibraryModal(props: SystemResourceLibraryModalProps) {
  const {
    isSystemResourceLibraryOpen,
    setIsSystemResourceLibraryOpen,
    lang,
    systemResourceTab,
    setSystemResourceTab,
    selectedLibraryResourceId,
    setSelectedLibraryResourceId,
    vfsNodes,
    currentVfsParent,
    setCurrentVfsParent,
    cloudDrivePreviewNode,
    setCloudDrivePreviewNode,
    loadingLibraryResources,
    libraryResources,
    fetchLibraryResources,
  } = props;

  return (
    <AccessibleDialog
      open={isSystemResourceLibraryOpen}
      onClose={() => {
        setIsSystemResourceLibraryOpen(false);
        setSelectedLibraryResourceId(null);
      }}
      ariaLabelledBy="system-resource-library-dialog-title"
      closedBy="any"
      className="max-w-6xl h-[85vh]"
    >
      <DialogHeader className="flex-wrap">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <DialogTitle
            id="system-resource-library-dialog-title"
            icon={<Globe size={18} className="animate-pulse" />}
            iconVariant="success"
          >
            {lang === 'zh' ? '系统资源库与应用商城' : 'System Resource Library'}
          </DialogTitle>

          {/* Sub-category Tabs */}
          <div className="flex items-center gap-1 bg-surface-secondary p-0.5 rounded-xl border border-theme shadow-3xs ml-2">
            <button
              onClick={() => setSystemResourceTab('system')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                systemResourceTab === 'system'
                  ? 'bg-surface text-emerald-800 dark:text-emerald-400 shadow-2xs font-extrabold'
                  : 'text-muted hover:text-main'
              }`}
            >
              <Globe size={13} className="text-emerald-500" />
              <span>{lang === 'zh' ? '互动课件与系统资源' : 'System Resources'}</span>
            </button>
            <button
              onClick={() => setSystemResourceTab('cloud')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                systemResourceTab === 'cloud'
                  ? 'bg-surface text-primary-ink shadow-2xs font-extrabold'
                  : 'text-muted hover:text-main'
              }`}
            >
              <Folder size={13} className="text-primary-ink" />
              <span>{lang === 'zh' ? '云端课程资源 (Cloud Drive)' : 'Cloud Course Resource'}</span>
            </button>
          </div>
        </div>
        <DialogCloseButton
          label={lang === 'zh' ? '关闭弹窗' : 'Close dialog'}
          onClick={() => {
            setIsSystemResourceLibraryOpen(false);
            setSelectedLibraryResourceId(null);
          }}
        />
      </DialogHeader>

      <DialogBody className="p-0 flex overflow-hidden min-h-0">
        {systemResourceTab === 'cloud' ? (
          <CloudDrivePanel
            vfsNodes={vfsNodes}
            currentVfsParent={currentVfsParent}
            setCurrentVfsParent={setCurrentVfsParent}
            cloudDrivePreviewNode={cloudDrivePreviewNode}
            setCloudDrivePreviewNode={setCloudDrivePreviewNode}
          />
        ) : (
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Left Pane - Upload controls & Resource list */}
            <div className="w-80 border-r border-theme bg-surface-secondary flex flex-col shrink-0">
              {/* Upload Buttons */}
              <div className="p-4 border-b border-theme bg-surface space-y-2">
                <span className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                  {lang === 'zh' ? '上传新资源' : 'Upload New Resource'}
                </span>

                <div className="grid grid-cols-2 gap-2">
                  {/* Single File */}
                  <label className="flex flex-col items-center justify-center p-3 bg-surface-secondary hover:bg-primary-theme-light border border-dashed border-theme hover:border-primary-theme rounded-xl cursor-pointer text-center transition-all group">
                    <span className="text-lg mb-1 group-hover:scale-110 transition-transform">📄</span>
                    <span className="font-bold text-primary-ink text-xs break-all leading-tight">
                      {lang === 'zh' ? '单HTML文件' : 'Single HTML'}
                    </span>
                    <input
                      type="file"
                      accept=".html,.htm"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async (event) => {
                          const text = event.target?.result as string;
                          try {
                            const res = await fetch('/api/resources', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: file.name,
                                type: 'html',
                                content: text,
                              }),
                            });
                            if (res.ok) {
                              fetchLibraryResources();
                            }
                          } catch (err) {
                            console.error('Library upload failed:', err);
                          }
                        };
                        reader.readAsText(file);
                      }}
                    />
                  </label>

                  {/* Folder */}
                  <label className="flex flex-col items-center justify-center p-3 bg-surface-secondary hover:bg-teal-500/10 border border-dashed border-theme hover:border-teal-500/40 rounded-xl cursor-pointer text-center transition-all group">
                    <span className="text-lg mb-1 group-hover:scale-110 transition-transform">📁</span>
                    <span className="font-bold text-teal-600 dark:text-teal-400 text-xs break-all leading-tight">
                      {lang === 'zh' ? '完整文件夹' : 'Directory Folder'}
                    </span>
                    <input
                      type="file"
                      {...({
                        webkitdirectory: '',
                        directory: '',
                      } as any)}
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;

                        const filesToUpload: { path: string; content: string }[] = [];
                        let folderName = '';

                        for (let i = 0; i < files.length; i++) {
                          const file = files[i];
                          const relPath = file.webkitRelativePath || file.name;
                          if (!folderName) {
                            folderName = relPath.split('/')[0] || 'library_resource';
                          }

                          const ext = file.name.split('.').pop()?.toLowerCase();
                          const isBinary = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext || '');

                          await new Promise<void>((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                              const content = evt.target?.result as string;
                              filesToUpload.push({
                                path: relPath,
                                content: content,
                              });
                              resolve();
                            };
                            if (isBinary) {
                              reader.readAsDataURL(file);
                            } else {
                              reader.readAsText(file);
                            }
                          });
                        }

                        try {
                          const res = await fetch('/api/resources', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              name: folderName,
                              type: 'folder',
                              content: JSON.stringify(filesToUpload),
                            }),
                          });
                          if (res.ok) {
                            fetchLibraryResources();
                          }
                        } catch (err) {
                          console.error('Folder upload failed:', err);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Resource List Items */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <span className="block text-xs font-bold text-subtle uppercase tracking-widest pl-1">
                  {lang === 'zh' ? '当前已存储的资源' : 'Stored Resources'}
                </span>

                {loadingLibraryResources && (
                  <div className="text-center py-8 text-xs text-subtle">Loading resources...</div>
                )}

                {!loadingLibraryResources && libraryResources.length === 0 && (
                  <div className="text-center py-12 text-xs text-subtle italic">
                    {lang === 'zh' ? '暂无资源，支持拖入或上传文件。' : 'No resources in library. Upload some above!'}
                  </div>
                )}

                {libraryResources.map((resObj) => {
                  const isActive = selectedLibraryResourceId === resObj.id;
                  return (
                    <div
                      key={resObj.id}
                      onClick={() => setSelectedLibraryResourceId(resObj.id)}
                      className={`p-2.5 rounded-xl border flex justify-between items-center cursor-pointer transition-all ${
                        isActive
                          ? 'bg-primary-theme-light border-primary-theme/30 shadow-xs'
                          : 'bg-surface border-theme hover:border-primary-theme/30 hover:shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-base select-none">{resObj.type === 'folder' ? '📁' : '📄'}</span>
                        <div className="text-left min-w-0">
                          <div className="text-xs font-semibold text-main truncate font-sans" title={resObj.name}>
                            {resObj.name}
                          </div>
                          <div className="text-xs text-subtle mt-0.5 font-mono">
                            {new Date(resObj.created_at).toLocaleDateString()} • {resObj.id}
                          </div>
                        </div>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (
                            confirm(
                              lang === 'zh'
                                ? `确认删除资源 [${resObj.name}] 吗？`
                                : `Delete resource [${resObj.name}]?`,
                            )
                          ) {
                            await fetch(`/api/resources/${resObj.id}`, { method: 'DELETE' });
                            if (selectedLibraryResourceId === resObj.id) {
                              setSelectedLibraryResourceId(null);
                            }
                            fetchLibraryResources();
                          }
                        }}
                        className="p-1 hover:bg-red-500/10 text-subtle hover:text-red-500 dark:hover:text-red-400 rounded-md transition-colors cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 size={12} className="shrink-0" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Pane - Active Preview Frame */}
            <div className="flex-1 bg-surface flex flex-col min-w-0">
              {selectedLibraryResourceId ? (
                <div className="flex-1 flex flex-col h-full min-h-0">
                  <div className="p-3 border-b border-theme bg-surface-secondary flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-main text-sm">
                        {lang === 'zh' ? '交互沙箱应用预览:' : 'Sandbox Live Preview:'}
                      </span>
                      <span className="text-xs bg-surface text-muted px-2 py-0.5 rounded font-mono">
                        /api/resources/{selectedLibraryResourceId}/
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedLibraryResourceId(null)}
                      className="text-xs text-primary-ink hover:text-primary-ink-hover font-medium cursor-pointer"
                    >
                      {lang === 'zh' ? '关闭预览' : 'Close Preview'}
                    </button>
                  </div>
                  <div className="flex-1 relative bg-surface-secondary/50">
                    <iframe
                      src={`/api/resources/${selectedLibraryResourceId}/`}
                      sandbox="allow-scripts"
                      data-lms-bridge="true"
                      className="w-full h-full border-none bg-surface font-sans"
                      title="Interactive Resource Preview"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-subtle bg-surface-secondary/50">
                  <Globe size={48} className="text-subtle mb-3 opacity-60" />
                  <p className="text-sm font-semibold text-muted">
                    {lang === 'zh' ? '未选择资源进行预览' : 'No Resource Selected'}
                  </p>
                  <p className="text-xs text-center text-subtle mt-1 max-w-sm">
                    {lang === 'zh'
                      ? '请在左侧列表中点击选择要预览/管理的 HTML 单文件或完整 applet 文件夹，右侧即可进行沙箱实时运行。'
                      : 'Click any resource in the list on the left to preview its interactive live sandbox iframe here.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogBody>
    </AccessibleDialog>
  );
}
