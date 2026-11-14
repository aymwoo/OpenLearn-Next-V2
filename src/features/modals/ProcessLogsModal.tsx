import React from 'react';
import { Terminal } from 'lucide-react';
import AccessibleDialog from '../../components/AccessibleDialog';

interface ProcessLogsModalProps {
  showProcessLogs: string | null;
  setShowProcessLogs: (v: string | null) => void;
  processLogsContent: string;
  t: any;
}

export function ProcessLogsModal({
  showProcessLogs,
  setShowProcessLogs,
  processLogsContent,
  t,
}: ProcessLogsModalProps) {
  if (!showProcessLogs) return null;
  return (
    <AccessibleDialog
      open={Boolean(showProcessLogs)}
      onClose={() => setShowProcessLogs(null)}
      ariaLabelledBy="process-logs-dialog-title"
      closedBy="any"
      className="bg-white rounded-xl shadow-xl max-w-2xl max-h-[90vh]"
    >
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <h2 id="process-logs-dialog-title" className="font-semibold text-gray-800 flex items-center gap-2">
          <Terminal size={18} className="text-gray-600" />
          {(t as any).processLogsTitle || 'Process Logs'}
        </h2>
        <button
          type="button"
          onClick={() => setShowProcessLogs(null)}
          aria-label="Close process logs"
          className="text-gray-400 hover:text-gray-600 font-bold px-2 cursor-pointer"
        >
          &times;
        </button>
      </div>
      <div className="p-4 flex-1 overflow-auto bg-gray-900 m-4 rounded flex flex-col">
        <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap">
          {processLogsContent || 'No logs generated.'}
        </pre>
      </div>
    </AccessibleDialog>
  );
}
