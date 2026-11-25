/**
 * 作业附件预览对话框。
 *
 * ## 覆盖的边界
 *
 * 宿主**内置**四种预览形态，其余一律交给扩展插槽：
 *
 * | 文件类型 | 渲染方式 |
 * |---|---|
 * | 图片（png/jpg/gif/webp/bmp/svg/heic） | `<img>` |
 * | PDF | `<iframe>`（服务端以 inline 返回，浏览器内置查看器渲染） |
 * | 纯文本 / 代码 / 数据（txt/md/csv/json/xml/html/css/各类源码） | `<pre>`，**按文本渲染，绝不解析成 HTML** |
 * | 其它（docx/pptx/xlsx/zip/rtf…） | 不内置解析 —— 给出「暂不支持预览」+ 下载，并展示**扩展插槽**里声明能处理该类型的插件入口 |
 *
 * 不内置解析 docx/pptx/xlsx 是有意的：那类解析要么引入重依赖，要么自己写
 * OOXML 解析器（既是安全面也是维护面）。插件插槽就是为此准备的扩展点 ——
 * 平台不猜，插件声明自己能处理什么类型。
 *
 * ## 安全口径
 *
 * - 所有内容都走**带鉴权**的 `/api/learning-surface-assignments/:assignmentId/files/:fileId`，
 *   不经过任何静态目录（`storage/` 从未被 `express.static` 暴露）。
 * - 文本内容以 `text/plain` 拉取并用 `<pre>` 渲染 —— 本组件**不做**任何原始 HTML
 *   注入（React 的 innerHTML 类 API 一次都不出现），学生上传的 `.html` 文件
 *   只是被当作文本显示。
 * - 服务端对不可内联的类型（text/html、image/svg+xml 等）强制下载，
 *   预览组件的 inline URL 因此不会把可执行文档变成同源页面。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileText, Loader2 } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './AccessibleDialog';
import { ExtensionPointRenderer } from '../plugin-host/extension-point-renderer';
import { usePluginHostStore } from '../plugin-host/plugin-host-store';
import { readOptionalString, readSlotRecord, readStringList } from '../plugin-host/read-slot-props';
import { frontendApi } from '../services/frontend-api';
import { uiStore } from '../store/uiStore';
import {
  matchesDeclaredExtension,
  resolvePreviewStrategy,
  TEXT_PREVIEW_MAX_BYTES,
} from '../../packages/core/assignment/file-preview-policy.js';

/** 预览对话框接受的最小文件描述。 */
export interface AssignmentFilePreviewFile {
  id: string;
  /** 原始文件名（`plugin_assignment_files.original_name`）。 */
  original_name?: string | null;
  /** 兼容另一种字段名（提交版本快照里用的是 `name`）。 */
  name?: string | null;
  size?: number | null;
  mime?: string | null;
}

export interface AssignmentFilePreviewProps {
  assignmentId: string;
  file: AssignmentFilePreviewFile;
  onClose: () => void;
  lang?: 'zh' | 'en';
}

function formatBytes(size: number | null | undefined): string {
  if (!size || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const AssignmentFilePreview: React.FC<AssignmentFilePreviewProps> = ({
  assignmentId,
  file,
  onClose,
  lang = 'zh',
}) => {
  const zh = lang === 'zh';
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  const fileName = file.original_name || file.name || 'attachment';
  const strategy = useMemo(() => resolvePreviewStrategy({ name: fileName }), [fileName]);

  const baseUrl = `/api/learning-surface-assignments/${encodeURIComponent(assignmentId)}/files/${encodeURIComponent(file.id)}`;
  const inlineUrl = `${baseUrl}?disposition=inline`;
  const downloadUrl = baseUrl;

  // 文本预览：按 text/plain 拉取（服务端对文本类一律返回 text/plain），
  // 截断到上限，避免一次把 50MB 文件读进内存。
  useEffect(() => {
    if (strategy.kind !== 'text') return;
    let cancelled = false;
    setTextLoading(true);
    setTextError(null);
    fetch(inlineUrl, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.text();
        return raw.length > TEXT_PREVIEW_MAX_BYTES
          ? `${raw.slice(0, TEXT_PREVIEW_MAX_BYTES)}\n\n…（内容过长，已截断）`
          : raw;
      })
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch((err) => {
        if (!cancelled) setTextError(err?.message || 'Failed to load preview');
      })
      .finally(() => {
        if (!cancelled) setTextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inlineUrl, strategy.kind]);

  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 扩展插槽：声明能处理当前文件类型的插件（数据型贡献 —— 远程插件不能带 React 组件）。
  const extensionPoints = usePluginHostStore((s) => s.extensionPoints);
  const slotContributions = useMemo(() => {
    const list = extensionPoints.get('assignment.file.preview') ?? [];
    return list.filter((ext) => {
      const cfg = readSlotRecord(ext.slotProps);
      const declaredExtensions = readStringList(cfg.extensions) ?? [];
      if (matchesDeclaredExtension(declaredExtensions, strategy.extension)) return true;
      const declaredMimes = (readStringList(cfg.mimeTypes) ?? []).map((m) => m.toLowerCase());
      return declaredMimes.includes(strategy.contentType);
    });
  }, [extensionPoints, strategy.extension, strategy.contentType]);

  const runPluginCommand = async (extId: string) => {
    const ext = slotContributions.find((item) => item.id === extId);
    if (!ext) return;
    const cfg = readSlotRecord(ext.slotProps);
    const commandType = readOptionalString(cfg, 'commandType');
    if (!commandType) return;
    const res = await frontendApi.post('/api/plugins/execute-command', {
      type: commandType,
      payload: {
        fileId: file.id,
        assignmentId,
        fileName,
        downloadUrl,
        inlineUrl,
      },
    });
    if (!res.success) {
      uiStore.getState().addToast({
        id: `file-preview-cmd-error-${Date.now()}`,
        type: 'error',
        title: zh ? '插件预览命令执行失败' : 'Plugin preview command failed',
        message: res.error || commandType,
      });
    }
  };

  const renderBody = () => {
    if (strategy.kind === 'image') {
      return (
        <img
          src={inlineUrl}
          alt={fileName}
          className="max-h-[68vh] w-auto max-w-full mx-auto rounded-lg bg-white/60"
          data-testid="assignment-file-preview-image"
        />
      );
    }
    if (strategy.kind === 'pdf') {
      return (
        <iframe
          src={inlineUrl}
          title={fileName}
          className="w-full h-[68vh] rounded-lg border border-theme bg-white"
          data-testid="assignment-file-preview-pdf"
        />
      );
    }
    if (strategy.kind === 'text') {
      if (textLoading) {
        return (
          <div className="flex items-center justify-center h-[40vh] gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" />
            {zh ? '正在加载预览…' : 'Loading preview…'}
          </div>
        );
      }
      if (textError) {
        return (
          <div className="flex items-center justify-center h-[40vh] gap-2 text-sm text-red-600">
            <AlertTriangle size={16} />
            {zh ? `预览失败：${textError}` : `Preview failed: ${textError}`}
          </div>
        );
      }
      return (
        <pre
          className="w-full max-h-[68vh] overflow-auto rounded-lg bg-slate-900/90 p-3 text-xs leading-relaxed text-slate-100 whitespace-pre-wrap break-all"
          data-testid="assignment-file-preview-text"
        >
          {text ?? ''}
        </pre>
      );
    }
    return (
      <div
        className="flex flex-col items-center justify-center h-[40vh] gap-3 text-center"
        data-testid="assignment-file-preview-unsupported"
      >
        <FileText size={32} className="text-muted" />
        <p className="text-sm text-muted">
          {zh
            ? `暂不支持预览 ${strategy.extension || '该'} 格式，可下载后查看`
            : `Preview for ${strategy.extension || 'this'} format is not supported yet — download to view`}
        </p>
        {slotContributions.length > 0 && (
          <p className="text-xs text-muted">{zh ? '或使用插件提供的预览器：' : 'Or use a plugin previewer:'}</p>
        )}
      </div>
    );
  };

  return (
    <AccessibleDialog
      open
      onClose={onClose}
      ariaLabel={fileName}
      closedBy="any"
      className="max-w-4xl max-h-[88vh]"
      data-testid="assignment-file-preview"
    >
      <DialogHeader>
        <DialogTitle icon={<FileText size={16} />} description={formatBytes(file.size) || undefined}>
          {fileName}
        </DialogTitle>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={downloadUrl}
            className="flex items-center gap-1 rounded-lg border border-theme px-2 py-1 text-xs text-main hover:border-orange-300"
            title={zh ? '下载' : 'Download'}
          >
            <Download size={13} />
            {zh ? '下载' : 'Download'}
          </a>
          <DialogCloseButton label={zh ? '关闭' : 'Close'} onClick={onClose} />
        </div>
      </DialogHeader>

      <DialogBody className="p-4">{renderBody()}</DialogBody>

      {/* 文件级预览扩展插槽：插件声明能处理该类型时给出入口。
          数据型贡献（commandType）由本组件渲染按钮；父 realm 插件的自定义
          组件由 ExtensionPointRenderer 渲染（渲染器内部按扩展名过滤）。 */}
      {slotContributions.length > 0 && (
        <DialogFooter className="justify-start">
          <span className="text-xs text-muted">{zh ? '插件预览器：' : 'Plugin previewers:'}</span>
          {slotContributions.map((ext) => {
            const cfg = readSlotRecord(ext.slotProps);
            const commandType = readOptionalString(cfg, 'commandType');
            if (!commandType) return null;
            return (
              <button
                key={`${ext.pluginId}/${ext.id}`}
                onClick={() => void runPluginCommand(ext.id)}
                className="rounded-lg border border-theme px-2 py-1 text-xs text-main hover:border-orange-300"
                data-testid="assignment-file-preview-plugin"
              >
                {ext.label || readOptionalString(cfg, 'title') || ext.id}
              </button>
            );
          })}
          <ExtensionPointRenderer
            slot="assignment.file.preview"
            slotProps={{
              file: { id: file.id, name: fileName, size: file.size ?? null, mime: file.mime ?? null },
              fileExtension: strategy.extension,
              assignmentId,
              downloadUrl,
              inlineUrl,
              lang,
            }}
          />
        </DialogFooter>
      )}
    </AccessibleDialog>
  );
};

export default AssignmentFilePreview;
