import React from 'react';
import { Terminal } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';

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
      className="max-w-2xl max-h-[90vh]"
    >
      <DialogHeader>
        <DialogTitle id="process-logs-dialog-title" icon={<Terminal size={18} />}>
          {(t as any).processLogsTitle || 'Process Logs'}
        </DialogTitle>
        <DialogCloseButton label="Close process logs" onClick={() => setShowProcessLogs(null)} />
      </DialogHeader>
      <DialogBody className="flex flex-col">
        <div className="flex flex-1 flex-col overflow-auto rounded bg-gray-900 p-4">
          <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap">
            {processLogsContent || 'No logs generated.'}
          </pre>
        </div>
      </DialogBody>
    </AccessibleDialog>
  );
}
