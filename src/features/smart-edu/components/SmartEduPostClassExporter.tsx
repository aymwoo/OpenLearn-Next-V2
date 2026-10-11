import React, { useState } from 'react';
import { Download, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react';
import type { ClassroomPostClassExporterSlotProps } from '../../../plugin-host/types';

/**
 * CELTS-3 学情归档包导出 —— 只导出宿主提供的真实统计。
 *
 * v0.6.0 审计 R-7：此前字段全部 miss 时回退硬编码 '100%'/36/88.5/18，
 * 以 CELTS-3 名义导出编造指标。现在：宿主未提供的指标一律导出 null
 * 并在 dataCompleteness 中显式标注缺失，绝不编造。
 */
export function SmartEduPostClassExporter({ lessonId, summaryData, lang = 'zh' }: ClassroomPostClassExporterSlotProps) {
  const [exporting, setExporting] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const zh = lang === 'zh';

  const handleExport = async () => {
    try {
      setExporting(true);
      const attemptsCount = summaryData?.attemptsCount;
      const exitTicket = summaryData?.exitTicketStats;

      const celtsReport = {
        meta: {
          standard: 'CELTS-3 (教育部基础教育学情采集标准)',
          platform: '国家智慧教育公共服务平台 (smartedu.cn)',
          generatedAt: new Date().toISOString(),
          lessonId: lessonId ?? null,
          lessonTitle: summaryData?.lessonTitle ?? null,
          className: summaryData?.className ?? null,
        },
        classroomMetrics: {
          // 真实统计：随堂提交份数与结课通票（有则填，无则显式 null）
          submissionCount: typeof attemptsCount === 'number' ? attemptsCount : null,
          exitTicketCount: exitTicket?.count ?? null,
          exitTicketAvgRating: exitTicket?.avgRating ?? null,
          exitTicketTopConcepts: exitTicket?.topConcepts?.length ? exitTicket.topConcepts : null,
        },
        dataCompleteness: {
          note: zh
            ? '仅包含本地课堂真实产生的统计；标 null 的维度在本次课堂中未采集到数据。'
            : 'Only locally produced statistics are included; null dimensions had no data in this session.',
          missingDimensions: [
            typeof attemptsCount !== 'number' && 'submissionCount',
            exitTicket?.count == null && 'exitTicket',
          ].filter(Boolean),
        },
      };

      const blob = new Blob([JSON.stringify(celtsReport, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartedu_celts_report_${lessonId || 'summary'}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setDownloaded(true);
      window.setTimeout(() => setDownloaded(false), 2500);
    } catch (err) {
      console.error('[SmartEduPostClassExporter] export failed:', err);
      alert(zh ? '导出失败，请重试' : 'Export failed, please retry');
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500/20 to-yellow-600/20 hover:from-amber-500/30 hover:to-yellow-600/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition active:scale-98"
      title={zh ? '导出本堂课真实学情统计的 CELTS-3 归档包' : 'Export real session statistics as a CELTS-3 archive'}
    >
      {exporting ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : downloaded ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
      )}
      <span>{downloaded ? (zh ? '已导出 CELTS-3 报告' : 'CELTS-3 report exported') : zh ? '国家平台学情包导出' : 'Export CELTS-3 report'}</span>
    </button>
  );
}
