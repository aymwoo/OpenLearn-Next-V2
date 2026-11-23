/**
 * 调查活动：支持单选 / 多选 / 填空，提交后回写结构化答案。
 */
import { useState } from 'react';
import {
  parseActivityConfig,
  readString,
  readSubmittedAnswers,
  readSurveyConfig,
} from '../../../xuean/activity-config';
import { isActivityDone, submitActivityModule, type StudentActivityModuleProps } from './module-shared';

type AnswerValue = string | string[];

export function SurveyActivityCard({
  activity,
  progress,
  lang = 'zh',
  onProgressUpdated,
  onActivityProgressReported,
}: StudentActivityModuleProps) {
  const zh = lang === 'zh';
  const config = parseActivityConfig(activity.config_json);
  const { description, questions } = readSurveyConfig(config);
  const initialAnswers = readSubmittedAnswers(progress?.submission_json).payload?.answers ?? {};

  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => {
    const next: Record<string, AnswerValue> = {};
    for (const [key, value] of Object.entries(initialAnswers)) {
      next[key] = Array.isArray(value) ? value : String(value);
    }
    return next;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const done = isActivityDone(progress);

  const setSingle = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const toggleMultiple = (questionId: string, option: string) => {
    setAnswers((prev) => {
      const current = prev[questionId];
      const list = Array.isArray(current) ? current : [];
      const next = list.includes(option) ? list.filter((item) => item !== option) : [...list, option];
      return { ...prev, [questionId]: next };
    });
  };

  const submit = async () => {
    for (const question of questions) {
      if (!question.required) continue;
      const value = answers[question.id];
      const empty =
        question.type === 'text' ? !String(value ?? '').trim() : Array.isArray(value) ? value.length === 0 : !value;
      if (empty) {
        setError(
          zh
            ? `请完成第 ${questions.indexOf(question) + 1} 题`
            : `Please answer question ${questions.indexOf(question) + 1}`,
        );
        return;
      }
    }
    setBusy(true);
    setError(null);
    const result = await submitActivityModule(
      activity.id,
      { type: 'text', content: JSON.stringify({ answers }) },
      { onProgressUpdated, onActivityProgressReported },
    );
    if (result.ok) setSaved(true);
    else setError(result.error);
    setBusy(false);
  };

  return (
    <form
      className="mt-3 space-y-3"
      data-testid="survey-activity-module"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {description ? (
        <div className="rounded-lg border border-theme/60 bg-surface-secondary/40 p-3 text-sm text-main whitespace-pre-wrap">
          {description}
        </div>
      ) : null}
      {questions.length === 0 ? (
        <p className="text-xs text-muted">{zh ? '教师尚未添加调查题目。' : 'No survey questions yet.'}</p>
      ) : null}
      {questions.map((question, index) => (
        <fieldset key={question.id} className="rounded-lg border border-theme/60 p-3 space-y-2">
          <legend className="text-sm font-semibold text-main px-1">
            {index + 1}. {question.title}
            {question.required ? <span className="ml-1 text-rose-600">*</span> : null}
          </legend>
          {question.type === 'text' ? (
            <textarea
              value={String(answers[question.id] ?? '')}
              onChange={(event) => setSingle(question.id, event.target.value)}
              aria-label={`${index + 1}. ${question.title}`}
              required={question.required}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {question.options.map((option, optionIndex) => {
                const name = `survey-${activity.id}-${question.id}`;
                const checked =
                  question.type === 'multiple'
                    ? Array.isArray(answers[question.id]) && (answers[question.id] as string[]).includes(option)
                    : answers[question.id] === option;
                return (
                  <label key={option} className="flex items-center gap-2 text-sm text-main cursor-pointer">
                    <input
                      type={question.type === 'multiple' ? 'checkbox' : 'radio'}
                      name={name}
                      checked={checked}
                      required={question.required && optionIndex === 0}
                      onChange={() =>
                        question.type === 'multiple'
                          ? toggleMultiple(question.id, option)
                          : setSingle(question.id, option)
                      }
                      className="accent-primary-theme"
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      ))}
      {questions.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? zh
                ? '提交中…'
                : 'Submitting…'
              : done || saved
                ? zh
                  ? '更新回答'
                  : 'Update'
                : zh
                  ? '提交调查'
                  : 'Submit'}
          </button>
          {(done || saved) && !error ? (
            <span className="text-xs font-semibold text-emerald-600">{zh ? '已提交' : 'Submitted'}</span>
          ) : null}
          {error && (
            <span role="alert" className="text-xs text-rose-600">
              {error}
            </span>
          )}
        </div>
      ) : null}
    </form>
  );
}
