import { Dispatch, SetStateAction } from 'react';
import { Settings2, Percent, ListFilter, Terminal, Download } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
import { AccessibleTableRegion } from '../../components/AccessibleTableRegion';

type Lang = 'zh' | 'en';

interface CsvPreviewData {
  headers: string[];
  rows: string[][];
  totalStudents: number;
}

export interface ExportWeightModalProps {
  isExportWeightModalOpen: boolean;
  setIsExportWeightModalOpen: Dispatch<SetStateAction<boolean>>;
  lang: Lang;
  quizzesWeight: number;
  setQuizzesWeight: Dispatch<SetStateAction<number>>;
  assignmentsWeight: number;
  setAssignmentsWeight: Dispatch<SetStateAction<number>>;
  handleQuizzesWeightChange: (val: number) => void;
  handleAssignmentsWeightChange: (val: number) => void;
  customCategoryOverrides: Record<string, 'quiz' | 'assignment'>;
  setCustomCategoryOverrides: Dispatch<SetStateAction<Record<string, 'quiz' | 'assignment'>>>;
  classDashboardMap: Record<string, any>;
  exportClassId: string;
  exportClassName: string;
  csvPreviewData: CsvPreviewData | null;
  handleExportGrades: (
    classId: string,
    className: string,
    qWeight?: number,
    aWeight?: number,
    overrides?: Record<string, 'quiz' | 'assignment'>,
  ) => void;
}

export function ExportWeightModal({
  isExportWeightModalOpen,
  setIsExportWeightModalOpen,
  lang,
  quizzesWeight,
  setQuizzesWeight,
  assignmentsWeight,
  setAssignmentsWeight,
  handleQuizzesWeightChange,
  handleAssignmentsWeightChange,
  customCategoryOverrides,
  setCustomCategoryOverrides,
  classDashboardMap,
  exportClassId,
  exportClassName,
  csvPreviewData,
  handleExportGrades,
}: ExportWeightModalProps) {
  if (!isExportWeightModalOpen) return null;

  return (
    <AccessibleDialog
      open={isExportWeightModalOpen}
      onClose={() => setIsExportWeightModalOpen(false)}
      ariaLabelledBy="export-weight-dialog-title"
      closedBy="any"
      className="max-w-2xl max-h-[85vh]"
    >
      <DialogHeader>
        <DialogTitle id="export-weight-dialog-title" icon={<Settings2 size={18} />}>
          {lang === 'zh' ? '导出成绩权重设置' : 'Grade Export & Weighting Settings'}
        </DialogTitle>
        <DialogCloseButton
          label={lang === 'zh' ? '关闭弹窗' : 'Close dialog'}
          onClick={() => setIsExportWeightModalOpen(false)}
        />
      </DialogHeader>

      <DialogBody className="space-y-6">
        <div className="bg-primary-theme-light border border-primary-theme/30 rounded-xl p-4 text-primary-ink text-xs font-sans leading-relaxed">
          {lang === 'zh'
            ? '您可以自定义测验与作业在期末成绩(平均分)中的计算权重。系统已根据测验名和内容自动对课程内容进行分类，您可以在下方手动微调分类。'
            : 'Customize the calculation weight of quizzes and assignments in the calculated average score. The system automatically classifies items, but you can manually override categorized groups below.'}
        </div>

        {/* Weighting Sliders */}
        <div className="space-y-4">
          <h3 className="font-bold text-sm text-main flex items-center gap-2 font-sans">
            <Percent size={16} className="text-primary-ink font-sans" />
            {lang === 'zh' ? '定义成绩占比权重' : 'Define Weighting Percentages'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-surface-secondary p-4 rounded-xl border border-theme font-sans">
            {/* Quizzes Weight */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-main">
                  {lang === 'zh' ? '测验权重 (Quizzes)' : 'Quizzes Weight'}
                </span>
                <span className="text-xs font-bold text-primary-ink bg-primary-theme-light px-2 py-0.5 rounded border border-primary-theme/30">
                  {quizzesWeight}%
                </span>
              </div>
              <input
                type="range"
                aria-label={lang === 'zh' ? '随堂测验权重' : 'Quizzes weight'}
                min="0"
                max="100"
                value={quizzesWeight}
                onChange={(e) => handleQuizzesWeightChange(Number(e.target.value))}
                className="w-full h-1.5 bg-surface-secondary rounded-lg appearance-none cursor-pointer accent-primary-solid"
              />
            </div>

            {/* Assignments Weight */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-main">
                  {lang === 'zh' ? '作业权重 (Assignments)' : 'Assignments Weight'}
                </span>
                <span className="text-xs font-bold text-primary-ink bg-primary-theme-light px-2 py-0.5 rounded border border-primary-theme/30">
                  {assignmentsWeight}%
                </span>
              </div>
              <input
                type="range"
                aria-label={lang === 'zh' ? '作业权重' : 'Assignments weight'}
                min="0"
                max="100"
                value={assignmentsWeight}
                onChange={(e) => handleAssignmentsWeightChange(Number(e.target.value))}
                className="w-full h-1.5 bg-surface-secondary rounded-lg appearance-none cursor-pointer accent-primary-solid"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <DialogButton
              variant="secondary"
              onClick={() => {
                setQuizzesWeight(50);
                setAssignmentsWeight(50);
              }}
            >
              {lang === 'zh' ? '均衡配比 50/50' : 'Balance 50/50'}
            </DialogButton>
            <DialogButton
              variant="secondary"
              onClick={() => {
                setQuizzesWeight(40);
                setAssignmentsWeight(60);
              }}
            >
              {lang === 'zh' ? '推荐配比 40/60' : 'Recommend 40/60'}
            </DialogButton>
          </div>
        </div>

        {/* Items Categorization Overrides */}
        <div className="space-y-3">
          <h3 className="font-bold text-sm text-main flex items-center justify-between font-sans">
            <span className="flex items-center gap-2">
              <ListFilter size={16} className="text-primary-ink" />
              {lang === 'zh' ? '期末考核项目微调' : 'Item Categorization Overrides'}
            </span>
            <span className="text-xs text-subtle font-medium font-sans">
              {lang === 'zh'
                ? `共 ${classDashboardMap[exportClassId]?.assignments?.length || 0} 项`
                : `${classDashboardMap[exportClassId]?.assignments?.length || 0} items total`}
            </span>
          </h3>

          <div className="border border-theme rounded-xl overflow-hidden divide-y divide-theme max-h-60 overflow-y-auto bg-surface shadow-inner">
            {(classDashboardMap[exportClassId]?.assignments || []).map((a: any) => {
              const isMcq = a.content && a.content.startsWith('{"quizType":"mcq_learning_objectives"');
              const hasQuizInTitle =
                a.title &&
                (a.title.toLowerCase().includes('quiz') ||
                  a.title.toLowerCase().includes('test') ||
                  a.title.includes('测验') ||
                  a.title.includes('测试'));
              const defaultCategory = isMcq || hasQuizInTitle ? 'quiz' : 'assignment';
              const currentCategory = customCategoryOverrides[a.id] || defaultCategory;

              return (
                <div
                  key={a.id}
                  className="p-3 flex items-center justify-between gap-4 font-sans hover:bg-surface-secondary/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-xs text-main truncate" title={a.title}>
                      {a.title}
                    </div>
                    <div className="text-xs text-subtle truncate mt-0.5">
                      {a.description || (lang === 'zh' ? '无描述信息' : 'No description provided')}
                    </div>
                  </div>

                  <div className="flex border border-theme rounded-lg p-0.5 bg-surface-secondary shrink-0">
                    <button
                      type="button"
                      onClick={() => setCustomCategoryOverrides((prev) => ({ ...prev, [a.id]: 'quiz' }))}
                      className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        currentCategory === 'quiz'
                          ? 'bg-primary-solid text-white shadow'
                          : 'text-muted hover:text-main hover:bg-surface-secondary'
                      }`}
                    >
                      {lang === 'zh' ? '测验' : 'Quiz'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomCategoryOverrides((prev) => ({ ...prev, [a.id]: 'assignment' }))}
                      className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                        currentCategory === 'assignment'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-muted hover:text-main hover:bg-surface-secondary'
                      }`}
                    >
                      {lang === 'zh' ? '作业' : 'Assignment'}
                    </button>
                  </div>
                </div>
              );
            })}
            {(!classDashboardMap[exportClassId]?.assignments ||
              classDashboardMap[exportClassId].assignments.length === 0) && (
              <div className="p-8 text-center text-xs text-subtle italic">
                {lang === 'zh' ? '此班级暂未创建任何考核项目' : 'No graded items exist in this class.'}
              </div>
            )}
          </div>
        </div>

        {/* Live Preview Section */}
        {csvPreviewData && csvPreviewData.rows.length > 0 && (
          <div className="space-y-3 pt-2">
            <h3 className="font-bold text-sm text-main flex items-center justify-between font-sans">
              <span className="flex items-center gap-2">
                <Terminal size={16} className="text-emerald-500" />
                {lang === 'zh' ? 'CSV 实时成绩表预览 (前5行数据)' : 'Live CSV Grade Preview (First 5 Rows)'}
              </span>
              <span className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-bold px-2 py-0.5 rounded shadow-xs font-sans">
                {lang === 'zh'
                  ? `展示 5 / ${csvPreviewData.totalStudents} 名学生`
                  : `Showing 5 of ${csvPreviewData.totalStudents} students`}
              </span>
            </h3>

            <div className="border border-theme rounded-xl overflow-hidden bg-surface shadow-xs max-w-full">
              <AccessibleTableRegion labelledBy="export-weight-preview-caption" className="max-h-56 overflow-y-auto">
                <table className="responsive-data-table w-full border-collapse text-left">
                  <caption id="export-weight-preview-caption" className="sr-only">
                    {lang === 'zh' ? 'CSV 实时成绩表预览 (前5行数据)' : 'Live CSV Grade Preview (First 5 Rows)'}
                  </caption>
                  <thead>
                    <tr className="bg-surface-secondary border-b border-theme sticky top-0 z-10">
                      {csvPreviewData.headers.map((hdr, hIdx) => {
                        // Highlight key overall calculation columns
                        const isCalcCol = hdr.includes('Average') || hdr.includes('Avg') || hdr.includes('Score');
                        const isWeighted = hdr.includes('Weighted');
                        return (
                          <th
                            scope="col"
                            key={hIdx}
                            className={`p-2.5 text-xs font-bold tracking-wider uppercase border-r border-theme whitespace-nowrap font-sans font-semibold ${
                              isWeighted
                                ? 'text-primary-ink bg-primary-theme-light/70 border-primary-theme/30 font-bold'
                                : isCalcCol
                                  ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
                                  : 'text-muted'
                            }`}
                          >
                            {hdr}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-theme">
                    {csvPreviewData.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-surface-secondary/50 transition-colors font-mono text-xs">
                        {row.map((cell, cIdx) => {
                          const hdrName = csvPreviewData.headers[cIdx] || '';
                          const isWeighted = hdrName.includes('Weighted');
                          const isCalcCol =
                            hdrName.includes('Average') || hdrName.includes('Avg') || hdrName.includes('Score');
                          return (
                            <td
                              key={cIdx}
                              className={`p-2 border-r border-theme font-mono text-xs text-main whitespace-nowrap text-center ${
                                isWeighted
                                  ? 'bg-primary-theme-light/30 font-bold text-primary-ink border-primary-theme/30'
                                  : isCalcCol
                                    ? 'bg-emerald-500/10 font-semibold text-emerald-800 dark:text-emerald-400'
                                    : cIdx < 2
                                      ? 'text-left font-sans font-medium'
                                      : ''
                              }`}
                            >
                              {cell}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AccessibleTableRegion>
            </div>
            <p className="text-xs text-subtle font-sans italic">
              {lang === 'zh'
                ? '* 改变上方权重占比或调整项目分类时，此预览与计算结果会立即实时刷新。'
                : '* Calculations and layout values in this preview refresh dynamically as you tweak sliders and overrides.'}
            </p>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <DialogButton variant="secondary" onClick={() => setIsExportWeightModalOpen(false)}>
          {lang === 'zh' ? '取消' : 'Cancel'}
        </DialogButton>
        <DialogButton
          variant="primary"
          disabled={
            !classDashboardMap[exportClassId]?.assignments || classDashboardMap[exportClassId].assignments.length === 0
          }
          onClick={() => {
            handleExportGrades(
              exportClassId,
              exportClassName,
              quizzesWeight,
              assignmentsWeight,
              customCategoryOverrides,
            );
            setIsExportWeightModalOpen(false);
          }}
        >
          <Download size={14} />
          {lang === 'zh' ? '导出 CSV 成绩表' : 'Export Grade Sheet'}
        </DialogButton>
      </DialogFooter>
    </AccessibleDialog>
  );
}
