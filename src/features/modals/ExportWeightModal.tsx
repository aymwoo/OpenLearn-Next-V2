import { Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Settings2, Percent, ListFilter, Terminal, Download } from 'lucide-react';

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
    overrides?: Record<string, 'quiz' | 'assignment'>
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
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white border text-gray-900 border-gray-200 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[85vh]"
      >
        {/* Modal Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <Settings2 className="text-indigo-600 font-sans" size={20} />
            <h2 className="font-bold text-gray-800 text-lg font-sans">
              {lang === 'zh' ? '导出成绩权重设置' : 'Grade Export & Weighting Settings'}
            </h2>
          </div>
          <button 
            onClick={() => setIsExportWeightModalOpen(false)} 
            className="text-gray-400 hover:text-gray-600 font-bold p-1 hover:bg-gray-200 rounded transition-colors text-lg"
          >
            &times;
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="bg-indigo-50 border border-indigo-150 rounded-xl p-4 text-indigo-800 text-xs font-sans leading-relaxed">
            {lang === 'zh' 
              ? '您可以自定义测验与作业在期末成绩(平均分)中的计算权重。系统已根据测验名和内容自动对课程内容进行分类，您可以在下方手动微调分类。' 
              : 'Customize the calculation weight of quizzes and assignments in the calculated average score. The system automatically classifies items, but you can manually override categorized groups below.'}
          </div>

          {/* Weighting Sliders */}
          <div className="space-y-4">
            <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2 font-sans">
              <Percent size={16} className="text-indigo-500 font-sans" />
              {lang === 'zh' ? '定义成绩占比权重' : 'Define Weighting Percentages'}
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100 font-sans">
              {/* Quizzes Weight */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700">
                    {lang === 'zh' ? '测验权重 (Quizzes)' : 'Quizzes Weight'}
                  </span>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                    {quizzesWeight}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={quizzesWeight}
                  onChange={(e) => handleQuizzesWeightChange(Number(e.target.value))}
                  className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              {/* Assignments Weight */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700">
                    {lang === 'zh' ? '作业权重 (Assignments)' : 'Assignments Weight'}
                  </span>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                    {assignmentsWeight}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={assignmentsWeight}
                  onChange={(e) => handleAssignmentsWeightChange(Number(e.target.value))}
                  className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setQuizzesWeight(50); setAssignmentsWeight(50); }}
                className="text-[10px] text-gray-500 hover:text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 font-bold px-2.5 py-1 rounded transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '均衡配比 50/50' : 'Balance 50/50'}
              </button>
              <button
                type="button"
                onClick={() => { setQuizzesWeight(40); setAssignmentsWeight(60); }}
                className="text-[10px] text-gray-500 hover:text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 font-bold px-2.5 py-1 rounded transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '推荐配比 40/60' : 'Recommend 40/60'}
              </button>
            </div>
          </div>

          {/* Items Categorization Overrides */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-gray-800 flex items-center justify-between font-sans">
              <span className="flex items-center gap-2">
                <ListFilter size={16} className="text-indigo-500" />
                {lang === 'zh' ? '期末考核项目微调' : 'Item Categorization Overrides'}
              </span>
              <span className="text-[10px] text-gray-400 font-medium font-sans">
                {lang === 'zh' ? `共 ${classDashboardMap[exportClassId]?.assignments?.length || 0} 项` : `${classDashboardMap[exportClassId]?.assignments?.length || 0} items total`}
              </span>
            </h3>

            <div className="border border-gray-150 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-60 overflow-y-auto bg-white shadow-inner">
              {(classDashboardMap[exportClassId]?.assignments || []).map((a: any) => {
                const isMcq = a.content && a.content.startsWith('{"quizType":"mcq_learning_objectives"');
                const hasQuizInTitle = a.title && (a.title.toLowerCase().includes('quiz') || a.title.toLowerCase().includes('test') || a.title.includes('测验') || a.title.includes('测试'));
                const defaultCategory = (isMcq || hasQuizInTitle) ? 'quiz' : 'assignment';
                const currentCategory = customCategoryOverrides[a.id] || defaultCategory;

                return (
                  <div key={a.id} className="p-3 flex items-center justify-between gap-4 font-sans hover:bg-gray-50/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-xs text-gray-800 truncate" title={a.title}>
                        {a.title}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate mt-0.5">
                        {a.description || (lang === 'zh' ? '无描述信息' : 'No description provided')}
                      </div>
                    </div>

                    <div className="flex border border-gray-200 rounded-lg p-0.5 bg-gray-50 shrink-0">
                      <button
                        type="button"
                        onClick={() => setCustomCategoryOverrides(prev => ({ ...prev, [a.id]: 'quiz' }))}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                          currentCategory === 'quiz'
                            ? 'bg-indigo-600 text-white shadow'
                            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                        }`}
                      >
                        {lang === 'zh' ? '测验' : 'Quiz'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomCategoryOverrides(prev => ({ ...prev, [a.id]: 'assignment' }))}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                          currentCategory === 'assignment'
                            ? 'bg-emerald-600 text-white shadow'
                            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                        }`}
                      >
                        {lang === 'zh' ? '作业' : 'Assignment'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {(!classDashboardMap[exportClassId]?.assignments || classDashboardMap[exportClassId].assignments.length === 0) && (
                <div className="p-8 text-center text-xs text-gray-400 italic">
                  {lang === 'zh' ? '此班级暂未创建任何考核项目' : 'No graded items exist in this class.'}
                </div>
              )}
            </div>
          </div>

          {/* Live Preview Section */}
          {csvPreviewData && csvPreviewData.rows.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="font-bold text-sm text-gray-800 flex items-center justify-between font-sans">
                <span className="flex items-center gap-2">
                  <Terminal size={16} className="text-emerald-500" />
                  {lang === 'zh' ? 'CSV 实时成绩表预览 (前5行数据)' : 'Live CSV Grade Preview (First 5 Rows)'}
                </span>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold px-2 py-0.5 rounded shadow-xs font-sans">
                  {lang === 'zh' ? `展示 5 / ${csvPreviewData.totalStudents} 名学生` : `Showing 5 of ${csvPreviewData.totalStudents} students`}
                </span>
              </h3>
              
              <div className="border border-gray-150 rounded-xl overflow-hidden bg-white shadow-xs max-w-full">
                <div className="overflow-x-auto max-h-56 overflow-y-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-150 sticky top-0 z-10">
                        {csvPreviewData.headers.map((hdr, hIdx) => {
                          // Highlight key overall calculation columns
                          const isCalcCol = hdr.includes('Average') || hdr.includes('Avg') || hdr.includes('Score');
                          const isWeighted = hdr.includes('Weighted');
                          return (
                            <th 
                              key={hIdx} 
                              className={`p-2.5 text-[10px] font-bold tracking-wider uppercase border-r border-gray-150 whitespace-nowrap font-sans font-semibold ${
                                isWeighted 
                                  ? 'text-indigo-700 bg-indigo-50/70 border-indigo-150 font-bold' 
                                  : isCalcCol 
                                  ? 'text-emerald-700 bg-emerald-50/70' 
                                  : 'text-gray-500'
                              }`}
                            >
                              {hdr}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {csvPreviewData.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-gray-50/50 transition-colors font-mono text-[10px]">
                          {row.map((cell, cIdx) => {
                            const hdrName = csvPreviewData.headers[cIdx] || '';
                            const isWeighted = hdrName.includes('Weighted');
                            const isCalcCol = hdrName.includes('Average') || hdrName.includes('Avg') || hdrName.includes('Score');
                            return (
                              <td 
                                key={cIdx} 
                                className={`p-2 border-r border-gray-100 font-mono text-[10px] text-gray-700 whitespace-nowrap text-center ${
                                  isWeighted 
                                    ? 'bg-indigo-50/30 font-bold text-indigo-700 border-indigo-100' 
                                    : isCalcCol 
                                    ? 'bg-emerald-50/10 font-semibold text-emerald-800' 
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
                </div>
              </div>
              <p className="text-[10px] text-gray-400 font-sans italic">
                {lang === 'zh' 
                  ? '* 改变上方权重占比或调整项目分类时，此预览与计算结果会立即实时刷新。' 
                  : '* Calculations and layout values in this preview refresh dynamically as you tweak sliders and overrides.'}
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/85 flex justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsExportWeightModalOpen(false)}
            className="px-4 py-2 text-xs font-semibold border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          >
            {lang === 'zh' ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={!classDashboardMap[exportClassId]?.assignments || classDashboardMap[exportClassId].assignments.length === 0}
            onClick={() => {
              handleExportGrades(exportClassId, exportClassName, quizzesWeight, assignmentsWeight, customCategoryOverrides);
              setIsExportWeightModalOpen(false);
            }}
            className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white border border-indigo-700 rounded-lg hover:bg-indigo-700 hover:shadow shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            {lang === 'zh' ? '导出 CSV 成绩表' : 'Export Grade Sheet'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
