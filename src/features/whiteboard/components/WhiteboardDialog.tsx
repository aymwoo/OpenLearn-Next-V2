import React from 'react';

export interface WhiteboardDialogData {
  type?: 'alert' | 'prompt' | 'confirm';
  title: string;
  message: string;
  placeholder?: string;
  onConfirm: (inputValue: string) => Promise<void> | void;
}

export interface WhiteboardDialogProps {
  dialog: WhiteboardDialogData | null;
  dialogInput: string;
  setDialogInput: (input: string) => void;
  setDialog: (dialog: WhiteboardDialogData | null) => void;
}

export const WhiteboardDialog: React.FC<WhiteboardDialogProps> = ({
  dialog,
  dialogInput,
  setDialogInput,
  setDialog
}) => {
  if (!dialog) return null;

  return (
    <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4 font-sans">
      <div className="bg-white rounded-xl shadow-2xl overflow-hidden max-w-sm w-full border border-gray-100 flex flex-col scale-100 pointer-events-auto">
        <div className="px-5 py-4 border-b border-gray-150/60 bg-gray-50 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-gray-800 text-sm">{dialog.title}</h3>
          <button onClick={() => setDialog(null)} className="text-gray-400 hover:text-gray-650 transition-colors text-xl font-light cursor-pointer">×</button>
        </div>
        <div className="p-5 flex-1 min-h-0">
          <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap mb-4 font-medium">{dialog.message}</p>
          {dialog.type === 'prompt' && (
            <textarea
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              placeholder={dialog.placeholder}
              className="w-full h-32 p-3 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 focus:bg-white transition-all resize-none font-medium"
              onPointerDown={(e) => e.stopPropagation()}
            />
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2 text-xs shrink-0">
          {dialog.type !== 'alert' && (
            <button
              onClick={() => setDialog(null)}
              className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors font-medium border border-gray-200 cursor-pointer"
            >
              取消
            </button>
          )}
          <button
            onClick={async () => {
              try {
                await dialog.onConfirm(dialogInput);
              } catch (e) {
                console.error("Dialog action error:", e);
              }
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-all shadow-sm cursor-pointer"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
};
