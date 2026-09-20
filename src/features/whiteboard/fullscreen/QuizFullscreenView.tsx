import React, { useEffect, useState } from 'react';
import type { FullscreenRendererProps } from './FullscreenRendererRegistry';

interface QuizSubmission {
  answer?: number | string;
  optionIndex?: number;
  score?: number | string;
  time?: number | string;
  timestamp?: number | string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * 全屏 quiz 视图 —— 在原来「提交统计: N 人已作答」的基础上渲染完整成绩表格：
 *   - 顶部统计：提交人数 / 通过人数 / 通过率 / 平均分
 *   - 明细表格：学生、选择、得分、提交时间；选项自带正确答案高亮
 *
 * 兼容两种历史数据形态（旧的 optionIndex/timestamp 与新的 answer/score/time），
 * 这样不需要同步改 server 端 quiz-submit 路由也能渲染已有数据。
 *
 * 单独抽出该文件，是为了方便在不加载 InteractiveWhiteboard 整体（包含 react-konva
 * 等重型依赖）的情况下单独对该渲染器做单元测试。
 */
export const QuizFullscreenView: React.FC<FullscreenRendererProps> = ({ data }) => {
  const [studentMap, setStudentMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/students')
      .then((r) => (r.ok ? r.json() : []))
      .then((arr: Array<{ id: string; name: string }>) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const s of Array.isArray(arr) ? arr : []) map[s.id] = s.name;
        setStudentMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const submissions = (data.submissions || {}) as Record<string, QuizSubmission>;
  const entries = Object.entries(submissions);
  const correctIndex: number | undefined =
    typeof data.correctIndex === 'number' ? data.correctIndex : undefined;
  const passScore: number = typeof data.passScore === 'number' ? data.passScore : 60;

  const parseScore = (v: any): number | null => {
    if (typeof v === 'number' && !isNaN(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    }
    return null;
  };
  const parseAnswerIdx = (v: QuizSubmission): number | undefined => {
    if (typeof v.answer === 'number') return v.answer;
    if (typeof v.answer === 'string') {
      const n = parseInt(v.answer, 10);
      return isNaN(n) ? undefined : n;
    }
    if (typeof v.optionIndex === 'number') return v.optionIndex;
    return undefined;
  };

  const scored = entries.map(([sid, v]) => {
    const answerIdx = parseAnswerIdx(v);
    const scoreNum = parseScore(v.score);
    const isCorrect =
      answerIdx !== undefined && correctIndex !== undefined
        ? answerIdx === correctIndex
        : scoreNum !== null
          ? scoreNum >= passScore
          : false;
    return { sid, v, answerIdx, scoreNum, isCorrect };
  });

  const submittedCount = entries.length;
  const passedCount = scored.filter((s) => s.isCorrect).length;
  const passRate = submittedCount > 0 ? Math.round((passedCount / submittedCount) * 100) : 0;
  const scoresArr = scored.map((s) => s.scoreNum).filter((n): n is number => n !== null);
  const avgScore = scoresArr.length > 0 ? scoresArr.reduce((a, b) => a + b, 0) / scoresArr.length : null;

  const formatTime = (t: any): string => {
    if (t === undefined || t === null) return '-';
    const n = typeof t === 'number' ? t : Number(t);
    const d = !isNaN(n) ? new Date(n) : new Date(String(t));
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h3 className="text-xl font-bold text-gray-800" data-testid="quiz-question">
        {data.question}
      </h3>
      <div className="flex flex-col gap-3">
        {(data.options || []).map((opt: string, i: number) => (
          <div
            key={i}
            className={`px-5 py-4 text-left rounded-xl text-base border-2 ${
              correctIndex === i
                ? 'bg-green-50 border-green-300 text-green-800'
                : 'bg-gray-50 border-gray-200 text-gray-700'
            }`}
          >
            <span className="font-bold text-indigo-600 mr-3">{LETTERS[i]}.</span>
            {opt}
            {correctIndex === i && (
              <span className="ml-2 text-xs font-bold text-green-600">✓ 正确答案</span>
            )}
          </div>
        ))}
      </div>

      {submittedCount === 0 ? (
        <div className="mt-4 p-4 bg-gray-50 rounded-xl text-center text-sm text-gray-400">
          暂无学生提交
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-4 gap-3" data-testid="quiz-summary">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400">提交</div>
              <div className="text-xl font-bold text-gray-700" data-testid="quiz-stat-submitted">
                {submittedCount}
              </div>
            </div>
            <div className="bg-green-50 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400">通过</div>
              <div className="text-xl font-bold text-green-600" data-testid="quiz-stat-passed">
                {passedCount}
              </div>
            </div>
            <div className="bg-indigo-50 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400">通过率</div>
              <div className="text-xl font-bold text-indigo-600">{passRate}%</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-400">均分</div>
              <div className="text-xl font-bold text-amber-600">
                {avgScore !== null ? avgScore.toFixed(1) : '-'}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-xl">
            <table className="w-full text-sm" data-testid="quiz-submissions-table">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">学生</th>
                  <th className="px-4 py-2 text-left">答案</th>
                  <th className="px-4 py-2 text-right">得分</th>
                  <th className="px-4 py-2 text-right">提交时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scored.map(({ sid, v, answerIdx, scoreNum, isCorrect }) => {
                  const answerLetter =
                    answerIdx !== undefined && answerIdx >= 0 && answerIdx < LETTERS.length
                      ? LETTERS[answerIdx]
                      : '-';
                  const displayScore = scoreNum !== null ? scoreNum : isCorrect ? 100 : 0;
                  const studentName = studentMap[sid] || sid;
                  return (
                    <tr
                      key={sid}
                      className="hover:bg-gray-50"
                      data-testid={`quiz-row-${sid}`}
                    >
                      <td className="px-4 py-2 font-medium text-gray-700">{studentName}</td>
                      <td
                        className={`px-4 py-2 font-mono ${
                          isCorrect ? 'text-green-600 font-bold' : 'text-red-500'
                        }`}
                      >
                        {answerLetter}
                        {isCorrect ? ' ✓' : ''}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono font-bold ${
                          displayScore >= passScore ? 'text-green-600' : 'text-gray-600'
                        }`}
                      >
                        {displayScore}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500 text-xs">
                        {formatTime(v.time ?? v.timestamp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuizFullscreenView;