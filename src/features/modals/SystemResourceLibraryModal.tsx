import { Dispatch, SetStateAction } from 'react';
import { Globe, Folder, Trash2 } from 'lucide-react';
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
    <>
      {isSystemResourceLibraryOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 shrink-0 flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Globe size={20} className="text-emerald-500 animate-pulse" />
                <h2 className="font-semibold text-gray-800 text-lg">
                  {lang === 'zh' ? '系统资源库与应用商城' : 'System Resource Library'}
                </h2>

                {/* Sub-category Tabs */}
                <div className="flex items-center gap-1 bg-slate-200/80 p-0.5 rounded-xl border border-slate-300/60 shadow-3xs ml-2">
                  <button
                    onClick={() => setSystemResourceTab('system')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                      systemResourceTab === 'system'
                        ? 'bg-white text-emerald-800 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Globe size={13} className="text-emerald-500" />
                    <span>{lang === 'zh' ? '互动课件与系统资源' : 'System Resources'}</span>
                  </button>
                  <button
                    onClick={() => setSystemResourceTab('cloud')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                      systemResourceTab === 'cloud'
                        ? 'bg-white text-indigo-800 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Folder size={13} className="text-indigo-500" />
                    <span>{lang === 'zh' ? '云端课程资源 (Cloud Drive)' : 'Cloud Course Resource'}</span>
                  </button>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsSystemResourceLibraryOpen(false);
                  setSelectedLibraryResourceId(null);
                }}
                className="text-gray-400 hover:text-gray-600 font-bold p-1 overflow-hidden hover:bg-gray-200 rounded transition-colors text-lg inline-flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                &times;
              </button>
            </div>

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
              <div className="w-80 border-r border-gray-100 bg-slate-50 flex flex-col shrink-0">

                {/* Upload Buttons */}
                <div className="p-4 border-b border-gray-200 bg-white space-y-2">
                  <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    {lang === 'zh' ? '上传新资源' : 'Upload New Resource'}
                  </span>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Single File */}
                    <label className="flex flex-col items-center justify-center p-3 bg-slate-50 hover:bg-indigo-50 border border-dashed border-gray-300 hover:border-indigo-400 rounded-xl cursor-pointer text-center transition-all group">
                      <span className="text-lg mb-1 group-hover:scale-110 transition-transform">📄</span>
                      <span className="font-bold text-indigo-600 text-[10px] break-all leading-tight">
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
                                  content: text
                                })
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
                    <label className="flex flex-col items-center justify-center p-3 bg-slate-50 hover:bg-teal-50 border border-dashed border-gray-300 hover:border-teal-400 rounded-xl cursor-pointer text-center transition-all group">
                      <span className="text-lg mb-1 group-hover:scale-110 transition-transform">📁</span>
                      <span className="font-bold text-teal-600 text-[10px] break-all leading-tight">
                        {lang === 'zh' ? '完整文件夹' : 'Directory Folder'}
                      </span>
                      <input
                        type="file"
                        {...{
                          webkitdirectory: "",
                          directory: "",
                        } as any}
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
                                  content: content
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
                                content: JSON.stringify(filesToUpload)
                              })
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
                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
                    {lang === 'zh' ? '当前已存储的资源' : 'Stored Resources'}
                  </span>

                  {loadingLibraryResources && (
                    <div className="text-center py-8 text-xs text-slate-400">Loading resources...</div>
                  )}

                  {!loadingLibraryResources && libraryResources.length === 0 && (
                    <div className="text-center py-12 text-xs text-slate-400 italic">
                      {lang === 'zh' ? '暂无资源，支持拖入或上传文件。' : 'No resources in library. Upload some above!'}
                    </div>
                  )}

                  {libraryResources.map(resObj => {
                    const isActive = selectedLibraryResourceId === resObj.id;
                    return (
                      <div
                        key={resObj.id}
                        onClick={() => setSelectedLibraryResourceId(resObj.id)}
                        className={`p-2.5 rounded-xl border flex justify-between items-center cursor-pointer transition-all ${
                          isActive
                            ? 'bg-indigo-50 border-indigo-200 shadow-xs'
                            : 'bg-white border-slate-100 hover:border-slate-200 hover:shadow-2xs'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base select-none">
                            {resObj.type === 'folder' ? '📁' : '📄'}
                          </span>
                          <div className="text-left min-w-0">
                            <div className="text-xs font-semibold text-gray-700 truncate font-sans" title={resObj.name}>
                              {resObj.name}
                            </div>
                            <div className="text-[9px] text-gray-400 mt-0.5 font-mono">
                              {new Date(resObj.created_at).toLocaleDateString()} • {resObj.id}
                            </div>
                          </div>
                        </div>

                        {/* Delete button */}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm(lang === 'zh' ? `确认删除资源 [${resObj.name}] 吗？` : `Delete resource [${resObj.name}]?`)) {
                              await fetch(`/api/resources/${resObj.id}`, { method: 'DELETE' });
                              if (selectedLibraryResourceId === resObj.id) {
                                setSelectedLibraryResourceId(null);
                              }
                              fetchLibraryResources();
                            }
                          }}
                          className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-md transition-colors cursor-pointer"
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
              <div className="flex-1 bg-white flex flex-col min-w-0">
                {selectedLibraryResourceId ? (
                  <div className="flex-1 flex flex-col h-full min-h-0">
                    <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-700 text-sm">
                          {lang === 'zh' ? '交互沙箱应用预览:' : 'Sandbox Live Preview:'}
                        </span>
                        <span className="text-xs bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded font-mono">
                          /api/resources/{selectedLibraryResourceId}/
                        </span>
                      </div>
                      <button
                        onClick={() => setSelectedLibraryResourceId(null)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
                      >
                        {lang === 'zh' ? '关闭预览' : 'Close Preview'}
                      </button>
                    </div>
                    <div className="flex-1 relative bg-slate-100/50">
                      <iframe
                        src={`/api/resources/${selectedLibraryResourceId}/`}
                        sandbox="allow-scripts"
                        className="w-full h-full border-none bg-white font-sans"
                        title="Interactive Resource Preview"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-gray-400 bg-slate-50/50">
                    <Globe size={48} className="text-gray-300 mb-3 opacity-60" />
                    <p className="text-sm font-semibold text-gray-600">
                      {lang === 'zh' ? '未选择资源进行预览' : 'No Resource Selected'}
                    </p>
                    <p className="text-xs text-center text-gray-400 mt-1 max-w-sm">
                      {lang === 'zh'
                        ? '请在左侧列表中点击选择要预览/管理的 HTML 单文件或完整 applet 文件夹，右侧即可进行沙箱实时运行。'
                        : 'Click any resource in the list on the left to preview its interactive live sandbox iframe here.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </>
  );
}
