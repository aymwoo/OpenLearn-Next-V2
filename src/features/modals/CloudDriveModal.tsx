import React from 'react';
import { Folder, FileIcon, X, ChevronRight } from 'lucide-react';
import { LazyCourseware } from '../../components/LazyCourseware';
import Markdown from 'react-markdown';
import type { VFSNode } from '../../store/appStore';

interface CloudDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  vfsNodes: VFSNode[];
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  cloudDrivePreviewNode: { id: string; name: string; content: string } | null;
  setCloudDrivePreviewNode: (node: { id: string; name: string; content: string } | null) => void;
}

export function CloudDriveModal({
  isOpen, onClose, vfsNodes, currentVfsParent, setCurrentVfsParent,
  cloudDrivePreviewNode, setCloudDrivePreviewNode,
}: CloudDriveModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
          <div className="flex items-center gap-3">
            <Folder size={20} className="text-indigo-600" />
            <h2 className="font-semibold text-gray-800 text-lg">Cloud Course Resource Browser</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 font-bold p-1 hover:bg-gray-200 rounded transition-colors">&times;</button>
        </div>
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar (Directories) */}
          <div className="w-64 border-r border-gray-100 flex flex-col bg-gray-50">
            <div className="p-3 border-b border-gray-200 flex items-center gap-2">
              <button
                onClick={() => { setCurrentVfsParent(null); setCloudDrivePreviewNode(null); }}
                className={`text-sm font-medium w-full text-left flex items-center gap-2 p-2 rounded ${currentVfsParent === null ? 'bg-indigo-100 text-indigo-800' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                <Folder size={16} /> Data Root
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {currentVfsParent && (
                <button onClick={() => setCurrentVfsParent(null)} className="flex items-center gap-2 p-2 text-xs text-indigo-600 w-full hover:bg-gray-200 rounded mb-2 font-medium">
                  <ChevronRight className="rotate-180" size={14} /> Back to Root
                </button>
              )}
              <div className="text-xs uppercase font-semibold text-gray-400 px-2 py-1 mb-1">Current Path Nodes</div>
              {vfsNodes.filter(n => n.type === 'dir').map(node => (
                <button
                  key={node.id}
                  onClick={() => { setCurrentVfsParent(node.id); setCloudDrivePreviewNode(null); }}
                  className="w-full text-left p-2 rounded text-sm text-gray-700 hover:bg-gray-200 flex items-center gap-2 group mb-1"
                >
                  <Folder size={14} className="text-indigo-400 group-hover:text-indigo-600" />
                  <span className="truncate">{node.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col bg-white">
            {cloudDrivePreviewNode ? (
              <div className="flex-1 flex flex-col h-full min-h-0">
                <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
                  <button onClick={() => setCloudDrivePreviewNode(null)} className="text-gray-500 hover:text-gray-700"><X size={16} /></button>
                  <span className="text-sm font-medium text-gray-700">Previewing: {cloudDrivePreviewNode.name}</span>
                </div>
                {cloudDrivePreviewNode.name.endsWith('.html') || cloudDrivePreviewNode.name.endsWith('.htm') || cloudDrivePreviewNode.content?.includes('<html') ? (
                  <div className="flex-1 relative bg-gray-50">
                    <LazyCourseware coursewareId={cloudDrivePreviewNode.id} />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-6 bg-white prose prose-sm max-w-none">
                    <Markdown>{cloudDrivePreviewNode.content}</Markdown>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 p-6 overflow-y-auto">
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {vfsNodes.length === 0 && (
                    <div className="col-span-full h-32 flex items-center justify-center text-sm text-gray-400 italic">This directory is empty.</div>
                  )}
                  {vfsNodes.map(node => (
                    <div
                      key={node.id}
                      onClick={() => {
                        if (node.type === 'dir') {
                          setCurrentVfsParent(node.id);
                        } else {
                          setCloudDrivePreviewNode({ id: node.id, name: node.name, content: node.content || '*(Empty file)*' });
                        }
                      }}
                      className="border border-gray-200 hover:border-indigo-300 hover:shadow-md cursor-pointer rounded-xl p-4 flex flex-col gap-3 transition-all bg-white"
                    >
                      <div className="p-3 rounded-xl w-12 h-12 flex items-center justify-center shrink-0 shadow-sm bg-gray-50 border border-gray-100">
                        {node.type === 'dir' ? <Folder size={24} className="text-indigo-500" /> : <FileIcon size={24} className="text-gray-500" />}
                      </div>
                      <div className="text-sm font-medium text-gray-800 break-words">{node.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
