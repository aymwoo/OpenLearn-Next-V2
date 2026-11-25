import React from 'react';
import { Folder, FileIcon, X, ChevronRight } from 'lucide-react';
import { LazyCourseware } from '../../components/LazyCourseware';
import AccessibleDialog, {
  DialogBody,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
import Markdown from 'react-markdown';
import type { VFSNode } from '../../store/appStore';

export interface CloudDrivePanelProps {
  vfsNodes: VFSNode[];
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  cloudDrivePreviewNode: { id: string; name: string; content: string } | null;
  setCloudDrivePreviewNode: (node: { id: string; name: string; content: string } | null) => void;
}

export function CloudDrivePanel({
  vfsNodes,
  currentVfsParent,
  setCurrentVfsParent,
  cloudDrivePreviewNode,
  setCloudDrivePreviewNode,
}: CloudDrivePanelProps) {
  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* Sidebar (Directories) */}
      <div className="w-64 border-r border-theme flex flex-col bg-surface-secondary shrink-0">
        <div className="p-3 border-b border-theme flex items-center gap-2">
          <button
            onClick={() => {
              setCurrentVfsParent(null);
              setCloudDrivePreviewNode(null);
            }}
            className={`text-sm font-medium w-full text-left flex items-center gap-2 p-2 rounded cursor-pointer ${currentVfsParent === null ? 'bg-primary-theme-light text-primary-ink font-bold' : 'text-muted hover:bg-surface'}`}
          >
            <Folder size={16} /> Data Root
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {currentVfsParent && (
            <button
              onClick={() => setCurrentVfsParent(null)}
              className="flex items-center gap-2 p-2 text-xs text-primary-ink w-full hover:bg-surface rounded mb-2 font-medium cursor-pointer"
            >
              <ChevronRight className="rotate-180" size={14} /> Back to Root
            </button>
          )}
          <div className="text-xs uppercase font-semibold text-subtle px-2 py-1 mb-1">Current Path Nodes</div>
          {vfsNodes
            .filter((n) => n.type === 'dir')
            .map((node) => (
              <button
                key={node.id}
                onClick={() => {
                  setCurrentVfsParent(node.id);
                  setCloudDrivePreviewNode(null);
                }}
                className="w-full text-left p-2 rounded text-sm text-main hover:bg-surface flex items-center gap-2 group mb-1 cursor-pointer"
              >
                <Folder size={14} className="text-primary-ink group-hover:text-primary-ink-hover" />
                <span className="truncate">{node.name}</span>
              </button>
            ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-surface overflow-hidden min-w-0">
        {cloudDrivePreviewNode ? (
          <div className="flex-1 flex flex-col h-full min-h-0">
            <div className="p-3 border-b border-theme bg-surface-secondary flex items-center gap-2 shrink-0">
              <button
                onClick={() => setCloudDrivePreviewNode(null)}
                className="text-muted hover:text-main cursor-pointer"
              >
                <X size={16} />
              </button>
              <span className="text-sm font-medium text-main">Previewing: {cloudDrivePreviewNode.name}</span>
            </div>
            {cloudDrivePreviewNode.name.endsWith('.html') ||
            cloudDrivePreviewNode.name.endsWith('.htm') ||
            cloudDrivePreviewNode.content?.includes('<html') ? (
              <div className="flex-1 relative bg-surface-secondary">
                <LazyCourseware coursewareId={cloudDrivePreviewNode.id} />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6 bg-surface prose prose-sm max-w-none">
                <Markdown>{cloudDrivePreviewNode.content}</Markdown>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {vfsNodes.length === 0 && (
                <div className="col-span-full h-32 flex items-center justify-center text-sm text-subtle italic">
                  This directory is empty.
                </div>
              )}
              {vfsNodes.map((node) => (
                <div
                  key={node.id}
                  onClick={() => {
                    if (node.type === 'dir') {
                      setCurrentVfsParent(node.id);
                    } else {
                      setCloudDrivePreviewNode({
                        id: node.id,
                        name: node.name,
                        content: node.content || '*(Empty file)*',
                      });
                    }
                  }}
                  className="border border-theme hover:border-primary-theme/30 hover:shadow-md cursor-pointer rounded-xl p-4 flex flex-col gap-3 transition-all bg-surface"
                >
                  <div className="p-3 rounded-xl w-12 h-12 flex items-center justify-center shrink-0 shadow-sm bg-surface-secondary border border-theme">
                    {node.type === 'dir' ? (
                      <Folder size={24} className="text-primary-ink" />
                    ) : (
                      <FileIcon size={24} className="text-muted" />
                    )}
                  </div>
                  <div className="text-sm font-medium text-main break-words">{node.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface CloudDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  vfsNodes: VFSNode[];
  currentVfsParent: string | null;
  setCurrentVfsParent: (id: string | null) => void;
  cloudDrivePreviewNode: { id: string; name: string; content: string } | null;
  setCloudDrivePreviewNode: (node: { id: string; name: string; content: string } | null) => void;
}

export function CloudDriveModal(props: CloudDriveModalProps) {
  if (!props.isOpen) return null;
  return (
    <AccessibleDialog
      open={props.isOpen}
      onClose={props.onClose}
      ariaLabelledBy="cloud-drive-dialog-title"
      closedBy="any"
      className="max-w-5xl h-[85vh] overflow-hidden"
    >
      <DialogHeader>
        <DialogTitle id="cloud-drive-dialog-title" icon={<Folder size={20} />}>
          Cloud Course Resource Browser
        </DialogTitle>
        <DialogCloseButton label="Close cloud resource browser" onClick={props.onClose} />
      </DialogHeader>
      <DialogBody className="p-0 flex flex-col overflow-hidden">
        <CloudDrivePanel {...props} />
      </DialogBody>
    </AccessibleDialog>
  );
}
