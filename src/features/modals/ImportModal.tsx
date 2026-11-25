import React from 'react';
import { Upload, Download, FileIcon, Check, Loader2 } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';

interface ImportModalProps {
  show: boolean;
  onClose: () => void;
  lang: string;
  handleImportFile: (file: File) => Promise<void> | void;
  importError: string | null;
  importSuccess: string | null;
  isImporting: boolean;
  downloadCSVTemplate: (type: 'class' | 'student') => void;
}

export function ImportModal({
  show,
  onClose,
  lang,
  handleImportFile,
  importError,
  importSuccess,
  isImporting,
  downloadCSVTemplate,
}: ImportModalProps) {
  if (!show) return null;
  return (
    <AccessibleDialog
      open={show}
      onClose={onClose}
      ariaLabelledBy="import-modal-title"
      closedBy={isImporting ? 'none' : 'any'}
      className="max-w-lg"
    >
      <DialogHeader>
        <DialogTitle
          id="import-modal-title"
          icon={<Upload size={18} />}
          description={
            lang === 'zh'
              ? '支持导入 CSV 或 JSON 文件。CSV 文件需包含标题行（支持中英文标题），仅「学生姓名」为必填，其余列可选：'
              : 'Supports CSV or JSON files. Only "Student Name" is required; all other columns are optional:'
          }
        >
          {lang === 'zh' ? '手动批量导入数据' : 'Manual Bulk Import'}
        </DialogTitle>
        <DialogCloseButton
          label={lang === 'zh' ? '关闭弹窗' : 'Close dialog'}
          onClick={onClose}
          disabled={isImporting}
        />
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="rounded-lg border border-theme bg-surface-secondary p-3 font-mono text-xs leading-relaxed text-muted whitespace-pre overflow-x-auto select-all">
          {lang === 'zh'
            ? '班级名称, 班级描述, 学生学号, 学生姓名, 学生邮箱, 初始密码, 学生备注, 性别\n高一A班, 基础英语课程, 20260101, 李明, liming@example.com, , 数学较弱, 男'
            : 'Class Name, Class Desc, Student Number, Student Name, Student Email, Initial Password, Student Notes, Gender\nClass 101, Introduction to English, 20260101, John Doe, john@example.com, , , Male'}
        </div>

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          {lang === 'zh' ? (
            <>
              <li>
                <strong className="text-main">学号</strong>：学生登录账号。留空则自动生成； 已存在同
                <strong className="text-main">邮箱</strong>或同学号的学生会被识别为同一人，不会重复建档。
              </li>
              <li>
                <strong className="text-main">初始密码</strong>：留空则系统生成 12 位随机密码，
                并在导入成功提示中列出「学号 / 姓名 / 密码」供你分发（仅显示一次，请及时保存）。
              </li>
              <li>
                <strong className="text-main">学生备注</strong>：仅本平台教师可见的私有备注。
              </li>
              <li>
                <strong className="text-main">性别</strong>：选填（男/女 或
                male/female）。用于课堂头像按性别呈现，留空则显示中性人像。
              </li>
            </>
          ) : (
            <>
              <li>
                <strong className="text-main">Student Number</strong> is the login account. Auto-generated if blank;
                students already matching by <strong className="text-main">email</strong> or student number are reused
                instead of duplicated.
              </li>
              <li>
                <strong className="text-main">Initial Password</strong>: leave blank and a 12-character random password
                is generated and listed once in the success message for you to distribute.
              </li>
              <li>
                <strong className="text-main">Student Notes</strong> is a teacher-only private note.
              </li>
              <li>
                <strong className="text-main">Gender</strong>: optional (Male/Female or 男/女). Used for student avatar
                rendering in classroom focus monitor; defaults to neutral avatar if blank.
              </li>
            </>
          )}
        </ul>

        <div className="flex flex-col gap-2 rounded-lg border border-primary-theme/30 bg-primary-theme-light p-3 select-none">
          <span className="flex items-center gap-1 text-xs font-semibold text-main">
            <Download size={13} className="text-primary-ink" />
            {lang === 'zh' ? '下载导入数据模板文件：' : 'Download Import Templates:'}
          </span>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <DialogButton variant="secondary" className="flex-1" onClick={() => downloadCSVTemplate('class')}>
              <FileIcon size={12} className="text-emerald-600 dark:text-emerald-400" />
              {lang === 'zh' ? '下载班级与学生模板' : 'Class & Students Template'}
            </DialogButton>
            <DialogButton variant="secondary" className="flex-1" onClick={() => downloadCSVTemplate('student')}>
              <FileIcon size={12} className="text-emerald-600 dark:text-emerald-400" />
              {lang === 'zh' ? '下载独立学生模板' : 'Independent Students Template'}
            </DialogButton>
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
            handleImportFile(e.dataTransfer.files[0]);
          }}
          className="cursor-pointer rounded-xl border-2 border-dashed border-theme p-8 text-center transition-all hover:border-primary-theme hover:bg-primary-theme-light/40"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,.json';
            input.onchange = (e: any) => {
              if (e.target.files?.[0]) handleImportFile(e.target.files[0]);
            };
            input.click();
          }}
        >
          <Upload className="mx-auto mb-2 text-subtle" size={24} />
          <p className="text-xs font-semibold text-main">
            {lang === 'zh' ? '点击选择文件 或 拖拽文件到这里' : 'Click to select file or drag it here'}
          </p>
          <p className="mt-1 text-xs text-subtle">CSV or JSON (max 5MB)</p>
        </div>

        {importError && (
          <div className="flex max-h-32 items-start gap-2 overflow-y-auto rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
            <span className="shrink-0 font-bold">✕</span>
            <span className="break-all text-left leading-tight">{importError}</span>
          </div>
        )}
        {importSuccess && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
            <Check size={14} className="mt-0.5 shrink-0" />
            <span className="text-left leading-tight">{importSuccess}</span>
          </div>
        )}
        {isImporting && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-primary-ink">
            <Loader2 size={16} className="animate-spin" />
            <span>
              {lang === 'zh' ? '正在分析数据并导入系统数据库...' : 'Validating data and transferring records...'}
            </span>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <DialogButton variant="secondary" onClick={onClose} disabled={isImporting}>
          {lang === 'zh' ? '关闭' : 'Close'}
        </DialogButton>
      </DialogFooter>
    </AccessibleDialog>
  );
}
